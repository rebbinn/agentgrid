import { useState, type FormEvent, type KeyboardEvent } from 'react'
import type { SshHostKeyEvent, SshPromptEvent, SshRequestEvent } from '@shared/ssh'
import { useSshStore } from '../state/ssh-store'
import { strings } from '../strings'

function answer(request: SshRequestEvent, payload: { accept?: boolean; answers?: string[]; cancel?: boolean; remember?: boolean }): void {
  window.agentgrid.ssh.answer({ sessionId: request.sessionId, requestId: request.requestId, ...payload })
  useSshStore.getState().resolveRequest(request.sessionId)
}

function HostKeyRequest({ request }: { request: SshHostKeyEvent }) {
  return (
    <div className="ssh-request" role="group" aria-label={strings.ssh.hostKeyTitle}>
      <h2 className="pane__overlay-title pane__overlay-title--info">{strings.ssh.hostKeyTitle}</h2>
      <p className="pane__overlay-text">{strings.ssh.hostKeyText(request.hostName, request.address)}</p>
      <code className="ssh-request__fingerprint">
        {request.keyType} {request.fingerprint}
      </code>
      <div className="empty-state__actions">
        <button type="button" className="btn btn--primary" autoFocus onClick={() => answer(request, { accept: true })}>
          {strings.ssh.hostKeyAccept}
        </button>
        <button type="button" className="btn" onClick={() => answer(request, { accept: false })}>
          {strings.ssh.hostKeyReject}
        </button>
      </div>
    </div>
  )
}

function PromptRequest({ request }: { request: SshPromptEvent }) {
  const [values, setValues] = useState<string[]>(() => request.questions.map(() => ''))
  const [remember, setRemember] = useState(false)
  const title = strings.ssh.promptTitle(request.promptKind, request.hostName)

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    answer(request, { answers: values, remember: request.canRemember && remember })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    answer(request, { cancel: true })
  }

  return (
    <form className="ssh-request" aria-label={title} onSubmit={submit} onKeyDown={handleKeyDown}>
      <h2 className="pane__overlay-title pane__overlay-title--info">{title}</h2>
      {request.name && <p className="pane__overlay-text">{request.name}</p>}
      {request.instruction && <p className="pane__overlay-text">{request.instruction}</p>}
      {request.questions.map((question, index) => (
        <label key={index} className="ssh-request__field">
          <span className="dialog__label">{question.text.trim() || strings.ssh.answerLabel(index)}</span>
          <input
            className="dialog__input"
            type={question.echo ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            autoFocus={index === 0}
            value={values[index] ?? ''}
            onChange={(event) => {
              const next = [...values]
              next[index] = event.target.value
              setValues(next)
            }}
          />
        </label>
      ))}
      {request.canRemember && (
        <label className="dialog__radio ssh-request__remember">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          {strings.ssh.remember}
        </label>
      )}
      <div className="empty-state__actions">
        <button type="submit" className="btn btn--primary">
          {strings.ssh.submit}
        </button>
        <button type="button" className="btn" onClick={() => answer(request, { cancel: true })}>
          {strings.ssh.cancel}
        </button>
      </div>
    </form>
  )
}

export function SshRequestView({ request }: { request: SshRequestEvent }) {
  return request.kind === 'hostkey' ? (
    <HostKeyRequest request={request} />
  ) : (
    <PromptRequest key={request.requestId} request={request} />
  )
}
