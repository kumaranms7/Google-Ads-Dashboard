import React, { useState } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { highlightRecommendation } from '../../utils/highlightRecommendation.jsx'

// ── Formatters ────────────────────────────────────────────────────────────────
export const fmtUsd = v => '$' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmtNum = v => Number(v || 0).toLocaleString()
export const fmtPct = v => Number(v || 0).toFixed(1) + '%'

// ── Severity system ───────────────────────────────────────────────────────────
// Shared Critical/High/Medium/Low/Opportunity/Passed labels — mapped onto each
// section's existing issue logic rather than a new parallel scoring system.
export const SEVERITY_META = {
  Critical:     { color: '#c0392b', bg: 'rgba(224,92,42,0.14)',  border: 'rgba(224,92,42,0.35)'  },
  High:         { color: '#c0392b', bg: 'rgba(224,92,42,0.12)',  border: 'rgba(224,92,42,0.3)'   },
  Medium:       { color: '#8a6000', bg: 'rgba(240,180,41,0.15)', border: 'rgba(240,180,41,0.4)'  },
  Low:          { color: '#666',    bg: 'rgba(150,150,150,0.1)', border: 'rgba(150,150,150,0.3)' },
  Opportunity:  { color: '#2e7d32', bg: 'rgba(76,175,80,0.12)',  border: 'rgba(76,175,80,0.3)'   },
  Passed:       { color: '#2e7d32', bg: 'rgba(76,175,80,0.12)',  border: 'rgba(76,175,80,0.3)'   },
}
export function SeverityBadge({ value }) {
  const s = SEVERITY_META[value] || SEVERITY_META.Low
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: 'nowrap' }}>
      {value}
    </span>
  )
}

// ── Health score calculation ──────────────────────────────────────────────────
export function calculateHealthScore(data) {
  if (!data) return null
  let score = 100
  const { ads = [], campaigns = [], adGroups = [], keywords = {}, crossovers = [] } = data
  const poorAds      = ads.filter(a => ['POOR', 'AVERAGE'].includes(normalizeStrength(a.adStrength)))
  const disapproved  = ads.filter(a => ['DISAPPROVED'].includes(String(a.approvalStatus)))
  const conflicts    = keywords.conflicts || []
  const budgetIssues = campaigns.filter(c => c.issue)
  const agIssues     = adGroups.filter(a => a.impressions === 0 && ['ENABLED', '2'].includes(String(a.status)))

  score -= Math.min(poorAds.length * 5, 30)
  score -= disapproved.length * 10
  if (conflicts.length > 0) score -= 10
  score -= Math.min(budgetIssues.length * 5, 25)
  score -= Math.min(agIssues.length * 3, 15)
  score -= crossovers.length * 15

  return Math.max(0, Math.min(100, score))
}

export function HealthBadge({ score }) {
  if (score === null) return null
  const { label, color, bg } = score >= 80 ? { label: 'Healthy', color: '#2e7d32', bg: 'rgba(76,175,80,0.12)' }
                              : score >= 60 ? { label: 'Needs Attention', color: '#8a6000', bg: 'rgba(240,180,41,0.15)' }
                              :               { label: 'Critical Issues', color: '#c0392b', bg: 'rgba(224,92,42,0.12)' }
  return (
    <span style={{ fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 6, background: bg, color }}>
      {score}/100 — {label}
    </span>
  )
}

export function Section({ title, count, children, extra, deduction }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="card-title">{title}</span>
          {deduction && <span style={{ fontSize: 11, color: '#e05c2a', fontWeight: 600 }}>−{deduction} pts</span>}
        </div>
        {extra}
      </div>
      {children}
    </div>
  )
}

