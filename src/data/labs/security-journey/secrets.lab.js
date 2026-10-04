import { SECRET_SOLUTION_SOURCE } from '../../templates/security-python/security.js'
import { securityLab, securityTask, securityPaths, file, command, consumed } from './helpers.js'

const retrieve = securityTask({ id: 'consume-vault-secret', stage: 'secrets', paths: securityPaths,
  text: 'Write worker.py using DefaultAzureCredential and SecretClient. Retrieve notification-api-key from kv-orders and pass secret.value directly to send_notification for e-o1/o1 on email. Save and run python worker.py; return the safe provider response, never the key.',
  rationale: { concept: 'Application secret retrieval', what: 'Reads a versioned credential through the runtime identity.', why: 'The notification consumer needs the current authorized key.', without: 'A lookup alone cannot authorize notification; plaintext literals have no read provenance.', csharp: 'SecretClient.GetSecret parallels get_secret; DefaultAzureCredential follows the same identity idea.' },
  hints: ['Construct the credential and client, then pass the retrieved opaque secret.value to the consumer.'],
  solution: { steps: [file('worker.py', SECRET_SOLUTION_SOURCE), command('python worker.py')] },
})
export const securitySecretsLab = securityLab({ stage: 'secrets', order: 2, title: 'Simulated: Retrieve and consume a vault credential',
  brief: 'Supplied rg-messaging, storage/func-orders, attached id-orders, exact kv-orders Secrets User role, learner Secrets Officer and demo v1 key. Earlier identity prerequisites are configuration only. The new worker consumer is unfinished and no read or notification has run.', tasks: [retrieve], behavior: consumed })
