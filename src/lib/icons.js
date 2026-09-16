// Icon registries. Fluent UI System Icons (Microsoft, MIT) for controls; official Azure
// architecture icons for services. Both are inlined as raw SVG at build time.
const fluentFiles = import.meta.glob('../assets/icons/fluent/*.svg', { query: '?raw', import: 'default', eager: true })
const azureFiles = import.meta.glob('../assets/icons/azure/*.svg', { query: '?raw', import: 'default', eager: true })

function keyOf(path) {
  return path.split('/').pop().replace(/\.svg$/, '')
}

export function stripSize(svg) {
  return svg
    .replace(/(<svg[^>]*?)\swidth="[^"]*"/, '$1')
    .replace(/(<svg[^>]*?)\sheight="[^"]*"/, '$1')
}

export function toCurrentColor(svg) {
  return stripSize(svg).replace(/fill="#212121"/g, 'fill="currentColor"')
}

export const FLUENT_ICONS = Object.fromEntries(
  Object.entries(fluentFiles).map(([path, svg]) => [keyOf(path), toCurrentColor(svg)]),
)

export const AZURE_ICONS = Object.fromEntries(
  Object.entries(azureFiles).map(([path, svg]) => [keyOf(path), stripSize(svg)]),
)

export function fluentIcon(name) {
  return FLUENT_ICONS[name] ?? ''
}

export function azureIcon(name) {
  return AZURE_ICONS[name] ?? ''
}
