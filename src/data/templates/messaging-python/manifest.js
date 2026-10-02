import { MESSAGING_RUNTIME_FILES } from './runtime.js'

export const MESSAGING_MANIFEST = Object.freeze({
  id: 'messaging-python-v1', language: 'python', runtimeFamily: 'messaging',
  files: Object.freeze(['clients.py', 'producer.py', 'worker.py', 'events.py', 'handler.py', 'function_app.py', 'host.json', 'local.settings.json', 'requirements.txt', 'training_runtime.py', 'README.md']),
  fixedFiles: MESSAGING_RUNTIME_FILES,
  maxFiles: 16, maxFileBytes: 128 * 1024, maxTotalBytes: 512 * 1024,
})
