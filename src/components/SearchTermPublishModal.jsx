import React, { useState, useEffect } from 'react'
import { AlertTriangle, Loader2, Check } from 'lucide-react'

const MATCH_TYPES = ['Phrase', 'Exact', 'Broad']

// rows: [{ searchTerm, conversions?, phoneCalls? }] — publishes either as a
// positive keyword (into one ad group, or every ad group of a campaign) or as
// a negative keyword (direct, or via a new/existing negative keyword list).
//
// Match Type, Campaign, and Ad Group are editable PER ROW (mirroring Google
// Ads' own bulk "Add as negative keyword" screen) rather than one shared
// selection applied to every row — a batch of search terms routinely belongs
// to different campaigns/ad groups. The one exception is the Negative
// Keyword List path: a shared list attaches to a single campaign by nature,
// so that path keeps one campaign selector for the whole batch.
//
// initialKwType/initialMatchType/initialLevel/initialCampaignId/initialAdGroupId
// let the caller pre-select a recommendation (e.g. Audit's Search Terms tab)
// so every row starts pre-filled with what was already recommended — the
// user can still edit any row before publishing.
//
// lockKwType + removalByRow turn this into the "Switch K <-> NK" flow (All
// Search Terms): lockKwType fixes the destination type and hides the
// Keyword/Negative Keyword toggle (there's nothing to choose — the point is
// to flip to the OTHER type), and removalByRow carries, per row, every
// existing criterion resource name that already matches that search term
// (there can be more than one — e.g. a campaign-level negative AND a list
// negative both blocking the same term) so they can all be removed before
// the new one is created. onRemoved fires the moment removal succeeds —
// before creation is attempted — so the caller can drop the old K/NK badge
// immediately; if creation then fails, the row is left with no badge at all
// (its old criterion is genuinely gone) and the error is shown, rather than
// silently keeping a stale badge.
export default function SearchTermPublishModal({
  rows, selectedAccount, onClose, onSuccess, onRemoved,
  initialKwType = 'Keyword', initialMatchType = 'Phrase', initialLevel = 'Ad Group',
  initialCampaignId = '', initialAdGroupId = '',
  lockKwType = null, removalByRow = null,
}) {
  const [kwType,       setKwType]       = useState(lockKwType || initialKwType)
  const [level,        setLevel]        = useState(initialLevel)
  const [campaigns,    setCampaigns]    = useState([])
  const [campLoading,  setCampLoading]  = useState(true)
  const [listMode,     setListMode]     = useState('none')
  const [listName,     setListName]     = useState('')
  const [lists,        setLists]        = useState([])
  const [listId,       setListId]       = useState('')
  const [listsLoading, setListsLoading] = useState(false)
  const [publishing,   setPublishing]   = useState(false)
  const [error,        setError]        = useState(null)
  const [success,      setSuccess]      = useState(false)
  const [resolvedRows, setResolvedRows] = useState([])

  // Per-row editable target — each row gets its own campaign/ad group/match
  // type instead of one shared selection for the whole batch. Seeded from
  // whatever recommendation the row itself already carries (Audit's Search
  // Terms tab and Keywords' negative-recommendations table both attach a
  // per-term rec*/campaignId/adGroupId) — the caller's single initial*
  // props are only a fallback for rows with no recommendation of their own.
  const [rowConfig, setRowConfig] = useState(() => rows.map(r => {
    const campaignId = r.recCampaignId ?? r.campaignId ?? initialCampaignId
    const adGroupId  = r.recAdGroupId  ?? r.adGroupId  ?? initialAdGroupId
    // r.matchType is the Search Terms tab's own "Match Type" column (the
    // triggered keyword's match type) — falls in behind the two rec* fields
    // so a caller that already computed an explicit recommendation wins.
    const matchType  = r.recMatchType  ?? r.recommendedMatchType ?? r.matchType ?? initialMatchType
    return {
      campaignId: campaignId ? String(campaignId) : '',
      adGroupId:  adGroupId  ? String(adGroupId)  : '',
      matchType:  matchType || initialMatchType,
    }
  }))

  // Ad groups fetched per campaign and shared across every row that picks
  // that campaign — avoids re-fetching the same list once per row.
  const [agByCamp, setAgByCamp] = useState({}) // { [campaignId]: { loading, list } }

  // Single shared campaign — used only for the Negative Keyword List path,
  // where a list attaches to one campaign regardless of how many rows there are.
  const [campId, setCampId] = useState(initialCampaignId)

  const hasConversions = rows.some(r => (Number(r.conversions || 0) + Number(r.phoneCalls || 0)) > 0)
  const isBulk = rows.length > 1

  const needsAdGroup    = level === 'Ad Group'
  const showListOptions = kwType === 'Negative Keyword'
  // Whether targeting is driven by the per-row table (true) or the single
  // shared campaign selector used by the Negative Keyword List path (false).
  const usingRowConfig  = !showListOptions || listMode === 'none'

  useEffect(() => {
    window.electronAPI.rsaFetchCampaigns({ customerId: selectedAccount.id, hidePaused: true })
      .then(d => setCampaigns(d || []))
      .catch(e => setError(e.message))
      .finally(() => setCampLoading(false))
  }, [])

  useEffect(() => {
    if (kwType !== 'Negative Keyword') return
    setListsLoading(true)
    window.electronAPI.fetchNegativeKeywordLists({ customerId: selectedAccount.id })
      .then(d => { setLists(d || []) })
      .catch(e => setError(e.message))
      .finally(() => setListsLoading(false))
  }, [kwType])

  function ensureAdGroupsLoaded(campaignId) {
    if (!campaignId || agByCamp[campaignId]) return
    setAgByCamp(prev => ({ ...prev, [campaignId]: { loading: true, list: [] } }))
    window.electronAPI.rsaFetchAdGroups({ customerId: selectedAccount.id, campaignId })
      .then(d => setAgByCamp(prev => ({ ...prev, [campaignId]: { loading: false, list: d || [] } })))
      .catch(e => { setError(e.message); setAgByCamp(prev => ({ ...prev, [campaignId]: { loading: false, list: [] } })) })
  }

  // Preload ad groups for whichever campaign(s) rows already start on (from
  // the caller's recommendation) so the dropdowns aren't empty on open.
  useEffect(() => {
    if (!needsAdGroup) return
    const ids = new Set(rowConfig.map(r => r.campaignId).filter(Boolean))
    ids.forEach(ensureAdGroupsLoaded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAdGroup])

  function updateRow(idx, field, value) {
    setRowConfig(prev => prev.map((r, i) => {
      if (i !== idx) return r
      if (field === 'campaignId') return { ...r, campaignId: value, adGroupId: '' }
      return { ...r, [field]: value }
    }))
    if (field === 'campaignId' && needsAdGroup) ensureAdGroupsLoaded(value)
  }

  function setAllMatchType(m) {
    setRowConfig(prev => prev.map(r => ({ ...r, matchType: m })))
  }

  const canPublish = !publishing && (
    usingRowConfig
      ? rowConfig.every(r => !!r.campaignId && (!needsAdGroup || !!r.adGroupId))
      : !!campId && (listMode === 'new' ? !!listName.trim() : !!listId)
  )

  async function handlePublish() {
    if (!canPublish) return
    setPublishing(true); setError(null)
    const resolved = []
    try {
      if (removalByRow) {
        const toRemoveKeyword  = []
        const toRemoveCampaign = []
        const toRemoveAdGroup  = []
        const toRemoveList     = []
        for (const removal of removalByRow) {
          for (const m of (removal?.matches || [])) {
            if (!m.resourceName) continue
            if (m.level === 'keyword')          toRemoveKeyword.push(m.resourceName)
            else if (m.level === 'Campaign')    toRemoveCampaign.push(m.resourceName)
            else if (m.level === 'Ad Group')    toRemoveAdGroup.push(m.resourceName)
            else if (m.level === 'Campaign (List)') toRemoveList.push(m.resourceName)
          }
        }
        if (toRemoveKeyword.length)
          await window.electronAPI.keywordManagerBulkUpdateKeywords({ customerId: selectedAccount.id, keywords: toRemoveKeyword.map(rn => ({ resourceName: rn })), newStatus: 'Removed' })
        if (toRemoveCampaign.length)
          await window.electronAPI.removeCampaignLevelNegatives({ customerId: selectedAccount.id, resourceNames: toRemoveCampaign })
        if (toRemoveAdGroup.length)
          await window.electronAPI.removeAdGroupLevelNegatives({ customerId: selectedAccount.id, resourceNames: toRemoveAdGroup })
        if (toRemoveList.length)
          await window.electronAPI.removeSharedListNegatives({ customerId: selectedAccount.id, resourceNames: toRemoveList })
        // The old criteria are genuinely gone in Google Ads at this point —
        // tell the caller now, before creation, so a later creation failure
        // (caught below) can't leave a stale K/NK badge on screen.
        onRemoved?.(rows)
      }
      if (usingRowConfig) {
        if (kwType === 'Keyword') {
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i], cfg = rowConfig[i]
            if (level === 'Campaign') {
              // Edge case (Keyword type is normally locked to Ad Group level
              // in this UI) — publish to every ad group in this row's campaign.
              let ags = agByCamp[cfg.campaignId]?.list
              if (!ags) ags = await window.electronAPI.rsaFetchAdGroups({ customerId: selectedAccount.id, campaignId: cfg.campaignId }).catch(() => [])
              for (const ag of ags) {
                await window.electronAPI.publishKeyword({ customerId: selectedAccount.id, adGroupId: ag.id, keywordText: r.searchTerm, matchType: cfg.matchType })
                resolved.push({ searchTerm: r.searchTerm, matchType: cfg.matchType, campaignName: campaigns.find(c => c.id === cfg.campaignId)?.name, adGroupName: ag.name })
              }
            } else {
              await window.electronAPI.publishKeyword({ customerId: selectedAccount.id, adGroupId: cfg.adGroupId, keywordText: r.searchTerm, matchType: cfg.matchType })
              resolved.push({
                searchTerm: r.searchTerm, matchType: cfg.matchType,
                campaignName: campaigns.find(c => c.id === cfg.campaignId)?.name,
                adGroupName: agByCamp[cfg.campaignId]?.list.find(a => a.id === cfg.adGroupId)?.name,
              })
            }
          }
        } else if (level === 'Ad Group') {
          const byAdGroup = {}
          rows.forEach((r, i) => {
            const cfg = rowConfig[i]
            ;(byAdGroup[cfg.adGroupId] ||= []).push({ text: r.searchTerm, matchType: cfg.matchType })
          })
          for (const [adGroupId, keywords] of Object.entries(byAdGroup)) {
            await window.electronAPI.publishNegativesToAdGroup({ customerId: selectedAccount.id, adGroupId, keywords })
          }
          rows.forEach((r, i) => {
            const cfg = rowConfig[i]
            resolved.push({
              searchTerm: r.searchTerm, matchType: cfg.matchType,
              campaignName: campaigns.find(c => c.id === cfg.campaignId)?.name,
              adGroupName: agByCamp[cfg.campaignId]?.list.find(a => a.id === cfg.adGroupId)?.name,
            })
          })
        } else {
          const byCampaign = {}
          rows.forEach((r, i) => {
            const cfg = rowConfig[i]
            ;(byCampaign[cfg.campaignId] ||= []).push({ text: r.searchTerm, matchType: cfg.matchType })
          })
          for (const [campaignId, keywords] of Object.entries(byCampaign)) {
            await window.electronAPI.publishNegativesToCampaign({ customerId: selectedAccount.id, campaignId, listMode: 'none', keywords })
          }
          rows.forEach((r, i) => {
            const cfg = rowConfig[i]
            resolved.push({ searchTerm: r.searchTerm, matchType: cfg.matchType, campaignName: campaigns.find(c => c.id === cfg.campaignId)?.name, adGroupName: null })
          })
        }
      } else {
        const keywords = rows.map((r, i) => ({ text: r.searchTerm, matchType: rowConfig[i]?.matchType || initialMatchType }))
        await window.electronAPI.publishNegativesToCampaign({
          customerId: selectedAccount.id, campaignId: campId,
          listMode, listName: listMode === 'new' ? listName.trim() : undefined,
          sharedSetId: listMode === 'existing' ? listId : undefined, keywords,
        })
        const campName = campaigns.find(c => c.id === campId)?.name
        rows.forEach((r, i) => resolved.push({ searchTerm: r.searchTerm, matchType: rowConfig[i]?.matchType || initialMatchType, campaignName: campName, adGroupName: null }))
      }
      setResolvedRows(resolved)
      setSuccess(true)
    } catch(e) { setError(e.message) }
    finally { setPublishing(false) }
  }

  const selStyle    = { width:'100%', padding:'8px 10px', border:'1px solid #dde9f5', borderRadius:6, fontSize:13, color:'#1a3a6b', outline:'none', background:'#fff' }
  const rowSelStyle = { width:'100%', padding:'5px 7px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', background:'#fff' }
  const thStyle     = { padding:'7px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:0.4, whiteSpace:'nowrap' }
  const tdStyle     = { padding:'6px 10px', verticalAlign:'middle' }
  const toggleBtn = active => ({
    padding:'7px 18px', fontSize:12, fontWeight:600, borderRadius:6, cursor:'pointer',
    border:`1.5px solid ${active ? '#1a3a6b' : '#dde9f5'}`,
    background: active ? '#1a3a6b' : '#fff', color: active ? '#fff' : '#555',
  })

  const modalMaxWidth = usingRowConfig ? (needsAdGroup ? 900 : 680) : 500

  if (success) {
    const first = resolvedRows[0]
    const destinationCount = new Set(resolvedRows.map(r => r.adGroupName || r.campaignName)).size
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', borderRadius:12, padding:36, maxWidth:440, width:'92%', textAlign:'center', boxShadow:'0 8px 40px rgba(0,0,0,0.2)' }}>
          <Check size={48} color="#2e7d32" style={{ marginBottom:12 }}/>
          <div style={{ fontSize:18, fontWeight:700, color:'#1a3a6b', marginBottom:8 }}>
            {lockKwType
              ? (isBulk ? `${rows.length} Terms Switched!` : 'Switched!')
              : (isBulk ? `${rows.length} Terms Published!` : 'Published!')}
          </div>
          <div style={{ fontSize:13, color:'#555', marginBottom:20, lineHeight:1.6 }}>
            {isBulk ? <><strong>{rows.length} search terms</strong></> : <><strong>"{rows[0]?.searchTerm}"</strong></>}
            {' '}{lockKwType ? 'switched to' : 'added as'} <strong>{kwType}</strong>
            {!isBulk && first && (
              <> ({first.matchType} match) to {first.adGroupName ? <>ad group <strong>{first.adGroupName}</strong></> : <>campaign <strong>{first.campaignName}</strong></>}</>
            )}
            {isBulk && (
              <> across <strong>{destinationCount}</strong> destination{destinationCount !== 1 ? 's' : ''}</>
            )}
          </div>
          <button onClick={() => (onSuccess ? onSuccess({ kwType, rows: resolvedRows }) : onClose())}
            style={{ padding:'8px 28px', background:'#1a3a6b', color:'#fff', border:'none', borderRadius:6, fontWeight:700, fontSize:13, cursor:'pointer' }}>
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:12, padding:28, maxWidth:modalMaxWidth, width:'94%', boxShadow:'0 8px 40px rgba(0,0,0,0.2)', maxHeight:'90vh', overflowY:'auto' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:18 }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:'#1a3a6b' }}>
              {lockKwType
                ? <>Switch {isBulk ? `${rows.length} Search Terms` : 'Search Term'} to {lockKwType}</>
                : <>Publish {isBulk ? `${rows.length} Search Terms` : 'Search Term'}</>}
            </div>
            {!isBulk && <div style={{ fontSize:12, color:'#888', marginTop:3 }}>"{rows[0]?.searchTerm}"</div>}
          </div>
          <button onClick={onClose} style={{ fontSize:22, color:'#aaa', background:'none', border:'none', cursor:'pointer', lineHeight:1, marginLeft:12 }}>×</button>
        </div>

        {/* Bulk terms preview — only for the List path, where the per-row table below isn't shown */}
        {isBulk && !usingRowConfig && (
          <div style={{ marginBottom:16, background:'#f5f7fa', border:'1px solid #dde9f5', borderRadius:7, padding:'8px 12px', maxHeight:90, overflowY:'auto' }}>
            {rows.map((r, i) => (
              <div key={i} style={{ fontSize:12, color:'#1a3a6b', padding:'2px 0', display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontWeight:500 }}>{r.searchTerm}</span>
                {(Number(r.conversions||0) + Number(r.phoneCalls||0)) > 0 && (
                  <span style={{ fontSize:10, background:'#fff3e0', color:'#e65100', border:'1px solid #ff9800', borderRadius:99, padding:'1px 6px' }}>Has conv.</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Keyword Type — hidden in switch mode: lockKwType already fixes the
            destination, there's nothing to choose (the whole point is to
            flip to the OTHER type). */}
        {!lockKwType && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Keyword Type</div>
            <div style={{ display:'flex', gap:8 }}>
              <button style={toggleBtn(kwType==='Keyword')} onClick={() => { setKwType('Keyword'); setLevel('Ad Group') }}>Keyword</button>
              <button
                onClick={() => setKwType('Negative Keyword')}
                style={{
                  ...toggleBtn(kwType==='Negative Keyword'),
                  ...(hasConversions && kwType === 'Negative Keyword'
                    ? { background:'#ff9800', border:'1.5px solid #e65100', color:'#fff' }
                    : hasConversions
                      ? { border:'1.5px solid #ff9800', color:'#a56700' }
                      : {}),
                }}>
                {hasConversions ? '⚠ Negative Keyword' : 'Negative Keyword'}
              </button>
            </div>
          </div>
        )}

        {/* Conversion warning — only when Negative Keyword is selected */}
        {hasConversions && kwType === 'Negative Keyword' && (
          <div style={{ background:'#fff3e0', border:'1px solid #ff9800', borderRadius:7, padding:'10px 14px', marginBottom:16, display:'flex', gap:10, alignItems:'flex-start' }}>
            <AlertTriangle size={15} color="#e65100" style={{ flexShrink:0, marginTop:1 }}/>
            <div style={{ fontSize:12, color:'#bf360c', lineHeight:1.55 }}>
              <strong>Caution:</strong> {isBulk ? 'One or more selected terms have' : 'This search term has'} recorded conversions.
              Adding it as a Negative Keyword could block valuable converting traffic. Review carefully before publishing.
            </div>
          </div>
        )}

        {/* Level */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Add To Level</div>
          <div style={{ display:'flex', gap:8 }}>
            <button
              disabled={kwType === 'Keyword'}
              style={{
                ...toggleBtn(level==='Campaign'),
                ...(kwType === 'Keyword' ? { opacity:0.4, cursor:'not-allowed' } : {}),
              }}
              onClick={() => kwType !== 'Keyword' && setLevel('Campaign')}
            >Campaign</button>
            <button style={toggleBtn(level==='Ad Group')} onClick={() => { setLevel('Ad Group'); setListMode('none') }}>Ad Group</button>
          </div>
        </div>

        {/* Per-row targeting table — Match Type, Campaign, and (if needed) Ad Group editable per search term */}
        {usingRowConfig ? (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>
              Search Terms — Match Type, Campaign{needsAdGroup ? ' & Ad Group' : ''}
            </div>
            <div style={{ border:'1px solid #dde9f5', borderRadius:8, overflow:'hidden' }}>
              <div style={{ overflowX:'auto', maxHeight: isBulk ? 340 : undefined, overflowY: isBulk ? 'auto' : undefined }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'#f5f7fa', position: isBulk ? 'sticky' : 'static', top:0 }}>
                      <th style={thStyle}>Search Term</th>
                      <th style={{ ...thStyle, width:110 }}>Match Type</th>
                      <th style={{ ...thStyle, minWidth:180 }}>Campaign</th>
                      {needsAdGroup && <th style={{ ...thStyle, minWidth:180 }}>Ad Group</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const cfg = rowConfig[i]
                      const agState = agByCamp[cfg.campaignId]
                      return (
                        <tr key={i} style={{ borderTop:'1px solid #eef2f7' }}>
                          <td style={tdStyle}>
                            <span style={{ fontWeight:500, color:'#1a3a6b' }}>{r.searchTerm}</span>
                            {(Number(r.conversions||0) + Number(r.phoneCalls||0)) > 0 && (
                              <span title="Has recorded conversions" style={{ marginLeft:6, fontSize:9, fontWeight:700, background:'#fff3e0', color:'#e65100', border:'1px solid #ff9800', borderRadius:99, padding:'1px 5px' }}>conv.</span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            <select value={cfg.matchType} onChange={e => updateRow(i, 'matchType', e.target.value)} style={rowSelStyle}>
                              {MATCH_TYPES.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </td>
                          <td style={tdStyle}>
                            {campLoading
                              ? <span style={{ fontSize:11, color:'#aaa' }}>Loading…</span>
                              : <select value={cfg.campaignId} onChange={e => updateRow(i, 'campaignId', e.target.value)} style={rowSelStyle}>
                                  <option value="">Select…</option>
                                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            }
                          </td>
                          {needsAdGroup && (
                            <td style={tdStyle}>
                              {!cfg.campaignId
                                ? <span style={{ fontSize:11, color:'#aaa' }}>Select campaign</span>
                                : agState?.loading
                                  ? <span style={{ fontSize:11, color:'#aaa' }}>Loading…</span>
                                  : <select value={cfg.adGroupId} onChange={e => updateRow(i, 'adGroupId', e.target.value)} style={rowSelStyle}>
                                      <option value="">Select…</option>
                                      {(agState?.list || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                    </select>
                              }
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Match Type — shared across the batch for the List path, where per-row targets don't apply */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Match Type</div>
              <div style={{ display:'flex', gap:8 }}>
                {MATCH_TYPES.map(m => (
                  <button key={m} style={toggleBtn(rowConfig[0]?.matchType===m)} onClick={() => setAllMatchType(m)}>{m}</button>
                ))}
              </div>
            </div>

            {/* Campaign — single shared target for the List path */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>Campaign</div>
              {campLoading
                ? <div style={{ fontSize:12, color:'#aaa' }}>Loading campaigns…</div>
                : <select value={campId} onChange={e => setCampId(e.target.value)} style={selStyle}>
                    <option value="">Select campaign…</option>
                    {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
              }
            </div>
          </>
        )}

        {/* Negative Keyword list options — shown for both Campaign and Ad Group levels */}
        {showListOptions && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Negative Keyword List</div>
            {listsLoading
              ? <div style={{ fontSize:12, color:'#aaa' }}>Loading lists…</div>
              : <>
                  <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' }}>
                    <button style={toggleBtn(listMode==='none')} onClick={() => setListMode('none')}>Add without List</button>
                    <button
                      disabled={level === 'Ad Group'}
                      style={{ ...toggleBtn(listMode==='new'), ...(level === 'Ad Group' ? { opacity:0.4, cursor:'not-allowed' } : {}) }}
                      onClick={() => level !== 'Ad Group' && setListMode('new')}
                    >New List</button>
                    {lists.length > 0 && (
                      <button
                        disabled={level === 'Ad Group'}
                        style={{ ...toggleBtn(listMode==='existing'), ...(level === 'Ad Group' ? { opacity:0.4, cursor:'not-allowed' } : {}) }}
                        onClick={() => level !== 'Ad Group' && setListMode('existing')}
                      >Existing List</button>
                    )}
                  </div>
                  {level === 'Ad Group' && (
                    <div style={{ fontSize:12, color:'#7a5c00', background:'#fffbea', border:'1px solid #f0c040', borderRadius:6, padding:'8px 12px', marginBottom:8 }}>
                      ⚠ Google Ads negative keyword lists only attach at the campaign level. These keywords will be added directly to each selected ad group instead.
                    </div>
                  )}
                  {level !== 'Ad Group' && listMode === 'new' && (
                    <input value={listName} onChange={e => setListName(e.target.value)}
                      placeholder="Enter new list name…" style={selStyle}/>
                  )}
                  {level !== 'Ad Group' && listMode === 'existing' && (
                    <select value={listId} onChange={e => setListId(e.target.value)} style={selStyle}>
                      <option value="">Select list…</option>
                      {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  )}
                </>
            }
          </div>
        )}

        {error && (
          <div style={{ marginBottom:14, fontSize:12, color:'#c0392b', background:'#fdecea', border:'1px solid #e05c2a', borderRadius:6, padding:'8px 12px' }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:6 }}>
          <button onClick={onClose}
            style={{ padding:'8px 20px', fontSize:13, border:'1px solid #dde9f5', borderRadius:6, background:'#fff', color:'#555', cursor:'pointer', fontWeight:600 }}>
            Cancel
          </button>
          <button onClick={handlePublish} disabled={!canPublish}
            style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 22px', fontSize:13, fontWeight:700,
              border:'none', borderRadius:6, cursor: canPublish ? 'pointer' : 'not-allowed',
              background: canPublish ? '#1a3a6b' : '#dde9f5', color: canPublish ? '#fff' : '#aaa' }}>
            {publishing && <Loader2 size={13} className="spin"/>}
            {lockKwType
              ? (publishing ? 'Switching…' : `Switch${isBulk ? ` ${rows.length} Terms` : ''}`)
              : (publishing ? 'Publishing…' : `Publish${isBulk ? ` ${rows.length} Terms` : ''}`)}
          </button>
        </div>
      </div>
    </div>
  )
}
