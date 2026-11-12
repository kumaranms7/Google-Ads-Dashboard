import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, LayoutGrid, Image, ShoppingBag, Video, Plus, X, AlertCircle, CheckCircle, Loader2, ArrowRight, ArrowLeft, Sparkles } from 'lucide-react'
import { ModalWarning, ModalError, ModalSuccess } from '../../components/Modal.jsx'
import { BIDDING_STRATEGIES, BiddingStrategyPicker, ChipPicker, biddingStrategyLabel, inputStyle, selectStyle, PanelSplit, KeywordPasteBox } from './shared.jsx'

const CHANNEL_TYPES = [
  { id: 'search',   label: 'Search',           icon: Search,      step3Label: 'Ad Groups & Keywords' },
  { id: 'pmax',     label: 'Performance Max',   icon: LayoutGrid,  step3Label: 'Asset Group' },
  { id: 'display',  label: 'Display',           icon: Image,       step3Label: 'Ad Creative' },
  { id: 'shopping', label: 'Shopping',          icon: ShoppingBag, step3Label: 'Shopping Settings' },
  { id: 'video',    label: 'Video',             icon: Video,       step3Label: 'Video Ad' },
]

const CREATE_FN = {
  search: 'campaignCreateSearch', display: 'campaignCreateDisplay', pmax: 'campaignCreatePerformanceMax',
  shopping: 'campaignCreateShopping', video: 'campaignCreateVideo',
}

const btnPrimary = { padding: '9px 20px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none', background: '#1a3a6b', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const btnGhost   = { padding: '9px 20px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: '1px solid #dde9f5', background: '#fff', color: '#555', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const btnDisabled = { ...btnPrimary, opacity: 0.4, cursor: 'not-allowed' }
const label11 = { fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }

function StepHeader({ steps, step }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
      {steps.map((lbl, i) => (
        <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: '50%', fontSize: 11, fontWeight: 700,
            background: i <= step ? '#1a3a6b' : '#eef2f7', color: i <= step ? '#fff' : '#aaa',
          }}>{i + 1}</span>
          <span style={{ fontSize: 12, fontWeight: i === step ? 700 : 500, color: i === step ? '#1a3a6b' : '#aaa' }}>{lbl}</span>
          {i < steps.length - 1 && <span style={{ width: 20, height: 1, background: '#eef2f7', margin: '0 4px' }} />}
        </div>
      ))}
    </div>
  )
}

// ── Reusable small field editors shared across creative steps ─────────────────

export function TextListEditor({ label, items, onChange, max, placeholder, minRequired = 0 }) {
  const update = (i, v) => onChange(items.map((t, idx) => idx === i ? v : t))
  const add    = () => items.length < max && onChange([...items, ''])
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i))
  return (
    <div>
      <div style={label11}>{label} {minRequired > 0 && <span style={{ color: '#aaa', fontWeight: 400 }}>(min {minRequired})</span>}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 8 }}>
            <input value={t} onChange={e => update(i, e.target.value)} placeholder={placeholder} style={{ ...inputStyle, flex: 1 }} />
            {items.length > 1 && <button onClick={() => remove(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#aaa' }}><X size={14} /></button>}
          </div>
        ))}
      </div>
      {items.length < max && (
        <button onClick={add} style={{ marginTop: 6, border: 'none', background: 'none', color: '#1a3a6b', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Add
        </button>
      )}
    </div>
  )
}

