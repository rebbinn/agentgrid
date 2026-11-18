import { describe, expect, it } from 'vitest'
import { typeaheadMatch } from '../../src/renderer/src/lib/typeahead'

const NAMES = ['A', 'B', 'C', 'CA', 'CAB', 'CB']

describe('typeaheadMatch', () => {
  it('finds the first name that starts with what was typed, ignoring case', () => {
    expect(typeaheadMatch(NAMES, 'c')).toBe(2)
    expect(typeaheadMatch(NAMES, 'CA')).toBe(3)
    expect(typeaheadMatch(NAMES, 'cab')).toBe(4)
    expect(typeaheadMatch(NAMES, 'cb')).toBe(5)
  })

  it('steps through names with the same first letter when that letter is typed again', () => {
    const names = ['config', 'core', 'cron.log', 'data']
    expect(typeaheadMatch(names, 'c')).toBe(0)
    expect(typeaheadMatch(names, 'cc')).toBe(1)
    expect(typeaheadMatch(names, 'ccc')).toBe(2)
    expect(typeaheadMatch(names, 'cccc')).toBe(0)
  })

  it('prefers a real match over stepping through', () => {
    expect(typeaheadMatch(['c1', 'cc.txt', 'c2'], 'cc')).toBe(1)
  })

  it('treats capital I as i whatever the system language is', () => {
    expect(typeaheadMatch(['abc', 'Index.html'], 'i')).toBe(1)
  })

  it('reports no match', () => {
    expect(typeaheadMatch(NAMES, 'z')).toBe(-1)
    expect(typeaheadMatch(NAMES, 'cz')).toBe(-1)
    expect(typeaheadMatch(NAMES, '')).toBe(-1)
    expect(typeaheadMatch([], 'a')).toBe(-1)
  })
})
