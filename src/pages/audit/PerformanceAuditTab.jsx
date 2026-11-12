import React, { useMemo } from 'react'
import ReportTable from '../../components/ReportTable.jsx'
import { Section, SeverityBadge, ComingSoon, AiRecCell, computeTopOffenders, PauseKeywordAction } from './shared.jsx'

// Cross-cutting rollup — no new fetch of its own. Pulls the top offenders
// already computed for other sections (Keyword Performance, Ad/RSA Audit,
// Campaign Audit) into one synthesis view, per the plan's "reuse, don't
// re-fetch" approach.
export default function PerformanceAuditTab({ data, kwAnalysis, adAnalysis, tblProps, loading, aiRec, performanceAiLoading, performanceAiReady, onRetryAi, selectedAccount }) {
  const allOffenders = useMemo(() => computeTopOffenders({ data, kwAnalysis, adAnalysis }), [data, kwAnalysis, adAnalysis])

  if (!kwAnalysis && !adAnalysis && !data) {
    return <Section title="Performance Audit"><ComingSoon>Run the audit to load performance findings.</ComingSoon></Section>
  }

  return (
    <Section title="Top Performance Offenders" count={allOffenders.length}>
      <div style={{ padding: '10px 14px', fontSize: 11.5, color: '#888', borderBottom: '1px solid #f0f4f8' }}>
        Combines the worst keywords, ads, and campaigns already surfaced elsewhere in this audit — nothing here is fetched separately. Keyword rows can be paused directly.
      </div>
      <ReportTable
        columns={[
          { key: 'entity',   label: 'Entity', sortable: true, align: 'left' },
          { key: 'type',     label: 'Type', sortable: true, align: 'center' },
          { key: 'metric',   label: 'Issue', sortable: true, align: 'left' },
          { key: 'value',    label: 'Value', sortable: false, align: 'right' },
          { key: 'severity', label: 'Severity', sortable: true, align: 'center', format: v => <SeverityBadge value={v} /> },
          { key: '_ai', label: '🤖 AI Suggestion', sortable: false, align: 'left', wrap: true,
            format: (_, row) => {
              const idx = row._aiIdx ?? 0
              return <AiRecCell rec={aiRec('performanceOffenders', idx)} loading={performanceAiLoading} rowLoading={false} aiReady={performanceAiReady} onRetry={() => onRetryAi('performanceOffenders', idx)} />
            } },
          { key: '_action', label: 'Action', sortable: false, align: 'center',
            format: (_, row) => <PauseKeywordAction row={row} selectedAccount={selectedAccount} /> },
        ]}
        data={allOffenders.map((row, i) => ({ ...row, _aiIdx: i }))}
        loading={loading}
        {...tblProps}
        emptyMessage="No significant performance offenders found."
      />
    </Section>
  )
}
