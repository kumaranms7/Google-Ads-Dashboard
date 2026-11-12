import React from 'react'

// ── Formatters ───────────────────────────────────────────────────────────────
const fmt = {
  num:  v => Number(v ?? 0).toLocaleString(),
  usd:  v => '$' + Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  pct:  v => Number(v ?? 0).toFixed(2) + '%',
  cpc:  v => '$' + Number(v ?? 0).toFixed(2),
}

const KPI_DEFS = [
  // Row 1
  { key: 'impressions', label: 'Impressions', format: 'num' },
  { key: 'clicks',      label: 'Clicks',      format: 'num' },
  { key: 'spend',       label: 'Total Spend', format: 'usd' },
  { key: 'conversions', label: 'Conversions', format: 'num' },
  // Row 2
  { key: 'ctr',      label: 'CTR',            format: 'pct' },
  { key: 'avgCpc',   label: 'Avg. CPC',       format: 'cpc' },
  { key: 'convRate', label: 'Conv. Rate',      format: 'pct' },
  { key: 'cpa',      label: 'Cost / Conv.',    format: 'cpc' },
]

function delta(current, previous) {
  if (previous == null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

function DeltaBadge({ pct }) {
  if (pct == null) return null
  const up = pct >= 0
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      fontSize: 11, fontWeight: 600,
      color:      up ? '#4caf50' : '#e05c2a',
      background: up ? 'rgba(76,175,80,0.1)' : 'rgba(224,92,42,0.1)',
      borderRadius: 4, padding: '2px 6px',
    }}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

function KPICard({ def, value, prevValue }) {
  const formatted = fmt[def.format]?.(value) ?? value
  const d = delta(value, prevValue)

  return (
    <div style={{
      background: '#dde9f5',
      border: '1px solid #c8d9ed',
      borderRadius: 8,
      padding: '13px 15px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {def.label}
        </span>
        <DeltaBadge pct={d} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#1a3a6b', lineHeight: 1.1 }}>
        {formatted}
      </div>
      <div style={{ fontSize: 11, color: '#7a90ab' }}>vs previous period</div>
    </div>
  )
}

export default function KPICards({ kpis, previousKpis }) {
  if (!kpis) return null
  const row1 = KPI_DEFS.slice(0, 4)
  const row2 = KPI_DEFS.slice(4)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {row1.map(def => (
          <KPICard key={def.key} def={def} value={kpis[def.key]} prevValue={previousKpis?.[def.key]} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {row2.map(def => (
          <KPICard key={def.key} def={def} value={kpis[def.key]} prevValue={previousKpis?.[def.key]} />
        ))}
      </div>
    </div>
  )
}
