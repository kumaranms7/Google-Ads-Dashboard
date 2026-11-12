import React, { useState, useRef } from 'react'
import { Loader2, AlertCircle, FileDown, FileText } from 'lucide-react'
import logoAsset from '../../assets/logo-white.webp'
import { estimateAdStrength } from '../../services/rsaScoringEngine.js'
import { estimateConversionReadiness } from '../../services/conversionReadiness/conversionReadinessEngine.js'
import { detectLandingPageMismatch, classifyHeadlineType } from '../../services/rsaBuilderService.js'
import { analyzeLandingPage } from '../../services/landingPageAnalyzer.js'

// Deliberately its own color/grade vocabulary mirrors the Audit tab's
// (GRADE_COLOR / CONVERSION_GRADE_COLOR in index.jsx) rather than importing
// them — those are unexported locals of that file, and the two score
// systems' label sets (Excellent/Good/Average/Poor vs Strong/Moderate/
// Weak/Poor) are already duplicated as constants there, so redeclaring a
// small, read-only copy here is simpler than exporting internals of an
// already very large file just for this.
const GRADE_COLOR            = { Excellent: '#2e7d32', Good: '#4caf50', Average: '#e65100', Poor: '#c0392b', Incomplete: '#888' }
const CONVERSION_GRADE_COLOR = { Strong: '#2e7d32', Moderate: '#4caf50', Weak: '#e65100', Poor: '#c0392b' }
const THEME_GRADE_COLOR      = { Good: '#2e7d32', Average: '#a56700', Poor: '#c0392b', Unknown: '#888' }
const TYPE_COLORS = {
  Keyword: '#1565c0', CTA: '#2e7d32', Trust: '#6a1b9a', Urgency: '#c0392b',
  Benefit: '#00695c', Location: '#e65100', 'Problem-Solution': '#4527a0', Offer: '#8d6e63',
}

function TypeTag({ type }) {
  const color = TYPE_COLORS[type] || '#888'
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: `${color}15`, color, border: `1px solid ${color}33`, whiteSpace: 'nowrap' }}>
      {type}
    </span>
  )
}

function ScoreBlock({ label, score, grade, colorMap }) {
  const color = colorMap[grade] || '#888'
  return (
    <div className="rsa-report-block" style={{ flex: 1, minWidth: 200, background: '#f8fafd', border: '1px solid #e3eaf5', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 30, fontWeight: 800, color }}>{score ?? '—'}</span>
        <span style={{ fontSize: 12, color: '#aaa' }}>/100</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: `${color}18`, color }}>{grade}</span>
      </div>
    </div>
  )
}

const thStyle = { padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '2px solid #eef2f7', textAlign: 'left' }

