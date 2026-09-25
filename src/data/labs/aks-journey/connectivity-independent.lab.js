import { CONNECTIVITY_INDEPENDENT_FILES, CONNECTIVITY_INDEPENDENT_MANIFEST, CONNECTIVITY_INDEPENDENT_SOLUTION_FILES } from '../../templates/aks-python/connectivity.js'
import { getServiceBackends } from '../../../lib/kubernetes/services.js'
import { connectivityDependencies } from '../../../lib/kubernetes/evidence.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { parseKubernetesYaml } from '../../../lib/kubernetes/yaml.js'
import { CONNECTIVITY_INDEPENDENT_CLUSTER, CONNECTIVITY_INDEPENDENT_GROUP, seedConnectivityIndependent } from './connectivity-seeds.js'
import { connectivityScenario } from './connectivity-helpers.js'

const clusterId = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${CONNECTIVITY_INDEPENDENT_GROUP}/providers/Microsoft.ContainerService/managedClusters/${CONNECTIVITY_INDEPENDENT_CLUSTER}`
const internalOrigin = { kind: 'diagnostic', namespace: 'diagnostics', name: 'diagnostics' }
const question = { question: 'How long are backups kept?' }
const sharedImage = 'acraksnetworkindependent.azurecr.io/assistant:shared'
const reviewAnswer = { status: 200, body: { answer: 'Review backups are kept for 7 days.', sources: ['review-backups'], environment: 'review', displayName: 'Review assistant' } }
const primaryAnswer = { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'production', displayName: 'Primary assistant' } }
const file = path => ({ kind: 'file', path, content: CONNECTIVITY_INDEPENDENT_SOLUTION_FILES[path] })
const commands = (...lines) => lines.map(line => ({ kind: 'command', line }))
const target = (namespace, serviceName) => ({ clusterId, namespace, serviceName, deploymentName: 'assistant', clientPodUid: `diagnostic/${clusterId}` })
const record = (context, taskId) => context.evidence?.experimentsById?.[context.evidence?.currentEvidenceByTask?.[taskId]]
const yaml = path => parseKubernetesYaml(CONNECTIVITY_INDEPENDENT_FILES[path], path).documents[0]
const deploymentSpec = spec => {
  const { annotations: originalAnnotations, ...metadata } = spec?.template?.metadata ?? {}
  const annotations = { ...(originalAnnotations ?? {}) }
  delete annotations['kubectl.kubernetes.io/restarted-at']
  return { ...spec, template: { ...spec?.template, metadata: { ...metadata, ...(Object.keys(annotations).length ? { annotations } : {}) } } }
}
const serviceReady = (context, namespace, name, type, port) => {
  const run = context.run ?? context
  const service = run.runtime.kubernetes?.clusters?.[clusterId]?.resources?.[`Service/${namespace}/${name}`]
  const backends = getServiceBackends(run, { clusterId, namespace, serviceName: name })
  return service?.spec?.type === type && service.spec?.selector?.app === 'assistant' && service.spec?.ports?.[0]?.port === port
    && ['http', 8080].includes(service.spec.ports[0].targetPort) && backends.readyEndpoints.length === 2
}
const primaryIntact = context => {
  const run = context.run ?? context; const state = run.runtime.kubernetes?.clusters?.[clusterId]
  const paths = ['app.py', 'Dockerfile', 'k8s/primary-namespace.yaml', 'k8s/primary-configmap.yaml', 'k8s/primary-secret.yaml', 'k8s/primary-deployment.yaml', 'k8s/primary-service-internal.yaml', 'k8s/primary-service-external.yaml']
  const config = yaml('k8s/primary-configmap.yaml')?.data
  const pods = Object.values(state?.resources ?? {}).filter(item => item.kind === 'Pod' && item.metadata.namespace === 'primary' && item.metadata.labels?.app === 'assistant')
  const snapshotsCurrent = pods.length === 2 && pods.every(pod => {
    const snapshot = state?.podSnapshots?.[pod.metadata.uid]; const artifact = snapshot && run.artifacts.buildsById?.[snapshot.artifactId]
    return pod.status?.phase === 'Running' && pod.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')
      && pod.spec.containers?.[0]?.image === sharedImage && artifact?.image?.loginServer === 'acraksnetworkindependent.azurecr.io'
      && artifact.image?.repository === 'assistant' && artifact.image?.tag === 'shared'
      && snapshot.environment?.APP_ENV === config?.APP_ENV && snapshot.environment?.COLLECTION === config?.COLLECTION
      && snapshot.environment?.PGHOST === config?.PGHOST && snapshot.environment?.PGPASSWORD === 'training-only-password'
      && snapshot.files?.['/etc/assistant/settings.json'] === config?.['settings.json']
  })
  return paths.every(path => run.project.savedFiles[path] === CONNECTIVITY_INDEPENDENT_FILES[path])
    && canonicalize(state?.resources?.['ConfigMap/primary/assistant-config']?.data) === canonicalize(config)
    && canonicalize(state?.resources?.['Secret/primary/assistant-credentials']?.data) === canonicalize({ PGPASSWORD: 'dHJhaW5pbmctb25seS1wYXNzd29yZA==' })
    && canonicalize(deploymentSpec(state?.resources?.['Deployment/primary/assistant']?.spec)) === canonicalize(deploymentSpec(yaml('k8s/primary-deployment.yaml')?.spec))
    && canonicalize(state?.resources?.['Service/primary/assistant-internal']?.spec) === canonicalize({ type: 'ClusterIP', selector: { app: 'assistant' }, ports: [{ protocol: 'TCP', port: 8080, targetPort: 'http' }], clusterIP: state?.resources?.['Service/primary/assistant-internal']?.spec?.clusterIP })
    && canonicalize(state?.resources?.['Service/primary/assistant-public']?.spec) === canonicalize({ type: 'LoadBalancer', selector: { app: 'assistant' }, ports: [{ protocol: 'TCP', port: 80, targetPort: 'http' }], clusterIP: state?.resources?.['Service/primary/assistant-public']?.spec?.clusterIP })
    && snapshotsCurrent && serviceReady(run, 'primary', 'assistant-internal', 'ClusterIP', 8080) && serviceReady(run, 'primary', 'assistant-public', 'LoadBalancer', 80)
}
const answerTask = ({ id, stageId, text, explanation, hints, examNote, scenarioId, namespace, serviceName }) => ({
  id, stageId, text, explanation, hints, examNote,
  check: context => { const item = record(context, id); return item?.outcome === 'passed' && item.scenarioId === scenarioId && item.measurements?.route?.namespace === namespace && item.measurements?.route?.serviceName === serviceName && item.measurements?.dependencyTrace?.length === 3 },
  verification: { scenarioId, scenarioVersion: 1 }, dependencies: connectivityDependencies(target(namespace, serviceName)),
  solution: { steps: [{ kind: 'scenario', scenarioId }] },
})

export const aksConnectivityIndependentLab = {
  id: 'aks-connectivity-independent', title: 'Expose an independent AKS review assistant',
  brief: 'The primary and review namespaces deliberately use identical Deployment names and app=assistant labels. Services select Pods only in their own namespace. Create review Services for the supplied shared image, then prove complete answers through both review and unchanged primary routes. From diagnostics, use qualified review DNS such as assistant-internal.review:8080; an unqualified name stays in diagnostics and does not fall back to either assistant namespace. No NetworkPolicy exercise is modeled, so qualified cross-namespace access is available in this simulation.',
  minutes: 40, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 9, labMode: 'independent', skillAreaId: 'containers', service: 'aks', status: 'available',
  manifestId: CONNECTIVITY_INDEPENDENT_MANIFEST.id, capabilities: { kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true },
  initialProjectFiles: CONNECTIVITY_INDEPENDENT_FILES, solutionFiles: CONNECTIVITY_INDEPENDENT_SOLUTION_FILES, initializeSimulation: seedConnectivityIndependent,
  stages: [
    { id: 'review-services', title: 'Expose the review assistant', taskIds: ['review-internal-service', 'review-external-service'] },
    { id: 'review-evidence', title: 'Verify review routes', taskIds: ['review-internal-answer', 'review-external-answer'] },
    { id: 'primary-evidence', title: 'Verify primary routes remain intact', taskIds: ['primary-internal-answer', 'primary-external-answer', 'primary-intact'] },
  ],
  scenarios: {
    'independent-network-review-internal': connectivityScenario({ clusterId, namespace: 'review', serviceName: 'assistant-internal', origin: internalOrigin, hostname: 'assistant-internal.review', port: 8080, method: 'POST', path: '/api/ask', body: question, expected: reviewAnswer }),
    'independent-network-review-external': connectivityScenario({ clusterId, namespace: 'review', serviceName: 'assistant-public', origin: { kind: 'external' }, method: 'POST', path: '/api/ask', body: question, expected: reviewAnswer }),
    'independent-network-primary-internal': connectivityScenario({ clusterId, namespace: 'primary', serviceName: 'assistant-internal', origin: internalOrigin, hostname: 'assistant-internal.primary', port: 8080, method: 'POST', path: '/api/ask', body: question, expected: primaryAnswer }),
    'independent-network-primary-external': connectivityScenario({ clusterId, namespace: 'primary', serviceName: 'assistant-public', origin: { kind: 'external' }, method: 'POST', path: '/api/ask', body: question, expected: primaryAnswer }),
  },
  tasks: [
    { id: 'review-internal-service', stageId: 'review-services', text: 'Create and apply the review assistant-internal ClusterIP Service on port 8080.', explanation: 'The review Pods already use app=assistant, the same label as primary Pods. Namespace-scoped Service selection keeps the two backend sets separate.', hints: ['The required Service hop is review/assistant-internal with type ClusterIP and port 8080.', 'Set targetPort to the supplied http name or numeric 8080, then inspect review EndpointSlices.'], examNote: 'A Service selector only considers Pods in the Service namespace; equal names and labels elsewhere are not candidates.', check: context => serviceReady(context, 'review', 'assistant-internal', 'ClusterIP', 8080), solution: { steps: [file('k8s/review-service-internal.yaml'), ...commands('kubectl apply -f k8s/review-service-internal.yaml', 'kubectl get endpointslices -n review -l kubernetes.io/service-name=assistant-internal -o yaml')] } },
    { id: 'review-external-service', stageId: 'review-services', text: 'Create and apply the review assistant-public LoadBalancer Service on port 80.', explanation: 'The allocated 192.0.2 address is a documentation-only trainer address. It identifies the review public Service at run time and is never a live Azure endpoint.', hints: ['The external hop requires review/assistant-public with type LoadBalancer and port 80.', 'Inspect its allocated simulation address with kubectl get services -n review -o wide.'], examNote: 'External verification requires the intended LoadBalancer Service, while ClusterIP routing starts inside the simulated cluster.', check: context => serviceReady(context, 'review', 'assistant-public', 'LoadBalancer', 80), solution: { steps: [file('k8s/review-service-external.yaml'), ...commands('kubectl apply -f k8s/review-service-external.yaml', 'kubectl get services -n review -o wide')] } },
    answerTask({ id: 'review-internal-answer', stageId: 'review-evidence', text: 'Verify the review backups answer through its internal Service.', explanation: 'Use the qualified review Service from diagnostics. The route must select a review Pod and then call the supplied embedding, PostgreSQL, and answer fixtures.', hints: ['Use assistant-internal.review:8080, because a short name resolves relative to diagnostics.', 'Run the review internal Verify action and inspect its review-backups source.'], examNote: 'The Service route reaches a Pod before the application invokes configured dependencies.', scenarioId: 'independent-network-review-internal', namespace: 'review', serviceName: 'assistant-internal' }),
    answerTask({ id: 'review-external-answer', stageId: 'review-evidence', text: 'Verify the review backups answer through its allocated public Service.', explanation: 'The external request is bound to the review LoadBalancer Service and its currently allocated simulation address.', hints: ['Apply the review LoadBalancer Service before running this scenario.', 'Confirm the response has environment review and source review-backups.'], examNote: 'A public Service still selects namespace-local ready Pods.', scenarioId: 'independent-network-review-external', namespace: 'review', serviceName: 'assistant-public' }),
    answerTask({ id: 'primary-internal-answer', stageId: 'primary-evidence', text: 'Verify the unchanged primary answer through its internal Service.', explanation: 'Primary uses the same shared source image but captures its production configuration. Keep its independent proof separate from review evidence.', hints: ['Use assistant-internal.primary:8080 from diagnostics.', 'Confirm the response has training-backups and environment production.'], examNote: 'The same artifact can produce distinct configured responses in namespace-specific Pods.', scenarioId: 'independent-network-primary-internal', namespace: 'primary', serviceName: 'assistant-internal' }),
    answerTask({ id: 'primary-external-answer', stageId: 'primary-evidence', text: 'Verify the unchanged primary answer through its public Service.', explanation: 'This is a separate immutable evidence record from the primary internal route, so a later review repair does not erase it.', hints: ['Use the named external Verify action after inspecting primary Services.', 'Confirm the selected Service is primary/assistant-public.'], examNote: 'Service UID, selected Pod namespace, response and dependency operations all identify the routed workload.', scenarioId: 'independent-network-primary-external', namespace: 'primary', serviceName: 'assistant-public' }),
    { id: 'primary-intact', stageId: 'primary-evidence', text: 'Keep the canonical primary Service and deployment state unchanged.', explanation: 'The primary files and runtime objects are seeded for inspection. Review work must not edit, reapply with changed fields, or replace the primary workload.', hints: ['Inspect primary Service types and EndpointSlices before final verification.', 'Restore any edited primary saved file to its supplied canonical text.'], examNote: 'Namespace separation demonstrates Service selection here; it is not a security boundary.', check: primaryIntact, dependencies: connectivityDependencies(target('primary', 'assistant-internal')), solution: { steps: [{ kind: 'inspect' }] } },
  ],
}