// ── Ad Strength / Status badges ───────────────────────────────────────────────
export const AD_STRENGTH_MAP = {
  0: 'UNSPECIFIED', 1: 'UNKNOWN', 2: 'PENDING', 3: 'NO_ADS',
  4: 'POOR', 5: 'AVERAGE', 6: 'GOOD', 7: 'EXCELLENT',
}
export const normalizeStrength = v => {
  if (v === null || v === undefined || v === '') return 'UNSPECIFIED'
  const num = Number(v)
  if (!isNaN(num) && AD_STRENGTH_MAP[num]) return AD_STRENGTH_MAP[num]
  const s = String(v).toUpperCase()
  if (s === 'FAIR') return 'AVERAGE'
  return s
}
const AD_STRENGTH_STYLE = {
  EXCELLENT:   { bg: 'rgba(76,175,80,0.12)',  color: '#2e7d32' },
  GOOD:        { bg: 'rgba(37,99,176,0.12)',  color: '#1a4a90' },
  AVERAGE:     { bg: 'rgba(240,180,41,0.15)', color: '#8a6000' },
  POOR:        { bg: 'rgba(224,92,42,0.12)',  color: '#c0392b' },
  PENDING:     { bg: 'rgba(150,150,150,0.1)', color: '#666' },
  NO_ADS:      { bg: 'rgba(150,150,150,0.1)', color: '#666' },
  UNSPECIFIED: { bg: 'rgba(150,150,150,0.1)', color: '#666' },
  UNKNOWN:     { bg: 'rgba(150,150,150,0.1)', color: '#666' },
}
export function AdStrengthBadge({ value }) {
  const label = normalizeStrength(value)
  const s = AD_STRENGTH_STYLE[label] || AD_STRENGTH_STYLE.UNSPECIFIED
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: s.bg, color: s.color }}>{label}</span>
}

export const AD_STATUS_MAP = { 0: 'Unspecified', 1: 'Unknown', 2: 'Enabled', 3: 'Paused', 4: 'Removed' }
const AD_STATUS_STYLE = {
  Enabled:     { bg: 'rgba(76,175,80,0.12)',  color: '#2e7d32' },
  Paused:      { bg: 'rgba(240,180,41,0.15)', color: '#8a6000' },
  Removed:     { bg: 'rgba(224,92,42,0.12)',  color: '#c0392b' },
  Unspecified: { bg: 'rgba(150,150,150,0.1)', color: '#666' },
  Unknown:     { bg: 'rgba(150,150,150,0.1)', color: '#666' },
}
export const normalizeAdStatus = v => {
  if (v === null || v === undefined || v === '') return 'Unspecified'
  const num = Number(v)
  if (!isNaN(num) && AD_STATUS_MAP[num]) return AD_STATUS_MAP[num]
  const s = String(v)
  const title = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
  return AD_STATUS_STYLE[title] ? title : (AD_STATUS_STYLE[s] ? s : 'Unspecified')
}
export function AdStatusBadge({ value }) {
  const label = normalizeAdStatus(value)
  const s = AD_STATUS_STYLE[label] || AD_STATUS_STYLE.Unspecified
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: s.bg, color: s.color }}>{label}</span>
}

export function adRecommendation(ad) {
  if (['POOR', 'AVERAGE'].includes(normalizeStrength(ad.adStrength))) {
    if (!ad.headlines?.length) return 'Add more unique headlines'
    if (ad.headlines.length < 3) return 'Add at least 3 unique headlines with keywords'
    return 'Improve description relevance and include keywords in headlines'
  }
  return '—'
}

// ── Budget utilization bar ────────────────────────────────────────────────────
export function UtilBar({ pct }) {
  const color = pct > 120 ? '#e05c2a' : pct > 95 ? '#f0b429' : '#4caf50'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 80, height: 8, background: '#dde9f5', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color }}>{fmtPct(pct)}</span>
    </div>
  )
}

