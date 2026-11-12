import React from 'react'
import { Phone } from 'lucide-react'

// Shared "Call Leads" pill used everywhere a Conv./Phone Conv./Form Conv.
// trio appears — white background, green border, red phone glyph, bold
// count. Renders a plain dash for zero rather than an empty pill so a
// wide "Call Leads" column doesn't look broken when a row has no calls.
export default function CallLeadsBadge({ count, campaignName, onDrillDown }) {
  const n = Number(count) || 0
  if (n === 0) return <span style={{ color: '#9e9e9e', fontSize: 12 }}>—</span>
  return (
    <span
      onClick={onDrillDown ? () => onDrillDown(campaignName) : undefined}
      title={campaignName ? `View ${n} call(s) for "${campaignName}" in Call Leads` : `${n} call(s)`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: '#fff', border: '1.5px solid #4caf50', borderRadius: 99,
        padding: '2px 10px', fontSize: 12, fontWeight: 700, color: '#1a1a1a',
        cursor: onDrillDown ? 'pointer' : 'default', lineHeight: 1.4,
      }}
    >
      <Phone size={12} color="#e53935" fill="#e53935" strokeWidth={0} />
      {n}
    </span>
  )
}
