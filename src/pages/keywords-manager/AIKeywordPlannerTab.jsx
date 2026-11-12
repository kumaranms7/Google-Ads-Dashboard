import React, { useState, useMemo, useEffect } from 'react'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import ExportButton          from '../../components/ExportButton.jsx'
import StatusBadge           from '../../components/StatusBadge.jsx'
import ReportTable           from '../../components/ReportTable.jsx'
import PublishKeywordModal   from '../../components/PublishKeywordModal.jsx'
import { highlightRecommendation } from '../../utils/highlightRecommendation.jsx'
import { Spinner } from './shared.jsx'

// Moved here from src/pages/Keywords.jsx's "AI Keyword Planner" tab (was
// bundled with the CPC Optimizer and Negative Keyword Optimizer under one
// tab there) — same three tools, same behavior, just living as a tab in
// Keywords Manager instead. Fully self-contained: fetches its own
// account-wide keyword report and negatives rather than relying on
// Keywords.jsx's page-level state.

function Section({ title, extra, children }) {
  return (
    <div className="card" style={{ marginBottom:24 }}>
      <div className="card-header"><span className="card-title">{title}</span>{extra}</div>
      {children}
    </div>
  )
}

// Raw <th> headers in this file are plain strings used as sort keys — split
// "A / B" labels onto two lines for display without breaking the sort-key match.
function renderHeaderLabel(l) {
  if (typeof l === 'string' && l.includes(' / ')) {
    const [a, b] = l.split(' / ')
    return <>{a}<br />{b}</>
  }
  return l
}

// ── Pagination for the per-seed-keyword result tables ────────────────────────
// Each seed keyword renders its own table, so pagination state is tracked per
// seed (keyed by seed text) in a single object on the parent, rather than one
// useState per table — the number of seed tables is dynamic, so hooks can't
// live inside the .map() that renders them.
const GROUP_PAGE_SIZES = [10, 25, 50, 100]

function pgBtnStyle(disabled) {
  return { padding:'3px 8px', fontSize:11, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5,
    background: disabled ? '#f5f7fa' : '#fff', color: disabled ? '#aaa' : '#1a3a6b', cursor: disabled ? 'not-allowed' : 'pointer' }
}

function GroupPaginationFooter({ page, pageSize, total, onPageChange, onPageSizeChange }) {
  if (!total) return null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = page * pageSize
  const end   = Math.min(start + pageSize, total)
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderTop:'1px solid #f0f4f8', flexWrap:'wrap', gap:8, background:'#fafcff' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:11, color:'#888' }}>Rows per page:</span>
        <select value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))}
          style={{ padding:'3px 7px', border:'1px solid #dde9f5', borderRadius:5, fontSize:11, color:'#1a3a6b', outline:'none', cursor:'pointer' }}>
          {GROUP_PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:11, color:'#888' }}>{total ? start + 1 : 0}–{end} of {total}</span>
        {totalPages > 1 && (
          <div style={{ display:'flex', gap:4 }}>
            <button onClick={() => onPageChange(0)} disabled={page===0} style={pgBtnStyle(page===0)}>«</button>
            <button onClick={() => onPageChange(Math.max(0, page-1))} disabled={page===0} style={pgBtnStyle(page===0)}>‹ Prev</button>
            <span style={{ padding:'3px 9px', fontSize:11, color:'#555', border:'1px solid #dde9f5', borderRadius:5, background:'#f5f7fa' }}>{page+1} / {totalPages}</span>
            <button onClick={() => onPageChange(Math.min(totalPages-1, page+1))} disabled={page>=totalPages-1} style={pgBtnStyle(page>=totalPages-1)}>Next ›</button>
            <button onClick={() => onPageChange(totalPages-1)} disabled={page>=totalPages-1} style={pgBtnStyle(page>=totalPages-1)}>»</button>
          </div>
        )}
      </div>
    </div>
  )
}

// Small controller object so call sites read/write per-seed page state
// without each needing its own useState.
function useGroupPagination() {
  const [state, setState] = useState({})
  return {
    getPage:      key => state[key]?.page ?? 0,
    getPageSize:  key => state[key]?.pageSize ?? 10,
    setPage:      (key, page) => setState(prev => ({ ...prev, [key]: { pageSize: prev[key]?.pageSize ?? 10, page } })),
    setPageSize:  (key, pageSize) => setState(prev => ({ ...prev, [key]: { pageSize, page: 0 } })),
  }
}

function kwStatusColor(status) {
  const s = String(status || '')
  if (s === 'Enabled' || s === 'Active' || s === 'Eligible') return '#2e7d32'
  if (s === 'Paused') return '#a56700'
  if (s === 'Removed') return '#9e9e9e'
  return '#1a3a6b'
}

const PROMPT_HELP = {
  planner: {
    title:       'Custom Keyword Research Prompt',
    help:        'Describe your business, target audience, services, location, or campaign goals. The AI will generate high-intent keywords based on your description while always returning results in the standard format.',
    example:     '"Emergency roofing company in Dallas, TX. Services: storm damage repair, roof tarping, insurance claims. Target homeowners needing immediate help after severe weather."',
    placeholder: 'Describe your business, services, target location, audience, or campaign goals…',
  },
  cpc: {
    title:       'Custom CPC Optimization Prompt',
    help:        'Describe what types of cheaper alternatives you want the AI to focus on — e.g. specific locations, service niches, or match type preferences. The AI will still return results in the standard format with CPC estimates, intent, and ad group recommendations.',
    example:     '"We run a local HVAC company in Phoenix, AZ. Focus on emergency AC repair and same-day service. Avoid broad terms and prioritize exact-match long-tail alternatives under $10 CPC."',
    placeholder: 'Describe your optimization goals, niche, location, or budget constraints…',
  },
  negative: {
    title:       'Custom Negative Keyword Prompt',
    help:        'Describe what types of irrelevant traffic you want to block or what specific wasted spend patterns to prioritize. The AI will still return results in the standard format with confidence scores, placement recommendations, and savings estimates.',
    example:     '"We are a premium commercial cleaning company in Chicago. Block all residential DIY searches, job-seeker traffic, and budget-focused searches that don\'t match our B2B positioning."',
    placeholder: 'Describe your blocking priorities, audience filters, or traffic quality goals…',
  },
}

function PromptModal({ show, context, draft, onChangeDraft, onSave, onClose }) {
  const h = PROMPT_HELP[context] || PROMPT_HELP.planner
  if (!show) return null
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9999,
      display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:10, width:560, maxWidth:'92vw',
        boxShadow:'0 8px 40px rgba(0,0,0,0.22)', display:'flex', flexDirection:'column' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #dde9f5',
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#1a3a6b' }}>{h.title}</div>
            <div style={{ fontSize:11, color:'#888', marginTop:2 }}>Describe what you want the AI to focus on</div>
          </div>
          <button onClick={onClose}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#aaa', fontSize:18, lineHeight:1, padding:4 }}>✕</button>
        </div>
        <div style={{ padding:'14px 20px', background:'#f0f4fb', borderBottom:'1px solid #dde9f5',
          fontSize:11, color:'#555', lineHeight:1.7 }}>
          <strong style={{ color:'#1a3a6b' }}>What to write:</strong> {h.help}<br/>
          <span style={{ color:'#888' }}>Example: <em>{h.example}</em></span>
        </div>
        <div style={{ padding:'16px 20px' }}>
          <textarea
            value={draft}
            onChange={e => onChangeDraft(e.target.value)}
            placeholder={h.placeholder}
            rows={6}
            style={{ width:'100%', padding:'10px 12px', border:'1px solid #dde9f5', borderRadius:6,
              fontSize:12, color:'#1a3a6b', outline:'none', resize:'vertical',
              fontFamily:'inherit', boxSizing:'border-box', lineHeight:1.6 }}
          />
          <div style={{ fontSize:11, color:'#aaa', marginTop:4 }}>
            {draft.trim().length} characters — be specific for best results
          </div>
        </div>
        <div style={{ padding:'12px 20px', borderTop:'1px solid #dde9f5',
          display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button onClick={onClose}
            style={{ padding:'7px 18px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5',
              borderRadius:6, background:'#fff', color:'#555', cursor:'pointer' }}>Cancel</button>
          <button onClick={onSave}
            style={{ padding:'7px 18px', fontSize:12, fontWeight:700, border:'none',
              borderRadius:6, background:'#1a3a6b', color:'#fff', cursor:'pointer' }}>Save Prompt</button>
        </div>
      </div>
    </div>
  )
}

function PromptModeBar({ promptMode, customPrompt, onSetDefault, onOpenModal }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, flexWrap:'wrap' }}>
      <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Prompt:</span>
      <div style={{ display:'inline-flex', borderRadius:6, border:'1px solid #dde9f5', overflow:'hidden' }}>
        {[['default','Default Prompt'],['custom','Custom Prompt']].map(([mode, label]) => (
          <button key={mode}
            onClick={() => mode === 'custom' ? onOpenModal() : onSetDefault()}
            style={{ padding:'5px 14px', fontSize:12, fontWeight: promptMode === mode ? 700 : 500,
              background: promptMode === mode ? '#1a3a6b' : '#fff',
              color: promptMode === mode ? '#fff' : '#555',
              border:'none', cursor:'pointer', whiteSpace:'nowrap' }}>
            {label}
          </button>
        ))}
      </div>
      {promptMode === 'custom' && customPrompt.trim() && (
        <>
          <button onClick={onOpenModal}
            style={{ fontSize:11, color:'#2563b0', background:'rgba(37,99,176,0.08)',
              border:'1px solid rgba(37,99,176,0.25)', borderRadius:4, padding:'3px 9px',
              cursor:'pointer', fontWeight:600 }}>✎ Edit Prompt</button>
          <span style={{ fontSize:11, color:'#2e7d32', overflow:'hidden', textOverflow:'ellipsis',
            whiteSpace:'nowrap', maxWidth:260 }} title={customPrompt}>
            ✓ {customPrompt.slice(0, 60)}{customPrompt.length > 60 ? '…' : ''}
          </span>
        </>
      )}
      {promptMode === 'custom' && !customPrompt.trim() && (
        <span style={{ fontSize:11, color:'#c0392b' }}>⚠ No custom prompt set — click "Custom Prompt" to add one</span>
      )}
    </div>
  )
}

