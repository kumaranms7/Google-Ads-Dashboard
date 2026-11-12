import React, { useState, useEffect } from 'react'
import { Loader2, Check } from 'lucide-react'

const MATCH_TYPES = ['Phrase', 'Exact', 'Broad']
const MATCH_COLOR = {
  Broad:  { bg: '#e3f2fd', text: '#1565c0', border: '#3a8fd1' },
  Phrase: { bg: '#e8eaf6', text: '#283593', border: '#2563b0' },
  Exact:  { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' },
}

// row (single) or rows (bulk, array) — both supported so existing single-row
// callers keep working unchanged. Each item: { keyword, matchType?, recommendedCampaign?, adGroup? }.
export default function PublishKeywordModal({ row, rows, selectedAccount, onClose, onSuccess }) {
  const items = rows && rows.length ? rows : (row ? [row] : [])
  const isBulk = items.length > 1
  const first = items[0] || {}

  const [campaigns,   setCampaigns]   = useState([])
  const [adGroups,    setAdGroups]    = useState([])
  const [campId,      setCampId]      = useState('')
  const [agId,        setAgId]        = useState('')
  const [matchType,   setMatchType]   = useState(MATCH_TYPES.includes(first.matchType) ? first.matchType : 'Phrase')
  const [campLoading, setCampLoading] = useState(true)
  const [agLoading,   setAgLoading]   = useState(false)
  const [publishing,  setPublishing]  = useState(false)
  const [error,       setError]       = useState(null)
  const [success,     setSuccess]     = useState(false)

  useEffect(() => {
    window.electronAPI.rsaFetchCampaigns({ customerId: selectedAccount.id, hidePaused: true })
      .then(d => {
        const list = d || []
        setCampaigns(list)
        const match = list.find(c => c.name === first.recommendedCampaign)
        if (match) setCampId(match.id)
      })
      .catch(e => setError(e.message))
      .finally(() => setCampLoading(false))
  }, [])

  useEffect(() => {
    if (!campId) { setAdGroups([]); setAgId(''); return }
    setAgLoading(true)
    window.electronAPI.rsaFetchAdGroups({ customerId: selectedAccount.id, campaignId: campId })
      .then(d => {
        const list = d || []
        setAdGroups(list)
        const match = list.find(ag => ag.name === first.adGroup)
        setAgId(match ? match.id : '')
      })
      .catch(e => setError(e.message))
      .finally(() => setAgLoading(false))
  }, [campId])

  const canPublish = !publishing && !!campId && !!agId

  async function handlePublish() {
    if (!canPublish) return
    setPublishing(true); setError(null)
    try {
      for (const item of items) {
        await window.electronAPI.publishKeyword({
          customerId: selectedAccount.id, adGroupId: agId,
          keywordText: item.keyword, matchType,
        })
      }
      setSuccess(true)
    } catch (e) { setError(e.message) }
    finally { setPublishing(false) }
  }

  const sel = { width:'100%', padding:'8px 10px', border:'1px solid #dde9f5', borderRadius:6, fontSize:13, color:'#1a3a6b', outline:'none', background:'#fff' }
  const toggleBtn = active => ({
    padding:'7px 18px', fontSize:12, fontWeight:600, borderRadius:6, cursor:'pointer',
    border:`1.5px solid ${active ? '#1a3a6b' : '#dde9f5'}`,
    background: active ? '#1a3a6b' : '#fff', color: active ? '#fff' : '#555',
  })

  const agObj = adGroups.find(a => a.id === agId)

  if (success) {
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', borderRadius:12, padding:36, maxWidth:440, width:'90%', textAlign:'center', boxShadow:'0 8px 40px rgba(0,0,0,0.2)' }}>
          <Check size={48} color="#2e7d32" style={{ marginBottom:12 }} />
          <div style={{ fontSize:18, fontWeight:700, color:'#1a3a6b', marginBottom:8 }}>
            {isBulk ? `${items.length} Keywords Published!` : 'Keyword Published!'}
          </div>
          <div style={{ fontSize:13, color:'#555', marginBottom:20, lineHeight:1.6 }}>
            {isBulk
              ? <><strong>{items.length} keywords</strong> added as <strong>{matchType}</strong> match</>
              : <><strong>"{first.keyword}"</strong> added as a <strong>{matchType}</strong> match keyword</>}
            {agObj ? <> to ad group <strong>{agObj.name}</strong></> : null}
          </div>
          <button onClick={onSuccess || onClose} style={{ padding:'8px 28px', background:'#1a3a6b', color:'#fff', border:'none', borderRadius:6, fontWeight:700, fontSize:13, cursor:'pointer' }}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:12, padding:28, maxWidth:500, width:'92%', boxShadow:'0 8px 40px rgba(0,0,0,0.2)', maxHeight:'90vh', overflowY:'auto' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:18 }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:'#1a3a6b' }}>Publish {isBulk ? `${items.length} Keywords` : 'Keyword'} to Google Ads</div>
            {!isBulk && <div style={{ fontSize:12, color:'#888', marginTop:3 }}>"{first.keyword}"</div>}
          </div>
          <button onClick={onClose} style={{ fontSize:22, color:'#aaa', background:'none', border:'none', cursor:'pointer', lineHeight:1, marginLeft:12 }}>×</button>
        </div>

        {/* Bulk keyword preview */}
        {isBulk && (
          <div style={{ marginBottom:16, background:'#f5f7fa', border:'1px solid #dde9f5', borderRadius:7, padding:'8px 12px', maxHeight:90, overflowY:'auto' }}>
            {items.map((it, i) => (
              <div key={i} style={{ fontSize:12, color:'#1a3a6b', padding:'2px 0', fontWeight:500 }}>{it.keyword}</div>
            ))}
          </div>
        )}

        {/* Match Type */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Match Type</div>
          <div style={{ display:'flex', gap:8 }}>
            {MATCH_TYPES.map(m => (
              <button key={m} style={toggleBtn(matchType === m)} onClick={() => setMatchType(m)}>{m}</button>
            ))}
          </div>
        </div>

        {/* Campaign */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>Campaign</div>
          {campLoading
            ? <div style={{ fontSize:12, color:'#aaa' }}>Loading campaigns…</div>
            : <select value={campId} onChange={e => setCampId(e.target.value)} style={sel}>
                <option value="">Select campaign…</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
          }
        </div>

        {/* Ad Group */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>Ad Group</div>
          {!campId
            ? <div style={{ fontSize:12, color:'#aaa' }}>Select a campaign first</div>
            : agLoading
              ? <div style={{ fontSize:12, color:'#aaa' }}>Loading ad groups…</div>
              : <select value={agId} onChange={e => setAgId(e.target.value)} style={sel}>
                  <option value="">Select ad group…</option>
                  {adGroups.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
          }
        </div>

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
            {publishing ? 'Publishing…' : `🚀 Publish ${isBulk ? `${items.length} Keywords` : 'Keyword'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
