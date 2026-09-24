const GROUP = 'rg-functions'
const STORAGE = 'stcontosofunctions'
const APP = 'func-contoso-api'
const ORIGIN = 'https://app.contoso.com'
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

function storage(sandbox) {
  if (!sandbox.resourceGroups.some((group) => same(group.name, GROUP))) return undefined
  return (sandbox.storageAccounts ?? []).find((item) => same(item.name, STORAGE) && same(item.resourceGroup, GROUP))
}

function app(sandbox) {
  const account = storage(sandbox)
  if (!account) return undefined
  return (sandbox.functionApps ?? []).find((item) => same(item.name, APP) && same(item.resourceGroup, GROUP)
    && same(item.storageAccount, account.name) && same(item.storageResourceGroup, account.resourceGroup))
}

export const functionsServerlessApiLab = {
  id: 'functions-serverless-api',
  title: 'Serverless API with Azure Functions',
  skillAreaId: 'connect',
  service: 'functions',
  minutes: 40,
  status: 'available',
  brief: "Prepare the Azure Functions host for Contoso's browser-facing API. Create its storage and Flex Consumption Function App, configure a demo application setting, and allow the Contoso frontend origin. This Lab covers hosting configuration; it does not deploy function code or serve HTTP requests.",
  seed: (sandbox) => sandbox,
  tasks: [
    {
      id: 'resource-group',
      text: 'Create a resource group named `rg-functions` in West Europe.',
      check: (sandbox) => sandbox.resourceGroups.some((group) => same(group.name, GROUP) && group.location === 'westeurope'),
      hints: [
        'Use `az group create` to group the Function App and its host storage.',
        'Set `--name rg-functions --location westeurope`.',
      ],
      solution: 'az group create --name rg-functions --location westeurope',
      examNote: 'A resource group manages the lifecycle of related resources. Its location stores resource-group metadata; each resource also has its own deployment region.',
    },
    {
      id: 'host-storage',
      text: 'Create storage account `stcontosofunctions` in `rg-functions`, in West Europe, with kind `StorageV2` and SKU `Standard_LRS`.',
      check: (sandbox) => {
        const account = storage(sandbox)
        return !!account && account.location === 'westeurope' && account.kind === 'StorageV2' && account.sku === 'Standard_LRS'
      },
      hints: [
        'Use `az storage account create`. Functions needs host storage that supports Blob, Queue and Table services.',
        'Use the required storage name and group with `--location westeurope --sku Standard_LRS --kind StorageV2`.',
      ],
      solution: 'az storage account create --name stcontosofunctions --resource-group rg-functions --location westeurope --sku Standard_LRS --kind StorageV2',
      examNote: 'A general-purpose v2 storage account supports the services required by the Functions host. Storage account names are globally unique and use 3–24 lowercase letters and digits.',
    },
    {
      id: 'function-app',
      text: 'Create Function App `func-contoso-api` in `rg-functions`, using `stcontosofunctions`, Flex Consumption in West Europe, Node.js `22` and Functions `4`.',
      check: (sandbox) => {
        const item = app(sandbox)
        return !!item && item.location === 'westeurope' && item.hostingPlan === 'FlexConsumption'
          && item.os === 'Linux' && item.runtime === 'node' && item.runtimeVersion === '22' && item.functionsVersion === '4'
      },
      hints: [
        'Use `az functionapp create`. Select Flex Consumption with `--flexconsumption-location`; it uses Linux hosting.',
        'Set `--storage-account stcontosofunctions --flexconsumption-location westeurope --runtime node --runtime-version 22 --functions-version 4`, with the required name and group.',
      ],
      solution: 'az functionapp create --name func-contoso-api --resource-group rg-functions --storage-account stcontosofunctions --flexconsumption-location westeurope --runtime node --runtime-version 22 --functions-version 4',
      examNote: 'The Function App is the hosting and configuration boundary for functions. Creating it does not deploy an HTTP-triggered function; code deployment is a separate operation.',
    },
    {
      id: 'application-setting',
      text: 'On `func-contoso-api`, set application setting `API_MESSAGE` to `Hello from Contoso`.',
      check: (sandbox) => {
        const item = app(sandbox)
        return !!item && Object.hasOwn(item.appSettings, 'API_MESSAGE') && item.appSettings.API_MESSAGE === 'Hello from Contoso'
      },
      hints: [
        'Use `az functionapp config appsettings set`. Application settings provide configuration to your function code.',
        "Pass `--settings 'API_MESSAGE=Hello from Contoso'` as one quoted argument. Use `config appsettings list` to inspect values; mutation output redacts them.",
      ],
      solution: "az functionapp config appsettings set --name func-contoso-api --resource-group rg-functions --settings 'API_MESSAGE=Hello from Contoso'",
      examNote: 'Application settings are exposed to function code as environment variables. This Task stores a public demo string; the Sandbox does not run code that reads it.',
    },
    {
      id: 'cors-policy',
      text: 'Configure `func-contoso-api` CORS to allow only `https://app.contoso.com`, with no wildcard or other origins.',
      check: (sandbox) => {
        const origins = app(sandbox)?.cors.allowedOrigins ?? []
        return origins.length === 1 && origins[0] === ORIGIN
      },
      hints: [
        'Use `az functionapp cors add` for the frontend origin. An origin contains the scheme and host, plus a port when needed; do not include a URL path.',
        'Set `--allowed-origins https://app.contoso.com`. If other origins are configured, remove them with `cors remove --allowed-origins <origin>`, or pass that flag without values to clear all before adding the required origin.',
      ],
      solution: 'az functionapp cors add --name func-contoso-api --resource-group rg-functions --allowed-origins https://app.contoso.com',
      examNote: 'CORS controls which browser origins can access responses. It does not authenticate callers or replace authorization; this Lab records the policy without sending requests.',
    },
  ],
}
