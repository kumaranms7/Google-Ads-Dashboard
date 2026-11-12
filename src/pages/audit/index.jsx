import React, { useState, useEffect, useMemo, useRef } from 'react'
import { ShieldCheck, AlertCircle, RefreshCw, FileDown, Sparkles } from 'lucide-react'
import {
  HealthBadge, calculateHealthScore, exportAuditPDF, normalizeStrength,
  computeCategoryCounts, computeKwPerfIssues, computeKwPerfOpportunities, computeTopOffenders,
  PdfHeading,
} from './shared.jsx'

const SECTION_INFO = {
  overview:    { title: 'Overview',              description: 'High-level summary of every audit category — total, critical, high, medium, and low/opportunity counts across the account.' },
  campaign:    { title: 'Campaign Audit',         description: 'Structural issues, budget & bidding problems, location targeting coverage, and ad schedule findings across all active campaigns.' },
  keyword:     { title: 'Keyword Audit',          description: "Keyword performance issues, search term opportunities, and both kinds of keyword conflicts — positive-vs-negative and positive-vs-positive." },
  adRsa:       { title: 'Ad / RSA Audit',         description: 'Responsive search ad quality — ad strength, missing calls-to-action, pinning issues, and headline/description coverage.' },
  asset:       { title: 'Asset Audit',            description: 'Account-level sitelink, callout, and structured snippet coverage, including duplicate text.' },
  conversion:  { title: 'Conversion Tracking',    description: "Conversion action configuration — what's counted toward Conversions, what's excluded, and duplicate tracking." },
  performance: { title: 'Performance Audit',      description: 'The worst-performing keywords, ads, and campaigns across the account, combined into one prioritized list.' },
  duplicate:   { title: 'Duplicate Audit',        description: 'Duplicate keyword targeting across ad groups and campaigns.' },
  policy:      { title: 'Policy & Disapproval',   description: "Ads with policy or approval issues limiting delivery." },
}
import OverviewTab from './OverviewTab.jsx'
import CampaignAuditTab from './CampaignAuditTab.jsx'
import KeywordAuditTab from './keyword-audit/index.jsx'
import AdRsaAuditTab from './AdRsaAuditTab.jsx'
import AssetAuditTab from './AssetAuditTab.jsx'
import ConversionTrackingTab from './ConversionTrackingTab.jsx'
import PerformanceAuditTab from './PerformanceAuditTab.jsx'
import DuplicateAuditTab from './DuplicateAuditTab.jsx'
import PolicyDisapprovalTab from './PolicyDisapprovalTab.jsx'

const NAV = [
  { id: 'overview',    label: 'Overview' },
  { id: 'campaign',    label: 'Campaign Audit' },
  { id: 'keyword',     label: 'Keyword Audit' },
  { id: 'adRsa',       label: 'Ad / RSA Audit' },
  { id: 'asset',       label: 'Asset Audit' },
  { id: 'conversion',  label: 'Conversion Tracking' },
  { id: 'performance', label: 'Performance Audit' },
  { id: 'duplicate',   label: 'Duplicate Audit' },
  { id: 'policy',      label: 'Policy & Disapproval' },
]

