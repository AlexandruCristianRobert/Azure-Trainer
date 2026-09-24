import { describe, expect, it } from 'vitest'
import { FOUNDRY_MANIFEST, FOUNDRY_SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/foundry.js'
import { SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { getRequestScenario } from '../src/lib/simulation/requests.js'
import { foundryEvidenceDependencies } from '../src/lib/simulation/inference.js'

const appId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-api/providers/Microsoft.App/containerApps/info-api`
const accountId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-api/providers/Microsoft.CognitiveServices/accounts/foundryguided`
const valid = { kind: 'foundry', version: 1, appId,
  request: { method: 'POST', path: '/api/summarize', body: { text: 'Azure Container Apps runs the API. Foundry summarizes its input.' } },
  faultProfile: { attempts: [] }, expected: { status: 200 } }
const invalid = { kind: 'foundry', version: 1, appId,
  request: { method: 'POST', path: '/api/summarize', body: { text: '   ' } },
  faultProfile: { attempts: [] }, expected: { status: 400 } }
const lab = { id: 'foundry-engine', engineVersion: 2, contentVersion: 1, manifestId: FOUNDRY_MANIFEST.id,
  capabilities: { acrBuild: true, foundryInference: true }, initialProjectFiles: FOUNDRY_SOLUTION_FILES,
  scenarios: { valid, invalid }, tasks: [
    { id: 'valid', verification: { scenarioId: 'valid', scenarioVersion: 1 },
      dependencies: foundryEvidenceDependencies(appId),
      check: ({ runtime }) => !!runtime.deploymentsByApp[appId]?.active },
    { id: 'invalid', verification: { scenarioId: 'invalid', scenarioVersion: 1 },
      dependencies: foundryEvidenceDependencies(appId),
      check: ({ runtime }) => !!runtime.deploymentsByApp[appId]?.active },
  ] }
const command = (run, line, content = lab) => applyRunAction(run, { type: 'command', line }, content).run
const send = (run, scenarioId, content = lab) => applyRunAction(run, { type: 'request', scenarioId }, content)

function ready() {
  let run = createBehavioralRun(lab, { attemptId: 'foundry-attempt' })
  for (const line of ['az group create -n rg-api -l eastus', 'az acr create -g rg-api -n acrguided --sku Basic',
    'az identity create -g rg-api -n caller', 'az containerapp env create -g rg-api -n api-env',
    'az cognitiveservices account create -g rg-api -n foundryguided -l eastus --kind AIServices --sku S0 --custom-domain foundryguided --assign-identity --allow-project-management true',
    'az cognitiveservices account deployment create -g rg-api -n foundryguided --deployment-name summarizer-primary --model-name gpt-5-mini --model-version 2025-08-07 --model-format OpenAI --sku-capacity 10 --sku-name GlobalStandard']) run = command(run, line)
  const identity = run.sandbox.managedIdentities[0]
  const registryId = run.sandbox.containerRegistries[0].id
  run = command(run, `az role assignment create --assignee-object-id ${identity.principalId} --role AcrPull --scope ${registryId}`)
  run = command(run, 'az acr build --registry acrguided --image api:v1 --file Dockerfile .')
  run = command(run, `az containerapp create -g rg-api -n info-api --environment api-env --image acrguided.azurecr.io/api:v1 --user-assigned ${identity.id} --registry-server acrguided.azurecr.io --registry-identity ${identity.id} --env-vars AZURE_CLIENT_ID=${identity.clientId} --ingress external --target-port 8080`)
  run = command(run, `az role assignment create --assignee-object-id ${identity.principalId} --role "Cognitive Services User" --scope ${accountId}`)
  expect(run.runtime.deploymentsByApp[appId]?.active?.foundry?.principalId).toBe(identity.principalId)
  return run
}

describe('Foundry named POST inference', () => {
  it('keeps the pull identity when a second caller is attached and captures it only after redeploy', () => {
    let run = ready()
    const pull = run.sandbox.managedIdentities[0]
    const before = run.runtime.deploymentsByApp[appId].active.generation
    run = command(run, 'az identity create -g rg-api -n inference-caller')
    const inference = run.sandbox.managedIdentities.find((item) => item.name === 'inference-caller')
    run = command(run, `az containerapp identity assign -g rg-api -n info-api --user-assigned ${inference.id}`)
    expect(run.sandbox.containerApps[0].userAssigned).toEqual([pull.id, inference.id])
    expect(run.sandbox.containerApps[0].registryIdentity).toBe(pull.id)
    expect(run.runtime.deploymentsByApp[appId].active.generation).toBe(before)
    expect(run.runtime.deploymentsByApp[appId].active.foundry.principalId).toBe(pull.principalId)
    run = command(run, `az role assignment create --assignee-object-id ${inference.principalId} --role "Cognitive Services User" --scope ${accountId}`)
    run = command(run, `az containerapp update -g rg-api -n info-api --set-env-vars AZURE_CLIENT_ID=${inference.clientId}`)
    expect(run.runtime.deploymentsByApp[appId].active.generation).not.toBe(before)
    expect(run.runtime.deploymentsByApp[appId].active.foundry).toMatchObject({ identityId: inference.id, principalId: inference.principalId })
    expect(send(run, 'valid').lines.at(-1)).toMatchObject({ status: 200, upstream: { principalId: inference.principalId } })
    const deleted = command(run, 'az identity delete -g rg-api -n inference-caller --yes')
    expect(deleted.sandbox.containerApps[0].userAssigned).toBe(pull.id)
    const denied = send(deleted, 'valid')
    expect(denied.lines.at(-1).status).toBe(502)
    expect(denied.diagnostics.map((item) => item.code)).toContain('FOUNDRY_IDENTITY_MISSING')
  })
  it('clears pull selection on identity deletion and rejects the next image pull even with inference attached', () => {
    let run = ready()
    const pull = run.sandbox.managedIdentities[0]
    run = command(run, 'az identity create -g rg-api -n inference-caller')
    const inference = run.sandbox.managedIdentities.find((item) => item.name === 'inference-caller')
    run = command(run, `az containerapp identity assign -g rg-api -n info-api --user-assigned ${inference.id}`)
    run = command(run, 'az identity delete -g rg-api -n caller --yes')
    expect(run.sandbox.containerApps[0]).toMatchObject({ userAssigned: inference.id, registryIdentity: null })
    expect(run.sandbox.roleAssignments.some((item) => item.principalId === pull.principalId)).toBe(false)
    run = command(run, 'az containerapp update -g rg-api -n info-api --set-env-vars TEST_REDEPLOY=1')
    expect(run.runtime.deploymentsByApp[appId]).toMatchObject({ status: 'failed', diagnostics: [{ code: 'ACR_PULL_DENIED' }] })
  })
  it('does not activate a new revision when an identity is attached after AZURE_CLIENT_ID was set', () => {
    let run = ready()
    run = command(run, 'az identity create -g rg-api -n inference-caller')
    const inference = run.sandbox.managedIdentities.find((item) => item.name === 'inference-caller')
    run = command(run, `az containerapp update -g rg-api -n info-api --set-env-vars AZURE_CLIENT_ID=${inference.clientId}`)
    const before = run.runtime.deploymentsByApp[appId].active.generation
    expect(run.runtime.deploymentsByApp[appId].active.foundry.identityId).toBe(null)
    run = command(run, `az containerapp identity assign -g rg-api -n info-api --user-assigned ${inference.id}`)
    expect(run.runtime.deploymentsByApp[appId].active.generation).toBe(before)
    expect(run.runtime.deploymentsByApp[appId].active.foundry.identityId).toBe(null)
    run = command(run, 'az containerapp update -g rg-api -n info-api --set-env-vars REDEPLOY=1')
    expect(run.runtime.deploymentsByApp[appId].active.foundry.identityId).toBe(inference.id)
  })
  it('copies and freezes the Lab fixture; one healthy call records a real upstream attempt and native proof', () => {
    const scenario = getRequestScenario(lab, 'valid')
    expect(scenario).toEqual(valid)
    expect(scenario).not.toBe(valid)
    expect(Object.isFrozen(scenario.request.body)).toBe(true)
    const run = ready()
    const response = send(run, 'valid')
    expect(response.lines.at(-1)).toMatchObject({ status: 200, body: { deployment: 'summarizer-primary' } })
    expect(response.lines.at(-1).body.summary).toContain('Azure Container Apps')
    expect(response.lines.at(-1).upstream.attempts).toHaveLength(1)
    expect(response.lines.at(-1).upstream.attempts[0]).toMatchObject({ accountId, deployment: 'summarizer-primary',
      principalId: run.sandbox.managedIdentities[0].principalId, status: 200 })
    expect(response.run.evidence.experimentsById[response.run.evidence.currentEvidenceByTask.valid].outcome).toBe('passed')
    expect(evaluateLab(lab, response.run).tasks[0].done).toBe(true)
    expect(run.evidence.currentEvidenceByTask).toEqual({})
  })

  it('short circuits blank and oversized input with zero upstream attempts', () => {
    const run = ready()
    for (const text of ['   ', 'x'.repeat(4001)]) {
      const content = { ...lab, scenarios: { ...lab.scenarios, invalid: { ...invalid, request: { ...invalid.request, body: { text } } } } }
      const response = send(run, 'invalid', content)
      expect(response.lines.at(-1)).toMatchObject({ status: 400, upstream: { attempts: [] } })
      expect(response.run.evidence.experimentsById[response.run.evidence.currentEvidenceByTask.invalid].outcome).toBe('passed')
    }
  })

  it('returns validation 400 without earning proof until the intended inference path is ready', () => {
    const run = ready()
    const active = run.runtime.deploymentsByApp[appId].active
    const incomplete = [
      { ...run, sandbox: { ...run.sandbox, roleAssignments: run.sandbox.roleAssignments.filter((item) => item.scope !== accountId) } },
      { ...run, sandbox: { ...run.sandbox, foundryAccounts: [],
        roleAssignments: run.sandbox.roleAssignments.filter((item) => item.scope !== accountId) } },
      { ...run, sandbox: { ...run.sandbox, foundryAccounts: run.sandbox.foundryAccounts.map((account) => ({ ...account, deployments: [] })) } },
      { ...run, runtime: { ...run.runtime, deploymentsByApp: { [appId]: { ...run.runtime.deploymentsByApp[appId], active: { ...active,
        foundry: { ...active.foundry, configured: false } } } } } },
      { ...run, runtime: { ...run.runtime, deploymentsByApp: { [appId]: { ...run.runtime.deploymentsByApp[appId], active: { ...active,
        foundry: { ...active.foundry, principalId: null } } } } } },
    ]
    for (const start of incomplete) {
      const response = send(start, 'invalid')
      expect(response.lines.at(-1)).toMatchObject({ status: 400, upstream: { attempts: [] } })
      expect(response.run.evidence.experimentsById[response.run.evidence.currentEvidenceByTask.invalid].outcome).toBe('failed')
      expect(evaluateLab(lab, response.run).tasks[1].done).toBe(false)
    }
  })

  it('keeps local availability failures distinct from exhausted upstream attempts', () => {
    const run = ready()
    const noDeployment = { ...run, runtime: { ...run.runtime, deploymentsByApp: {} } }
    const unavailable = send(noDeployment, 'valid')
    expect(unavailable.lines.at(-1)).toMatchObject({ status: 502, body: { error: 'NO_ACTIVE_DEPLOYMENT' }, upstream: { attempts: [] } })
    const active = run.runtime.deploymentsByApp[appId].active
    const noIngress = { ...run, runtime: { ...run.runtime, deploymentsByApp: { [appId]: { ...run.runtime.deploymentsByApp[appId], active: { ...active, ingress: 'internal' } } } } }
    const closed = send(noIngress, 'valid')
    expect(closed.lines.at(-1)).toMatchObject({ status: 502, body: { error: 'INGRESS_UNAVAILABLE' }, upstream: { attempts: [] } })
  })

  it('rejects caller supplied text, outcomes, attempts and unknown scenarios', () => {
    const run = ready()
    for (const action of [{ type: 'request', scenarioId: 'valid', body: { text: 'forged' } },
      { type: 'request', scenarioId: 'valid', status: 200 }, { type: 'request', scenarioId: 'valid', attempts: [] },
      { type: 'request', scenarioId: 'missing' }]) {
      const result = applyRunAction(run, action, lab)
      expect(result.diagnostics[0].code).toBe('INVALID_ACTION')
      expect(result.run).toEqual(run)
    }
  })

  it('diagnoses exact account, deployment, identity and grant failures without upstream attempts', () => {
    const run = ready()
    const active = run.runtime.deploymentsByApp[appId].active
    const variants = [
      [{ ...run, runtime: { ...run.runtime, deploymentsByApp: { [appId]: { ...run.runtime.deploymentsByApp[appId], active: { ...active,
        foundry: { ...active.foundry, endpoint: 'https://other.services.ai.azure.com/openai/v1/' } } } } } }, 'FOUNDRY_ACCOUNT_NOT_FOUND'],
      [{ ...run, sandbox: { ...run.sandbox, foundryAccounts: run.sandbox.foundryAccounts.map((account) => ({ ...account, deployments: [] })) } }, 'FOUNDRY_DEPLOYMENT_NOT_FOUND'],
      [{ ...run, runtime: { ...run.runtime, deploymentsByApp: { [appId]: { ...run.runtime.deploymentsByApp[appId], active: { ...active,
        foundry: { ...active.foundry, principalId: null } } } } } }, 'FOUNDRY_IDENTITY_MISSING'],
      [{ ...run, sandbox: { ...run.sandbox, roleAssignments: run.sandbox.roleAssignments.filter((role) => role.scope !== accountId) } }, 'FOUNDRY_ACCESS_DENIED'],
    ]
    for (const [changed, code] of variants) {
      const result = send(changed, 'valid')
      expect(result.diagnostics.map((item) => item.code)).toContain(code)
      expect(result.lines.at(-1).upstream.attempts).toEqual([])
    }
  })

  it('bounds retries by attempts and deadline, honors affordable Retry-After and keeps public/upstream outcomes distinct', () => {
    const run = ready()
    const fixture = (attempts) => ({ ...lab, scenarios: { ...lab.scenarios, valid: { ...valid, faultProfile: { attempts } } } })
    const recovered = send(run, 'valid', fixture([{ status: 429, durationMs: 100, retryAfterSeconds: 2 }, { status: 503, durationMs: 100 }, { status: 200, durationMs: 100 }]))
    expect(recovered.lines.at(-1).status).toBe(200)
    expect(recovered.lines.at(-1).upstream.attempts.map((item) => item.status)).toEqual([429, 503, 200])
    expect(recovered.lines.at(-1).upstream.attempts.map((item) => item.delayAfterMs)).toEqual([2000, 2000, 0])
    expect(recovered.run.runtime.simTimeMs).toBe(4300)
    const exhausted = send(run, 'valid', fixture([{ status: 503 }, { status: 503 }, { status: 503 }]))
    expect(exhausted.lines.at(-1)).toMatchObject({ status: 503, body: { error: 'UPSTREAM_UNAVAILABLE' } })
    expect(exhausted.lines.at(-1).upstream.attempts).toHaveLength(3)
    const fallback = send(run, 'valid', fixture([{ status: 429, retryAfterSeconds: 20 }, { status: 200 }]))
    expect(fallback.lines.at(-1).status).toBe(200)
    expect(fallback.lines.at(-1).upstream.attempts).toHaveLength(2)
    expect(fallback.lines.at(-1).upstream.attempts[0].delayAfterMs).toBe(1000)
    const attemptCap = send(run, 'valid', fixture([{ status: 503, durationMs: 9000 }, { status: 200 }]))
    expect(attemptCap.lines.at(-1).status).toBe(200)
    expect(attemptCap.lines.at(-1).upstream.attempts[0]).toMatchObject({ status: 504, durationMs: 3000, delayAfterMs: 1000 })
    expect(attemptCap.run.runtime.simTimeMs).toBe(4000)
    const spent = send(run, 'valid', fixture([{ status: 503, durationMs: 3000 }, { status: 503, durationMs: 3000, retryAfterSeconds: 5 }, { status: 200, durationMs: 3000 }]))
    expect(spent.lines.at(-1).status).toBe(504)
    expect(spent.lines.at(-1).upstream.attempts).toHaveLength(3)
    expect(spent.lines.at(-1).upstream.attempts.map((attempt) => attempt.delayAfterMs)).toEqual([1000, 2000, 0])
    expect(spent.run.runtime.simTimeMs).toBe(10000)
    for (const status of [401, 403, 404]) {
      const denied = send(run, 'valid', fixture([{ status }]))
      expect(denied.lines.at(-1).upstream.attempts).toHaveLength(1)
      expect(denied.lines.at(-1).status).not.toBe(503)
    }
  })

  it('uses only the active retry policy while saved policy remains unpublished', () => {
    const run = ready()
    const active = run.runtime.deploymentsByApp[appId].active
    const oneAttempt = { ...run, runtime: { ...run.runtime, deploymentsByApp: { [appId]: {
      ...run.runtime.deploymentsByApp[appId], active: { ...active, foundry: { ...active.foundry,
        maxAttempts: 1, timeoutSeconds: 10, attemptTimeoutSeconds: 3, honorRetryAfter: false } } } } } }
    const fixture = { ...lab, scenarios: { ...lab.scenarios, valid: { ...valid,
      faultProfile: { attempts: [{ status: 429, retryAfterSeconds: 2 }, { status: 200 }] } } } }
    const first = send(oneAttempt, 'valid', fixture)
    expect(first.lines.at(-1)).toMatchObject({ status: 503, upstream: { attempts: [{ status: 429, delayAfterMs: 0 }] } })
    const saved = { ...oneAttempt, project: { ...oneAttempt.project, savedFiles: {
      ...oneAttempt.project.savedFiles, 'src/Trainer.Api/appsettings.json': JSON.stringify({
        TotalAttempts: 3, TotalBudgetSeconds: 10, AttemptTimeoutSeconds: 3, HonorRetryAfter: true }) } } }
    expect(send(saved, 'valid', fixture).lines.at(-1).upstream.attempts).toHaveLength(1)
    const threeAttempts = { ...oneAttempt, runtime: { ...oneAttempt.runtime, deploymentsByApp: { [appId]: {
      ...oneAttempt.runtime.deploymentsByApp[appId], active: { ...active, foundry: { ...active.foundry,
        maxAttempts: 3, timeoutSeconds: 10, attemptTimeoutSeconds: 3, honorRetryAfter: true } } } } } }
    const recovered = send(threeAttempts, 'valid', fixture)
    expect(recovered.lines.at(-1).status).toBe(200)
    expect(recovered.lines.at(-1).upstream.attempts.map((attempt) => attempt.delayAfterMs)).toEqual([2000, 0])
  })

  it('requires an exact diagnostic code for failed-state verification and records it as an observation', () => {
    const run = ready()
    const active = run.runtime.deploymentsByApp[appId].active
    const wrong = { ...run, runtime: { ...run.runtime, deploymentsByApp: { [appId]: {
      ...run.runtime.deploymentsByApp[appId], active: { ...active, foundry: { ...active.foundry,
        endpoint: 'https://other.services.ai.azure.com/openai/v1/' } } } } } }
    const diagnosis = { ...lab, scenarios: { ...lab.scenarios, valid: { ...valid,
      expected: { status: 502, diagnosticCode: 'FOUNDRY_ACCOUNT_NOT_FOUND' } } } }
    const observed = send(wrong, 'valid', diagnosis)
    const record = observed.run.evidence.experimentsById[observed.run.evidence.currentEvidenceByTask.valid]
    expect(record.outcome).toBe('passed')
    expect(record.measurements).toMatchObject({ observation: 'diagnostic', diagnosticCode: 'FOUNDRY_ACCOUNT_NOT_FOUND' })
    const mismatch = { ...diagnosis, scenarios: { ...diagnosis.scenarios, valid: { ...diagnosis.scenarios.valid,
      expected: { status: 502, diagnosticCode: 'FOUNDRY_DEPLOYMENT_NOT_FOUND' } } } }
    const rejected = send(wrong, 'valid', mismatch).run
    expect(rejected.evidence.experimentsById[rejected.evidence.currentEvidenceByTask.valid].outcome).toBe('failed')
  })

  it('falls back from unaffordable Retry-After and caps three slow attempts at ten seconds', () => {
    const run = ready()
    const active = run.runtime.deploymentsByApp[appId].active
    const policyRun = { ...run, runtime: { ...run.runtime, deploymentsByApp: { [appId]: {
      ...run.runtime.deploymentsByApp[appId], active: { ...active, foundry: { ...active.foundry,
        maxAttempts: 3, timeoutSeconds: 10, attemptTimeoutSeconds: 3, honorRetryAfter: true } } } } } }
    const fixture = (attempts) => ({ ...lab, scenarios: { ...lab.scenarios, valid: { ...valid,
      faultProfile: { attempts } } } })
    const fallback = send(policyRun, 'valid', fixture([{ status: 429, retryAfterSeconds: 20 }, { status: 200 }]))
    expect(fallback.lines.at(-1).status).toBe(200)
    expect(fallback.lines.at(-1).upstream.attempts[0].delayAfterMs).toBe(1000)
    const persistent = send(policyRun, 'valid', fixture([{ status: 429 }, { status: 429 }, { status: 429 }]))
    expect(persistent.lines.at(-1)).toMatchObject({ status: 503, body: { error: 'UPSTREAM_UNAVAILABLE' } })
    expect(persistent.lines.at(-1).upstream.attempts.map((attempt) => attempt.delayAfterMs)).toEqual([1000, 2000, 0])
    const deadline = send(policyRun, 'valid', fixture([{ status: 429, durationMs: 9000 },
      { status: 429, durationMs: 9000 }, { status: 429, durationMs: 9000 }]))
    expect(deadline.lines.at(-1)).toMatchObject({ status: 504, body: { error: 'UPSTREAM_DEADLINE' } })
    expect(deadline.lines.at(-1).upstream.attempts.map((attempt) => attempt.durationMs)).toEqual([3000, 3000, 1000])
    expect(deadline.run.runtime.simTimeMs).toBe(10000)
    expect(deadline.lines.at(-1).upstream.attempts.map((attempt) => attempt.startedAtMs)).toEqual([0, 4000, 9000])
  })

  it('keeps proof through draft/build/no-op and invalidates it on effective grant or deployment change', () => {
    let run = send(ready(), 'valid').run
    const settings = 'src/Trainer.Api/appsettings.json'
    run = applyRunAction(run, { type: 'draft', path: settings, text: run.project.savedFiles[settings].replace('summarizer-primary', 'other-model') }, lab).run
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    run = command(run, 'az acr build --registry acrguided --image api:v2 --file Dockerfile .')
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    run = command(run, 'az containerapp update -g rg-api -n info-api --image acrguided.azurecr.io/api:v1')
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    const principal = run.sandbox.managedIdentities[0].principalId
    const dependencyKey = `foundry:${appId}`
    const unchangedGeneration = run.dependencyGenerations[dependencyKey]
    run = command(run, `az role assignment create --assignee-object-id ${principal} --role "Cognitive Services User" --scope ${accountId}`)
    expect(run.dependencyGenerations[dependencyKey]).toBe(unchangedGeneration)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    run = command(run, `az role assignment delete --assignee-object-id ${principal} --role "Cognitive Services User" --scope ${accountId}`)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
    expect(run.dependencyGenerations[dependencyKey]).toBe((unchangedGeneration ?? 0) + 1)
    run = command(run, `az role assignment create --assignee-object-id ${principal} --role "Cognitive Services User" --scope ${accountId}`)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
    expect(run.dependencyGenerations[dependencyKey]).toBe((unchangedGeneration ?? 0) + 2)
    const before = send(ready(), 'valid').run
    expect(evaluateLab(lab, structuredClone(before)).tasks[0].done).toBe(true)
    const changed = { ...before, sandbox: { ...before.sandbox,
      foundryAccounts: before.sandbox.foundryAccounts.map((account) => ({ ...account, deployments: [] })) } }
    expect(evaluateLab(lab, changed).tasks[0].done).toBe(false)
  })

  it('preserves earned proof for unused identity attachment and stales it when selected or pull access changes', () => {
    let run = send(ready(), 'valid').run
    const key = `foundry:${appId}`
    const generation = run.dependencyGenerations[key] ?? 0
    const pull = run.sandbox.managedIdentities[0]
    run = command(run, 'az identity create -g rg-api -n unused-caller')
    const unused = run.sandbox.managedIdentities.find((item) => item.name === 'unused-caller')
    run = command(run, `az containerapp identity assign -g rg-api -n info-api --user-assigned ${unused.id}`)
    expect(run.dependencyGenerations[key] ?? 0).toBe(generation)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    run = command(run, `az role assignment delete --assignee-object-id ${pull.principalId} --role AcrPull --scope ${run.sandbox.containerRegistries[0].id}`)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
    expect(run.dependencyGenerations[key]).toBe(generation + 1)
  })

  it('bumps the active Foundry dependency when account removal also removes its grant', () => {
    const run = send(ready(), 'valid').run
    const key = `foundry:${appId}`
    const removed = command(run, 'az group delete -n rg-api --yes')
    expect(removed.dependencyGenerations[key]).toBe((run.dependencyGenerations[key] ?? 0) + 1)
    expect(evaluateLab(lab, removed).tasks[0].done).toBe(false)
  })
})
