import { CONFIG_MANIFEST, CONFIG_SOLUTION_FILES } from '../../templates/aks-python/configuration.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'

export const CONFIG_GROUP = 'rg-aks-config-guided'
export const CONFIG_REGISTRY = 'acraksconfigguided'
export const CONFIG_CLUSTER = 'aks-config-guided'
export const CONFIG_IMAGE = `${CONFIG_REGISTRY}.azurecr.io/assistant:configured`

export function configurationSourceReady(context) {
  const parsed = parsePythonProject(context.project.savedFiles, CONFIG_MANIFEST)
  return !parsed.diagnostics.length && parsed.appSpec?.routes?.some(route => route.method === 'POST' && route.path === '/api/ask'
    && route.response?.settings?.pg_host?.key === 'PGHOST')
}

export function configurationDeploymentReady(context) {
  const cluster = context.sandbox.aksClusters?.find(item => item.name === CONFIG_CLUSTER)
  const state = cluster && context.runtime.kubernetes?.clusters?.[cluster.id]
  const deployment = state?.resources['Deployment/assistant/assistant']
  const service = state?.resources['Service/assistant/assistant']
  const config = state?.resources['ConfigMap/assistant/assistant-config']
  const secret = state?.resources['Secret/assistant/assistant-credentials']
  const image = deployment?.spec?.template?.spec?.containers?.[0]?.image
  const artifactId = context.artifacts.publishedTags?.[CONFIG_IMAGE]
  const pods = cluster ? getDeploymentPods({ runtime: context.runtime }, cluster.id, 'assistant', 'assistant') : []
  return !!deployment && !!service && !!config && !!secret && image === CONFIG_IMAGE && !!artifactId && pods.length === 2
    && pods.every(pod => state.podSnapshots[pod.metadata.uid]?.environment?.APP_ENV === 'training')
}

export const configurationSolutionFiles = CONFIG_SOLUTION_FILES