// ── PDF export ────────────────────────────────────────────────────────────────
export async function exportAuditPDF(contentRef, accountName, score, counts = {}) {
  try {
    const { default: jsPDF } = await import('jspdf')
    await import('jspdf-autotable')
    const { default: html2canvas } = await import('html2canvas')

    const pdf = new jsPDF('landscape', 'mm', 'a4')
    const pw = pdf.internal.pageSize.getWidth()
    const ph = pdf.internal.pageSize.getHeight()
    const cx = pw / 2

    const tier = score >= 80 ? { label: 'Healthy',         rgb: [76, 175, 80]  }
               : score >= 60 ? { label: 'Needs Attention',  rgb: [240, 180, 41] }
               :               { label: 'Critical Issues',  rgb: [230, 90, 70]  }

    // ── Background + frame ──────────────────────────────────────────────────
    pdf.setFillColor(20, 44, 82)
    pdf.rect(0, 0, pw, ph, 'F')
    pdf.setFillColor(232, 160, 32) // brand gold accent bars
    pdf.rect(0, 0, pw, 2.5, 'F')
    pdf.rect(0, ph - 2.5, pw, 2.5, 'F')

    // ── Brand line ───────────────────────────────────────────────────────────
    pdf.setTextColor(232, 160, 32)
    pdf.setFontSize(10); pdf.setFont('helvetica', 'bold')
    pdf.text('T O P   T E N   W E B S I T E   M A R K E T I N G', cx, 16, { align: 'center' })

    // ── Title block ──────────────────────────────────────────────────────────
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(30); pdf.setFont('helvetica', 'bold')
    pdf.text('Account Health Audit', cx, 34, { align: 'center' })
    pdf.setFontSize(14); pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(210, 222, 240)
    pdf.text(accountName || 'Unknown Account', cx, 43, { align: 'center' })
    pdf.setFontSize(10)
    pdf.setTextColor(150, 170, 200)
    pdf.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), cx, 50, { align: 'center' })

    // ── Health score badge ───────────────────────────────────────────────────
    const badgeW = 72, badgeH = 30, badgeY = 60
    pdf.setFillColor(...tier.rgb)
    pdf.roundedRect(cx - badgeW / 2, badgeY, badgeW, badgeH, 4, 4, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(24); pdf.setFont('helvetica', 'bold')
    pdf.text(`${score}`, cx - 8, badgeY + 18, { align: 'right' })
    pdf.setFontSize(12); pdf.setFont('helvetica', 'normal')
    pdf.text('/100', cx - 6, badgeY + 18, { align: 'left' })
    pdf.setFontSize(11); pdf.setFont('helvetica', 'bold')
    pdf.text(tier.label, cx, badgeY + 26, { align: 'center' })

    // ── Category stat cards ──────────────────────────────────────────────────
    const sev = computeSeveritySummary(counts)
    const cards = [
      { label: 'Total Issues',      value: sev.total,    rgb: [255, 255, 255] },
      { label: 'Critical',          value: sev.critical, rgb: [255, 130, 110] },
      { label: 'High',              value: sev.high,     rgb: [255, 175, 110] },
      { label: 'Medium',            value: sev.medium,   rgb: [245, 205, 90]  },
      { label: 'Low / Opportunity', value: sev.low,      rgb: [150, 220, 165] },
    ]
    const cardW = 46, cardH = 26, cardGap = 5, cardsY = badgeY + badgeH + 14
    const rowW = cards.length * cardW + (cards.length - 1) * cardGap
    let cardX = cx - rowW / 2
    for (const c of cards) {
      pdf.setFillColor(38, 66, 108) // subtle lighter-navy card fill
      pdf.roundedRect(cardX, cardsY, cardW, cardH, 3, 3, 'F')
      pdf.setTextColor(...c.rgb)
      pdf.setFontSize(18); pdf.setFont('helvetica', 'bold')
      pdf.text(`${c.value}`, cardX + cardW / 2, cardsY + 14, { align: 'center' })
      pdf.setTextColor(190, 205, 225)
      pdf.setFontSize(8); pdf.setFont('helvetica', 'normal')
      pdf.text(c.label, cardX + cardW / 2, cardsY + 21, { align: 'center' })
      cardX += cardW + cardGap
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    pdf.setTextColor(140, 160, 190)
    pdf.setFontSize(9); pdf.setFont('helvetica', 'normal')
    pdf.text('Confidential — prepared for internal use', cx, ph - 12, { align: 'center' })

    if (contentRef?.current) {
      pdf.addPage()
      const scale = 1.5
      const canvas = await html2canvas(contentRef.current, { scale, useCORS: true, allowTaint: true })
      const imgW = pw - 20
      const imgH = (canvas.height * imgW) / canvas.width

      if (imgH <= ph - 20) {
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 10, imgW, imgH)
      } else {
        // Page-break-safe slicing: never cut through a card (.card — every
        // Section/stat block in this page is wrapped in one) or a table row
        // (tr) — back a slice off to the top of whichever block would
        // otherwise straddle the page boundary, rather than screenshotting
        // straight through the middle of it.
        const contentRect = contentRef.current.getBoundingClientRect()
        const blocks = [...contentRef.current.querySelectorAll('.card, tr')]
          .map(el => {
            const r = el.getBoundingClientRect()
            return { top: (r.top - contentRect.top) * scale, bottom: (r.bottom - contentRect.top) * scale }
          })
          .filter(b => b.bottom > b.top)
          .sort((a, b) => a.top - b.top)

        const pageH = ph - 20
        const srcHPerPage = (pageH * canvas.width) / imgW
        let srcY = 0
        while (srcY < canvas.height) {
          let sliceEnd = Math.min(srcY + srcHPerPage, canvas.height)
          for (const b of blocks) {
            if (b.top > srcY && b.top < sliceEnd && b.bottom > sliceEnd) {
              sliceEnd = b.top
              break // sorted ascending — first straddling block is the safest (smallest) cut
            }
          }
          if (sliceEnd <= srcY) sliceEnd = Math.min(srcY + srcHPerPage, canvas.height) // oversized single block — no safe cut available, fall back

          const sliceH = sliceEnd - srcY
          const tmpCanvas = document.createElement('canvas')
          tmpCanvas.width = canvas.width; tmpCanvas.height = sliceH
          const ctx = tmpCanvas.getContext('2d')
          ctx.drawImage(canvas, 0, -srcY)
          const segH = (sliceH * imgW) / canvas.width
          pdf.addImage(tmpCanvas.toDataURL('image/png'), 'PNG', 10, 10, imgW, segH)
          srcY = sliceEnd
          if (srcY < canvas.height) pdf.addPage()
        }
      }
    }

    pdf.save(`audit-${(accountName || 'account').replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`)
    return true
  } catch (err) {
    console.error('PDF export failed:', err)
    return false
  }
}

