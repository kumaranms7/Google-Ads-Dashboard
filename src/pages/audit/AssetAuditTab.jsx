import React from 'react'
import { useNavigate } from 'react-router-dom'
import ReportTable from '../../components/ReportTable.jsx'
import { Section, SeverityBadge, ComingSoon, fmtNum } from './shared.jsx'

function StatTile({ label, value, warn }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 14px' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: warn ? '#c0392b' : '#1a3a6b' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
    </div>
  )
}

// Deep-links into AI Assets Builder at the tab for this asset type, per the
// same navigate(path, { state }) pattern the rest of the app uses for
// cross-page handoffs.
function AddAssetButton({ label, tab, navigate }) {
  return (
    <button
      onClick={() => navigate('/ai-sitelinks-builder', { state: { tab } })}
      style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: 11.5, fontWeight: 600, color: '#1a3a6b', background: '#fff', border: '1px solid #dde9f5', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' }}
    >
      + Add {label}
    </button>
  )
}

export default function AssetAuditTab({ assetAudit, assetLoading, assetError, tblProps, loading }) {
  const navigate = useNavigate()
  if (assetLoading) return <Section title="Asset Audit"><div style={{ padding: 30, textAlign: 'center', color: '#888', fontSize: 12 }}>Loading account-wide asset coverage…</div></Section>
  if (assetError) return <Section title="Asset Audit"><div style={{ padding: '12px 16px', color: '#c0392b', fontSize: 12 }}>{assetError}</div></Section>
  if (!assetAudit) return <Section title="Asset Audit"><ComingSoon>Run the audit to load sitelink, callout, and structured snippet coverage.</ComingSoon></Section>

  const { sitelinks = [], callouts = [], snippets = [], duplicateSitelinks = [], duplicateCallouts = [] } = assetAudit

  return (
    <div>
      <div className="card" style={{ marginBottom: 20, padding: '14px 20px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Account-Level Coverage</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <StatTile label="Sitelinks" value={fmtNum(sitelinks.length)} warn={sitelinks.length === 0} />
          <StatTile label="Callouts" value={fmtNum(callouts.length)} warn={callouts.length === 0} />
          <StatTile label="Structured Snippets" value={fmtNum(snippets.length)} warn={snippets.length === 0} />
          <StatTile label="Duplicate Sitelinks" value={fmtNum(duplicateSitelinks.length)} warn={duplicateSitelinks.length > 0} />
          <StatTile label="Duplicate Callouts" value={fmtNum(duplicateCallouts.length)} warn={duplicateCallouts.length > 0} />
        </div>
        <div style={{ fontSize: 11, color: '#aaa', marginTop: 10 }}>
          Call assets and per-asset policy/disapproval status aren't fetched anywhere in the app yet — only presence, text duplication, and enabled/paused/removed status can be checked here.
        </div>
      </div>

      {(sitelinks.length === 0 || callouts.length === 0 || snippets.length === 0) && (
        <Section title="Missing Assets">
          <div style={{ padding: '14px 16px' }}>
            {sitelinks.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <SeverityBadge value="Medium" /><span style={{ fontSize: 12.5, color: '#555' }}>No account-level sitelinks found.</span>
                <AddAssetButton label="Sitelinks" tab="sitelinks" navigate={navigate} />
              </div>
            )}
            {callouts.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <SeverityBadge value="Medium" /><span style={{ fontSize: 12.5, color: '#555' }}>No account-level callouts found.</span>
                <AddAssetButton label="Callouts" tab="callout" navigate={navigate} />
              </div>
            )}
            {snippets.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <SeverityBadge value="Low" /><span style={{ fontSize: 12.5, color: '#555' }}>No account-level structured snippets found.</span>
                <AddAssetButton label="Structured Snippets" tab="snippet" navigate={navigate} />
              </div>
            )}
          </div>
        </Section>
      )}

      {sitelinks.length > 0 && (
        <Section title="Sitelinks" count={sitelinks.length}>
          <ReportTable
            columns={[
              { key: 'headline',     label: 'Headline', sortable: true, align: 'left', format: (v, row) => <span style={{ fontWeight: 500, color: duplicateSitelinks.includes(v.toLowerCase().trim()) ? '#c0392b' : '#1a3a6b' }}>{v}</span> },
              { key: 'description1', label: 'Description 1', sortable: false, align: 'left' },
              { key: 'description2', label: 'Description 2', sortable: false, align: 'left' },
              { key: 'status',       label: 'Status', sortable: true, align: 'center' },
              { key: '_dup',         label: 'Flag', sortable: false, align: 'center', format: (_, row) => duplicateSitelinks.includes(row.headline.toLowerCase().trim()) ? <SeverityBadge value="Medium" /> : <SeverityBadge value="Passed" /> },
            ]}
            data={sitelinks}
            loading={loading}
            {...tblProps}
            emptyMessage="No sitelinks found."
          />
        </Section>
      )}

      {callouts.length > 0 && (
        <Section title="Callouts" count={callouts.length}>
          <ReportTable
            columns={[
              { key: 'text',   label: 'Callout Text', sortable: true, align: 'left', format: v => <span style={{ fontWeight: 500, color: duplicateCallouts.includes(v.toLowerCase().trim()) ? '#c0392b' : '#1a3a6b' }}>{v}</span> },
              { key: 'status', label: 'Status', sortable: true, align: 'center' },
              { key: '_dup',   label: 'Flag', sortable: false, align: 'center', format: (_, row) => duplicateCallouts.includes(row.text.toLowerCase().trim()) ? <SeverityBadge value="Medium" /> : <SeverityBadge value="Passed" /> },
            ]}
            data={callouts}
            loading={loading}
            {...tblProps}
            emptyMessage="No callouts found."
          />
        </Section>
      )}

      {snippets.length > 0 && (
        <Section title="Structured Snippets" count={snippets.length}>
          <ReportTable
            columns={[
              { key: 'header', label: 'Header', sortable: true, align: 'left' },
              { key: 'values', label: 'Values', sortable: false, align: 'left', format: v => (v || []).join(', ') },
              { key: 'status', label: 'Status', sortable: true, align: 'center' },
            ]}
            data={snippets}
            loading={loading}
            {...tblProps}
            emptyMessage="No structured snippets found."
          />
        </Section>
      )}
    </div>
  )
}
