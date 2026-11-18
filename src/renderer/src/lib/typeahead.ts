export const TYPEAHEAD_RESET_MS = 1000

export function typeaheadMatch(names: readonly string[], query: string): number {
  const needle = query.toLowerCase()
  if (needle === '') return -1
  const lowered = names.map((name) => name.toLowerCase())
  const direct = lowered.findIndex((name) => name.startsWith(needle))
  if (direct !== -1) return direct
  const [first, ...rest] = [...needle]
  if (rest.some((char) => char !== first)) return -1
  const candidates = lowered.flatMap((name, index) => (name.startsWith(first!) ? [index] : []))
  if (candidates.length === 0) return -1
  return candidates[rest.length % candidates.length]!
}
