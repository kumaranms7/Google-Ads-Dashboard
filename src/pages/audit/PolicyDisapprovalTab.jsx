import React from 'react'
import ReportTable from '../../components/ReportTable.jsx'
import ExportButton from '../../components/ExportButton.jsx'
import { Section, fmtNum, AiRecCell, SeverityBadge } from './shared.jsx'

export default function PolicyDisapprovalTab({ data, aiRec, aiLoading, aiRowLoading, aiReady, onRetryAi, tblProps, withIdx, loading }) {
  const { ads = [] } = data || {}
  const disapproved = ads.filter(a => ['DISAPPROVED'].includes(String(a.approvalStatus)))
  const rows = disapproved.length > 0 ? disapproved : ads.filter(a => !['APPROVED', 'APPROVED_LIMITED', 'ELIGIBLE', '1', '2', '3'].includes(String(a.approvalStatus)))

  const withExportAi = (sectionKey, exportArr, fullArr = exportArr) =>
    exportArr.map(row => ({ ...row, 'AI Suggestion': aiRec(sectionKey, fullArr.indexOf(row)) || '' }))

  return (
    <Section
      title="Policy & Disapproval"
      count={disapproved.length}
      deduction={disapproved.length > 0 ? `${disapproved.length * 10}` : null}
      extra={<ExportButton data={withExportAi('policyIssues', disapproved).map(r => ({
        ...r,
        approvalStatus: (s => s === 'DISAPPROVED' ? 'Disapproved' : s.includes('REVIEW') ? 'Under Review' : 'Approved')(String(r.approvalStatus || '').toUpperCase()),
      }))} filename="policy-disapproval" />}
    >
      <div style={{ padding: '10px 14px', fontSize: 11.5, color: '#888', borderBottom: '1px solid #f0f4f8' }}>
        Only ad-level approval status is available from the Google Ads API today — keyword and asset policy signals aren't fetched anywhere in the app yet.
      </div>
      <ReportTable
        columns={[
          { key: 'campaign',       label: 'Campaign', sortable: true, align: 'left', width: 180 },
          { key: 'adGroup',        label: 'Ad Group', sortable: true, align: 'left', width: 160 },
          { key: 'approvalStatus', label: 'Status', sortable: true, align: 'center',
            format: v => {
              const s = String(v).toUpperCase()
              const c = s === 'DISAPPROVED' ? '#c0392b' : s.includes('REVIEW') ? '#8a6000' : '#2e7d32'
              const lbl = s === 'DISAPPROVED' ? 'Disapproved' : s.includes('REVIEW') ? 'Under Review' : 'Approved'
              return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: `${c}22`, color: c, border: `1px solid ${c}44` }}>{lbl}</span>
            } },
          { key: 'impressions', label: 'Impr.', sortable: true, align: 'right', format: fmtNum },
          { key: '_severity', label: 'Severity', sortable: false, align: 'center',
            format: (_, row) => <SeverityBadge value={String(row.approvalStatus).toUpperCase() === 'DISAPPROVED' ? 'Critical' : 'Medium'} /> },
          { key: '_ai', label: '🤖 AI Suggestion', sortable: false, align: 'left', wrap: true,
            format: (_, row) => <AiRecCell rec={aiRec('policyIssues', row._aiIdx ?? 0)} loading={aiLoading} rowLoading={aiRowLoading.has(`policyIssues-${row._aiIdx ?? 0}`)} aiReady={aiReady} onRetry={() => onRetryAi('policyIssues', row._aiIdx ?? 0)} /> },
        ]}
        data={withIdx(rows)}
        loading={loading}
        {...tblProps}
        emptyMessage="No policy or approval issues found"
      />
    </Section>
  )
}
