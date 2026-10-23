import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

interface PromptDialogProps {
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  cancelLabel: string
  maxLength: number
  validate: (value: string) => string | null
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function PromptDialog({
  title,
  label,
  initialValue,
  confirmLabel,
  cancelLabel,
  maxLength,
  validate,
  onSubmit,
  onCancel
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const problem = validate(value)
    if (problem) {
      setError(problem)
      return
    }
    onSubmit(value.trim())
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        onSubmit={submit}
      >
        <h2 id="prompt-title" className="dialog__title">
          {title}
        </h2>
        <label className="dialog__field">
          <span className="dialog__label">{label}</span>
          <input
            ref={inputRef}
            className="dialog__input"
            value={value}
            maxLength={maxLength}
            aria-invalid={error !== null}
            aria-describedby={error ? 'prompt-error' : undefined}
            onChange={(event) => {
              setValue(event.target.value)
              setError(null)
            }}
          />
        </label>
        {error && (
          <p id="prompt-error" className="dialog__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="submit" className="btn btn--primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
