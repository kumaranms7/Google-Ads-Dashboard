import React, { useMemo } from 'react'
import { computeCategoryCounts, computeSeveritySummary } from './shared.jsx'

function CategoryRow({ label, count, unit, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 8, cursor: onClick ? 'pointer' : 'default', transition: 'background 0.12s' }}
      onMouseEnter={e => onClick && (e.currentTarget.style.background = '#f0f4f8')}
      onMouseLeave={e => onClick && (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ fontSize: 13, fontWeight: 500, color: '#1a3a6b' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: count > 0 ? '#c0392b' : '#4caf50' }}>
        {count} {unit}
      </span>
    </div>
  )
}

function SummaryTile({ label, value, color }) {
  return (
    <div style={{ flex: 1, minWidth: 100, textAlign: 'center', padding: '14px 8px' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11.5, color: '#888', marginTop: 2 }}>{label}</div>
    </div>
  )
}

export default function OverviewTab({ data, structureData, conflictData, kwAnalysis, stAnalysis, adAnalysis, assetAudit, onNavigate }) {
  const counts = useMemo(() => computeCategoryCounts({ data, structureData, conflictData, kwAnalysis, stAnalysis, adAnalysis, assetAudit }),
    [data, structureData, conflictData, kwAnalysis, stAnalysis, adAnalysis, assetAudit])

  const bySeverity = computeSeveritySummary(counts)

  return (
    <div>
      <div className="card" style={{ marginBottom: 20, padding: '18px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          <SummaryTile label="Total Issues" value={bySeverity.total} color="#1a3a6b" />
          <SummaryTile label="Critical" value={bySeverity.critical} color="#c0392b" />
          <SummaryTile label="High" value={bySeverity.high} color="#e05c2a" />
          <SummaryTile label="Medium" value={bySeverity.medium} color="#8a6000" />
          <SummaryTile label="Low / Opportunity" value={bySeverity.low} color="#666" />
        </div>
      </div>

      <div className="card" style={{ padding: '8px 8px' }}>
        <div style={{ padding: '10px 16px 4px', fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5 }}>By Category</div>
        <CategoryRow label="Campaign Audit"      count={counts.campaign}    unit="Issues" onClick={() => onNavigate('campaign')} />
        <CategoryRow label="Keyword Audit"       count={counts.keyword}     unit="Issues" onClick={() => onNavigate('keyword')} />
        <CategoryRow label="Ad / RSA Audit"      count={counts.adRsa}       unit="Issues" onClick={() => onNavigate('adRsa')} />
        <CategoryRow label="Asset Audit"         count={counts.asset}       unit="Issues" onClick={() => onNavigate('asset')} />
        <CategoryRow label="Conversion Tracking" count={counts.conversion}  unit="Issues" onClick={() => onNavigate('conversion')} />
        <CategoryRow label="Performance Audit"   count={counts.performance} unit="Issues" onClick={() => onNavigate('performance')} />
        <CategoryRow label="Duplicate Audit"     count={counts.duplicate}   unit="Issues" onClick={() => onNavigate('duplicate')} />
        <CategoryRow label="Policy & Disapproval" count={counts.policy}     unit="Issues" onClick={() => onNavigate('policy')} />
      </div>
    </div>
  )
}
