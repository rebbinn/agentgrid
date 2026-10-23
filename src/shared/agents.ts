export interface AgentDefinition {
  id: string
  label: string
  command: string
}

export const CLAUDE_AGENT: AgentDefinition = {
  id: 'claude',
  label: 'Claude',
  command: 'claude'
}

export const KNOWN_AGENTS: readonly AgentDefinition[] = [
  CLAUDE_AGENT,
  { id: 'codex', label: 'Codex', command: 'codex' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini' }
]