// ── AI recommendation payload builders (existing audit:ai-recommend flow) ────
// ctx = { auditData, kwAnalysis, conflictData } — a section only needs
// whichever of these it's sourced from; the others may be absent/null.
function getSectionRows(ctx) {
  const { auditData, kwAnalysis, conflictData, structureData, adAnalysis } = ctx || {}
  const { ads = [], campaigns = [], adGroups = [], keywords = {}, crossovers = [] } = auditData || {}
  return {
    adStrength:   ads.filter(a => ['POOR', 'AVERAGE', 'GOOD'].includes(normalizeStrength(a.adStrength))),
    conflicts:    keywords.conflicts || [],
    budgetIssues: campaigns.filter(c => c.issue),
    agIssues:     adGroups.filter(a => a.impressions === 0 && ['ENABLED', '2'].includes(String(a.status))),
    crossovers,
    policyIssues: ads.filter(a => ['DISAPPROVED'].includes(String(a.approvalStatus))),
    kwIssues:         computeKwPerfIssues(kwAnalysis),
    kwOpportunities:  computeKwPerfOpportunities(kwAnalysis),
    keywordConflicts: conflictData?.conflicts || [],
    conversionActions: annotateDuplicateConversionActions(structureData?.conversionActions),
    performanceOffenders: computeTopOffenders({ data: auditData, kwAnalysis, adAnalysis }),
  }
}
// Attaches an isDuplicate flag (by case-insensitive name) so the AI prompt
// can call out duplicates without needing the whole list for context.
function annotateDuplicateConversionActions(actions) {
  if (!actions) return []
  const seen = new Map()
  for (const a of actions) { const k = a.name.toLowerCase().trim(); seen.set(k, (seen.get(k) || 0) + 1) }
  return actions.map(a => ({ ...a, isDuplicate: (seen.get(a.name.toLowerCase().trim()) || 0) > 1 }))
}
const ITEM_BUILDER = {
  adStrength:   (a, i) => ({ index: i, strength: a.adStrength, headlines: a.headlines?.length || 0, campaign: a.campaign, adGroup: a.adGroup }),
  conflicts:    (c, i) => ({ index: i, keyword: c.keyword, issue: c.issueType, campaign: c.campaign, adGroups: (c.adGroupEntries || []).map(e => `${e.adGroup} [${e.matchType}]`).join(', ') || c.adGroups }),
  budgetIssues: (c, i) => ({ index: i, campaign: c.name, issue: c.issue, utilization: c.utilization?.toFixed(1) + '%', budget: '$' + Number(c.budget || 0).toFixed(2), spend: '$' + Number(c.spend || 0).toFixed(2) }),
  agIssues:     (a, i) => ({ index: i, adGroup: a.name, campaign: a.campaign }),
  crossovers:   (c, i) => ({ index: i, campaignA: c.campaignA, campaignB: c.campaignB, issue: c.issueType }),
  policyIssues: (a, i) => ({ index: i, campaign: a.campaign, adGroup: a.adGroup, status: a.approvalStatus }),
  kwIssues:     (k, i) => ({ index: i, keyword: k.text, matchType: k.matchType, issue: k.issue, cost: '$' + Number(k.cost || 0).toFixed(2), conversions: k.conversions, ctr: Number(k.ctr || 0).toFixed(2) + '%', cpc: '$' + Number(k.cpc || 0).toFixed(2), qualityScore: k.qualityScore || null }),
  kwOpportunities: (k, i) => ({ index: i, keyword: k.text, matchType: k.matchType, conversions: k.conversions, cost: '$' + Number(k.cost || 0).toFixed(2), ctr: Number(k.ctr || 0).toFixed(2) + '%' }),
  keywordConflicts: (c, i) => ({ index: i, positiveKeyword: c.positiveKeyword, positiveMatchType: c.positiveMatchType, negativeKeyword: c.negativeKeyword, negativeMatchType: c.negativeMatchType, negativeLevel: c.negativeLevel, campaign: c.campaign, adGroup: c.adGroup, conflictType: c.conflictType }),
  conversionActions: (a, i) => ({ index: i, name: a.name, type: a.type, category: a.category, countedInConversions: a.included, isDuplicateName: a.isDuplicate }),
  performanceOffenders: (o, i) => ({ index: i, entity: o.entity, type: o.type, issue: o.metric, value: o.value, severity: o.severity }),
}
function buildAiSections(ctx, onlyKeys = null) {
  const rows = getSectionRows(ctx)
  const keys = onlyKeys || Object.keys(ITEM_BUILDER)
  return Object.fromEntries(
    keys.map(section => [section, (rows[section] || []).slice(0, 20).map((item, i) => ITEM_BUILDER[section](item, i))])
  )
}
function buildSingleItem(ctx, section, index) {
  const rows = getSectionRows(ctx)
  const item = (rows[section] || [])[index]
  if (!item || !ITEM_BUILDER[section]) return null
  return ITEM_BUILDER[section](item, index)
}

