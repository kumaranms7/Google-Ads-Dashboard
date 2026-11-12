import React from 'react'
import { resolveEnum, CAMPAIGN_STATUS } from '../utils/enumMaps.js'
import ReportTable from './ReportTable.jsx'

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

export default function CampaignTable({ campaigns, hidePaused }) {
  const rows = (campaigns || []).filter(c => {
    if (!hidePaused) return true
    const s = String(c.status || '').toUpperCase()
    return s !== 'PAUSED' && s !== '3' && s !== 'Paused'
  })

  return (
    <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="card-header">
        <span className="card-title">Campaign Performance</span>
        <span style={{ fontSize: 11, color: '#888' }}>{rows.length} campaigns</span>
      </div>
      <ReportTable
        pagination defaultPageSize={25}
        emptyMessage="No campaign data available"
        columns={[
          { key: 'name', label: 'Campaign', sortable: true, align: 'left' },
          { key: 'status', label: 'Status', sortable: true, align: 'center',
            format: v => {
              const statusLabel = resolveStatus(v)
              const ss = STATUS_STYLE[statusLabel] ?? STATUS_STYLE.Removed
              return <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: ss.bg, color: ss.color, border: ss.border }}>{statusLabel}</span>
            } },
          { key: 'impressions', label: 'Impressions', sortable: true, align: 'right', format: v => Number(v).toLocaleString() },
          { key: 'clicks',      label: 'Clicks',      sortable: true, align: 'right', format: v => Number(v).toLocaleString() },
          { key: 'cpc',         label: 'CPC',         sortable: true, align: 'right', format: v => '$' + Number(v).toFixed(2) },
          { key: 'conversions', label: 'Conv.',       sortable: true, align: 'right', format: v => Number(v).toLocaleString() },
          { key: 'cost',        label: 'Cost',        sortable: true, align: 'right', format: v => '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
        ]}
        data={rows}
      />
    </div>
  )
}
