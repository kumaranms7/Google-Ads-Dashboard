import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import Modal from './Modal.jsx'

const fmtNum = v => Number(v || 0).toLocaleString()

// Shared drill-down cell for Form Conv. / Call Conv. / Call Leads — a small
// chevron next to the number opens a modal listing what made up that total
// (by conversion action name for the two conversion columns, by call status
// for Call Leads), with individual counts. Google Ads doesn't expose actual
// submitted form field values or call recordings via the API, only which
// conversion action fired (or call status) and how many times, so this
// breakdown is the most detail available for any of the three.
export default function BreakdownCell({ value, breakdown, entityLabel, modalTitle, buttonTitle, rowLabel = 'Name', valueLabel = 'Count', valueNode, align = 'flex-end', fullWidth = true }) {
  const [open, setOpen] = useState(false)
  const hasBreakdown = Array.isArray(breakdown) && breakdown.length > 0
  return (
    <>
      {/* width:100% + justifyContent:align is for table cells, where this
          fills the whole cell so align='flex-end' right-aligns the value.
          Inline usage (e.g. a KPI card, right after an icon/emoji) needs
          fullWidth={false} — a 100%-wide inline-flex box there forces
          itself onto its own line below whatever precedes it instead of
          sitting beside it. */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: align, width: fullWidth ? '100%' : undefined }}>
        {valueNode ?? fmtNum(value)}
        {hasBreakdown && (
          <button
            onClick={() => setOpen(true)}
            title={buttonTitle}
            style={{ display: 'inline-flex', alignItems: 'center', border: 'none', background: 'none', padding: 2, cursor: 'pointer', color: '#2563b0' }}
          >
            <ChevronDown size={13} />
          </button>
        )}
      </span>
      {open && (
        <Modal title={modalTitle} subtitle={entityLabel} onClose={() => setOpen(false)} maxWidth={420}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, paddingBottom: 6, borderBottom: '1px solid #eef2f7' }}>
              <span>{rowLabel}</span>
              <span>{valueLabel}</span>
            </div>
            {breakdown.map((b, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13, color: '#333', padding: '7px 0', borderBottom: i < breakdown.length - 1 ? '1px solid #f0f4f8' : 'none' }}>
                <span>{b.name}</span>
                <strong style={{ color: '#1a3a6b' }}>{fmtNum(b.conversions)}</strong>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 12, color: '#888', paddingTop: 10, marginTop: 4, borderTop: '2px solid #eef2f7' }}>
              <span>Total</span>
              <strong>{fmtNum(value)}</strong>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
