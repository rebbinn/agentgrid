import { beforeEach, describe, expect, it } from 'vitest'
import { ManagedTerminal } from '../../src/renderer/src/terminal/managed-terminal'
import { createAgentGridMock, type AgentGridMock } from './agentgrid-mock'

let api: AgentGridMock

beforeEach(() => {
  api = createAgentGridMock()
  window.agentgrid = api
})

describe('links printed by programs in the terminal', () => {
  it('open in the browser without the built-in "could be dangerous" question', () => {
    const terminal = new ManagedTerminal('pane-1', 0)
    const handler = terminal.term.options.linkHandler
    expect(handler).toBeTruthy()
    const url = 'https://github.com/rebbinn/agentgrid/releases/latest/download/AgentGrid-Setup.exe'
    handler!.activate(new MouseEvent('click'), url, { start: { x: 1, y: 1 }, end: { x: 80, y: 1 } })
    expect(api.external.open).toHaveBeenCalledWith(url)
    expect(handler!.allowNonHttpProtocols).not.toBe(true)
    terminal.term.dispose()
  })
})
