// Namespace and ordered hyphen joining follow Microsoft's published guid() contract.
// https://learn.microsoft.com/azure/azure-resource-manager/bicep/bicep-functions-string#guid
const NAMESPACE = '11fb06fb712d4ddd98c7e71bbd588830'

function sha1(bytes) {
  const bitLength = bytes.length * 8
  const data = [...bytes, 0x80]
  while (data.length % 64 !== 56) data.push(0)
  const high = Math.floor(bitLength / 0x100000000)
  const low = bitLength >>> 0
  for (const word of [high, low]) for (let shift = 24; shift >= 0; shift -= 8) data.push((word >>> shift) & 255)
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
  const rot = (value, amount) => (value << amount) | (value >>> (32 - amount))
  for (let block = 0; block < data.length; block += 64) {
    const words = new Int32Array(80)
    for (let i = 0; i < 16; i++) words[i] = (data[block + i * 4] << 24) | (data[block + i * 4 + 1] << 16) | (data[block + i * 4 + 2] << 8) | data[block + i * 4 + 3]
    for (let i = 16; i < 80; i++) words[i] = rot(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1)
    let [a, b, c, d, e] = state
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6
      const next = (rot(a, 5) + f + e + k + words[i]) | 0
      e = d; d = c; c = rot(b, 30); b = a; a = next
    }
    for (let i = 0; i < 5; i++) state[i] = (state[i] + [a, b, c, d, e][i]) | 0
  }
  return state.flatMap(word => [24, 16, 8, 0].map(shift => (word >>> shift) & 255))
}

export function bicepGuid(args) {
  if (!Array.isArray(args) || args.length < 1 || args.length > 5 || args.some(value => typeof value !== 'string')) throw new TypeError('guid requires one to five strings.')
  const namespace = NAMESPACE.match(/../g).map(hex => Number.parseInt(hex, 16))
  const hash = sha1([...namespace, ...new TextEncoder().encode(args.join('-'))]).slice(0, 16)
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
