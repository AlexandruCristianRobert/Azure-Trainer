import { defineCommand, defineGroup, ARG, LATENCY } from '../tree.js'
import { AzError } from '../../sandbox/errors.js'
import { getResourceGroup } from '../../sandbox/ops.js'
import { getProjectManifest } from '../../project/manifests.js'
import { compileBicepProject } from '../../bicep/compile.js'
import { previewBicepDeployment } from '../../bicep/preview.js'
import { applyBicepDeployment } from '../../bicep/deploy.js'
import { bicepTargetKey, latestBicepAttempt } from '../../bicep/provenance.js'
import { bicepRootPath } from '../../bicep/parser.js'
import { bicepSourceTuple } from '../../bicep/source.js'

const TEMPLATE = 'infra/main.bicep'
const PARAMETERS = 'infra/first.bicepparam'
const NAME = ARG.name('Deployment name within the resource group.')
const GROUP = { ...ARG.resourceGroup, defaultsKey: undefined }
const TEMPLATE_ARG = { name: '--template-file', aliases: [], required: true, kind: 'string', dest: 'templateFile', help: 'Saved local template: infra/main.bicep.' }
const PARAMETERS_ARG = { name: '--parameters', aliases: [], required: true, kind: 'string', dest: 'parameters', help: 'Saved local parameter file: infra/first.bicepparam.' }
const args = [NAME, GROUP, TEMPLATE_ARG, PARAMETERS_ARG]

export function bicepCommandSource(run, parameterPath = PARAMETERS) {
  return bicepSourceTuple(run, parameterPath)
}

export function bicepTargetFor(lab, resourceGroup, name, parameterPath) {
  const targets = lab?.bicepTargets
  if (!Array.isArray(targets)) return parameterPath === PARAMETERS ? { parameterPath, resourceGroup, deploymentName: name } : null
  return targets.find(target => target.parameterPath === parameterPath
    && target.resourceGroup?.toLowerCase() === resourceGroup?.toLowerCase()
    && target.deploymentName?.toLowerCase() === name?.toLowerCase()) ?? null
}

function prepared(sandbox, context, values) {
  if (context?.lab?.capabilities?.bicepDeployment !== true || !context?.run?.project
    || !getProjectManifest(context.run.project.manifestId).bicepFiles) {
    throw new AzError('UnsupportedOperation', 'Deployment group commands require a Bicep Lab run.', { kind: 'cli' })
  }
  const manifest = getProjectManifest(context.run.project.manifestId)
  if (!manifest.bicepFiles.includes(values.parameters)
    || values.templateFile !== bicepRootPath(manifest, values.parameters)) {
    throw new AzError('UnsupportedOperation', 'Only manifest-listed saved local Bicep files are supported.', { kind: 'cli' })
  }
  if (!values.name || values.name.length > 512)
    throw new AzError('InvalidDeploymentName', 'A deployment name of at most 512 characters is required.', { kind: 'cli' })
  const group = getResourceGroup(sandbox, values.resourceGroup)
  const target = bicepTargetFor(context.lab, group.name, values.name, values.parameters)
  if (!target || (target.templatePath ?? TEMPLATE) !== values.templateFile)
    throw new AzError('UnsupportedOperation', 'The parameter file does not match the declared deployment target.', { kind: 'cli' })
  const compiled = compileBicepProject(context.run.project.savedFiles,
    manifest, { resourceGroup: group, parameterPath: values.parameters })
  if (compiled.diagnostics.length) throwFailure('BicepValidationFailed', compiled.diagnostics)
  const source = bicepCommandSource(context.run, values.parameters)
  return { graph: compiled.graph, source, group, parameterPath: values.parameters }
}

function throwFailure(code, diagnostics) {
  const error = new AzError(code, diagnostics.map(item => `${item.path}:${item.line}:${item.column} ${item.code}: ${item.message}`).join('; '), { kind: 'cli' })
  error.diagnostics = diagnostics
  throw error
}

