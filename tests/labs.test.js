import { describe, expect, it } from 'vitest'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'
import { LABS, labById } from '../src/data/labs/index.js'
import { SKILL_AREAS, skillAreaById } from '../src/data/skillAreas.js'
import { SERVICES, HOME_SERVICES } from '../src/data/services.js'

function apply(sb, solution) {
  for (const line of solution.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const r = runLine(sb, line)
    const errors = r.lines.filter((l) => l.kind === 'err')
    if (errors.length) throw new Error(`solution failed: ${line}\n${errors.map((e) => e.text).join('\n')}`)
    sb = r.sandbox
  }
  return sb
}

describe('catalog integrity', () => {
  it('every Lab references a real Skill Area and service, ids unique', () => {
    const ids = new Set()
    for (const lab of LABS) {
      expect(ids.has(lab.id)).toBe(false)
      ids.add(lab.id)
      expect(skillAreaById(lab.skillAreaId)).toBeTruthy()
      expect(SERVICES[lab.service]).toBeTruthy()
      expect(lab.minutes).toBeGreaterThan(0)
    }
    expect(SKILL_AREAS.map((a) => a.id)).toEqual(['containers', 'data', 'connect', 'secure'])
    expect(HOME_SERVICES.every((k) => SERVICES[k])).toBe(true)
  })
  it('all six available Labs have 5 Tasks with 2 hints each', () => {
    const available = LABS.filter((l) => l.status === 'available' && l.engineVersion === undefined)
    expect(available.map((l) => l.id)).toEqual(['servicebus-order-backend', 'containerapps-keda', 'cosmos-vector-search', 'keyvault-secrets', 'functions-serverless-api', 'eventgrid-filtered-subscription'])
    for (const lab of available) {
      expect(lab.tasks).toHaveLength(5)
      for (const t of lab.tasks) {
        expect(t.hints).toHaveLength(2)
        expect(typeof t.check).toBe('function')
        expect(t.solution.length).toBeGreaterThan(0)
        expect(t.examNote.length).toBeGreaterThan(0)
      }
    }
    expect(labById('nope')).toBeUndefined()
  })
})

describe('Service Bus Lab', () => {
  const lab = labById('servicebus-order-backend')

  it('seed is an empty Sandbox and no Task is done at start', () => {
    const sb = lab.seed(createSandbox())
    expect(sb.resourceGroups).toHaveLength(0)
    expect(lab.tasks.every((t) => t.check(sb) === false)).toBe(true)
  })

  it('applying each Solution in order ticks exactly that Task', () => {
    let sb = lab.seed(createSandbox())
    lab.tasks.forEach((task, i) => {
      expect(task.check(sb)).toBe(false)
      sb = apply(sb, task.solution)
      expect(task.check(sb)).toBe(true)
      expect(lab.tasks.slice(0, i + 1).every((t) => t.check(sb))).toBe(true)
      expect(lab.tasks.slice(i + 1).every((t) => !t.check(sb))).toBe(true)
    })
  })

  it('Tasks judge state, not commands: fixing a Basic namespace with update counts', () => {
    let sb = apply(lab.seed(createSandbox()), lab.tasks[0].solution)
    sb = runLine(sb, 'az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku Basic').sandbox
    expect(lab.tasks[1].check(sb)).toBe(false)
    sb = runLine(sb, 'az servicebus namespace update -g rg-orders -n sb-contoso-orders --sku Standard').sandbox
    expect(lab.tasks[1].check(sb)).toBe(true)
  })

  it('queue Task needs both flags; subscription Task needs $Default removed', () => {
    let sb = apply(lab.seed(createSandbox()), lab.tasks[0].solution + '\n' + lab.tasks[1].solution)
    sb = runLine(sb, 'az servicebus queue create -g rg-orders --namespace-name sb-contoso-orders -n orders --max-delivery-count 5').sandbox
    expect(lab.tasks[2].check(sb)).toBe(false)
    sb = runLine(sb, 'az servicebus queue update -g rg-orders --namespace-name sb-contoso-orders -n orders --enable-dead-lettering-on-message-expiration true').sandbox
    expect(lab.tasks[2].check(sb)).toBe(true)
    sb = apply(sb, lab.tasks[3].solution)
    sb = runLine(sb, 'az servicebus topic subscription create -g rg-orders --namespace-name sb-contoso-orders --topic-name order-events -n eu-orders').sandbox
    sb = runLine(sb, `az servicebus topic subscription rule create -g rg-orders --namespace-name sb-contoso-orders --topic-name order-events --subscription-name eu-orders -n eu-filter --filter-sql-expression "region='EU'"`).sandbox
    expect(lab.tasks[4].check(sb)).toBe(false)
    sb = runLine(sb, `az servicebus topic subscription rule delete -g rg-orders --namespace-name sb-contoso-orders --topic-name order-events --subscription-name eu-orders -n '$Default'`).sandbox
    expect(lab.tasks[4].check(sb)).toBe(true)
  })

  it('Task checks compare entity names case-insensitively, like the engine (Controller Ruling S)', () => {
    let sb = lab.seed(createSandbox())
    sb = runLine(sb, 'az group create --name RG-Orders --location westeurope').sandbox
    expect(lab.tasks[0].check(sb)).toBe(true)
    sb = runLine(sb, 'az servicebus namespace create --resource-group rg-orders --name SB-Contoso-Orders --sku Standard').sandbox
    expect(lab.tasks[1].check(sb)).toBe(true)
    sb = apply(sb, lab.tasks[2].solution)
    expect(lab.tasks[2].check(sb)).toBe(true)
    sb = apply(sb, lab.tasks[3].solution)
    expect(lab.tasks[3].check(sb)).toBe(true)
    sb = apply(sb, lab.tasks[4].solution)
    expect(lab.tasks[4].check(sb)).toBe(true)
    expect(lab.tasks.every((t) => t.check(sb))).toBe(true)
  })
})
