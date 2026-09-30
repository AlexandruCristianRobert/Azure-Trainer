import { describe, expect, it } from 'vitest'
import { parseDataApp } from '../src/lib/data/python-sdk.js'
import { runDataFunction } from '../src/lib/data/runtime.js'

const manifest = { editZones: ['get_session', 'recent'], receivers: { sessions: 'cosmos-container' } }
const files = (app, clients = 'from azure.cosmos import CosmosClient\nclient = CosmosClient(URL, credential=KEY, consistency_level="Session")\n') => ({ 'app.py': app, 'clients.py': clients })

describe('parseDataApp', () => {
  it('recognizes read_item with keyword arguments', () => {
    const r = parseDataApp(files('def get_session(session_id):\n    return sessions.read_item(item=session_id, partition_key=session_id)\n'), manifest)
    expect(r.diagnostics).toEqual([])
    const ret = r.appSpec.data.functions.get_session.body[0]
    expect(ret.value.call).toBe('cosmos.container.read_item')
    expect(r.appSpec.data.client.consistency).toBe('Session')
  })
  it('reports a missing required partition_key', () => {
    const r = parseDataApp(files('def get_session(session_id):\n    return sessions.read_item(item=session_id)\n'), manifest)
    expect(r.diagnostics[0].code).toBe('SDK_ARGUMENT')
  })
  it('recognizes list(query_items(...)) with parameters', () => {
    const src = 'def recent(user_id):\n    query = "SELECT * FROM c WHERE c.userId = @u"\n    return list(sessions.query_items(query=query, parameters=[{"name": "@u", "value": user_id}], enable_cross_partition_query=True))\n'
    expect(parseDataApp(files(src), manifest).diagnostics).toEqual([])
  })
  it('flags unsupported constructs without pretending they are Azure errors', () => {
    const r = parseDataApp(files('def recent(user_id):\n    return [x for x in range(3)]\n'), manifest)
    expect(r.diagnostics[0].code).toBe('DATA_UNSUPPORTED')
    expect(r.diagnostics[0].message).toMatch(/^Not supported by the simulator:/)
  })
  it('runs a recognized read_item against the Sandbox and charges ~1 RU', () => {
    const r = parseDataApp(files('def get_session(session_id):\n    return sessions.read_item(item=session_id, partition_key=session_id)\n'), manifest)
    const sandbox = {
      cosmosAccounts: [{
        name: 'cosmos1',
        defaultConsistencyLevel: 'Session',
        databases: [{
          name: 'assistant',
          containers: [{
            name: 'sessions',
            partitionKeyPath: '/sessionId',
            indexingPolicy: { indexingMode: 'consistent', automatic: true, includedPaths: [{ path: '/*' }], excludedPaths: [] },
            items: [{ id: 's1', sessionId: 's1', text: 'hi' }],
          }],
        }],
      }],
    }
    const result = runDataFunction({
      appSpec: r.appSpec, sandbox, account: 'cosmos1', database: 'assistant', functionName: 'get_session',
      args: ['s1'], nowMs: 1000, scenarioState: { writesThisRequest: new Set() },
    })
    expect(result.status).toBe(200)
    expect(result.calls[0].charge).toBe(1)
  })
})
