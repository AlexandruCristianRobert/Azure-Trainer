export function toolDestination(names, currentIndex, key) {
  const count = names.length
  if (!count) return null
  const index = key === 'ArrowRight' ? (currentIndex + 1) % count
    : key === 'ArrowLeft' ? (currentIndex + count - 1) % count
      : key === 'Home' ? 0 : key === 'End' ? count - 1 : -1
  return index < 0 ? null : { index, name: names[index] }
}
