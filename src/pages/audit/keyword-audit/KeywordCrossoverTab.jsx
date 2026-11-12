import React, { useMemo, useState } from 'react'
import ReportTable from '../../../components/ReportTable.jsx'
import ExportButton from '../../../components/ExportButton.jsx'
import { Section, AiRecCell, SeverityBadge } from '../shared.jsx'

// Positive keyword ↔ positive keyword — same keyword text repeated across ad
// groups/campaigns (duplication / cannibalization). NOT to be confused with
// Keyword Conflict (positive vs negative) in the sibling tab.
export default function KeywordCrossoverTab({ data, aiRec, aiLoading, aiRowLoading, aiReady, onRetryAi, tblProps, withIdx, loading }) {
  const conflicts = data?.keywords?.conflicts || []
  const [filters, setFilters] = useState({ campaignName: '', adGroupName: '' })

  const campaignNames = useMemo(() => [...new Set(conflicts.map(c => c.campaign).filter(Boolean))].sort(), [conflicts])
  const adGroupNames = useMemo(() => {
    const source = filters.campaignName ? conflicts.filter(c => c.campaign === filters.campaignName) : conflicts
    return [...new Set(source.flatMap(c =>
      c.adGroupEntries ? c.adGroupEntries.map(e => e.adGroup) : c.adGroups.split(', ').map(s => s.trim())
    ).filter(Boolean))].sort()
  }, [conflicts, filters.campaignName])

  const filtered = useMemo(() => conflicts.filter(c =>
    (!filters.campaignName || c.campaign === filters.campaignName) &&
    (!filters.adGroupName || (c.adGroupEntries
      ? c.adGroupEntries.some(e => e.adGroup === filters.adGroupName)
      : c.adGroups.split(', ').some(ag => ag.trim() === filters.adGroupName)))
  ), [conflicts, filters])

  const withExportAi = (sectionKey, exportArr, fullArr = exportArr) =>
    exportArr.map(row => ({ ...row, 'AI Suggestion': aiRec(sectionKey, fullArr.indexOf(row)) || '' }))

  return (
    <Section title="Keyword Crossover" count={conflicts.length} deduction={conflicts.length > 0 ? '10' : null} extra={
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, fontWeight: 600 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#2e7d32' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2e7d32', display: 'inline-block' }} /> Enabled</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#a56700' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#a56700', display: 'inline-block' }} /> Paused</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#9e9e9e' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9e9e9e', display: 'inline-block' }} /> Removed</span>
        </div>
        <ExportButton data={withExportAi('conflicts', filtered, conflicts)} filename="keyword-crossover" />
      </div>
    }>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f4f8', background: '#fafcff', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        {[['Campaign Name', 'campaignName', campaignNames], ['Ad Group Name', 'adGroupName', adGroupNames]].map(([label, key, opts]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap' }}>{label}:</span>
            <select
              value={filters[key]}
              onChange={e => {
                const val = e.target.value
                setFilters(f => ({ ...f, [key]: val, ...(key === 'campaignName' ? { adGroupName: '' } : {}) }))
              }}
              style={{ padding: '4px 10px', border: '1px solid #dde9f5', borderRadius: 5, fontSize: 12, color: '#1a3a6b', outline: 'none', cursor: 'pointer', background: '#fff' }}
            >
              <option value="">All</option>
              {opts.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        ))}
        {(filters.campaignName || filters.adGroupName) && (
          <button onClick={() => setFilters({ campaignName: '', adGroupName: '' })} style={{ fontSize: 11, color: '#2563b0', background: 'none', border: '1px solid #dde9f5', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}>Clear</button>
        )}
        <span style={{ fontSize: 11, color: '#888', marginLeft: 'auto' }}>{filtered.length} of {conflicts.length}</span>
      </div>
      <ReportTable
        noFilter
        resizable
        columns={[
          { key: 'keyword', label: 'Keyword', sortable: true, align: 'left', width: 220, wrap: true,
            format: (v, row) => {
              const c = row.status === 'Enabled' ? '#2e7d32' : row.status === 'Paused' ? '#a56700' : row.status === 'Removed' ? '#9e9e9e' : '#1a3a6b'
              return <span style={{ color: c, fontWeight: 500 }}>{v}</span>
            } },
          { key: 'campaign', label: 'Campaign', sortable: true, align: 'left', width: 180,
            format: (v, row) => {
              const c = row.campaignStatus === 'Enabled' ? '#2e7d32' : row.campaignStatus === 'Paused' ? '#a56700' : row.campaignStatus === 'Removed' ? '#9e9e9e' : '#1a3a6b'
              return <span style={{ color: c, fontWeight: 500 }}>{v}</span>
            } },
          { key: 'adGroupEntries', label: 'Ad Groups & Match Types', sortable: false, align: 'left',
            format: (v, row) => {
              const entries = v?.length ? v : (row.adGroups || '').split(', ').filter(Boolean).map(ag => ({ adGroup: ag, matchType: '', status: '' }))
              return (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {entries.map((e, i) => {
                    const sc = e.status === 'Enabled' ? '#2e7d32' : e.status === 'Paused' ? '#a56700' : e.status === 'Removed' ? '#9e9e9e' : '#1a3a6b'
                    return (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#f0f4fb', border: '1px solid #dde9f5', color: sc, fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {e.adGroup}
                        {e.matchType && <span style={{ opacity: 0.65, fontWeight: 400, fontSize: 10 }}>[{e.matchType}]</span>}
                      </span>
                    )
                  })}
                </div>
              )
            } },
          { key: 'issueType', label: 'Issue', sortable: true, align: 'left',
            format: (v, row) => {
              const base = row.issueBase || v; const isDup = base === 'Duplicate'
              return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: isDup ? 'rgba(224,92,42,0.12)' : 'rgba(240,180,41,0.15)', color: isDup ? '#c0392b' : '#8a6000', border: isDup ? '1px solid rgba(224,92,42,0.3)' : '1px solid rgba(240,180,41,0.4)', whiteSpace: 'nowrap' }}>{v}</span>
            } },
          { key: '_severity', label: 'Severity', sortable: false, align: 'center',
            format: (_, row) => <SeverityBadge value={(row.issueBase || row.issueType) === 'Duplicate' ? 'Medium' : 'High'} /> },
          { key: '_ai', label: '🤖 AI Suggestion', sortable: false, align: 'left', wrap: true,
            format: (_, row) => <AiRecCell rec={aiRec('conflicts', row._aiIdx ?? 0)} loading={aiLoading} rowLoading={aiRowLoading.has(`conflicts-${row._aiIdx ?? 0}`)} aiReady={aiReady} onRetry={() => onRetryAi('conflicts', row._aiIdx ?? 0)} /> },
        ]}
        data={withIdx(filtered)}
        loading={loading}
        {...tblProps}
        emptyMessage="No keyword crossover detected — clean keyword structure!"
      />
    </Section>
  )
}
