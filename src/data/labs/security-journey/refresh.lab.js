import { REFRESH_SOLUTION_SOURCE } from '../../templates/security-python/security.js'
import { securityLab, securityTask, securityPaths, file, command, refreshConsumed, configurationReady } from './helpers.js'

const refresh = securityTask({ id: 'refresh-existing-provider', stage: 'refresh', paths: securityPaths, check: configurationReady,
  text: 'In one worker.py execution load production Orders:* once, watch Orders:Sentinel, set refresh_interval=30 and secret_refresh_interval=60, and consume the initial values. Advance the disclosed fixture, call config.refresh(), and consume changed channel/key. Advance again, refresh the same provider, and consume a new secret while channel/sentinel stay unchanged. Save and run once.',
  rationale: { concept: 'Sentinel and independent secret refresh', what: 'Refreshes one existing provider after elapsed logical intervals and consumes the new cached values.', why: 'Setting revision changes and versionless secret rotation have independent refresh triggers.', without: 'A cached provider retains old values; reloading a new provider does not demonstrate refreshing the existing cache.', csharp: 'Python config.refresh() parallels refreshing the existing C# provider. Secret-refresh timing is independent of a sentinel-triggered settings reload.' },
  hints: ['Call refresh() explicitly after each fixture advance. A new load or a new command cannot prove this same-provider exercise.'],
  solution: { steps: [file('worker.py', REFRESH_SOLUTION_SOURCE), command('python worker.py')] },
})
export const securityRefreshLab = securityLab({ stage: 'refresh', order: 5, title: 'Simulated: Refresh a live configuration cache and rotating secret',
  brief: 'Supplied earlier identity/vault/store grants and production email, versionless Orders:ApiKey, sentinel 1. In this execution only, fixture step 1 advances 60 seconds, changes channel to sms and sentinel to 2, and privately rotates the accepted key to v2. Step 2 advances another 60 seconds and rotates only the accepted secret to v3. Both fixture steps are trainer controls, never network calls or seeded proof. The new refresh source is unfinished.', tasks: [refresh], behavior: refreshConsumed })
