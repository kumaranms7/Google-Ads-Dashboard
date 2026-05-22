import React, { useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { resolveEnum, CAMPAIGN_STATUS } from '../utils/enumMaps.js'

const STATUS_STYLE = {
  Active:  { bg: 'rgba(76,175,80,0.12)',   color: '#2e7d32', border: '1px solid rgba(76,175,80,0.3)'   },
  Paused:   { bg: 'rgba(224,92,42,0.12)',   color: '#c0392b', border: '1px solid rgba(224,92,42,0.3)'   },
  Limited:  { bg: 'rgba(240,180,41,0.15)',  color: '#8a6000', border: '1px solid rgba(240,180,41,0.4)'  },
  Removed:  { bg: 'rgba(150,150,150,0.12)', color: '#666',    border: '1px solid rgba(150,150,150,0.3)' },
}

function resolveStatus(raw) {
  const label = resolveEnum(CAMPAIGN_STATUS, raw, String(raw ?? ''))
  // 'Active' is a backend alias for 'Enabled'
  return label
}

const COLS = [
  { key: 'name',        label: 'Campaign',    align: 'left',  fmt: v => v },
  { key: 'status',      label: 'Status',      align: 'center', fmt: null },
  { key: 'impressions', label: 'Impressions', align: 'right', fmt: v => Number(v).toLocaleString() },
  { key: 'clicks',      label: 'Clicks',      align: 'right', fmt: v => Number(v).toLocaleString() },
  { key: 'cpc',         label: 'CPC',         align: 'right', fmt: v => '$' + Number(v).toFixed(2) },
  { key: 'conversions', label: 'Conv.',       align: 'right', fmt: v => Number(v).toLocaleString() },
  { key: 'cost',        label: 'Cost',        align: 'right', fmt: v => '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
]

function SortIcon({ col, sortKey, sortAsc }) {
  if (sortKey !== col) return <ChevronUp size={11} style={{ opacity: 0.25 }} />
  return sortAsc ? <ChevronUp size={11} style={{ opacity: 0.9 }} /> : <ChevronDown size={11} style={{ opacity: 0.9 }} />
}

export default function CampaignTable({ campaigns, hidePaused }) {
  const [sortKey, setSortKey] = useState('cost')
  const [sortAsc, setSortAsc] = useState(false)
  const [hoverRow, setHoverRow] = useState(null)

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const filtered = (campaigns || []).filter(c => {
    if (!hidePaused) return true
    const s = String(c.status || '').toUpperCase()
    return s !== 'PAUSED' && s !== '3' && s !== 'Paused'
  })

  const rows = [...filtered].sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey]
    if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va)
    return sortAsc ? Number(va) - Number(vb) : Number(vb) - Number(va)
  })

  return (
    <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="card-header">
        <span className="card-title">Campaign Performance</span>
        <span style={{ fontSize: 11, color: '#888' }}>{rows.length} campaigns</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
          No campaign data available
        </div>
      ) : (
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {COLS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{
                      background: '#1a3a6b', color: '#fff',
                      padding: '9px 12px',
                      fontSize: 11, fontWeight: 600,
                      textAlign: col.align,
                      letterSpacing: '0.3px',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer', userSelect: 'none',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      {col.label}
                      <SortIcon col={col.key} sortKey={sortKey} sortAsc={sortAsc} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const statusLabel = resolveStatus(row.status)
                const ss = STATUS_STYLE[statusLabel] ?? STATUS_STYLE.Removed
                return (
                  <tr
                    key={i}
                    onMouseEnter={() => setHoverRow(i)}
                    onMouseLeave={() => setHoverRow(null)}
                    style={{ background: hoverRow === i ? '#f5f7fa' : '#fff', transition: 'background 0.1s' }}
                  >
                    {COLS.map(col => (
                      <td key={col.key} style={{
                        padding: '8px 12px',
                        fontSize: 12,
                        textAlign: col.align,
                        color: col.key === 'name' ? '#1a3a6b' : '#4a4a4a',
                        fontWeight: col.key === 'name' ? 500 : 400,
                        borderBottom: '1px solid #f0f4f8',
                        whiteSpace: 'nowrap',
                        maxWidth: col.key === 'name' ? 180 : undefined,
                        overflow: col.key === 'name' ? 'hidden' : undefined,
                        textOverflow: col.key === 'name' ? 'ellipsis' : undefined,
                      }}>
                        {col.key === 'status' ? (
                          <span style={{
                            display: 'inline-block', padding: '2px 7px', borderRadius: 4,
                            fontSize: 11, fontWeight: 600,
                            background: ss.bg, color: ss.color, border: ss.border,
                          }}>
                            {statusLabel}
                          </span>
                        ) : (
                          col.fmt ? col.fmt(row[col.key]) : row[col.key]
                        )}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
