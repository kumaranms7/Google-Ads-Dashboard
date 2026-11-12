import React, { useMemo, useState } from 'react'
import ReportTable from '../../../components/ReportTable.jsx'
import ExportButton from '../../../components/ExportButton.jsx'
import ManageKeywordModal from '../../keywords-manager/ManageKeywordModal.jsx'
import { Section, fmtUsd, fmtNum, fmtPct, SeverityBadge, ComingSoon, AiRecCell, computeKwPerfIssues, computeKwPerfOpportunities, PauseKeywordAction } from '../shared.jsx'

// Keyword Performance rows come from fetchKeywordAnalysisData, which labels
// status "Enabled" and match type in Title Case ("Exact"/"Phrase"/"Broad").
// ManageKeywordModal — shared with Keywords Manager — expects the "Active"
// status label and UPPERCASE match type its own data source (keywordManagerClient.js)
// uses. Normalize here rather than touching the shared modal or the audit fetch shape.
function toManageKeywordShape(row) {
  return {
    resourceName: row.resourceName,
    text:         row.text,
    matchType:    String(row.matchType || '').toUpperCase(),
    status:       row.status === 'Enabled' ? 'Active' : row.status,
    campaignId:   row.campaignId,
    adGroupId:    row.adGroupId,
    campaignName: row.campaign,
    adGroupName:  row.adGroup,
    // Performance metrics — the modal's AI recommendation call is grounded
    // in these, so carry them straight through from the audit row.
    impressions:  row.impressions,
    clicks:       row.clicks,
    ctr:          row.ctr,
    cost:         row.cost,
    cpc:          row.cpc,
    conversions:  row.conversions,
    qualityScore: row.qualityScore,
  }
}

function StatTile({ label, value, warn }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 14px' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: warn ? '#c0392b' : '#1a3a6b' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
    </div>
  )
}

