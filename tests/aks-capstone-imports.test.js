import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'

describe('AKS capstone module initialization', () => {
  for (const first of ['src/data/labs/aks-journey/capstone.lab.js', 'src/lib/labEngine/actions.js']) {
    it(`initializes native ESM with ${first} first`, () => {
      const root = new URL('../', import.meta.url)
      const script = `
        await import(${JSON.stringify(new URL(first, root).href)});
        const helpers = await import(${JSON.stringify(new URL('src/data/labs/aks-journey/capstone-helpers.js', root).href)});
        const incident = await import(${JSON.stringify(new URL('src/lib/kubernetes/capstone/incident.js', root).href)});
        if (helpers.CAPSTONE_IMAGE !== 'acrakscapstone.azurecr.io/assistant:capstone-v1'
          || incident.CAPSTONE_V2_IMAGE !== 'acrakscapstone.azurecr.io/assistant:capstone-v2'
          || incident.CAPSTONE_INCIDENT_FILES['k8s/hpa.yaml'] !== '# HPA exercise complete; final deployment uses two fixed replicas.\\n')
          throw new Error('Capstone constants were captured before initialization');
      `
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 })
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
    })
  }
})