// ── AI recommendation cell ────────────────────────────────────────────────────
export function AiRecCell({ rec, loading, rowLoading, aiReady, onRetry }) {
  if (loading || rowLoading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="skeleton" style={{ height: 10, width: '90%', borderRadius: 3 }} />
      <div className="skeleton" style={{ height: 10, width: '70%', borderRadius: 3 }} />
    </div>
  )
  if (!rec) {
    const label = aiReady ? 'No recommendation returned' : '—'
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#bbb', fontSize: 11 }}>{label}</span>
        {onRetry && (
          <button
            onClick={e => { e.stopPropagation(); onRetry() }}
            title="Fetch recommendation for this issue"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', fontSize: 10,
              color: '#2563b0', background: 'rgba(37,99,176,0.08)', border: '1px solid rgba(37,99,176,0.25)',
              borderRadius: 4, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            <RefreshCw size={9} /> Retry
          </button>
        )}
      </div>
    )
  }
  const parts = rec.split(/[•\n]+/).map(p => p.trim()).filter(Boolean)
  return (
    <div style={{ fontSize: 11, color: '#1a3a6b', lineHeight: 1.6, maxWidth: 380 }}>
      {parts.length <= 1
        ? <div>{highlightRecommendation(rec.trim())}</div>
        : parts.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 5, marginBottom: i < parts.length - 1 ? 3 : 0 }}>
              <span style={{ color: '#2563b0', fontWeight: 700, flexShrink: 0 }}>•</span>
              <span>{highlightRecommendation(p)}</span>
            </div>
          ))
      }
    </div>
  )
}

// ── Empty / placeholder states ────────────────────────────────────────────────
// Print-only section divider — only rendered when exporting to PDF (pdfMode),
// since on-screen the top nav bar + active tab already make this clear, but
// once every section is stacked into one flat document for html2canvas to
// capture, there's nothing else marking where one section ends and the next
// begins. `level` 1 = top-level section, 2 = inner sub-tab within one.
export function PdfHeading({ title, description, level = 1 }) {
  const isTop = level === 1
  return (
    <div style={{
      padding: isTop ? '22px 4px 12px' : '14px 4px 8px',
      marginTop: isTop ? 26 : 14, marginBottom: 14,
      borderBottom: isTop ? '3px solid #1a3a6b' : '2px solid #dde9f5',
    }}>
      <div style={{ fontSize: isTop ? 22 : 16, fontWeight: 800, color: '#1a3a6b' }}>{title}</div>
      {description && <div style={{ fontSize: 11.5, color: '#777', marginTop: 4, maxWidth: 900 }}>{description}</div>}
    </div>
  )
}

