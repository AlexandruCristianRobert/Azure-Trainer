import { HTTP_RUNTIME_FILES } from './runtime.js'

export const HTTP_MANIFEST = Object.freeze({
  id: 'http-functions-python-v1', language: 'python', runtimeFamily: 'messaging',
  files: Object.freeze(['clients.py', 'producer.py', 'worker.py', 'events.py', 'handler.py', 'function_app.py', 'host.json', 'local.settings.json', 'requirements.txt', 'training_runtime.py', 'order_store.py', 'README.md']),
  fixedFiles: HTTP_RUNTIME_FILES,
  maxFiles: 16, maxFileBytes: 128 * 1024, maxTotalBytes: 512 * 1024,
})