function runOperation(verb) {
  return ({ sandbox, context }, values) => {
    const { graph, source, group, parameterPath } = prepared(sandbox, context, values)
    const selected = Array.isArray(context.lab?.bicepTargets) ? { parameterPath,
      ...(context.lab?.capabilities?.bicepDeployment && context.run.project.manifestId
        && getProjectManifest(context.run.project.manifestId).bicepRoots ? { templatePath: source.templatePath } : {}) } : {}
    const options = { name: values.name, ...source, ...selected }
    if (verb === 'validate') {
      const checked = previewBicepDeployment(graph, sandbox, context.run.artifacts, context.lab, context.run)
      if (checked.diagnostics.length) throwFailure('BicepValidationFailed', checked.diagnostics)
      return { sandbox, output: { status: 'succeeded', target: group.name, name: values.name, outputs: graph.outputs },
        effects: [{ type: 'bicep-observation', kind: 'validate', name: values.name, resourceGroup: group.name, ...selected }] }
    }
    if (verb === 'what-if') {
      const preview = previewBicepDeployment(graph, sandbox, context.run.artifacts, context.lab, context.run)
      if (preview.diagnostics.length) throwFailure('BicepPreviewFailed', preview.diagnostics)
      const record = { id: `bicep-preview-${context.run.runtime.bicep.nextPreview}`,
        key: bicepTargetKey(group.name, values.name), target: group.name, name: values.name,
        ...source, ...selected, ...(Array.isArray(context.lab?.bicepTargets) ? { sequence: context.run.nextSequence } : {}),
        operations: preview.operations.map(({ id, type, name, changeType }) => ({ id, type, name, changeType })) }
      return { sandbox, output: record, effects: [{ type: 'bicep-preview', name: values.name, resourceGroup: group.name, ...selected }] }
    }
    const applied = applyBicepDeployment(context.run, graph, options, context.lab)
    return { sandbox, output: applied.record, effects: [{ type: 'bicep-deployment', graph, options }] }
  }
}

export const deploymentGroup = defineGroup(['deployment'], 'Manage saved local Bicep deployments in the Sandbox.', {
  group: defineGroup(['deployment', 'group'], 'Validate, preview, apply and inspect a resource-group deployment.', {
    validate: defineCommand(['deployment', 'group', 'validate'], 'Validate a saved Bicep deployment.', {
      args, run: runOperation('validate'), latencyMs: LATENCY.read,
    }),
    'what-if': defineCommand(['deployment', 'group', 'what-if'], 'Preview changes from saved Bicep files.', {
      args, run: runOperation('what-if'), latencyMs: LATENCY.read,
    }),
    create: defineCommand(['deployment', 'group', 'create'], 'Apply a saved Bicep deployment incrementally.', {
      args, run: runOperation('create'), latencyMs: LATENCY.mutate,
    }),
    show: defineCommand(['deployment', 'group', 'show'], 'Show the latest attempt for a deployment name and group.', {
      args: [NAME, GROUP], run: ({ sandbox, context }, values) => {
        if (context?.lab?.capabilities?.bicepDeployment !== true || !context?.run?.runtime?.bicep)
          throw new AzError('UnsupportedOperation', 'Deployment history is available only in a Bicep Lab.', { kind: 'cli' })
        const attempt = latestBicepAttempt(context.run.runtime.bicep, values.resourceGroup, values.name)
        if (!attempt) throw new AzError('DeploymentNotFound', `Deployment '${values.name}' was not found in '${values.resourceGroup}'.`, { kind: 'cli' })
        return { sandbox, output: attempt, effects: [{ type: 'bicep-observation', kind: 'show', name: values.name,
          resourceGroup: values.resourceGroup, ...(attempt.parameterPath ? { parameterPath: attempt.parameterPath } : {}),
          ...(attempt.templatePath ? { templatePath: attempt.templatePath } : {}) }] }
      },
    }),
  }),
})