export function ComingSoon({ children }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: '#aaa' }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Not available yet</div>
      <div style={{ fontSize: 12 }}>{children}</div>
    </div>
  )
}

// ── Keyword Audit array builders ──────────────────────────────────────────────
// Shared by the tables that display these lists AND the count badges (top nav
// + inner tab strip), so the numbers shown always match what's actually
// rendered — building them in exactly one place is what keeps that true.
// Only Enabled keywords — once the user pauses/removes one via the Action
// column, it must stop being recommended on the next audit run rather than
// reappearing because the underlying metrics query only excludes Removed
// (kept that way so Reports' historical view isn't affected by this filter).
const isEnabledKw = k => !k.status || k.status === 'Enabled'
export function computeKwPerfIssues(kwAnalysis) {
  if (!kwAnalysis) return []
  const out = []
  for (const k of kwAnalysis.highSpendNoConv || []) if (isEnabledKw(k)) out.push({ ...k, issue: 'High Spend, Zero Conversions', severity: 'Critical' })
  for (const k of kwAnalysis.lowQsKws || [])       if (isEnabledKw(k)) out.push({ ...k, issue: 'Poor Quality Score', severity: 'High' })
  for (const k of kwAnalysis.lowCtrKws || [])      if (isEnabledKw(k)) out.push({ ...k, issue: 'Low CTR', severity: 'Medium' })
  for (const k of kwAnalysis.expensiveCpc || [])   if (isEnabledKw(k)) out.push({ ...k, issue: 'High CPC', severity: 'Low' })
  return out
}
export function computeKwPerfOpportunities(kwAnalysis) {
  if (!kwAnalysis) return []
  return (kwAnalysis.topByConv || []).filter(isEnabledKw).map(k => ({ ...k, issue: 'High-Converting Keyword', severity: 'Opportunity' }))
}
// Only recommend a target that's actually still live — a search term seen in
// a since-paused/removed campaign or ad group can't be published into it (the
// publish modal's own campaign picker excludes paused campaigns too), so
// recommending it would just show a pre-selection that silently doesn't match
// any option.
const isActiveTarget = t => t.campaignStatus === 'Enabled' && t.adGroupStatus === 'Enabled'

// ── Deterministic campaign/ad-group routing ──────────────────────────────────
// A search term can trigger impressions in an ad group it doesn't actually
// belong to (broad/phrase match crossover) — recommending "add it right where
// it was seen" in that case just entrenches the mis-routing. Before trusting
// the observed location, check every real, enabled campaign/ad-group name in
// the account for a literal word match with the term — a real text match
// (e.g. "junk removal" -> a "Junk Removal" ad group) beats "wherever it
// happened to trigger" every time. Same algorithm as the Keywords Manager AI
// Planner's routing check (electron/main.js), kept in sync deliberately.
const ROUTING_STOPWORDS = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'to', 'your', 'our', 'with', 'near', 'me'])

function routingTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !ROUTING_STOPWORDS.has(w))
}

function buildCampaignAdGroupPairs(data) {
  const campaigns = data?.campaigns || []
  const adGroups  = data?.adGroups  || []
  const enabledCampaignIds = new Set(campaigns.filter(c => c.status === 'Enabled').map(c => c.id))
  return adGroups
    .filter(ag => ag.status === 'Enabled' && enabledCampaignIds.has(ag.campaignId))
    .map(ag => ({ campaign: ag.campaignName, adGroup: ag.name, campaignId: ag.campaignId, adGroupId: ag.id }))
}

