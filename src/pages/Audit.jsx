import React, { useState, useEffect, useMemo, useRef } from 'react'
import { ShieldCheck, AlertCircle, RefreshCw, FileDown, Sparkles } from 'lucide-react'
import ReportTable from '../components/ReportTable.jsx'
import ExportButton from '../components/ExportButton.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtUsd = v => '$' + Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})
const fmtNum = v => Number(v||0).toLocaleString()
const fmtPct = v => Number(v||0).toFixed(1) + '%'

// ── Health score calculation ──────────────────────────────────────────────────
const isEnabledCampaign = c => c.status === 'Enabled'

function calculateHealthScore(data) {
  if (!data) return null
  let score = 100
  const { ads=[], campaigns=[], adGroups=[], keywords={}, crossovers=[] } = data
  // Each deduction uses the same filter + cap as the section header badge
  const poorAds      = ads.filter(a => ['POOR','AVERAGE'].includes(normalizeStrength(a.adStrength)))
  const disapproved  = ads.filter(a => ['DISAPPROVED'].includes(String(a.approvalStatus)))
  const conflicts    = keywords.conflicts || []
  const budgetIssues = campaigns.filter(c => c.issue)
  const agIssues     = adGroups.filter(a => a.impressions === 0 && ['ENABLED','2'].includes(String(a.status)))

  score -= Math.min(poorAds.length * 5, 30)       // -5 per ad,  max -30
  score -= disapproved.length * 10                 // -10 per disapproved ad
  if (conflicts.length > 0) score -= 10            // flat -10 if any conflicts
  score -= Math.min(budgetIssues.length * 5, 25)  // -5 per campaign, max -25
  score -= Math.min(agIssues.length * 3, 15)       // -3 per ad group, max -15
  score -= crossovers.length * 15                  // -15 per crossover

  return Math.max(0, Math.min(100, score))
}

function HealthBadge({ score }) {
  if (score === null) return null
  const { label, color, bg } = score >= 80 ? { label:'Healthy',          color:'#2e7d32', bg:'rgba(76,175,80,0.12)'   }
                              : score >= 60 ? { label:'Needs Attention',  color:'#8a6000', bg:'rgba(240,180,41,0.15)'  }
                              :               { label:'Critical Issues',   color:'#c0392b', bg:'rgba(224,92,42,0.12)'   }
  return (
    <span style={{ fontSize:13, fontWeight:700, padding:'4px 12px', borderRadius:6, background:bg, color }}>
      {score}/100 — {label}
    </span>
  )
}

function Section({ title, count, children, extra, deduction }) {
  return (
    <div className="card" style={{ marginBottom:20 }}>
      <div className="card-header">
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span className="card-title">{title}</span>
          {deduction && <span style={{ fontSize:11, color:'#e05c2a', fontWeight:600 }}>−{deduction} pts</span>}
        </div>
        {extra}
      </div>
      {children}
    </div>
  )
}

// ── Ad Strength section ───────────────────────────────────────────────────────
const AD_STRENGTH_MAP = {
  0:'UNSPECIFIED', 1:'UNKNOWN', 2:'PENDING', 3:'NO_ADS',
  4:'POOR', 5:'AVERAGE', 6:'GOOD', 7:'EXCELLENT',
}
const normalizeStrength = v => {
  if (v === null || v === undefined || v === '') return 'UNSPECIFIED'
  const num = Number(v)
  if (!isNaN(num) && AD_STRENGTH_MAP[num]) return AD_STRENGTH_MAP[num]
  const s = String(v).toUpperCase()
  if (s === 'FAIR') return 'AVERAGE'    // legacy alias
  return s
}
const AD_STRENGTH_STYLE = {
  EXCELLENT:   { bg:'rgba(76,175,80,0.12)',   color:'#2e7d32' },
  GOOD:        { bg:'rgba(37,99,176,0.12)',   color:'#1a4a90' },
  AVERAGE:     { bg:'rgba(240,180,41,0.15)', color:'#8a6000' },
  POOR:        { bg:'rgba(224,92,42,0.12)',  color:'#c0392b' },
  PENDING:     { bg:'rgba(150,150,150,0.1)', color:'#666'    },
  NO_ADS:      { bg:'rgba(150,150,150,0.1)', color:'#666'    },
  UNSPECIFIED: { bg:'rgba(150,150,150,0.1)', color:'#666'    },
  UNKNOWN:     { bg:'rgba(150,150,150,0.1)', color:'#666'    },
}
function AdStrengthBadge({ value }) {
  const label = normalizeStrength(value)
  const s = AD_STRENGTH_STYLE[label] || AD_STRENGTH_STYLE.UNSPECIFIED
  return <span style={{ fontSize:11, fontWeight:600, padding:'2px 7px', borderRadius:4, background:s.bg, color:s.color }}>{label}</span>
}

const AD_STATUS_MAP = { 0:'Unspecified', 1:'Unknown', 2:'Enabled', 3:'Paused', 4:'Removed' }
const AD_STATUS_STYLE = {
  Enabled:     { bg:'rgba(76,175,80,0.12)',  color:'#2e7d32' },
  Paused:      { bg:'rgba(240,180,41,0.15)', color:'#8a6000' },
  Removed:     { bg:'rgba(224,92,42,0.12)', color:'#c0392b' },
  Unspecified: { bg:'rgba(150,150,150,0.1)', color:'#666'   },
  Unknown:     { bg:'rgba(150,150,150,0.1)', color:'#666'   },
}
const normalizeAdStatus = v => {
  if (v === null || v === undefined || v === '') return 'Unspecified'
  const num = Number(v)
  if (!isNaN(num) && AD_STATUS_MAP[num]) return AD_STATUS_MAP[num]
  const s = String(v)
  const title = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
  return AD_STATUS_STYLE[title] ? title : (AD_STATUS_STYLE[s] ? s : 'Unspecified')
}
function AdStatusBadge({ value }) {
  const label = normalizeAdStatus(value)
  const s = AD_STATUS_STYLE[label] || AD_STATUS_STYLE.Unspecified
  return <span style={{ fontSize:11, fontWeight:600, padding:'2px 7px', borderRadius:4, background:s.bg, color:s.color }}>{label}</span>
}

