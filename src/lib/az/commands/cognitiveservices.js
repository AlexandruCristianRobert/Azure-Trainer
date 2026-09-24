import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as foundry from '../../sandbox/foundry.js'
import { AzError } from '../../sandbox/errors.js'
import { presentFoundryAccount, presentFoundryProject, presentFoundryDeployment } from '../foundry-arm.js'

const NAME = ARG.name('Foundry account name.')
const KIND = { name: '--kind', aliases: [], required: true, kind: 'string', choices: ['AIServices'], dest: 'kind', help: 'Only AIServices is simulated.' }
const SKU = { name: '--sku', aliases: [], required: true, kind: 'string', choices: ['S0'], dest: 'sku', help: 'Only S0 is simulated.' }
const DOMAIN = { name: '--custom-domain', aliases: [], required: true, kind: 'string', dest: 'customDomain', help: 'Must match the account name in the Sandbox.' }
const ASSIGN_IDENTITY = { name: '--assign-identity', aliases: [], required: false, kind: 'flag', dest: 'assignIdentity', help: 'Assign the account project-management identity.' }
const ALLOW_PROJECT = { name: '--allow-project-management', aliases: [], required: false, kind: 'bool', dest: 'allowProjectManagement', help: 'Enable project management at creation.' }
const PROJECT_NAME = { name: '--project-name', aliases: [], required: true, kind: 'string', dest: 'projectName', help: 'Foundry project name.' }
const DEPLOYMENT_NAME = { name: '--deployment-name', aliases: [], required: true, kind: 'string', dest: 'deploymentName', help: 'Model deployment name.' }
const MODEL_NAME = { name: '--model-name', aliases: [], required: true, kind: 'string', dest: 'modelName', help: 'Simulated model: gpt-5-mini.' }
const MODEL_VERSION = { name: '--model-version', aliases: [], required: true, kind: 'string', dest: 'modelVersion', help: 'Simulated version: 2025-08-07.' }
const MODEL_FORMAT = { name: '--model-format', aliases: [], required: true, kind: 'string', choices: ['OpenAI'], dest: 'modelFormat', help: 'Only OpenAI is simulated.' }
const SKU_CAPACITY = { name: '--sku-capacity', aliases: [], required: true, kind: 'int', dest: 'skuCapacity', help: 'Simulated capacity: 10.' }
const SKU_NAME = { name: '--sku-name', aliases: [], required: true, kind: 'string', choices: ['GlobalStandard'], dest: 'skuName', help: 'Only GlobalStandard is simulated.' }
const childArgs = [NAME, ARG.resourceGroup]
const childEvent = (type, resource, account, resourceType) => event(type, resourceType, { name: resource.name, resourceGroup: account.resourceGroup, account: account.name })
const accountEvent = (type, account) => event(type, 'foundryAccount', { name: account.name, resourceGroup: account.resourceGroup })
const same = (left, right) => String(left).toLowerCase() === String(right).toLowerCase()

const project = defineGroup(['cognitiveservices', 'account', 'project'], 'Manage simulated Foundry projects.', {
  create: defineCommand(['cognitiveservices', 'account', 'project', 'create'], 'Create a Foundry project.', {
    latencyMs: LATENCY.mutate, args: [...childArgs, PROJECT_NAME, ARG.location(true)],
    run: ({ sandbox }, values) => {
      const account = foundry.getFoundryAccount(sandbox, values.resourceGroup, values.name)
      if (!same(values.location, account.location)) throw new AzError('InvalidArgumentValue', 'Project location must match its Foundry account location.')
      const { sandbox: next, resource } = foundry.createFoundryProject(sandbox, { resourceGroup: values.resourceGroup, accountName: values.name, name: values.projectName })
      return { sandbox: next, output: presentFoundryProject(resource), events: [childEvent('created', resource, account, 'foundryProject')] }
    },
  }),
  show: defineCommand(['cognitiveservices', 'account', 'project', 'show'], 'Show a Foundry project.', {
    args: [...childArgs, PROJECT_NAME],
    run: ({ sandbox }, values) => ({ sandbox, output: presentFoundryProject(foundry.getFoundryProject(sandbox, values.resourceGroup, values.name, values.projectName)) }),
  }),
  list: defineCommand(['cognitiveservices', 'account', 'project', 'list'], 'List Foundry projects.', {
    args: childArgs,
    run: ({ sandbox }, values) => ({ sandbox, output: foundry.listFoundryProjects(sandbox, values.resourceGroup, values.name).map(presentFoundryProject) }),
  }),
})

