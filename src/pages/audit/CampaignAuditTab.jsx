import React, { useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import ReportTable from '../../components/ReportTable.jsx'
import ExportButton from '../../components/ExportButton.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import Modal from '../../components/Modal.jsx'
import { Section, fmtUsd, fmtNum, UtilBar, AiRecCell, SeverityBadge, InnerTabStrip, ComingSoon, PdfHeading } from './shared.jsx'

const SUB_TAB_INFO = {
  structure: { title: 'Campaign Structure', description: 'Inactive ad groups and overlapping campaign types (e.g. PMax vs Search) that may be competing with each other.' },
  budget:    { title: 'Budget & Bidding',   description: 'Campaigns overpacing, limited by budget, or with no recent activity.' },
  location:  { title: 'Location Targeting', description: 'Location targeting coverage per campaign — how many locations are targeted or excluded.' },
  schedule:  { title: 'Ad Schedule',        description: 'Performance by day/hour of week.' },
}

function LocationInfoButton({ locations, title, onOpen }) {
  if (!locations || locations.length === 0) return null
  return (
    <button
      onClick={() => onOpen({ title, locations })}
      title={`View ${title.toLowerCase()}`}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'none', color: '#2563b0', cursor: 'pointer', padding: 0, marginLeft: 6, verticalAlign: 'middle' }}
    >
      <Info size={13} />
    </button>
  )
}

const SUB_TABS = [
  { id: 'structure', label: 'Campaign Structure' },
  { id: 'budget',    label: 'Budget & Bidding' },
  { id: 'location',  label: 'Location Targeting' },
  { id: 'schedule',  label: 'Ad Schedule' },
]

