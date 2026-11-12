import React, { useState, useEffect, useCallback } from 'react'
import { Loader2, CheckCircle, Upload, Search, AlertCircle, RefreshCw, Edit2, Globe, BarChart2, Link2 } from 'lucide-react'
import { Spinner, EditableCell, ASSET_LEVELS, DEFAULT_LEVEL, levelParam, AssetManageActions } from './shared.jsx'
import { sortByStatus } from '../campaign-manager/shared.jsx'

const CALLOUT_COUNTS = [2, 4, 6, 8, 10]
const DEFAULT_COUNT  = 4
const MAX_CHARS       = 25

// Lightweight client-side validation mirroring the policy rules.
function scoreCallout(text, allTexts, idx) {
  const issues = []
  if (!text?.trim()) { issues.push('Empty'); return { score: 0, issues } }
  let score = 100
  if (text.length > MAX_CHARS) { score -= 30; issues.push(`Over limit (${text.length}/${MAX_CHARS})`) }
  if (/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}/.test(text)) { score -= 25; issues.push('Contains phone number') }
  if (/https?:\/\//i.test(text)) { score -= 25; issues.push('Contains URL') }
  if (/\$\d|%\s*off|\bsale\b/i.test(text)) { score -= 15; issues.push('Promotional pricing') }
  const dupe = allTexts.some((t, i) => i !== idx && t?.toLowerCase().trim() === text.toLowerCase().trim())
  if (dupe) { score -= 20; issues.push('Duplicate callout') }
  return { score: Math.max(0, score), issues }
}

