import type { HostView } from '@shared/hosts'

export interface HostGroup {
  name: string
  views: HostView[]
}

const collator = new Intl.Collator('az', { sensitivity: 'base', numeric: true })

function fold(text: string): string {
  return text.toLocaleLowerCase('az')
}

export function filterHosts(views: readonly HostView[], query: string): HostView[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...views]
  return views.filter(({ host }) => {
    const haystack = fold([host.name, host.group, host.address, host.username, host.note].join(' '))
    return terms.every((term) => haystack.includes(term))
  })
}

export function groupHosts(views: readonly HostView[]): HostGroup[] {
  const groups = new Map<string, HostView[]>()
  for (const view of views) {
    const key = view.host.group.trim()
    groups.set(key, [...(groups.get(key) ?? []), view])
  }
  return [...groups.entries()]
    .sort(([first], [second]) => {
      if (first === '') return 1
      if (second === '') return -1
      return collator.compare(first, second)
    })
    .map(([name, items]) => ({
      name,
      views: [...items].sort((first, second) => collator.compare(first.host.name, second.host.name))
    }))
}

export function knownGroups(views: readonly HostView[]): string[] {
  return [...new Set(views.map((view) => view.host.group.trim()).filter(Boolean))].sort(collator.compare)
}
