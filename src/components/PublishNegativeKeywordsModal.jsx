import React, { useState, useEffect } from 'react'
import { Loader2, Check, AlertCircle, Info } from 'lucide-react'
import StatusBadge from './StatusBadge.jsx'

const MATCH_COLOR = {
  Broad:  { bg: '#e3f2fd', text: '#1565c0', border: '#3a8fd1' },
  Phrase: { bg: '#e8eaf6', text: '#283593', border: '#2563b0' },
  Exact:  { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' },
}

export default function PublishNegativeKeywordsModal({ rows, selectedAccount, onClose, onSuccess }) {
  // rows: [{ term, recommendedMatchType, ... }]
  const [addTo, setAddTo] = useState('campaign') // 'campaign' | 'adGroup'

  const [campaigns,   setCampaigns]   = useState([])
  const [campId,      setCampId]      = useState('')
  const [campLoading, setCampLoading] = useState(true)

  const [adGroups,    setAdGroups]    = useState([])
  const [agId,        setAgId]        = useState('')
  const [agLoading,   setAgLoading]   = useState(false)

  const [listMode,    setListMode]    = useState('new') // 'new' | 'existing'
  const [listName,    setListName]    = useState('')
  const [lists,       setLists]       = useState([])
  const [listId,      setListId]      = useState('')
  const [listsLoading, setListsLoading] = useState(true)

  const [publishing, setPublishing] = useState(false)
  const [error,      setError]      = useState(null)
  const [success,    setSuccess]    = useState(false)

  const keywords = (rows || []).map(r => ({ text: r.term, matchType: r.recommendedMatchType }))

  // ── Campaigns (always needed) ────────────────────────────────────────────
  useEffect(() => {
    window.electronAPI.rsaFetchCampaigns({ customerId: selectedAccount.id, hidePaused: true })
      .then(data => setCampaigns(data || []))
      .catch(e => setError(e.message))
      .finally(() => setCampLoading(false))
  }, [])

  // ── Negative keyword lists (only relevant for Campaign-level) ───────────
  useEffect(() => {
    window.electronAPI.fetchNegativeKeywordLists({ customerId: selectedAccount.id })
      .then(data => {
        const list = data || []
        setLists(list)
        if (list.length === 0) setListMode('new')
      })
      .catch(e => setError(e.message))
      .finally(() => setListsLoading(false))
  }, [])

  // ── Ad groups (only relevant for Ad Group level) ────────────────────────
  useEffect(() => {
    if (!campId) { setAdGroups([]); setAgId(''); return }
    setAgLoading(true)
    window.electronAPI.rsaFetchAdGroups({ customerId: selectedAccount.id, campaignId: campId })
      .then(data => setAdGroups(data || []))
      .catch(e => setError(e.message))
      .finally(() => setAgLoading(false))
  }, [campId])

  const canPublish = addTo === 'campaign'
    ? !!campId && (listMode === 'new' ? !!listName.trim() : !!listId)
    : !!campId && !!agId

  async function handlePublish() {
    if (!canPublish) return
    setPublishing(true); setError(null)
    try {
      if (addTo === 'campaign') {
        await window.electronAPI.publishNegativesToCampaign({
          customerId: selectedAccount.id,
          campaignId: campId,
          listMode, listName: listMode === 'new' ? listName.trim() : undefined,
          sharedSetId: listMode === 'existing' ? listId : undefined,
          keywords,
        })
      } else {
        await window.electronAPI.publishNegativesToAdGroup({
          customerId: selectedAccount.id,
          adGroupId: agId,
          keywords,
        })
      }
      setSuccess(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setPublishing(false)
    }
  }

  const sel = { width:'100%', padding:'8px 10px', border:'1px solid #dde9f5', borderRadius:6, fontSize:13, color:'#1a3a6b', outline:'none', background:'#fff' }
  const toggleBtn = active => ({
    padding:'7px 16px', fontSize:12, fontWeight:600, borderRadius:6, cursor:'pointer',
    border: `1.5px solid ${active ? '#1a3a6b' : '#dde9f5'}`,
    background: active ? '#1a3a6b' : '#fff',
    color:      active ? '#fff'    : '#555',
  })

  if (success) {
    const campaignObj = campaigns.find(c => c.id === campId)
    const adGroupObj  = adGroups.find(a => a.id === agId)
    const listLabel   = listMode === 'new' ? listName.trim() : lists.find(l => l.id === listId)?.name

    function handleDone() {
      if (!onSuccess) { onClose(); return }
      onSuccess({
        level:          addTo === 'campaign' ? 'Campaign (List)' : 'Ad Group',
        campaignName:   campaignObj?.name   || '—',
        campaignStatus: campaignObj?.status || 'ENABLED',
        adGroupName:    adGroupObj?.name    || '—',
      })
    }

    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', borderRadius:12, padding:36, maxWidth:460, width:'90%', textAlign:'center', boxShadow:'0 8px 40px rgba(0,0,0,0.2)' }}>
          <Check size={48} color="#2e7d32" style={{ marginBottom:12 }} />
          <div style={{ fontSize:18, fontWeight:700, color:'#1a3a6b', marginBottom:8 }}>Negative Keywords Published!</div>
          <div style={{ fontSize:13, color:'#555', marginBottom:20 }}>
            {keywords.length} negative keyword{keywords.length !== 1 ? 's' : ''} added to Google Ads
            {addTo === 'campaign'
              ? <> — list <strong>"{listLabel}"</strong>, attached to <strong>{campaignObj?.name}</strong>.</>
              : <> at the ad group level for <strong>{adGroupObj?.name}</strong>.</>}
          </div>
          <button onClick={handleDone} style={{ padding:'8px 28px', background:'#1a3a6b', color:'#fff', border:'none', borderRadius:6, fontWeight:700, fontSize:13, cursor:'pointer' }}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'#fff', borderRadius:12, maxWidth:540, width:'100%', maxHeight:'90vh', overflowY:'auto', boxShadow:'0 8px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ padding:'16px 24px', borderBottom:'1px solid #eef2f7', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, background:'#fff', zIndex:1 }}>
          <div style={{ fontSize:15, fontWeight:700, color:'#1a3a6b' }}>Publish Negative Keywords to Google Ads</div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#888', fontSize:22, lineHeight:1 }}>×</button>
        </div>

        <div style={{ padding:'20px 24px', display:'flex', flexDirection:'column', gap:18 }}>

          {/* Selected keywords */}
          <div style={{ padding:'12px 14px', background:'#e3f2fd', borderRadius:8, border:'1px solid #1565c022' }}>
            <div style={{ fontSize:11, color:'#888', marginBottom:8 }}>{keywords.length} negative keyword{keywords.length !== 1 ? 's' : ''} to publish</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, maxHeight:120, overflowY:'auto' }}>
              {(rows || []).map((r, i) => (
                <span key={i} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', background:'#fff', borderRadius:14, fontSize:12, color:'#1a3a6b', border:'1px solid #c7dbf0' }}>
                  {r.term} <StatusBadge value={r.recommendedMatchType} type="match" style={{ padding:'0 6px', fontSize:9 }} />
                </span>
              ))}
            </div>
          </div>

          {/* Add to: Campaign / Ad Group */}
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:'#555', display:'block', marginBottom:8 }}>Add to</label>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setAddTo('campaign')} style={toggleBtn(addTo === 'campaign')}>Campaign</button>
              <button onClick={() => setAddTo('adGroup')} style={toggleBtn(addTo === 'adGroup')}>Ad Group</button>
            </div>
          </div>

          {/* Campaign dropdown (always shown once Add-to is chosen) */}
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:'#555', display:'block', marginBottom:6 }}>Campaign</label>
            {campLoading
              ? <div style={{ display:'flex', alignItems:'center', gap:6, color:'#888', fontSize:12 }}><Loader2 size={13} className="spin"/> Loading campaigns…</div>
              : <select value={campId} onChange={e => setCampId(e.target.value)} style={sel}>
                  <option value="">— Select Campaign —</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
                </select>
            }
          </div>

          {addTo === 'campaign' ? (
            <>
              {/* List mode */}
              <div>
                <label style={{ fontSize:12, fontWeight:600, color:'#555', display:'block', marginBottom:8 }}>Negative Keyword List</label>
                <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                  <button onClick={() => setListMode('new')} style={toggleBtn(listMode === 'new')}>New List</button>
                  <button onClick={() => setListMode('existing')} disabled={lists.length === 0 && !listsLoading} style={{ ...toggleBtn(listMode === 'existing'), opacity: (lists.length === 0 && !listsLoading) ? 0.4 : 1, cursor: (lists.length === 0 && !listsLoading) ? 'not-allowed' : 'pointer' }}>Existing List</button>
                </div>

                {listMode === 'new' ? (
                  <input
                    type="text"
                    value={listName}
                    onChange={e => setListName(e.target.value)}
                    placeholder="e.g. Irrelevant Search Terms"
                    style={sel}
                  />
                ) : listsLoading ? (
                  <div style={{ display:'flex', alignItems:'center', gap:6, color:'#888', fontSize:12 }}><Loader2 size={13} className="spin"/> Loading lists…</div>
                ) : (
                  <select value={listId} onChange={e => setListId(e.target.value)} style={sel}>
                    <option value="">— Select Existing List —</option>
                    {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                )}
              </div>
              <div style={{ fontSize:11, color:'#888', lineHeight:1.6 }}>
                Keywords are added to this negative keyword list, and the list is attached to the selected campaign (if not already).
              </div>
            </>
          ) : (
            <>
              {/* Ad Group dropdown */}
              <div>
                <label style={{ fontSize:12, fontWeight:600, color:'#555', display:'block', marginBottom:6 }}>Ad Group</label>
                {agLoading
                  ? <div style={{ display:'flex', alignItems:'center', gap:6, color:'#888', fontSize:12 }}><Loader2 size={13} className="spin"/> Loading ad groups…</div>
                  : <select value={agId} onChange={e => setAgId(e.target.value)} disabled={!campId} style={{ ...sel, background: campId ? '#fff' : '#f5f7fa' }}>
                      <option value="">— Select Ad Group —</option>
                      {adGroups.map(ag => <option key={ag.id} value={ag.id}>{ag.name} ({ag.status})</option>)}
                    </select>
                }
              </div>
              <div style={{ display:'flex', gap:8, padding:'10px 12px', background:'#fff8e6', border:'1px solid #ffe0b2', borderRadius:7 }}>
                <Info size={14} color="#a56700" style={{ flexShrink:0, marginTop:1 }} />
                <div style={{ fontSize:11, color:'#a56700', lineHeight:1.6 }}>
                  Google Ads negative keyword lists only attach at the campaign level. These keywords will be added directly to the selected ad group instead.
                </div>
              </div>
            </>
          )}

          {error && (
            <div style={{ display:'flex', gap:8, padding:'10px 12px', background:'#fff5f5', border:'1px solid #ffd5cc', borderRadius:6 }}>
              <AlertCircle size={14} color="#c0392b" style={{ flexShrink:0, marginTop:1 }} />
              <span style={{ fontSize:12, color:'#c0392b' }}>{error}</span>
            </div>
          )}
        </div>

        <div style={{ padding:'14px 24px', borderTop:'1px solid #eef2f7', display:'flex', justifyContent:'flex-end', gap:10, position:'sticky', bottom:0, background:'#fff' }}>
          <button onClick={onClose} disabled={publishing} style={{ padding:'8px 20px', fontWeight:600, fontSize:13, borderRadius:6, border:'1px solid #dde9f5', background:'#fff', color:'#555', cursor: publishing ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button onClick={handlePublish} disabled={!canPublish || publishing}
            style={{ padding:'8px 22px', fontWeight:700, fontSize:13, borderRadius:6, border:'none',
              cursor: canPublish && !publishing ? 'pointer' : 'not-allowed',
              background: canPublish && !publishing ? '#1a3a6b' : '#dde9f5',
              color:      canPublish && !publishing ? '#fff'    : '#aaa',
              display:'inline-flex', alignItems:'center', gap:8 }}>
            {publishing ? <><Loader2 size={13} className="spin"/> Publishing…</> : `🚀 Publish ${keywords.length} Negative Keyword${keywords.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