function findBestCampaignMatch(text, pairs) {
  const words = routingTokens(text)
  if (!words.length || !pairs?.length) return null
  const sharesWord = (w, others) => others.some(o => o === w || o.includes(w) || w.includes(o))
  let best = null, bestScore = 0
  for (const pair of pairs) {
    const campWords = routingTokens(pair.campaign)
    const agWords    = routingTokens(pair.adGroup)
    const score = words.filter(w => sharesWord(w, agWords)).length * 2 + words.filter(w => sharesWord(w, campWords)).length
    if (score > bestScore) { bestScore = score; best = pair }
  }
  return bestScore > 0 ? best : null
}

// Recommended publish target: Exact match. Defaults to the ad group the term
// was actually seen converting in, UNLESS a different existing campaign/ad
// group's name is a stronger literal word match for the term — see routing
// note above.
export function computeSearchTermPositives(stAnalysis, data) {
  if (!stAnalysis) return []
  const pairs = buildCampaignAdGroupPairs(data)
  const seen = new Set(); const out = []
  for (const t of [...(stAnalysis.highIntent?.drivingConversions || []), ...(stAnalysis.highIntent?.newKwOpportunities || [])]) {
    if (seen.has(t.term) || !isActiveTarget(t)) continue
    seen.add(t.term)
    const match = findBestCampaignMatch(t.term, pairs)
    const useMatch = match && (match.campaign !== t.campaign || match.adGroup !== t.adGroup)
    out.push({
      ...t,
      recMatchType:  'Exact',
      recLevel:      'Ad Group',
      recCampaign:   useMatch ? match.campaign   : t.campaign,
      recAdGroup:    useMatch ? match.adGroup    : t.adGroup,
      recCampaignId: useMatch ? match.campaignId : t.campaignId,
      recAdGroupId:  useMatch ? match.adGroupId  : t.adGroupId,
    })
  }
  return out
}
// Recommended publish target: Phrase match, at the ad group the wasted spend
// was actually seen in — the safest default (only blocks it where the
// problem was observed, doesn't reach across other ad groups/campaigns).
export function computeSearchTermNegatives(stAnalysis) {
  if (!stAnalysis) return []
  const seen = new Set(); const out = []
  const w = stAnalysis.wastedSpend || {}
  for (const t of [...(w.informational || []), ...(w.competitorLeakage || []), ...(w.lowIntentQueries || []), ...(w.irrelevantTraffic || [])]) {
    if (seen.has(t.term) || !isActiveTarget(t)) continue
    seen.add(t.term)
    // No routing override here on purpose — a negative should block the
    // wasted spend right where it's leaking, not somewhere it just sounds
    // more related to.
    out.push({
      ...t,
      recMatchType: 'Phrase', recLevel: 'Ad Group',
      recCampaign: t.campaign, recAdGroup: t.adGroup,
      recCampaignId: t.campaignId, recAdGroupId: t.adGroupId,
    })
  }
  return out
}

// ── Performance Audit rollup ──────────────────────────────────────────────────
// Shared by the Performance Audit table AND the count badges — same reason as
// the keyword-audit builders above: whatever the table actually shows is what
// gets counted, nothing separately derived from uncapped stats.
export function computeTopOffenders({ data, kwAnalysis, adAnalysis }) {
  const budgetIssues = (data?.campaigns || []).filter(c => c.issue)
  const worstKeywords = kwAnalysis
    ? (kwAnalysis.highSpendNoConv || []).filter(isEnabledKw).map(k => ({ entity: k.text, type: 'Keyword', metric: 'High Spend, Zero Conversions', value: fmtUsd(k.cost), severity: 'Critical', resourceName: k.resourceName, matchType: k.matchType }))
    : []
  const worstAds = adAnalysis ? [
    ...(adAnalysis.weak?.byLowCtr || []).map(a => ({ entity: a._headline || a.headline1, type: 'Ad', metric: 'Low CTR', value: fmtPct(a.ctr), severity: 'High' })),
    ...(adAnalysis.weak?.byLowConvRate || []).map(a => ({ entity: a._headline || a.headline1, type: 'Ad', metric: 'Low Conversion Rate', value: fmtPct(a.convRate), severity: 'Medium' })),
  ] : []
  const worstCampaigns = budgetIssues.map(c => ({ entity: c.name, type: 'Campaign', metric: c.issue, value: fmtPct(c.utilization), severity: c.issue === 'Overpacing' ? 'High' : 'Medium' }))

  const all = [...worstKeywords, ...worstAds, ...worstCampaigns]
  const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 }
  return all.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
}

