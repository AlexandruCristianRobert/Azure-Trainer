import { FOUNDRY_MANIFEST, FOUNDRY_STARTER_FILES } from './foundry.js'
import { SOLUTION_FILES } from './starter.js'
import { TROUBLESHOOTING_FOUNDRY_PROGRAM } from './foundry-troubleshooting.js'

const api = 'src/Trainer.Api'

// The fixed source shape is a supported simulation fixture, not executed learner code.
// The learner can choose bounded policy values in appsettings.json.
export const INDEPENDENT_FOUNDRY_PROGRAM = TROUBLESHOOTING_FOUNDRY_PROGRAM
  .replaceAll('/api/summarize', '/api/brief')
  .replaceAll('SummarizeRequest', 'BriefRequest')
  .replaceAll('Text', 'Content')
  .replaceAll('GetOutputContent()', 'GetOutputText()')
  .replaceAll(/\btext\b/g, 'content')
  .replaceAll('summary =', 'brief =')
  .replaceAll('maxAttempts < 1', 'maxAttempts < 2')
  .replaceAll('totalBudgetSeconds < 1', 'totalBudgetSeconds < 5')
  .replaceAll('totalBudgetSeconds > 10', 'totalBudgetSeconds > 8')
  .replaceAll('attemptTimeoutSeconds > 3', 'attemptTimeoutSeconds > 2')

export const INDEPENDENT_FOUNDRY_MANIFEST = Object.freeze({ ...FOUNDRY_MANIFEST,
  id: 'containerapps-dotnet-foundry-independent-v1', foundryIndependent: true })

export const INDEPENDENT_FOUNDRY_STARTER_FILES = Object.freeze({ ...FOUNDRY_STARTER_FILES,
  [`${api}/Program.cs`]: SOLUTION_FILES[`${api}/Program.cs`],
  [`${api}/appsettings.json`]: SOLUTION_FILES[`${api}/appsettings.json`],
})

export const INDEPENDENT_FOUNDRY_SOLUTION_FILES = Object.freeze({ ...INDEPENDENT_FOUNDRY_STARTER_FILES,
  [`${api}/Program.cs`]: INDEPENDENT_FOUNDRY_PROGRAM,
  [`${api}/appsettings.json`]: `${JSON.stringify({ ListeningPort: 8080,
    FoundryEndpoint: 'https://foundryindependent.services.ai.azure.com/openai/v1/',
    FoundryDeployment: 'briefing-secondary', TotalAttempts: 3, TotalBudgetSeconds: 8,
    AttemptTimeoutSeconds: 2, HonorRetryAfter: true }, null, 2)}\n`,
})
