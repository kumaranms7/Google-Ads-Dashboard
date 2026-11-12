import React, { useState, useEffect, useCallback } from 'react'
import { Loader2, CheckCircle, Upload, Search, AlertCircle, RefreshCw, Globe, BarChart2, Link2 } from 'lucide-react'
import { Spinner, EditableCell, ASSET_LEVELS, DEFAULT_LEVEL, levelParam, AssetManageActions } from './shared.jsx'
import { sortByStatus } from '../campaign-manager/shared.jsx'

const HEADER_OPTIONS = [
  'Amenities', 'Brands', 'Courses', 'Degree programs', 'Destinations',
  'Featured hotels', 'Insurance coverage', 'Models', 'Neighborhoods',
  'Service catalog', 'Shows', 'Styles', 'Types',
]
const VALUE_COUNTS = [3, 4, 5, 6, 8, 10]
const DEFAULT_COUNT = 5
const MAX_CHARS = 25

const PROMO_RE = /\b(free|best|call now|guaranteed|#1)\b|\$\d|%\s*off/i

function scoreValue(text, allValues, idx) {
  const issues = []
  if (!text?.trim()) { issues.push('Empty'); return { score: 0, issues } }
  let score = 100
  if (text.length > MAX_CHARS) { score -= 30; issues.push(`Over limit (${text.length}/${MAX_CHARS})`) }
  if (PROMO_RE.test(text)) { score -= 25; issues.push('Promotional text') }
  const dupe = allValues.some((t, i) => i !== idx && t?.toLowerCase().trim() === text.toLowerCase().trim())
  if (dupe) { score -= 20; issues.push('Duplicate value') }
  return { score: Math.max(0, score), issues }
}

export default function StructuredSnippetTab({ selectedAccount, hidePaused }) {
  const [campaigns,    setCampaigns]    = useState([])
  const [adGroups,     setAdGroups]     = useState([])
  const [selectedCamp, setSelectedCamp] = useState('')
  const [selectedAG,   setSelectedAG]   = useState('')
  const [campLoading,  setCampLoading]  = useState(false)
  const [agLoading,    setAgLoading]    = useState(false)

  const [assetLevel,       setAssetLevel]       = useState(DEFAULT_LEVEL)
  const [header,           setHeader]           = useState('Service catalog')
  const [count,            setCount]            = useState(DEFAULT_COUNT)
  const [preventCrossover, setPreventCrossover] = useState(true)

  const [existing,        setExisting]        = useState([])
  const [existingLoading, setExistingLoading]  = useState(false)
  const [error,           setError]            = useState(null)

  const [editingIdx,   setEditingIdx]   = useState(null)
  const [editHeader,   setEditHeader]   = useState('')
  const [editValues,   setEditValues]   = useState([])
  const [editSaving,   setEditSaving]   = useState(false)
  const [editError,    setEditError]    = useState(null)

  const [generating, setGenerating] = useState(false)
  const [draftValues, setDraftValues] = useState(null) // array of strings
  const [checked,     setChecked]     = useState({})   // { idx: bool } — which values to include in the publish
  const [regenIdx,    setRegenIdx]    = useState(null)
  // Ad group's own landing page URL — lets the AI generation prompt tell
  // apart which saved Business Profile website this ad group belongs to,
  // for accounts that advertise more than one site through it.
  const [landingPageUrl, setLandingPageUrl] = useState('')
  const [publishing,  setPublishing]  = useState(false)
  const [published,   setPublished]   = useState(false)

  const selectedCampName = campaigns.find(c => c.id === selectedCamp)?.name || ''
  const selectedAGName   = adGroups.find(a => a.id === selectedAG)?.name   || ''
  const siblingAdGroupNames = adGroups.filter(a => a.id !== selectedAG).map(a => a.name).filter(Boolean)

  const needsAdGroup = assetLevel === 'Ad Group Level'
  const canGenerate  = assetLevel === 'Account Level'
    ? !!selectedAccount
    : assetLevel === 'Campaign Level'
    ? !!selectedCamp
    : !!selectedAG

  useEffect(() => {
    if (!selectedAccount) return
    setCampaigns([]); setAdGroups([])
    setSelectedCamp(''); setSelectedAG('')
    setExisting([]); setDraftValues(null); setError(null)
    setCampLoading(true)
    // Always include paused campaigns — see SitelinksTab for the same call.
    window.electronAPI.rsaFetchCampaigns({ customerId: selectedAccount.id, hidePaused: false })
      .then(d => setCampaigns(sortByStatus(d || [])))
      .catch(e => setError(e.message))
      .finally(() => setCampLoading(false))
  }, [selectedAccount])

  useEffect(() => {
    if (!selectedAccount || !selectedCamp) { setAdGroups([]); setSelectedAG(''); return }
    setAdGroups([]); setSelectedAG('')
    setAgLoading(true)
    window.electronAPI.rsaFetchAdGroups({ customerId: selectedAccount.id, campaignId: selectedCamp })
      .then(d => setAdGroups(sortByStatus(d || [])))
      .catch(e => setError(e.message))
      .finally(() => setAgLoading(false))
  }, [selectedAccount, selectedCamp])

  const fetchExisting = useCallback(async () => {
    if (!canGenerate) { setExisting([]); return }
    setExistingLoading(true)
    try {
      const res = await window.electronAPI.rsaFetchStructuredSnippetAssets({
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
    setError(null); setGenerating(true); setDraftValues(null); setPublished(false)
    try {
      const builderData = selectedAG
        ? await window.electronAPI.rsaFetchBuilderData({ customerId: selectedAccount.id, adGroupId: selectedAG }).catch(() => null)
        : null
      const lpUrl = builderData?.rsaAds?.find(a => a.finalUrls?.length)?.finalUrls?.[0] || ''
      setLandingPageUrl(lpUrl)
      const res = await window.electronAPI.rsaGenerateStructuredSnippetAI({
        customerId: selectedAccount.id,
        campaignName: selectedCampName, adGroupName: selectedAGName,
        header, count, keywords: builderData?.keywords || [],
        preventCrossover, siblingAdGroupNames,
        landingPageUrl: lpUrl,
      })
      if (!res?.values?.length) throw new Error('No values returned. Please try again.')
      setDraftValues(res.values)
      setChecked(Object.fromEntries(res.values.map((_, i) => [i, true]))) // all selected by default
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  function updateValue(idx, text) {
    setDraftValues(prev => prev.map((v, i) => i === idx ? text : v))
  }

  function toggleChecked(idx) {
    setChecked(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  async function handleRegenValue(idx) {
    if (!draftValues) return
    setRegenIdx(idx)
    try {
      const res = await window.electronAPI.rsaRegenerateSingleSnippetValue({
        customerId: selectedAccount.id,
        campaignName: selectedCampName, adGroupName: selectedAGName,
        header, keywords: [], existingValues: draftValues, index: idx,
        preventCrossover, siblingAdGroupNames,
        landingPageUrl,
      })
      if (res?.text) updateValue(idx, res.text)
    } catch (e) {
      setError(`Value ${idx + 1} re-generation failed: ${e.message}`)
    } finally {
      setRegenIdx(null)
    }
  }

  async function handlePublish() {
    if (checkedValues.length < 3) {
      setError(`Select at least 3 values to publish — Google requires a minimum of 3 per Structured Snippet asset. Currently ${checkedValues.length} selected.`)
      return
    }
    setPublishing(true); setError(null)
    try {
      await window.electronAPI.rsaPublishStructuredSnippet({
        customerId: selectedAccount.id, level: levelParam(assetLevel),
        campaignId: selectedCamp, adGroupId: selectedAG,
        header, values: checkedValues,
      })
      setPublished(true)
      await fetchExisting()
    } catch (e) {
      setError(`Publish failed: ${e.message}`)
    } finally {
      setPublishing(false)
    }
  }

  function startEdit(idx, sn) {
    setEditingIdx(idx); setEditHeader(sn.header); setEditValues([...(sn.values || [])]); setEditError(null)
  }

  function updateEditValue(idx, text) {
    setEditValues(prev => prev.map((v, i) => i === idx ? text : v))
  }

  function addEditValue() {
    setEditValues(prev => [...prev, ''])
  }

  function removeEditValue(idx) {
    setEditValues(prev => prev.filter((_, i) => i !== idx))
  }

  async function saveEdit(sn) {
    const cleanValues = editValues.map(v => v.trim()).filter(Boolean)
    if (!editHeader.trim() || cleanValues.length < 3) {
      setEditError('A header and at least 3 values are required.')
      return
    }
    setEditSaving(true); setEditError(null)
    try {
      await window.electronAPI.rsaEditStructuredSnippetAsset({ customerId: selectedAccount.id, resourceName: sn.resourceName, header: editHeader, values: cleanValues })
      setEditingIdx(null)
      await fetchExisting()
    } catch (e) {
      setEditError(e.message || 'Failed to save changes')
    } finally {
      setEditSaving(false)
    }
  }

  if (!selectedAccount) return null

  const checkedValues  = draftValues ? draftValues.filter((_, i) => checked[i]) : []
  const checkedCount   = checkedValues.length
  const hasHardIssues  = draftValues && draftValues.some((v, i) => checked[i] && scoreValue(v, draftValues, i).score < 70)
  const belowMinimum   = draftValues && checkedCount < 3

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

          {/* Header type + count */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 8 }}>Header Type</label>
              <select value={header} onChange={e => setHeader(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #dde9f5', borderRadius: 6, fontSize: 13, color: '#1a3a6b', outline: 'none', background: '#fff', width: '100%', boxSizing: 'border-box' }}>
                {HEADER_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <div style={{ marginTop: 5, fontSize: 11, color: '#888' }}>Only one header per structured snippet asset.</div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 8 }}>Number of Values</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {VALUE_COUNTS.map(n => (
                  <button key={n} onClick={() => setCount(n)} style={{
                    width: 38, height: 36, fontSize: 13, fontWeight: 700, borderRadius: 6,
                    border: `1.5px solid ${count === n ? '#1a3a6b' : '#dde9f5'}`, background: count === n ? '#1a3a6b' : '#fff', color: count === n ? '#fff' : '#555', cursor: 'pointer',
                  }}>{n}</button>
                ))}
              </div>
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
              {generating ? 'Generating…' : `Generate ${count} "${header}" Values with AI`}
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

      {/* Existing structured snippets */}
      {canGenerate && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><span className="card-title">Existing Structured Snippets at this Level ({existingLoading ? '…' : existing.length})</span></div>
          <div style={{ padding: '16px' }}>
            {existingLoading ? <Spinner label="Loading existing structured snippets…" /> : existing.length === 0 ? (
              <div style={{ fontSize: 13, color: '#aaa', textAlign: 'center', padding: '8px 0' }}>No structured snippets yet at this level.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {existing.map((sn, i) => (
                  editingIdx === i ? (
                    <div key={i} style={{ padding: '10px 12px', borderRadius: 7, background: '#fafcff', border: '1px solid #9fc4ec' }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 4 }}>Header</label>
                      <input value={editHeader} disabled title="Header type can't be changed after creation — remove and re-add to use a different header." style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 12, border: '1px solid #dde9f5', borderRadius: 4, marginBottom: 8, color: '#888', background: '#f5f7fa', cursor: 'not-allowed' }} />
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 4 }}>Values (min 3)</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                        {editValues.map((v, vi) => (
                          <div key={vi} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                              <EditableCell value={v} max={MAX_CHARS} onChange={val => updateEditValue(vi, val)} placeholder="Value" />
                            </div>
                            <button onClick={() => removeEditValue(vi)} disabled={editValues.length <= 3} title="Remove value" style={{ fontSize: 11, padding: '4px 8px', background: 'none', color: editValues.length <= 3 ? '#ccc' : '#c0392b', border: '1px solid #dde9f5', borderRadius: 4, cursor: editValues.length <= 3 ? 'not-allowed' : 'pointer' }}>✕</button>
                          </div>
                        ))}
                      </div>
                      <button onClick={addEditValue} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', background: 'none', color: '#1a3a6b', border: '1px solid #dde9f5', borderRadius: 4, cursor: 'pointer', marginBottom: 8 }}>+ Add value</button>
                      {editError && <div style={{ fontSize: 10, color: '#c0392b', marginBottom: 6 }}>{editError}</div>}
                      <div style={{ fontSize: 9, color: '#a56700', marginBottom: 8 }}>Editing changes this structured snippet everywhere it's used.</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => saveEdit(sn)} disabled={editSaving} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 4, border: '1px solid #1a3a6b', background: '#1a3a6b', color: '#fff', cursor: editSaving ? 'not-allowed' : 'pointer' }}>
                          {editSaving ? <Loader2 size={10} className="spin" /> : 'Save'}
                        </button>
                        <button onClick={() => setEditingIdx(null)} disabled={editSaving} style={{ fontSize: 11, padding: '4px 10px', background: 'none', color: '#888', border: '1px solid #dde9f5', borderRadius: 4, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={i} style={{
                      padding: '10px 12px', borderRadius: 7,
                      background: sn.status === 'Paused' ? '#fff8e6' : '#f0fdf4',
                      border: `1px solid ${sn.status === 'Paused' ? '#f0c040' : '#c8e6c9'}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: sn.status === 'Paused' ? '#a56700' : '#2e7d32' }}>{sn.header}</span>
                          {sn.status === 'Paused' && <span style={{ fontSize: 9, fontWeight: 700, color: '#a56700' }}>PAUSED</span>}
                        </div>
                        <AssetManageActions
                          selectedAccount={selectedAccount} level={levelParam(assetLevel)}
                          campaignId={selectedCamp} adGroupId={selectedAG}
                          linkResourceName={sn.linkResourceName} currentStatus={sn.status}
                          onChanged={fetchExisting}
                          onEdit={() => startEdit(i, sn)}
                        />
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(sn.values || []).map((v, vi) => (
                          <span key={vi} style={{ padding: '3px 10px', background: '#fff', border: '1px solid #c8e6c9', borderRadius: 14, fontSize: 12, color: '#1a3a6b' }}>{v}</span>
                        ))}
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {generating && (
        <div className="card" style={{ marginBottom: 20 }}><Spinner label="AI generating structured snippet values…" sub={`Creating ${count} values under "${header}"…`} /></div>
      )}

      {draftValues && !generating && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">Generated Values — Header: "{header}"</span>
            <button onClick={handleGenerate} disabled={published} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #555', background: 'transparent', color: '#555', cursor: published ? 'not-allowed' : 'pointer' }}>
              <RefreshCw size={11} /> Re-Generate All
            </button>
          </div>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Prominent minimum-values notice */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fff8e6', border: '1px solid #ffe0b2', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#a56700' }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              Google requires a minimum of 3 values per Structured Snippet asset — uncheck any you don't want, but at least 3 must stay checked.
            </div>

            {published && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#e8f5e9', borderRadius: 7, border: '1px solid #4caf50', color: '#2e7d32', fontWeight: 700, fontSize: 13 }}>
                <CheckCircle size={16} /> Structured Snippet Published ({assetLevel}) — {checkedCount} values
              </div>
            )}

            {draftValues.map((v, idx) => {
              const q     = scoreValue(v, draftValues, idx)
              const regen = regenIdx === idx
              const isChecked = !!checked[idx]
              return (
                <div key={idx} style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px',
                  background: published ? '#f0fdf4' : isChecked ? '#fafcff' : '#fafafa',
                  border: `1px solid ${published ? '#c8e6c9' : isChecked ? '#eef2f7' : '#e0e0e0'}`,
                  borderRadius: 7, opacity: isChecked ? 1 : 0.55,
                }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={published}
                    onChange={() => toggleChecked(idx)}
                    style={{ accentColor: '#1a3a6b', width: 16, height: 16, marginTop: 6, flexShrink: 0, cursor: published ? 'not-allowed' : 'pointer' }}
                  />
                  <span style={{ fontSize: 11, color: '#aaa', fontWeight: 700, marginTop: 6 }}>{idx + 1}</span>
                  <div style={{ flex: 1 }}>
                    <EditableCell value={v} max={MAX_CHARS} onChange={val => updateValue(idx, val)} placeholder="Value" />
                    {q.issues.length > 0 && <div style={{ marginTop: 4, fontSize: 10, color: '#c0392b' }}>⚠ {q.issues.join(' · ')}</div>}
                  </div>
                  <button onClick={() => handleRegenValue(idx)} disabled={regen || published} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #e65100', background: '#fff', color: '#e65100', cursor: (regen || published) ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
                    {regen ? <Loader2 size={10} className="spin" /> : <RefreshCw size={10} />} {regen ? 'Generating…' : 'Re-Generate'}
                  </button>
                </div>
              )
            })}

            {/* Single publish action for the checked subset */}
            <div style={{ marginTop: 8 }}>
              {published ? null : (
                <>
                  <button onClick={handlePublish} disabled={publishing || hasHardIssues || belowMinimum}
                    title={belowMinimum ? `Select at least 3 values (currently ${checkedCount})` : hasHardIssues ? 'Fix flagged issues on checked values first' : ''}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px',
                      background: (publishing || hasHardIssues || belowMinimum) ? '#dde9f5' : '#2e7d32',
                      color: (publishing || hasHardIssues || belowMinimum) ? '#aaa' : '#fff',
                      fontWeight: 700, fontSize: 13, borderRadius: 7, border: 'none',
                      cursor: (publishing || hasHardIssues || belowMinimum) ? 'not-allowed' : 'pointer',
                    }}>
                    {publishing ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                    {publishing ? 'Publishing…' : `Publish ${checkedCount} Selected Value${checkedCount !== 1 ? 's' : ''} (${assetLevel})`}
                  </button>
                  {belowMinimum && (
                    <div style={{ marginTop: 6, fontSize: 11, color: '#c0392b', fontWeight: 600 }}>
                      Select at least 3 values to publish — currently {checkedCount} selected.
                    </div>
                  )}
                </>
              )}
            </div>
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
