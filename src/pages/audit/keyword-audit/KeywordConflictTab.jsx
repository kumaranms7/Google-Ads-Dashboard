import React, { useMemo, useState } from 'react'
import ReportTable from '../../../components/ReportTable.jsx'
import ExportButton from '../../../components/ExportButton.jsx'
import { Section, SeverityBadge, ComingSoon, AiRecCell, NegativeKeywordAction } from '../shared.jsx'

const LEVEL_LABEL = { CAMPAIGN: 'Campaign', AD_GROUP: 'Ad Group', LIST: 'Negative List' }

// Positive keyword ↔ negative keyword — a negative that blocks or might block
// a positive keyword. NOT the same as Keyword Crossover (positive vs positive).
export default function KeywordConflictTab({ conflictData, conflictLoading, conflictError, tblProps, loading, aiRec, conflictAiLoading, conflictAiReady, onRetryAi, selectedAccount }) {
  const conflicts = conflictData?.conflicts || []
  // _aiIdx reflects position in the ORIGINAL unfiltered list — that's the
  // order the AI recommendations were generated in, so it must survive the
  // level filter below or filtered rows would show another row's AI text.
  const withIdx = useMemo(() => conflicts.map((c, i) => ({ ...c, _aiIdx: i })), [conflicts])
  const [levelFilter, setLevelFilter] = useState('')

  const filtered = useMemo(() => levelFilter ? withIdx.filter(c => c.negativeLevel === levelFilter) : withIdx, [withIdx, levelFilter])

  if (conflictLoading) {
    return <Section title="Keyword Conflict"><div style={{ padding: 30, textAlign: 'center', color: '#888', fontSize: 12 }}>Scanning positive keywords against campaign, ad group, and list negatives…</div></Section>
  }
  if (conflictError) {
    return <Section title="Keyword Conflict"><div style={{ padding: '12px 16px', color: '#c0392b', fontSize: 12 }}>{conflictError}</div></Section>
  }
  if (!conflictData) {
    return <Section title="Keyword Conflict"><ComingSoon>Run the audit to scan for negative keywords that could be blocking your own positive keywords.</ComingSoon></Section>
  }

  return (
    <Section title="Keyword Conflict" count={conflicts.length} extra={<ExportButton data={filtered} filename="keyword-conflict" />}>
      <div style={{ padding: '10px 14px', fontSize: 11.5, color: '#888', borderBottom: '1px solid #f0f4f8' }}>
        A negative keyword at any level (campaign, ad group, or an attached list) that could stop one of your own positive keywords from showing.
      </div>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f4f8', background: '#fafcff', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#555' }}>Negative Level:</span>
          <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)} style={{ padding: '4px 10px', border: '1px solid #dde9f5', borderRadius: 5, fontSize: 12, color: '#1a3a6b', outline: 'none', cursor: 'pointer', background: '#fff' }}>
            <option value="">All</option>
            {Object.entries(LEVEL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <span style={{ fontSize: 11, color: '#888', marginLeft: 'auto' }}>{filtered.length} of {conflicts.length}</span>
      </div>
      <ReportTable
        noFilter
        resizable
        columns={[
          { key: 'positiveKeyword', label: 'Positive Keyword', sortable: true, align: 'left', width: 200, wrap: true,
            format: (v, row) => <span style={{ color: '#1a3a6b', fontWeight: 500 }}>{v} <span style={{ opacity: 0.6, fontSize: 10 }}>[{row.positiveMatchType}]</span></span> },
          { key: 'negativeKeyword', label: 'Negative Keyword', sortable: true, align: 'left', width: 200, wrap: true,
            format: (v, row) => <span style={{ color: '#c0392b', fontWeight: 500 }}>{v} <span style={{ opacity: 0.6, fontSize: 10 }}>[{row.negativeMatchType}]</span></span> },
          { key: 'negativeLevel', label: 'Negative Level', sortable: true, align: 'center',
            format: (v, row) => <span style={{ fontSize: 10.5, fontWeight: 600, color: '#555', background: '#eef2f7', borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap' }}>{LEVEL_LABEL[v] || v}{v === 'LIST' && row.listName ? ` (${row.listName})` : ''}</span> },
          { key: 'campaign', label: 'Campaign / Ad Group', sortable: true, align: 'left', width: 220,
            format: (v, row) => <span>{v}<br /><span style={{ fontSize: 11, color: '#888' }}>{row.adGroup}</span></span> },
          { key: 'conflictType', label: 'Conflict Type', sortable: true, align: 'left' },
          { key: 'severity', label: 'Severity', sortable: true, align: 'center', format: v => <SeverityBadge value={v} /> },
          { key: '_ai', label: '🤖 AI Suggestion', sortable: false, align: 'left', wrap: true,
            format: (_, row) => <AiRecCell rec={aiRec('keywordConflicts', row._aiIdx ?? 0)} loading={conflictAiLoading} rowLoading={false} aiReady={conflictAiReady} onRetry={() => onRetryAi('keywordConflicts', row._aiIdx ?? 0)} /> },
          { key: '_action', label: 'Action', sortable: false, align: 'center',
            format: (_, row) => <NegativeKeywordAction row={row} selectedAccount={selectedAccount} /> },
        ]}
        data={filtered}
        loading={loading}
        {...tblProps}
        emptyMessage="No positive-vs-negative keyword conflicts detected."
      />
    </Section>
  )
}
