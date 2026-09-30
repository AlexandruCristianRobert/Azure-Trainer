import { RELEASE_MANIFEST, RELEASE_SOLUTION_FILES } from './releases.js'
import { DIAGNOSTICS_RUNTIME_SOURCE } from './diagnostics-runtime.js'
import { diagnosisServerSource } from './server.js'

const loggingSource = `import json
import logging
from training_diagnostics import current_request_id

# Application events are JSON messages; dependency observations and HTTP access
# output are separate evidence in the trainer.
logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("assistant.application")

def log_event(event, status=None):
    logger.info(json.dumps({"event": event, "request_id": current_request_id(), "status": status}))

`
const wrapper = `
def answer(question):
    log_event("request.started")
    response = answer_core(question)
    log_event("request.completed", response["status"])
    return response
`
const server = diagnosisServerSource(RELEASE_SOLUTION_FILES['server.py'])
const app = loggingSource + RELEASE_SOLUTION_FILES['app.py'].replace('def answer(question):', 'def answer_core(question):') + wrapper
export const DIAGNOSIS_FILES = Object.freeze({ ...RELEASE_SOLUTION_FILES,
  'app.py': app, 'server.py': server, 'training_diagnostics.py': DIAGNOSTICS_RUNTIME_SOURCE,
  Dockerfile: RELEASE_SOLUTION_FILES.Dockerfile.replace('training_health.py ', 'training_health.py training_diagnostics.py '),
})
export const DIAGNOSIS_SOLUTION_FILES = Object.freeze({ ...DIAGNOSIS_FILES })
export const DIAGNOSIS_MANIFEST = Object.freeze({ ...RELEASE_MANIFEST, id: 'aks-python-diagnosis-v1', diagnosticsVersion: 1,
  files: Object.freeze([...RELEASE_MANIFEST.files, 'training_diagnostics.py']),
  buildFiles: Object.freeze(['app.py', 'server.py', 'training_clients.py', 'training_health.py', 'training_diagnostics.py', 'retrieval.sql', 'Dockerfile']),
  fixedFiles: Object.freeze({ ...RELEASE_MANIFEST.fixedFiles, 'server.py': server, 'training_diagnostics.py': DIAGNOSTICS_RUNTIME_SOURCE }),
})