export default function CalloutTab({ selectedAccount, hidePaused }) {
  const [campaigns,    setCampaigns]    = useState([])
  const [adGroups,     setAdGroups]     = useState([])
  const [selectedCamp, setSelectedCamp] = useState('')
  const [selectedAG,   setSelectedAG]   = useState('')
  const [campLoading,  setCampLoading]  = useState(false)
  const [agLoading,    setAgLoading]    = useState(false)

  const [assetLevel,       setAssetLevel]       = useState(DEFAULT_LEVEL)
  const [count,            setCount]            = useState(DEFAULT_COUNT)
  const [preventCrossover, setPreventCrossover] = useState(true)

  const [existing,        setExisting]        = useState([])
  const [existingLoading, setExistingLoading]  = useState(false)
  const [error,           setError]            = useState(null)

  const [editingIdx, setEditingIdx] = useState(null)
  const [editText,   setEditText]   = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError,  setEditError]  = useState(null)

  const [generating, setGenerating] = useState(false)
  const [drafts,      setDrafts]    = useState(null)
  const [regenIdx,    setRegenIdx]  = useState(null)
  // Ad group's own landing page URL — lets the AI generation prompt tell
  // apart which saved Business Profile website this ad group belongs to,
  // for accounts that advertise more than one site through it.
  const [landingPageUrl, setLandingPageUrl] = useState('')
  const [publishingIdx, setPublishingIdx] = useState(null)
  const [publishedIdx,  setPublishedIdx]  = useState({})

  const selectedCampName = campaigns.find(c => c.id === selectedCamp)?.name || ''
  const selectedAGName   = adGroups.find(a => a.id === selectedAG)?.name   || ''
  const siblingAdGroupNames = adGroups.filter(a => a.id !== selectedAG).map(a => a.name).filter(Boolean)

  const needsAdGroup = assetLevel === 'Ad Group Level'
  const canGenerate  = assetLevel === 'Account Level'
    ? !!selectedAccount
    : assetLevel === 'Campaign Level'
    ? !!selectedCamp
    : !!selectedAG

  // ── Load campaigns ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedAccount) return
    setCampaigns([]); setAdGroups([])
    setSelectedCamp(''); setSelectedAG('')
    setExisting([]); setDrafts(null); setError(null)
    setCampLoading(true)
    // Always include paused campaigns — see SitelinksTab for the same call.
    window.electronAPI.rsaFetchCampaigns({ customerId: selectedAccount.id, hidePaused: false })
      .then(d => setCampaigns(sortByStatus(d || [])))
      .catch(e => setError(e.message))
      .finally(() => setCampLoading(false))
  }, [selectedAccount])

  // ── Load ad groups ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedAccount || !selectedCamp) { setAdGroups([]); setSelectedAG(''); return }
    setAdGroups([]); setSelectedAG('')
    setAgLoading(true)
    window.electronAPI.rsaFetchAdGroups({ customerId: selectedAccount.id, campaignId: selectedCamp })
      .then(d => setAdGroups(sortByStatus(d || [])))
      .catch(e => setError(e.message))
      .finally(() => setAgLoading(false))
  }, [selectedAccount, selectedCamp])

  // ── Fetch existing callouts whenever level/selection changes ─────────────
  const fetchExisting = useCallback(async () => {
    if (!canGenerate) { setExisting([]); return }
    setExistingLoading(true)
    try {
      const res = await window.electronAPI.rsaFetchCalloutAssets({
        customerId: selectedAccount.id, level: levelParam(assetLevel),
        campaignId: selectedCamp, adGroupId: selectedAG,
      })
      setExisting(res || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setExistingLoading(false)
    }
  }, [selectedAccount, assetLevel, selectedCamp, selectedAG, canGenerate])

  useEffect(() => { fetchExisting() }, [fetchExisting])

  async function handleGenerate() {
    if (!canGenerate) return
    setError(null); setGenerating(true); setDrafts(null); setPublishedIdx({})
    try {
      const builderData = selectedAG
        ? await window.electronAPI.rsaFetchBuilderData({ customerId: selectedAccount.id, adGroupId: selectedAG }).catch(() => null)
        : null
      const lpUrl = builderData?.rsaAds?.find(a => a.finalUrls?.length)?.finalUrls?.[0] || ''
      setLandingPageUrl(lpUrl)
      const res = await window.electronAPI.rsaGenerateCalloutsAI({
        customerId: selectedAccount.id,
        campaignName: selectedCampName, adGroupName: selectedAGName,
        keywords: builderData?.keywords || [], count,
        existingCallouts: existing.map(c => c.text),
        preventCrossover, siblingAdGroupNames,
        landingPageUrl: lpUrl,
      })
      if (!res?.callouts?.length) throw new Error('No callouts returned. Please try again.')
      setDrafts(res.callouts.map(text => ({ text })))
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
      const res = await window.electronAPI.rsaRegenerateSingleCallout({
        customerId: selectedAccount.id,
        campaignName: selectedCampName, adGroupName: selectedAGName,
        keywords: [], existingCallouts: [...existing.map(c => c.text), ...drafts.map(d => d.text)],
        index: existing.length + idx, preventCrossover, siblingAdGroupNames,
        landingPageUrl,
      })
      if (res?.text) updateDraft(idx, res.text)
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
      await window.electronAPI.rsaPublishCallout({
        customerId: selectedAccount.id, level: levelParam(assetLevel),
        campaignId: selectedCamp, adGroupId: selectedAG, text: draft.text,
      })
      setPublishedIdx(prev => ({ ...prev, [idx]: true }))
      await fetchExisting()
    } catch (e) {
      setError(`Publish failed for row ${idx + 1}: ${e.message}`)
    } finally {
      setPublishingIdx(null)
    }
  }

  function startEdit(idx, c) {
    setEditingIdx(idx); setEditText(c.text); setEditError(null)
  }

  async function saveEdit(c) {
    if (!editText.trim()) { setEditError('Callout text is required.'); return }
    setEditSaving(true); setEditError(null)
    try {
      await window.electronAPI.rsaEditCalloutAsset({ customerId: selectedAccount.id, resourceName: c.resourceName, text: editText })
      setEditingIdx(null)
      await fetchExisting()
    } catch (e) {
      setEditError(e.message || 'Failed to save changes')
    } finally {
      setEditSaving(false)
    }
  }

  if (!selectedAccount) return null

  return (
    <>
      {/* ── Setup card ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><span className="card-title">Campaign, Ad Group &amp; Settings</span></div>
        <div style={{ padding: '16px' }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5 }}>Campaign</label>
              {campLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#888', fontSize: 12 }}><Loader2 size={13} className="spin" /> Loading…</div>
              ) : (
                <select value={selectedCamp} onChange={e => setSelectedCamp(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #dde9f5', borderRadius: 6, fontSize: 13, color: '#1a3a6b', outline: 'none', background: '#fff' }}>
                  <option value="">— Select Campaign —</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
                </select>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5 }}>Ad Group {needsAdGroup && <span style={{ color: '#c0392b' }}>*</span>}</label>
              {agLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#888', fontSize: 12 }}><Loader2 size={13} className="spin" /> Loading…</div>
              ) : (
                <select value={selectedAG} onChange={e => setSelectedAG(e.target.value)} disabled={!selectedCamp} style={{ padding: '8px 10px', border: '1px solid #dde9f5', borderRadius: 6, fontSize: 13, color: '#1a3a6b', outline: 'none', background: !selectedCamp ? '#f5f7fa' : '#fff' }}>
                  <option value="">— Select Ad Group —</option>
                  {adGroups.map(ag => <option key={ag.id} value={ag.id}>{ag.name} ({ag.status})</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Asset Level */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 8 }}>Asset Level</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ASSET_LEVELS.map(level => {
                const active = assetLevel === level
                const icons = { 'Account Level': Globe, 'Campaign Level': BarChart2, 'Ad Group Level': Link2 }
                const Icon = icons[level]
                return (
                  <button key={level} onClick={() => setAssetLevel(level)} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    border: `1.5px solid ${active ? '#1a3a6b' : '#dde9f5'}`, background: active ? '#1a3a6b' : '#fff', color: active ? '#fff' : '#555', cursor: 'pointer',
                  }}><Icon size={13} /> {level}</button>
                )
              })}
            </div>
          </div>

          {/* Count */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 8 }}>Number of Callouts</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {CALLOUT_COUNTS.map(n => (
                <button key={n} onClick={() => setCount(n)} style={{
                  width: 44, height: 36, fontSize: 13, fontWeight: 700, borderRadius: 6,
                  border: `1.5px solid ${count === n ? '#1a3a6b' : '#dde9f5'}`, background: count === n ? '#1a3a6b' : '#fff', color: count === n ? '#fff' : '#555', cursor: 'pointer',
                }}>{n}</button>
              ))}
            </div>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 14px', borderRadius: 6, marginBottom: 16, background: preventCrossover ? '#eef6ff' : '#f5f7fa', border: `1px solid ${preventCrossover ? '#9fc4ec' : '#dde9f5'}` }}>
            <input type="checkbox" checked={preventCrossover} onChange={e => setPreventCrossover(e.target.checked)} style={{ accentColor: '#1a3a6b', width: 15, height: 15 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1a3a6b' }}>🔒 Prevent ad group crossover</span>
          </label>

          <div>
            <button onClick={handleGenerate} disabled={!canGenerate || generating} style={{
              display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 28px',
              background: (!canGenerate || generating) ? '#dde9f5' : '#1a3a6b', color: (!canGenerate || generating) ? '#aaa' : '#fff',
              fontWeight: 700, fontSize: 14, borderRadius: 7, border: 'none', cursor: (!canGenerate || generating) ? 'not-allowed' : 'pointer',
            }}>
              {generating ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
              {generating ? 'Generating…' : `Generate ${count} Callouts with AI`}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertCircle size={16} color="#c0392b" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13, color: '#c0392b' }}>{error}</span>
        </div>
      )}

      {/* Existing callouts */}
      {canGenerate && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><span className="card-title">Existing Callouts at this Level ({existingLoading ? '…' : existing.length})</span></div>
          <div style={{ padding: '16px' }}>
            {existingLoading ? <Spinner label="Loading existing callouts…" /> : existing.length === 0 ? (
              <div style={{ fontSize: 13, color: '#aaa', textAlign: 'center', padding: '8px 0' }}>No callouts yet at this level.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {existing.map((c, i) => (
                  editingIdx === i ? (
                    <div key={i} style={{ width: '100%', maxWidth: 360, padding: '10px 12px', background: '#fafcff', border: '1px solid #9fc4ec', borderRadius: 8 }}>
                      <EditableCell value={editText} max={MAX_CHARS} onChange={setEditText} placeholder="Callout text" />
                      {editError && <div style={{ marginTop: 4, fontSize: 10, color: '#c0392b' }}>{editError}</div>}
                      <div style={{ marginTop: 6, fontSize: 9, color: '#a56700' }}>Editing changes this callout everywhere it's used.</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <button onClick={() => saveEdit(c)} disabled={editSaving} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 4, border: '1px solid #1a3a6b', background: '#1a3a6b', color: '#fff', cursor: editSaving ? 'not-allowed' : 'pointer' }}>
                          {editSaving ? <Loader2 size={10} className="spin" /> : 'Save'}
                        </button>
                        <button onClick={() => setEditingIdx(null)} disabled={editSaving} style={{ fontSize: 11, padding: '4px 10px', background: 'none', color: '#888', border: '1px solid #dde9f5', borderRadius: 4, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span key={i} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                      background: c.status === 'Paused' ? '#fff8e6' : '#f0fdf4',
                      border: `1px solid ${c.status === 'Paused' ? '#f0c040' : '#c8e6c9'}`,
                      borderRadius: 20, fontSize: 12, fontWeight: 600, color: c.status === 'Paused' ? '#a56700' : '#2e7d32',
                    }}>
                      {c.text}
                      {c.status === 'Paused' && <span style={{ fontSize: 9, fontWeight: 700 }}>PAUSED</span>}
                      <AssetManageActions
                        selectedAccount={selectedAccount} level={levelParam(assetLevel)}
                        campaignId={selectedCamp} adGroupId={selectedAG}
                        linkResourceName={c.linkResourceName} currentStatus={c.status}
                        onChanged={fetchExisting}
                        onEdit={() => startEdit(i, c)}
                      />
                    </span>
                  )
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Generated drafts */}
      {generating && (
        <div className="card" style={{ marginBottom: 20 }}><Spinner label="AI generating callouts…" sub={`Creating ${count} unique benefit-focused callouts…`} /></div>
      )}

      {drafts && !generating && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">Generated Callouts — Review &amp; Publish</span>
            <button onClick={handleGenerate} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #555', background: 'transparent', color: '#555', cursor: 'pointer' }}>
              <RefreshCw size={11} /> Re-Generate All
            </button>
          </div>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {drafts.map((d, idx) => {
              const allTexts = drafts.map(x => x.text)
              const q        = scoreCallout(d.text, allTexts, idx)
              const regen    = regenIdx === idx
              const publish  = publishingIdx === idx
              const done     = publishedIdx[idx]
              const blocked  = publish || q.score < 70
              return (
                <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', background: done ? '#f0fdf4' : '#fafcff', border: `1px solid ${done ? '#c8e6c9' : '#eef2f7'}`, borderRadius: 7 }}>
                  <span style={{ fontSize: 11, color: '#aaa', fontWeight: 700, marginTop: 6 }}>{idx + 1}</span>
                  <div style={{ flex: 1 }}>
                    <EditableCell value={d.text} max={MAX_CHARS} onChange={v => updateDraft(idx, v)} placeholder="Callout text" />
                    {q.issues.length > 0 && <div style={{ marginTop: 4, fontSize: 10, color: '#c0392b' }}>⚠ {q.issues.join(' · ')}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                    <button onClick={() => handleRegen(idx)} disabled={regen} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #e65100', background: '#fff', color: '#e65100', cursor: regen ? 'not-allowed' : 'pointer' }}>
                      {regen ? <Loader2 size={10} className="spin" /> : <RefreshCw size={10} />} {regen ? 'Generating…' : 'Re-Generate'}
                    </button>
                    {done ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#2e7d32' }}><CheckCircle size={12} /> Published</span>
                    ) : (
                      <button onClick={() => handlePublish(idx)} disabled={blocked} title={q.score < 70 ? `Fix issues first: ${q.issues.join(', ')}` : ''} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 4,
                        border: `1px solid ${blocked ? '#aaa' : '#1a3a6b'}`, background: blocked ? '#f5f5f5' : '#1a3a6b', color: blocked ? '#aaa' : '#fff', cursor: blocked ? 'not-allowed' : 'pointer',
                      }}>
                        {publish ? <Loader2 size={10} className="spin" /> : <Upload size={10} />} {publish ? 'Publishing…' : 'Publish'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!canGenerate && !error && (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
          {assetLevel === 'Campaign Level' && 'Select a Campaign above.'}
          {assetLevel === 'Ad Group Level' && 'Select a Campaign and Ad Group above.'}
        </div>
      )}
    </>
  )
}
