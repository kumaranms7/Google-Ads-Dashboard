import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import StatusBadge from './StatusBadge.jsx'

// ── Search term "already added" signal ────────────────────────────────────────
// Shared by every page that lists search terms/recommendations and needs to
// flag a term that's already a keyword or negative keyword IN THE SAME
// CAMPAIGN/AD GROUP the search term itself belongs to (not just anywhere in
// the account — the same text could be a keyword in one ad group and
// completely unrelated to a search term that happened to trigger a different
// ad group), so it shows a badge instead of a selectable checkbox, and
// clicking the badge shows which keyword/negative(s) it already matches.
export const normalizeKw = s => (s || '').toLowerCase().trim().replace(/^\[|\]$/g, '').replace(/^"|"$/g, '').replace(/^\+/g, '').trim()

// Keywords always live at the ad group level, so the match key is
// text|campaign|adGroup. Maps to an array since the same text could
// theoretically appear more than once (different match types).
export function buildKwMap(existingKeywords) {
  const map = new Map()
  for (const k of existingKeywords || []) {
    if (k.status === 'Removed') continue
    const key = `${normalizeKw(k.text)}|${k.campaign}|${k.adGroup}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(k)
  }
  return map
}
// Negatives can live at Ad Group level (only blocks that one ad group) or at
// Campaign / Campaign (List) level (blocks the entire campaign, every ad
// group in it) — so they need two separate lookups: one scoped to
// text|campaign|adGroup, one scoped to just text|campaign.
export function buildNegMaps(existingNegatives) {
  const adGroupMap = new Map()
  const campaignMap = new Map()
  for (const n of existingNegatives || []) {
    if (n.status === 'Removed') continue
    const t = normalizeKw(n.text)
    if (n.level === 'Ad Group') {
      const key = `${t}|${n.campaign}|${n.adGroup}`
      if (!adGroupMap.has(key)) adGroupMap.set(key, [])
      adGroupMap.get(key).push(n)
    } else {
      const key = `${t}|${n.campaign}`
      if (!campaignMap.has(key)) campaignMap.set(key, [])
      campaignMap.get(key).push(n)
    }
  }
  return { adGroupMap, campaignMap }
}
// Resolves a search term (scoped to its own campaign/ad group) against the
// keyword and negative maps — returns { status, matches } or null.
export function resolveKwSignal(term, campaign, adGroup, kwMap, negMaps) {
  const t = normalizeKw(term)
  const kwKey = `${t}|${campaign}|${adGroup}`
  if (kwMap.has(kwKey)) return { status: 'keyword', matches: kwMap.get(kwKey) }
  const negAgKey = `${t}|${campaign}|${adGroup}`
  if (negMaps.adGroupMap.has(negAgKey)) return { status: 'negative', matches: negMaps.adGroupMap.get(negAgKey) }
  const negCampKey = `${t}|${campaign}`
  if (negMaps.campaignMap.has(negCampKey)) return { status: 'negative', matches: negMaps.campaignMap.get(negCampKey) }
  return null
}

// After a successful search-term publish, builds the keyword/negative
// records to insert into local state right away. Waiting for a full reload
// instead isn't reliable here — the keyword report this page otherwise uses
// is stats-based, and Google Ads can take a while to surface a brand-new
// keyword in it even though the keyword itself was created immediately.
//
// `rows` here is SearchTermPublishModal's resolved-per-row list — each entry
// already carries its own matchType/campaignName/adGroupName, since a single
// publish batch can now target different campaigns/ad groups/match types per
// row rather than one shared target for the whole batch.
export function buildOptimisticPublishRecords({ kwType, rows }) {
  const keywords  = []
  const negatives = []
  for (const r of (rows || [])) {
    if (kwType === 'Keyword') {
      keywords.push({
        text: r.searchTerm, matchType: r.matchType, status: 'Enabled',
        campaign: r.campaignName || '—', campaignStatus: 'Enabled',
        adGroup: r.adGroupName || '—', adGroupStatus: 'Enabled',
        impressions: 0, clicks: 0, cost: 0, conversions: 0, phoneCalls: 0,
        phoneConversions: 0, formConversions: 0, cpc: 0, ctr: 0, qualityScore: 0,
      })
    } else {
      negatives.push({
        text: r.searchTerm, matchType: r.matchType, status: 'Enabled',
        campaign: r.campaignName || '—', campaignStatus: 'Enabled',
        adGroup: r.adGroupName || '—', level: r.adGroupName ? 'Ad Group' : 'Campaign',
      })
    }
  }
  return { keywords, negatives }
}

export function KwSignalBadge({ status, onClick }) {
  const isKw = status === 'keyword'
  const style = isKw
    ? { background:'#e8f5e9', color:'#2e7d32', border:'1px solid #4caf50' }
    : { background:'#fdecea', color:'#c62828', border:'1px solid #e05c2a' }
  return (
    <button
      onClick={onClick}
      title={`Already added as a ${isKw ? 'keyword' : 'negative keyword'} — click for details`}
      style={{ ...style, display:'inline-block', borderRadius:99, padding:'2px 8px', fontSize:10, fontWeight:700, cursor:'pointer' }}
    >
      {isKw ? 'K' : 'NK'}
    </button>
  )
}

// Inline Pause/Remove for a positive keyword that's contradicting a
// negative-keyword recommendation (the term is being recommended to block,
// but is already allowed as a keyword — almost always a mistake).
export function KeywordRowAction({ resourceName, selectedAccount, onChanged }) {
  const [mode,  setMode]  = useState(null) // null | 'confirmPause' | 'confirmRemove'
  const [busy,  setBusy]  = useState(false)
  const [done,  setDone]  = useState(null) // 'Paused' | 'Removed'
  const [error, setError] = useState(null)

  if (!resourceName || !selectedAccount) return null
  if (done) return <span style={{ fontSize:11, color:'#888' }}>{done}</span>
  if (busy) return <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:11, color:'#888' }}><Loader2 size={11} className="spin"/> Working…</span>

  async function run(newStatus) {
    setBusy(true); setError(null)
    try {
      await window.electronAPI.keywordManagerUpdateKeyword({ customerId: selectedAccount.id, resourceName, newStatus })
      setDone(newStatus)
      onChanged?.(resourceName, newStatus)
    } catch (e) {
      setError(e.message || `Failed to ${newStatus === 'Removed' ? 'remove' : 'pause'} keyword`)
    } finally {
      setBusy(false); setMode(null)
    }
  }

  if (mode) {
    return (
      <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
        <span style={{ fontSize:11, color:'#c0392b', fontWeight:600 }}>{mode === 'confirmPause' ? 'Pause?' : 'Remove?'}</span>
        <button onClick={() => run(mode === 'confirmPause' ? 'Paused' : 'Removed')}
          style={{ fontSize:11, fontWeight:600, padding:'3px 9px', background:'#c0392b', color:'#fff', border:'none', borderRadius:4, cursor:'pointer' }}>
          Yes
        </button>
        <button onClick={() => setMode(null)}
          style={{ fontSize:11, padding:'3px 9px', background:'none', color:'#888', border:'1px solid #dde9f5', borderRadius:4, cursor:'pointer' }}>
          Cancel
        </button>
      </span>
    )
  }

  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
      <button onClick={() => setMode('confirmPause')}
        style={{ fontSize:11, fontWeight:600, padding:'3px 9px', background:'#fff', color:'#a56700', border:'1px solid #f0b429', borderRadius:4, cursor:'pointer' }}>
        Pause
      </button>
      <button onClick={() => setMode('confirmRemove')}
        style={{ fontSize:11, fontWeight:600, padding:'3px 9px', background:'#fff', color:'#c0392b', border:'1px solid #e05c2a', borderRadius:4, cursor:'pointer' }}>
        Remove
      </button>
      {error && <span style={{ fontSize:10, color:'#c0392b' }}>{error}</span>}
    </span>
  )
}

// selectedAccount/allowKeywordActions/onKeywordChanged are only needed when
// a "K" match is a real contradiction (recommended to block, but already
// allowed) worth fixing right from here.
export function KwSignalModal({ signal, onClose, selectedAccount, allowKeywordActions, onKeywordChanged }) {
  if (!signal) return null
  const isKw = signal.status === 'keyword'
  const showActions = isKw && allowKeywordActions
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9999,
      display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:10, width:640, maxWidth:'92vw', maxHeight:'80vh',
        display:'flex', flexDirection:'column', boxShadow:'0 8px 40px rgba(0,0,0,0.22)' }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #dde9f5',
          display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#1a3a6b' }}>
            {isKw ? 'Existing Keyword' : 'Existing Negative Keyword'}{signal.matches.length > 1 ? `s (${signal.matches.length})` : ''}
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#aaa', fontSize:18, lineHeight:1, padding:4 }}>✕</button>
        </div>
        {showActions && (
          <div style={{ padding:'8px 20px', fontSize:11, color:'#a56700', background:'#fff8e6', borderBottom:'1px solid #ffe0b2', flexShrink:0 }}>
            ⚠ This term is recommended to block as a negative, but it's already an active keyword below — pause or remove it if that was a mistake.
          </div>
        )}
        <div style={{ overflow:'auto', padding:'12px 20px' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                {['Keyword', 'Match Type', 'Status', 'Campaign', 'Ad Group', ...(showActions ? ['Action'] : [])].map(h => (
                  <th key={h} style={{ padding:'7px 8px', textAlign:'left', fontSize:10, fontWeight:700,
                    color:'#fff', background:'#1a3a6b', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {signal.matches.map((m, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f5f7fa' }}>
                  <td style={{ padding:'7px 8px', borderBottom:'1px solid #f0f4f8', fontWeight:600, color:'#1a3a6b' }}>{m.text}</td>
                  <td style={{ padding:'7px 8px', borderBottom:'1px solid #f0f4f8' }}><StatusBadge value={m.matchType} type="match"/></td>
                  <td style={{ padding:'7px 8px', borderBottom:'1px solid #f0f4f8' }}><StatusBadge value={m.status}/></td>
                  <td style={{ padding:'7px 8px', borderBottom:'1px solid #f0f4f8', color:'#4a4a4a' }}>{m.campaign || '—'}</td>
                  <td style={{ padding:'7px 8px', borderBottom:'1px solid #f0f4f8', color:'#4a4a4a' }}>{m.adGroup || '—'}</td>
                  {showActions && (
                    <td style={{ padding:'7px 8px', borderBottom:'1px solid #f0f4f8' }}>
                      <KeywordRowAction resourceName={m.resourceName} selectedAccount={selectedAccount} onChanged={onKeywordChanged} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