// ── Row actions ────────────────────────────────────────────────────────────────
// Shared "the AI flagged an issue, now let the user act on it directly"
// pattern — a click-to-confirm inline control rather than a full modal, since
// these are single-row, single-field writes. Used anywhere an audit table
// finding maps onto a real, actionable Google Ads write.

// Pauses a positive keyword (ad_group_criterion). row needs a `resourceName`
// (already carried through by computeKwPerfIssues / computeTopOffenders).
export function PauseKeywordAction({ row, selectedAccount }) {
  const [confirming, setConfirming] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  if (!row.resourceName || !selectedAccount) return null
  if (done) return <span style={{ fontSize: 11, color: '#888' }}>Paused</span>
  if (pausing) return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#888' }}><Loader2 size={11} className="spin" /> Pausing…</span>

  if (confirming) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#c0392b', fontWeight: 600 }}>Pause?</span>
        <button
          onClick={async () => {
            setPausing(true); setError(null)
            try {
              await window.electronAPI.keywordManagerUpdateKeyword({ customerId: selectedAccount.id, resourceName: row.resourceName, newStatus: 'Paused' })
              setDone(true)
            } catch (e) {
              setError(e.message || 'Failed to pause keyword')
            } finally {
              setPausing(false); setConfirming(false)
            }
          }}
          style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          Yes
        </button>
        <button onClick={() => setConfirming(false)} style={{ fontSize: 11, padding: '3px 9px', background: 'none', color: '#888', border: '1px solid #dde9f5', borderRadius: 4, cursor: 'pointer' }}>
          Cancel
        </button>
      </span>
    )
  }

  return (
    <span>
      <button
        onClick={() => setConfirming(true)}
        style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', background: 'none', color: '#c0392b', border: '1px solid #ffd5cc', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        Pause
      </button>
      {error && <div style={{ fontSize: 10.5, color: '#c0392b', marginTop: 3 }}>{error}</div>}
    </span>
  )
}

// Pause and/or Remove for a NEGATIVE keyword (campaign/ad-group/list level).
// row needs negativeResourceName + negativeLevel (CAMPAIGN | AD_GROUP | LIST).
// List-level negatives can't be paused in the Google Ads API — Remove only.
export function NegativeKeywordAction({ row, selectedAccount, onDone }) {
  const [mode, setMode] = useState(null) // 'pause' | 'remove' | null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null) // 'paused' | 'removed' | null

  if (!row.negativeResourceName || !selectedAccount) return null
  const level = row.negativeLevel
  const canPause = level === 'CAMPAIGN' || level === 'AD_GROUP'

  if (result === 'paused') return <span style={{ fontSize: 11, color: '#888' }}>Paused</span>
  if (result === 'removed') return <span style={{ fontSize: 11, color: '#888' }}>Removed</span>
  if (busy) return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#888' }}><Loader2 size={11} className="spin" /> Working…</span>

  async function run() {
    setBusy(true); setError(null)
    try {
      if (mode === 'pause') {
        await window.electronAPI.auditUpdateNegativeKeywordStatus({ customerId: selectedAccount.id, level, resourceName: row.negativeResourceName, newStatus: 'Paused' })
        setResult('paused')
      } else {
        const rns = [row.negativeResourceName]
        if (level === 'CAMPAIGN') await window.electronAPI.removeCampaignLevelNegatives({ customerId: selectedAccount.id, resourceNames: rns })
        else if (level === 'AD_GROUP') await window.electronAPI.removeAdGroupLevelNegatives({ customerId: selectedAccount.id, resourceNames: rns })
        else await window.electronAPI.removeSharedListNegatives({ customerId: selectedAccount.id, resourceNames: rns })
        setResult('removed')
      }
      onDone?.()
    } catch (e) {
      setError(e.message || 'Action failed')
    } finally {
      setBusy(false); setMode(null)
    }
  }

  if (mode) {
    const isRemove = mode === 'remove'
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#c0392b', fontWeight: 600 }}>{isRemove ? 'Remove?' : 'Pause?'}</span>
        <button onClick={run} style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Yes</button>
        <button onClick={() => setMode(null)} style={{ fontSize: 11, padding: '3px 9px', background: 'none', color: '#888', border: '1px solid #dde9f5', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
      </span>
    )
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ display: 'inline-flex', gap: 6 }}>
        {canPause && (
          <button onClick={() => setMode('pause')} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', background: 'none', color: '#8a6000', border: '1px solid #ffe0b2', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Pause
          </button>
        )}
        <button onClick={() => setMode('remove')} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', background: 'none', color: '#c0392b', border: '1px solid #ffd5cc', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          Remove
        </button>
      </span>
      {error && <span style={{ fontSize: 10.5, color: '#c0392b' }}>{error}</span>}
    </span>
  )
}