// One ad's full report page — a plain, print-oriented layout (not the
// interactive Audit tab card) so html2canvas captures something closer to
// a formal document than a screenshot of app chrome. `cardRef` is attached
// to the root so the PDF exporter can screenshot exactly this node.
function RsaReportCard({ cardRef, accountName, accountId, campaignName, campaignStatus, adGroupName, adGroupStatus, indexLabel, totalCount, ad }) {
  const url = ad.landingPageUrl
  const theme = ad.themeCoverage
  return (
    <div ref={cardRef} style={{ background: '#fff', maxWidth: 760, margin: '0 auto' }}>
      <div className="rsa-report-block" style={{ padding: '10px 2px', fontSize: 11, color: '#888' }}>
        Ad Group {indexLabel} of {totalCount} &nbsp;·&nbsp; <strong style={{ color: '#1a3a6b' }}>{accountName}</strong> &nbsp;·&nbsp; {campaignName} ({campaignStatus})
      </div>
      <div style={{ border: '1px solid #dde9f5', borderRadius: 10, overflow: 'hidden' }}>
        <div className="rsa-report-block" style={{ background: '#1a3a6b', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={logoAsset} alt="" style={{ height: 26 }} />
          <div style={{ flex: 1, textAlign: 'right' }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{accountName}</div>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10 }}>ID: {accountId}</div>
          </div>
        </div>

        <div className="rsa-report-block" style={{ display: 'flex', borderBottom: '1px solid #eef2f7' }}>
          <div style={{ flex: 1, padding: '10px 18px', borderRight: '1px solid #eef2f7' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase' }}>Campaign Name</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a3a6b' }}>{campaignName}</div>
          </div>
          <div style={{ flex: 1, padding: '10px 18px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase' }}>Ad Group Name</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a3a6b' }}>{adGroupName}{adGroupStatus ? ` (${adGroupStatus})` : ''}</div>
          </div>
        </div>

        <div style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
            <ScoreBlock label="Estimated Ad Strength" score={ad.adStrength.score} grade={ad.adStrength.grade} colorMap={GRADE_COLOR} />
            <ScoreBlock label="Conversion Readiness"  score={ad.convReadiness.score} grade={ad.convReadiness.grade} colorMap={CONVERSION_GRADE_COLOR} />
          </div>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <div className="rsa-report-block" style={{ flex: 1, minWidth: 280 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#1a3a6b', marginBottom: 6 }}>Current Headlines ({ad.headlines.length})</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={{ ...thStyle, width: 20 }}>#</th><th style={thStyle}>Headline</th><th style={{ ...thStyle, textAlign: 'right' }}>Type</th></tr></thead>
                <tbody>
                  {ad.headlines.map((h, i) => (
                    <tr key={i}>
                      <td style={{ padding: '5px 8px', fontSize: 11, color: '#aaa', borderBottom: '1px solid #f5f7fa' }}>{i + 1}</td>
                      <td style={{ padding: '5px 8px', fontSize: 12, color: '#333', borderBottom: '1px solid #f5f7fa' }}>{h.text}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid #f5f7fa' }}><TypeTag type={h.type} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rsa-report-block" style={{ flex: 1, minWidth: 280 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#1a3a6b', marginBottom: 6 }}>Current Descriptions ({ad.descriptions.length})</div>
              {ad.descriptions.map((d, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 2px', borderBottom: '1px solid #f5f7fa', fontSize: 12, color: '#333' }}>
                  <span style={{ color: '#aaa', flexShrink: 0 }}>{i + 1}</span><span>{d.text}</span>
                </div>
              ))}

              <div style={{ marginTop: 16, fontSize: 11, color: '#555' }}>
                <div style={{ fontWeight: 700, color: '#888', textTransform: 'uppercase', fontSize: 10, marginBottom: 3 }}>Landing Page</div>
                <div style={{ wordBreak: 'break-all', color: '#1565c0' }}>{url || '—'}</div>
              </div>

              <div style={{ marginTop: 12 }}>
                <span style={{
                  fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 14,
                  background: `${THEME_GRADE_COLOR[theme.grade] || '#888'}18`,
                  color: THEME_GRADE_COLOR[theme.grade] || '#888',
                }}>
                  Raw Theme Coverage: {theme.score == null ? 'Unknown' : `${theme.score}% (${theme.grade})`}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RsaReportsTab({ selectedAccount, campaigns, adGroups, selectedCamp, selectedAG, selectedCampName, selectedAGName, isPMax }) {
  const [scopeLevel, setScopeLevel] = useState('campaign') // 'campaign' | 'adGroup'
  const [generating, setGenerating] = useState(false)
  const [genStep,    setGenStep]    = useState('')
  const [genError,   setGenError]   = useState(null)
  const [reportData, setReportData] = useState(null)
  const [exporting,  setExporting]  = useState(false)
  const cardRefs = useRef({}) // `${adGroupId}-${adId}` -> DOM node

  const canGenerate = !!selectedAccount && !!selectedCamp && !isPMax && (scopeLevel === 'campaign' || !!selectedAG) && !generating

  async function handleGenerate() {
    if (!canGenerate) return
    setGenerating(true); setGenError(null); setReportData(null)
    cardRefs.current = {}
    try {
      setGenStep('Fetching active ad groups and ads…')
      const raw = scopeLevel === 'adGroup'
        ? await window.electronAPI.rsaFetchReportData({ customerId: selectedAccount.id, adGroupId: selectedAG })
        : await window.electronAPI.rsaFetchReportData({ customerId: selectedAccount.id, campaignId: selectedCamp })

      const adGroupsWithAds = (raw.adGroups || []).filter(ag => ag.ads.length > 0)
      if (!adGroupsWithAds.length) {
        setGenError('No active ad groups with an active Responsive Search Ad were found for this selection.')
        return
      }

      const urls = [...new Set(adGroupsWithAds.flatMap(ag => ag.ads.flatMap(ad => ad.finalUrls || [])).filter(Boolean))]
      setGenStep(`Analyzing ${urls.length} landing page${urls.length !== 1 ? 's' : ''}…`)
      const lpByUrl = {}
      await Promise.all(urls.map(url =>
        analyzeLandingPage(url).then(lp => { lpByUrl[url] = (lp && !lp.error) ? lp : null }).catch(() => { lpByUrl[url] = null })
      ))

      setGenStep('Scoring ads…')
      const scoredAdGroups = adGroupsWithAds.map(ag => ({
        ...ag,
        ads: ag.ads.map(ad => {
          const url = ad.finalUrls?.[0] || ''
          const lp  = url ? lpByUrl[url] : null
          const headlinesTyped = ad.headlines.map(h => ({ ...h, type: classifyHeadlineType(h.text, ag.keywords) }))
          return {
            ...ad,
            headlines: headlinesTyped,
            landingPageUrl: url,
            adStrength:    estimateAdStrength({ headlines: ad.headlines, descriptions: ad.descriptions, keywords: ag.keywords, landingPage: lp, hasFinalUrl: !!url }),
            convReadiness: estimateConversionReadiness({ headlines: ad.headlines, descriptions: ad.descriptions, keywords: ag.keywords, landingPage: lp }),
            themeCoverage: detectLandingPageMismatch(ag.name, ag.keywords, lp),
          }
        }),
      }))

      setReportData({
        campaignName:   raw.campaignName   || selectedCampName,
        campaignStatus: raw.campaignStatus || '',
        scopeAdGroupName: scopeLevel === 'adGroup' ? selectedAGName : null,
        adGroups: scoredAdGroups,
      })
    } catch (err) {
      setGenError(err.message || 'Failed to generate report')
    } finally {
      setGenerating(false); setGenStep('')
    }
  }

  async function handleExportPdf() {
    if (!reportData || exporting) return
    setExporting(true)
    try {
      const { default: jsPDF }    = await import('jspdf')
      const { default: html2canvas } = await import('html2canvas')

      const pdf = new jsPDF('portrait', 'mm', 'a4')
      const pw = pdf.internal.pageSize.getWidth()
      const ph = pdf.internal.pageSize.getHeight()
      const marginX = 16, marginY = 14
      const usableW = pw - marginX * 2
      const pageH   = ph - marginY * 2
      const cx = pw / 2

      // ── Phase A: screenshot every ad, compute page-break-safe slices ──────
      // Each ad group almost always has exactly one ENABLED RSA (Google caps
      // an RSA at 15 headlines / 4 descriptions, so a single card reliably
      // fits one page) — but an ad group can have more than one ENABLED ad,
      // so this still has to support spilling onto extra pages rather than
      // assuming one page per ad group.
      const entries = []
      for (const ag of reportData.adGroups) {
        for (const ad of ag.ads) {
          const key = `${ag.id}-${ad.adId}`
          const el = cardRefs.current[key]
          if (!el) continue
          const scale = 2
          const canvas = await html2canvas(el, { scale, useCORS: true, allowTaint: true, backgroundColor: '#ffffff' })
          const imgW = usableW
          const imgH = (canvas.height * imgW) / canvas.width
          const slices = []
          if (imgH <= pageH) {
            slices.push({ srcY: 0, sliceH: canvas.height })
          } else {
            // Same page-break-safe slicing as the Audit PDF exporter — never
            // cut a score block, table, or table row in half.
            const blocks = [...el.querySelectorAll('.rsa-report-block, tr')]
              .map(b => {
                const r = b.getBoundingClientRect(), cr = el.getBoundingClientRect()
                return { top: (r.top - cr.top) * scale, bottom: (r.bottom - cr.top) * scale }
              })
              .filter(b => b.bottom > b.top)
              .sort((a, b) => a.top - b.top)
            const srcHPerPage = (pageH * canvas.width) / imgW
            let srcY = 0
            while (srcY < canvas.height) {
              let sliceEnd = Math.min(srcY + srcHPerPage, canvas.height)
              for (const b of blocks) {
                if (b.top > srcY && b.top < sliceEnd && b.bottom > sliceEnd) { sliceEnd = b.top; break }
              }
              if (sliceEnd <= srcY) sliceEnd = Math.min(srcY + srcHPerPage, canvas.height)
              slices.push({ srcY, sliceH: sliceEnd - srcY })
              srcY = sliceEnd
            }
          }
          entries.push({ adGroupName: ag.name, canvas, slices, imgW })
        }
      }

      // ── Phase B: TOC page numbers — cover/TOC is page 1, details follow ──
      let pageCounter = 2
      const toc = entries.map(e => {
        const startPage = pageCounter
        pageCounter += e.slices.length
        return { name: e.adGroupName, startPage }
      })

      // ── Phase C: cover + TOC page ──────────────────────────────────────
      pdf.setFillColor(26, 58, 107)
      pdf.rect(0, 0, pw, 42, 'F')
      pdf.setTextColor(255, 255, 255)
      pdf.setFontSize(20); pdf.setFont('helvetica', 'bold')
      pdf.text('RSA Ad Group Summary Report', cx, 20, { align: 'center' })
      pdf.setFontSize(12); pdf.setFont('helvetica', 'normal')
      const subtitle = reportData.scopeAdGroupName
        ? `${reportData.campaignName} → ${reportData.scopeAdGroupName}`
        : `${reportData.campaignName} (${reportData.campaignStatus})`
      pdf.text(subtitle, cx, 32, { align: 'center' })

      pdf.setTextColor(60, 60, 60)
      pdf.setFontSize(11); pdf.setFont('helvetica', 'normal')
      pdf.text(`Account: ${selectedAccount.name}  |  ID: ${selectedAccount.id}`, cx, 54, { align: 'center' })

      pdf.setFontSize(10)
      const introLines = pdf.splitTextToSize(
        'This PDF summarizes the current RSA copy and current scores for the ad groups shown. Each ad group is shown on its own page so the client can review the messaging, headline types, descriptions, and landing-page match more clearly.',
        pw - 56
      )
      pdf.text(introLines, cx, 66, { align: 'center' })

      let tocY = 66 + introLines.length * 5 + 16
      pdf.setFontSize(13); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(26, 58, 107)
      pdf.text('Ad Groups Included', marginX, tocY)
      tocY += 9
      pdf.setFontSize(11); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(40, 40, 40)
      toc.forEach((t, i) => {
        if (tocY > ph - 20) { pdf.addPage(); tocY = marginY + 6 }
        pdf.text(`${i + 1}.  ${t.name}`, marginX + 2, tocY)
        pdf.text(`Page ${t.startPage}`, pw - marginX - 2, tocY, { align: 'right' })
        tocY += 8.5
      })

      // ── Phase D: detail pages ───────────────────────────────────────────
      for (const e of entries) {
        for (const slice of e.slices) {
          pdf.addPage()
          const tmp = document.createElement('canvas')
          tmp.width = e.canvas.width
          tmp.height = slice.sliceH
          tmp.getContext('2d').drawImage(e.canvas, 0, -slice.srcY)
          const segH = (slice.sliceH * e.imgW) / e.canvas.width
          pdf.addImage(tmp.toDataURL('image/png'), 'PNG', marginX, marginY, e.imgW, segH)
        }
      }

      const nameSlug = (reportData.scopeAdGroupName || reportData.campaignName || 'report').replace(/\s+/g, '-')
      pdf.save(`rsa-report-${nameSlug}-${new Date().toISOString().slice(0, 10)}.pdf`)
    } catch (err) {
      console.error('RSA report PDF export failed:', err)
      setGenError('PDF export failed: ' + (err.message || 'unknown error'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      {/* ── Scope selector ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#555' }}>Report Scope:</span>
          {[
            { id: 'campaign', label: `Campaign Level${selectedCampName ? ` — all active ad groups in "${selectedCampName}"` : ''}` },
            { id: 'adGroup',  label: `Ad Group Level${selectedAGName ? ` — "${selectedAGName}" only` : ''}` },
          ].map(opt => (
            <label key={opt.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              padding: '8px 14px', borderRadius: 6,
              background: scopeLevel === opt.id ? '#eef6ff' : '#f5f7fa',
              border: `1px solid ${scopeLevel === opt.id ? '#9fc4ec' : '#dde9f5'}`,
            }}>
              <input type="radio" name="rsaReportScope" checked={scopeLevel === opt.id} onChange={() => setScopeLevel(opt.id)}
                style={{ accentColor: '#1a3a6b', width: 15, height: 15 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#1a3a6b' }}>{opt.label}</span>
            </label>
          ))}

          <button onClick={handleGenerate} disabled={!canGenerate} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 20px',
            background: canGenerate ? '#1a3a6b' : '#dde9f5',
            color:      canGenerate ? '#fff'    : '#aaa',
            fontWeight: 700, fontSize: 13, borderRadius: 6, border: 'none',
            cursor: canGenerate ? 'pointer' : 'not-allowed', marginLeft: 'auto',
          }}>
            {generating ? <Loader2 size={14} className="spin" /> : <FileText size={14} />}
            {generating ? (genStep || 'Generating…') : 'Generate Report'}
          </button>

          {reportData && (
            <button onClick={handleExportPdf} disabled={exporting} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 20px',
              background: exporting ? '#5a8fd4' : '#2e7d32',
              color: '#fff', fontWeight: 700, fontSize: 13, borderRadius: 6, border: 'none',
              cursor: exporting ? 'wait' : 'pointer',
            }}>
              {exporting ? <Loader2 size={14} className="spin" /> : <FileDown size={14} />}
              {exporting ? 'Exporting…' : 'Export PDF'}
            </button>
          )}
        </div>

        {scopeLevel === 'adGroup' && !selectedAG && (
          <div style={{ padding: '0 16px 14px', fontSize: 12, color: '#a56700' }}>
            Select an Ad Group in the picker above first.
          </div>
        )}
        {isPMax && (
          <div style={{ padding: '0 16px 14px', fontSize: 12, color: '#a56700' }}>
            Not applicable for Performance Max campaigns — they have no ad groups or Responsive Search Ads.
          </div>
        )}
      </div>

      {genError && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={16} color="#c0392b" />
          <span style={{ fontSize: 13, color: '#c0392b' }}>{genError}</span>
        </div>
      )}

      {!reportData && !generating && !genError && (
        <div style={{ padding: 60, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
          Choose a scope and click <strong>Generate Report</strong> to pull current RSA copy and scores for the active ad groups.
        </div>
      )}

      {/* ── Preview — also what the PDF exporter screenshots ── */}
      {reportData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {reportData.adGroups.map((ag, agIdx) =>
            ag.ads.map((ad, adIdx) => {
              const key = `${ag.id}-${ad.adId}`
              return (
                <RsaReportCard
                  key={key}
                  cardRef={el => { if (el) cardRefs.current[key] = el }}
                  accountName={selectedAccount.name}
                  accountId={selectedAccount.id}
                  campaignName={reportData.campaignName}
                  campaignStatus={reportData.campaignStatus}
                  adGroupName={ag.name}
                  adGroupStatus={ag.ads.length > 1 ? null : ag.status}
                  indexLabel={agIdx + 1}
                  totalCount={reportData.adGroups.length}
                  ad={ad}
                />
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
