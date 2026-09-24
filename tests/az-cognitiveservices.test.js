import { describe, expect, it } from 'vitest'
import { runLine } from '../src/lib/az/shell.js'
import { createSandbox, SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'

const out = (result) => result.lines.filter((line) => line.kind === 'out').map((line) => line.text).join('\n')
const err = (result) => result.lines.filter((line) => line.kind === 'err').map((line) => line.text).join('\n')
const json = (result) => JSON.parse(out(result))
const accountId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-ai/providers/Microsoft.CognitiveServices/accounts/aiguided`
const group = () => runLine(createSandbox(), 'az group create -n rg-ai -l eastus').sandbox
const accountCommand = 'az cognitiveservices account create -g rg-ai -n aiguided -l eastus --kind AIServices --sku S0 --custom-domain aiguided --assign-identity --allow-project-management true'
const account = () => runLine(group(), accountCommand).sandbox

describe('Foundry CLI', () => {
  it('creates and inspects an AIServices account with its management identity', () => {
    const created = runLine(group(), accountCommand)
    expect(err(created)).toBe('')
    expect(json(created)).toMatchObject({ id: accountId, kind: 'AIServices', sku: { name: 'S0' }, identity: { type: 'SystemAssigned' }, properties: { endpoint: 'https://aiguided.services.ai.azure.com/openai/v1/', provisioningState: 'Succeeded', allowProjectManagement: true } })
    expect(json(runLine(created.sandbox, 'az cognitiveservices account show -g rg-ai -n aiguided')).id).toBe(accountId)
    expect(json(runLine(created.sandbox, 'az cognitiveservices account list -g rg-ai'))).toHaveLength(1)
    expect(json(runLine(created.sandbox, 'az cognitiveservices account list'))).toHaveLength(1)
  })

  it('requires account management flags before a project can be created', () => {
    for (const suffix of ['--assign-identity', '--allow-project-management true', '']) {
      const created = runLine(group(), `az cognitiveservices account create -g rg-ai -n aiguided -l eastus --kind AIServices --sku S0 --custom-domain aiguided ${suffix}`)
      expect(err(created)).toBe('')
      const project = runLine(created.sandbox, 'az cognitiveservices account project create -g rg-ai -n aiguided --project-name api-project -l eastus')
      expect(err(project)).toContain('project management')
      expect(project.sandbox).toBe(created.sandbox)
    }
  })

  it('creates and inspects a project with a distinct project endpoint', () => {
    const created = runLine(account(), 'az cognitiveservices account project create -g rg-ai -n aiguided --project-name api-project -l eastus')
    expect(err(created)).toBe('')
    expect(json(created)).toMatchObject({ id: `${accountId}/projects/api-project`, name: 'api-project', properties: { provisioningState: 'Succeeded', endpoints: { 'AI Foundry API': 'https://aiguided.services.ai.azure.com/api/projects/api-project' } } })
    expect(json(created).properties.endpoints['AI Foundry API']).not.toBe(json(runLine(created.sandbox, 'az cognitiveservices account show -g rg-ai -n aiguided')).properties.endpoint)
    expect(json(runLine(created.sandbox, 'az cognitiveservices account project show -g rg-ai -n aiguided --project-name api-project')).id).toBe(`${accountId}/projects/api-project`)
    expect(json(runLine(created.sandbox, 'az cognitiveservices account project list -g rg-ai -n aiguided'))).toHaveLength(1)
  })

  it('creates and inspects only the bounded model deployment profile', () => {
    const line = 'az cognitiveservices account deployment create -g rg-ai -n aiguided --deployment-name gpt-5-mini --model-name gpt-5-mini --model-version 2025-08-07 --model-format OpenAI --sku-capacity 10 --sku-name GlobalStandard'
    const created = runLine(account(), line)
    expect(err(created)).toBe('')
    expect(json(created)).toMatchObject({ id: `${accountId}/deployments/gpt-5-mini`, name: 'gpt-5-mini', properties: { model: { name: 'gpt-5-mini', version: '2025-08-07', format: 'OpenAI' }, provisioningState: 'Succeeded' }, sku: { name: 'GlobalStandard', capacity: 10 } })
    expect(json(runLine(created.sandbox, 'az cognitiveservices account deployment show -g rg-ai -n aiguided --deployment-name gpt-5-mini')).name).toBe('gpt-5-mini')
    expect(json(runLine(created.sandbox, 'az cognitiveservices account deployment list -g rg-ai -n aiguided'))).toHaveLength(1)
  })

  it('keeps deployment names independent of the gpt-5-mini model name', () => {
    const created = runLine(account(), 'az cognitiveservices account deployment create -g rg-ai -n aiguided --deployment-name summarizer-primary --model-name gpt-5-mini --model-version 2025-08-07 --model-format OpenAI --sku-capacity 10 --sku-name GlobalStandard')
    expect(err(created)).toBe('')
    expect(json(created)).toMatchObject({ id: `${accountId}/deployments/summarizer-primary`, name: 'summarizer-primary', properties: { model: { name: 'gpt-5-mini' } } })
    expect(json(runLine(created.sandbox, 'az cognitiveservices account deployment show -g rg-ai -n aiguided --deployment-name summarizer-primary')).name).toBe('summarizer-primary')
    expect(json(runLine(created.sandbox, 'az cognitiveservices account deployment list -g rg-ai -n aiguided'))[0].name).toBe('summarizer-primary')
  })

  it('keeps rejected CLI forms and wrong resources atomic', () => {
    const base = account()
    for (const line of [
      'az cognitiveservices account create -g rg-ai -n otherai -l eastus --kind OpenAI --sku S0 --custom-domain otherai',
      'az cognitiveservices account create -g rg-ai -n otherai -l eastus --kind AIServices --sku S0 --custom-domain wrong',
      'az cognitiveservices account project create -g rg-ai -n aiguided --project-name project2 -l westus',
      'az cognitiveservices account deployment create -g rg-ai -n aiguided --deployment-name summarizer-primary --model-name gpt-5 --model-version 2025-08-07 --model-format OpenAI --sku-capacity 10 --sku-name GlobalStandard',
      'az cognitiveservices account deployment create -g rg-ai -n aiguided --deployment-name gpt-5-mini --model-name gpt-5-mini --model-version 2025-08-07 --model-format OpenAI --sku-capacity 9 --sku-name GlobalStandard',
      'az cognitiveservices account project show -g rg-ai -n missing --project-name project2',
    ]) {
      const result = runLine(base, line)
      expect(err(result)).not.toBe('')
      expect(result.sandbox).toBe(base)
    }
  })

  it('grants and revokes the app identity at the exact account scope', () => {
    const identity = runLine(account(), 'az identity create -g rg-ai -n app-id').sandbox
    const principalId = json(runLine(identity, 'az identity show -g rg-ai -n app-id')).principalId
    expect(principalId).not.toBe(identity.foundryAccounts[0].identity.principalId)
    const line = `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role 'Cognitive Services User' --scope ${accountId}`
    const granted = runLine(identity, line)
    expect(err(granted)).toBe('')
    expect(json(granted)).toMatchObject({ principalId, scope: accountId, roleDefinitionName: 'Cognitive Services User' })
    expect(json(runLine(granted.sandbox, `az role assignment list --scope ${accountId} --role 'Cognitive Services User'`))).toHaveLength(1)
    expect(runLine(granted.sandbox, line).sandbox.roleAssignments).toHaveLength(1)
    const revoked = runLine(granted.sandbox, `az role assignment delete --assignee-object-id ${principalId} --role 'Cognitive Services User' --scope ${accountId}`)
    expect(err(revoked)).toBe('')
    expect(revoked.sandbox.roleAssignments).toEqual([])
  })

  it('rejects wrong Foundry scope, role, principal and principal type atomically', () => {
    const base = runLine(account(), 'az identity create -g rg-ai -n app-id').sandbox
    const principalId = base.managedIdentities[0].principalId
    for (const line of [
      `az role assignment create --assignee-object-id ${principalId} --role AcrPull --scope ${accountId}`,
      `az role assignment create --assignee-object-id ${principalId} --role 'Cognitive Services User' --scope ${accountId}/projects/api-project`,
      `az role assignment create --assignee-object-id 00000000-0000-4000-8000-000000000000 --role 'Cognitive Services User' --scope ${accountId}`,
      `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type User --role 'Cognitive Services User' --scope ${accountId}`,
    ]) {
      const result = runLine(base, line)
      expect(err(result)).not.toBe('')
      expect(result.sandbox).toBe(base)
    }
    expect(err(runLine(base, `az role assignment create --assignee-object-id ${principalId} --role 'Cognitive Services User' --scope ${accountId}/projects/api-project`))).toContain('account scope')
  })
})
