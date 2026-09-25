import { CONNECTIVITY_FILES, CONNECTIVITY_MANIFEST, CONNECTIVITY_SOLUTION_FILES } from '../../templates/aks-python/connectivity.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { getServiceBackends } from '../../../lib/kubernetes/services.js'
import { CONNECTIVITY_CLUSTER, CONNECTIVITY_GROUP, CONNECTIVITY_REGISTRY, seedConnectivityGuided } from './connectivity-seeds.js'
import { connectivityScenario, connectivityTask } from './connectivity-helpers.js'

const clusterId = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${CONNECTIVITY_GROUP}/providers/Microsoft.ContainerService/managedClusters/${CONNECTIVITY_CLUSTER}`
const image = `${CONNECTIVITY_REGISTRY}.azurecr.io/assistant:network-v1`
const target = serviceName => ({ clusterId, namespace: 'assistant', serviceName, deploymentName: 'assistant', clientPodUid: `diagnostic/${clusterId}` })
const file = path => ({ kind: 'file', path, content: CONNECTIVITY_SOLUTION_FILES[path] })
const commands = (...lines) => lines.map(line => ({ kind: 'command', line }))
const state = context => context.runtime.kubernetes?.clusters?.[clusterId]
const serviceReady = (context, name, type) => {
  const service = state(context)?.resources[`Service/assistant/${name}`]
  const backends = getServiceBackends(context.run ?? context, { clusterId, namespace: 'assistant', serviceName: name })
  return service?.spec?.type === type && service.spec?.selector?.app === 'assistant' && service.spec?.ports?.[0]?.port === 80
    && service.spec.ports[0].targetPort === 'http' && backends.readyEndpoints.length === 2
}
const listenerReady = context => {
  const app = parsePythonProject(context.project.savedFiles, CONNECTIVITY_MANIFEST).appSpec
  const artifactId = context.artifacts.publishedTags?.[image]
  const artifact = artifactId && context.artifacts.buildsById?.[artifactId]
  const deployment = state(context)?.resources['Deployment/assistant/assistant']
  const pods = getDeploymentPods(context.run ?? context, clusterId, 'assistant', 'assistant')
  const sourceHash = projectSourceHash(selectBuildFiles(context.project.savedFiles, CONNECTIVITY_MANIFEST))
  return app?.listeningPort === 9090 && context.project.savedFiles.Dockerfile.includes('EXPOSE 9090')
    && deployment?.spec?.template?.spec?.containers?.[0]?.image === image
    && deployment.spec.template.spec.containers[0].ports?.some(port => port.name === 'http' && port.containerPort === 9090)
    && artifact?.sourceHash === sourceHash && artifact.appSpec?.listeningPort === 9090 && pods.length === 2
    && pods.every(pod => state(context).podSnapshots[pod.metadata.uid]?.artifactId === artifactId)
}

const info = { status: 200, body: { service: 'knowledge-assistant', version: '1.0', environment: 'training' } }
const answer = { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training', displayName: 'Training assistant' } }
const support = (id, stageId, text, explanation, hints, examNote, check, solution, verification, serviceName) => connectivityTask({
  id, stageId, text, explanation, hints, examNote, check, solution, verification, target: target(serviceName ?? 'assistant-internal'),
})

export const aksConnectivityGuidedLab = {
  id: 'aks-connectivity-guided', title: 'Trace AKS Service connectivity', brief: 'Create private and public Services for a supplied assistant, then trace internal and external requests through ready endpoints to the configured dependency fixtures.',
  minutes: 40, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 7, labMode: 'guided', skillAreaId: 'containers', service: 'aks', status: 'unavailable',
  manifestId: CONNECTIVITY_MANIFEST.id, capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true },
  initialProjectFiles: CONNECTIVITY_FILES, solutionFiles: CONNECTIVITY_SOLUTION_FILES, initializeSimulation: seedConnectivityGuided,
  stages: [
    { id: 'listener', title: 'Rebuild the listener', taskIds: ['listener'] },
    { id: 'internal', title: 'Route from the cluster', taskIds: ['internal-service', 'internal-route', 'internal-answer'] },
    { id: 'external', title: 'Expose and verify', taskIds: ['external-service', 'external-route', 'external-answer'] },
  ],
  scenarios: {
    'guided-network-internal': connectivityScenario({ id: 'guided-network-internal', clusterId, serviceName: 'assistant-internal', origin: { kind: 'diagnostic', namespace: 'diagnostics', name: 'diagnostics' }, hostname: 'assistant-internal.assistant', expected: info }),
    'guided-network-external': connectivityScenario({ id: 'guided-network-external', clusterId, serviceName: 'assistant-public', origin: { kind: 'external' }, expected: info }),
    'guided-network-internal-answer': connectivityScenario({ id: 'guided-network-internal-answer', clusterId, serviceName: 'assistant-internal', origin: { kind: 'diagnostic', namespace: 'diagnostics', name: 'diagnostics' }, hostname: 'assistant-internal.assistant', method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' }, expected: answer }),
    'guided-network-external-answer': connectivityScenario({ id: 'guided-network-external-answer', clusterId, serviceName: 'assistant-public', origin: { kind: 'external' }, method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' }, expected: answer }),
  },
  tasks: [
    support('listener', 'listener', 'Change the assistant listener to 9090, build assistant:network-v1, and apply the Deployment.', 'A build captures saved source. Changing a containerPort alone does not open the Python listener.', ['The failing hop is the captured application listener: align PORT and EXPOSE at 9090.', 'Save app.py, Dockerfile, and the named http containerPort before az acr build.'], 'A Service routes to a Pod, then the Pod process must listen on the resolved target port.', listenerReady, { steps: [file('app.py'), file('Dockerfile'), file('k8s/deployment.yaml'), ...commands(`az acr build -r ${CONNECTIVITY_REGISTRY} -t assistant:network-v1 .`, 'kubectl apply -f k8s/deployment.yaml')] }),
    support('internal-service', 'internal', 'Complete and apply the assistant-internal ClusterIP Service on port 80 to named port http.', 'Selectors use Pod labels in the same namespace. EndpointSlices show selected ready addresses; Running alone is not an API proof.', ['The required Service hop is ClusterIP, with selector app=assistant in namespace assistant.', 'Inspect ready backend addresses with kubectl get endpointslices after applying the saved file.'], 'A named targetPort resolves against each selected container port; port 80 is the Service port, not the listener port.', context => serviceReady(context, 'assistant-internal', 'ClusterIP'), { steps: [file('k8s/service-internal.yaml'), ...commands('kubectl apply -f k8s/service-internal.yaml', 'kubectl get pods -n assistant --show-labels', 'kubectl get endpointslices -n assistant -l kubernetes.io/service-name=assistant-internal -o yaml')] }, null, 'assistant-internal'),
    support('internal-route', 'internal', 'Use the supplied diagnostic Pod and verify the internal info route.', 'Short DNS names are relative to the client namespace, so diagnostics uses a qualified assistant name before HTTP reaches the Service.', ['The DNS and Service hop must resolve assistant-internal in namespace assistant.', 'Use the supplied nslookup and curl forms, then run the named Verify action.'], 'The diagnostic Pod is a fixed trainer fixture. Its commands simulate a bounded request rather than an arbitrary shell.', context => serviceReady(context, 'assistant-internal', 'ClusterIP'), { steps: [...commands('kubectl exec diagnostics -n diagnostics -- nslookup assistant-internal.assistant', 'kubectl exec diagnostics -n diagnostics -- curl -sS http://assistant-internal.assistant:80/api/info'), { kind: 'scenario', scenarioId: 'guided-network-internal' }] }, { scenarioId: 'guided-network-internal', scenarioVersion: 1 }, 'assistant-internal'),
    support('external-service', 'external', 'Complete and apply the assistant-public LoadBalancer Service with the same backend mapping.', 'The allocated 192.0.2 address is a documentation-only simulation address, not a real Azure endpoint.', ['The required external hop is a LoadBalancer Service with the assistant selector.', 'Use kubectl get services -n assistant -o wide to inspect its allocated simulation address.'], 'A LoadBalancer Service exposes a public entry point in this trainer; it still selects namespace-local Pods.', context => serviceReady(context, 'assistant-public', 'LoadBalancer'), { steps: [file('k8s/service-external.yaml'), ...commands('kubectl apply -f k8s/service-external.yaml', 'kubectl get services -n assistant -o wide')] }, null, 'assistant-public'),
    support('external-route', 'external', 'Verify GET /api/info through the allocated public Service address.', 'The external verifier resolves the declared LoadBalancer Service at run time and checks its actual selected Pod and image.', ['The required hop is the assistant-public LoadBalancer address.', 'Run the named Verify action after the public Service is applied.'], 'An external request must use the LoadBalancer address; ClusterIP names are only reachable from the simulated cluster.', context => serviceReady(context, 'assistant-public', 'LoadBalancer'), { steps: [{ kind: 'scenario', scenarioId: 'guided-network-external' }] }, { scenarioId: 'guided-network-external', scenarioVersion: 1 }, 'assistant-public'),
    support('internal-answer', 'internal', 'Verify the backups answer through the internal Service and inspect its dependency trace.', 'After routing reaches the Pod, the assistant calls deterministic embedding, PostgreSQL, and answer fixtures.', ['The required proof is POST /api/ask through assistant-internal with the backups question.', 'Use the supported curl JSON form, then run the internal answer Verify action.'], 'A successful client-to-Pod route is distinct from the application’s configured dependency calls.', context => serviceReady(context, 'assistant-internal', 'ClusterIP'), { steps: [...commands(`kubectl exec diagnostics -n diagnostics -- curl -sS -X POST -H 'Content-Type: application/json' -d '{"question":"How long are backups kept?"}' http://assistant-internal.assistant:80/api/ask`), { kind: 'scenario', scenarioId: 'guided-network-internal-answer' }] }, { scenarioId: 'guided-network-internal-answer', scenarioVersion: 1 }, 'assistant-internal'),
    support('external-answer', 'external', 'Verify the same full answer flow externally and identify its correlated application log.', 'The request log appears only after the handler runs, so a route failure cannot fabricate downstream activity.', ['The required proof is the external POST route and its training-backups response.', 'Run the external answer Verify action, then inspect kubectl logs for the selected assistant Pod.'], 'The three fixture operations are embedding, postgres-query, and answer; they occur after Service routing.', context => serviceReady(context, 'assistant-public', 'LoadBalancer'), { steps: [{ kind: 'scenario', scenarioId: 'guided-network-external-answer' }, { kind: 'inspect' }] }, { scenarioId: 'guided-network-external-answer', scenarioVersion: 1 }, 'assistant-public'),
  ],
}
