import { describe, expect, it } from 'vitest'
import { INDEPENDENT_FOUNDRY_MANIFEST, INDEPENDENT_FOUNDRY_SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/foundry-independent.js'
import { SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { getRequestScenario } from '../src/lib/simulation/requests.js'
import { foundryEvidenceDependencies, simulateFoundryRequest } from '../src/lib/simulation/inference.js'

const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-api`
const appId = `${root}/providers/Microsoft.App/containerApps/info-api`
const accountId = `${root}/providers/Microsoft.CognitiveServices/accounts/foundryindependent`
const fixture = (content, attempts, status) => ({ kind: 'foundry', version: 1, appId,
  request: { method: 'POST', path: '/api/brief', body: { content } }, faultProfile: { attempts }, expected: { status } })
const scenarios = {
  valid: fixture('A short source for a brief.', [], 200),
  invalid: fixture('   ', [], 400),
  transient: fixture('Retry once.', [{ status: 429, durationMs: 100, retryAfterSeconds: 1 }, { status: 200, durationMs: 100 }], 200),
  persistent: fixture('Persistent throttling.', [{ status: 429, durationMs: 100 }, { status: 429, durationMs: 100 }, { status: 429, durationMs: 100 }], 503),
}
const lab = { id: 'brief-engine', engineVersion: 2, contentVersion: 1, manifestId: INDEPENDENT_FOUNDRY_MANIFEST.id,
  capabilities: { acrBuild: true, foundryInference: true }, initialProjectFiles: INDEPENDENT_FOUNDRY_SOLUTION_FILES,
  scenarios, tasks: Object.keys(scenarios).map((id) => ({ id, verification: { scenarioId: id, scenarioVersion: 1 },
    dependencies: foundryEvidenceDependencies(appId), check: ({ runtime }) => !!runtime.deploymentsByApp[appId]?.active })) }
const command = (run, line) => applyRunAction(run, { type: 'command', line }, lab).run
const send = (run, id, usedLab = lab) => applyRunAction(run, { type: 'request', scenarioId: id }, usedLab)

function ready() {
  let run = createBehavioralRun(lab, { attemptId: 'brief-attempt' })
  for (const line of ['az group create -n rg-api -l eastus', 'az acr create -g rg-api -n acrguided --sku Basic',
    'az identity create -g rg-api -n pull', 'az identity create -g rg-api -n inference',
    'az containerapp env create -g rg-api -n api-env',
    'az cognitiveservices account create -g rg-api -n foundryindependent -l eastus --kind AIServices --sku S0 --custom-domain foundryindependent --assign-identity --allow-project-management true',
    'az cognitiveservices account deployment create -g rg-api -n foundryindependent --deployment-name briefing-secondary --model-name gpt-5-mini --model-version 2025-08-07 --model-format OpenAI --sku-capacity 10 --sku-name GlobalStandard']) run = command(run, line)
  const [pull, inference] = run.sandbox.managedIdentities
  run = command(run, `az role assignment create --assignee-object-id ${pull.principalId} --role AcrPull --scope ${run.sandbox.containerRegistries[0].id}`)
  run = command(run, 'az acr build --registry acrguided --image api:v1 --file Dockerfile .')
  run = command(run, `az containerapp create -g rg-api -n info-api --environment api-env --image acrguided.azurecr.io/api:v1 --user-assigned ${pull.id} --registry-server acrguided.azurecr.io --registry-identity ${pull.id} --env-vars AZURE_CLIENT_ID=${inference.clientId} --ingress external --target-port 8080`)
  run = command(run, `az containerapp identity assign -g rg-api -n info-api --user-assigned ${inference.id}`)
  run = command(run, `az role assignment create --assignee-object-id ${inference.principalId} --role "Cognitive Services User" --scope ${accountId}`)
  run = command(run, 'az containerapp update -g rg-api -n info-api --set-env-vars REDEPLOY=1')
  return run
}

describe('independent named brief requests', () => {
  it('uses the active brief route and response field, and rejects caller outcomes', () => {
    const run = ready()
    expect(getRequestScenario(lab, 'valid')).toEqual(scenarios.valid)
    const result = send(run, 'valid')
    expect(result.lines.at(-1)).toMatchObject({ path: '/api/brief', status: 200,
      body: { brief: 'A short source for a brief.', deployment: 'briefing-secondary' } })
    expect(result.lines.at(-1).body).not.toHaveProperty('summary')
    expect(result.lines.at(-1).upstream.attempts).toHaveLength(1)
    expect(result.lines.at(-1).upstream.attempts[0]).toMatchObject({ accountId, deployment: 'briefing-secondary',
      principalId: run.sandbox.managedIdentities[1].principalId })
    const evidence = result.run.evidence.experimentsById[result.run.evidence.currentEvidenceByTask.valid]
    expect(evidence.measurements.path).toBe('/api/brief')
    expect(evidence.outcome).toBe('passed')
    expect(applyRunAction(run, { type: 'request', scenarioId: 'valid', body: { content: 'injected' }, status: 200 }, lab).diagnostics[0].code).toBe('INVALID_ACTION')
  })

  it.each([[2, 5, 1], [3, 8, 2]])('honors an active %i attempt, %i second, %i second-cap policy', (maxAttempts, timeoutSeconds, attemptTimeoutSeconds) => {
    const base = ready()
    const active = base.runtime.deploymentsByApp[appId].active
    const foundry = { ...active.foundry, maxAttempts, timeoutSeconds, attemptTimeoutSeconds }
    const run = { ...base, runtime: { ...base.runtime, deploymentsByApp: { ...base.runtime.deploymentsByApp,
      [appId]: { ...base.runtime.deploymentsByApp[appId], active: { ...active, foundry,
        appSpec: { ...active.appSpec, foundry: { ...active.appSpec.foundry, maxAttempts, timeoutSeconds, attemptTimeoutSeconds } } } } } } }
    const valid = send(run, 'valid')
    expect(valid.lines.at(-1).status).toBe(200)
    expect(send(run, 'invalid').lines.at(-1).upstream.attempts).toHaveLength(0)
    const transient = send(run, 'transient')
    expect(transient.lines.at(-1).status).toBe(200)
    expect(transient.lines.at(-1).upstream.attempts[0].delayAfterMs).toBe(1000)
    const persistent = send(run, 'persistent')
    expect(persistent.lines.at(-1).status).toBe(503)
    expect(persistent.lines.at(-1).upstream.attempts).toHaveLength(maxAttempts)
    expect(persistent.run.runtime.simTimeMs - run.runtime.simTimeMs).toBeLessThanOrEqual(timeoutSeconds * 1000)
    expect(evaluateLab(lab, persistent.run).tasks.find((task) => task.id === 'persistent').done).toBe(true)
  })

  it('short circuits invalid input without model access but does not earn evidence', () => {
    const run = ready()
    const denied = { ...run, sandbox: { ...run.sandbox, roleAssignments: run.sandbox.roleAssignments.filter((item) => item.scope !== accountId) } }
    const result = send(denied, 'invalid')
    expect(result.lines.at(-1)).toMatchObject({ status: 400, upstream: { attempts: [] } })
    expect(result.run.evidence.experimentsById[result.run.evidence.currentEvidenceByTask.invalid].outcome).toBe('failed')
    const active = run.runtime.deploymentsByApp[appId].active
    const badPolicy = { ...run, runtime: { ...run.runtime, deploymentsByApp: { ...run.runtime.deploymentsByApp,
      [appId]: { ...run.runtime.deploymentsByApp[appId], active: { ...active,
        foundry: { ...active.foundry, maxAttempts: 1 } } } } } }
    const rejected = send(badPolicy, 'invalid')
    expect(rejected.lines.at(-1).status).toBe(400)
    expect(rejected.run.evidence.experimentsById[rejected.run.evidence.currentEvidenceByTask.invalid].outcome).toBe('failed')
  })

  it('requires a dedicated caller and the exact Cognitive Services User account grant', () => {
    const run = ready()
    const [pull, inference] = run.sandbox.managedIdentities
    const accountGrant = run.sandbox.roleAssignments.find((item) => item.scope === accountId)
    const variants = [
      { ...run, sandbox: { ...run.sandbox, roleAssignments: run.sandbox.roleAssignments.map((item) => item === accountGrant
        ? { ...item, principalId: pull.principalId } : item) } },
      { ...run, sandbox: { ...run.sandbox, roleAssignments: run.sandbox.roleAssignments.map((item) => item === accountGrant
        ? { ...item, roleDefinitionId: '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd', roleName: 'Cognitive Services OpenAI User' } : item) } },
      { ...run, runtime: { ...run.runtime, deploymentsByApp: { ...run.runtime.deploymentsByApp,
        [appId]: { ...run.runtime.deploymentsByApp[appId], active: { ...run.runtime.deploymentsByApp[appId].active,
          foundry: { ...run.runtime.deploymentsByApp[appId].active.foundry,
            identityId: pull.id, clientId: pull.clientId, principalId: pull.principalId } } } } } },
    ]
    for (const variant of variants) {
      const result = send(variant, 'valid')
      expect(result.lines.at(-1).status).toBe(502)
      expect(result.lines.at(-1).upstream.attempts).toHaveLength(0)
    }
    expect(inference.id).not.toBe(pull.id)
  })

  it('uses bounded fallback for oversized Retry-After and never retries 401/403/404', () => {
    const run = ready()
    const altered = (attempts) => ({ ...lab, scenarios: { ...scenarios, transient: fixture('Retry once.', attempts, 200) } })
    const fallback = send(run, 'transient', altered([{ status: 429, durationMs: 100, retryAfterSeconds: 30 }, { status: 200, durationMs: 100 }]))
    expect(fallback.lines.at(-1).status).toBe(200)
    expect(fallback.lines.at(-1).upstream.attempts[0].delayAfterMs).toBe(1000)
    for (const status of [401, 403, 404]) {
      const result = send(run, 'transient', altered([{ status, durationMs: 100 }, { status: 200 }]))
      expect(result.lines.at(-1).status).toBe(502)
      expect(result.lines.at(-1).upstream.attempts).toHaveLength(1)
    }
  })

  it('projects both identities and exact grants into evidence, staling effective changes only', () => {
    let run = send(ready(), 'valid').run
    const proof = run.evidence.experimentsById[run.evidence.currentEvidenceByTask.valid]
    expect(proof.dependencyValues.appIdentity.attachedIdentityIds).toEqual(run.sandbox.containerApps[0].userAssigned)
    expect(proof.dependencyValues.registryPull).toMatchObject({ identityId: run.sandbox.managedIdentities[0].id,
      principalId: run.sandbox.managedIdentities[0].principalId })
    expect(proof.dependencyValues.appIdentity).toMatchObject({ selectedIdentityId: run.sandbox.managedIdentities[1].id,
      selectedPrincipalId: run.sandbox.managedIdentities[1].principalId })
    expect(proof.dependencyValues.foundryGrant).toHaveLength(1)
    run = command(run, 'az containerapp update -g rg-api -n info-api --image acrguided.azurecr.io/api:v1')
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    const pull = run.sandbox.managedIdentities[0]
    run = command(run, `az role assignment delete --assignee-object-id ${pull.principalId} --role AcrPull --scope ${run.sandbox.containerRegistries[0].id}`)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
  })
})
