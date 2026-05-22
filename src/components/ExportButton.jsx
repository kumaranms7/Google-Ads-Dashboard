import React from 'react'
import { Download } from 'lucide-react'

function toCsv(data) {
  if (!data?.length) return ''
  const headers = Object.keys(data[0])
  const escape  = v => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [
    headers.join(','),
    ...data.map(row => headers.map(h => escape(row[h])).join(',')),
  ].join('\n')
}

export default function ExportButton({ data = [], filename = 'export.csv', label = 'Export CSV' }) {
  const [done, setDone] = React.useState(false)

  function handleClick() {
    const csv  = toCsv(data)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
    a.click()
    URL.revokeObjectURL(url)
    setDone(true)
    setTimeout(() => setDone(false), 2000)
  }

  return (
    <button
      onClick={handleClick}
      disabled={!data?.length}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 14px',
        border: `1px solid ${done ? '#4caf50' : '#1a3a6b'}`,
        borderRadius: 6,
        background: done ? 'rgba(76,175,80,0.08)' : 'transparent',
        color:  done ? '#2e7d32' : '#1a3a6b',
        fontSize: 12, fontWeight: 600,
        cursor: !data?.length ? 'not-allowed' : 'pointer',
        opacity: !data?.length ? 0.4 : 1,
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (data?.length && !done) { e.currentTarget.style.background = '#1a3a6b'; e.currentTarget.style.color = '#fff' } }}
      onMouseLeave={e => { e.currentTarget.style.background = done ? 'rgba(76,175,80,0.08)' : 'transparent'; e.currentTarget.style.color = done ? '#2e7d32' : '#1a3a6b' }}
    >
      <Download size={13} />
      {done ? 'Downloaded!' : label}
    </button>
  )
}