export function ImageUrlEditor({ label, urls, onChange, hint }) {
  const update = (i, v) => onChange(urls.map((u, idx) => idx === i ? v : u))
  const add    = () => onChange([...urls, ''])
  const remove = (i) => onChange(urls.filter((_, idx) => idx !== i))
  return (
    <div>
      <div style={label11}>{label}</div>
      {hint && <div style={{ fontSize: 10, color: '#aaa', marginBottom: 6 }}>{hint}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {urls.map((u, i) => (
          <div key={i} style={{ display: 'flex', gap: 8 }}>
            <input value={u} onChange={e => update(i, e.target.value)} placeholder="https://example.com/image.jpg" style={{ ...inputStyle, flex: 1 }} />
            {urls.length > 1 && <button onClick={() => remove(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#aaa' }}><X size={14} /></button>}
          </div>
        ))}
      </div>
      <button onClick={add} style={{ marginTop: 6, border: 'none', background: 'none', color: '#1a3a6b', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Plus size={13} /> Add image URL
      </button>
    </div>
  )
}

// ── Step 3 content, per channel ───────────────────────────────────────────────

const MATCH_TYPES = [{ value: 'BROAD', label: 'Broad' }, { value: 'PHRASE', label: 'Phrase' }, { value: 'EXACT', label: 'Exact' }]

function AdGroupEditor({ adGroups, onChange, requireCpc }) {
  const update = (i, patch) => onChange(adGroups.map((ag, idx) => idx === i ? { ...ag, ...patch } : ag))
  const addGroup = () => onChange([...adGroups, { name: `Ad Group ${adGroups.length + 1}`, keywords: [{ text: '', matchType: 'BROAD' }], defaultMaxCpc: '' }])
  const removeGroup = (i) => onChange(adGroups.filter((_, idx) => idx !== i))
  const addKeyword = (i) => update(i, { keywords: [...adGroups[i].keywords, { text: '', matchType: 'BROAD' }] })
  const removeKeyword = (i, ki) => update(i, { keywords: adGroups[i].keywords.filter((_, idx) => idx !== ki) })
  const updateKeyword = (i, ki, patch) => update(i, { keywords: adGroups[i].keywords.map((k, idx) => idx === ki ? { ...k, ...patch } : k) })
  // Drops the lingering blank placeholder row (if still empty) and dedupes
  // against what's already in this ad group on text+matchType together (not
  // text alone), so the same term pasted in two match-type formats (e.g.
  // "term" and [term]) keeps both rows instead of the second silently
  // overwriting the first.
  const bulkAddKeywords = (i, parsed) => {
    const existing = adGroups[i].keywords.filter(k => k.text.trim())
    const seen = new Set(existing.map(k => `${k.text.trim().toLowerCase()}|${k.matchType}`))
    const merged = [...existing]
    for (const k of parsed) {
      const key = `${k.text.toLowerCase()}|${k.matchType}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(k)
    }
    update(i, { keywords: merged.length > 0 ? merged : [{ text: '', matchType: 'BROAD' }] })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {adGroups.map((ag, i) => (
        <div key={i} style={{ border: '1px solid #eef2f7', borderRadius: 8, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <input value={ag.name} onChange={e => update(i, { name: e.target.value })} placeholder="Ad group name" style={{ ...inputStyle, flex: 1, fontWeight: 600 }} />
            {adGroups.length > 1 && (
              <button onClick={() => removeGroup(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c0392b' }}><X size={16} /></button>
            )}
          </div>
          {requireCpc && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>
                Default Max CPC ($) <span style={{ color: '#c0392b' }}>*</span>
              </div>
              <input
                type="number" min="0.01" step="0.01"
                value={ag.defaultMaxCpc ?? ''} onChange={e => update(i, { defaultMaxCpc: e.target.value })}
                placeholder="e.g. 2.50"
                style={{ ...inputStyle, maxWidth: 140, borderColor: Number(ag.defaultMaxCpc) > 0 ? undefined : '#e05c2a' }}
              />
              <div style={{ fontSize: 10, color: '#aaa', marginTop: 3 }}>Applied to every keyword in this ad group unless overridden below. Required for Manual CPC — without it, Google Ads bids at its $0.01 floor.</div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ag.keywords.map((kw, ki) => (
              <div key={ki} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={kw.text} onChange={e => updateKeyword(i, ki, { text: e.target.value })} placeholder="Keyword" style={{ ...inputStyle, flex: 1 }} />
                <select value={kw.matchType} onChange={e => updateKeyword(i, ki, { matchType: e.target.value })} style={{ ...selectStyle, width: 110 }}>
                  {MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                {requireCpc && (
                  <input
                    type="number" min="0.01" step="0.01"
                    value={kw.maxCpc ?? ''} onChange={e => updateKeyword(i, ki, { maxCpc: e.target.value })}
                    placeholder="Default"
                    title="Optional — overrides this ad group's Default Max CPC for this one keyword"
                    style={{ ...inputStyle, width: 90 }}
                  />
                )}
                {ag.keywords.length > 1 && (
                  <button onClick={() => removeKeyword(i, ki)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#aaa' }}><X size={14} /></button>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <button onClick={() => addKeyword(i)} style={{ marginTop: 8, border: 'none', background: 'none', color: '#1a3a6b', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <Plus size={13} /> Add keyword
            </button>
            <KeywordPasteBox onAdd={parsed => bulkAddKeywords(i, parsed)} />
          </div>
        </div>
      ))}
      <button onClick={addGroup} style={{ ...btnGhost, alignSelf: 'flex-start' }}><Plus size={14} /> Add Ad Group</button>
    </div>
  )
}

const MATCH_ABBR = { BROAD: 'Broad', PHRASE: 'Phrase', EXACT: 'Exact' }

function AdGroupAISuggestions({ loading, error, data, addedIdx, onAdd, onRefresh }) {
  const visible = (data?.adGroups || []).map((ag, i) => ({ ag, i })).filter(({ i }) => !addedIdx.has(i))
  const allAdded = !loading && !error && data && data.adGroups.length > 0 && visible.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#6a3fc0', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          <Sparkles size={12} /> AI Suggested Ad Groups
        </div>
        <button onClick={onRefresh} disabled={loading} style={{ fontSize: 10, fontWeight: 600, color: '#6a3fc0', background: 'none', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}>↻ Refresh</button>
      </div>
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888', padding: '10px 12px' }}>
          <Loader2 size={12} className="spin" /> Analyzing campaign name &amp; targeting…
        </div>
      )}
      {!loading && error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: '#c0392b', padding: '10px 12px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 7 }}>
          <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
        </div>
      )}
      {!loading && !error && data && data.adGroups.length === 0 && (
        <div style={{ fontSize: 11, color: '#aaa', padding: '10px 12px' }}>No suggestions — try adding a more specific campaign name.</div>
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
              <Plus size={10} /> Add
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

// Row-list suggestion UI (vs. AdGroupAISuggestions' card layout) — headlines
// and descriptions are full sentences, not keyword-length chips, so they
// read better as rows. Backs onto the same rsaGenerateHeadlinesAI/
// rsaGenerateDescriptionsAI endpoints the AI RSA Builder already uses (30/90
// char limits, policy rules, duplicate-avoidance all already enforced there)
// rather than a new prompt — Display/PMax headlines and descriptions are the
// same Google Ads asset types RSA generates for Search.
export function CreativeSuggestionList({ title, loading, error, items, addedIdx, onFetch, onAdd }) {
  const visible = items.map((text, i) => ({ text, i })).filter(({ i }) => !addedIdx.has(i))
  const allAdded = !loading && !error && items.length > 0 && visible.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#6a3fc0', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          <Sparkles size={12} /> {title}
        </div>
        <button onClick={onFetch} disabled={loading} style={{ fontSize: 10, fontWeight: 600, color: '#6a3fc0', background: 'none', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}>
          {items.length > 0 ? '↻ Refresh' : 'Get Suggestions'}
        </button>
      </div>
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888', padding: '10px 12px' }}>
          <Loader2 size={12} className="spin" /> Writing suggestions…
        </div>
      )}
      {!loading && error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: '#c0392b', padding: '10px 12px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 7 }}>
          <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
        </div>
      )}
      {allAdded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#2e7d32', padding: '10px 12px', background: '#f0faf0', border: '1px solid #a8e0a8', borderRadius: 7 }}>
          <CheckCircle size={12} /> All suggestions added.
        </div>
      )}
      {!loading && !error && visible.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visible.map(({ text, i }) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 10px', background: '#f7f5ff', border: '1px solid #e0d9fb', borderRadius: 7 }}>
              <span style={{ flex: 1, fontSize: 11, color: '#3d2470', lineHeight: 1.4 }}>{text}</span>
              <button
                onClick={() => onAdd(text, i)}
                style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', color: '#fff', background: '#6a3fc0', border: 'none', borderRadius: '50%', width: 16, height: 16, cursor: 'pointer', padding: 0, justifyContent: 'center' }}
              >
                <Plus size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DisplayOrPMaxCreative({ form, set, includeLogo }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={label11}>Final URL</div>
        <input value={form.finalUrl} onChange={e => set('finalUrl', e.target.value)} placeholder="https://example.com/landing-page" style={inputStyle} />
      </div>
      <div>
        <div style={label11}>Business Name</div>
        <input value={form.businessName} onChange={e => set('businessName', e.target.value)} placeholder={form.name} style={inputStyle} />
      </div>
      <TextListEditor label="Headlines" items={form.headlines} onChange={v => set('headlines', v)} max={15} placeholder="Headline (max 30 chars)" minRequired={includeLogo ? 3 : 1} />
      <div>
        <div style={label11}>Long Headline</div>
        <input value={form.longHeadline} onChange={e => set('longHeadline', e.target.value)} placeholder="A longer, complete headline sentence" style={inputStyle} />
      </div>
      <TextListEditor label="Descriptions" items={form.descriptions} onChange={v => set('descriptions', v)} max={5} placeholder="Description" minRequired={includeLogo ? 2 : 1} />
      <ImageUrlEditor label="Marketing Images (1.91:1 landscape)" urls={form.marketingImageUrls} onChange={v => set('marketingImageUrls', v)} hint="At least one, e.g. 1200×628px" />
      <ImageUrlEditor label="Square Marketing Images (1:1)" urls={form.squareMarketingImageUrls} onChange={v => set('squareMarketingImageUrls', v)} hint="At least one, e.g. 1200×1200px" />
      {includeLogo && <ImageUrlEditor label="Logo (1:1 square)" urls={form.logoImageUrls} onChange={v => set('logoImageUrls', v)} hint="Required for Performance Max" />}
    </div>
  )
}

function ShoppingSettings({ form, set, merchantCenterId }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 420 }}>
      {!merchantCenterId && (
        <ModalWarning>No Merchant Center ID is configured. Add one in Settings before publishing a Shopping campaign.</ModalWarning>
      )}
      <div>
        <div style={label11}>Merchant Center ID</div>
        <input value={form.merchantId} onChange={e => set('merchantId', e.target.value)} placeholder={merchantCenterId || 'e.g. 123456789'} style={inputStyle} />
      </div>
      <div>
        <div style={label11}>Feed Label (country)</div>
        <input value={form.feedLabel} onChange={e => set('feedLabel', e.target.value.toUpperCase())} placeholder="US" style={inputStyle} />
      </div>
      <div>
        <div style={label11}>Ad Group Name</div>
        <input value={form.adGroupName} onChange={e => set('adGroupName', e.target.value)} placeholder="Shopping Ad Group" style={inputStyle} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', cursor: 'pointer' }}>
        <input type="checkbox" checked={form.enableLocal} onChange={e => set('enableLocal', e.target.checked)} />
        Enable local inventory ads
      </label>
      <div style={{ fontSize: 11, color: '#aaa' }}>Ships with a single "all products" listing group — no product subdivisions yet.</div>
    </div>
  )
}

function VideoCreative({ form, set }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 420 }}>
      <div>
        <div style={label11}>YouTube Video ID</div>
        <input value={form.youtubeVideoId} onChange={e => set('youtubeVideoId', e.target.value)} placeholder="e.g. dQw4w9WgXcQ (from the video URL)" style={inputStyle} />
      </div>
      <div>
        <div style={label11}>Final URL</div>
        <input value={form.finalUrl} onChange={e => set('finalUrl', e.target.value)} placeholder="https://example.com/landing-page" style={inputStyle} />
      </div>
      <div>
        <div style={label11}>Ad Group Name</div>
        <input value={form.adGroupName} onChange={e => set('adGroupName', e.target.value)} placeholder="Video Ad Group" style={inputStyle} />
      </div>
      <div>
        <div style={label11}>Call-to-Action Overlay Text</div>
        <input value={form.actionHeadline} onChange={e => set('actionHeadline', e.target.value)} placeholder={form.name} style={inputStyle} />
      </div>
      <div>
        <div style={label11}>Button Label</div>
        <input value={form.callToAction} onChange={e => set('callToAction', e.target.value)} placeholder="Learn More" style={inputStyle} />
      </div>
      <div>
        <div style={label11}>Target CPV ($)</div>
        <input type="number" min="0" step="0.01" value={form.targetCpv} onChange={e => set('targetCpv', e.target.value)} placeholder="e.g. 0.05" style={inputStyle} />
      </div>
    </div>
  )
}

const DEFAULT_FORM = {
  channel: 'search',
  name: '', dailyBudget: '50', startPaused: false, searchPartners: true,
  biddingStrategy: 'MAXIMIZE_CONVERSIONS', targetValue: '',
  locations: [], languages: [{ id: '1000', name: 'English' }],
  adGroups: [{ name: 'Ad Group 1', keywords: [{ text: '', matchType: 'BROAD' }], defaultMaxCpc: '' }],
  finalUrl: '', businessName: '',
  headlines: [''], longHeadline: '', descriptions: [''],
  marketingImageUrls: [''], squareMarketingImageUrls: [''], logoImageUrls: [''],
  merchantId: '', feedLabel: 'US', enableLocal: false, adGroupName: '',
  youtubeVideoId: '', actionHeadline: '', callToAction: 'Learn More', targetCpv: '0.05',
  containsEuPoliticalAdvertising: false,
}

export default function CreateTab({ selectedAccount }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [merchantCenterId, setMerchantCenterId] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  React.useEffect(() => {
    window.electronAPI.getSettings().then(s => setMerchantCenterId(s?.merchantCenterId || '')).catch(() => {})
  }, [])

  const [validating, setValidating] = useState(false)
  const [validateError, setValidateError] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState(null)
  const [publishError, setPublishError] = useState(null)

  const [adGroupRec,          setAdGroupRec]          = useState(null)
  const [adGroupRecLoading,   setAdGroupRecLoading]   = useState(false)
  const [adGroupRecError,     setAdGroupRecError]     = useState(null)
  const [addedSuggestionIdx,  setAddedSuggestionIdx]  = useState(new Set())

  function fetchAdGroupRec() {
    setAdGroupRecLoading(true); setAdGroupRecError(null); setAddedSuggestionIdx(new Set())
    window.electronAPI.campaignAiRecommendAdGroups({
      name: form.name,
      locations: form.locations.map(l => l.canonicalName || l.name),
      languages: form.languages.map(l => l.name),
    })
      .then(setAdGroupRec)
      .catch(err => setAdGroupRecError(err.message || 'Failed to get AI suggestions'))
      .finally(() => setAdGroupRecLoading(false))
  }

  // idx identifies which suggestion card was clicked so it can be hidden —
  // once added, it stays hidden until the next fetch (Refresh) resets the set,
  // so re-clicking the same suggestion can't create a duplicate ad group.
  const [headlineRec,        setHeadlineRec]        = useState([])
  const [headlineRecLoading, setHeadlineRecLoading] = useState(false)
  const [headlineRecError,   setHeadlineRecError]   = useState(null)
  const [addedHeadlineIdx,   setAddedHeadlineIdx]   = useState(new Set())

  const [descriptionRec,        setDescriptionRec]        = useState([])
  const [descriptionRecLoading, setDescriptionRecLoading] = useState(false)
  const [descriptionRecError,   setDescriptionRecError]   = useState(null)
  const [addedDescriptionIdx,   setAddedDescriptionIdx]   = useState(new Set())

  function fetchHeadlineRec() {
    setHeadlineRecLoading(true); setHeadlineRecError(null); setAddedHeadlineIdx(new Set())
    window.electronAPI.rsaGenerateHeadlinesAI({
      campaignName: form.name, businessName: form.businessName || form.name,
      existingHeadlines: form.headlines.filter(Boolean), count: 8,
    })
      .then(res => setHeadlineRec(res.headlines || []))
      .catch(err => setHeadlineRecError(err.message || 'Failed to get AI suggestions'))
      .finally(() => setHeadlineRecLoading(false))
  }

  function fetchDescriptionRec() {
    setDescriptionRecLoading(true); setDescriptionRecError(null); setAddedDescriptionIdx(new Set())
    window.electronAPI.rsaGenerateDescriptionsAI({
      campaignName: form.name, businessName: form.businessName || form.name,
      existingDescriptions: form.descriptions.filter(Boolean), count: 5,
    })
      .then(res => setDescriptionRec(res.descriptions || []))
      .catch(err => setDescriptionRecError(err.message || 'Failed to get AI suggestions'))
      .finally(() => setDescriptionRecLoading(false))
  }

  function fetchCreativeRec() {
    fetchHeadlineRec()
    fetchDescriptionRec()
  }

  function addSuggestedHeadline(text, idx) {
    setForm(f => {
      const isDefaultEmpty = f.headlines.length === 1 && !f.headlines[0].trim()
      const headlines = isDefaultEmpty ? [text] : f.headlines.length < 15 ? [...f.headlines, text] : f.headlines
      return { ...f, headlines }
    })
    setAddedHeadlineIdx(prev => new Set(prev).add(idx))
  }

  function addSuggestedDescription(text, idx) {
    setForm(f => {
      const isDefaultEmpty = f.descriptions.length === 1 && !f.descriptions[0].trim()
      const descriptions = isDefaultEmpty ? [text] : f.descriptions.length < 5 ? [...f.descriptions, text] : f.descriptions
      return { ...f, descriptions }
    })
    setAddedDescriptionIdx(prev => new Set(prev).add(idx))
  }

  function addSuggestedAdGroup(ag, idx) {
    setForm(f => {
      const isDefaultEmpty = f.adGroups.length === 1 && !f.adGroups[0].keywords.some(k => k.text.trim())
      const newGroup = { name: ag.name, keywords: ag.keywords.map(k => ({ text: k.text, matchType: k.matchType })) }
      return { ...f, adGroups: isDefaultEmpty ? [newGroup] : [...f.adGroups, newGroup] }
    })
    setAddedSuggestionIdx(prev => new Set(prev).add(idx))
  }

  const channelDef = CHANNEL_TYPES.find(c => c.id === form.channel)
  const steps = ['Channel', 'Campaign Settings', 'Targeting', channelDef.step3Label, 'Review & Publish']
  const isPMax = form.channel === 'pmax'
  const isDisplayOrPMax = form.channel === 'display' || form.channel === 'pmax'

  const validAdGroups = form.adGroups.filter(ag => ag.keywords.some(k => k.text.trim()))
  const canLeaveSettings = form.name.trim().length > 0 && Number(form.dailyBudget) > 0
    && (form.channel !== 'video' || Number(form.targetCpv) > 0)

  const canLeaveStep3 = (() => {
    if (form.channel === 'search') {
      if (validAdGroups.length === 0) return false
      if (form.biddingStrategy === 'MANUAL_CPC') return validAdGroups.every(ag => Number(ag.defaultMaxCpc) > 0)
      return true
    }
    if (form.channel === 'shopping') return !!(form.merchantId || merchantCenterId)
    if (form.channel === 'video')    return !!(form.youtubeVideoId && form.finalUrl)
    if (isDisplayOrPMax) {
      const minH = isPMax ? 3 : 1, minD = isPMax ? 2 : 1
      const hs = form.headlines.filter(Boolean), ds = form.descriptions.filter(Boolean)
      const hasImgs = form.marketingImageUrls.some(Boolean) && form.squareMarketingImageUrls.some(Boolean) && (!isPMax || form.logoImageUrls.some(Boolean))
      return !!form.finalUrl && hs.length >= minH && ds.length >= minD && hasImgs
    }
    return true
  })()

  function buildPayload(validateOnly) {
    const base = {
      customerId: selectedAccount.id, campaignName: form.name, name: form.name,
      dailyBudget: Number(form.dailyBudget), startPaused: form.startPaused,
      locations: form.locations, languages: form.languages,
      containsEuPoliticalAdvertising: form.containsEuPoliticalAdvertising,
      validateOnly,
    }
    if (form.channel === 'search') {
      return {
        ...base, biddingStrategy: form.biddingStrategy, targetValue: form.targetValue, searchPartners: form.searchPartners,
        adGroups: validAdGroups.map(ag => ({
          name: ag.name, defaultMaxCpc: ag.defaultMaxCpc,
          keywords: ag.keywords.filter(k => k.text.trim()).map(k => ({ text: k.text, matchType: k.matchType, maxCpc: k.maxCpc })),
        })),
      }
    }
    if (isDisplayOrPMax) {
      return {
        ...base, biddingStrategy: form.biddingStrategy, targetValue: form.targetValue,
        finalUrl: form.finalUrl, businessName: form.businessName || form.name,
        headlines: form.headlines.filter(Boolean), longHeadline: form.longHeadline, descriptions: form.descriptions.filter(Boolean),
        marketingImageUrls: form.marketingImageUrls.filter(Boolean), squareMarketingImageUrls: form.squareMarketingImageUrls.filter(Boolean),
        logoImageUrls: form.logoImageUrls.filter(Boolean),
        ...(form.channel === 'display' ? { adGroupName: form.adGroupName || 'Display Ad Group' } : {}),
      }
    }
    if (form.channel === 'shopping') {
      return {
        ...base, biddingStrategy: form.biddingStrategy, targetValue: form.targetValue,
        merchantId: form.merchantId || merchantCenterId, feedLabel: form.feedLabel, enableLocal: form.enableLocal,
        adGroupName: form.adGroupName || 'Shopping Ad Group',
      }
    }
    if (form.channel === 'video') {
      return {
        ...base, targetCpv: Number(form.targetCpv), youtubeVideoId: form.youtubeVideoId, finalUrl: form.finalUrl,
        adGroupName: form.adGroupName || 'Video Ad Group', actionHeadline: form.actionHeadline, callToAction: form.callToAction,
      }
    }
    return base
  }

  function enterReview() {
    setStep(4); setConfirmed(false); setPublishResult(null); setPublishError(null)
    setValidating(true); setValidateError(null)
    window.electronAPI[CREATE_FN[form.channel]](buildPayload(true))
      .catch(err => setValidateError(err.message || 'Validation failed'))
      .finally(() => setValidating(false))
  }

  function publish() {
    setPublishing(true); setPublishError(null)
    window.electronAPI[CREATE_FN[form.channel]](buildPayload(false))
      .then(setPublishResult)
      .catch(err => setPublishError(err.message || 'Failed to publish'))
      .finally(() => setPublishing(false))
  }

  function resetWizard() {
    setForm(DEFAULT_FORM)
    setStep(0); setPublishResult(null); setPublishError(null); setConfirmed(false)
    setAdGroupRec(null); setAdGroupRecError(null); setAddedSuggestionIdx(new Set())
  }

  const canConfirm = !validating && !validateError && !publishing && confirmed

  return (
    <div className="card" style={{ padding: 24, width: '100%' }}>
      <StepHeader steps={steps} step={step} />

      {step === 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a6b', marginBottom: 4 }}>Choose a campaign type</div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>Shopping requires a Merchant Center ID configured in Settings. Video campaign creation requires your Google Ads account to already be eligible for Video campaigns.</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {CHANNEL_TYPES.map(ch => {
              const Icon = ch.icon
              const active = form.channel === ch.id
              return (
                <div key={ch.id}
                  onClick={() => set('channel', ch.id)}
                  style={{ width: 130, padding: '18px 12px', borderRadius: 8, textAlign: 'center', border: active ? '2px solid #1a3a6b' : '1px solid #eef2f7', background: '#fff', cursor: 'pointer' }}
                >
                  <Icon size={22} color={active ? '#1a3a6b' : '#888'} style={{ marginBottom: 8 }} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: active ? '#1a3a6b' : '#555' }}>{ch.label}</div>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 20 }}>
            <button style={btnPrimary} onClick={() => setStep(1)}>Next <ArrowRight size={14} /></button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={label11}>Campaign Name</div>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder={`e.g. Roofing - Miami - ${channelDef.label}`} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 160 }}>
              <div style={label11}>Daily Budget ($)</div>
              <input type="number" min="0" step="0.01" value={form.dailyBudget} onChange={e => set('dailyBudget', e.target.value)} style={inputStyle} />
            </div>
            <div style={{ minWidth: 160 }}>
              {form.channel === 'search' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', marginTop: 22, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.searchPartners} onChange={e => set('searchPartners', e.target.checked)} />
                  Include Search Partners
                </label>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', marginTop: form.channel === 'search' ? 8 : 22, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.startPaused} onChange={e => set('startPaused', e.target.checked)} />
                Start paused (won't show if "Show Paused" is unchecked on Manage Campaigns)
              </label>
            </div>
          </div>
          {form.channel === 'video' ? (
            <div style={{ maxWidth: 200 }}>
              <div style={label11}>Target CPV ($)</div>
              <input type="number" min="0" step="0.01" value={form.targetCpv} onChange={e => set('targetCpv', e.target.value)} style={inputStyle} />
            </div>
          ) : (
            <div style={{ maxWidth: 320 }}>
              <BiddingStrategyPicker
                value={form.biddingStrategy} targetValue={form.targetValue}
                onChange={v => set('biddingStrategy', v)} onTargetChange={v => set('targetValue', v)}
                strategies={isPMax ? BIDDING_STRATEGIES.filter(b => b.value !== 'MANUAL_CPC') : undefined}
              />
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button style={btnGhost} onClick={() => setStep(0)}><ArrowLeft size={14} /> Back</button>
            <button style={canLeaveSettings ? btnPrimary : btnDisabled} disabled={!canLeaveSettings} onClick={() => setStep(2)}>Next <ArrowRight size={14} /></button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 11, color: '#aaa' }}>Locations and languages are optional — leave locations empty to target broadly (not usually recommended).</div>
          <ChipPicker
            label="Locations" selected={form.locations} onChange={v => set('locations', v)}
            placeholder="Search a city, state, or country…"
            searchFn={q => window.electronAPI.campaignSearchGeoTargets({ customerId: selectedAccount.id, query: q })}
            emptyHint="No locations selected yet."
          />
          <ChipPickerLanguages selectedAccount={selectedAccount} form={form} set={set} />
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button style={btnGhost} onClick={() => setStep(1)}><ArrowLeft size={14} /> Back</button>
            <button style={btnPrimary} onClick={() => { setStep(3); if (form.channel === 'search') fetchAdGroupRec(); else if (isDisplayOrPMax) fetchCreativeRec() }}>Next <ArrowRight size={14} /></button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {form.channel === 'search' && (
            <PanelSplit
              left={<AdGroupEditor adGroups={form.adGroups} onChange={v => set('adGroups', v)} requireCpc={form.biddingStrategy === 'MANUAL_CPC'} />}
              right={<AdGroupAISuggestions loading={adGroupRecLoading} error={adGroupRecError} data={adGroupRec} addedIdx={addedSuggestionIdx} onAdd={addSuggestedAdGroup} onRefresh={fetchAdGroupRec} />}
            />
          )}
          {isDisplayOrPMax && (
            <PanelSplit
              left={<DisplayOrPMaxCreative form={form} set={set} includeLogo={isPMax} />}
              right={
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <CreativeSuggestionList title="AI Suggested Headlines" loading={headlineRecLoading} error={headlineRecError} items={headlineRec} addedIdx={addedHeadlineIdx} onFetch={fetchHeadlineRec} onAdd={addSuggestedHeadline} />
                  <CreativeSuggestionList title="AI Suggested Descriptions" loading={descriptionRecLoading} error={descriptionRecError} items={descriptionRec} addedIdx={addedDescriptionIdx} onFetch={fetchDescriptionRec} onAdd={addSuggestedDescription} />
                </div>
              }
            />
          )}
          {form.channel === 'shopping' && <ShoppingSettings form={form} set={set} merchantCenterId={merchantCenterId} />}
          {form.channel === 'video'    && <VideoCreative form={form} set={set} />}
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button style={btnGhost} onClick={() => setStep(2)}><ArrowLeft size={14} /> Back</button>
            <button style={canLeaveStep3 ? btnPrimary : btnDisabled} disabled={!canLeaveStep3} onClick={enterReview}>Review <ArrowRight size={14} /></button>
          </div>
        </div>
      )}

      {step === 4 && !publishResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, color: '#555', lineHeight: 1.8 }}>
            <div><strong>Type:</strong> {channelDef.label}</div>
            <div><strong>Campaign:</strong> {form.name} ({form.startPaused ? 'starts Paused' : 'starts Active'})</div>
            <div><strong>Daily Budget:</strong> ${Number(form.dailyBudget).toFixed(2)}</div>
            {form.channel === 'video'
              ? <div><strong>Target CPV:</strong> ${Number(form.targetCpv).toFixed(2)}</div>
              : <div><strong>Bidding:</strong> {biddingStrategyLabel(form.biddingStrategy)}{form.targetValue ? ` (${form.targetValue})` : ''}</div>}
            <div><strong>Locations:</strong> {form.locations.length > 0 ? form.locations.map(l => l.canonicalName || l.name).join(', ') : 'None (broad)'}</div>
            <div><strong>Languages:</strong> {form.languages.map(l => l.name).join(', ') || 'None'}</div>
            {form.channel === 'search'   && <div><strong>Ad Groups:</strong> {validAdGroups.map(ag => `${ag.name} (${ag.keywords.filter(k => k.text.trim()).length} keywords${form.biddingStrategy === 'MANUAL_CPC' ? `, $${Number(ag.defaultMaxCpc || 0).toFixed(2)} default CPC` : ''})`).join(', ')}</div>}
            {isDisplayOrPMax              && <div><strong>Creative:</strong> {form.headlines.filter(Boolean).length} headlines, {form.descriptions.filter(Boolean).length} descriptions, {form.marketingImageUrls.filter(Boolean).length + form.squareMarketingImageUrls.filter(Boolean).length + form.logoImageUrls.filter(Boolean).length} images</div>}
            {form.channel === 'shopping' && <div><strong>Merchant Center:</strong> {form.merchantId || merchantCenterId} ({form.feedLabel})</div>}
            {form.channel === 'video'    && <div><strong>Video:</strong> youtube.com/watch?v={form.youtubeVideoId}</div>}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.containsEuPoliticalAdvertising} onChange={e => set('containsEuPoliticalAdvertising', e.target.checked)} />
            This campaign contains EU political advertising
          </label>

          {validating && <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#888' }}><Loader2 size={13} className="spin" />Checking with Google Ads…</div>}
          {validateError && <ModalError><AlertCircle size={14} style={{ marginRight: 6 }} />{validateError}</ModalError>}

          {!validating && !validateError && (
            <ModalWarning><strong>Live change:</strong> Publishing will create a real campaign in this Google Ads account.</ModalWarning>
          )}

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#555', cursor: 'pointer' }}>
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
            I understand this will create a live campaign in the Google Ads account.
          </label>

          <div style={{ display: 'flex', gap: 10 }}>
            <button style={btnGhost} onClick={() => setStep(3)} disabled={publishing}><ArrowLeft size={14} /> Back</button>
            <button style={canConfirm ? btnPrimary : btnDisabled} disabled={!canConfirm} onClick={publish}>
              {publishing ? 'Publishing…' : 'Publish Campaign'}
            </button>
          </div>
        </div>
      )}

      {step === 4 && publishResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
          <ModalSuccess><CheckCircle size={16} color="#2e7d32" style={{ marginRight: 6 }} />Campaign "{form.name}" created{form.startPaused ? ' (paused)' : ''}.</ModalSuccess>
          {publishResult.brandGuidelinesWarning && (
            <ModalWarning>Campaign created, but linking brand guidelines (business name/logo) failed: {publishResult.brandGuidelinesWarning}. The campaign still works — you can add these manually in Google Ads if needed.</ModalWarning>
          )}
          {form.channel === 'search' && (
            <div style={{ fontSize: 12, color: '#888' }}>Next, build your Responsive Search Ads for this ad group in the AI RSA Builder.</div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            {form.channel === 'search' && (
              <button
                style={btnPrimary}
                onClick={() => navigate('/ai-rsa-builder', {
                  state: {
                    campaignId: String(publishResult.campaignResourceName || '').split('/').pop(),
                    adGroupId:  String(publishResult.adGroups?.[0]?.resourceName || '').split('/').pop() || null,
                  },
                })}
              >
                Go to AI RSA Builder <ArrowRight size={14} />
              </button>
            )}
            <button style={btnGhost} onClick={resetWizard}>Create Another Campaign</button>
          </div>
        </div>
      )}
      {publishError && (
        <div style={{ marginTop: 12 }}>
          <ModalError><AlertCircle size={14} style={{ marginRight: 6 }} />{publishError}</ModalError>
        </div>
      )}
    </div>
  )
}

function ChipPickerLanguages({ selectedAccount, form, set }) {
  const [options, setOptions] = useState(null)
  React.useEffect(() => {
    window.electronAPI.campaignListLanguages({ customerId: selectedAccount.id }).then(setOptions).catch(() => setOptions([]))
  }, [selectedAccount])
  return (
    <ChipPicker
      label="Languages" selected={form.languages} onChange={v => set('languages', v)}
      placeholder="Search a language…"
      staticOptions={options || []}
      emptyHint={options ? 'No languages selected yet.' : 'Loading languages…'}
    />
  )
}
