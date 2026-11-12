import React, { useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import ReportTable from '../../components/ReportTable.jsx'
import ExportButton from '../../components/ExportButton.jsx'
import Modal from '../../components/Modal.jsx'
import { Section, fmtNum, AiRecCell, SeverityBadge, AdStrengthBadge, AdStatusBadge, normalizeStrength, normalizeAdStatus } from './shared.jsx'

function StatTile({ label, value, warn, ads, onOpen, title }) {
  const hasList = ads && ads.length > 0
  return (
    <div style={{ textAlign: 'center', padding: '8px 14px' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: warn ? '#c0392b' : '#1a3a6b' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#888', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {hasList && (
          <button onClick={() => onOpen({ title, ads })} title={`View ${title.toLowerCase()}`}
            style={{ display: 'inline-flex', alignItems: 'center', border: 'none', background: 'none', color: '#2563b0', cursor: 'pointer', padding: 0 }}>
            <Info size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

export default function AdRsaAuditTab({ data, adAnalysis, aiRec, aiLoading, aiRowLoading, aiReady, onRetryAi, tblProps, withIdx, loading }) {
  const { ads = [] } = data || {}
  const [adCampFilter, setAdCampFilter] = useState('')
  const [adListModal, setAdListModal] = useState(null) // { title, ads } | null

  const aiEligibleAds = useMemo(() => ads.filter(a => ['POOR', 'AVERAGE', 'GOOD'].includes(normalizeStrength(a.adStrength))), [ads])
  const poorAverageAds = useMemo(() => ads.filter(a => ['POOR', 'AVERAGE'].includes(normalizeStrength(a.adStrength))), [ads])
  const adCampaigns = useMemo(() => [...new Set(poorAverageAds.map(a => a.campaign).filter(Boolean))].sort(), [poorAverageAds])
  const filteredAdStrength = useMemo(() => adCampFilter ? poorAverageAds.filter(a => a.campaign === adCampFilter) : poorAverageAds, [poorAverageAds, adCampFilter])
  const adStrengthWithIdx = useMemo(() => filteredAdStrength.map(row => ({
    ...row,
    _aiIdx: ['POOR', 'AVERAGE', 'GOOD'].includes(normalizeStrength(row.adStrength)) ? aiEligibleAds.indexOf(row) : -1,
  })), [filteredAdStrength, aiEligibleAds])

  const withExportAi = (sectionKey, exportArr, fullArr = exportArr) =>
    exportArr.map(row => ({ ...row, 'AI Suggestion': aiRec(sectionKey, fullArr.indexOf(row)) || '' }))

  return (
    <div>
      {adAnalysis && (
        <div className="card" style={{ marginBottom: 20, padding: '14px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>RSA Quality Signals</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <StatTile label="Total Ads" value={fmtNum(adAnalysis.overview.totalAds)} />
            <StatTile label="RSAs" value={fmtNum(adAnalysis.overview.rsaCount)} />
            <StatTile label="Strong Ads" value={fmtNum(adAnalysis.overview.strongAds)} />
            <StatTile label="Weak Ads" value={fmtNum(adAnalysis.overview.weakAds)} warn={adAnalysis.overview.weakAds > 0} />
            <StatTile label="Missing CTA" value={fmtNum(adAnalysis.rsaQuality.noCta)} warn={adAnalysis.rsaQuality.noCta > 0}
              ads={adAnalysis.rsaQuality.topNoCta} title="Ads Missing a Call-to-Action" onOpen={setAdListModal} />
            <StatTile label="Pinning Issues" value={fmtNum(adAnalysis.rsaQuality.pinningIssue)} warn={adAnalysis.rsaQuality.pinningIssue > 0}
              ads={adAnalysis.rsaQuality.topPinned} title="Ads With Pinning Issues" onOpen={setAdListModal} />
            <StatTile label="< 10 Headlines" value={fmtNum(adAnalysis.rsaQuality.lowHeadlines)} warn={adAnalysis.rsaQuality.lowHeadlines > 0} />
            <StatTile label="< 4 Descriptions" value={fmtNum(adAnalysis.rsaQuality.lowDescs)} warn={adAnalysis.rsaQuality.lowDescs > 0} />
          </div>
        </div>
      )}

      <Section
        title="Weak Ad Strength"
        deduction={poorAverageAds.length > 0 ? `${Math.min(poorAverageAds.length * 5, 30)}` : null}
        extra={<ExportButton data={withExportAi('adStrength', adStrengthWithIdx, aiEligibleAds).map(({ _aiIdx, ...r }) => ({ ...r, adStrength: normalizeStrength(r.adStrength), status: normalizeAdStatus(r.status) }))} filename="ad-rsa-audit" />}
      >
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f4f8', background: '#fafcff', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap' }}>Campaign:</span>
            <select value={adCampFilter} onChange={e => setAdCampFilter(e.target.value)}
              style={{ padding: '4px 10px', border: '1px solid #dde9f5', borderRadius: 5, fontSize: 12, color: '#1a3a6b', outline: 'none', cursor: 'pointer', background: '#fff' }}>
              <option value="">All ({poorAverageAds.length})</option>
              {adCampaigns.map(c => {
                const count = poorAverageAds.filter(a => a.campaign === c).length
                return <option key={c} value={c}>{c} ({count})</option>
              })}
            </select>
          </div>
          {adCampFilter && (
            <button onClick={() => setAdCampFilter('')} style={{ fontSize: 11, color: '#2563b0', background: 'none', border: '1px solid #dde9f5', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}>Clear</button>
          )}
          <span style={{ fontSize: 11, color: '#888', marginLeft: 'auto' }}>Showing Poor &amp; Average only · {filteredAdStrength.length} ad{filteredAdStrength.length !== 1 ? 's' : ''}</span>
        </div>
        <ReportTable
          columns={[
            { key: '_ad', label: 'Ad', sortable: false, align: 'left', width: 260, wrap: true,
              format: (_, row) => {
                const headlines = (row.headlines || []).join(' | ')
                const desc = (row.descriptions || [])[0] || ''
                const url = (row.finalUrls || [])[0] || ''
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 200 }}>
                    {url && <div style={{ fontSize: 11, color: '#2e7d32', wordBreak: 'break-all', lineHeight: 1.4 }}>{url}</div>}
                    {headlines && <div style={{ fontSize: 12, color: '#2563b0', fontWeight: 500, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.5 }}>{headlines}</div>}
                    {desc && <div style={{ fontSize: 11, color: '#666', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.5 }}>{desc}</div>}
                    {!url && !headlines && !desc && <span style={{ color: '#aaa', fontSize: 11 }}>—</span>}
                  </div>
                )
              } },
            { key: 'campaign',   label: 'Campaign', sortable: true, align: 'left', width: 160 },
            { key: 'adGroup',    label: 'Ad Group', sortable: true, align: 'left', width: 140 },
            { key: 'status',     label: 'Status', sortable: true, align: 'center', format: v => <AdStatusBadge value={v} /> },
            { key: 'adStrength', label: 'Strength', sortable: true, align: 'center', format: v => <AdStrengthBadge value={v} /> },
            { key: 'impressions', label: 'Impr.', sortable: true, align: 'right', format: fmtNum },
            { key: 'clicks',     label: 'Clicks', sortable: true, align: 'right', format: fmtNum },
            { key: 'conversions', label: 'Conv.', sortable: true, align: 'right', format: fmtNum },
            { key: '_severity', label: 'Severity', sortable: false, align: 'center',
              format: (_, row) => <SeverityBadge value={normalizeStrength(row.adStrength) === 'POOR' ? 'High' : 'Medium'} /> },
            { key: '_ai', label: '🤖 AI Suggestion', sortable: false, align: 'left', wrap: true,
              format: (_, row) => {
                const idx = row._aiIdx ?? 0
                return <AiRecCell rec={aiRec('adStrength', idx)} loading={aiLoading} rowLoading={aiRowLoading.has(`adStrength-${idx}`)} aiReady={aiReady} onRetry={() => onRetryAi('adStrength', idx)} />
              } },
          ]}
          data={adStrengthWithIdx}
          loading={loading}
          {...tblProps}
          emptyMessage="No ads found for the selected strength filter."
        />
      </Section>

      {adListModal && (
        <Modal title={adListModal.title} subtitle={`Top ${adListModal.ads.length} by impressions`} onClose={() => setAdListModal(null)} maxWidth={560}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {adListModal.ads.map((a, i) => (
              <div key={i} style={{ padding: '10px 12px', background: '#fafcff', border: '1px solid #eef2f7', borderRadius: 7 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: '#2563b0' }}>{a._headline || a.headline1}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>{a.campaign} → {a.adGroup} · {fmtNum(a.impressions)} impr.</div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
