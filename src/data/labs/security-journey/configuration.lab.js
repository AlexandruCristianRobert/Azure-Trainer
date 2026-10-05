import { CONFIGURATION_SOLUTION_SOURCE } from '../../templates/security-python/security.js'
import { securityLab, securityTask, securityPaths, file, command, selectedConsumption, configurationReady, securityStore } from './helpers.js'

const select = securityTask({ id: 'configure-production-channel', stage: 'configuration',
  text: 'Set Orders:Channel with label production to email in ac-orders. The development channel remains console; setting a different label does not select production.',
  rationale: { concept: 'Labeled application configuration', what: 'Configures a specific key/label pair for the notification environment.', why: 'Production and development settings can share a key without sharing behavior.', without: 'An unlabeled or development write does not change the production selection.', csharp: 'C# configuration selectors also distinguish key filters and labels.' },
  check: context => securityStore(context.sandbox)?.settings.some(setting => setting.key === 'Orders:Channel' && setting.label === 'production' && setting.value === 'email') === true,
  solution: { steps: [command('az appconfig kv set -n ac-orders --key Orders:Channel --label production --value email --yes')] },
})
const configure = securityTask({ id: 'consume-selected-configuration', stage: 'configuration', paths: securityPaths, check: configurationReady,
  text: 'Write worker.py to load Orders:* with label production from ac-orders through the attached identity, resolving Orders:ApiKey with keyvault_credential. Send e-o1/o1 using actual config["Orders:ApiKey"] and config["Orders:Channel"]. Save and run python worker.py.',
  rationale: { concept: 'Configuration selection and Key Vault references', what: 'Consumes a selected labeled channel and a resolved versionless vault reference.', why: 'The application separates ordinary deployment settings from private credentials.', without: 'Reading a store without consuming its selected values cannot prove configuration behavior.', csharp: 'C# App Configuration selection and Key Vault resolution follow the same separation; Python load returns a provider mapping.' },
  solution: { steps: [file('worker.py', CONFIGURATION_SOLUTION_SOURCE), command('python worker.py')] },
})
export const securityConfigurationLab = securityLab({ stage: 'configuration', order: 4, title: 'Simulated: Select production settings and resolve a vault reference',
  brief: 'Supplied earlier identity/vault prerequisites and ac-orders with exact application Data Reader, production/development Orders:ApiKey versionless references, production/development channel console and production sentinel 1. The new production email write and selected configuration consumer are unfinished. No prior proof is supplied.', tasks: [select, configure], behavior: selectedConsumption })
