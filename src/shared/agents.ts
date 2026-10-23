export const AGENT_IDS = ['claude', 'codex', 'gemini'] as const

export type AgentId = (typeof AGENT_IDS)[number]

export interface AgentDefinition {
  id: AgentId
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

export function findAgent(id: AgentId): AgentDefinition {
  const agent = KNOWN_AGENTS.find((candidate) => candidate.id === id)
  if (!agent) throw new Error(`Unknown agent: ${id}`)
  return agent
}
