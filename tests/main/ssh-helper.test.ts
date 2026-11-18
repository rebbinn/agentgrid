import { describe, expect, it } from 'vitest'
import { SshHelper, type HelperChild, type HelperEvent } from '../../src/main/ssh-helper'

class FakeChild implements HelperChild {
  lines: string[] = []
  ended = false
  killed = false
  private stdout: (chunk: string) => void = () => undefined
  private exit: () => void = () => undefined

  write(line: string): boolean {
    this.lines.push(line)
    return true
  }
  end(): void {
    this.ended = true
  }
  kill(): void {
    this.killed = true
  }
  onStdout(listener: (chunk: string) => void): void {
    this.stdout = listener
  }
  onStderr(): void {}
  onExit(listener: () => void): void {
    this.exit = listener
  }
  output(text: string): void {
    this.stdout(text)
  }
  die(): void {
    this.exit()
  }
}

describe('SshHelper', () => {
  it('starts the process only when the first command is sent', () => {
    const children: FakeChild[] = []
    const helper = new SshHelper(() => {
      const child = new FakeChild()
      children.push(child)
      return child
    })
    expect(children).toHaveLength(0)
    expect(helper.send({ op: 'close', sid: 'a' })).toBe(true)
    expect(children).toHaveLength(1)
    expect(children[0]!.lines).toEqual(['{"op":"close","sid":"a"}\n'])
  })

  it('reports that SSH is unavailable when the program is missing', () => {
    const helper = new SshHelper(() => null)
    expect(helper.send({ op: 'close', sid: 'a' })).toBe(false)
  })

  it('parses events split across chunks and ignores garbage', () => {
    const child = new FakeChild()
    const logs: string[] = []
    const helper = new SshHelper(() => child, (message) => logs.push(message))
    const events: HelperEvent[] = []
    helper.onEvent((event) => events.push(event))
    helper.send({ op: 'close', sid: 'a' })
    child.output('{"ev":"ready","version":1}\n{"ev":"con')
    child.output('nected","sid":"s1"}\nnot json\n{"ev":"mystery"}\n')
    expect(events).toEqual([{ ev: 'ready', version: 1 }, { ev: 'connected', sid: 's1' }])
    expect(logs).toHaveLength(2)
  })

  it('tells listeners when the process dies and starts a fresh one next time', () => {
    const children: FakeChild[] = []
    const helper = new SshHelper(() => {
      const child = new FakeChild()
      children.push(child)
      return child
    })
    let exits = 0
    helper.onExit(() => exits++)
    helper.send({ op: 'close', sid: 'a' })
    children[0]!.die()
    expect(exits).toBe(1)
    helper.send({ op: 'close', sid: 'b' })
    expect(children).toHaveLength(2)
  })
})