// ── Shared prompt state hook ──────────────────────────────────────────────────
function usePromptMode() {
  const [promptMode,   setPromptMode]   = useState('default')
  const [customPrompt, setCustomPrompt] = useState('')
  const [showModal,    setShowModal]    = useState(false)
  const [draftPrompt,  setDraftPrompt]  = useState('')
  const openModal  = () => { setDraftPrompt(customPrompt); setShowModal(true) }
  const saveModal  = () => { setCustomPrompt(draftPrompt); setPromptMode(draftPrompt.trim() ? 'custom' : 'default'); setShowModal(false) }
  const closeModal = () => setShowModal(false)
  const activePrompt = promptMode === 'custom' && customPrompt.trim() ? customPrompt.trim() : null
  return { promptMode, setPromptMode, customPrompt, showModal, draftPrompt, setDraftPrompt, openModal, saveModal, closeModal, activePrompt }
}
function KeywordPlannerSection({ selectedAccount, existingKeywords = [] }) {
  const ideaPg = useGroupPagination()
  const [seeds,           setSeeds]           = useState('')
  const [results,         setResults]         = useState(null)
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState(null)
  const [sortCol,         setSortCol]         = useState(null)
  const [sortDir,         setSortDir]         = useState('asc')
  const [skipped,         setSkipped]         = useState(0)
  const [skippedRows,     setSkippedRows]     = useState([])
  const [skippedOpen,     setSkippedOpen]     = useState(false)
  const [kwFilterCampaign, setKwFilterCampaign] = useState('')
  const [kwFilterAdGroup,  setKwFilterAdGroup]  = useState('')
  const [publishRow,       setPublishRow]       = useState(null)
  const [publishedKeys,    setPublishedKeys]    = useState(new Set())
  // Target campaign/ad group selected BEFORE generation — AI generates for this context
  const [targetCampaign,   setTargetCampaign]   = useState('')
  const [targetAdGroup,    setTargetAdGroup]    = useState('')
  const pm = usePromptMode()

  function markPublished(row) {
    setPublishedKeys(prev => new Set([...prev, `${row.keyword}|${row.matchType}`]))
  }

  // Campaigns: enabled at campaign level (ad group status irrelevant)
  const enabledCampaignRows = useMemo(() =>
    (existingKeywords || []).filter(r => r.campaignStatus === 'Enabled')
  , [existingKeywords])

  // Ad groups: both campaign and ad group must be enabled
  const enabledRows = useMemo(() =>
    (existingKeywords || []).filter(r => r.campaignStatus === 'Enabled' && r.adGroupStatus === 'Enabled')
  , [existingKeywords])

  const accountCampaigns = useMemo(() =>
    [...new Set(enabledCampaignRows.map(r => r.campaign).filter(Boolean))].sort()
  , [enabledCampaignRows])

  const accountAdGroups = useMemo(() => {
    const source = kwFilterCampaign
      ? enabledRows.filter(r => r.campaign === kwFilterCampaign)
      : enabledRows
    return [...new Set(source.map(r => r.adGroup).filter(Boolean))].sort()
  }, [enabledRows, kwFilterCampaign])

  // Every real campaign/ad-group pair in the account — lets the backend check
  // for a literal word match against the keyword before trusting the AI's
  // own campaign routing judgment.
  const campaignAdGroupPairs = useMemo(() => {
    const seen = new Set(), pairs = []
    for (const r of enabledRows) {
      if (!r.campaign || !r.adGroup) continue
      const key = `${r.campaign}|${r.adGroup}`
      if (seen.has(key)) continue
      seen.add(key); pairs.push({ campaign: r.campaign, adGroup: r.adGroup })
    }
    return pairs
  }, [enabledRows])

  // Ad groups under the selected target campaign (for generation selector)
  const targetAdGroups = useMemo(() => {
    const source = targetCampaign
      ? enabledRows.filter(r => r.campaign === targetCampaign)
      : enabledRows
    return [...new Set(source.map(r => r.adGroup).filter(Boolean))].sort()
  }, [enabledRows, targetCampaign])

  function toggleSort(col) {
    if (sortCol === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc') }
    else { setSortCol(col); setSortDir('asc') }
  }

  const normalizeKw = s => (s || '').toLowerCase().trim()
    .replace(/^\[|\]$/g, '').replace(/^"|"$/g, '').replace(/^\+/g, '').trim()

  const existingKwSet = useMemo(() =>
    new Set((existingKeywords || []).map(r => normalizeKw(r.text)))
  , [existingKeywords])

  // Map from normalized keyword text → existing keyword rows (for accordion detail)
  const existingKwMap = useMemo(() => {
    const map = new Map()
    for (const row of existingKeywords || []) {
      const key = normalizeKw(row.text)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(row)
    }
    return map
  }, [existingKeywords])

  function sortIdeas(ideas) {
    if (!sortCol) return ideas
    const COMP_ORDER  = { Low:1, Medium:2, High:3 }
    const STAGE_ORDER = { 'Ready To Buy':1, 'Comparing Options':2, 'Urgent Need':3 }
    const parseNum = s => { const m = String(s||'').replace(/,/g,'').match(/[\d.]+/); return m ? Number(m[0]) : 0 }
    const getVal = r => {
      switch (sortCol) {
        case 'Keyword Idea':    return (r.keyword || '').toLowerCase()
        case 'Match Type':      return (r.matchType || '').toLowerCase()
        case 'Search Intent':   return (r.searchIntent || '').toLowerCase()
        case 'Buyer Stage':     return STAGE_ORDER[r.buyerStage] ?? 99
        case 'Searches/mo':     return parseNum(r.monthlySearches)
        case 'Competition':     return COMP_ORDER[r.competition] ?? 99
        case 'Est. CPC':        return parseNum(r.estimatedCpc)
        case 'CPC vs Avg':      return parseNum(r.estimatedSavings)
        case 'Conv. Score':     return Number(r.conversionScore) || 0
        case 'Traffic':         return (r.trafficPotential || '').toLowerCase()
        case 'Rec. Campaign / Ad Group': return `${(r.recommendedCampaign || '').toLowerCase()}|${(r.adGroup || '').toLowerCase()}`
        default: return 0
      }
    }
    return [...ideas].sort((a, b) => {
      const av = getVal(a), bv = getVal(b)
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sortDir === 'asc' ? cmp : -cmp
    })
  }

  async function fetchIdeas() {
    if (!seeds.trim()) return
    const kws = seeds.split(',').map(s => s.trim()).filter(Boolean)
    setLoading(true); setError(null); setResults(null); setSkipped(0); setSkippedRows([]); setSkippedOpen(false)
    try {
      const payload = { seedKeywords: kws }
      if (pm.activePrompt)   payload.customPrompt     = pm.activePrompt
      // When a specific target is chosen, pass it as the generation target;
      // otherwise fall back to the full enabled list as broad context.
      if (targetCampaign)    payload.selectedCampaign = targetCampaign
      else if (accountCampaigns.length) payload.existingCampaigns = accountCampaigns.slice(0, 30)
      if (targetAdGroup)     payload.selectedAdGroup  = targetAdGroup
      else if (accountAdGroups.length)  payload.existingAdGroups  = accountAdGroups.slice(0, 50)
      if (!targetCampaign && campaignAdGroupPairs.length) payload.campaignAdGroupPairs = campaignAdGroupPairs.slice(0, 300)
      const data = await window.electronAPI.fetchKeywordIdeas(payload)
      const raw     = Array.isArray(data) ? data : []
      const deduped = raw.filter(r => !existingKwSet.has(normalizeKw(r.keyword)))
      // Collect the matching existing keyword rows for the accordion detail view
      const seen = new Set()
      const removedDetails = raw
        .filter(r => existingKwSet.has(normalizeKw(r.keyword)))
        .flatMap(r => existingKwMap.get(normalizeKw(r.keyword)) || [])
        .filter(r => {
          const k = `${normalizeKw(r.text)}|${r.matchType}|${r.campaign}|${r.adGroup}`
          if (seen.has(k)) return false
          seen.add(k); return true
        })
      setSkipped(raw.length - deduped.length)
      setSkippedRows(removedDetails)
      setResults(deduped)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  const grouped = useMemo(() => {
    if (!results) return {}
    return results.reduce((acc, r) => {
      const k = r.seedKeyword || 'Unknown'
      if (!acc[k]) acc[k] = { ideas:[], analysis:null, campaignStructure:null, negKeywords:new Set() }
      acc[k].ideas.push(r)
      if (!acc[k].analysis && r.analysis) acc[k].analysis = r.analysis
      if (!acc[k].campaignStructure && r.campaignStructure) acc[k].campaignStructure = r.campaignStructure
      ;(r.negativeKeywords || []).forEach(nk => acc[k].negKeywords.add(nk))
      return acc
    }, {})
  }, [results])

  // Filter ideas by recommended campaign / ad group
  const filteredGrouped = useMemo(() => {
    if (!kwFilterCampaign && !kwFilterAdGroup) return grouped
    const out = {}
    for (const [seed, data] of Object.entries(grouped)) {
      const ideas = data.ideas.filter(r =>
        (!kwFilterCampaign || r.recommendedCampaign === kwFilterCampaign) &&
        (!kwFilterAdGroup  || r.adGroup             === kwFilterAdGroup)
      )
      if (ideas.length) out[seed] = { ...data, ideas }
    }
    return out
  }, [grouped, kwFilterCampaign, kwFilterAdGroup])

  const plannerCsvRows = useMemo(() => {
    const rows = []
    for (const [seed, { ideas }] of Object.entries(filteredGrouped)) {
      for (const r of sortIdeas(ideas)) {
        rows.push({
          'Seed Keyword':         seed,
          'Keyword Idea':         r.keyword            || '',
          'Match Type':           r.matchType          || '',
          'Search Intent':        r.searchIntent       || '',
          'Buyer Stage':          r.buyerStage         || '',
          'Searches/mo':          r.monthlySearches    || '',
          'Competition':          r.competition        || '',
          'Est. CPC':             r.estimatedCpc       || '',
          'CPC vs Avg':           r.estimatedSavings   || '',
          'Conv. Score':          r.conversionScore    ?? '',
          'Traffic':              r.trafficPotential   || '',
          'Recommended Campaign': r.recommendedCampaign || '',
          'Recommended Ad Group': r.adGroup            || '',
          'Why It Converts':      r.whyItConverts      || '',
        })
      }
    }
    return rows
  }, [filteredGrouped, sortCol, sortDir])

  // Filter dropdowns sourced from AI results only
  const filterableCampaigns = useMemo(() => {
    const ideas = Object.values(grouped).flatMap(g => g.ideas)
    return [...new Set(ideas.map(r => r.recommendedCampaign).filter(Boolean))].sort()
  }, [grouped])

  const filterableAdGroups = useMemo(() => {
    const ideas = Object.values(grouped).flatMap(g => g.ideas)
    const source = kwFilterCampaign ? ideas.filter(r => r.recommendedCampaign === kwFilterCampaign) : ideas
    return [...new Set(source.map(r => r.adGroup).filter(Boolean))].sort()
  }, [grouped, kwFilterCampaign])

  return (
    <Section title="🤖 AI Keyword Planner">
      {publishRow && (
        <PublishKeywordModal
          row={publishRow}
          selectedAccount={selectedAccount}
          onClose={() => setPublishRow(null)}
          onSuccess={() => { markPublished(publishRow); setPublishRow(null) }}
        />
      )}
      <PromptModal show={pm.showModal} context="planner" draft={pm.draftPrompt}
        onChangeDraft={pm.setDraftPrompt} onSave={pm.saveModal} onClose={pm.closeModal}/>

      {/* ── Input panel ── */}
      <div className="card-body" style={{ borderBottom:'1px solid #dde9f5' }}>
        <PromptModeBar promptMode={pm.promptMode} customPrompt={pm.customPrompt}
          onSetDefault={() => pm.setPromptMode('default')} onOpenModal={pm.openModal}/>

        {/* ── Campaign & Ad Group target selectors ── */}
        {accountCampaigns.length > 0 && (
          <div style={{ marginBottom:14, padding:'12px 14px', background:'#f0f4fb',
            border:'1px solid #dde9f5', borderRadius:7 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#1a3a6b', marginBottom:8, letterSpacing:0.3 }}>
              Target Campaign &amp; Ad Group
              <span style={{ fontSize:10, color:'#888', fontWeight:400, marginLeft:6 }}>
                — AI generates keywords specifically for the selected context
              </span>
            </div>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                <label style={{ fontSize:10, fontWeight:600, color:'#555', letterSpacing:0.3, textTransform:'uppercase' }}>Campaign</label>
                <select
                  value={targetCampaign}
                  onChange={e => { setTargetCampaign(e.target.value); setTargetAdGroup('') }}
                  style={{ padding:'7px 12px', border:'1px solid #c8d9ed', borderRadius:6,
                    fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer',
                    background:'#fff', minWidth:220 }}
                >
                  <option value="">All Campaigns</option>
                  {accountCampaigns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                <label style={{ fontSize:10, fontWeight:600, color:'#555', letterSpacing:0.3, textTransform:'uppercase' }}>Ad Group</label>
                <select
                  value={targetAdGroup}
                  onChange={e => setTargetAdGroup(e.target.value)}
                  disabled={!targetCampaign}
                  style={{ padding:'7px 12px', border:'1px solid #c8d9ed', borderRadius:6,
                    fontSize:12, color: targetCampaign ? '#1a3a6b' : '#aaa', outline:'none',
                    cursor: targetCampaign ? 'pointer' : 'not-allowed',
                    background: targetCampaign ? '#fff' : '#f5f7fa', minWidth:200 }}
                >
                  <option value="">All Ad Groups</option>
                  {targetAdGroups.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              {(targetCampaign || targetAdGroup) && (
                <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                  <label style={{ fontSize:10, color:'transparent', letterSpacing:0.3 }}>_</label>
                  <button
                    onClick={() => { setTargetCampaign(''); setTargetAdGroup('') }}
                    style={{ padding:'7px 12px', fontSize:11, fontWeight:600, color:'#2563b0',
                      background:'none', border:'1px solid #dde9f5', borderRadius:6, cursor:'pointer' }}
                  >
                    Clear
                  </button>
                </div>
              )}
              {targetCampaign && (
                <div style={{ marginLeft:'auto', fontSize:11, color:'#2e7d32', fontWeight:500,
                  background:'#e8f5e9', border:'1px solid rgba(76,175,80,0.35)',
                  borderRadius:5, padding:'4px 10px', whiteSpace:'nowrap' }}>
                  ✓ Generating for: <strong>{targetCampaign}</strong>
                  {targetAdGroup && <> → <strong>{targetAdGroup}</strong></>}
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ fontSize:12, color:'#555', marginBottom:8 }}>
          Enter seed keywords separated by commas:<br/>
          <code style={{ fontSize:11, background:'#f0f4f8', padding:'2px 6px', borderRadius:3 }}>
            plumber, roof repair, junk removal
          </code>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <input
            value={seeds}
            onChange={e => setSeeds(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') fetchIdeas() }}
            placeholder="plumber, roof repair, junk removal..."
            style={{ flex:1, padding:'8px 12px', border:'1px solid #dde9f5', borderRadius:6,
              fontSize:13, color:'#1a3a6b', outline:'none' }}
          />
          <button
            onClick={fetchIdeas}
            disabled={loading || !seeds.trim() || (pm.promptMode === 'custom' && !pm.customPrompt.trim())}
            style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 18px',
              background: loading || !seeds.trim() || (pm.promptMode === 'custom' && !pm.customPrompt.trim()) ? '#dde9f5' : '#e8a020',
              color:      loading || !seeds.trim() || (pm.promptMode === 'custom' && !pm.customPrompt.trim()) ? '#aaa'    : '#1a3a6b',
              fontWeight:700, fontSize:13, borderRadius:6, border:'none',
              cursor: loading || !seeds.trim() || (pm.promptMode === 'custom' && !pm.customPrompt.trim()) ? 'not-allowed' : 'pointer' }}
          >
            {loading && <Loader2 size={13} className="spin"/>}
            {loading ? 'Generating…' : 'Get Ideas'}
          </button>
        </div>
        {results && (
          <div style={{ marginTop:8, fontSize:12, color:'#888' }}>
            {results.length} keyword idea{results.length !== 1 ? 's' : ''} found for {Object.keys(grouped).length} seed{Object.keys(grouped).length !== 1 ? 's' : ''}
          </div>
        )}
        {error && <div style={{ marginTop:8, fontSize:12, color:'#c0392b' }}>⚠ {error}</div>}
        {skipped > 0 && (
          <div style={{ marginTop:8, border:'1px solid #f0b429', borderRadius:7, overflow:'hidden' }}>
            {/* Accordion header */}
            <div
              onClick={() => setSkippedOpen(o => !o)}
              style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 13px',
                background:'#fff8e1', cursor:'pointer', userSelect:'none' }}
            >
              <span style={{ fontSize:14, color:'#a56700', flexShrink:0 }}>⚠</span>
              <span style={{ fontSize:12, color:'#a56700', flex:1 }}>
                <strong>{skipped}</strong> idea{skipped !== 1 ? 's' : ''} removed — already exist in your keyword list (adding them would create keyword crossover).
              </span>
              <span style={{ fontSize:11, fontWeight:700, color:'#a56700', whiteSpace:'nowrap',
                display:'flex', alignItems:'center', gap:4 }}>
                {skippedOpen ? '▲ Hide' : '▼ Show details'}
              </span>
            </div>

            {/* Expanded keyword detail table */}
            {skippedOpen && skippedRows.length > 0 && (
              <div style={{ overflowX:'auto', borderTop:'1px solid #f0b429' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                  <thead>
                    <tr>
                      {[
                        ['Keyword',    'left'],
                        ['Match Type', 'center'],
                        ['Status',     'center'],
                        ['Campaign',   'left'],
                        ['Ad Group',   'left'],
                      ].map(([h, a]) => (
                        <th key={h} style={{ background:'#fff3cd', color:'#7a5000', padding:'7px 10px',
                          textAlign:a, fontSize:10, fontWeight:700, whiteSpace:'nowrap',
                          borderBottom:'1px solid #f0b429', position:'sticky', top:0 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {skippedRows.map((row, i) => {
                      const statusColor = kwStatusColor(row.status)
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#fffdf5' : '#fffbec' }}>
                          <td style={{ padding:'7px 10px', borderBottom:'1px solid #fdecc8',
                            fontWeight:600, color:'#1a3a6b', whiteSpace:'nowrap' }}>
                            {row.text}
                          </td>
                          <td style={{ padding:'7px 10px', borderBottom:'1px solid #fdecc8', textAlign:'center' }}>
                            <StatusBadge value={row.matchType} type="match"/>
                          </td>
                          <td style={{ padding:'7px 10px', borderBottom:'1px solid #fdecc8', textAlign:'center' }}>
                            <span style={{ fontSize:10, fontWeight:600, padding:'2px 6px', borderRadius:4,
                              background:`${statusColor}22`, color:statusColor,
                              border:`1px solid ${statusColor}55` }}>
                              {row.status || '—'}
                            </span>
                          </td>
                          <td style={{ padding:'7px 10px', borderBottom:'1px solid #fdecc8',
                            color:'#555', maxWidth:160, overflow:'hidden',
                            textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {row.campaign || '—'}
                          </td>
                          <td style={{ padding:'7px 10px', borderBottom:'1px solid #fdecc8',
                            color:'#555', maxWidth:160, overflow:'hidden',
                            textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {row.adGroup || '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {results && results.length === 0 && (
        <div style={{ padding:'24px 0', textAlign:'center', color:'#aaa', fontSize:13 }}>
          No keyword ideas returned. Try different seed keywords.
        </div>
      )}

      {/* ── Results filter bar ── */}
      {results && results.length > 0 && (
        <div style={{ padding:'10px 16px', background:'#fafcff', borderBottom:'1px solid #f0f4f8',
          display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign:</span>
            <select
              value={kwFilterCampaign}
              onChange={e => { setKwFilterCampaign(e.target.value); setKwFilterAdGroup('') }}
              style={{ padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }}
            >
              <option value="">All</option>
              {filterableCampaigns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Ad Group:</span>
            <select
              value={kwFilterAdGroup}
              onChange={e => setKwFilterAdGroup(e.target.value)}
              style={{ padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }}
            >
              <option value="">All</option>
              {filterableAdGroups.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {(kwFilterCampaign || kwFilterAdGroup) && (
            <button onClick={() => { setKwFilterCampaign(''); setKwFilterAdGroup('') }}
              style={{ fontSize:11, color:'#2563b0', background:'none', border:'1px solid #dde9f5', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
              Clear
            </button>
          )}
          <div style={{ display:'flex', alignItems:'center', gap:10, marginLeft:'auto' }}>
            <span style={{ fontSize:11, color:'#888' }}>
              {Object.values(filteredGrouped).reduce((s, g) => s + g.ideas.length, 0)} of {results.length} ideas
            </span>
            <ExportButton data={plannerCsvRows} filename="ai_keyword_planner.csv" label="Export CSV"/>
          </div>
        </div>
      )}

      {Object.entries(filteredGrouped).map(([seed, { ideas, analysis, campaignStructure, negKeywords }]) => {
        const sortedIdeas = sortIdeas(ideas)
        const pageSize     = ideaPg.getPageSize(seed)
        const page         = ideaPg.getPage(seed)
        const pageStart    = page * pageSize
        const visibleIdeas = sortedIdeas.slice(pageStart, pageStart + pageSize)
        return (
        <div key={seed} style={{ borderBottom:'2px solid #dde9f5' }}>

          {/* Seed keyword header */}
          <div style={{ padding:'10px 16px', background:'#e8f5e9', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, fontWeight:700, color:'#2e7d32', padding:'2px 8px',
              background:'rgba(76,175,80,0.15)', borderRadius:4, border:'1px solid rgba(76,175,80,0.4)' }}>
              🌱 Seed
            </span>
            <span style={{ fontSize:14, fontWeight:700, color:'#1a3a6b' }}>{seed}</span>
          </div>

          {/* AI Analysis panel */}
          {analysis && (
            <div style={{ padding:'12px 16px', background:'#f0f4fb', borderBottom:'1px solid #dde9f5' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#1a3a6b', letterSpacing:1,
                textTransform:'uppercase', marginBottom:8 }}>AI Analysis</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom: analysis.market_opportunity ? 10 : 0 }}>
                {analysis.intent && (
                  <div style={{ background:'#fff', border:'1px solid #dde9f5', borderRadius:6, padding:'6px 12px' }}>
                    <div style={{ fontSize:9, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>Search Intent</div>
                    <ColorBadge value={analysis.intent} colorMap={INTENT_COLORS}/>
                  </div>
                )}
                {analysis.buyer_stage && (
                  <div style={{ background:'#fff', border:'1px solid #dde9f5', borderRadius:6, padding:'6px 12px' }}>
                    <div style={{ fontSize:9, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>Buyer Stage</div>
                    <ColorBadge value={analysis.buyer_stage} colorMap={STAGE_COLORS}/>
                  </div>
                )}
                {analysis.estimated_cpc_range && (
                  <div style={{ background:'#fff', border:'1px solid #dde9f5', borderRadius:6, padding:'6px 12px' }}>
                    <div style={{ fontSize:9, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>Est. CPC Range</div>
                    <span style={{ fontSize:13, fontWeight:700, color:'#1a3a6b' }}>{analysis.estimated_cpc_range}</span>
                  </div>
                )}
              </div>
              {analysis.market_opportunity && (
                <div style={{ fontSize:12, color:'#4a4a4a', background:'#fff', border:'1px solid #dde9f5',
                  borderRadius:6, padding:'8px 12px', lineHeight:1.6 }}>
                  <span style={{ fontWeight:600, color:'#2e7d32' }}>Market Opportunity: </span>
                  {analysis.market_opportunity}
                </div>
              )}
            </div>
          )}

          {/* Ideas table */}
          <div style={{ overflow:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr>
                  {[
                    ['Keyword Idea',  'left',   160],
                    ['Match Type',    'center',   90],
                    ['Search Intent', 'center',  115],
                    ['Buyer Stage',   'center',  115],
                    ['Searches/mo',   'center',   85],
                    ['Competition',   'center',   88],
                    ['Est. CPC',      'center',   80],
                    ['CPC vs Avg',    'center',   88],
                    ['Conv. Score',   'center',   80],
                    ['Traffic',              'center',   95],
                    ['Rec. Campaign / Ad Group', 'left', 190],
                    ['Why It Converts',      'left',    220],
                    ['',                     'center',   80],
                  ].map(([l, a, w]) => {
                    const active = sortCol === l
                    const sortable = l !== 'Why It Converts'
                    return (
                      <th key={l}
                        onClick={sortable ? () => toggleSort(l) : undefined}
                        style={{ background: active ? '#0f2850' : '#1a3a6b', color:'#fff',
                          padding:'8px 10px', textAlign:a, fontSize:10, fontWeight:600,
                          whiteSpace:'nowrap', position:'sticky', top:0, zIndex:2, minWidth:w,
                          cursor: sortable ? 'pointer' : 'default', userSelect:'none' }}>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:4,
                          justifyContent: a === 'center' ? 'center' : 'flex-start' }}>
                          {renderHeaderLabel(l)}
                          {sortable && (
                            <span style={{ fontSize:9, opacity: active ? 1 : 0.35, lineHeight:1 }}>
                              {active ? (sortDir === 'asc' ? '▲' : '▼') : '⬍'}
                            </span>
                          )}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleIdeas.map((r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f5f7fa' }}>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', fontWeight:600, color:'#2563b0' }}>
                      {r.keyword}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <StatusBadge value={r.matchType} type="match"/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ColorBadge value={r.searchIntent} colorMap={INTENT_COLORS}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ColorBadge value={r.buyerStage} colorMap={STAGE_COLORS}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', color:'#555', fontSize:11 }}>
                      {r.monthlySearches || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      {r.competition && (
                        <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:4, whiteSpace:'nowrap',
                          background:`${COMPETITION_BADGE[r.competition]||'#888'}22`,
                          color:      COMPETITION_BADGE[r.competition]||'#888',
                          border:`1px solid ${COMPETITION_BADGE[r.competition]||'#888'}44` }}>
                          {r.competition}
                        </span>
                      )}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', fontWeight:600, color:'#1a3a6b', whiteSpace:'nowrap' }}>
                      {r.estimatedCpc || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', fontWeight:700, color:'#2e7d32', whiteSpace:'nowrap' }}>
                      {r.estimatedSavings || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ConvScore score={r.conversionScore}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ColorBadge value={r.trafficPotential} colorMap={TRAFFIC_COLORS}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', fontSize:11,
                      maxWidth:190, overflow:'hidden', textOverflow:'ellipsis' }}>
                      <div style={{ color:'#1a3a6b', fontWeight:600 }}>{r.recommendedCampaign || '—'}</div>
                      <div style={{ color:'#2563b0', marginTop:2 }}>{r.adGroup || '—'}</div>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', color:'#4a4a4a', lineHeight:1.5 }}>
                      {r.whyItConverts || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      {publishedKeys.has(`${r.keyword}|${r.matchType}`) ? (
                        <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px',
                          fontSize:11, fontWeight:600, borderRadius:5, whiteSpace:'nowrap',
                          border:'1px solid #4caf50', background:'#e8f5e9', color:'#2e7d32' }}>
                          <Check size={11}/> Published
                        </span>
                      ) : (
                        <button
                          onClick={() => setPublishRow(r)}
                          style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px',
                            fontSize:11, fontWeight:600, borderRadius:5, cursor:'pointer', whiteSpace:'nowrap',
                            border:'1px solid #1a3a6b', background:'#1a3a6b', color:'#fff' }}>
                          🚀 Proceed to Publish
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <GroupPaginationFooter
            page={page} pageSize={pageSize} total={sortedIdeas.length}
            onPageChange={p => ideaPg.setPage(seed, p)}
            onPageSizeChange={s => ideaPg.setPageSize(seed, s)}
          />

          {/* Campaign structure + negative keywords */}
          {(campaignStructure || negKeywords.size > 0) && (
            <div style={{ display:'flex', flexWrap:'wrap', borderTop:'1px solid #f0f4f8', background:'#fafbfd' }}>
              {campaignStructure && (campaignStructure.campaign_name || campaignStructure.ad_groups?.length > 0) && (
                <div style={{ flex:'1 1 260px', padding:'12px 16px', borderRight:'1px solid #f0f4f8' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'#1a3a6b', letterSpacing:1,
                    textTransform:'uppercase', marginBottom:6 }}>Campaign Structure</div>
                  {campaignStructure.campaign_name && (
                    <div style={{ fontSize:11, fontWeight:700, color:'#1a3a6b', marginBottom:7 }}>
                      📁 {campaignStructure.campaign_name}
                    </div>
                  )}
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {(campaignStructure.ad_groups || []).map((ag, i) => (
                      <span key={i} style={{ fontSize:11, padding:'3px 9px', background:'#e3f2fd',
                        color:'#1565c0', border:'1px solid #2196f330', borderRadius:4, fontWeight:500 }}>
                        {ag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {negKeywords.size > 0 && (
                <div style={{ flex:'1 1 260px', padding:'12px 16px' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'#1a3a6b', letterSpacing:1,
                    textTransform:'uppercase', marginBottom:6 }}>Suggested Negative Keywords</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {[...negKeywords].map((nk, i) => (
                      <span key={i} style={{ fontSize:11, padding:'3px 9px', background:'#ffebee',
                        color:'#b71c1c', border:'1px solid #f4433630', borderRadius:4, fontWeight:500 }}>
                        −{nk}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        )
      })}
    </Section>
  )
}
// ── CPC Keyword Optimizer ────────────────────────────────────────────────────
const COMPETITION_BADGE = { Low:'#2e7d32', Medium:'#a56700', High:'#c0392b' }

const INTENT_COLORS = {
  'Transactional':    { bg:'#e8f5e9', text:'#2e7d32', border:'#4caf5040' },
  'Commercial':       { bg:'#e3f2fd', text:'#1565c0', border:'#2196f340' },
  'Local Service':    { bg:'#f3e5f5', text:'#6a1b9a', border:'#9c27b040' },
  'Emergency':        { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
  'Price Comparison': { bg:'#fff3e0', text:'#e65100', border:'#ff980040' },
}
const STAGE_COLORS = {
  'Ready To Buy':      { bg:'#e8f5e9', text:'#2e7d32', border:'#4caf5040' },
  'Comparing Options': { bg:'#e3f2fd', text:'#1565c0', border:'#2196f340' },
  'Urgent Need':       { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
}
const TRAFFIC_COLORS = {
  'High Traffic':    { bg:'#e3f2fd', text:'#1565c0', border:'#2196f340' },
  'Balanced':        { bg:'#f5f5f5', text:'#555555', border:'#99999940' },
  'High Conversion': { bg:'#e8f5e9', text:'#2e7d32', border:'#4caf5040' },
}

function ColorBadge({ value, colorMap }) {
  if (!value) return <span style={{ color:'#bbb', fontSize:11 }}>—</span>
  const c = colorMap[value] || { bg:'#f5f5f5', text:'#555', border:'#99999940' }
  return (
    <span style={{ display:'inline-block', fontSize:10, fontWeight:600, padding:'2px 7px',
      borderRadius:4, background:c.bg, color:c.text, border:`1px solid ${c.border}`, whiteSpace:'nowrap' }}>
      {value}
    </span>
  )
}

function ConvScore({ score }) {
  const n = Number(score) || 0
  if (!n) return <span style={{ color:'#bbb', fontSize:11 }}>—</span>
  const color = n >= 80 ? '#2e7d32' : n >= 60 ? '#a56700' : '#888'
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
      <span style={{ fontSize:12, fontWeight:700, color }}>{n}<span style={{ fontSize:9, fontWeight:400, color:'#aaa' }}>/100</span></span>
      <div style={{ width:38, height:4, borderRadius:2, background:'#eee', overflow:'hidden' }}>
        <div style={{ width:`${n}%`, height:'100%', background:color, borderRadius:2 }}/>
      </div>
    </div>
  )
}

// ── Negative Keywords Optimizer ──────────────────────────────────────────────
const NEG_PRIORITY_COLORS = {
  Critical: { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
  High:     { bg:'#fff3e0', text:'#e65100', border:'#ff980040' },
  Medium:   { bg:'#fff8e1', text:'#f57f17', border:'#fbc02d40' },
  Low:      { bg:'#f5f5f5', text:'#555',    border:'#99999940' },
}
const NEG_SAFETY_COLORS = {
  Safe:   { bg:'#e8f5e9', text:'#2e7d32', border:'#4caf5040' },
  Review: { bg:'#fff3e0', text:'#e65100', border:'#ff980040' },
  Risky:  { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
}
const NEG_SEVERITY_COLORS = {
  'Critical Waste': { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
  'Moderate Waste': { bg:'#fff3e0', text:'#e65100', border:'#ff980040' },
  'Low Waste':      { bg:'#fff8e1', text:'#f57f17', border:'#fbc02d40' },
}
const NEG_INTENT_COLORS = {
  'Transactional Intent':    { bg:'#e8f5e9', text:'#2e7d32', border:'#4caf5040' },
  'Commercial Intent':       { bg:'#e3f2fd', text:'#1565c0', border:'#2196f340' },
  'Informational Intent':    { bg:'#f3e5f5', text:'#6a1b9a', border:'#9c27b040' },
  'DIY Intent':              { bg:'#fff3e0', text:'#e65100', border:'#ff980040' },
  'Employment Intent':       { bg:'#fce4ec', text:'#880e4f', border:'#e91e6340' },
  'Educational Intent':      { bg:'#e8eaf6', text:'#283593', border:'#3f51b540' },
  'Research Intent':         { bg:'#e0f2f1', text:'#004d40', border:'#00968840' },
  'Freebie Intent':          { bg:'#fff9c4', text:'#f57f17', border:'#ffd54f40' },
  'Competitor Research':     { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
  'Low Commercial Intent':   { bg:'#f5f5f5', text:'#555',    border:'#99999940' },
  'Geographic Mismatch':     { bg:'#f3e5f5', text:'#6a1b9a', border:'#9c27b040' },
}
const NEG_ISSUE_COLORS = {
  Duplicate:    { bg:'#fff3e0', text:'#e65100', border:'#ff980040' },
  Conflict:     { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
  Overblocking: { bg:'#fce4ec', text:'#880e4f', border:'#e91e6340' },
  Redundant:    { bg:'#fff8e1', text:'#f57f17', border:'#fbc02d40' },
}

function NegBadge({ value, colorMap }) {
  if (!value) return <span style={{ color:'#bbb', fontSize:11 }}>—</span>
  const c = colorMap[value] || { bg:'#f5f5f5', text:'#555', border:'#99999940' }
  return (
    <span style={{ display:'inline-block', fontSize:10, fontWeight:600, padding:'2px 7px',
      borderRadius:4, background:c.bg, color:c.text, border:`1px solid ${c.border}`, whiteSpace:'nowrap' }}>
      {value}
    </span>
  )
}

function NegConfidenceBar({ score }) {
  const n = Number(score) || 0
  if (!n) return <span style={{ color:'#bbb', fontSize:11 }}>—</span>
  const color = n >= 80 ? '#2e7d32' : n >= 60 ? '#a56700' : '#888'
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
      <span style={{ fontSize:12, fontWeight:700, color }}>{n}<span style={{ fontSize:9, fontWeight:400, color:'#aaa' }}>/100</span></span>
      <div style={{ width:38, height:4, borderRadius:2, background:'#eee', overflow:'hidden' }}>
        <div style={{ width:`${n}%`, height:'100%', background:color, borderRadius:2 }}/>
      </div>
    </div>
  )
}

const NEG_INNER_TABS = [
  { id:'recommendations', label:'Suggestions' },
  { id:'conflicts',       label:'Duplicates & Conflicts' },
  { id:'patterns',        label:'Pattern Analysis' },
]

function NegRecCell({ rec, rowLoading, onRetry }) {
  if (rowLoading) return (
    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
      <div className="skeleton" style={{ height:10, width:'90%', borderRadius:3 }}/>
      <div className="skeleton" style={{ height:10, width:'70%', borderRadius:3 }}/>
    </div>
  )
  if (!rec) return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <span style={{ color:'#bbb', fontSize:11 }}>—</span>
      {onRetry && (
        <button
          onClick={e => { e.stopPropagation(); onRetry() }}
          title="Generate recommendation for this row"
          style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'2px 7px', fontSize:10,
            color:'#2563b0', background:'rgba(37,99,176,0.08)', border:'1px solid rgba(37,99,176,0.25)',
            borderRadius:4, cursor:'pointer', fontWeight:600, whiteSpace:'nowrap' }}>
          <RefreshCw size={9}/> Retry
        </button>
      )}
    </div>
  )
  return (
    <div style={{ fontSize:11, color:'#1a3a6b', lineHeight:1.6, fontWeight:500 }}>
      {highlightRecommendation(rec)}
    </div>
  )
}

function NegativeKeywordsOptimizerSection({ rows, negData }) {
  const [result,       setResult]       = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [innerTab,     setInnerTab]     = useState('recommendations')
  const [retryingRows, setRetryingRows] = useState(new Set())
  const pm = usePromptMode()

  const kwCount  = (rows || []).filter(r => r.cost > 0 || r.conversions > 0).length
  const negCount = (negData?.existingNegatives || []).length

  async function analyze() {
    setLoading(true); setError(null); setResult(null)
    try {
      const keywords = (rows || [])
        .filter(r => r.cost > 0 || r.conversions > 0)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 60)
        .map(k => ({
          keyword:   k.text,
          matchType: k.matchType,
          campaign:  k.campaign,
          adGroup:   k.adGroup,
          clicks:      k.clicks,
          impressions: k.impressions,
          cost:        Number((k.cost   || 0).toFixed(2)),
          conversions: k.conversions,
          cpc:         Number((k.cpc   || 0).toFixed(2)),
          ctr:         Number((k.ctr   || 0).toFixed(2)),
          convRate:    Number((k.convRate || 0).toFixed(2)),
        }))

      const negatives = (negData?.existingNegatives || []).slice(0, 50).map(n => ({
        keyword:   n.text,
        matchType: n.matchType,
        level:     n.level,
        campaign:  n.campaign,
        adGroup:   n.adGroup || '',
      }))

      const payload = { keywords, negatives }
      if (pm.activePrompt) payload.customPrompt = pm.activePrompt
      const data = await window.electronAPI.negativeOptimize(payload)
      if (!data || typeof data !== 'object') throw new Error('Empty response from AI. Please try again.')
      // Normalise: ensure all expected keys exist
      setResult({
        summary:         data.summary         || {},
        recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
        conflicts:       Array.isArray(data.conflicts)       ? data.conflicts       : [],
        patterns:        Array.isArray(data.patterns)        ? data.patterns        : [],
      })
    } catch (err) {
      setError(err.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  async function retryRec(index) {
    const row = (result?.recommendations || [])[index]
    if (!row) return
    setRetryingRows(prev => new Set(prev).add(index))
    try {
      const rec = await window.electronAPI.negativeRowRecommend({ row })
      setResult(prev => {
        const recs = [...(prev?.recommendations || [])]
        recs[index] = { ...recs[index], ai_recommendation: rec }
        return { ...prev, recommendations: recs }
      })
    } catch (e) {
      console.error('Row retry failed:', e.message)
    } finally {
      setRetryingRows(prev => { const s = new Set(prev); s.delete(index); return s })
    }
  }

  const summary = result?.summary || {}
  const recommendations = result?.recommendations || []
  const conflicts = result?.conflicts || []
  const patterns  = result?.patterns  || []

  const recCsvRows = useMemo(() => recommendations.map(r => ({
    'Negative Keyword':  r.negative_keyword  || '',
    'Match Type':        r.match_type        || '',
    'Intent':            r.intent_type       || '',
    'Priority':          r.priority          || '',
    'Confidence Score':  r.confidence_score  ?? '',
    'Waste Severity':    r.waste_severity    || '',
    'Safety':            r.blocking_safety   || '',
    'Est. Savings':      r.estimated_savings || '',
    'Placement':         r.placement         || '',
    'AI Explanation':    r.ai_explanation    || '',
    'AI Suggestion':     r.ai_recommendation || '',
  })), [recommendations])

  const conflictCsvRows = useMemo(() => conflicts.map(r => ({
    'Keyword':           r.keyword    || '',
    'Issue Type':        r.issue_type || '',
    'Severity':          r.severity   || '',
    'Locations':         Array.isArray(r.locations) ? r.locations.join(', ') : (r.locations || ''),
    'Impact':            r.impact         || '',
    'AI Suggestion':     r.recommendation || '',
  })), [conflicts])

  const patternCsvRows = useMemo(() => patterns.map(r => ({
    'Pattern':              r.pattern              || '',
    'Intent':               r.intent_category      || '',
    'Affected Terms':       Array.isArray(r.affected_terms) ? r.affected_terms.join(', ') : (r.affected_terms || ''),
    'Recommended Negative': r.recommended_negative || '',
    'Match Type':           r.match_type           || '',
  })), [patterns])

  const recColumns = [
    { key:'negative_keyword', label:'Negative Keyword', sortable:true, align:'left', width:200, wrap:true,
      format:(v,row) => <span style={{ fontWeight:600, color:'#c0392b' }}>{v}</span> },
    { key:'match_type',    label:'Match Type',    sortable:true, align:'center',
      format:v => <StatusBadge value={v} type="match"/> },
    { key:'intent_type',   label:'Intent',        sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_INTENT_COLORS}/> },
    { key:'priority',      label:'Priority',      sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_PRIORITY_COLORS}/> },
    { key:'confidence_score', label:'Confidence', sortable:true, align:'center',
      format:v => <NegConfidenceBar score={v}/> },
    { key:'waste_severity', label:'Waste',        sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_SEVERITY_COLORS}/> },
    { key:'blocking_safety', label:'Safety',      sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_SAFETY_COLORS}/> },
    { key:'estimated_savings', label:'Est. Savings', sortable:true, align:'center',
      format:v => <span style={{ fontWeight:700, color:'#2e7d32' }}>{v||'—'}</span> },
    { key:'placement',     label:'Placement',     sortable:true, align:'left', width:130,
      format:v => <span style={{ fontSize:11, color:'#555' }}>{v||'—'}</span> },
    { key:'ai_explanation', label:'AI Explanation', sortable:false, align:'left', width:200, wrap:true,
      format:v => <span style={{ fontSize:11, color:'#4a4a4a', lineHeight:1.6, whiteSpace:'normal', wordBreak:'break-word', display:'block' }}>{v||'—'}</span> },
    { key:'ai_recommendation', label:'AI Suggestion', sortable:false, align:'left', width:260, wrap:true,
      format:(v, row) => <NegRecCell rec={v||''} rowLoading={retryingRows.has(row._recIdx)} onRetry={() => retryRec(row._recIdx)}/> },
  ]

  const conflictColumns = [
    { key:'keyword',    label:'Keyword',    sortable:true, align:'left', width:220, wrap:true,
      format:v => <span style={{ fontWeight:600, color:'#1a3a6b' }}>{v}</span> },
    { key:'issue_type', label:'Issue Type', sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_ISSUE_COLORS}/> },
    { key:'severity',   label:'Severity',  sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_PRIORITY_COLORS}/> },
    { key:'locations',  label:'Locations', sortable:false, align:'left',
      format:v => <span style={{ fontSize:11, color:'#555' }}>{Array.isArray(v) ? v.join(', ') : v||'—'}</span> },
    { key:'impact',          label:'Impact',            sortable:false, align:'left', width:180, wrap:true,
      format:v => <span style={{ fontSize:11, color:'#4a4a4a', lineHeight:1.6, whiteSpace:'normal', wordBreak:'break-word', display:'block' }}>{v||'—'}</span> },
    { key:'recommendation',  label:'AI Suggestion', sortable:false, align:'left', width:240, wrap:true,
      format:v => <span style={{ fontSize:11, color:'#1a3a6b', fontWeight:500, lineHeight:1.6, whiteSpace:'normal', wordBreak:'break-word', display:'block' }}>{v ? highlightRecommendation(v) : '—'}</span> },
  ]

  const patternColumns = [
    { key:'pattern',          label:'Pattern',       sortable:true, align:'left',
      format:v => <span style={{ fontWeight:600, color:'#c0392b', fontFamily:'monospace', fontSize:12 }}>{v}</span> },
    { key:'intent_category',  label:'Intent',        sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_INTENT_COLORS}/> },
    { key:'affected_terms',   label:'Affected Terms', sortable:false, align:'left', width:200, wrap:true,
      format:v => <span style={{ fontSize:11, color:'#555', lineHeight:1.6, whiteSpace:'normal', wordBreak:'break-word', display:'block' }}>{Array.isArray(v) ? v.join(', ') : v||'—'}</span> },
    { key:'recommended_negative', label:'Recommended Negative', sortable:true, align:'left',
      format:v => <span style={{ fontWeight:600, color:'#c0392b' }}>{v||'—'}</span> },
    { key:'match_type',       label:'Match Type',    sortable:true, align:'center',
      format:v => <StatusBadge value={v} type="match"/> },
  ]

  const summaryCards = result ? [
    { label:'Est. Wasted Spend',   value: summary.estimated_monthly_wasted_spend || '—', color:'#c0392b' },
    { label:'Suggestions',         value: summary.total_recommendations ?? recommendations.length, color:'#1a3a6b' },
    { label:'Critical Issues',     value: summary.critical_issues ?? 0, color:'#e65100' },
    { label:'Duplicates Found',    value: summary.duplicates_found ?? conflicts.length, color:'#a56700' },
    { label:'Overblocking Risks',  value: summary.overblocking_risks ?? 0, color:'#880e4f' },
    { label:'Est. Monthly Savings',value: summary.estimated_monthly_savings || '—', color:'#2e7d32' },
  ] : []

  return (
    <Section title="🚫 Negative Keywords Optimizer">
      <PromptModal show={pm.showModal} context="negative" draft={pm.draftPrompt}
        onChangeDraft={pm.setDraftPrompt} onSave={pm.saveModal} onClose={pm.closeModal}/>

      {/* Trigger panel */}
      <div className="card-body" style={{ borderBottom:'1px solid #dde9f5' }}>
        <PromptModeBar promptMode={pm.promptMode} customPrompt={pm.customPrompt}
          onSetDefault={() => pm.setPromptMode('default')} onOpenModal={pm.openModal}/>
        <div style={{ fontSize:12, color:'#555', marginBottom:10 }}>
          Analyzes your keyword performance data and existing negative keywords to identify wasted spend, detect conflicts, and recommend strategic negatives.
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <button
            onClick={analyze}
            disabled={loading || !kwCount || (pm.promptMode === 'custom' && !pm.customPrompt.trim())}
            style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 18px',
              background: loading || !kwCount ? '#dde9f5' : '#c0392b',
              color: loading || !kwCount ? '#aaa' : '#fff',
              fontWeight:700, fontSize:13, borderRadius:6, border:'none',
              cursor: loading || !kwCount ? 'not-allowed' : 'pointer' }}
          >
            {loading && <Loader2 size={13} className="spin"/>}
            {loading ? 'Analysing…' : '🚫 Analyze & Optimize Negatives'}
          </button>
          <span style={{ fontSize:12, color:'#888' }}>
            {kwCount} keywords with spend{negCount > 0 ? ` · ${negCount} existing negatives` : ' · no existing negatives loaded'}
          </span>
        </div>
        {error && <div style={{ marginTop:8, fontSize:12, color:'#c0392b' }}>⚠ {error}</div>}
      </div>

      {/* Summary cards */}
      {result && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:0, borderBottom:'1px solid #dde9f5' }}>
          {summaryCards.map(({ label, value, color }) => (
            <div key={label} style={{ flex:'1 1 120px', padding:'14px 16px', borderRight:'1px solid #f0f4f8', textAlign:'center' }}>
              <div style={{ fontSize:20, fontWeight:700, color }}>{value}</div>
              <div style={{ fontSize:11, color:'#888', marginTop:3 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Inner tabs */}
      {result && (
        <>
          <div style={{ background:'#fff', borderBottom:'1px solid #dde9f5', padding:'0 16px', display:'flex', gap:0, alignItems:'center' }}>
            {NEG_INNER_TABS.map(t => {
              const count = t.id === 'recommendations' ? recommendations.length : t.id === 'conflicts' ? conflicts.length : patterns.length
              return (
                <button key={t.id} onClick={() => setInnerTab(t.id)}
                  style={{ padding:'10px 16px', fontSize:12, fontWeight: innerTab===t.id ? 700 : 500,
                    color: innerTab===t.id ? '#1a3a6b' : '#666', background:'none', border:'none',
                    cursor:'pointer', borderBottom: innerTab===t.id ? '2px solid #1a3a6b' : '2px solid transparent',
                    marginBottom:-1, display:'inline-flex', alignItems:'center', gap:6 }}>
                  {t.label}
                  {count > 0 && (
                    <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10,
                      background: innerTab===t.id ? '#1a3a6b' : '#e05c2a', color:'#fff' }}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
            <div style={{ marginLeft:'auto', paddingRight:4 }}>
              {innerTab === 'recommendations' && <ExportButton data={recCsvRows} filename="negative_recommendations.csv" label="Export CSV"/>}
              {innerTab === 'conflicts'       && <ExportButton data={conflictCsvRows} filename="negative_conflicts.csv" label="Export CSV"/>}
              {innerTab === 'patterns'        && <ExportButton data={patternCsvRows} filename="negative_patterns.csv" label="Export CSV"/>}
            </div>
          </div>

          {innerTab === 'recommendations' && (
            <ReportTable
              columns={recColumns}
              data={recommendations.map((r, i) => ({ ...r, _recIdx: i }))}
              noFilter
              resizable
              emptyMessage="No recommendations generated."
            />
          )}
          {innerTab === 'conflicts' && (
            <ReportTable
              columns={conflictColumns}
              data={conflicts}
              noFilter
              resizable
              emptyMessage="No duplicate or conflict issues detected."
            />
          )}
          {innerTab === 'patterns' && (
            <ReportTable
              columns={patternColumns}
              data={patterns}
              noFilter
              resizable
              emptyMessage="No recurring patterns detected."
            />
          )}
        </>
      )}
    </Section>
  )
}

function CpcOptimizerSection({ selectedAccount, existingKeywords = [] }) {
  const altPg = useGroupPagination()
  const [input,         setInput]         = useState('')
  const [results,       setResults]       = useState(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [sortCol,       setSortCol]       = useState(null)
  const [sortDir,       setSortDir]       = useState('asc')
  const [skipped,       setSkipped]       = useState(0)
  const [skippedRows,   setSkippedRows]   = useState([])
  const [skippedOpen,   setSkippedOpen]   = useState(false)
  const [publishRow,    setPublishRow]    = useState(null)
  const [publishedKeys, setPublishedKeys] = useState(new Set())
  const [targetCampaign, setTargetCampaign] = useState('')
  const [targetAdGroup,  setTargetAdGroup]  = useState('')
  const pm = usePromptMode()

  function markPublished(row) {
    setPublishedKeys(prev => new Set([...prev, `${row.keyword}|${row.matchType}`]))
  }

  // Strips match-type notation so comparisons work regardless of how the AI formats keywords
  const normalizeKw = s => (s || '').toLowerCase().trim()
    .replace(/^\[|\]$/g, '').replace(/^"|"$/g, '').replace(/^\+/g, '').trim()

  const enabledCampaignRows = useMemo(() =>
    (existingKeywords || []).filter(r => r.campaignStatus === 'Enabled')
  , [existingKeywords])

  const enabledRows = useMemo(() =>
    (existingKeywords || []).filter(r => r.campaignStatus === 'Enabled' && r.adGroupStatus === 'Enabled')
  , [existingKeywords])

  const accountCampaigns = useMemo(() =>
    [...new Set(enabledCampaignRows.map(r => r.campaign).filter(Boolean))].sort()
  , [enabledCampaignRows])

  // Every real campaign/ad-group pair — same deterministic routing check
  // the Keyword Planner uses, so CPC alternatives don't get misrouted either.
  const campaignAdGroupPairs = useMemo(() => {
    const seen = new Set(), pairs = []
    for (const r of enabledRows) {
      if (!r.campaign || !r.adGroup) continue
      const key = `${r.campaign}|${r.adGroup}`
      if (seen.has(key)) continue
      seen.add(key); pairs.push({ campaign: r.campaign, adGroup: r.adGroup })
    }
    return pairs
  }, [enabledRows])

  const targetAdGroups = useMemo(() => {
    const source = targetCampaign
      ? enabledRows.filter(r => r.campaign === targetCampaign)
      : enabledRows
    return [...new Set(source.map(r => r.adGroup).filter(Boolean))].sort()
  }, [enabledRows, targetCampaign])

  const existingKwSet = useMemo(() =>
    new Set((existingKeywords || []).map(r => normalizeKw(r.text)))
  , [existingKeywords])

  const existingKwMap = useMemo(() => {
    const map = new Map()
    for (const row of existingKeywords || []) {
      const key = normalizeKw(row.text)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(row)
    }
    return map
  }, [existingKeywords])

  function toggleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  function sortAlts(alts) {
    if (!sortCol) return alts
    const COMP_ORDER = { Low:1, Medium:2, High:3 }
    const STAGE_ORDER = { 'Ready To Buy':1, 'Comparing Options':2, 'Urgent Need':3 }
    const parseNum = s => { const m = String(s||'').replace(/,/g,'').match(/[\d.]+/); return m ? Number(m[0]) : 0 }
    const getVal = alt => {
      switch (sortCol) {
        case 'Alternative Keyword': return (alt.alternative || '').toLowerCase()
        case 'Match Type':          return (alt.matchType || '').toLowerCase()
        case 'Search Intent':       return (alt.searchIntent || '').toLowerCase()
        case 'Buyer Stage':         return STAGE_ORDER[alt.buyerStage] ?? 99
        case 'Searches/mo':         return parseNum(alt.monthlySearches)
        case 'Competition':         return COMP_ORDER[alt.competition] ?? 99
        case 'Est. CPC':            return parseNum(alt.estimatedCpc)
        case 'CPC Savings':         return parseNum(alt.estimatedSavings)
        case 'Conv. Score':         return Number(alt.conversionScore) || 0
        case 'Traffic':             return (alt.trafficPotential || '').toLowerCase()
        case 'Rec. Campaign / Ad Group': return (alt.adGroup || '').toLowerCase()
        default: return 0
      }
    }
    return [...alts].sort((a, b) => {
      const av = getVal(a), bv = getVal(b)
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sortDir === 'asc' ? cmp : -cmp
    })
  }

  function parseKeywords() {
    return input.split('\n')
      .map(line => line.trim()).filter(Boolean)
      .map(line => {
        const parts = line.split(/[,|]/)
        const keyword = (parts[0] || '').trim()
        const cpcRaw  = (parts[1] || '').replace(/[^0-9.]/g, '').trim()
        const cpc     = cpcRaw ? Number(cpcRaw).toFixed(2) : null
        return keyword ? { keyword, cpc } : null
      })
      .filter(Boolean)
  }

  async function optimize() {
    const keywords = parseKeywords()
    if (!keywords.length) return
    setLoading(true); setError(null); setResults(null); setSkipped(0); setSkippedRows([]); setSkippedOpen(false)
    try {
      const payload = { keywords }
      if (pm.activePrompt) payload.customPrompt = pm.activePrompt
      if (targetCampaign)           payload.selectedCampaign = targetCampaign
      else if (accountCampaigns.length) payload.existingCampaigns = accountCampaigns.slice(0, 30)
      if (targetAdGroup)            payload.selectedAdGroup  = targetAdGroup
      if (!targetCampaign && campaignAdGroupPairs.length) payload.campaignAdGroupPairs = campaignAdGroupPairs.slice(0, 300)
      const data = await window.electronAPI.cpcOptimize(payload)
      const raw     = Array.isArray(data) ? data : []
      const deduped = raw.filter(r => !existingKwSet.has(normalizeKw(r.alternative)))
      const seen = new Set()
      const removedDetails = raw
        .filter(r => existingKwSet.has(normalizeKw(r.alternative)))
        .flatMap(r => existingKwMap.get(normalizeKw(r.alternative)) || [])
        .filter(r => {
          const k = `${normalizeKw(r.text)}|${r.matchType}|${r.campaign}|${r.adGroup}`
          if (seen.has(k)) return false
          seen.add(k); return true
        })
      setSkipped(raw.length - deduped.length)
      setSkippedRows(removedDetails)
      setResults(deduped)
    } catch (err) {
      setError(err.message || 'Failed to get alternatives')
    } finally { setLoading(false) }
  }

  const grouped = useMemo(() => {
    if (!results) return {}
    return results.reduce((acc, r) => {
      const k = r.expensiveKeyword || 'Unknown'
      if (!acc[k]) acc[k] = { alts:[], analysis:null, campaignStructure:null, negKeywords:new Set() }
      acc[k].alts.push(r)
      if (!acc[k].analysis && r.analysis) acc[k].analysis = r.analysis
      if (!acc[k].campaignStructure && r.campaignStructure) acc[k].campaignStructure = r.campaignStructure
      ;(r.negativeKeywords || []).forEach(nk => acc[k].negKeywords.add(nk))
      return acc
    }, {})
  }, [results])

  const cpcCsvRows = useMemo(() => {
    const rows = []
    for (const [expKw, { alts }] of Object.entries(grouped)) {
      for (const alt of sortAlts(alts)) {
        rows.push({
          'Expensive Keyword':   expKw,
          'Alternative Keyword': alt.alternative      || '',
          'Match Type':          alt.matchType        || '',
          'Search Intent':       alt.searchIntent     || '',
          'Buyer Stage':         alt.buyerStage       || '',
          'Searches/mo':         alt.monthlySearches  || '',
          'Competition':         alt.competition      || '',
          'Est. CPC':            alt.estimatedCpc     || '',
          'CPC Savings':         alt.estimatedSavings || '',
          'Conv. Score':         alt.conversionScore  ?? '',
          'Traffic':             alt.trafficPotential || '',
          'Recommended Campaign': grouped[expKw]?.campaignStructure?.campaign_name || '',
          'Ad Group':            alt.adGroup          || '',
          'Why It Converts':     alt.whyItWorks       || '',
        })
      }
    }
    return rows
  }, [grouped, sortCol, sortDir])

  return (
    <Section title="💰 CPC Keyword Optimizer">
      {publishRow && selectedAccount && (
        <PublishKeywordModal
          row={publishRow}
          selectedAccount={selectedAccount}
          onClose={() => setPublishRow(null)}
          onSuccess={() => { markPublished(publishRow); setPublishRow(null) }}
        />
      )}
      <PromptModal show={pm.showModal} context="cpc" draft={pm.draftPrompt}
        onChangeDraft={pm.setDraftPrompt} onSave={pm.saveModal} onClose={pm.closeModal}/>

      {/* ── Input panel ── */}
      <div className="card-body" style={{ borderBottom:'1px solid #dde9f5' }}>
        <PromptModeBar promptMode={pm.promptMode} customPrompt={pm.customPrompt}
          onSetDefault={() => pm.setPromptMode('default')} onOpenModal={pm.openModal}/>

        {/* ── Campaign & Ad Group target selectors ── */}
        {accountCampaigns.length > 0 && (
          <div style={{ marginBottom:14, padding:'12px 14px', background:'#f0f4fb',
            border:'1px solid #dde9f5', borderRadius:7 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#1a3a6b', marginBottom:8, letterSpacing:0.3 }}>
              Target Campaign &amp; Ad Group
              <span style={{ fontSize:10, color:'#888', fontWeight:400, marginLeft:6 }}>
                — AI generates alternatives specifically for the selected context
              </span>
            </div>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                <label style={{ fontSize:10, fontWeight:600, color:'#555', letterSpacing:0.3, textTransform:'uppercase' }}>Campaign</label>
                <select
                  value={targetCampaign}
                  onChange={e => { setTargetCampaign(e.target.value); setTargetAdGroup('') }}
                  style={{ padding:'7px 12px', border:'1px solid #c8d9ed', borderRadius:6,
                    fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer',
                    background:'#fff', minWidth:220 }}
                >
                  <option value="">All Campaigns</option>
                  {accountCampaigns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                <label style={{ fontSize:10, fontWeight:600, color:'#555', letterSpacing:0.3, textTransform:'uppercase' }}>Ad Group</label>
                <select
                  value={targetAdGroup}
                  onChange={e => setTargetAdGroup(e.target.value)}
                  disabled={!targetCampaign}
                  style={{ padding:'7px 12px', border:'1px solid #c8d9ed', borderRadius:6,
                    fontSize:12, color: targetCampaign ? '#1a3a6b' : '#aaa', outline:'none',
                    cursor: targetCampaign ? 'pointer' : 'not-allowed',
                    background: targetCampaign ? '#fff' : '#f5f7fa', minWidth:200 }}
                >
                  <option value="">All Ad Groups</option>
                  {targetAdGroups.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              {(targetCampaign || targetAdGroup) && (
                <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                  <label style={{ fontSize:10, color:'transparent', letterSpacing:0.3 }}>_</label>
                  <button
                    onClick={() => { setTargetCampaign(''); setTargetAdGroup('') }}
                    style={{ padding:'7px 12px', fontSize:11, fontWeight:600, color:'#2563b0',
                      background:'none', border:'1px solid #dde9f5', borderRadius:6, cursor:'pointer' }}
                  >
                    Clear
                  </button>
                </div>
              )}
              {targetCampaign && (
                <div style={{ marginLeft:'auto', fontSize:11, color:'#2e7d32', fontWeight:500,
                  background:'#e8f5e9', border:'1px solid rgba(76,175,80,0.35)',
                  borderRadius:5, padding:'4px 10px', whiteSpace:'nowrap' }}>
                  ✓ Generating for: <strong>{targetCampaign}</strong>
                  {targetAdGroup && <> → <strong>{targetAdGroup}</strong></>}
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ fontSize:12, color:'#555', marginBottom:8 }}>
          Enter your expensive keywords — one per line. Optionally include the CPC:<br/>
          <code style={{ fontSize:11, background:'#f0f4f8', padding:'2px 6px', borderRadius:3 }}>
            plumber near me, $18.50
          </code>
        </div>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={'plumber near me, $18.50\nemergency electrician\nroof repair cost, $22.00'}
          rows={5}
          style={{ width:'100%', padding:'8px 12px', border:'1px solid #dde9f5', borderRadius:6,
            fontSize:12, color:'#1a3a6b', outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box' }}
        />
        <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:10 }}>
          <button
            onClick={optimize}
            disabled={loading || !input.trim()}
            style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 18px',
              background: loading || !input.trim() ? '#dde9f5' : '#e8a020',
              color:      loading || !input.trim() ? '#aaa'    : '#1a3a6b',
              fontWeight:700, fontSize:13, borderRadius:6, border:'none',
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer' }}
          >
            {loading && <Loader2 size={13} className="spin"/>}
            {loading ? 'Analysing…' : 'Find Cheaper Alternatives'}
          </button>
          {results && (
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:12, color:'#888' }}>
                {results.length} alternative{results.length !== 1 ? 's' : ''} found for{' '}
                {Object.keys(grouped).length} keyword{Object.keys(grouped).length !== 1 ? 's' : ''}
              </span>
              <ExportButton data={cpcCsvRows} filename="cpc_optimizer.csv" label="Export CSV"/>
            </div>
          )}
        </div>
        {error && <div style={{ marginTop:8, fontSize:12, color:'#c0392b' }}>⚠ {error}</div>}
        {skipped > 0 && (
          <div style={{ marginTop:8, border:'1px solid #f0b429', borderRadius:7, overflow:'hidden' }}>
            <div
              onClick={() => setSkippedOpen(o => !o)}
              style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 13px',
                background:'#fff8e1', cursor:'pointer', userSelect:'none' }}
            >
              <span style={{ fontSize:14, color:'#a56700', flexShrink:0 }}>⚠</span>
              <span style={{ fontSize:12, color:'#a56700', flex:1 }}>
                <strong>{skipped}</strong> alternative{skipped !== 1 ? 's' : ''} removed — already exist in your keyword list (adding them would create keyword crossover).
              </span>
              <span style={{ fontSize:11, fontWeight:700, color:'#a56700', whiteSpace:'nowrap',
                display:'flex', alignItems:'center', gap:4 }}>
                {skippedOpen ? '▲ Hide' : '▼ Show details'}
              </span>
            </div>
            {skippedOpen && skippedRows.length > 0 && (
              <div style={{ overflowX:'auto', borderTop:'1px solid #f0b429' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                  <thead>
                    <tr>
                      {[
                        ['Keyword',    'left'],
                        ['Match Type', 'center'],
                        ['Status',     'center'],
                        ['Campaign',   'left'],
                        ['Ad Group',   'left'],
                      ].map(([h, a]) => (
                        <th key={h} style={{ background:'#fff3cd', color:'#7a5000', padding:'7px 10px',
                          textAlign:a, fontSize:10, fontWeight:700, whiteSpace:'nowrap',
                          borderBottom:'1px solid #f0b429', position:'sticky', top:0 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {skippedRows.map((row, i) => {
                      const statusColor = kwStatusColor(row.status)
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#fffdf5' : '#fffbec' }}>
                          <td style={{ padding:'7px 10px', borderBottom:'1px solid #fdecc8',
                            fontWeight:600, color:'#1a3a6b', whiteSpace:'nowrap' }}>
                            {row.text}
                          </td>
                          <td style={{ padding:'7px 10px', borderBottom:'1px solid #fdecc8', textAlign:'center' }}>
                            <StatusBadge value={row.matchType} type="match"/>
                          </td>
                          <td style={{ padding:'7px 10px', borderBottom:'1px solid #fdecc8', textAlign:'center' }}>
                            <span style={{ fontSize:10, fontWeight:600, padding:'2px 6px', borderRadius:4,
                              background:`${statusColor}22`, color:statusColor,
                              border:`1px solid ${statusColor}55` }}>
                              {row.status || '—'}
                            </span>
                          </td>
                          <td style={{ padding:'7px 10px', borderBottom:'1px solid #fdecc8',
                            color:'#555', maxWidth:160, overflow:'hidden',
                            textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {row.campaign || '—'}
                          </td>
                          <td style={{ padding:'7px 10px', borderBottom:'1px solid #fdecc8',
                            color:'#555', maxWidth:160, overflow:'hidden',
                            textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {row.adGroup || '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {results && results.length === 0 && (
        <div style={{ padding:'24px 0', textAlign:'center', color:'#aaa', fontSize:13 }}>
          No alternatives returned. Try different keywords.
        </div>
      )}

      {Object.entries(grouped).map(([expKw, { alts, analysis, campaignStructure, negKeywords }]) => {
        const sortedAlts  = sortAlts(alts)
        const pageSize    = altPg.getPageSize(expKw)
        const page        = altPg.getPage(expKw)
        const pageStart   = page * pageSize
        const visibleAlts = sortedAlts.slice(pageStart, pageStart + pageSize)
        return (
        <div key={expKw} style={{ borderBottom:'2px solid #dde9f5' }}>

          {/* ── Seed keyword header ── */}
          <div style={{ padding:'10px 16px', background:'#fff8e1', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, fontWeight:700, color:'#a56700', padding:'2px 8px',
              background:'rgba(240,180,41,0.15)', borderRadius:4, border:'1px solid rgba(240,180,41,0.4)' }}>
              💸 Expensive
            </span>
            <span style={{ fontSize:14, fontWeight:700, color:'#1a3a6b' }}>{expKw}</span>
          </div>

          {/* ── AI Analysis panel ── */}
          {analysis && (
            <div style={{ padding:'12px 16px', background:'#f0f4fb', borderBottom:'1px solid #dde9f5' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#1a3a6b', letterSpacing:1,
                textTransform:'uppercase', marginBottom:8 }}>
                AI Analysis
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom: analysis.why_cpc_is_high ? 10 : 0 }}>
                {analysis.intent && (
                  <div style={{ background:'#fff', border:'1px solid #dde9f5', borderRadius:6, padding:'6px 12px' }}>
                    <div style={{ fontSize:9, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>Search Intent</div>
                    <ColorBadge value={analysis.intent} colorMap={INTENT_COLORS}/>
                  </div>
                )}
                {analysis.buyer_stage && (
                  <div style={{ background:'#fff', border:'1px solid #dde9f5', borderRadius:6, padding:'6px 12px' }}>
                    <div style={{ fontSize:9, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>Buyer Stage</div>
                    <ColorBadge value={analysis.buyer_stage} colorMap={STAGE_COLORS}/>
                  </div>
                )}
                {analysis.estimated_cpc_reduction && (
                  <div style={{ background:'#fff', border:'1px solid #dde9f5', borderRadius:6, padding:'6px 12px' }}>
                    <div style={{ fontSize:9, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>Est. CPC Reduction</div>
                    <span style={{ fontSize:13, fontWeight:700, color:'#2e7d32' }}>{analysis.estimated_cpc_reduction}</span>
                  </div>
                )}
              </div>
              {analysis.why_cpc_is_high && (
                <div style={{ fontSize:12, color:'#4a4a4a', background:'#fff', border:'1px solid #dde9f5',
                  borderRadius:6, padding:'8px 12px', lineHeight:1.6 }}>
                  <span style={{ fontWeight:600, color:'#a56700' }}>Why CPC is high: </span>
                  {analysis.why_cpc_is_high}
                </div>
              )}
            </div>
          )}

          {/* ── Alternatives table ── */}
          <div style={{ overflow:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr>
                  {[
                    ['Alternative Keyword', 'left',   160],
                    ['Match Type',          'center',   90],
                    ['Search Intent',       'center',  115],
                    ['Buyer Stage',         'center',  115],
                    ['Searches/mo',         'center',   85],
                    ['Competition',         'center',   88],
                    ['Est. CPC',            'center',   80],
                    ['CPC Savings',         'center',   88],
                    ['Conv. Score',         'center',   80],
                    ['Traffic',             'center',   95],
                    ['Rec. Campaign / Ad Group', 'left', 190],
                    ['Why It Converts',     'left',    220],
                    ['',                    'center',   80],
                  ].map(([l, a, w]) => {
                    const active = sortCol === l
                    const sortable = l !== 'Why It Converts' && l !== ''
                    return (
                      <th key={l}
                        onClick={sortable ? () => toggleSort(l) : undefined}
                        style={{ background: active ? '#0f2850' : '#1a3a6b', color:'#fff',
                          padding:'8px 10px', textAlign:a, fontSize:10, fontWeight:600,
                          whiteSpace:'nowrap', position:'sticky', top:0, zIndex:2, minWidth:w,
                          cursor: sortable ? 'pointer' : 'default',
                          userSelect:'none' }}>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:4, justifyContent: a === 'center' ? 'center' : 'flex-start' }}>
                          {renderHeaderLabel(l)}
                          {sortable && (
                            <span style={{ fontSize:9, opacity: active ? 1 : 0.35, lineHeight:1 }}>
                              {active ? (sortDir === 'asc' ? '▲' : '▼') : '⬍'}
                            </span>
                          )}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleAlts.map((alt, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f5f7fa' }}>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', fontWeight:600, color:'#2e7d32' }}>
                      {alt.alternative}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <StatusBadge value={alt.matchType} type="match"/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ColorBadge value={alt.searchIntent} colorMap={INTENT_COLORS}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ColorBadge value={alt.buyerStage} colorMap={STAGE_COLORS}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', color:'#555', fontSize:11 }}>
                      {alt.monthlySearches || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      {alt.competition && (
                        <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:4, whiteSpace:'nowrap',
                          background:`${COMPETITION_BADGE[alt.competition]||'#888'}22`,
                          color:      COMPETITION_BADGE[alt.competition]||'#888',
                          border:`1px solid ${COMPETITION_BADGE[alt.competition]||'#888'}44` }}>
                          {alt.competition}
                        </span>
                      )}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', fontWeight:600, color:'#1a3a6b', whiteSpace:'nowrap' }}>
                      {alt.estimatedCpc || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', fontWeight:700, color:'#2e7d32', whiteSpace:'nowrap' }}>
                      {alt.estimatedSavings || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ConvScore score={alt.conversionScore}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ColorBadge value={alt.trafficPotential} colorMap={TRAFFIC_COLORS}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', fontSize:11,
                      maxWidth:190, overflow:'hidden', textOverflow:'ellipsis' }}>
                      <div style={{ color:'#1a3a6b', fontWeight:600 }}>{campaignStructure?.campaign_name || '—'}</div>
                      <div style={{ color:'#2563b0', marginTop:2 }}>{alt.adGroup || '—'}</div>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', color:'#4a4a4a', lineHeight:1.5 }}>
                      {alt.whyItWorks || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      {publishedKeys.has(`${alt.alternative}|${alt.matchType}`) ? (
                        <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px',
                          fontSize:11, fontWeight:600, borderRadius:5, whiteSpace:'nowrap',
                          border:'1px solid #4caf50', background:'#e8f5e9', color:'#2e7d32' }}>
                          <Check size={11}/> Published
                        </span>
                      ) : (
                        <button
                          onClick={() => setPublishRow({ keyword: alt.alternative, matchType: alt.matchType, recommendedCampaign: campaignStructure?.campaign_name || '', adGroup: alt.adGroup })}
                          style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px',
                            fontSize:11, fontWeight:600, borderRadius:5, cursor:'pointer', whiteSpace:'nowrap',
                            border:'1px solid #1a3a6b', background:'#1a3a6b', color:'#fff' }}>
                          🚀 Proceed to Publish
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <GroupPaginationFooter
            page={page} pageSize={pageSize} total={sortedAlts.length}
            onPageChange={p => altPg.setPage(expKw, p)}
            onPageSizeChange={s => altPg.setPageSize(expKw, s)}
          />

          {/* ── Campaign structure + negative keywords ── */}
          {(campaignStructure || negKeywords.size > 0) && (
            <div style={{ display:'flex', flexWrap:'wrap', borderTop:'1px solid #f0f4f8', background:'#fafbfd' }}>
              {campaignStructure && (campaignStructure.campaign_name || campaignStructure.ad_groups?.length > 0) && (
                <div style={{ flex:'1 1 260px', padding:'12px 16px', borderRight:'1px solid #f0f4f8' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'#1a3a6b', letterSpacing:1,
                    textTransform:'uppercase', marginBottom:6 }}>
                    Campaign Structure
                  </div>
                  {campaignStructure.campaign_name && (
                    <div style={{ fontSize:11, fontWeight:700, color:'#1a3a6b', marginBottom:7 }}>
                      📁 {campaignStructure.campaign_name}
                    </div>
                  )}
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {(campaignStructure.ad_groups || []).map((ag, i) => (
                      <span key={i} style={{ fontSize:11, padding:'3px 9px', background:'#e3f2fd',
                        color:'#1565c0', border:'1px solid #2196f330', borderRadius:4, fontWeight:500 }}>
                        {ag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {negKeywords.size > 0 && (
                <div style={{ flex:'1 1 260px', padding:'12px 16px' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'#1a3a6b', letterSpacing:1,
                    textTransform:'uppercase', marginBottom:6 }}>
                    Suggested Negative Keywords
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {[...negKeywords].map((nk, i) => (
                      <span key={i} style={{ fontSize:11, padding:'3px 9px', background:'#ffebee',
                        color:'#b71c1c', border:'1px solid #f4433630', borderRadius:4, fontWeight:500 }}>
                        −{nk}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        )
      })}
    </Section>
  )
}

export default function AIKeywordPlannerTab({ selectedAccount, dateRange }) {
  const [rows,    setRows]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [negData,    setNegData]    = useState(null)
  const [negLoading, setNegLoading] = useState(false)
  const [negError,   setNegError]   = useState(null)

  useEffect(() => {
    if (!selectedAccount) return
    setLoading(true); setError(null); setRows(null)
    window.electronAPI.fetchReport({ customerId: selectedAccount.id, dateRange, reportType: 'keywords' })
      .then(setRows)
      .catch(err => setError(err.message || 'Failed to load keywords'))
      .finally(() => setLoading(false))
  }, [selectedAccount, dateRange])

  useEffect(() => {
    if (!selectedAccount) return
    setNegLoading(true); setNegError(null); setNegData(null)
    window.electronAPI.fetchExistingNegatives({ customerId: selectedAccount.id, dateRange })
      .then(setNegData)
      .catch(err => setNegError(err.message || 'Failed to load negative keywords'))
      .finally(() => setNegLoading(false))
  }, [selectedAccount, dateRange])

  if (loading && !rows) return <Spinner label="Loading keyword data…" />

  return (
    <div>
      {error && (
        <div style={{ padding:'12px 16px', background:'#fff5f5', border:'1px solid #ffd5cc', borderRadius:8, display:'flex', gap:8, marginBottom:20 }}>
          <span style={{ fontSize:13, color:'#c0392b' }}>{error}</span>
        </div>
      )}
      <KeywordPlannerSection selectedAccount={selectedAccount} existingKeywords={rows || []} />
      <CpcOptimizerSection selectedAccount={selectedAccount} existingKeywords={rows || []} />
      <NegativeKeywordsOptimizerSection rows={rows} negData={negData} />
    </div>
  )
}
