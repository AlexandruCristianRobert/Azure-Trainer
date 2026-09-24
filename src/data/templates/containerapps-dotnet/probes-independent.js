import { PROBE_MANIFEST, PROBE_STARTER_FILES, PROBE_SOLUTION_FILES, probeConfiguration } from './probes.js'

const helperPath = 'src/Trainer.Api/HealthState.cs'
const yamlPath = 'containerapp.yaml'
const oldStartup = 'TimeSpan.FromSeconds(20)'

if (PROBE_MANIFEST.fixedFiles[helperPath].split(oldStartup).length !== 2) {
  throw new Error('Expected exactly one fixed 20-second probe startup helper')
}

const healthState = PROBE_MANIFEST.fixedFiles[helperPath].replace(oldStartup, 'TimeSpan.FromSeconds(30)')
const initialConfig = probeConfiguration({ appName: 'api', image: 'acrprobesindependent.azurecr.io/api:v1', probes: [] })
const independentFiles = (files) => Object.freeze({ ...files, [helperPath]: healthState, [yamlPath]: initialConfig })

export const INDEPENDENT_PROBE_MANIFEST = Object.freeze({ ...PROBE_MANIFEST,
  id: 'containerapps-dotnet-probes-independent-v1',
  fixedFiles: Object.freeze({ ...PROBE_MANIFEST.fixedFiles, [helperPath]: healthState }),
})
export const INDEPENDENT_PROBE_STARTER_FILES = independentFiles(PROBE_STARTER_FILES)
export const INDEPENDENT_PROBE_SOLUTION_FILES = independentFiles(PROBE_SOLUTION_FILES)
