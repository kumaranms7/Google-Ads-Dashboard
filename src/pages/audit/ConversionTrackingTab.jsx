import React, { useMemo } from 'react'
import ReportTable from '../../components/ReportTable.jsx'
import { Section, SeverityBadge, ComingSoon, fmtNum, AiRecCell } from './shared.jsx'

function StatTile({ label, value, warn }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 14px' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: warn ? '#c0392b' : '#1a3a6b' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
    </div>
  )
}

export default function ConversionTrackingTab({ structureData, structureLoading, structureError, tblProps, loading, aiRec, conversionAiLoading, conversionAiReady, onRetryAi }) {
  const actions = structureData?.conversionActions || []
  const included = useMemo(() => actions.filter(a => a.included), [actions])
  const excluded = useMemo(() => actions.filter(a => !a.included), [actions])

  // Duplicate-name detection (case-insensitive) — the only deterministic
  // duplicate signal available from the fields this app fetches (no
  // last-conversion-date or primary/secondary flag is fetched anywhere yet).
  const duplicateNames = useMemo(() => {
    const seen = new Map()
    for (const a of actions) { const k = a.name.toLowerCase().trim(); seen.set(k, (seen.get(k) || 0) + 1) }
    return new Set([...seen.entries()].filter(([, c]) => c > 1).map(([k]) => k))
  }, [actions])

  if (structureLoading) return <Section title="Conversion Tracking"><div style={{ padding: 30, textAlign: 'center', color: '#888', fontSize: 12 }}>Loading conversion actions…</div></Section>
  if (structureError) return <Section title="Conversion Tracking"><div style={{ padding: '12px 16px', color: '#c0392b', fontSize: 12 }}>{structureError}</div></Section>
  if (!structureData) return <Section title="Conversion Tracking"><ComingSoon>Run the audit to load conversion tracking data.</ComingSoon></Section>

  return (
    <div>
      <div className="card" style={{ marginBottom: 20, padding: '14px 20px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Overview</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <StatTile label="Enabled Actions" value={fmtNum(actions.length)} warn={actions.length === 0} />
          <StatTile label="Counted in Conversions" value={fmtNum(included.length)} warn={included.length === 0} />
          <StatTile label="Excluded" value={fmtNum(excluded.length)} />
          <StatTile label="Duplicate Names" value={fmtNum(duplicateNames.size)} warn={duplicateNames.size > 0} />
        </div>
        <div style={{ fontSize: 11, color: '#aaa', marginTop: 10 }}>
          Primary-vs-secondary status and last-activity date aren't fetched anywhere in the app yet — this view checks presence, inclusion, and duplicate names only.
        </div>
      </div>

      {actions.length === 0 && (
        <Section title="No Conversion Actions">
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <SeverityBadge value="Critical" />
            <span style={{ fontSize: 12.5, color: '#555' }}>This account has no enabled conversion actions — conversion tracking may not be set up.</span>
          </div>
        </Section>
      )}
      {actions.length > 0 && included.length === 0 && (
        <Section title="No Conversions Counted">
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <SeverityBadge value="Critical" />
            <span style={{ fontSize: 12.5, color: '#555' }}>Every conversion action is excluded from the "Conversions" column — bidding strategies relying on conversions have no signal.</span>
          </div>
        </Section>
      )}

      <Section title="Conversion Actions" count={actions.length}>
        <ReportTable
          columns={[
            { key: 'name',     label: 'Name', sortable: true, align: 'left', format: v => <span style={{ fontWeight: 500, color: duplicateNames.has(v.toLowerCase().trim()) ? '#c0392b' : '#1a3a6b' }}>{v}</span> },
            { key: 'type',     label: 'Type', sortable: true, align: 'left' },
            { key: 'category', label: 'Category', sortable: true, align: 'left' },
            { key: 'included', label: 'Counted in Conversions', sortable: true, align: 'center', format: v => v ? <span style={{ fontSize: 11, color: '#4caf50', fontWeight: 600 }}>Yes</span> : <span style={{ fontSize: 11, color: '#888' }}>No</span> },
            { key: '_ai', label: '🤖 AI Suggestion', sortable: false, align: 'left', wrap: true,
              format: (_, row) => {
                const idx = row._aiIdx ?? 0
                return <AiRecCell rec={aiRec('conversionActions', idx)} loading={conversionAiLoading} rowLoading={false} aiReady={conversionAiReady} onRetry={() => onRetryAi('conversionActions', idx)} />
              } },
          ]}
          data={actions.map((row, i) => ({ ...row, _aiIdx: i }))}
          loading={loading}
          {...tblProps}
          emptyMessage="No conversion actions found."
        />
      </Section>
    </div>
  )
}
