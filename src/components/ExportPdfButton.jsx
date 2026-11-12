import React from 'react'
import { FileDown } from 'lucide-react'

// PDF counterpart to ExportButton (CSV) — reuses the same main-process
// 'pdf:export' pipeline Dashboard/Reports Summary already use (expands the
// page to full height, hides nav chrome, prints the live DOM to PDF), just
// scoped to whichever card/tab is on screen when clicked. `section` becomes
// part of the saved filename.
export default function ExportPdfButton({ accountName, section, disabled = false }) {
  const [state, setState] = React.useState('idle') // idle | exporting | done

  async function handleClick() {
    if (disabled || state === 'exporting') return
    setState('exporting')
    try {
      const result = await window.electronAPI.exportPDF({ accountName, section })
      if (result?.canceled) { setState('idle'); return }
      setState('done')
      setTimeout(() => setState('idle'), 2000)
    } catch (err) {
      console.error('PDF export failed:', err)
      setState('idle')
    }
  }

  const done = state === 'done'
  return (
    <button
      onClick={handleClick}
      disabled={disabled || state === 'exporting'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 14px',
        border: `1px solid ${done ? '#4caf50' : '#1a3a6b'}`,
        borderRadius: 6,
        background: done ? 'rgba(76,175,80,0.08)' : 'transparent',
        color:  done ? '#2e7d32' : '#1a3a6b',
        fontSize: 12, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : (state === 'exporting' ? 'wait' : 'pointer'),
        opacity: disabled ? 0.4 : 1,
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!disabled && state === 'idle') { e.currentTarget.style.background = '#1a3a6b'; e.currentTarget.style.color = '#fff' } }}
      onMouseLeave={e => { e.currentTarget.style.background = done ? 'rgba(76,175,80,0.08)' : 'transparent'; e.currentTarget.style.color = done ? '#2e7d32' : '#1a3a6b' }}
    >
      <FileDown size={13} />
      {state === 'exporting' ? 'Exporting…' : done ? 'Exported!' : 'Export PDF'}
    </button>
  )
}
