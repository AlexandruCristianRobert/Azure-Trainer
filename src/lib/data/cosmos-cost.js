// Deterministic Cosmos DB for NoSQL RU cost model: teaching approximations for
// point reads, writes (indexing-aware), queries (using runCosmosQuery stats),
// and RU/s throughput throttling. Pure functions; no Azure calls.

import { isPathIndexed } from './cosmos-query.js'

export const CONSISTENCY_ORDER = ['Strong', 'BoundedStaleness', 'Session', 'ConsistentPrefix', 'Eventual']

const round2 = (n) => Math.round(n * 100) / 100
const stripInternal = (item) => Object.fromEntries(Object.entries(item).filter(([key]) => !key.startsWith('_')))

export function readMultiplier(consistency) {
  return consistency === 'Strong' || consistency === 'BoundedStaleness' ? 2 : 1
}

export function pointReadCharge(item, consistency) {
  const sizeKB = JSON.stringify(stripInternal(item)).length / 1024
  return Math.ceil(sizeKB) * readMultiplier(consistency)
}

function indexedTerms(item, indexingPolicy) {
  let count = 0
  const visit = (value, path) => {
    if (Array.isArray(value)) {
      for (const element of value) visit(element, path)
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (!key.startsWith('_')) visit(child, `${path}/${key}`)
      }
    } else if (isPathIndexed(indexingPolicy, path)) {
      count++
    }
  }
  visit(item, '')
  return count
}

export function writeCharge(item, indexingPolicy) {
  return round2(1.9 + 0.35 * indexedTerms(item, indexingPolicy))
}

export function queryCharge(stats, consistency, logicalScale = 1) {
  const { scanned, partitionsTouched, vector } = stats
  const base = 2.3 + 0.1 * scanned * logicalScale + 2.5 * (partitionsTouched - 1) + (vector ? 1.2 : 0)
  return round2(base * readMultiplier(consistency))
}

export function applyThroughput(charges, provisionedRUs) {
  let sum = 0
  const accepted = charges.map((charge) => {
    if (sum + charge > provisionedRUs) return false
    sum += charge
    return true
  })
  return { accepted, retryAfterMs: 1000 }
}