function adRecommendation(ad) {
  if (['POOR','AVERAGE'].includes(normalizeStrength(ad.adStrength))) {
    if (!ad.headlines?.length) return 'Add more unique headlines'
    if (ad.headlines.length < 3) return 'Add at least 3 unique headlines with keywords'
    return 'Improve description relevance and include keywords in headlines'
  }
  return '—'
}

// ── Budget utilization bar ────────────────────────────────────────────────────
function UtilBar({ pct }) {
  const color = pct > 120 ? '#e05c2a' : pct > 95 ? '#f0b429' : '#4caf50'
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <div style={{ width:80, height:8, background:'#dde9f5', borderRadius:4, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${Math.min(pct,100)}%`, background:color, borderRadius:4 }}/>
      </div>
      <span style={{ fontSize:11, fontWeight:600, color }}>{fmtPct(pct)}</span>
    </div>
  )
}

// ── PDF export ────────────────────────────────────────────────────────────────
async function exportAuditPDF(contentRef, accountName, score) {
  try {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const { default: html2canvas } = await import('html2canvas')

    const pdf = new jsPDF('landscape', 'mm', 'a4')
    const pw  = pdf.internal.pageSize.getWidth()
    const ph  = pdf.internal.pageSize.getHeight()

    // Cover page
    pdf.setFillColor(26, 58, 107)
    pdf.rect(0, 0, pw, ph, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(28); pdf.setFont('helvetica','bold')
    pdf.text('Account Audit Report', pw/2, 50, { align:'center' })
    pdf.setFontSize(16); pdf.setFont('helvetica','normal')
    pdf.text(accountName || 'Unknown Account', pw/2, 65, { align:'center' })
    pdf.text(new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}), pw/2, 78, { align:'center' })
    pdf.setFontSize(22); pdf.setFont('helvetica','bold')
    pdf.setTextColor(score>=80?76:score>=60?240:224, score>=80?175:score>=60?180:92, score>=80?80:score>=60?41:42)
    pdf.text(`Health Score: ${score}/100`, pw/2, 100, { align:'center' })

    // Capture content as image
    if (contentRef?.current) {
      pdf.addPage()
      const canvas = await html2canvas(contentRef.current, { scale:1.5, useCORS:true, allowTaint:true })
      const imgW = pw - 20
      const imgH = (canvas.height * imgW) / canvas.width
      let y = 10
      if (imgH <= ph - 20) {
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, y, imgW, imgH)
      } else {
        // Split into pages
        const pageH = ph - 20
        let srcY = 0
        const srcH = (pageH * canvas.width) / imgW
        while (srcY < canvas.height) {
          const tmpCanvas = document.createElement('canvas')
          tmpCanvas.width = canvas.width; tmpCanvas.height = Math.min(srcH, canvas.height - srcY)
          const ctx = tmpCanvas.getContext('2d')
          ctx.drawImage(canvas, 0, -srcY)
          const segH = (tmpCanvas.height * imgW) / canvas.width
          pdf.addImage(tmpCanvas.toDataURL('image/png'), 'PNG', 10, 10, imgW, segH)
          srcY += srcH
          if (srcY < canvas.height) pdf.addPage()
        }
      }
    }

    pdf.save(`audit-${(accountName||'account').replace(/\s+/g,'-')}-${new Date().toISOString().slice(0,10)}.pdf`)
    return true
  } catch (err) {
    console.error('PDF export failed:', err)
    return false
  }
}

// ── AI recommendation cell ────────────────────────────────────────────────────
function AiRecCell({ rec, loading, rowLoading, aiReady, onRetry }) {
  if (loading || rowLoading) return (
    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
      <div className="skeleton" style={{ height:10, width:'90%', borderRadius:3 }}/>
      <div className="skeleton" style={{ height:10, width:'70%', borderRadius:3 }}/>
    </div>
  )
  if (!rec) {
    const label = aiReady ? 'No recommendation returned' : '—'
    return (
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ color:'#bbb', fontSize:11 }}>{label}</span>
        {onRetry && (
          <button
            onClick={e => { e.stopPropagation(); onRetry() }}
            title="Fetch recommendation for this issue"
            style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'2px 7px', fontSize:10,
              color:'#2563b0', background:'rgba(37,99,176,0.08)', border:'1px solid rgba(37,99,176,0.25)',
              borderRadius:4, cursor:'pointer', fontWeight:600, whiteSpace:'nowrap' }}
          >
            <RefreshCw size={9} /> Retry
          </button>
        )}
      </div>
    )
  }
  const parts = rec.split(/[•\n]+/).map(p => p.trim()).filter(Boolean)
  return (
    <div style={{ fontSize:11, color:'#1a3a6b', lineHeight:1.6, maxWidth:380 }}>
      {parts.length <= 1
        ? <div>{rec.trim()}</div>
        : parts.map((p, i) => (
            <div key={i} style={{ display:'flex', gap:5, marginBottom: i < parts.length-1 ? 3 : 0 }}>
              <span style={{ color:'#2563b0', fontWeight:700, flexShrink:0 }}>•</span>
              <span>{p}</span>
            </div>
          ))
      }
    </div>
  )
}

// ── Section data extractors (shared by bulk + per-row builders) ───────────────
function getSectionRows(data) {
  const { ads=[], campaigns=[], adGroups=[], keywords={}, crossovers=[] } = data
  return {
    adStrength:   ads.filter(a => ['POOR','AVERAGE','GOOD'].includes(normalizeStrength(a.adStrength))),
    conflicts:    keywords.conflicts || [],
    budgetIssues: campaigns.filter(c => c.issue),
    agIssues:     adGroups.filter(a => a.impressions === 0 && ['ENABLED','2'].includes(String(a.status))),
    crossovers,
    policyIssues: ads.filter(a => ['DISAPPROVED'].includes(String(a.approvalStatus))),
  }
}

const ITEM_BUILDER = {
  adStrength:   (a, i) => ({ index:i, strength:a.adStrength, headlines:a.headlines?.length||0, campaign:a.campaign, adGroup:a.adGroup }),
  conflicts:    (c, i) => ({ index:i, keyword:c.keyword, issue:c.issueType, campaign:c.campaign, adGroups:(c.adGroupEntries||[]).map(e=>`${e.adGroup} [${e.matchType}]`).join(', ') || c.adGroups }),
  budgetIssues: (c, i) => ({ index:i, campaign:c.name, issue:c.issue, utilization:c.utilization?.toFixed(1)+'%', budget:'$'+Number(c.budget||0).toFixed(2), spend:'$'+Number(c.spend||0).toFixed(2) }),
  agIssues:     (a, i) => ({ index:i, adGroup:a.name, campaign:a.campaign }),
  crossovers:   (c, i) => ({ index:i, campaignA:c.campaignA, campaignB:c.campaignB, issue:c.issueType }),
  policyIssues: (a, i) => ({ index:i, campaign:a.campaign, adGroup:a.adGroup, status:a.approvalStatus }),
}

// Bulk payload — capped at 20 per section (fits in 8192 output tokens)
function buildAiSections(data) {
  const rows = getSectionRows(data)
  return Object.fromEntries(
    Object.entries(ITEM_BUILDER).map(([section, build]) => [
      section,
      rows[section].slice(0, 20).map((item, i) => build(item, i)),
    ])
  )
}

// Single-item payload for per-row retry
function buildSingleItem(data, section, index) {
  const rows = getSectionRows(data)
  const item = (rows[section] || [])[index]
  if (!item || !ITEM_BUILDER[section]) return null
  return ITEM_BUILDER[section](item, index)
}

// ── Audit tabs ────────────────────────────────────────────────────────────────
const AUDIT_TABS = [
  { id: 'adStrength', label: 'Ad Strength'      },
  { id: 'conflicts',  label: 'KW Conflicts'      },
  { id: 'budget',     label: 'Budget Issues'     },
  { id: 'adGroups',   label: 'Ad Groups'         },
  { id: 'crossovers', label: 'Crossovers'        },
  { id: 'policy',     label: 'Policy & Approval' },
]

// ── Main Audit page ───────────────────────────────────────────────────────────
export default function Audit({ selectedAccount, dateRange = 'LAST_30_DAYS' }) {
  const [auditData,     setAuditData]     = useState(null)
  const [aiRecs,        setAiRecs]        = useState(null)
  const [aiLoading,     setAiLoading]     = useState(false)
  const [aiError,       setAiError]       = useState(null)
  const [aiRowLoading,  setAiRowLoading]  = useState(new Set())
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [lastAuditTime, setLastAuditTime] = useState(null)
  const [exporting,     setExporting]     = useState(false)
  const [pdfMode,       setPdfMode]       = useState(false)
  const [activeTab,        setActiveTab]        = useState('adStrength')
  const [statusFilter,     setStatusFilter]     = useState('ENABLED')
  const [conflictFilters,  setConflictFilters]  = useState({ campaignName:'', adGroupName:'' })
  const [budgetCampFilter,    setBudgetCampFilter]    = useState('')
  const [adStrengthFilter,    setAdStrengthFilter]    = useState('')
  const contentRef = useRef(null)

  // Reset audit data when filter changes so stale data isn't shown
  useEffect(() => {
    setAuditData(null); setAiRecs(null); setAiError(null); setError(null)
  }, [statusFilter])

  const healthScore = useMemo(() => calculateHealthScore(auditData), [auditData])

  async function fetchAiRecs(data, forceRefresh = false) {
    if (!window.electronAPI?.auditAiRecommend) {
      console.warn('[AI Recs] auditAiRecommend not available — restart the app to load the new preload.')
      setAiError('Restart the app to enable AI recommendations.')
      return
    }
    setAiLoading(true); setAiRecs(null); setAiError(null)
    try {
      const sections = buildAiSections(data)
      const totalItems = Object.values(sections).reduce((s, arr) => s + arr.length, 0)
      console.log('[AI Recs] sending', totalItems, 'items to Claude, forceRefresh:', forceRefresh)
      const recs = await window.electronAPI.auditAiRecommend({ customerId: selectedAccount.id, sections, forceRefresh })
      console.log('[AI Recs] received sections:', Object.keys(recs || {}))
      setAiRecs(recs || {})
    } catch (err) {
      console.error('[AI Recs] error:', err.message)
      setAiError(err.message || 'AI recommendations failed — try running the audit again.')
    } finally { setAiLoading(false) }
  }

  async function fetchSingleRec(section, index) {
    if (!auditData || !window.electronAPI?.auditAiRecommend) return
    const item = buildSingleItem(auditData, section, index)
    if (!item) return
    const rowKey = `${section}-${index}`
    setAiRowLoading(prev => new Set([...prev, rowKey]))
    try {
      const recs = await window.electronAPI.auditAiRecommend({
        customerId: selectedAccount.id,
        sections: { [section]: [item] },
        forceRefresh: true,
      })
      const newRec = recs?.[section]?.find(r => Number(r.index) === index)
      if (newRec) {
        setAiRecs(prev => ({
          ...prev,
          [section]: [
            ...(prev?.[section] || []).filter(r => Number(r.index) !== index),
            { index, recommendation: newRec.recommendation },
          ],
        }))
      }
    } catch (err) {
      console.error('[AI Single Rec] error:', err.message)
    } finally {
      setAiRowLoading(prev => { const n = new Set(prev); n.delete(rowKey); return n })
    }
  }

  async function runAudit() {
    if (!selectedAccount || loading) return
    setLoading(true); setError(null); setAiRecs(null); setAiError(null)
    try {
      const data = await window.electronAPI.fetchAudit({ customerId: selectedAccount.id, statusFilter, dateRange })
      setAuditData(data); setLastAuditTime(new Date())
      fetchAiRecs(data)
    } catch (err) {
      setError(err.message || 'Audit failed')
    } finally { setLoading(false) }
  }

  async function handleExportPDF() {
    if (!auditData || exporting) return
    setExporting(true)
    setPdfMode(true)                              // render all sections
    await new Promise(r => setTimeout(r, 400))   // wait for React to paint
    await exportAuditPDF(contentRef, selectedAccount?.name, healthScore)
    setPdfMode(false)                             // restore tab view
    setExporting(false)
  }

  if (!selectedAccount) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12, color:'#888', background:'#f5f7fa' }}>
        <ShieldCheck size={48} style={{ opacity:0.3 }}/>
        <div style={{ fontWeight:500 }}>Select an account to run an audit</div>
      </div>
    )
  }

  const { ads=[], campaigns=[], adGroups=[], keywords={}, crossovers=[], assetGroups=[] } = auditData || {}
  const poorAds        = ads.filter(a => ['POOR','AVERAGE'].includes(normalizeStrength(a.adStrength)))
  const aiEligibleAds  = ads.filter(a => ['POOR','AVERAGE','GOOD'].includes(normalizeStrength(a.adStrength)))
  const disapproved    = ads.filter(a => ['DISAPPROVED'].includes(String(a.approvalStatus)))
  const budgetIssues   = campaigns.filter(c => c.issue)
  const agIssues       = adGroups.filter(a => a.impressions === 0 && ['ENABLED','2'].includes(String(a.status)))
  const conflicts      = keywords.conflicts || []

  // Merge AI recommendations into row arrays
  // Number() coercion handles Claude returning index as string "0" instead of integer 0
  const aiRec = (section, index) => {
    const arr = aiRecs?.[section]
    if (!Array.isArray(arr)) return null
    const item = arr.find(r => Number(r.index) === Number(index))
    return item?.recommendation ?? null
  }
  const aiReady = !!aiRecs && !aiLoading
  const aiCol = (section) => ({
    key: '_ai', label: '🤖 AI Recommendation', sortable: false, align: 'left', wrap: true,
    format: (_, row) => {
      const idx = row._aiIdx ?? 0
      return (
        <AiRecCell
          rec={aiRec(section, idx)}
          loading={aiLoading}
          rowLoading={aiRowLoading.has(`${section}-${idx}`)}
          aiReady={aiReady}
          onRetry={() => fetchSingleRec(section, idx)}
        />
      )
    },
  })
  const withIdx = (arr) => arr.map((row, i) => ({ ...row, _aiIdx: i }))
  // When exporting PDF, disable pagination so all rows are captured
  const tblProps = pdfMode ? { pagination: false } : {}

  // Enrich export data with AI recommendations.
  // fullArr = unfiltered section array so index matches what buildAiSections used.
  const withExportAi = (sectionKey, exportArr, fullArr = exportArr) =>
    exportArr.map(row => ({
      ...row,
      'AI Recommendation': aiRec(sectionKey, fullArr.indexOf(row)) || '',
    }))

  const filteredConflicts = useMemo(() => {
    const { campaignName, adGroupName } = conflictFilters
    return conflicts.filter(c =>
      (!campaignName || c.campaign === campaignName) &&
      (!adGroupName  || (c.adGroupEntries
        ? c.adGroupEntries.some(e => e.adGroup === adGroupName)
        : c.adGroups.split(', ').some(ag => ag.trim() === adGroupName)))
    )
  }, [conflicts, conflictFilters])

  const filteredBudgetIssues  = useMemo(() =>
    budgetCampFilter ? budgetIssues.filter(c => c.status === budgetCampFilter) : budgetIssues
  , [budgetIssues, budgetCampFilter])

  const filteredAdStrength = useMemo(() =>
    adStrengthFilter ? ads.filter(a => normalizeStrength(a.adStrength) === adStrengthFilter) : ads
  , [ads, adStrengthFilter])

  // Assign _aiIdx = index in aiEligibleAds for POOR/AVERAGE/GOOD rows; -1 for EXCELLENT/others
  const adStrengthWithIdx = useMemo(() =>
    filteredAdStrength.map(row => ({
      ...row,
      _aiIdx: ['POOR','AVERAGE','GOOD'].includes(normalizeStrength(row.adStrength)) ? aiEligibleAds.indexOf(row) : -1,
    }))
  , [filteredAdStrength, aiEligibleAds])

  const budgetCampStatuses   = useMemo(() => [...new Set(budgetIssues.map(c => c.status).filter(Boolean))].sort(), [budgetIssues])
  const conflictCampaignNames = useMemo(() =>
    [...new Set(conflicts.map(c => c.campaign).filter(Boolean))].sort()
  , [conflicts])

  const conflictAdGroupNames = useMemo(() => {
    const source = conflictFilters.campaignName
      ? conflicts.filter(c => c.campaign === conflictFilters.campaignName)
      : conflicts
    return [...new Set(source.flatMap(c =>
      c.adGroupEntries ? c.adGroupEntries.map(e => e.adGroup) : c.adGroups.split(', ').map(s => s.trim())
    ).filter(Boolean))].sort()
  }, [conflicts, conflictFilters.campaignName])

  const tabCounts = auditData ? {
    adStrength: poorAds.length,
    conflicts:  conflicts.length,
    budget:     budgetIssues.length,
    adGroups:   agIssues.length,
    crossovers: crossovers.length,
    policy:     disapproved.length,
  } : {}

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#f5f7fa', overflow:'hidden' }}>

      {/* ── Fixed page header ── */}
      <div style={{ padding:'14px 24px', background:'#fff', borderBottom:'1px solid #dde9f5', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <ShieldCheck size={22} color="#1a3a6b"/>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:'#1a3a6b' }}>Account Health Audit</div>
            {lastAuditTime && <div style={{ fontSize:11, color:'#888' }}>Last run: {lastAuditTime.toLocaleString()}</div>}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginLeft:16, padding:'6px 12px', background:'#f5f7fa', borderRadius:8, border:'1px solid #dde9f5' }}>
            <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Audit scope:</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              style={{ padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, fontWeight:600, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }}
            >
              <option value="ENABLED">Enabled</option>
              <option value="PAUSED">Paused</option>
              <option value="ENABLED_PAUSED">Enabled + Paused</option>
            </select>
          </div>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          {auditData && aiLoading && (
            <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:'#888' }}>
              <Sparkles size={13} className="spin"/> Getting AI recommendations…
            </span>
          )}
          {auditData && !aiLoading && aiRecs && !aiError && (
            <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, color:'#2e7d32', fontWeight:600 }}>
              <Sparkles size={13}/> AI Recommendations ready
            </span>
          )}
          {auditData && !aiLoading && aiError && (
            <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, color:'#c0392b', fontWeight:500 }}>
              ⚠ {aiError}
            </span>
          )}
          {auditData && (
            <button onClick={handleExportPDF} disabled={exporting} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 14px', background:'#2563b0', color:'#fff', fontWeight:600, fontSize:12, borderRadius:6, border:'none', cursor:exporting?'not-allowed':'pointer', opacity:exporting?0.7:1 }}>
              <FileDown size={13}/>{exporting ? 'Exporting…' : 'Export PDF'}
            </button>
          )}
          <button onClick={runAudit} disabled={loading} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'9px 18px', background:loading?'#dde9f5':'#e8a020', color:loading?'#aaa':'#1a3a6b', fontWeight:700, fontSize:13, borderRadius:6, border:'none', cursor:loading?'not-allowed':'pointer' }}>
            {loading ? <><RefreshCw size={13} className="spin"/>Running Audit…</> : <>Run Audit</>}
          </button>
        </div>
      </div>

      {/* ── Tab bar — shown after audit completes ── */}
      {auditData && !loading && (
        <div style={{ background:'#fff', borderBottom:'2px solid #dde9f5', padding:'0 24px', display:'flex', gap:0, flexShrink:0 }}>
          {AUDIT_TABS.map(t => {
            const count = tabCounts[t.id] ?? 0
            const isActive = activeTab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  padding:'12px 20px', fontSize:13, fontWeight:isActive ? 700 : 500,
                  color:isActive ? '#1a3a6b' : '#666',
                  background:'none', border:'none', cursor:'pointer', whiteSpace:'nowrap',
                  borderBottom:isActive ? '2px solid #1a3a6b' : '2px solid transparent',
                  marginBottom:-2, transition:'color 0.15s',
                  display:'inline-flex', alignItems:'center', gap:6,
                }}
              >
                {t.label}
                {count > 0 && (
                  <span style={{
                    fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10, minWidth:16, textAlign:'center',
                    background: isActive ? '#1a3a6b' : '#e05c2a', color:'#fff',
                  }}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>

        {error && (
          <div style={{ padding:'12px 16px', background:'#fff5f5', border:'1px solid #ffd5cc', borderRadius:8, marginBottom:20, color:'#c0392b', fontSize:13 }}>
            {error}
          </div>
        )}

        {!auditData && !loading && (
          <div style={{ padding:60, textAlign:'center', color:'#aaa' }}>
            <ShieldCheck size={48} style={{ opacity:0.2, marginBottom:12 }}/>
            <div style={{ fontSize:14, fontWeight:500, marginBottom:6 }}>Click "Run Audit" to analyse your account</div>
            <div style={{ fontSize:12 }}>Checks ad strength, keyword conflicts, budget issues, and more</div>
          </div>
        )}

        {loading && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {Array.from({length:5}, (_,i) => <div key={i} className="skeleton" style={{ height:80, borderRadius:8 }}/>)}
          </div>
        )}

        {auditData && !loading && (
          <div ref={contentRef}>

            {/* Health score summary — always visible */}
            <div className="card" style={{ marginBottom:20, padding:'20px 24px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:600, color:'#1a3a6b', marginBottom:4 }}>Overall Health Score</div>
                  <HealthBadge score={healthScore}/>
                </div>
                <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                  {[
                    ['Ads Issues',      poorAds.length,      'adStrength', '#e05c2a'],
                    ['Budget Issues',   budgetIssues.length, 'budget',     '#f0b429'],
                    ['KW Conflicts',    conflicts.length,    'conflicts',  '#e05c2a'],
                    ['Crossovers',      crossovers.length,   'crossovers', '#e05c2a'],
                    ['Disapproved Ads', disapproved.length,  'policy',     '#c0392b'],
                  ].map(([l, v, tab, c]) => (
                    <div
                      key={l}
                      onClick={() => setActiveTab(tab)}
                      title={`Go to ${l}`}
                      style={{ textAlign:'center', cursor:'pointer', padding:'4px 8px', borderRadius:6, transition:'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background='#f0f4f8'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}
                    >
                      <div style={{ fontSize:20, fontWeight:700, color:v>0?c:'#4caf50' }}>{v}</div>
                      <div style={{ fontSize:11, color:'#888' }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Tab sections ── */}

            {(activeTab === 'adStrength' || pdfMode) && (
              <Section
                title="Ad Strength"
                deduction={poorAds.length > 0 ? `${Math.min(poorAds.length * 5, 30)}` : null}
                extra={<ExportButton data={withExportAi('adStrength', adStrengthWithIdx, aiEligibleAds).map(({_aiIdx,...r})=>({
                  ...r,
                  adStrength: normalizeStrength(r.adStrength),
                  status:     normalizeAdStatus(r.status),
                }))} filename="ad-strength"/>}
              >
                {/* Strength filter */}
                <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f4f8', background:'#fafcff', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Strength:</span>
                    <select
                      value={adStrengthFilter}
                      onChange={e => setAdStrengthFilter(e.target.value)}
                      style={{ padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }}
                    >
                      <option value="">All ({ads.length})</option>
                      {['EXCELLENT','GOOD','AVERAGE','POOR','PENDING','NO_ADS','UNSPECIFIED','UNKNOWN'].map(s => {
                        const n = ads.filter(a => normalizeStrength(a.adStrength) === s).length
                        return n > 0 ? <option key={s} value={s}>{s} ({n})</option> : null
                      })}
                    </select>
                  </div>
                  {poorAds.length > 0 && (
                    <span style={{ fontSize:11, color:'#c0392b', fontWeight:600 }}>
                      ⚠ {poorAds.length} ad{poorAds.length !== 1 ? 's' : ''} need attention (POOR / AVERAGE)
                    </span>
                  )}
                </div>
                <ReportTable
                  columns={[
                    {key:'_ad', label:'Ad', sortable:false, align:'left', width:260, wrap:true,
                      format:(_,row) => {
                        const headlines = (row.headlines||[]).join(' | ')
                        const desc      = (row.descriptions||[])[0] || ''
                        const url       = (row.finalUrls||[])[0] || ''
                        return (
                          <div style={{display:'flex',flexDirection:'column',gap:3,minWidth:200}}>
                            {url      && <div style={{fontSize:11,color:'#2e7d32',wordBreak:'break-all',lineHeight:1.4}}>{url}</div>}
                            {headlines && <div style={{fontSize:12,color:'#2563b0',fontWeight:500,whiteSpace:'normal',wordBreak:'break-word',lineHeight:1.5}}>{headlines}</div>}
                            {desc     && <div style={{fontSize:11,color:'#666',whiteSpace:'normal',wordBreak:'break-word',lineHeight:1.5}}>{desc}</div>}
                            {!url&&!headlines&&!desc && <span style={{color:'#aaa',fontSize:11}}>—</span>}
                          </div>
                        )
                      }},
                    {key:'campaign',   label:'Campaign',  sortable:true, align:'left',   width:160},
                    {key:'adGroup',    label:'Ad Group',  sortable:true, align:'left',   width:140},
                    {key:'status',     label:'Status',    sortable:true, align:'center', format:v=><AdStatusBadge value={v}/>},
                    {key:'adStrength', label:'Strength',  sortable:true, align:'center', format:v=><AdStrengthBadge value={v}/>},
                    {key:'impressions',label:'Impr.',     sortable:true, align:'right',  format:fmtNum},
                    {key:'clicks',     label:'Clicks',    sortable:true, align:'right',  format:fmtNum},
                    {key:'conversions',label:'Conv.',     sortable:true, align:'right',  format:fmtNum},
                    aiCol('adStrength'),
                  ]}
                  data={adStrengthWithIdx}
                  loading={loading}
                  {...tblProps}
                  emptyMessage="No ads found for the selected strength filter."
                />
              </Section>
            )}

            {(activeTab === 'conflicts' || pdfMode) && (
              <Section title="Keyword Crossover / Conflicts" count={conflicts.length} deduction={conflicts.length>0?'10':null} extra={
                <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, fontWeight:600 }}>
                    <span style={{ display:'flex', alignItems:'center', gap:4, color:'#2e7d32' }}>
                      <span style={{ width:8, height:8, borderRadius:'50%', background:'#2e7d32', display:'inline-block' }}/> Enabled
                    </span>
                    <span style={{ display:'flex', alignItems:'center', gap:4, color:'#a56700' }}>
                      <span style={{ width:8, height:8, borderRadius:'50%', background:'#a56700', display:'inline-block' }}/> Paused
                    </span>
                    <span style={{ display:'flex', alignItems:'center', gap:4, color:'#9e9e9e' }}>
                      <span style={{ width:8, height:8, borderRadius:'50%', background:'#9e9e9e', display:'inline-block' }}/> Removed
                    </span>
                  </div>
                  <ExportButton data={withExportAi('conflicts', filteredConflicts, conflicts)} filename="keyword-conflicts"/>
                </div>
              }>
                {/* Status dropdown filters */}
                <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f4f8', background:'#fafcff', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
                  {[
                    ['Campaign Name', 'campaignName', conflictCampaignNames],
                    ['Ad Group Name', 'adGroupName',  conflictAdGroupNames],
                  ].map(([label, key, opts]) => (
                    <div key={key} style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>{label}:</span>
                      <select
                        value={conflictFilters[key]}
                        onChange={e => {
                          const val = e.target.value
                          setConflictFilters(f => ({
                            ...f,
                            [key]: val,
                            // Reset ad group when campaign changes
                            ...(key === 'campaignName' ? { adGroupName: '' } : {}),
                          }))
                        }}
                        style={{ padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }}
                      >
                        <option value="">All</option>
                        {opts.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                  {(conflictFilters.campaignName || conflictFilters.adGroupName) && (
                    <button
                      onClick={() => setConflictFilters({ campaignName:'', adGroupName:'' })}
                      style={{ fontSize:11, color:'#2563b0', background:'none', border:'1px solid #dde9f5', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}
                    >
                      Clear
                    </button>
                  )}
                  <span style={{ fontSize:11, color:'#888', marginLeft:'auto' }}>
                    {filteredConflicts.length} of {conflicts.length}
                  </span>
                </div>
                <ReportTable
                  noFilter
                  columns={[
                    {key:'keyword',  label:'Keyword',   sortable:true,  align:'left',
                      format:(v,row)=>{
                        const c = row.status==='Enabled'?'#2e7d32':row.status==='Paused'?'#a56700':row.status==='Removed'?'#9e9e9e':'#1a3a6b'
                        return <span style={{color:c,fontWeight:500}}>{v}</span>
                      }},
                    {key:'campaign', label:'Campaign',  sortable:true,  align:'left', width:180,
                      format:(v,row)=>{
                        const c = row.campaignStatus==='Enabled'?'#2e7d32':row.campaignStatus==='Paused'?'#a56700':row.campaignStatus==='Removed'?'#9e9e9e':'#1a3a6b'
                        return <span style={{color:c,fontWeight:500}}>{v}</span>
                      }},
                    {key:'adGroupEntries', label:'Ad Groups & Match Types', sortable:false, align:'left',
                      format:(v, row) => {
                        const entries = v?.length ? v : (row.adGroups||'').split(', ').filter(Boolean).map(ag => ({ adGroup:ag, matchType:'', status:'' }))
                        return (
                          <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                            {entries.map((e, i) => {
                              const sc = e.status==='Enabled'?'#2e7d32':e.status==='Paused'?'#a56700':e.status==='Removed'?'#9e9e9e':'#1a3a6b'
                              return (
                                <span key={i} style={{ display:'inline-flex', alignItems:'center', gap:3, fontSize:11,
                                  padding:'2px 8px', borderRadius:4, background:'#f0f4fb',
                                  border:'1px solid #dde9f5', color:sc, fontWeight:500, whiteSpace:'nowrap' }}>
                                  {e.adGroup}
                                  {e.matchType && <span style={{ opacity:0.65, fontWeight:400, fontSize:10 }}>[{e.matchType}]</span>}
                                </span>
                              )
                            })}
                          </div>
                        )
                      }},
                    {key:'issueType',     label:'Issue',            sortable:true,  align:'left',
                      format:(v,row)=>{
                        const base=row.issueBase||v; const isDup=base==='Duplicate'
                        return <span style={{fontSize:11,fontWeight:600,padding:'2px 7px',borderRadius:4,
                          background:isDup?'rgba(224,92,42,0.12)':'rgba(240,180,41,0.15)',
                          color:isDup?'#c0392b':'#8a6000',
                          border:isDup?'1px solid rgba(224,92,42,0.3)':'1px solid rgba(240,180,41,0.4)',
                          whiteSpace:'nowrap'}}>{v}</span>
                      }},
                    aiCol('conflicts'),
                  ]}
                  data={withIdx(filteredConflicts)}
                  loading={loading}
                  {...tblProps}
                  emptyMessage="No keyword conflicts detected — clean keyword structure!"
                />
              </Section>
            )}

            {(activeTab === 'budget' || pdfMode) && (
              <Section title="Budget Issues" count={budgetIssues.length} deduction={budgetIssues.length>0?`${Math.min(budgetIssues.length*5,25)}`:null} extra={<ExportButton data={withExportAi('budgetIssues', filteredBudgetIssues, budgetIssues)} filename="budget-issues"/>}>
                {/* Campaign Status filter */}
                <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f4f8', background:'#fafcff', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign Status:</span>
                    <select
                      value={budgetCampFilter}
                      onChange={e => setBudgetCampFilter(e.target.value)}
                      style={{ padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }}
                    >
                      <option value="">All</option>
                      {budgetCampStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  {budgetCampFilter && (
                    <button
                      onClick={() => setBudgetCampFilter('')}
                      style={{ fontSize:11, color:'#2563b0', background:'none', border:'1px solid #dde9f5', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}
                    >
                      Clear
                    </button>
                  )}
                  <span style={{ fontSize:11, color:'#888', marginLeft:'auto' }}>
                    {filteredBudgetIssues.length} of {budgetIssues.length}
                  </span>
                </div>
                <ReportTable
                  noFilter
                  columns={[
                    {key:'name',        label:'Campaign',        sortable:true, align:'left', width:200},
                    {key:'status',      label:'Campaign Status', sortable:true, align:'center', format:v=>v?<StatusBadge value={v}/>:'—'},
                    {key:'budget',      label:'Daily Budget',    sortable:true, align:'right', format:fmtUsd},
                    {key:'spend',       label:'Actual Spend',    sortable:true, align:'right', format:fmtUsd},
                    {key:'utilization', label:'Utilization',     sortable:true, align:'center', format:v=><UtilBar pct={v}/>},
                    {key:'issue',       label:'Issue',           sortable:true, align:'center',
                      format:v=>{
                        if(!v) return <span style={{fontSize:11,color:'#4caf50',fontWeight:600}}>OK</span>
                        const c=v==='Overpacing'?'#e05c2a':v==='No activity'?'#888':'#8a6000'
                        return <span style={{fontSize:11,fontWeight:600,padding:'2px 7px',borderRadius:4,background:`${c}22`,color:c,border:`1px solid ${c}44`}}>{v}</span>
                      }},
                    aiCol('budgetIssues'),
                  ]}
                  data={withIdx(filteredBudgetIssues)}
                  loading={loading}
                  {...tblProps}
                  emptyMessage="No budget issues detected"
                />
              </Section>
            )}

            {(activeTab === 'adGroups' || pdfMode) && (
              <Section title="Ad Group Health" count={agIssues.length} deduction={agIssues.length>0?`${Math.min(agIssues.length*3,15)}`:null}>
                <ReportTable
                  columns={[
                    {key:'name',        label:'Ad Group',       sortable:true, align:'left', width:200},
                    {key:'campaign',    label:'Campaign',       sortable:true, align:'left', width:180},
                    {key:'status',      label:'Ad Group Status',sortable:true, align:'center', format:v=>v?<StatusBadge value={v}/>:'—'},
                    {key:'impressions', label:'Impr.',          sortable:true, align:'right', format:fmtNum},
                    {key:'clicks',      label:'Clicks',   sortable:true, align:'right', format:fmtNum},
                    {key:'conversions', label:'Conv.',    sortable:true, align:'right', format:fmtNum},
                    {key:'impressions', label:'Issue',    sortable:false, align:'center',
                      format:(v,row)=>{
                        if(v===0&&['ENABLED','2'].includes(String(row.status)))
                          return <span style={{fontSize:11,fontWeight:600,color:'#888',padding:'2px 6px',background:'rgba(150,150,150,0.1)',borderRadius:4,border:'1px solid rgba(150,150,150,0.3)'}}>Inactive</span>
                        return <span style={{fontSize:11,color:'#4caf50',fontWeight:600}}>OK</span>
                      }},
                    aiCol('agIssues'),
                  ]}
                  data={withIdx(agIssues)}
                  loading={loading}
                  {...tblProps}
                  emptyMessage="No ad group health issues"
                />
              </Section>
            )}

            {(activeTab === 'crossovers' || pdfMode) && (
              <Section title="Service Crossover Issues" count={crossovers.length} deduction={crossovers.length>0?`${crossovers.length*15}`:null} extra={<ExportButton data={withExportAi('crossovers', crossovers)} filename="crossover-issues"/>}>
                <ReportTable
                  columns={[
                    {key:'campaignA', label:'Campaign A', sortable:false, align:'left', width:200},
                    {key:'campaignB', label:'Campaign B', sortable:false, align:'left', width:200},
                    {key:'issueType', label:'Issue',      sortable:true,  align:'center',
                      format:v=><span style={{fontSize:11,fontWeight:600,padding:'2px 7px',borderRadius:4,background:'rgba(224,92,42,0.12)',color:'#c0392b',border:'1px solid rgba(224,92,42,0.3)'}}>{v}</span>},
                    aiCol('crossovers'),
                  ]}
                  data={withIdx(crossovers)}
                  loading={loading}
                  {...tblProps}
                  emptyMessage="No service crossover issues detected"
                />
              </Section>
            )}

            {(activeTab === 'policy' || pdfMode) && (
              <Section title="Policy & Approval Issues" count={disapproved.length} deduction={disapproved.length>0?`${disapproved.length*10}`:null} extra={<ExportButton data={withExportAi('policyIssues', disapproved).map(r=>({
                  ...r,
                  approvalStatus: (s => s==='DISAPPROVED'?'Disapproved':s.includes('REVIEW')?'Under Review':'Approved')(String(r.approvalStatus||'').toUpperCase()),
                }))} filename="policy-issues"/>}>
                <ReportTable
                  columns={[
                    {key:'campaign',       label:'Campaign', sortable:true, align:'left', width:180},
                    {key:'adGroup',        label:'Ad Group', sortable:true, align:'left', width:160},
                    {key:'approvalStatus', label:'Status',   sortable:true, align:'center',
                      format:v=>{
                        const s=String(v).toUpperCase()
                        const c=s==='DISAPPROVED'?'#c0392b':s.includes('REVIEW')?'#8a6000':'#2e7d32'
                        const lbl=s==='DISAPPROVED'?'Disapproved':s.includes('REVIEW')?'Under Review':'Approved'
                        return <span style={{fontSize:11,fontWeight:600,padding:'2px 7px',borderRadius:4,background:`${c}22`,color:c,border:`1px solid ${c}44`}}>{lbl}</span>
                      }},
                    {key:'impressions', label:'Impr.', sortable:true, align:'right', format:fmtNum},
                    aiCol('policyIssues'),
                  ]}
                  data={withIdx(disapproved.length > 0 ? disapproved : ads.filter(a => !['APPROVED','APPROVED_LIMITED','ELIGIBLE','1','2','3'].includes(String(a.approvalStatus))))}
                  loading={loading}
                  {...tblProps}
                  emptyMessage="No policy or approval issues found"
                />
              </Section>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