export default function Audit({ selectedAccount, dateRange = 'LAST_30_DAYS' }) {
  const [activeSection, setActiveSection] = useState('overview')
  const [statusFilter, setStatusFilter] = useState('ENABLED')

  const [auditData,     setAuditData]     = useState(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [lastAuditTime, setLastAuditTime] = useState(null)

  const [aiRecs,       setAiRecs]       = useState(null)
  const [aiLoading,    setAiLoading]    = useState(false)
  const [aiError,      setAiError]      = useState(null)
  const [aiRowLoading, setAiRowLoading] = useState(new Set())
  // Separate loading flags for the two AI calls that fire once their own
  // data source (kwAnalysis / conflictData) resolves — independent of the
  // main aiLoading above, which only tracks the very first (auditData) call.
  const [kwAiLoading,       setKwAiLoading]       = useState(false)
  const [conflictAiLoading, setConflictAiLoading] = useState(false)
  const [conversionAiLoading, setConversionAiLoading] = useState(false)
  const [performanceAiLoading, setPerformanceAiLoading] = useState(false)

  const [structureData, setStructureData] = useState(null)
  const [structureLoading, setStructureLoading] = useState(false)
  const [structureError, setStructureError] = useState(null)

  const [conflictData, setConflictData] = useState(null)
  const [conflictLoading, setConflictLoading] = useState(false)
  const [conflictError, setConflictError] = useState(null)

  const [kwAnalysis, setKwAnalysis] = useState(null)
  const [kwLoading, setKwLoading] = useState(false)
  const [kwError, setKwError] = useState(null)

  const [stAnalysis, setStAnalysis] = useState(null)
  const [stLoading, setStLoading] = useState(false)
  const [stError, setStError] = useState(null)

  const [adAnalysis, setAdAnalysis] = useState(null)
  const [adLoading, setAdLoading] = useState(false)
  const [adError, setAdError] = useState(null)

  const [assetAudit, setAssetAudit] = useState(null)
  const [assetLoading, setAssetLoading] = useState(false)
  const [assetError, setAssetError] = useState(null)

  const [exporting, setExporting] = useState(false)
  const [pdfMode,   setPdfMode]   = useState(false)
  const contentRef = useRef(null)

  useEffect(() => {
    setAuditData(null); setAiRecs(null); setAiError(null); setError(null)
    setStructureData(null); setConflictData(null); setKwAnalysis(null); setStAnalysis(null); setAdAnalysis(null); setAssetAudit(null)
  }, [statusFilter])

  const healthScore = useMemo(() => calculateHealthScore(auditData), [auditData])

  // The audit page fires up to five independent AI calls (main sections,
  // Keyword Performance, Keyword Conflicts, Conversion Tracking, Performance
  // rollup) as soon as each one's underlying data resolves — which is
  // usually within a second or two of each other. Firing all five at once
  // risks tripping Claude's rate limit, and a failed call used to just
  // silently give up (console.error only), leaving that section's AI column
  // stuck on "—" forever unless the user retried every row by hand.
  //
  // Fix: (1) queue every auditAiRecommend call so only one is ever in flight
  // at a time — later callers simply wait their turn — and (2) retry a
  // failed call twice with backoff before giving up.
  const aiQueueRef = useRef(Promise.resolve())
  function queueAiCall(fn) {
    const run = () => fn()
    const result = aiQueueRef.current.then(run, run)
    aiQueueRef.current = result.catch(() => {})
    return result
  }
  async function callAiWithRetry(params, retriesLeft = 2, delayMs = 1500) {
    try {
      return await window.electronAPI.auditAiRecommend(params)
    } catch (err) {
      if (retriesLeft <= 0) throw err
      await new Promise(r => setTimeout(r, delayMs))
      return callAiWithRetry(params, retriesLeft - 1, delayMs * 2)
    }
  }

  async function fetchAiRecs(data, forceRefresh = false) {
    if (!window.electronAPI?.auditAiRecommend) { setAiError('Restart the app to enable AI recommendations.'); return }
    setAiLoading(true); setAiError(null)
    try {
      const sections = buildAiSections({ auditData: data }, ['adStrength', 'conflicts', 'budgetIssues', 'agIssues', 'crossovers', 'policyIssues'])
      const recs = await queueAiCall(() => callAiWithRetry({ customerId: selectedAccount.id, sections, forceRefresh }))
      // Merge, don't overwrite — one of the other independent AI calls below
      // may have already landed results into aiRecs by the time this resolves.
      setAiRecs(prev => ({ ...(prev || {}), ...(recs || {}) }))
    } catch (err) {
      setAiError(err.message || 'AI recommendations failed — try running the audit again.')
    } finally { setAiLoading(false) }
  }

  // Fires once its own data source loads (independent of the main call
  // above) and merges into the same aiRecs object — Keyword Performance and
  // Search Terms depend on kwAnalysis/stAnalysis which resolve in parallel
  // with auditData, not necessarily before it.
  async function fetchExtraAiRecs(sections, setLoadingFlag) {
    if (!window.electronAPI?.auditAiRecommend) return
    setLoadingFlag(true)
    try {
      const recs = await queueAiCall(() => callAiWithRetry({ customerId: selectedAccount.id, sections, forceRefresh: false }))
      setAiRecs(prev => ({ ...(prev || {}), ...recs }))
    } catch (err) {
      console.error('[AI Recs] extra section fetch failed:', err.message)
    } finally { setLoadingFlag(false) }
  }

  useEffect(() => {
    if (!kwAnalysis) return
    fetchExtraAiRecs(buildAiSections({ kwAnalysis }, ['kwIssues', 'kwOpportunities']), setKwAiLoading)
  }, [kwAnalysis])

  useEffect(() => {
    if (!conflictData) return
    fetchExtraAiRecs(buildAiSections({ conflictData }, ['keywordConflicts']), setConflictAiLoading)
  }, [conflictData])

  useEffect(() => {
    if (!structureData) return
    fetchExtraAiRecs(buildAiSections({ structureData }, ['conversionActions']), setConversionAiLoading)
  }, [structureData])

  // Performance Audit's rollup draws from three sources that resolve
  // independently (auditData, kwAnalysis, adAnalysis) — wait for all three
  // so the AI sees the same full offender list the table shows.
  useEffect(() => {
    if (!auditData || !kwAnalysis || !adAnalysis) return
    fetchExtraAiRecs(buildAiSections({ auditData, kwAnalysis, adAnalysis }, ['performanceOffenders']), setPerformanceAiLoading)
  }, [auditData, kwAnalysis, adAnalysis])

  async function fetchSingleRec(section, index) {
    if (!window.electronAPI?.auditAiRecommend) return
    const item = buildSingleItem({ auditData, kwAnalysis, conflictData, structureData, adAnalysis }, section, index)
    if (!item) return
    const rowKey = `${section}-${index}`
    setAiRowLoading(prev => new Set([...prev, rowKey]))
    try {
      const recs = await queueAiCall(() => callAiWithRetry({ customerId: selectedAccount.id, sections: { [section]: [item] }, forceRefresh: true }))
      const newRec = recs?.[section]?.find(r => Number(r.index) === index)
      if (newRec) {
        setAiRecs(prev => ({ ...prev, [section]: [...(prev?.[section] || []).filter(r => Number(r.index) !== index), { index, recommendation: newRec.recommendation }] }))
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
    setStructureLoading(true); setConflictLoading(true); setKwLoading(true); setStLoading(true); setAdLoading(true); setAssetLoading(true)
    setStructureError(null); setConflictError(null); setKwError(null); setStError(null); setAdError(null); setAssetError(null)

    const customerId = selectedAccount.id

    window.electronAPI.fetchAudit({ customerId, statusFilter, dateRange })
      .then(data => { setAuditData(data); setLastAuditTime(new Date()); fetchAiRecs(data) })
      .catch(err => setError(err.message || 'Audit failed'))
      .finally(() => setLoading(false))

    window.electronAPI.auditAccountStructure({ customerId })
      .then(setStructureData).catch(err => setStructureError(err.message || 'Failed to load account structure')).finally(() => setStructureLoading(false))

    window.electronAPI.auditKeywordConflicts({ customerId })
      .then(setConflictData).catch(err => setConflictError(err.message || 'Failed to scan keyword conflicts')).finally(() => setConflictLoading(false))

    window.electronAPI.fetchKeywordAnalysis({ customerId, dateRange })
      .then(setKwAnalysis).catch(err => setKwError(err.message || 'Failed to load keyword performance')).finally(() => setKwLoading(false))

    window.electronAPI.fetchSearchTermAnalysis({ customerId, dateRange })
      .then(setStAnalysis).catch(err => setStError(err.message || 'Failed to load search term analysis')).finally(() => setStLoading(false))

    window.electronAPI.fetchAdPerformanceAnalysis({ customerId, dateRange })
      .then(setAdAnalysis).catch(err => setAdError(err.message || 'Failed to load ad performance analysis')).finally(() => setAdLoading(false))

    window.electronAPI.auditAssetAudit({ customerId })
      .then(setAssetAudit).catch(err => setAssetError(err.message || 'Failed to load asset audit')).finally(() => setAssetLoading(false))
  }

  // Re-fetches just the keyword performance dataset — used after an in-place
  // keyword edit (Keyword Performance tab) instead of re-running the whole
  // audit, which would also re-trigger every other section's AI calls.
  function refreshKwAnalysis() {
    if (!selectedAccount) return
    setKwLoading(true); setKwError(null)
    window.electronAPI.fetchKeywordAnalysis({ customerId: selectedAccount.id, dateRange })
      .then(setKwAnalysis).catch(err => setKwError(err.message || 'Failed to load keyword performance')).finally(() => setKwLoading(false))
  }

  async function handleExportPDF() {
    if (!auditData || exporting) return
    setExporting(true)
    setPdfMode(true)
    await new Promise(r => setTimeout(r, 400))
    const counts = computeCategoryCounts({ data: auditData, structureData, conflictData, kwAnalysis, stAnalysis, adAnalysis, assetAudit })
    await exportAuditPDF(contentRef, selectedAccount?.name, healthScore, counts)
    setPdfMode(false)
    setExporting(false)
  }

  if (!selectedAccount) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#888', background: '#f5f7fa' }}>
        <ShieldCheck size={48} style={{ opacity: 0.3 }} />
        <div style={{ fontWeight: 500 }}>Select an account to run an audit</div>
      </div>
    )
  }

  const aiRec = (section, index) => {
    const arr = aiRecs?.[section]
    if (!Array.isArray(arr)) return null
    const item = arr.find(r => Number(r.index) === Number(index))
    return item?.recommendation ?? null
  }
  const aiReady = !!aiRecs && !aiLoading
  const kwAiReady = !!aiRecs && !kwAiLoading
  const conflictAiReady = !!aiRecs && !conflictAiLoading
  const conversionAiReady = !!aiRecs && !conversionAiLoading
  const performanceAiReady = !!aiRecs && !performanceAiLoading
  const withIdx = arr => arr.map((row, i) => ({ ...row, _aiIdx: i }))
  const tblProps = pdfMode ? { pagination: false } : {}

  const counts = auditData ? computeCategoryCounts({ data: auditData, structureData, conflictData, kwAnalysis, stAnalysis, adAnalysis, assetAudit }) : {}
  const NAV_COUNT_KEY = { campaign: 'campaign', keyword: 'keyword', adRsa: 'adRsa', asset: 'asset', conversion: 'conversion', performance: 'performance', duplicate: 'duplicate', policy: 'policy' }

  const sharedTabProps = {
    selectedAccount, dateRange, pdfMode,
    data: auditData, structureData, conflictData, kwAnalysis, stAnalysis, adAnalysis, assetAudit,
    aiRec, aiLoading, aiRowLoading, aiReady, onRetryAi: fetchSingleRec,
    kwAiLoading, kwAiReady, conflictAiLoading, conflictAiReady,
    conversionAiLoading, conversionAiReady,
    performanceAiLoading, performanceAiReady,
    tblProps, withIdx, loading,
    kwLoading, kwError, stLoading, stError, adLoading, adError, onKwEdited: refreshKwAnalysis,
    structureLoading, structureError, conflictLoading, conflictError,
    assetLoading, assetError,
    aiRecs,
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f5f7fa', overflow: 'hidden' }}>

      <div style={{ padding: '14px 24px', background: '#fff', borderBottom: '1px solid #dde9f5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ShieldCheck size={22} color="#1a3a6b" />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a3a6b' }}>Account Health Audit</div>
            {lastAuditTime && <div style={{ fontSize: 11, color: '#888' }}>Last run: {lastAuditTime.toLocaleString()}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16, padding: '6px 12px', background: '#f5f7fa', borderRadius: 8, border: '1px solid #dde9f5' }}>
            <span style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap' }}>Audit scope:</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1a3a6b' }}>Active only</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {auditData && aiLoading && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#888' }}><Sparkles size={13} className="spin" /> Getting AI suggestions…</span>}
          {auditData && !aiLoading && aiRecs && !aiError && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#2e7d32', fontWeight: 600 }}><Sparkles size={13} /> AI Suggestions ready</span>}
          {auditData && !aiLoading && aiError && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#c0392b', fontWeight: 500 }}>⚠ {aiError}</span>}
          {auditData && (
            <button onClick={handleExportPDF} disabled={exporting} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#2563b0', color: '#fff', fontWeight: 600, fontSize: 12, borderRadius: 6, border: 'none', cursor: exporting ? 'not-allowed' : 'pointer', opacity: exporting ? 0.7 : 1 }}>
              <FileDown size={13} />{exporting ? 'Exporting…' : 'Export PDF'}
            </button>
          )}
          <button onClick={runAudit} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', background: loading ? '#dde9f5' : '#e8a020', color: loading ? '#aaa' : '#1a3a6b', fontWeight: 700, fontSize: 13, borderRadius: 6, border: 'none', cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? <><RefreshCw size={13} className="spin" />Running Audit…</> : <>Run Audit</>}
          </button>
        </div>
      </div>

      {auditData && !loading && (
        <div style={{ background: '#fff', borderBottom: '2px solid #dde9f5', padding: '0 24px', display: 'flex', gap: 0, flexWrap: 'wrap' }}>
          {NAV.map(t => {
            const isActive = activeSection === t.id
            const count = NAV_COUNT_KEY[t.id] ? counts[NAV_COUNT_KEY[t.id]] : 0
            return (
              <button key={t.id} onClick={() => setActiveSection(t.id)} style={{
                padding: '12px 16px', fontSize: 12.5, fontWeight: isActive ? 700 : 500,
                color: isActive ? '#1a3a6b' : '#666', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                borderBottom: isActive ? '2px solid #1a3a6b' : '2px solid transparent', marginBottom: -2,
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
                {t.label}
                {count > 0 && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, minWidth: 16, textAlign: 'center', background: isActive ? '#1a3a6b' : '#e05c2a', color: '#fff' }}>{count}</span>}
              </button>
            )
          })}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {error && <div style={{ padding: '12px 16px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 8, marginBottom: 20, color: '#c0392b', fontSize: 13 }}>{error}</div>}

        {!auditData && !loading && (
          <div style={{ padding: 60, textAlign: 'center', color: '#aaa' }}>
            <ShieldCheck size={48} style={{ opacity: 0.2, marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Click "Run Audit" to analyse your account</div>
            <div style={{ fontSize: 12 }}>Checks campaigns, keywords, ads, assets, conversions, and more</div>
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 8 }} />)}
          </div>
        )}

        {auditData && !loading && (
          <div ref={contentRef}>
            <div className="card" style={{ marginBottom: 20, padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1a3a6b', marginBottom: 4 }}>Overall Health Score</div>
                  <HealthBadge score={healthScore} />
                </div>
              </div>
            </div>

            {(activeSection === 'overview' || pdfMode) && <>{pdfMode && <PdfHeading {...SECTION_INFO.overview} />}<OverviewTab {...sharedTabProps} onNavigate={setActiveSection} /></>}
            {(activeSection === 'campaign' || pdfMode) && <>{pdfMode && <PdfHeading {...SECTION_INFO.campaign} />}<CampaignAuditTab {...sharedTabProps} /></>}
            {(activeSection === 'keyword' || pdfMode) && <>{pdfMode && <PdfHeading {...SECTION_INFO.keyword} />}<KeywordAuditTab {...sharedTabProps} /></>}
            {(activeSection === 'adRsa' || pdfMode) && <>{pdfMode && <PdfHeading {...SECTION_INFO.adRsa} />}<AdRsaAuditTab {...sharedTabProps} /></>}
            {(activeSection === 'asset' || pdfMode) && <>{pdfMode && <PdfHeading {...SECTION_INFO.asset} />}<AssetAuditTab {...sharedTabProps} /></>}
            {(activeSection === 'conversion' || pdfMode) && <>{pdfMode && <PdfHeading {...SECTION_INFO.conversion} />}<ConversionTrackingTab {...sharedTabProps} /></>}
            {(activeSection === 'performance' || pdfMode) && <>{pdfMode && <PdfHeading {...SECTION_INFO.performance} />}<PerformanceAuditTab {...sharedTabProps} /></>}
            {(activeSection === 'duplicate' || pdfMode) && <>{pdfMode && <PdfHeading {...SECTION_INFO.duplicate} />}<DuplicateAuditTab {...sharedTabProps} onGoToCrossover={() => setActiveSection('keyword')} /></>}
            {(activeSection === 'policy' || pdfMode) && <>{pdfMode && <PdfHeading {...SECTION_INFO.policy} />}<PolicyDisapprovalTab {...sharedTabProps} /></>}
          </div>
        )}
      </div>
    </div>
  )
}