export default function CampaignAuditTab({ data, structureData, aiRec, aiLoading, aiRowLoading, aiReady, onRetryAi, tblProps, withIdx, loading, pdfMode }) {
  const [sub, setSub] = useState('structure')
  const [locModal, setLocModal] = useState(null) // { title, locations } | null
  const { campaigns = [], adGroups = [], crossovers = [] } = data || {}

  const budgetIssues = useMemo(() => campaigns.filter(c => c.issue), [campaigns])
  const agIssues     = useMemo(() => adGroups.filter(a => a.impressions === 0 && ['ENABLED', '2'].includes(String(a.status))), [adGroups])

  const [budgetCampFilter, setBudgetCampFilter] = useState('')
  const budgetCampStatuses = useMemo(() => [...new Set(budgetIssues.map(c => c.status).filter(Boolean))].sort(), [budgetIssues])
  const filteredBudgetIssues = useMemo(() => budgetCampFilter ? budgetIssues.filter(c => c.status === budgetCampFilter) : budgetIssues, [budgetIssues, budgetCampFilter])

  const withExportAi = (sectionKey, exportArr, fullArr = exportArr) =>
    exportArr.map(row => ({ ...row, 'AI Suggestion': aiRec(sectionKey, fullArr.indexOf(row)) || '' }))

  const counts = { structure: agIssues.length + crossovers.length, budget: budgetIssues.length, location: 0, schedule: 0 }

  return (
    <div>
      {!pdfMode && <InnerTabStrip tabs={SUB_TABS} activeTab={sub} onChange={setSub} counts={counts} />}

      {(sub === 'structure' || pdfMode) && (
        <>
          {pdfMode && <PdfHeading level={2} {...SUB_TAB_INFO.structure} />}
          <Section title="Ad Group Health" count={agIssues.length} deduction={agIssues.length > 0 ? `${Math.min(agIssues.length * 3, 15)}` : null}>
            <ReportTable
              columns={[
                { key: 'name',        label: 'Ad Group', sortable: true, align: 'left', width: 200 },
                { key: 'campaign',    label: 'Campaign', sortable: true, align: 'left', width: 180 },
                { key: 'status',      label: 'Ad Group Status', sortable: true, align: 'center', format: v => v ? <StatusBadge value={v} /> : '—' },
                { key: 'impressions', label: 'Impr.', sortable: true, align: 'right', format: fmtNum },
                { key: 'clicks',      label: 'Clicks', sortable: true, align: 'right', format: fmtNum },
                { key: 'conversions', label: 'Conv.', sortable: true, align: 'right', format: fmtNum },
                { key: '_severity',   label: 'Severity', sortable: false, align: 'center', format: () => <SeverityBadge value="Medium" /> },
                aiRec ? { key: '_ai', label: '🤖 AI Suggestion', sortable: false, align: 'left', wrap: true,
                  format: (_, row) => <AiRecCell rec={aiRec('agIssues', row._aiIdx ?? 0)} loading={aiLoading} rowLoading={aiRowLoading.has(`agIssues-${row._aiIdx ?? 0}`)} aiReady={aiReady} onRetry={() => onRetryAi('agIssues', row._aiIdx ?? 0)} /> } : null,
              ].filter(Boolean)}
              data={withIdx(agIssues)}
              loading={loading}
              {...tblProps}
              emptyMessage="No inactive ad groups found — all enabled ad groups have impressions."
            />
          </Section>

          <Section title="Overlapping Campaign Types" count={crossovers.length} deduction={crossovers.length > 0 ? `${crossovers.length * 15}` : null} extra={<ExportButton data={withExportAi('crossovers', crossovers)} filename="campaign-structure-overlap" />}>
            <ReportTable
              columns={[
                { key: 'campaignA', label: 'Campaign A', sortable: false, align: 'left', width: 200 },
                { key: 'campaignB', label: 'Campaign B', sortable: false, align: 'left', width: 200 },
                { key: 'issueType', label: 'Issue', sortable: true, align: 'center',
                  format: v => <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(224,92,42,0.12)', color: '#c0392b', border: '1px solid rgba(224,92,42,0.3)' }}>{v}</span> },
                { key: '_severity', label: 'Severity', sortable: false, align: 'center', format: () => <SeverityBadge value="High" /> },
                { key: '_ai', label: '🤖 AI Suggestion', sortable: false, align: 'left', wrap: true,
                  format: (_, row) => <AiRecCell rec={aiRec('crossovers', row._aiIdx ?? 0)} loading={aiLoading} rowLoading={aiRowLoading.has(`crossovers-${row._aiIdx ?? 0}`)} aiReady={aiReady} onRetry={() => onRetryAi('crossovers', row._aiIdx ?? 0)} /> },
              ]}
              data={withIdx(crossovers)}
              loading={loading}
              {...tblProps}
              emptyMessage="No overlapping campaign types detected (e.g. PMax vs Search, Search vs DSA)."
            />
          </Section>
        </>
      )}

      {(sub === 'budget' || pdfMode) && (
        <>
        {pdfMode && <PdfHeading level={2} {...SUB_TAB_INFO.budget} />}
        <Section title="Budget & Bidding Issues" count={budgetIssues.length} deduction={budgetIssues.length > 0 ? `${Math.min(budgetIssues.length * 5, 25)}` : null} extra={<ExportButton data={withExportAi('budgetIssues', filteredBudgetIssues, budgetIssues)} filename="budget-bidding-issues" />}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f4f8', background: '#fafcff', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap' }}>Campaign Status:</span>
              <select value={budgetCampFilter} onChange={e => setBudgetCampFilter(e.target.value)}
                style={{ padding: '4px 10px', border: '1px solid #dde9f5', borderRadius: 5, fontSize: 12, color: '#1a3a6b', outline: 'none', cursor: 'pointer', background: '#fff' }}>
                <option value="">All</option>
                {budgetCampStatuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {budgetCampFilter && (
              <button onClick={() => setBudgetCampFilter('')} style={{ fontSize: 11, color: '#2563b0', background: 'none', border: '1px solid #dde9f5', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}>Clear</button>
            )}
            <span style={{ fontSize: 11, color: '#888', marginLeft: 'auto' }}>{filteredBudgetIssues.length} of {budgetIssues.length}</span>
          </div>
          <ReportTable
            noFilter
            columns={[
              { key: 'name',        label: 'Campaign', sortable: true, align: 'left', width: 200 },
              { key: 'status',      label: 'Campaign Status', sortable: true, align: 'center', format: v => v ? <StatusBadge value={v} /> : '—' },
              { key: 'budget',      label: 'Daily Budget', sortable: true, align: 'right', format: fmtUsd },
              { key: 'spend',       label: 'Actual Spend', sortable: true, align: 'right', format: fmtUsd },
              { key: 'utilization', label: 'Utilization', sortable: true, align: 'center', format: v => <UtilBar pct={v} /> },
              { key: 'issue',       label: 'Issue', sortable: true, align: 'center',
                format: v => {
                  if (!v) return <span style={{ fontSize: 11, color: '#4caf50', fontWeight: 600 }}>OK</span>
                  const c = v === 'Overpacing' ? '#e05c2a' : v === 'No activity' ? '#888' : '#8a6000'
                  return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: `${c}22`, color: c, border: `1px solid ${c}44` }}>{v}</span>
                } },
              { key: '_severity', label: 'Severity', sortable: false, align: 'center',
                format: (_, row) => <SeverityBadge value={row.issue === 'Overpacing' ? 'High' : row.issue === 'No activity' ? 'Medium' : 'Low'} /> },
              { key: '_ai', label: '🤖 AI Suggestion', sortable: false, align: 'left', wrap: true,
                format: (_, row) => <AiRecCell rec={aiRec('budgetIssues', row._aiIdx ?? 0)} loading={aiLoading} rowLoading={aiRowLoading.has(`budgetIssues-${row._aiIdx ?? 0}`)} aiReady={aiReady} onRetry={() => onRetryAi('budgetIssues', row._aiIdx ?? 0)} /> },
            ]}
            data={withIdx(filteredBudgetIssues)}
            loading={loading}
            {...tblProps}
            emptyMessage="No budget or bidding issues detected"
          />
        </Section>
        </>
      )}

      {(sub === 'location' || pdfMode) && (
        <>
        {pdfMode && <PdfHeading level={2} {...SUB_TAB_INFO.location} />}
        <Section title="Location Targeting" count={(structureData?.geoTargets || []).length}>
          {!structureData ? (
            <ComingSoon>Run the audit to load location targeting data.</ComingSoon>
          ) : (
            <>
              <div style={{ padding: '10px 14px', fontSize: 11.5, color: '#888', borderBottom: '1px solid #f0f4f8' }}>
                Shows how many locations are targeted (and excluded) per campaign. Performance-by-location breakdowns aren't available yet — this is a coverage check only.
              </div>
              <ReportTable
                columns={[
                  { key: 'campaign', label: 'Campaign', sortable: true, align: 'left', width: 260, wrap: true },
                  { key: 'count',    label: 'Locations Targeted', sortable: true, align: 'right',
                    format: (v, row) => <span>{fmtNum(v)}<LocationInfoButton locations={row.targeted} title={`Locations Targeted — ${row.campaign}`} onOpen={setLocModal} /></span> },
                  { key: 'neg',      label: 'Locations Excluded', sortable: true, align: 'right',
                    format: (v, row) => <span>{fmtNum(v)}<LocationInfoButton locations={row.excluded} title={`Locations Excluded — ${row.campaign}`} onOpen={setLocModal} /></span> },
                  { key: '_flag',    label: 'Flag', sortable: false, align: 'center',
                    format: (_, row) => row.count === 0
                      ? <SeverityBadge value="Medium" />
                      : row.count > 20 ? <SeverityBadge value="Low" /> : <SeverityBadge value="Passed" /> },
                ]}
                data={structureData.geoTargets || []}
                loading={loading}
                {...tblProps}
                emptyMessage="No campaigns with location targeting found."
              />
            </>
          )}
        </Section>
        </>
      )}

      {(sub === 'schedule' || pdfMode) && (
        <>
        {pdfMode && <PdfHeading level={2} {...SUB_TAB_INFO.schedule} />}
        <Section title="Ad Schedule">
          <ComingSoon>Performance-by-day/hour data isn't collected anywhere in the app yet — this needs a new segmented query (segments.hour / segments.day_of_week) before ad schedule findings can be shown here.</ComingSoon>
        </Section>
        </>
      )}

      {locModal && (
        <Modal title={locModal.title} subtitle={`${locModal.locations.length} location${locModal.locations.length === 1 ? '' : 's'}`} onClose={() => setLocModal(null)} maxWidth={480}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {locModal.locations.map((l, i) => (
              <span key={i} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 12, background: '#eef4fc', color: '#1a3a6b', border: '1px solid #dde9f5' }}>{l.name}</span>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
