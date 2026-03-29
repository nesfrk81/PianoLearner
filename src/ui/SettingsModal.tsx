import { useEffect, useId, useRef } from 'react'

type Props = {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
}

export function SettingsModal({ open, title, onClose, children }: Props) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const el = panelRef.current
    const prev = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    el?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      prev?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className="settings-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-head">
          <h2 id={titleId} className="settings-modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="btn settings-modal-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            Close
          </button>
        </div>
        <div className="settings-modal-body">{children}</div>
      </div>
    </div>
  )
}