const deployment = defineGroup(['cognitiveservices', 'account', 'deployment'], 'Manage simulated Foundry deployments.', {
  create: defineCommand(['cognitiveservices', 'account', 'deployment', 'create'], 'Create a simulated model deployment.', {
    latencyMs: LATENCY.mutate, args: [...childArgs, DEPLOYMENT_NAME, MODEL_NAME, MODEL_VERSION, MODEL_FORMAT, SKU_CAPACITY, SKU_NAME],
    run: ({ sandbox }, values) => {
      if (values.skuCapacity !== 10) throw new AzError('InvalidArgumentValue', 'Only deployment capacity 10 is supported in the Sandbox.')
      const { sandbox: next, resource, account } = foundry.createFoundryDeployment(sandbox, { resourceGroup: values.resourceGroup, accountName: values.name, name: values.deploymentName, modelName: values.modelName, modelVersion: values.modelVersion, sku: values.skuName })
      return { sandbox: next, output: presentFoundryDeployment(resource), events: [childEvent('created', resource, account, 'foundryDeployment')] }
    },
  }),
  show: defineCommand(['cognitiveservices', 'account', 'deployment', 'show'], 'Show a model deployment.', {
    args: [...childArgs, DEPLOYMENT_NAME],
    run: ({ sandbox }, values) => ({ sandbox, output: presentFoundryDeployment(foundry.getFoundryDeployment(sandbox, values.resourceGroup, values.name, values.deploymentName)) }),
  }),
  list: defineCommand(['cognitiveservices', 'account', 'deployment', 'list'], 'List model deployments.', {
    args: childArgs,
    run: ({ sandbox }, values) => ({ sandbox, output: foundry.listFoundryDeployments(sandbox, values.resourceGroup, values.name).map(presentFoundryDeployment) }),
  }),
})

export const cognitiveservicesGroup = defineGroup(['cognitiveservices'], 'Manage simulated Foundry AIServices resources.', {
  account: defineGroup(['cognitiveservices', 'account'], 'Manage Foundry accounts and child resources.', {
    create: defineCommand(['cognitiveservices', 'account', 'create'], 'Create an AIServices account.', {
      latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, ARG.location(true), KIND, SKU, DOMAIN, ASSIGN_IDENTITY, ALLOW_PROJECT],
      run: ({ sandbox }, values) => {
        if (!same(values.customDomain, values.name)) throw new AzError('InvalidArgumentValue', '--custom-domain must match --name in the Sandbox.')
        const { sandbox: next, resource } = foundry.createFoundryAccount(sandbox, {
          resourceGroup: values.resourceGroup, name: values.name, location: values.location, sku: values.sku,
          identity: values.assignIdentity ? { type: 'SystemAssigned' } : null,
          allowProjectManagement: values.allowProjectManagement ?? false,
        })
        return { sandbox: next, output: presentFoundryAccount(resource), events: [accountEvent('created', resource)] }
      },
    }),
    show: defineCommand(['cognitiveservices', 'account', 'show'], 'Show a Foundry account.', {
      args: [NAME, ARG.resourceGroup],
      run: ({ sandbox }, values) => ({ sandbox, output: presentFoundryAccount(foundry.getFoundryAccount(sandbox, values.resourceGroup, values.name)) }),
    }),
    list: defineCommand(['cognitiveservices', 'account', 'list'], 'List Foundry accounts.', {
      args: [ARG.resourceGroupOptional],
      run: ({ sandbox }, values) => ({ sandbox, output: foundry.listFoundryAccounts(sandbox, values.resourceGroup ?? null).map(presentFoundryAccount) }),
    }),
    project, deployment,
  }),
})