export default function KeywordPerformanceTab({ kwAnalysis, kwLoading, kwError, tblProps, loading, aiRec, kwAiLoading, kwAiReady, onRetryAi, selectedAccount, onKwEdited }) {
  const issues = useMemo(() => computeKwPerfIssues(kwAnalysis), [kwAnalysis])
  const opportunities = useMemo(() => computeKwPerfOpportunities(kwAnalysis), [kwAnalysis])
  const [editingRow, setEditingRow] = useState(null)

  if (kwLoading) return <Section title="Keyword Performance"><div style={{ padding: 30, textAlign: 'center', color: '#888', fontSize: 12 }}>Loading keyword performance data…</div></Section>
  if (kwError) return <Section title="Keyword Performance"><div style={{ padding: '12px 16px', color: '#c0392b', fontSize: 12 }}>{kwError}</div></Section>
  if (!kwAnalysis) return <Section title="Keyword Performance"><ComingSoon>Run the audit to load keyword performance findings.</ComingSoon></Section>

  const baseCols = [
    { key: 'text',        label: 'Keyword', sortable: true, align: 'left', width: 220, wrap: true, format: v => <span style={{ fontWeight: 500, color: '#1a3a6b' }}>{v}</span> },
    { key: 'matchType',   label: 'Match Type', sortable: true, align: 'center' },
    { key: 'campaign', label: 'Campaign / Ad Group', sortable: true, align: 'left', width: 220,
      format: (v, row) => <span>{v || '—'}<br /><span style={{ fontSize: 11, color: '#888' }}>{row.adGroup || '—'}</span></span> },
    { key: 'impressions', label: 'Impr.', sortable: true, align: 'right', format: fmtNum },
    { key: 'clicks',      label: 'Clicks', sortable: true, align: 'right', format: fmtNum },
    { key: 'ctr',         label: 'CTR', sortable: true, align: 'right', format: fmtPct },
    { key: 'cpc',         label: 'CPC', sortable: true, align: 'right', format: fmtUsd },
    { key: 'cost',        label: 'Cost', sortable: true, align: 'right', format: fmtUsd },
    { key: 'conversions', label: 'Conv.', sortable: true, align: 'right', format: fmtNum },
    { key: 'qualityScore', label: 'Quality Score', sortable: true, align: 'center', format: v => v > 0 ? v : '—' },
  ]
  const issueCol    = { key: 'issue',    label: 'Issue',    sortable: true, align: 'left' }
  const severityCol = { key: 'severity', label: 'Severity', sortable: true, align: 'center', format: v => <SeverityBadge value={v} /> }
  const actionCol   = { key: '_action',  label: 'Action',   sortable: false, align: 'center',
    format: (_, row) => (
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <button
          onClick={() => setEditingRow(row)}
          disabled={!row.resourceName || !selectedAccount}
          style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', background: 'none', color: '#1a3a6b', border: '1px solid #dde9f5', borderRadius: 5, cursor: (!row.resourceName || !selectedAccount) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
        >
          Edit
        </button>
        <PauseKeywordAction row={row} selectedAccount={selectedAccount} />
      </span>
    ) }
  const aiColFor = section => ({
    key: '_ai', label: '🤖 AI Suggestion', sortable: false, align: 'left', wrap: true,
    format: (_, row) => {
      const idx = row._aiIdx ?? 0
      return <AiRecCell rec={aiRec(section, idx)} loading={kwAiLoading} rowLoading={false} aiReady={kwAiReady} onRetry={() => onRetryAi(section, idx)} />
    },
  })
  const withIdx = arr => arr.map((row, i) => ({ ...row, _aiIdx: i }))

  return (
    <div>
      {editingRow && (
        <ManageKeywordModal
          keyword={toManageKeywordShape(editingRow)}
          selectedAccount={selectedAccount}
          onClose={() => setEditingRow(null)}
          onSaved={() => { setEditingRow(null); onKwEdited?.() }}
        />
      )}

      <div className="card" style={{ marginBottom: 20, padding: '14px 20px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Overview</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <StatTile label="Total Keywords" value={fmtNum(kwAnalysis.totalKeywords)} />
          <StatTile label="With Conversions" value={fmtNum(kwAnalysis.withConvCount)} />
          <StatTile label="Avg Quality Score" value={kwAnalysis.avgQs ? kwAnalysis.avgQs.toFixed(1) : '—'} />
          <StatTile label="High Spend, No Conv." value={fmtNum(kwAnalysis.highSpendNoConvCount)} warn={kwAnalysis.highSpendNoConvCount > 0} />
        </div>
      </div>

      <Section title="Keyword Issues" count={issues.length} extra={<ExportButton data={issues} filename="keyword-performance-issues" />}>
        <div style={{ padding: '10px 14px', fontSize: 11.5, color: '#888', borderBottom: '1px solid #f0f4f8' }}>
          The AI Suggestion column explains why each keyword is flagged and what to do about it — click Retry if it hasn't loaded yet.
        </div>
        <ReportTable resizable columns={[...baseCols, issueCol, severityCol, aiColFor('kwIssues'), actionCol]} data={withIdx(issues)} loading={loading} {...tblProps} emptyMessage="No keyword performance issues found." />
      </Section>

      <Section title="High-Converting Keywords" count={opportunities.length} extra={<ExportButton data={opportunities} filename="keyword-performance-opportunities" />}>
        <div style={{ padding: '10px 14px', fontSize: 11.5, color: '#888', borderBottom: '1px solid #f0f4f8' }}>
          Your best-converting keywords — the AI Suggestion column suggests what to do next (e.g. raise bids, expand match type, add closely related keywords).
        </div>
        <ReportTable resizable columns={[...baseCols, severityCol, aiColFor('kwOpportunities')]} data={withIdx(opportunities)} loading={loading} {...tblProps} emptyMessage="No converting keywords in the selected date range." />
      </Section>
    </div>
  )
}
