import React, { useEffect, useState } from 'react'
import { Plus, X, Sparkles, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { Spinner, inputStyle, selectStyle, PanelSplit, KeywordPasteBox } from '../campaign-manager/shared.jsx'
import { useReviewFlow, ReviewModal, btnPrimary } from '../campaign-manager/manage-panels/EditPanels.jsx'

const MATCH_TYPES = [{ value: 'BROAD', label: 'Broad' }, { value: 'PHRASE', label: 'Phrase' }, { value: 'EXACT', label: 'Exact' }]
const MATCH_ABBR  = { BROAD: 'Broad', PHRASE: 'Phrase', EXACT: 'Exact' }
const sameKw = (a, b) => a.text === b.text && a.matchType === b.matchType

function KeywordAISuggestions({ loading, error, data, addedIdx, onFetch, onAdd }) {
  const visible = (data?.keywords || []).map((k, i) => ({ k, i })).filter(({ i }) => !addedIdx.has(i))
  const allAdded = !loading && !error && data && data.keywords.length > 0 && visible.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#6a3fc0', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          <Sparkles size={12} /> AI Suggested Keywords
        </div>
        <button
          onClick={onFetch} disabled={loading}
          style={{ fontSize: 10, fontWeight: 600, color: '#6a3fc0', background: 'none', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}
        >
          {data ? '↻ Refresh' : 'Get Suggestions'}
        </button>
      </div>
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888', padding: '10px 12px' }}>
          <Loader2 size={12} className="spin" /> Analyzing ad group…
        </div>
      )}
      {!loading && error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: '#c0392b', padding: '10px 12px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 7 }}>
          <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
        </div>
      )}
      {!loading && !error && data && data.keywords.length === 0 && (
        <div style={{ fontSize: 11, color: '#aaa', padding: '10px 12px' }}>No new suggestions right now — try Refresh again shortly.</div>
      )}
      {allAdded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#2e7d32', padding: '10px 12px', background: '#f0faf0', border: '1px solid #a8e0a8', borderRadius: 7 }}>
          <CheckCircle size={12} /> All suggestions added.
        </div>
      )}
      {!loading && !error && visible.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {visible.map(({ k, i }) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 6px 4px 10px', borderRadius: 12, background: '#f7f5ff', border: '1px solid #e0d9fb', color: '#3d2470' }}>
              {k.text} <span style={{ opacity: 0.6, fontSize: 10 }}>· {MATCH_ABBR[k.matchType] || k.matchType}</span>
              <button
                onClick={() => onAdd(k, i)}
                style={{ display: 'inline-flex', alignItems: 'center', color: '#fff', background: '#6a3fc0', border: 'none', borderRadius: '50%', width: 15, height: 15, cursor: 'pointer', padding: 0, justifyContent: 'center' }}
              >
                <Plus size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function KeywordsPanel({ adGroup, customerId, siblingAdGroupNames = [], onSaved }) {
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [initial,  setInitial]  = useState([])
  const [keywords, setKeywords] = useState([])
  const [newText,      setNewText]      = useState('')
  const [newMatchType, setNewMatchType] = useState('BROAD')

  const [aiRec,        setAiRec]        = useState(null)
  const [aiRecLoading,  setAiRecLoading] = useState(false)
  const [aiRecError,    setAiRecError]   = useState(null)
  const [addedIdx,      setAddedIdx]     = useState(new Set())

  function refresh() {
    setLoading(true); setError(null)
    window.electronAPI.adGroupListKeywords({ customerId, adGroupId: adGroup.id })
      .then(data => { setInitial(data); setKeywords(data) })
      .catch(err => setError(err.message || 'Failed to load keywords'))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [adGroup.id, customerId])

  const removeKeyword   = (i) => setKeywords(keywords.filter((_, idx) => idx !== i))
  const changeMatchType = (i, matchType) => setKeywords(keywords.map((k, idx) => idx === i ? { ...k, matchType } : k))
  function addKeyword() {
    if (!newText.trim()) return
    setKeywords([...keywords, { text: newText.trim(), matchType: newMatchType }])
    setNewText('')
  }
  // Drops in a whole pasted batch at once — dedupes against keywords already
  // in the list on text+matchType together (not text alone), so pasting the
  // same term in two match-type formats (e.g. "term" and [term]) keeps both
  // as distinct rows instead of the second silently overwriting the first.
  function bulkAddKeywords(parsed) {
    setKeywords(prev => {
      const seen = new Set(prev.map(k => `${k.text.trim().toLowerCase()}|${k.matchType}`))
      const merged = [...prev]
      for (const k of parsed) {
        const key = `${k.text.toLowerCase()}|${k.matchType}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(k)
      }
      return merged
    })
  }

  function fetchAiRec() {
    setAiRecLoading(true); setAiRecError(null); setAddedIdx(new Set())
    window.electronAPI.adGroupAiRecommendKeywords({
      campaignName: adGroup.campaignName, adGroupName: adGroup.name,
      existingKeywords: keywords.map(k => k.text),
      siblingAdGroupNames,
    })
      .then(setAiRec)
      .catch(err => setAiRecError(err.message || 'Failed to get AI suggestions'))
      .finally(() => setAiRecLoading(false))
  }

  // idx identifies which suggestion chip was clicked so it can be hidden —
  // once added, it stays hidden until the next fetch (Refresh) resets the
  // set, so re-clicking the same suggestion can't create a duplicate keyword.
  function addSuggestedKeyword(kw, idx) {
    setKeywords(prev => [...prev, { text: kw.text, matchType: kw.matchType }])
    setAddedIdx(prev => new Set(prev).add(idx))
  }

  const dirty   = !(keywords.length === initial.length && keywords.every(k => initial.some(i => sameKw(i, k))))
  const added   = keywords.filter(k => !initial.some(i => sameKw(i, k)))
  const removed = initial.filter(i => !keywords.some(k => sameKw(i, k)))

  const flow = useReviewFlow({
    validateFn: () => window.electronAPI.adGroupUpdateKeywords({ customerId, adGroupId: adGroup.id, keywords, validateOnly: true }),
    publishFn: () => window.electronAPI.adGroupUpdateKeywords({ customerId, adGroupId: adGroup.id, adGroupName: adGroup.name, keywords, before: { keywords: initial } }),
  })

  function handleDone() {
    onSaved?.()
    refresh()
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Keywords</div>
      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 12 }}>Match type can't be edited in place — changing it removes the old keyword and adds a new one, same as Google Ads itself does.</div>

      {loading ? (
        <Spinner label="Loading keywords…" />
      ) : error ? (
        <div style={{ padding: '10px 14px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 6, color: '#c0392b', fontSize: 12 }}>{error}</div>
      ) : (
        <>
          <PanelSplit
            left={<>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto', marginBottom: 10, paddingRight: 4 }}>
                {keywords.map((kw, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ flex: 1, fontSize: 13, color: '#1a3a6b', padding: '7px 10px', background: '#f7f9fb', borderRadius: 6, border: '1px solid #eef2f7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kw.text}</div>
                    <select value={kw.matchType} onChange={e => changeMatchType(i, e.target.value)} style={{ ...selectStyle, width: 110, flexShrink: 0 }}>
                      {MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <button onClick={() => removeKeyword(i)} style={{ flexShrink: 0, border: 'none', background: 'none', cursor: 'pointer', color: '#aaa' }}><X size={14} /></button>
                  </div>
                ))}
                {keywords.length === 0 && <div style={{ fontSize: 12, color: '#aaa', padding: '10px 0' }}>No keywords in this ad group.</div>}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={newText} onChange={e => setNewText(e.target.value)} placeholder="Add a keyword…"
                  style={{ ...inputStyle, flex: 1 }} onKeyDown={e => { if (e.key === 'Enter') addKeyword() }}
                />
                <select value={newMatchType} onChange={e => setNewMatchType(e.target.value)} style={{ ...selectStyle, width: 110, flexShrink: 0 }}>
                  {MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <button onClick={addKeyword} style={{ flexShrink: 0, border: 'none', background: 'none', color: '#1a3a6b', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  <Plus size={13} /> Add
                </button>
              </div>
              <KeywordPasteBox onAdd={bulkAddKeywords} />

              <div style={{ marginTop: 14 }}>
                <button style={{ ...btnPrimary, opacity: dirty ? 1 : 0.4, cursor: dirty ? 'pointer' : 'not-allowed' }} disabled={!dirty} onClick={flow.start}>Save Changes</button>
              </div>
            </>}
            right={
              <KeywordAISuggestions
                loading={aiRecLoading} error={aiRecError} data={aiRec} addedIdx={addedIdx}
                onFetch={fetchAiRec} onAdd={addSuggestedKeyword}
              />
            }
          />
        </>
      )}

      <ReviewModal title="Update Keywords" subtitle={adGroup.name} flow={flow} canConfirmExtra={dirty} onDone={handleDone}>
        {added.length > 0   && <div style={{ fontSize: 12, color: '#555' }}>Adding ({added.length}): <strong>{added.map(k => `${k.text} (${k.matchType})`).join(', ')}</strong></div>}
        {removed.length > 0 && <div style={{ fontSize: 12, color: '#555' }}>Removing ({removed.length}): <strong>{removed.map(k => `${k.text} (${k.matchType})`).join(', ')}</strong></div>}
      </ReviewModal>
    </div>
  )
}
