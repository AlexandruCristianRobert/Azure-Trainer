import { CORPUS, corpusQuestions } from '../../fixtures/data/corpus.js'
import { SUPPORT_V3_CORPUS, SUPPORT_V3_ALL_QUESTIONS } from '../../fixtures/data/corpus-v3.js'
import { POSTGRES_MANIFEST, POSTGRES_STARTER_FILES } from './postgres.js'

export const POSTGRES_V3_LOAD = '-- simulator:load-support-v3\n'
// Both protected scaffold and interpreter consume this exact authored mapping.
const training = POSTGRES_MANIFEST.fixedFiles['training_runtime.py']
  .replace(`QUESTIONS = ${JSON.stringify(corpusQuestions())}`, `QUESTIONS = ${JSON.stringify(SUPPORT_V3_ALL_QUESTIONS)}`)
  .replace(`CHUNKS = ${JSON.stringify(CORPUS.chunks)}`, `CHUNKS = ${JSON.stringify(SUPPORT_V3_CORPUS.chunks)}`)
const server = POSTGRES_MANIFEST.fixedFiles['server.py'].replace('value("language"))', 'value("language"), value("audience"))')
export const POSTGRES_INDEPENDENT_MANIFEST = Object.freeze({ ...POSTGRES_MANIFEST,
  id: 'data-python-postgres-support-v3', postgresFixture: 'support-v3',
  files: Object.freeze([...POSTGRES_MANIFEST.files, 'load-v3.sql']),
  fixedFiles: Object.freeze({ ...POSTGRES_MANIFEST.fixedFiles, 'server.py': server,
    'training_runtime.py': training, 'load-v3.sql': POSTGRES_V3_LOAD }),
})
export const POSTGRES_INDEPENDENT_FILES = Object.freeze({ ...POSTGRES_STARTER_FILES,
  'server.py': server, 'training_runtime.py': training, 'load-v3.sql': POSTGRES_V3_LOAD })