// Shared category-count computation — used by both the Overview tab's tiles
// and the top-level nav badges, so they never drift out of sync. Uses the
// exact same array builders the tables render from (see above), so the top
// nav's "Keyword Audit" badge always equals the sum of its inner sub-tab
// badges instead of mixing in uncapped stats the tables don't actually show.
export function computeCategoryCounts({ data, structureData, conflictData, kwAnalysis, stAnalysis, adAnalysis, assetAudit }) {
  const { ads = [], campaigns = [], adGroups = [], keywords = {}, crossovers = [] } = data || {}
  const poorAds = ads.filter(a => ['POOR', 'AVERAGE'].includes(normalizeStrength(a.adStrength)))
  const disapproved = ads.filter(a => String(a.approvalStatus) === 'DISAPPROVED')
  const budgetIssues = campaigns.filter(c => c.issue)
  const agIssues = adGroups.filter(a => a.impressions === 0 && ['ENABLED', '2'].includes(String(a.status)))
  const crossoverKws = keywords.conflicts || []

  const kwIssuesCount = computeKwPerfIssues(kwAnalysis).length
  const stNegCount = computeSearchTermNegatives(stAnalysis).length

  return {
    campaign:    budgetIssues.length + agIssues.length + crossovers.length,
    keyword:     kwIssuesCount + stNegCount + crossoverKws.length + (conflictData?.conflicts?.length || 0),
    adRsa:       poorAds.length,
    asset:       assetAudit ? [assetAudit.sitelinks.length === 0, assetAudit.callouts.length === 0, assetAudit.snippets.length === 0].filter(Boolean).length + assetAudit.duplicateSitelinks.length + assetAudit.duplicateCallouts.length : 0,
    conversion:  structureData ? structureData.conversionActions.filter(a => !a.included).length + (structureData.conversionActions.length === 0 ? 1 : 0) : 0,
    performance: computeTopOffenders({ data, kwAnalysis, adAnalysis }).length,
    duplicate:   crossoverKws.length,
    policy:      disapproved.length,
  }
}

// Same severity rollup used by the Overview tab's stat tiles and the PDF
// cover page, so the two never show different totals for the same audit run.
export function computeSeveritySummary(counts) {
  const total = Object.values(counts).reduce((s, v) => s + v, 0)
  return {
    total,
    critical: counts.policy || 0,
    high:     (counts.campaign || 0) + (counts.duplicate || 0),
    medium:   counts.keyword || 0,
    low:      (counts.adRsa || 0) + (counts.asset || 0) + (counts.conversion || 0) + (counts.performance || 0),
  }
}

export function InnerTabStrip({ tabs, activeTab, onChange, counts = {} }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #eef2f7', marginBottom: 16, flexWrap: 'wrap' }}>
      {tabs.map(t => {
        const isActive = activeTab === t.id
        const count = counts[t.id]
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              padding: '9px 14px', fontSize: 12.5, fontWeight: isActive ? 700 : 500,
              color: isActive ? '#1a3a6b' : '#666',
              background: isActive ? '#eef4fc' : 'none', border: 'none', borderRadius: '6px 6px 0 0',
              cursor: 'pointer', whiteSpace: 'nowrap',
              borderBottom: isActive ? '2px solid #1a3a6b' : '2px solid transparent',
              marginBottom: -1, display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {t.label}
            {count > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, minWidth: 16, textAlign: 'center', background: isActive ? '#1a3a6b' : '#e05c2a', color: '#fff' }}>
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
