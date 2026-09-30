const RG = 'rg-containerapps'
const ENV = 'env-contoso'
const APP = 'ca-contoso-api'
const IMAGE = 'mcr.microsoft.com/k8se/quickstart:latest'
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

function environment(sb) {
  if (!sb.resourceGroups.some((g) => eq(g.name, RG))) return undefined
  return (sb.containerAppEnvironments ?? []).find((e) => eq(e.name, ENV) && eq(e.resourceGroup, RG))
}

function app(sb) {
  if (!environment(sb)) return undefined
  return (sb.containerApps ?? []).find((a) => eq(a.name, APP) && eq(a.resourceGroup, RG)
    && eq(a.environment, ENV) && eq(a.environmentResourceGroup, RG))
}

export const containerappsKedaLab = {
  id: 'containerapps-keda',
  title: 'Deploy a Container App with KEDA scaling',
  skillAreaId: 'containers',
  service: 'container-apps',
  minutes: 40,
  status: 'available',
  brief: "Contoso needs a containerized HTTP API that can scale down during quiet periods and scale out as requests arrive. Deploy a Container App, expose its HTTP endpoint and configure a KEDA HTTP scaling rule. This Sandbox models the configuration; it does not run containers or generate traffic.",
  seed: (sandbox) => sandbox,
  tasks: [
    {
      id: 'resource-group',
      text: 'Create a resource group named `rg-containerapps` in West Europe.',
      check: (sb) => sb.resourceGroups.some((g) => eq(g.name, RG) && g.location === 'westeurope'),
      hints: [
        'Start with `az group create`. The resource group holds the environment and app you will create next.',
        'Use `--name rg-containerapps` and `--location westeurope`. You can set a default group later with `az configure --defaults group=rg-containerapps`.',
      ],
      solution: 'az group create --name rg-containerapps --location westeurope',
      examNote: 'A resource group groups resources for management and lifecycle operations. Its location stores resource group metadata; each resource also has its own location.',
    },
    {
      id: 'environment',
      text: 'Create a Container Apps environment named `env-contoso` in `rg-containerapps`, in West Europe.',
      check: (sb) => environment(sb)?.location === 'westeurope',
      hints: [
        'An environment provides the boundary in which Container Apps run. Use the `az containerapp env` command group.',
        'Run `az containerapp env create` with `--name env-contoso`, `--resource-group rg-containerapps` and `--location westeurope`.',
      ],
      solution: 'az containerapp env create --name env-contoso --resource-group rg-containerapps --location westeurope',
      examNote: 'A Container Apps environment is a secure boundary around one or more apps. Apps in the same environment share its networking and logging configuration.',
    },
    {
      id: 'container-app',
      text: 'Deploy `ca-contoso-api` in `rg-containerapps` and `env-contoso`, using `mcr.microsoft.com/k8se/quickstart:latest`, external ingress and target port `80`.',
      check: (sb) => {
        const a = app(sb)
        return !!a && a.image === IMAGE && a.ingress === 'external' && a.targetPort === 80
      },
      hints: [
        'Use `az containerapp create` to connect an image to an environment. Ingress exposes the app, and the target port must match the port the container listens on.',
        'Include `--environment env-contoso --image mcr.microsoft.com/k8se/quickstart:latest --ingress external --target-port 80`, plus the app name and resource group.',
      ],
      solution: 'az containerapp create --name ca-contoso-api --resource-group rg-containerapps --environment env-contoso --image mcr.microsoft.com/k8se/quickstart:latest --ingress external --target-port 80',
      examNote: 'External ingress accepts requests from outside the Container Apps environment. The target port is the container port to which ingress forwards traffic; it is not the public HTTPS port.',
    },
    {
      id: 'replica-limits',
      text: 'Configure `ca-contoso-api` with a minimum of `0` replicas and a maximum of `5` replicas.',
      check: (sb) => {
        const a = app(sb)
        return !!a && a.minReplicas === 0 && a.maxReplicas === 5
      },
      hints: [
        'Minimum replicas controls the floor; maximum replicas caps scale out. Use `az containerapp update` to change an existing app.',
        'Add `--min-replicas 0 --max-replicas 5` to `az containerapp update --name ca-contoso-api --resource-group rg-containerapps`.',
      ],
      solution: 'az containerapp update --name ca-contoso-api --resource-group rg-containerapps --min-replicas 0 --max-replicas 5',
      examNote: 'A minimum of zero permits scale to zero when the app is idle. A higher minimum keeps replicas ready, while the maximum bounds how far the app can scale out.',
    },
    {
      id: 'http-scaling',
      text: 'Add an HTTP scaling rule named `http-requests` to `ca-contoso-api` with a concurrent requests threshold of `50`.',
      check: (sb) => (app(sb)?.scaleRules ?? []).some((rule) => eq(rule.name, 'http-requests')
        && rule.http?.metadata?.concurrentRequests === '50'),
      hints: [
        'Container Apps uses KEDA for autoscaling. For this HTTP API, configure an HTTP rule based on concurrent requests.',
        'Use `az containerapp update` with `--scale-rule-name http-requests --scale-rule-type http --scale-rule-http-concurrency 50`. Inspect the resulting configuration with `az containerapp show`.',
      ],
      solution: 'az containerapp update --name ca-contoso-api --resource-group rg-containerapps --scale-rule-name http-requests --scale-rule-type http --scale-rule-http-concurrency 50',
      examNote: 'An HTTP scale rule uses concurrent requests to determine replica demand. The threshold is per replica, and scale out remains bounded by the configured maximum replica count.',
    },
  ],
}
