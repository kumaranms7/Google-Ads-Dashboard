import React from 'react'

const fmtN = v => Number(v || 0).toLocaleString()

/**
 * Shows total conversions with optional phone / form breakdown below.
 * Renders nothing extra when both phone and form are 0.
 */
export default function ConvBreakdown({ total, phone = 0, form = 0, align = 'right' }) {
  const hasBreakdown = phone > 0 || form > 0
  return (
    <div style={{ textAlign: align }}>
      <div style={{ fontWeight: 600, color: '#1a3a6b' }}>{fmtN(total)}</div>
      {hasBreakdown && (
        <div style={{
          fontSize: 10, marginTop: 2,
          display: 'flex', gap: 8,
          justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        }}>
          {phone > 0 && (
            <span style={{ color: '#1565c0', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              📞 {fmtN(phone)}
            </span>
          )}
          {form > 0 && (
            <span style={{ color: '#2e7d32', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              📝 {fmtN(form)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
