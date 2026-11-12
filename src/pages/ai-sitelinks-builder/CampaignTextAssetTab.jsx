import React, { useState, useEffect } from 'react'
import { Loader2, CheckCircle, Upload, Search, AlertCircle, RefreshCw } from 'lucide-react'
import { Spinner, charColor, EditableCell, AssetManageActions } from './shared.jsx'
import { sortByStatus } from '../campaign-manager/shared.jsx'

const NUMBER_WORDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' }

const CONFIG = {
  HEADLINE: {
    label: 'Headline', plural: 'headlines', maxChars: 30, cap: 3,
    fetchFn: 'rsaFetchHeadlineAssets', addFn: 'rsaAddHeadlineAsset', generateFn: 'rsaGenerateHeadlinesAI',
  },
  DESCRIPTION: {
    label: 'Description', plural: 'descriptions', maxChars: 90, cap: 2,
    fetchFn: 'rsaFetchDescriptionAssets', addFn: 'rsaAddDescriptionAsset', generateFn: 'rsaGenerateDescriptionsAI',
  },
}

// Lightweight client-side validation mirroring the policy rules above —
// catches obvious violations before the user even tries to publish.
function scoreText(text, maxChars) {
  const issues = []
  if (!text?.trim()) { issues.push('Empty'); return { score: 0, issues } }
  let score = 100
  if (text.length > maxChars) { score -= 30; issues.push(`Over limit (${text.length}/${maxChars})`) }
  const letters = text.replace(/[^a-zA-Z]/g, '')
  const upper   = text.replace(/[^A-Z]/g, '')
  if (letters.length > 6 && upper.length / letters.length > 0.6) { score -= 25; issues.push('Excessive capitalization') }
  if (/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}/.test(text)) { score -= 25; issues.push('Contains phone number') }
  if (/\b(best|#1|guaranteed|world'?s? best|unbeatable)\b/i.test(text)) { score -= 15; issues.push('Unsupported superlative claim') }
  if (/!{2,}|\?{2,}/.test(text)) { score -= 15; issues.push('Excessive punctuation') }
  return { score: Math.max(0, score), issues }
}

export default function CampaignTextAssetTab({ selectedAccount, hidePaused, fieldType }) {
  const cfg = CONFIG[fieldType]

  const [campaigns,    setCampaigns]    = useState([])
  const [selectedCamp, setSelectedCamp] = useState('')
  const [campLoading,  setCampLoading]  = useState(false)

  const [existing,        setExisting]        = useState(null) // array of { text, status, resourceName }
  const [existingLoading, setExistingLoading]  = useState(false)
  const [error,           setError]            = useState(null)

  const [generating, setGenerating] = useState(false)
  const [drafts,      setDrafts]    = useState(null) // array of { text } pending publish
  const [regenIdx,    setRegenIdx]  = useState(null)
  const [publishingIdx, setPublishingIdx] = useState(null)
  const [publishedIdx,  setPublishedIdx]  = useState({})

  const selectedCampObj  = campaigns.find(c => c.id === selectedCamp)
  const selectedCampName = selectedCampObj?.name || ''
  // Performance Max campaigns don't support campaign-scoped Headline/Description
  // text assets via campaign_asset — those live in Asset Groups instead, a
  // completely different mechanism. Trying to add one here is a no-op at best.
  const isPMax = ['PERFORMANCE_MAX', '10'].includes(selectedCampObj?.channelType)

  // ── Load campaigns ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedAccount) return
    setCampaigns([]); setSelectedCamp(''); setExisting(null); setDrafts(null); setError(null)
    setCampLoading(true)
    // Always include paused campaigns — see SitelinksTab for the same call.
    window.electronAPI.rsaFetchCampaigns({ customerId: selectedAccount.id, hidePaused: false })
      .then(d => setCampaigns(sortByStatus(d || [])))
      .catch(e => setError(e.message))
      .finally(() => setCampLoading(false))
  }, [selectedAccount])

  // ── Load existing assets when campaign changes ───────────────────────────
  useEffect(() => {
    setExisting(null); setDrafts(null); setPublishedIdx({}); setError(null)
    if (!selectedCamp || isPMax) return
    setExistingLoading(true)
    window.electronAPI[cfg.fetchFn]({ customerId: selectedAccount.id, campaignId: selectedCamp })
      .then(res => setExisting(res))
      .catch(e => setError(e.message))
      .finally(() => setExistingLoading(false))
  }, [selectedCamp, isPMax])

  function refetchExisting() {
    window.electronAPI[cfg.fetchFn]({ customerId: selectedAccount.id, campaignId: selectedCamp })
      .then(setExisting)
      .catch(e => setError(e.message))
  }

  const existingCount = existing?.length || 0
  const remaining      = Math.max(0, cfg.cap - existingCount)
  const atCap           = existing !== null && existingCount >= cfg.cap

  async function handleGenerate() {
    if (!selectedCamp || remaining <= 0) return
    setGenerating(true); setError(null); setDrafts(null)
    try {
      const res = await window.electronAPI[cfg.generateFn]({
        campaignName: selectedCampName,
        businessName: selectedAccount.name,
        [fieldType === 'HEADLINE' ? 'existingHeadlines' : 'existingDescriptions']: (existing || []).map(a => a.text),
        count: remaining,
      })
      const items = (fieldType === 'HEADLINE' ? res?.headlines : res?.descriptions) || []
      if (!items.length) throw new Error(`No ${cfg.plural} returned. Please try again.`)
      setDrafts(items.map(text => ({ text })))
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  function updateDraft(idx, text) {
    setDrafts(prev => prev.map((d, i) => i === idx ? { text } : d))
  }

  async function handleRegen(idx) {
    if (!drafts) return
    setRegenIdx(idx)
    try {
      const res = await window.electronAPI[cfg.generateFn]({
        campaignName: selectedCampName,
        businessName: selectedAccount.name,
        [fieldType === 'HEADLINE' ? 'existingHeadlines' : 'existingDescriptions']:
          [...(existing || []).map(a => a.text), ...drafts.filter((_, i) => i !== idx).map(d => d.text)],
        count: 1,
      })
      const items = (fieldType === 'HEADLINE' ? res?.headlines : res?.descriptions) || []
      if (items[0]) updateDraft(idx, items[0])
    } catch (e) {
      setError(`Row ${idx + 1} re-generation failed: ${e.message}`)
    } finally {
      setRegenIdx(null)
    }
  }

  async function handlePublish(idx) {
    const draft = drafts?.[idx]
    if (!draft?.text?.trim()) return
    setPublishingIdx(idx); setError(null)
    try {
      await window.electronAPI[cfg.addFn]({ customerId: selectedAccount.id, campaignId: selectedCamp, text: draft.text })
      setPublishedIdx(prev => ({ ...prev, [idx]: true }))
      const refreshed = await window.electronAPI[cfg.fetchFn]({ customerId: selectedAccount.id, campaignId: selectedCamp })
      setExisting(refreshed)
    } catch (e) {
      setError(`Publish failed for row ${idx + 1}: ${e.message}`)
    } finally {
      setPublishingIdx(null)
    }
  }

  if (!selectedAccount) return null

  return (
    <>
      {/* ── Setup card ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">Select Campaign</span>
        </div>
        <div style={{ padding: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxWidth: 420 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5 }}>Campaign</label>
            {campLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#888', fontSize: 12 }}>
                <Loader2 size={13} className="spin" /> Loading…
              </div>
            ) : (
              <select value={selectedCamp} onChange={e => setSelectedCamp(e.target.value)} style={{
                padding: '8px 10px', border: '1px solid #dde9f5', borderRadius: 6,
                fontSize: 13, color: '#1a3a6b', outline: 'none', background: '#fff',
              }}>
                <option value="">— Select Campaign —</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertCircle size={16} color="#c0392b" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13, color: '#c0392b' }}>{error}</span>
        </div>
      )}

      {!selectedCamp && !error && (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
          Select a <strong>Campaign</strong> above to manage its {cfg.plural}.
        </div>
      )}

      {selectedCamp && isPMax && (
        <div style={{ marginBottom: 16, padding: '14px 16px', background: '#fff8e6', border: '1px solid #ffe0b2', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertCircle size={16} color="#a56700" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: '#a56700', lineHeight: 1.6 }}>
            <strong>Not applicable for Performance Max campaigns.</strong><br />
            Campaign-level {cfg.plural} aren't supported for Performance Max — PMax campaigns generate their own {cfg.plural} from Asset Groups instead. Select a Search campaign to manage {cfg.plural} here.
          </div>
        </div>
      )}

      {existingLoading && !isPMax && (
        <div className="card" style={{ marginBottom: 20 }}>
          <Spinner label={`Loading existing ${cfg.plural}…`} />
        </div>
      )}

      {/* ── Existing assets + generation ── */}
      {selectedCamp && !existingLoading && existing !== null && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <span className="card-title">Existing {cfg.label}s ({existingCount}/{cfg.cap})</span>
            </div>
            <div style={{ padding: '16px' }}>
              {existingCount === 0 ? (
                <div style={{ fontSize: 13, color: '#aaa', textAlign: 'center', padding: '12px 0' }}>No {cfg.plural} yet on this campaign.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {existing.map((a, i) => {
                    const paused = a.status === 'Paused'
                    return (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 6,
                        background: paused ? '#fff8e6' : '#f0fdf4', border: `1px solid ${paused ? '#f0c040' : '#c8e6c9'}`,
                      }}>
                        <span style={{ fontSize: 13, color: '#1a3a6b', fontWeight: 600 }}>{a.text}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: paused ? '#a56700' : '#2e7d32' }}>
                            {paused ? 'Paused' : <><CheckCircle size={12} /> Live</>}
                          </span>
                          <AssetManageActions
                            selectedAccount={selectedAccount} level="campaign"
                            campaignId={selectedCamp}
                            linkResourceName={a.linkResourceName} currentStatus={a.status}
                            onChanged={refetchExisting}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {atCap ? (
                <div style={{ marginTop: 14, padding: '10px 14px', background: '#fff8e6', border: '1px solid #ffe0b2', borderRadius: 6 }}>
                  <button disabled style={{
                    padding: '9px 20px', fontWeight: 700, fontSize: 13, borderRadius: 7, border: 'none',
                    background: '#dde9f5', color: '#aaa', cursor: 'not-allowed', marginBottom: 8,
                  }}>
                    Add New {cfg.label}
                  </button>
                  <div style={{ fontSize: 12, color: '#a56700' }}>
                    You can't add more than {NUMBER_WORDS[cfg.cap]} {cfg.plural} to each campaign. The selected campaign already have {NUMBER_WORDS[cfg.cap]} {cfg.plural}.
                  </div>
                </div>
              ) : !drafts && (
                <div style={{ marginTop: 14 }}>
                  <button onClick={handleGenerate} disabled={generating} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px',
                    background: generating ? '#dde9f5' : '#1a3a6b', color: generating ? '#aaa' : '#fff',
                    fontWeight: 700, fontSize: 13, borderRadius: 7, border: 'none',
                    cursor: generating ? 'not-allowed' : 'pointer',
                  }}>
                    {generating ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
                    {generating ? 'Generating…' : `Generate ${remaining} ${cfg.label}${remaining > 1 ? 's' : ''} with AI`}
                  </button>
                  <div style={{ marginTop: 6, fontSize: 11, color: '#888' }}>
                    This campaign can have {remaining} more {remaining === 1 ? cfg.label.toLowerCase() : cfg.plural} (max {cfg.cap} total).
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Drafts — editable, regenerate, publish */}
          {drafts && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="card-title">Generated {cfg.label}s — Review &amp; Publish</span>
                <button onClick={handleGenerate} disabled={generating}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #555', background: 'transparent', color: '#555', cursor: 'pointer' }}>
                  <RefreshCw size={11} /> Re-Generate All
                </button>
              </div>
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {drafts.map((d, idx) => {
                  const q       = scoreText(d.text, cfg.maxChars)
                  const regen   = regenIdx === idx
                  const publish = publishingIdx === idx
                  const done    = publishedIdx[idx]
                  const blocked = publish || q.score < 70
                  return (
                    <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', background: done ? '#f0fdf4' : '#fafcff', border: `1px solid ${done ? '#c8e6c9' : '#eef2f7'}`, borderRadius: 7 }}>
                      <span style={{ fontSize: 11, color: '#aaa', fontWeight: 700, marginTop: 6 }}>{idx + 1}</span>
                      <div style={{ flex: 1 }}>
                        <EditableCell value={d.text} max={cfg.maxChars} onChange={v => updateDraft(idx, v)} multiline={fieldType === 'DESCRIPTION'} placeholder={cfg.label} />
                        {q.issues.length > 0 && (
                          <div style={{ marginTop: 4, fontSize: 10, color: '#c0392b' }}>⚠ {q.issues.join(' · ')}</div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                        <button onClick={() => handleRegen(idx)} disabled={regen}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #e65100', background: '#fff', color: '#e65100', cursor: regen ? 'not-allowed' : 'pointer' }}>
                          {regen ? <Loader2 size={10} className="spin" /> : <RefreshCw size={10} />}
                          {regen ? 'Generating…' : 'Re-Generate'}
                        </button>
                        {done ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#2e7d32' }}>
                            <CheckCircle size={12} /> Published
                          </span>
                        ) : (
                          <button onClick={() => handlePublish(idx)} disabled={blocked}
                            title={q.score < 70 ? `Fix issues first: ${q.issues.join(', ')}` : ''}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 4,
                              border: `1px solid ${blocked ? '#aaa' : '#1a3a6b'}`, background: blocked ? '#f5f5f5' : '#1a3a6b', color: blocked ? '#aaa' : '#fff',
                              cursor: blocked ? 'not-allowed' : 'pointer',
                            }}>
                            {publish ? <Loader2 size={10} className="spin" /> : <Upload size={10} />}
                            {publish ? 'Publishing…' : 'Publish'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
