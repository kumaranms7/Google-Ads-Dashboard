import React, { useMemo, useState } from 'react'
import ReportTable from '../../../components/ReportTable.jsx'
import ExportButton from '../../../components/ExportButton.jsx'
import SearchTermPublishModal from '../../../components/SearchTermPublishModal.jsx'
import { Section, fmtUsd, fmtNum, fmtPct, ComingSoon, computeSearchTermPositives, computeSearchTermNegatives } from '../shared.jsx'

function StatTile({ label, value, warn }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 14px' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: warn ? '#c0392b' : '#1a3a6b' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
    </div>
  )
}

// Combines action + target campaign/ad group + match type + level into one
// cell — everything "Proceed to Publish" is about to pre-select, shown up
// front so the user isn't surprised by what the modal opens with.
function RecommendationCell({ row, action }) {
  const meta = action === 'Add as Negative' ? { bg: 'rgba(224,92,42,0.12)', color: '#c0392b' } : { bg: 'rgba(76,175,80,0.12)', color: '#2e7d32' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: meta.bg, color: meta.color, width: 'fit-content' }}>{action}</span>
      <span style={{ fontSize: 11.5, color: '#1a3a6b' }}>{row.recCampaign || row.campaign || '—'} <span style={{ color: '#aaa' }}>→</span> {row.recAdGroup || row.adGroup || '—'}</span>
      <span style={{ fontSize: 10.5, color: '#888' }}>{row.recMatchType} match · {row.recLevel} level</span>
    </div>
  )
}

