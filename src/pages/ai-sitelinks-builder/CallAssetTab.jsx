import React, { useState, useEffect, useCallback } from 'react'
import { Loader2, CheckCircle, Upload, AlertCircle, Globe, BarChart2, Link2, Phone } from 'lucide-react'
import { Spinner, ASSET_LEVELS, DEFAULT_LEVEL, levelParam, AssetManageActions } from './shared.jsx'
import { sortByStatus } from '../campaign-manager/shared.jsx'

// A call asset has no creative text to write — just a phone number and the
// 2-letter country code it belongs to (Google Ads requires both together to
// validate/format the number), so this tab skips the AI-generation flow
// Callout/Structured Snippet use and is a plain add-and-publish form instead.
function formatPhoneDisplay(phoneNumber, countryCode) {
  return countryCode ? `${phoneNumber} (${countryCode})` : phoneNumber
}

const CONVERSION_MODES = [
  { value: 'ACCOUNT',  label: "Use account's default call conversion action" },
  { value: 'RESOURCE', label: 'Use a specific conversion action' },
  { value: 'DISABLED', label: "Don't track call conversions" },
]

export default function CallAssetTab({ selectedAccount, hidePaused }) {
  const [campaigns,    setCampaigns]    = useState([])
  const [adGroups,     setAdGroups]     = useState([])
  const [selectedCamp, setSelectedCamp] = useState('')
  const [selectedAG,   setSelectedAG]   = useState('')
  const [campLoading,  setCampLoading]  = useState(false)
  const [agLoading,    setAgLoading]    = useState(false)

  const [assetLevel, setAssetLevel] = useState(DEFAULT_LEVEL)

  const [existing,        setExisting]        = useState([])
  const [existingLoading, setExistingLoading]  = useState(false)
  const [error,           setError]            = useState(null)

  const [phoneNumber, setPhoneNumber] = useState('')
  const [countryCode, setCountryCode] = useState('US')
  const [publishing,  setPublishing]  = useState(false)
  const [published,   setPublished]   = useState(false)

  const [conversionActions,        setConversionActions]        = useState([])
  const [conversionActionsLoading, setConversionActionsLoading] = useState(false)
  const [conversionMode,           setConversionMode]           = useState('ACCOUNT')
  const [conversionActionRN,       setConversionActionRN]       = useState('')

  const [editingIdx,        setEditingIdx]        = useState(null)
  const [editPhoneNumber,   setEditPhoneNumber]   = useState('')
  const [editCountryCode,   setEditCountryCode]   = useState('')
  const [editConversionMode, setEditConversionMode] = useState('ACCOUNT')
  const [editConversionRN,  setEditConversionRN]  = useState('')
  const [editSaving,        setEditSaving]        = useState(false)
  const [editError,         setEditError]         = useState(null)

  const needsAdGroup = assetLevel === 'Ad Group Level'
  const canPublishAt = assetLevel === 'Account Level'
    ? !!selectedAccount
    : assetLevel === 'Campaign Level'
    ? !!selectedCamp
    : !!selectedAG

  // ── Load campaigns ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedAccount) return
    setCampaigns([]); setAdGroups([])
    setSelectedCamp(''); setSelectedAG('')
    setExisting([]); setError(null)
    setCampLoading(true)
    // Always include paused campaigns — see SitelinksTab for the same call.
    window.electronAPI.rsaFetchCampaigns({ customerId: selectedAccount.id, hidePaused: false })
      .then(d => setCampaigns(sortByStatus(d || [])))
      .catch(e => setError(e.message))
      .finally(() => setCampLoading(false))
  }, [selectedAccount])

  // ── Load conversion actions for the dropdown ─────────────────────────────
  useEffect(() => {
    if (!selectedAccount) { setConversionActions([]); return }
    setConversionActionsLoading(true)
    window.electronAPI.rsaFetchConversionActions({ customerId: selectedAccount.id })
      .then(d => setConversionActions(d || []))
      .catch(() => setConversionActions([]))
      .finally(() => setConversionActionsLoading(false))
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

  // ── Fetch existing call assets whenever level/selection changes ──────────
  const fetchExisting = useCallback(async () => {
    if (!canPublishAt) { setExisting([]); return }
    setExistingLoading(true)
    try {
      const res = await window.electronAPI.rsaFetchCallAssets({
        customerId: selectedAccount.id, level: levelParam(assetLevel),
        campaignId: selectedCamp, adGroupId: selectedAG,
      })
      setExisting(res || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setExistingLoading(false)
    }
  }, [selectedAccount, assetLevel, selectedCamp, selectedAG, canPublishAt])

  useEffect(() => { fetchExisting() }, [fetchExisting])
  useEffect(() => { setPublished(false) }, [assetLevel, selectedCamp, selectedAG])

  const conversionInvalid = conversionMode === 'RESOURCE' && !conversionActionRN

  async function handlePublish() {
    if (!canPublishAt || !phoneNumber.trim() || conversionInvalid) return
    setPublishing(true); setError(null); setPublished(false)
    try {
      await window.electronAPI.rsaPublishCallAsset({
        customerId: selectedAccount.id, level: levelParam(assetLevel),
        campaignId: selectedCamp, adGroupId: selectedAG,
        phoneNumber: phoneNumber.trim(), countryCode: countryCode.trim().toUpperCase(),
        conversionMode,
        conversionActionResourceName: conversionMode === 'RESOURCE' ? conversionActionRN : undefined,
      })
      setPublished(true)
      setPhoneNumber('')
      await fetchExisting()
    } catch (e) {
      setError(e.message)
    } finally {
      setPublishing(false)
    }
  }

  function startEdit(idx, c) {
    setEditingIdx(idx)
    setEditPhoneNumber(c.phoneNumber); setEditCountryCode(c.countryCode)
    setEditConversionMode(c.conversionMode || 'ACCOUNT'); setEditConversionRN(c.conversionActionResourceName || '')
    setEditError(null)
  }

  const editConversionInvalid = editConversionMode === 'RESOURCE' && !editConversionRN

  async function saveEdit(c) {
    if (!editPhoneNumber.trim() || editConversionInvalid) return
    setEditSaving(true); setEditError(null)
    try {
      await window.electronAPI.rsaEditCallAsset({
        customerId: selectedAccount.id, resourceName: c.resourceName,
        phoneNumber: editPhoneNumber.trim(), countryCode: editCountryCode.trim().toUpperCase(),
        conversionMode: editConversionMode,
        conversionActionResourceName: editConversionMode === 'RESOURCE' ? editConversionRN : undefined,
      })
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

          {/* Phone number + country code */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5 }}>Phone Number</label>
              <input
                value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                placeholder="e.g. (305) 555-0100"
                style={{ padding: '8px 10px', border: '1px solid #dde9f5', borderRadius: 6, fontSize: 13, color: '#1a3a6b', outline: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5 }}>Country Code</label>
              <input
                value={countryCode} onChange={e => setCountryCode(e.target.value.toUpperCase().slice(0, 2))}
                placeholder="US" maxLength={2}
                style={{ padding: '8px 10px', border: '1px solid #dde9f5', borderRadius: 6, fontSize: 13, color: '#1a3a6b', outline: 'none', textTransform: 'uppercase' }}
              />
            </div>
          </div>

          {/* Conversion Action */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 8 }}>Conversion Action</label>
            <select
              value={conversionMode}
              onChange={e => { setConversionMode(e.target.value); if (e.target.value !== 'RESOURCE') setConversionActionRN('') }}
              style={{ padding: '8px 10px', border: '1px solid #dde9f5', borderRadius: 6, fontSize: 13, color: '#1a3a6b', outline: 'none', background: '#fff', minWidth: 300 }}
            >
              {CONVERSION_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {conversionMode === 'RESOURCE' && (
              <div style={{ marginTop: 8 }}>
                {conversionActionsLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#888', fontSize: 12 }}><Loader2 size={13} className="spin" /> Loading conversion actions…</div>
                ) : conversionActions.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#aaa' }}>No "Ad Call" conversion actions found in this account — Google Ads only accepts that specific type here. Create one under Tools &amp; Settings → Conversions, or use the account default instead.</div>
                ) : (
                  <select
                    value={conversionActionRN} onChange={e => setConversionActionRN(e.target.value)}
                    style={{ padding: '8px 10px', border: `1px solid ${conversionInvalid ? '#e05c2a' : '#dde9f5'}`, borderRadius: 6, fontSize: 13, color: '#1a3a6b', outline: 'none', background: '#fff', minWidth: 300 }}
                  >
                    <option value="">— Select Conversion Action —</option>
                    {conversionActions.map(ca => <option key={ca.resourceName} value={ca.resourceName}>{ca.name}</option>)}
                  </select>
                )}
              </div>
            )}
          </div>

          <div>
            <button onClick={handlePublish} disabled={!canPublishAt || !phoneNumber.trim() || conversionInvalid || publishing} style={{
              display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 28px',
              background: (!canPublishAt || !phoneNumber.trim() || conversionInvalid || publishing) ? '#dde9f5' : '#1a3a6b',
              color: (!canPublishAt || !phoneNumber.trim() || conversionInvalid || publishing) ? '#aaa' : '#fff',
              fontWeight: 700, fontSize: 14, borderRadius: 7, border: 'none',
              cursor: (!canPublishAt || !phoneNumber.trim() || conversionInvalid || publishing) ? 'not-allowed' : 'pointer',
            }}>
              {publishing ? <Loader2 size={16} className="spin" /> : <Phone size={16} />}
              {publishing ? 'Publishing…' : 'Add Call Asset'}
            </button>
            {published && (
              <span style={{ marginLeft: 12, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: '#2e7d32' }}>
                <CheckCircle size={14} /> Published
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertCircle size={16} color="#c0392b" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13, color: '#c0392b' }}>{error}</span>
        </div>
      )}

      {/* Existing call assets */}
      {canPublishAt && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><span className="card-title">Existing Call Assets at this Level ({existingLoading ? '…' : existing.length})</span></div>
          <div style={{ padding: '16px' }}>
            {existingLoading ? <Spinner label="Loading existing call assets…" /> : existing.length === 0 ? (
              <div style={{ fontSize: 13, color: '#aaa', textAlign: 'center', padding: '8px 0' }}>No call assets yet at this level.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {existing.map((c, i) => {
                  const convLabel = c.conversionMode === 'DISABLED'
                    ? 'no conversion tracking'
                    : c.conversionMode === 'RESOURCE'
                    ? (conversionActions.find(ca => ca.resourceName === c.conversionActionResourceName)?.name || 'specific conversion action')
                    : "account's default conversion action"
                  const paused = c.status === 'Paused'
                  if (editingIdx === i) {
                    return (
                      <div key={i} style={{ width: '100%', maxWidth: 460, padding: '10px 12px', background: '#fafcff', border: '1px solid #9fc4ec', borderRadius: 8 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
                          <div>
                            <label style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 4 }}>Phone Number</label>
                            <input value={editPhoneNumber} onChange={e => setEditPhoneNumber(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 12, border: '1px solid #dde9f5', borderRadius: 4, color: '#1a3a6b' }} />
                          </div>
                          <div>
                            <label style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 4 }}>Country</label>
                            <input value={editCountryCode} onChange={e => setEditCountryCode(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 12, border: '1px solid #dde9f5', borderRadius: 4, color: '#1a3a6b', textTransform: 'uppercase' }} />
                          </div>
                        </div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 4 }}>Conversion Action</label>
                        <select value={editConversionMode} onChange={e => { setEditConversionMode(e.target.value); if (e.target.value !== 'RESOURCE') setEditConversionRN('') }}
                          style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 12, border: '1px solid #dde9f5', borderRadius: 4, color: '#1a3a6b', marginBottom: 8, background: '#fff' }}>
                          {CONVERSION_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                        {editConversionMode === 'RESOURCE' && (
                          <select value={editConversionRN} onChange={e => setEditConversionRN(e.target.value)}
                            style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 12, border: `1px solid ${editConversionInvalid ? '#e05c2a' : '#dde9f5'}`, borderRadius: 4, color: '#1a3a6b', marginBottom: 8, background: '#fff' }}>
                            <option value="">— Select Conversion Action —</option>
                            {conversionActions.map(ca => <option key={ca.resourceName} value={ca.resourceName}>{ca.name}</option>)}
                          </select>
                        )}
                        {editError && <div style={{ fontSize: 10, color: '#c0392b', marginBottom: 6 }}>{editError}</div>}
                        <div style={{ fontSize: 9, color: '#a56700', marginBottom: 8 }}>Editing changes this call asset everywhere it's used.</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => saveEdit(c)} disabled={editSaving || !editPhoneNumber.trim() || editConversionInvalid} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 4, border: '1px solid #1a3a6b', background: (editSaving || !editPhoneNumber.trim() || editConversionInvalid) ? '#dde9f5' : '#1a3a6b', color: (editSaving || !editPhoneNumber.trim() || editConversionInvalid) ? '#aaa' : '#fff', cursor: (editSaving || !editPhoneNumber.trim() || editConversionInvalid) ? 'not-allowed' : 'pointer' }}>
                            {editSaving ? <Loader2 size={10} className="spin" /> : 'Save'}
                          </button>
                          <button onClick={() => setEditingIdx(null)} disabled={editSaving} style={{ fontSize: 11, padding: '4px 10px', background: 'none', color: '#888', border: '1px solid #dde9f5', borderRadius: 4, cursor: 'pointer' }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )
                  }
                  return (
                    <span key={i} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                      background: paused ? '#fff8e6' : '#f0fdf4', border: `1px solid ${paused ? '#f0c040' : '#c8e6c9'}`,
                      borderRadius: 20, fontSize: 12, fontWeight: 600, color: paused ? '#a56700' : '#2e7d32',
                    }}>
                      <Phone size={12} /> {formatPhoneDisplay(c.phoneNumber, c.countryCode)}
                      <span style={{ fontWeight: 400, color: paused ? '#a56700' : '#5a9c5f', fontSize: 10 }}>· {convLabel}</span>
                      {paused && <span style={{ fontSize: 9, fontWeight: 700 }}>PAUSED</span>}
                      <AssetManageActions
                        selectedAccount={selectedAccount} level={levelParam(assetLevel)}
                        campaignId={selectedCamp} adGroupId={selectedAG}
                        linkResourceName={c.linkResourceName} currentStatus={c.status}
                        onChanged={fetchExisting}
                        onEdit={() => startEdit(i, c)}
                      />
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {!canPublishAt && !error && (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
          {assetLevel === 'Campaign Level' && 'Select a Campaign above.'}
          {assetLevel === 'Ad Group Level' && 'Select a Campaign and Ad Group above.'}
        </div>
      )}
    </>
  )
}
