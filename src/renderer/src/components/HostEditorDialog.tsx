import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  DEFAULT_SSH_PORT,
  HostAddressSchema,
  HostSchema,
  HostUsernameSchema,
  MAX_GROUP_NAME,
  MAX_HOST_NAME,
  MAX_HOST_NOTE,
  MAX_SECRET,
  type Host,
  type HostAuthMethod,
  type HostEnvironment,
  type HostSaveRequest
} from '@shared/hosts'
import type { SshFailure } from '@shared/ssh'
import { knownGroups } from '../lib/hosts'
import { useHostsStore } from '../state/hosts-store'
import { useSshStore } from '../state/ssh-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { Icon } from './Icon'
import { ModalDialog } from './ModalDialog'
import { SshRequestView } from './SshRequestView'

interface HostEditorDialogProps {
  hostId: string | null
  copyOf?: string
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing'; sessionId: string }
  | { kind: 'ok' }
  | { kind: 'failed'; failure: SshFailure }

const texts = strings.servers.editor
const AUTH_OPTIONS: Array<{ value: HostAuthMethod; label: string }> = [
  { value: 'password', label: texts.authPassword },
  { value: 'key', label: texts.authKey },
  { value: 'agent', label: texts.authAgent }
]
const ENVIRONMENT_OPTIONS: Array<{ value: HostEnvironment | null; label: string }> = [
  { value: null, label: texts.environmentNone },
  { value: 'prod', label: 'prod' },
  { value: 'preprod', label: 'preprod' },
  { value: 'dev', label: 'dev' }
]

export function HostEditorDialog({ hostId, copyOf }: HostEditorDialogProps) {
  const closeDialog = useUiStore((state) => state.closeDialog)
  const pushToast = useUiStore((state) => state.pushToast)
  const views = useHostsStore((state) => state.views)
  const save = useHostsStore((state) => state.save)
  const existing = views.find((view) => view.host.id === hostId)
  const source = existing ?? views.find((view) => view.host.id === copyOf)
  const [id] = useState(() => existing?.host.id ?? crypto.randomUUID())

  const [name, setName] = useState(
    existing ? existing.host.name : source ? `${source.host.name}${strings.servers.copySuffix}`.slice(0, MAX_HOST_NAME) : ''
  )
  const [group, setGroup] = useState(source?.host.group ?? '')
  const [address, setAddress] = useState(source?.host.address ?? '')
  const [port, setPort] = useState(String(source?.host.port ?? DEFAULT_SSH_PORT))
  const [username, setUsername] = useState(source?.host.username ?? '')
  const [auth, setAuth] = useState<HostAuthMethod>(source?.host.auth ?? 'password')
  const [keyPath, setKeyPath] = useState(source?.host.keyPath ?? '')
  const [environment, setEnvironment] = useState<HostEnvironment | null>(source?.host.environment ?? null)
  const [jumpHostId, setJumpHostId] = useState(source?.host.jumpHostId ?? '')
  const [note, setNote] = useState(source?.host.note ?? '')
  const [password, setPassword] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [forgetPassword, setForgetPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const testRef = useRef<TestState>(test)
  testRef.current = test

  const testRequest = useSshStore((state) => (test.kind === 'testing' ? state.requests[test.sessionId] : undefined))
  const groups = useMemo(() => knownGroups(views), [views])
  const jumpCandidates = useMemo(
    () => views.filter((view) => view.host.id !== id && view.host.jumpHostId === null),
    [views, id]
  )
  const storedPassword = existing?.hasPassword === true
  const storedPassphrase = existing?.hasPassphrase === true

  useEffect(
    () => () => {
      const current = testRef.current
      if (current.kind === 'testing') {
        window.agentgrid.ssh.cancel(current.sessionId)
        useSshStore.getState().forget(current.sessionId)
      }
    },
    []
  )

  const clearFeedback = (): void => {
    setError(null)
    if (testRef.current.kind !== 'testing') setTest({ kind: 'idle' })
  }

  const buildHost = (): Host | string => {
    if (name.trim().length === 0) return texts.errors.nameRequired
    if (!HostAddressSchema.safeParse(address.trim()).success) return texts.errors.addressInvalid
    const portNumber = Number(port)
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) return texts.errors.portInvalid
    if (!HostUsernameSchema.safeParse(username.trim()).success) return texts.errors.usernameInvalid
    if (auth === 'key' && keyPath.trim().length === 0) return texts.errors.keyRequired
    const parsed = HostSchema.safeParse({
      id,
      name: name.trim(),
      group: group.trim(),
      address: address.trim(),
      port: portNumber,
      username: username.trim(),
      auth,
      keyPath: auth === 'key' ? keyPath.trim() : null,
      environment,
      jumpHostId: jumpHostId === '' ? null : jumpHostId,
      note: note.trim(),
      lastConnectedAt: existing?.host.lastConnectedAt ?? null
    })
    return parsed.success ? parsed.data : texts.errors.invalid
  }

  const chooseKey = async (): Promise<void> => {
    try {
      const { path } = await window.agentgrid.hosts.pickKey()
      if (path) {
        setKeyPath(path)
        clearFeedback()
      }
    } catch {
      setError(texts.errors.invalid)
    }
  }

  const runTest = async (): Promise<void> => {
    const host = buildHost()
    if (typeof host === 'string') {
      setError(host)
      return
    }
    setError(null)
    const sessionId = crypto.randomUUID()
    setTest({ kind: 'testing', sessionId })
    const result = await window.agentgrid.ssh
      .test({
        sessionId,
        host,
        ...(auth === 'password' && password ? { password } : {}),
        ...(auth === 'key' && passphrase ? { passphrase } : {})
      })
      .catch((reason: unknown) => ({
        ok: false as const,
        failure: { code: 'other' as const, message: reason instanceof Error ? reason.message : String(reason) }
      }))
    useSshStore.getState().forget(sessionId)
    const current = testRef.current
    if (current.kind !== 'testing' || current.sessionId !== sessionId) return
    setTest(result.ok ? { kind: 'ok' } : { kind: 'failed', failure: result.failure })
  }

  const cancelTest = (): void => {
    const current = testRef.current
    if (current.kind !== 'testing') return
    window.agentgrid.ssh.cancel(current.sessionId)
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const host = buildHost()
    if (typeof host === 'string') {
      setError(host)
      return
    }
    const request: HostSaveRequest = { host }
    if (auth === 'password') {
      if (password) request.password = password
      else if (forgetPassword) request.password = null
    }
    if (auth === 'key' && passphrase) request.passphrase = passphrase
    setSaving(true)
    try {
      const result = await save(request)
      if (!result.ok) {
        setError(texts.errors[result.code])
        return
      }
      pushToast('success', texts.saved(host.name))
      closeDialog()
    } catch {
      setError(texts.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const testing = test.kind === 'testing'

  return (
    <ModalDialog title={existing ? texts.editTitle : texts.createTitle} onClose={closeDialog} wide>
      <form className="host-editor" onSubmit={(event) => void submit(event)} noValidate>
        <div className="host-editor__grid">
          <label className="dialog__field">
            <span className="dialog__label">{texts.name}</span>
            <input
              className="dialog__input"
              value={name}
              maxLength={MAX_HOST_NAME}
              placeholder="xl-app-01"
              onChange={(event) => {
                setName(event.target.value)
                clearFeedback()
              }}
            />
          </label>
          <label className="dialog__field">
            <span className="dialog__label">{texts.group}</span>
            <input
              className="dialog__input"
              list="host-editor-groups"
              value={group}
              maxLength={MAX_GROUP_NAME}
              onChange={(event) => setGroup(event.target.value)}
            />
            <datalist id="host-editor-groups">
              {groups.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </label>

          <label className="dialog__field host-editor__address">
            <span className="dialog__label">{texts.address}</span>
            <input
              className="dialog__input dialog__input--mono"
              value={address}
              spellCheck={false}
              placeholder={texts.addressPlaceholder}
              onChange={(event) => {
                setAddress(event.target.value)
                clearFeedback()
              }}
            />
          </label>
          <label className="dialog__field host-editor__port">
            <span className="dialog__label">{texts.port}</span>
            <input
              className="dialog__input dialog__input--mono"
              inputMode="numeric"
              value={port}
              maxLength={5}
              onChange={(event) => {
                setPort(event.target.value.replace(/\D/g, ''))
                clearFeedback()
              }}
            />
          </label>

          <label className="dialog__field">
            <span className="dialog__label">{texts.username}</span>
            <input
              className="dialog__input dialog__input--mono"
              value={username}
              spellCheck={false}
              placeholder="root"
              onChange={(event) => {
                setUsername(event.target.value)
                clearFeedback()
              }}
            />
          </label>
          <div className="dialog__field">
            <span className="dialog__label" id="host-editor-auth">
              {texts.auth}
            </span>
            <div className="segmented" role="group" aria-labelledby="host-editor-auth">
              {AUTH_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="segmented__option"
                  aria-pressed={auth === option.value}
                  onClick={() => {
                    setAuth(option.value)
                    clearFeedback()
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {auth === 'password' && (
          <div className="dialog__field">
            <label className="dialog__label" htmlFor="host-editor-password">
              {texts.password}
            </label>
            <input
              id="host-editor-password"
              aria-describedby="host-editor-password-hint"
              className="dialog__input"
              type="password"
              autoComplete="new-password"
              value={password}
              maxLength={MAX_SECRET}
              placeholder={storedPassword && !forgetPassword ? texts.passwordStoredPlaceholder : ''}
              onChange={(event) => {
                setPassword(event.target.value)
                clearFeedback()
              }}
            />
            <span className="dialog__hint" id="host-editor-password-hint">
              {storedPassword && forgetPassword ? texts.passwordWillBeRemoved : storedPassword ? texts.passwordKeepHint : texts.passwordHint}
              {storedPassword && password.length === 0 && (
                <>
                  {' '}
                  <button type="button" className="link-button" onClick={() => setForgetPassword(!forgetPassword)}>
                    {forgetPassword ? texts.keepPassword : texts.forgetPassword}
                  </button>
                </>
              )}
            </span>
          </div>
        )}

        {auth === 'key' && (
          <div className="host-editor__grid">
            <div className="dialog__field">
              <span className="dialog__label">{texts.keyFile}</span>
              <div className="dialog__path">
                <span className="dialog__path-text" title={keyPath}>
                  {keyPath || texts.noKey}
                </span>
                <button type="button" className="btn" onClick={() => void chooseKey()}>
                  <Icon name="lock" size={14} />
                  {texts.chooseKey}
                </button>
              </div>
            </div>
            <label className="dialog__field">
              <span className="dialog__label">{texts.passphrase}</span>
              <input
                className="dialog__input"
                type="password"
                autoComplete="new-password"
                value={passphrase}
                maxLength={MAX_SECRET}
                placeholder={storedPassphrase ? texts.passphraseStoredPlaceholder : ''}
                onChange={(event) => setPassphrase(event.target.value)}
              />
            </label>
          </div>
        )}

        {auth === 'agent' && <p className="dialog__hint">{texts.agentHint}</p>}

        <div className="host-editor__grid">
          <div className="dialog__field">
            <span className="dialog__label" id="host-editor-env">
              {texts.environment}
            </span>
            <div className="segmented" role="group" aria-labelledby="host-editor-env">
              {ENVIRONMENT_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="segmented__option"
                  data-env={option.value ?? undefined}
                  aria-pressed={environment === option.value}
                  onClick={() => setEnvironment(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <label className="dialog__field">
            <span className="dialog__label">{texts.jump}</span>
            <select
              className="dialog__input"
              value={jumpHostId}
              onChange={(event) => {
                setJumpHostId(event.target.value)
                clearFeedback()
              }}
            >
              <option value="">{texts.jumpNone}</option>
              {jumpCandidates.map((view) => (
                <option key={view.host.id} value={view.host.id}>
                  {view.host.group ? `${view.host.group} · ${view.host.name}` : view.host.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {environment === 'prod' && <p className="dialog__warning">{texts.prodNote}</p>}

        <label className="dialog__field">
          <span className="dialog__label">{texts.note}</span>
          <textarea
            className="dialog__input host-editor__note"
            value={note}
            maxLength={MAX_HOST_NOTE}
            rows={2}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        {testing && testRequest && (
          <div className="host-editor__request">
            <SshRequestView request={testRequest} />
          </div>
        )}
        {test.kind === 'ok' && (
          <p className="dialog__success" role="status">
            {texts.testOk}
          </p>
        )}
        {test.kind === 'failed' && (
          <p className="dialog__error" role="alert">
            {strings.ssh.errorText(test.failure.code, test.failure.hostName ?? name, test.failure.message)}
          </p>
        )}
        {error && (
          <p className="dialog__error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog__actions host-editor__actions">
          {testing ? (
            <button type="button" className="btn" onClick={cancelTest}>
              {texts.testing} · {strings.ssh.cancel}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => void runTest()}>
              {texts.test}
            </button>
          )}
          <span className="host-editor__spacer" />
          <button type="button" className="btn" onClick={closeDialog}>
            {texts.cancel}
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {texts.save}
          </button>
        </div>
      </form>
    </ModalDialog>
  )
}