// One table + its own selection state and publish trigger — Positive and
// Negative Opportunities each get their own instance so selecting rows in
// one doesn't affect the other. Built on the shared ReportTable so it gets
// pagination + rows-per-page for free; the CSV export is a curated shape
// matching exactly what the columns show (not a raw dump of the row, which
// also carries internal routing fields like campaignId/adGroupId).
function TermsTable({ rows, selectedAccount, filename, emptyMessage, description, action, onPublish }) {
  const [selected, setSelected] = useState(new Set())
  // Which table the publish was triggered from decides the modal's default
  // Keyword Type, so the user doesn't have to re-select it every time.
  const modalKwType = action === 'Add as Negative' ? 'Negative Keyword' : 'Keyword'

  function toggleRow(key) {
    setSelected(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  }
  function toggleAllVisible(visibleKeys, allSelected) {
    setSelected(prev => {
      const next = new Set(prev)
      visibleKeys.forEach(k => allSelected ? next.delete(k) : next.add(k))
      return next
    })
  }

  const csvRows = useMemo(() => rows.map(r => ({
    'Search Term':     r.term,
    'Impr.':           fmtNum(r.impressions),
    'Clicks':          fmtNum(r.clicks),
    'CTR':             fmtPct(r.ctr),
    'Cost':            fmtUsd(r.cost),
    'Conv.':           fmtNum(r.conversions),
    'Suggestion':      action,
    'Target Campaign': r.recCampaign || r.campaign || '',
    'Target Ad Group': r.recAdGroup  || r.adGroup  || '',
    'Match Type':      r.recMatchType || '',
    'Level':           r.recLevel     || '',
  })), [rows, action])

  return (
    <>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: '#888' }}>{description}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {selected.size > 0 && selectedAccount && (
            <button onClick={() => onPublish(rows.filter(r => selected.has(r.term)), modalKwType)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#1a3a6b', color: '#fff', fontSize: 12, fontWeight: 600, borderRadius: 5, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              🚀 Proceed to Publish {selected.size} selected
            </button>
          )}
          <ExportButton data={csvRows} filename={filename} />
        </div>
      </div>
      <ReportTable
        pagination defaultPageSize={25}
        selectable rowKey={r => r.term} selectedKeys={selected}
        onToggleRow={toggleRow} onToggleAllVisible={toggleAllVisible}
        emptyMessage={emptyMessage}
        columns={[
          { key: 'term',        label: 'Search Term', sortable: true, align: 'left' },
          { key: 'impressions', label: 'Impr.',   sortable: true, align: 'right', format: v => fmtNum(v) },
          { key: 'clicks',      label: 'Clicks',  sortable: true, align: 'right', format: v => fmtNum(v) },
          { key: 'ctr',         label: 'CTR',     sortable: true, align: 'right', format: v => fmtPct(v) },
          { key: 'cost',        label: 'Cost',    sortable: true, align: 'right', format: v => fmtUsd(v) },
          { key: 'conversions', label: 'Conv.',   sortable: true, align: 'right', format: v => fmtNum(v) },
          { key: '_rec', label: 'Suggestion', sortable: false, align: 'left', wrap: true,
            format: (_, row) => <RecommendationCell row={row} action={action} /> },
          { key: '_action', label: '', sortable: false, align: 'center',
            format: (_, row) => selectedAccount && (
              <button onClick={() => onPublish([row], modalKwType)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'none', color: '#1a3a6b', fontSize: 11, fontWeight: 600, borderRadius: 5, border: '1px solid #dde9f5', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                🚀 Proceed to Publish
              </button>
            ) },
        ]}
        data={rows}
      />
    </>
  )
}

export default function SearchTermsTab({ stAnalysis, stLoading, stError, selectedAccount, data }) {
  const positives = useMemo(() => computeSearchTermPositives(stAnalysis, data), [stAnalysis, data])
  const negatives = useMemo(() => computeSearchTermNegatives(stAnalysis), [stAnalysis])
  const [publish, setPublish] = useState(null) // { rows, kwType } | null

  if (stLoading) return <Section title="Search Terms"><div style={{ padding: 30, textAlign: 'center', color: '#888', fontSize: 12 }}>Loading search term analysis…</div></Section>
  if (stError) return <Section title="Search Terms"><div style={{ padding: '12px 16px', color: '#c0392b', fontSize: 12 }}>{stError}</div></Section>
  if (!stAnalysis) return <Section title="Search Terms"><ComingSoon>Run the audit to load search term findings.</ComingSoon></Section>

  const ov = stAnalysis.overview

  // Pre-fill the publish modal from the FIRST row's recommendation — for a
  // bulk selection spanning different ad groups the user still picks per
  // their judgment, this just saves the common case of re-selecting what
  // was already recommended.
  const primary = publish?.rows?.[0]

  return (
    <div>
      <div className="card" style={{ marginBottom: 20, padding: '14px 20px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Overview</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <StatTile label="Search Terms" value={fmtNum(ov.totalCount)} />
          <StatTile label="Converting" value={fmtNum(ov.convertingCount)} />
          <StatTile label="Total Spend" value={fmtUsd(ov.totalSpend)} />
          <StatTile label="Wasted Spend (No Conv.)" value={fmtUsd(ov.totalWasted)} warn={ov.totalWasted > 0} />
        </div>
      </div>

      <Section title="Positive Opportunities" count={positives.length}>
        <TermsTable
          rows={positives} selectedAccount={selectedAccount} filename="search-terms-positive"
          description="Converting search terms not yet added as their own keyword — commercial intent, location-specific, or otherwise high-value."
          emptyMessage="No new keyword opportunities found in converting search terms."
          action="Add as Keyword"
          onPublish={(rows, kwType) => setPublish({ rows, kwType })}
        />
      </Section>

      <Section title="Negative Opportunities" count={negatives.length}>
        <TermsTable
          rows={negatives} selectedAccount={selectedAccount} filename="search-terms-negative"
          description="Informational, competitor-research, low-intent, or otherwise irrelevant traffic spending budget without converting."
          emptyMessage="No wasted-spend search terms found."
          action="Add as Negative"
          onPublish={(rows, kwType) => setPublish({ rows, kwType })}
        />
      </Section>

      {publish && selectedAccount && (
        <SearchTermPublishModal
          rows={publish.rows.map(r => ({ ...r, searchTerm: r.term }))}
          initialKwType={publish.kwType}
          initialMatchType={primary?.recMatchType}
          initialLevel={primary?.recLevel}
          initialCampaignId={primary?.recCampaignId || primary?.campaignId}
          initialAdGroupId={primary?.recAdGroupId || primary?.adGroupId}
          selectedAccount={selectedAccount}
          onClose={() => setPublish(null)}
          onSuccess={() => setPublish(null)}
        />
      )}
    </div>
  )
}
