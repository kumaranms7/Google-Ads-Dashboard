import React, { useState } from 'react'
import { Plus, X, Sparkles, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { inputStyle, selectStyle, PanelSplit, KeywordPasteBox } from '../campaign-manager/shared.jsx'
import { useReviewFlow, ReviewModal, btnPrimary } from '../campaign-manager/manage-panels/EditPanels.jsx'

const MATCH_TYPES = [{ value: 'BROAD', label: 'Broad' }, { value: 'PHRASE', label: 'Phrase' }, { value: 'EXACT', label: 'Exact' }]
const MATCH_ABBR  = { BROAD: 'Broad', PHRASE: 'Phrase', EXACT: 'Exact' }

// Suggests complete ad-group ideas (name + keywords together) rather than
// just keywords for an already-typed name — the AI infers what the next ad
// group in this campaign should be called, same as the Create Campaign
// wizard's Ad Groups step, but aware of this campaign's existing ad groups
// so it doesn't propose something that duplicates one already there.
function AdGroupAISuggestions({ loading, error, data, addedIdx, onFetch, onAdd }) {
  const visible = (data?.adGroups || []).map((ag, i) => ({ ag, i })).filter(({ i }) => !addedIdx.has(i))
  const allAdded = !loading && !error && data && data.adGroups.length > 0 && visible.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#6a3fc0', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          <Sparkles size={12} /> AI Suggested Ad Groups
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
          <Loader2 size={12} className="spin" /> Analyzing campaign…
        </div>
      )}
      {!loading && error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: '#c0392b', padding: '10px 12px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 7 }}>
          <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
        </div>
      )}
      {!loading && !error && data && data.adGroups.length === 0 && (
        <div style={{ fontSize: 11, color: '#aaa', padding: '10px 12px' }}>No suggestions — try again in a moment.</div>
      )}
      {allAdded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#2e7d32', padding: '10px 12px', background: '#f0faf0', border: '1px solid #a8e0a8', borderRadius: 7 }}>
          <CheckCircle size={12} /> All suggestions added.
        </div>
      )}
      {!loading && !error && visible.map(({ ag, i }) => (
        <div key={i} style={{ padding: '10px 12px', background: '#f7f5ff', border: '1px solid #e0d9fb', borderRadius: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#3d2470' }}>{ag.name}</div>
            <button
              onClick={() => onAdd(ag, i)}
              style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color: '#fff', background: '#6a3fc0', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
            >
              <Plus size={10} /> Use This
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {ag.keywords.map((k, ki) => (
              <span key={ki} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: '#fff', border: '1px solid #e0d9fb', color: '#6a3fc0' }}>
                {k.text} <span style={{ opacity: 0.6 }}>· {MATCH_ABBR[k.matchType] || k.matchType}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Suggests keywords for the ad group name the user has already typed, rather
// than ad-group ideas — this is the counterpart to AdGroupAISuggestions above,
// shown once a name is entered (same interaction pattern as the Manage tab's
// per-ad-group KeywordsPanel, since that flow already solves "keywords for a
// specific ad group name").
function AdGroupKeywordAISuggestions({ adGroupName, loading, error, data, addedIdx, onFetch, onAdd, onAddAll }) {
  const visible  = (data?.keywords || []).map((k, i) => ({ k, i })).filter(({ i }) => !addedIdx.has(i))
  const allAdded = !loading && !error && data && data.keywords.length > 0 && visible.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#6a3fc0', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          <Sparkles size={12} /> AI Suggested Keywords
        </div>
        <button
          onClick={onFetch} disabled={loading}
          style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, color: '#6a3fc0', background: 'none', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}
        >
          {data ? '↻ Refresh' : 'Get Suggestions'}
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#888' }}>for "{adGroupName}"</div>
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
        <>
          <button
            onClick={onAddAll}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color: '#fff', background: '#6a3fc0', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
          >
            <Plus size={10} /> Add All
          </button>
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
        </>
      )}
    </div>
  )
}

export default function CreateAdGroupPanel({ selectedAccount, campaignId, campaignName, existingAdGroupNames = [], onClose, onCreated }) {
  const [name,     setName]     = useState('')
  const [cpcBid,   setCpcBid]   = useState('')
  const [keywords, setKeywords] = useState([{ text: '', matchType: 'BROAD' }])

  const [aiRec,        setAiRec]        = useState(null)
  const [aiRecLoading,  setAiRecLoading] = useState(false)
  const [aiRecError,    setAiRecError]   = useState(null)
  const [addedIdx,      setAddedIdx]     = useState(new Set())

  // Separate state for the keyword-suggestion mode (shown once a name is
  // typed) so switching the Ad Group Name field back and forth doesn't throw
  // away whichever suggestion set was already fetched.
  const [aiKwRec,        setAiKwRec]        = useState(null)
  const [aiKwRecLoading, setAiKwRecLoading] = useState(false)
  const [aiKwRecError,   setAiKwRecError]   = useState(null)
  const [addedKwIdx,     setAddedKwIdx]     = useState(new Set())

  const validKeywords = keywords.filter(k => k.text.trim())
  const canReview = name.trim().length > 0 && validKeywords.length > 0

  const update        = (i, patch) => setKeywords(keywords.map((k, idx) => idx === i ? { ...k, ...patch } : k))
  const addKeyword    = () => setKeywords([...keywords, { text: '', matchType: 'BROAD' }])
  const removeKeyword = (i) => setKeywords(keywords.filter((_, idx) => idx !== i))
  // Drops the lingering blank placeholder row (if still empty) and dedupes
  // against keywords already typed in on text+matchType together (not text
  // alone), so the same term pasted in two match-type formats (e.g. "term"
  // and [term]) keeps both rows instead of the second silently overwriting.
  const bulkAddKeywords = (parsed) => {
    const existing = keywords.filter(k => k.text.trim())
    const seen = new Set(existing.map(k => `${k.text.trim().toLowerCase()}|${k.matchType}`))
    const merged = [...existing]
    for (const k of parsed) {
      const key = `${k.text.toLowerCase()}|${k.matchType}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(k)
    }
    setKeywords(merged.length > 0 ? merged : [{ text: '', matchType: 'BROAD' }])
  }

  function fetchAiRec() {
    setAiRecLoading(true); setAiRecError(null); setAddedIdx(new Set())
    window.electronAPI.campaignAiRecommendAdGroups({ name: campaignName, existingAdGroupNames })
      .then(setAiRec)
      .catch(err => setAiRecError(err.message || 'Failed to get AI suggestions'))
      .finally(() => setAiRecLoading(false))
  }

  function fetchAiKwRec() {
    setAiKwRecLoading(true); setAiKwRecError(null); setAddedKwIdx(new Set())
    window.electronAPI.adGroupAiRecommendKeywords({
      campaignName, adGroupName: name.trim(),
      existingKeywords: validKeywords.map(k => k.text),
      siblingAdGroupNames: existingAdGroupNames,
    })
      .then(setAiKwRec)
      .catch(err => setAiKwRecError(err.message || 'Failed to get AI suggestions'))
      .finally(() => setAiKwRecLoading(false))
  }

  // idx identifies which suggestion chip was clicked so it can be hidden —
  // once added, it stays hidden until the next fetch (Refresh) resets the
  // set, mirroring addSuggestedAdGroup below. Routes through bulkAddKeywords
  // so it shares the same dedupe/placeholder-row logic as the paste box.
  function addSuggestedKeyword(kw, idx) {
    bulkAddKeywords([{ text: kw.text, matchType: kw.matchType }])
    setAddedKwIdx(prev => new Set(prev).add(idx))
  }

  function addAllSuggestedKeywords() {
    const toAdd = (aiKwRec?.keywords || []).map((k, i) => ({ k, i })).filter(({ i }) => !addedKwIdx.has(i))
    if (toAdd.length === 0) return
    bulkAddKeywords(toAdd.map(({ k }) => ({ text: k.text, matchType: k.matchType })))
    setAddedKwIdx(prev => new Set([...prev, ...toAdd.map(({ i }) => i)]))
  }

  // idx identifies which suggestion card was clicked so it can be hidden —
  // once added, it stays hidden until the next fetch (Refresh) resets the
  // set, so re-clicking the same suggestion can't create a duplicate. This
  // replaces whatever the user had already typed — clicking a card means
  // "use this idea," matching the Create Campaign wizard's convention for
  // the same suggestion-card pattern.
  function addSuggestedAdGroup(ag, idx) {
    setName(ag.name)
    setKeywords(ag.keywords.map(k => ({ text: k.text, matchType: k.matchType })))
    setAddedIdx(prev => new Set(prev).add(idx))
  }

  const flow = useReviewFlow({
    validateFn: () => window.electronAPI.adGroupCreate({ customerId: selectedAccount.id, campaignId, name: name.trim(), cpcBid: Number(cpcBid) || undefined, keywords: validKeywords, validateOnly: true }),
    publishFn: () => window.electronAPI.adGroupCreate({ customerId: selectedAccount.id, campaignId, campaignName, name: name.trim(), cpcBid: Number(cpcBid) || undefined, keywords: validKeywords }),
  })

  function handleDone() {
    onCreated?.()
    onClose?.()
  }

  return (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5 }}>New Ad Group</div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#aaa' }}><X size={16} /></button>
      </div>

      <PanelSplit
        left={<>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Ad Group Name</div>
              <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ minWidth: 160 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Default Bid ($) <span style={{ fontWeight: 400, color: '#aaa' }}>(optional)</span></div>
              <input type="number" min="0" step="0.01" value={cpcBid} onChange={e => setCpcBid(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 6 }}>Keywords</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {keywords.map((kw, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={kw.text} onChange={e => update(i, { text: e.target.value })} placeholder="Keyword" style={{ ...inputStyle, flex: 1 }} />
                <select value={kw.matchType} onChange={e => update(i, { matchType: e.target.value })} style={{ ...selectStyle, width: 110 }}>
                  {MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                {keywords.length > 1 && (
                  <button onClick={() => removeKeyword(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#aaa' }}><X size={14} /></button>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <button onClick={addKeyword} style={{ border: 'none', background: 'none', color: '#1a3a6b', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <Plus size={13} /> Add keyword
            </button>
            <KeywordPasteBox onAdd={bulkAddKeywords} />
          </div>

          <div style={{ marginTop: 16 }}>
            <button style={{ ...btnPrimary, opacity: canReview ? 1 : 0.4, cursor: canReview ? 'pointer' : 'not-allowed' }} disabled={!canReview} onClick={flow.start}>Create Ad Group</button>
          </div>
        </>}
        right={
          name.trim() ? (
            <AdGroupKeywordAISuggestions
              adGroupName={name.trim()}
              loading={aiKwRecLoading} error={aiKwRecError} data={aiKwRec} addedIdx={addedKwIdx}
              onFetch={fetchAiKwRec} onAdd={addSuggestedKeyword} onAddAll={addAllSuggestedKeywords}
            />
          ) : (
            <AdGroupAISuggestions
              loading={aiRecLoading} error={aiRecError} data={aiRec} addedIdx={addedIdx}
              onFetch={fetchAiRec} onAdd={addSuggestedAdGroup}
            />
          )
        }
      />

      <ReviewModal
        title="Create Ad Group" subtitle={campaignName} flow={flow} canConfirmExtra={canReview} onDone={handleDone}
        confirmLabel="Create Ad Group" confirmingLabel="Creating…"
        successMessage={`Ad group "${name.trim()}" created.`}
        warningMessage="This will create a real ad group in this Google Ads account."
        confirmCheckboxLabel="I understand this will create a live ad group in the Google Ads account."
      >
        <div style={{ fontSize: 12, color: '#555' }}>Name: <strong>{name.trim()}</strong></div>
        <div style={{ fontSize: 12, color: '#555' }}>Default Bid: <strong>{cpcBid ? `$${Number(cpcBid).toFixed(2)}` : 'Inherit from campaign'}</strong></div>
        <div style={{ fontSize: 12, color: '#555' }}>Keywords: <strong>{validKeywords.map(k => `${k.text} (${k.matchType})`).join(', ')}</strong></div>
      </ReviewModal>
    </div>
  )
}
