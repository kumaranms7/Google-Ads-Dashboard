import React from 'react'

// Shared full-screen modal shell — backdrop + centered card + sticky header
// with title/subtitle/close button. Body content is fully custom via
// children. Models the shell every existing write-action modal in this app
// hand-rolls (see ApplyModal in ai-rsa-builder/index.jsx) so Campaign
// Manager's several review/publish/rollback modals don't each reimplement it.
export default function Modal({ title, subtitle, onClose, disableClose, maxWidth = 780, children }) {
  const handleBackdropClick = () => { if (!disableClose) onClose?.() }

  return (
    <div
      onClick={handleBackdropClick}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, maxWidth, width: '100%', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}
      >
        {(title || onClose) && (
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
            <div>
              {title && <div style={{ fontSize: 16, fontWeight: 700, color: '#1a3a6b' }}>{title}</div>}
              {subtitle && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{subtitle}</div>}
            </div>
            {onClose && (
              <button
                onClick={onClose}
                disabled={disableClose}
                style={{ background: 'none', border: 'none', cursor: disableClose ? 'not-allowed' : 'pointer', color: '#888', fontSize: 22, lineHeight: 1, padding: '0 4px' }}
              >
                ×
              </button>
            )}
          </div>
        )}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// Reusable sub-pieces matching the same warning/summary boxes ApplyModal
// already hand-rolls, so Campaign Manager modals get the same visual
// language for free instead of re-copying the inline styles.
export function ModalWarning({ children }) {
  return (
    <div style={{ padding: '10px 14px', background: '#fff8e6', border: '1px solid #ffe0b2', borderRadius: 7, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 12, color: '#a56700', lineHeight: 1.6 }}>{children}</span>
    </div>
  )
}

export function ModalSuccess({ children }) {
  return (
    <div style={{ padding: '10px 14px', background: '#e8f5e9', border: '1px solid #4caf5033', borderRadius: 7, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: '#1b5e20', lineHeight: 1.7 }}>{children}</span>
    </div>
  )
}

export function ModalError({ children }) {
  return (
    <div style={{ padding: '10px 14px', background: '#fff5f5', border: '1px solid #c0392b33', borderRadius: 7, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: '#c0392b', lineHeight: 1.6 }}>{children}</span>
    </div>
  )
}

export function ModalFooter({ children }) {
  return (
    <div style={{ padding: '14px 24px', borderTop: '1px solid #eef2f7', display: 'flex', justifyContent: 'flex-end', gap: 10, position: 'sticky', bottom: 0, background: '#fff' }}>
      {children}
    </div>
  )
}
