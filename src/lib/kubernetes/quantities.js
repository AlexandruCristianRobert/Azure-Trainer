const MAX_CPU_M = 4000
const MAX_MEMORY_BYTES = 16 * 1024 * 1024 * 1024

const diagnostic = (code, message) => ({ code, message })
const result = (key, value, diagnostics = []) => ({ [key]: value, diagnostics })
const text = value => typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value : null

export function parseCpuQuantity(value) {
  const source = text(value)
  if (source === null || source.startsWith('-')) return result('millicores', null, [diagnostic('INVALID_QUANTITY', 'CPU quantities must be finite nonnegative cores or millicores.')])
  let millicores = null
  const milli = /^(\d+)m$/.exec(source)
  const cores = /^(\d+)(?:\.(\d+))?$/.exec(source)
  if (milli) millicores = Number(milli[1])
  else if (cores) {
    const fraction = cores[2] ?? ''
    if (fraction.length > 3) return result('millicores', null, [diagnostic('UNSUPPORTED_QUANTITY', 'CPU precision smaller than one millicore is unsupported.')])
    millicores = Number(cores[1]) * 1000 + Number((fraction + '000').slice(0, 3))
  } else return result('millicores', null, [diagnostic('INVALID_QUANTITY', 'CPU quantities support whole or up to three-decimal cores, or integer millicores.')])
  if (!Number.isSafeInteger(millicores) || millicores > MAX_CPU_M) return result('millicores', null, [diagnostic('RESOURCE_OUT_OF_RANGE', `CPU quantities must not exceed ${MAX_CPU_M}m.`)])
  return result('millicores', millicores)
}

export function parseMemoryQuantity(value) {
  const source = text(value)
  if (source === null || source.startsWith('-')) return result('bytes', null, [diagnostic('INVALID_QUANTITY', 'Memory quantities must be finite nonnegative bytes or supported suffixes.')])
  if (/^\d+(?:\.\d+)?e[+-]?\d+$/i.test(source) || /^\d+(?:\.\d+)?m$/.test(source)) return result('bytes', null, [diagnostic('UNSUPPORTED_QUANTITY', 'This valid Kubernetes memory notation is outside the trainer quantity subset.')])
  const match = /^(\d+)(?:\.(\d+))?(Ki|Mi|Gi|K|M|G)?$/.exec(source)
  if (!match) return result('bytes', null, [diagnostic('INVALID_QUANTITY', 'Memory quantities support bytes, Ki/Mi/Gi, or K/M/G suffixes.')])
  const factors = { Ki: 1024n, Mi: 1024n ** 2n, Gi: 1024n ** 3n, K: 1000n, M: 1000n ** 2n, G: 1000n ** 3n }
  const factor = factors[match[3] ?? ''] ?? 1n
  const decimal = match[2] ?? ''
  const scale = 10n ** BigInt(decimal.length)
  const numerator = BigInt(match[1]) * scale + BigInt(decimal || '0')
  const bytes = numerator * factor
  if (bytes % scale !== 0n) return result('bytes', null, [diagnostic('UNSUPPORTED_QUANTITY', 'Fractional-byte memory quantities are unsupported.')])
  const normalized = bytes / scale
  if (normalized > BigInt(MAX_MEMORY_BYTES)) return result('bytes', null, [diagnostic('RESOURCE_OUT_OF_RANGE', 'Memory quantities must not exceed 16Gi.')])
  return result('bytes', Number(normalized))
}
