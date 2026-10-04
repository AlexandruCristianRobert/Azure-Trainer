import { ROTATION_SOLUTION_SOURCE, OLD_SECRET_VERSION } from '../../templates/security-python/security.js'
import { securityLab, securityTask, securityPaths, file, command, rotationConsumed, rotationReady, latestRotationReady } from './helpers.js'

const create = securityTask({ id: 'create-key-version', stage: 'rotation', check: rotationReady,
  text: 'Create a new notification-api-key version in kv-orders with the supplied demo-only v2 value in the Lab brief. This vault write does not change what the independent notification provider accepts. Do not enter a real credential.',
  rationale: { concept: 'Versioned rotation and provider acceptance', what: 'Creates a distinct stored version before the consumer switches to it.', why: 'Vault version creation and provider key acceptance are independent state changes.', without: 'Replacing storage alone cannot revoke an old provider credential.', csharp: 'C# SecretClient.SetSecret also creates a version; provider revocation remains a separate operation.' },
  solution: { steps: [command('az keyvault secret set --vault-name kv-orders --name notification-api-key --value trainer-demo-key-v2')] },
})
const rotate = securityTask({ id: 'consume-rotated-key', stage: 'rotation', paths: securityPaths, check: latestRotationReady,
  text: 'In worker.py read the disclosed old pinned version metadata, call advance_security_fixture() to revoke provider v1 acceptance, then retrieve the latest learner-created version and consume it successfully. Genuinely reread the old pinned version and show its provider 401. Save and run once; return only safe statuses.',
  rationale: { concept: 'Latest versus pinned secret versions', what: 'Compares actual reads and consumption after independent provider revocation.', why: 'The worker must switch to the new key while a pinned old credential stops authorizing notifications.', without: 'A pinned URI remains on the retired key even when the vault has a newer version.', csharp: 'GetSecret(name) follows latest; GetSecret(name, version) stays pinned, just as in Python.' },
  solution: { steps: [file('worker.py', ROTATION_SOLUTION_SOURCE), command('python worker.py')] },
})
export const securityRotationLab = securityLab({ stage: 'rotation', order: 3, title: 'Simulated: Rotate a version and retire provider acceptance',
  brief: `Supplied the attached identity, exact vault reader grant, learner Secrets Officer and demo v1 key. Its disclosed baseline version is ${OLD_SECRET_VERSION}. New v2 is absent; use the demo-only fixture value trainer-demo-key-v2 for your CLI creation. The private execution fixture only revokes provider v1 and accepts the authored demo v2. No seed proof is supplied.`, tasks: [create, rotate], behavior: rotationConsumed })
