import React, { useState, useEffect, useCallback } from 'react'
import {
  Loader2, CheckCircle, Upload, Search, AlertCircle,
  RefreshCw, Edit2, Globe, BarChart2, Link2,
} from 'lucide-react'
import { Spinner, CopyBtn, charColor, EditableCell, ScoreBadge, CTA_WORDS, ASSET_LEVELS, DEFAULT_LEVEL, levelParam, AssetManageActions } from './shared.jsx'
import { sortByStatus } from '../campaign-manager/shared.jsx'

// ── Constants ─────────────────────────────────────────────────────────────────

const SITELINK_COUNTS  = [4, 6, 8, 10]
const SITELINK_TYPES   = ['Mixed', 'Service Based', 'Conversion Focused', 'Informational']
const DEFAULT_COUNT    = 8
const DEFAULT_TYPE     = 'Mixed'

// ── Quality scoring ───────────────────────────────────────────────────────────

function scoreSitelink(sl, allSitelinks, idx) {
  let score = 100
  const issues = []

  if (!sl.headline?.trim()) {
    score -= 30; issues.push('Missing headline')
  } else if (sl.headline.length > 25) {
    score -= 15; issues.push(`Headline over limit (${sl.headline.length}/25)`)
  }

  if (!sl.description1?.trim()) {
    score -= 12; issues.push('Missing description 1')
  } else if (sl.description1.length > 35) {
    score -= 10; issues.push(`Description 1 over limit (${sl.description1.length}/35)`)
  }

  if (!sl.description2?.trim()) {
    score -= 12; issues.push('Missing description 2')
  } else if (sl.description2.length > 35) {
    score -= 10; issues.push(`Description 2 over limit (${sl.description2.length}/35)`)
  }

  try { new URL(sl.url) } catch { score -= 20; issues.push('Invalid or missing URL') }

  const dupeHeadline = allSitelinks.some((s, i) => i !== idx && s.headline?.toLowerCase().trim() === sl.headline?.toLowerCase().trim())
  if (dupeHeadline) { score -= 15; issues.push('Duplicate headline') }

  const dupeUrl = allSitelinks.some((s, i) => i !== idx && s.url?.toLowerCase().trim() === sl.url?.toLowerCase().trim())
  if (dupeUrl) { score -= 15; issues.push('Duplicate URL') }

  const hasCta = CTA_WORDS.some(w => (sl.description1 + ' ' + sl.description2).toLowerCase().includes(w))
  if (!hasCta) { score -= 5; issues.push('No CTA in descriptions') }

  return { score: Math.max(0, score), issues }
}

function computeQuality(sitelinks) {
  if (!sitelinks?.length) return null
  const perSitelink = sitelinks.map((sl, i) => scoreSitelink(sl, sitelinks, i))
  const overall     = Math.round(perSitelink.reduce((s, r) => s + r.score, 0) / perSitelink.length)

  const allHls      = sitelinks.map(sl => sl.headline?.toLowerCase().trim())
  const allUrls      = sitelinks.map(sl => sl.url?.toLowerCase().trim())
  const charOk      = perSitelink.every(r => !r.issues.some(i => i.includes('limit')))
  const urlsOk      = perSitelink.every(r => !r.issues.some(i => i.includes('URL')))
  const desc1Ok     = sitelinks.every(sl => !!sl.description1?.trim())
  const desc2Ok     = sitelinks.every(sl => !!sl.description2?.trim())
  const ctaOk       = sitelinks.some(sl => CTA_WORDS.some(w => (sl.description1 + ' ' + sl.description2).toLowerCase().includes(w)))
  const uniqueOk    = new Set(allHls).size === allHls.length && new Set(allUrls).size === allUrls.length
  const belowThresh = perSitelink.map((r, i) => ({ idx: i, score: r.score, issues: r.issues })).filter(r => r.score < 70)

  const grade = overall >= 90 ? 'Excellent' : overall >= 75 ? 'Good' : overall >= 55 ? 'Average' : 'Poor'
  const gradeColor = { Excellent: '#2e7d32', Good: '#4caf50', Average: '#e65100', Poor: '#c0392b' }

  const checks = [
    { label: 'Character Limits Passed',      pass: charOk  },
    { label: 'URLs Valid',                    pass: urlsOk  },
    { label: 'All Descriptions Present',      pass: desc1Ok && desc2Ok },
    { label: 'Strong CTA Coverage',           pass: ctaOk   },
    { label: 'No Duplicate Sitelinks',        pass: uniqueOk },
    { label: 'High Overall Relevance',        pass: overall >= 75 },
  ]

  return { overall, grade, gradeColor: gradeColor[grade], perSitelink, checks, belowThresh }
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export default function SitelinksTab({ selectedAccount, hidePaused }) {
  // ── Campaign / Ad Group ───────────────────────────────────────────────────
  const [campaigns,    setCampaigns]    = useState([])
  const [adGroups,     setAdGroups]     = useState([])
  const [selectedCamp, setSelectedCamp] = useState('')
  const [selectedAG,   setSelectedAG]   = useState('')
  const [campLoading,  setCampLoading]  = useState(false)
  const [agLoading,    setAgLoading]    = useState(false)

  // ── Settings ──────────────────────────────────────────────────────────────
  const [assetLevel,   setAssetLevel]   = useState(DEFAULT_LEVEL)
  const [finalUrl,     setFinalUrl]     = useState('')
  const [count,        setCount]        = useState(DEFAULT_COUNT)
  const [slType,       setSlType]       = useState(DEFAULT_TYPE)
  const [preventCrossover, setPreventCrossover] = useState(true)

  // ── Generation state ──────────────────────────────────────────────────────
  const [crawlPhase,   setCrawlPhase]   = useState('')   // '' = idle, 'working' = generating
  const [sitelinks,    setSitelinks]    = useState(null)
  const [keywords,     setKeywords]     = useState([])
  const [error,        setError]        = useState(null)
  const [shortfallReason, setShortfallReason] = useState(null)

  // ── Editing ───────────────────────────────────────────────────────────────
  const [editingRow,   setEditingRow]   = useState(null) // row index being edited
  const [regenRow,     setRegenRow]     = useState(null) // row index being regenerated

  // ── Live status / existing sitelinks at the selected level ──────────────────
  const [liveSitelinks, setLiveSitelinks] = useState([])
  // Sitelinks that already exist at a HIGHER level and inherit down to the one
  // being generated for (e.g. Account/Campaign-level sitelinks still show up
  // on an Ad Group's ads) — checked only for dedup, not shown as "live at this
  // level" or eligible for pause/remove from here.
  const [inheritedSitelinks, setInheritedSitelinks] = useState([])
  const [verifying,     setVerifying]     = useState(false)
  const [existingLoading, setExistingLoading] = useState(false)

  // ── Upload ────────────────────────────────────────────────────────────────
  const [uploading,    setUploading]    = useState({})   // { idx: bool }
  const [uploaded,     setUploaded]     = useState({})   // { idx: bool }

  // ── Existing (live) sitelink editing ─────────────────────────────────────
  const [liveEditingIdx, setLiveEditingIdx] = useState(null)
  const [liveEdit,        setLiveEdit]       = useState({ headline: '', description1: '', description2: '', url: '' })
  const [liveEditSaving,  setLiveEditSaving] = useState(false)
  const [liveEditError,   setLiveEditError]  = useState(null)

  // ── Derived ───────────────────────────────────────────────────────────────
  const quality        = sitelinks ? computeQuality(sitelinks) : null
  const selectedAGName = adGroups.find(a => a.id === selectedAG)?.name    || ''
  const selectedCampName = campaigns.find(c => c.id === selectedCamp)?.name || ''
  // What's actually required depends on the asset level — Account Level needs
  // neither campaign nor ad group, Campaign Level needs just a campaign, and
  // only Ad Group Level needs both.
  const levelReady     = assetLevel === 'Account Level' ? true
                        : assetLevel === 'Campaign Level' ? !!selectedCamp
                        : !!(selectedCamp && selectedAG)
  const canGenerate    = !!(selectedAccount && levelReady && finalUrl.trim() && crawlPhase === '')
  // Real sibling ad group names in the same campaign — used by the Ad Group
  // Intent Lock so the AI can infer each one's intent dynamically (no hardcoded
  // list). Only meaningful at Ad Group Level — at Campaign/Account Level there
  // is no single ad group to lock to, and with selectedAG empty every ad group
  // in the campaign would otherwise be treated as a "sibling to exclude",
  // wrongly suppressing the broader, campaign-wide coverage those levels want.
  const siblingAdGroupNames = assetLevel === 'Ad Group Level'
    ? adGroups.filter(a => a.id !== selectedAG).map(a => a.name).filter(Boolean)
    : []
  // Existing sitelinks to avoid duplicating — both the ones live at the
  // selected level and any inherited down from a higher level (Account/
  // Campaign-level sitelinks still render on an Ad Group's ads).
  const existingLiveForPrompt = [...liveSitelinks, ...inheritedSitelinks]
    .map(l => ({ headline: l.headline, url: l.urls?.[0] || '' }))

  // ── Load campaigns ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedAccount) return
    setCampaigns([]); setAdGroups([])
    setSelectedCamp(''); setSelectedAG('')
    setSitelinks(null); setError(null)
    setCampLoading(true)
    // Always include paused campaigns — this is a workbench you open to
    // build/audit assets on a specific campaign (paused ones included), not
    // a report, so it shouldn't defer to the global "Hide Paused" toggle.
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

  // ── Generate ──────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!canGenerate) return
    setError(null); setSitelinks(null); setLiveSitelinks([]); setUploaded({}); setEditingRow(null); setShortfallReason(null)

    const url = finalUrl.trim()

    setCrawlPhase('working')
    try {
      // Keyword context only exists at the ad group level — Account/Campaign
      // Level generation has no specific ad group to pull keywords from.
      const builderData = selectedAG
        ? await window.electronAPI.rsaFetchBuilderData({
            customerId: selectedAccount.id, adGroupId: selectedAG,
          }).catch(() => null)
        : null
      const kws = builderData?.keywords || []
      setKeywords(kws)

      // Backend crawls the page + discovers every real URL via sitemap.xml,
      // then generates sitelinks using only confirmed-existing pages.
      const res = await window.electronAPI.rsaGenerateSitelinksAI({
        customerId: selectedAccount.id,
        url, keywords: kws,
        adGroupName: selectedAGName, campaignName: selectedCampName,
        count, sitelinkType: slType, preventCrossover, siblingAdGroupNames,
        existingLive: existingLiveForPrompt,
        adGroupLevel: assetLevel === 'Ad Group Level',
      })
      if (!res?.sitelinks?.length) throw new Error('No sitelinks returned. Please try again.')
      setSitelinks(res.sitelinks)
      setShortfallReason(res.shortfallReason || null)

      // Auto-verify live status
      autoVerifyLive()
    } catch (e) {
      setError(e.message)
    } finally {
      setCrawlPhase('')
    }
  }

  // ── Live status ───────────────────────────────────────────────────────────
  const autoVerifyLive = useCallback(async () => {
    if (!selectedAccount) return
    if (assetLevel === 'Campaign Level' && !selectedCamp) return
    if (assetLevel === 'Ad Group Level' && !selectedAG) return
    try {
      const accountP  = window.electronAPI.rsaGetAccountSitelinks({ customerId: selectedAccount.id }).catch(() => [])
      const campaignP = (assetLevel !== 'Account Level' && selectedCamp)
        ? window.electronAPI.rsaGetCampaignSitelinks({ customerId: selectedAccount.id, campaignId: selectedCamp }).catch(() => [])
        : Promise.resolve([])

      let live = []
      let inherited = []
      if (assetLevel === 'Account Level') {
        live = await accountP
      } else if (assetLevel === 'Campaign Level') {
        [inherited, live] = await Promise.all([accountP, campaignP])
      } else {
        const [account, campaign, adGroup] = await Promise.all([
          accountP, campaignP,
          window.electronAPI.rsaGetAdGroupSitelinks({ customerId: selectedAccount.id, adGroupId: selectedAG }).catch(() => []),
        ])
        inherited = [...(account || []), ...(campaign || [])]
        live = adGroup
      }
      setLiveSitelinks(live || [])
      setInheritedSitelinks(inherited || [])
    } catch { /* silent */ }
  }, [selectedAccount, selectedAG, selectedCamp, assetLevel])

  async function handleVerify() {
    setVerifying(true)
    await autoVerifyLive()
    setVerifying(false)
  }

  // Load existing sitelinks for the selected level proactively — as soon as
  // the level is ready, not just after generating/uploading — so the user
  // can see what's already there and duplicates can be caught before publish.
  useEffect(() => {
    if (!levelReady) { setLiveSitelinks([]); return }
    setExistingLoading(true)
    autoVerifyLive().finally(() => setExistingLoading(false))
  }, [levelReady, autoVerifyLive])

  function isLive(sl) {
    const headline = typeof sl === 'string' ? sl : sl?.headline
    const url       = typeof sl === 'string' ? null : sl?.url
    return liveSitelinks.some(l =>
      l.headline?.toLowerCase().trim() === headline?.toLowerCase().trim() ||
      (url && l.urls?.some(u => u?.toLowerCase().trim() === url?.toLowerCase().trim()))
    )
  }

  // ── Row edit ──────────────────────────────────────────────────────────────
  function updateRow(idx, field, value) {
    setSitelinks(prev => prev.map((sl, i) => i === idx ? { ...sl, [field]: value } : sl))
  }

  // ── Row re-generate ───────────────────────────────────────────────────────
  async function handleRegenRow(idx) {
    if (!sitelinks) return
    setRegenRow(idx)
    let baseDomain = finalUrl.trim()
    try { const u = new URL(finalUrl.trim()); baseDomain = `${u.protocol}//${u.host}` } catch {}
    try {
      const res = await window.electronAPI.rsaRegenerateSingleSitelink({
        customerId:        selectedAccount.id,
        url:               finalUrl.trim(),
        baseDomain,
        adGroupName:       selectedAGName,
        campaignName:      selectedCampName,
        keywords,
        existingSitelinks: sitelinks,
        index:             idx,
        sitelinkType:      slType,
        preventCrossover, siblingAdGroupNames,
        existingLive: existingLiveForPrompt,
      })
      if (res) {
        setSitelinks(prev => prev.map((sl, i) => i === idx ? res : sl))
      }
    } catch (e) {
      setError(`Row ${idx + 1} re-generation failed: ${e.message}`)
    } finally {
      setRegenRow(null)
    }
  }

  // ── Upload single sitelink ────────────────────────────────────────────────
  async function handleUpload(idx) {
    const sl = sitelinks?.[idx]
    if (!sl) return
    setUploading(prev => ({ ...prev, [idx]: true }))
    setError(null)
    try {
      if (assetLevel === 'Account Level') {
        await window.electronAPI.rsaPublishSitelinkToAccount({
          customerId: selectedAccount.id,
          headline: sl.headline, description1: sl.description1,
          description2: sl.description2, url: sl.url,
        })
      } else if (assetLevel === 'Campaign Level') {
        await window.electronAPI.rsaPublishSitelinkToCampaign({
          customerId: selectedAccount.id, campaignId: selectedCamp,
          headline: sl.headline, description1: sl.description1,
          description2: sl.description2, url: sl.url,
        })
      } else {
        await window.electronAPI.rsaPublishSingleSitelink({
          customerId: selectedAccount.id, adGroupId: selectedAG,
          headline: sl.headline, description1: sl.description1,
          description2: sl.description2, url: sl.url, finalUrl: finalUrl.trim(),
        })
      }
      setUploaded(prev => ({ ...prev, [idx]: true }))
      await autoVerifyLive()
    } catch (e) {
      setError(`Upload failed for row ${idx + 1}: ${e.message}`)
    } finally {
      setUploading(prev => ({ ...prev, [idx]: false }))
    }
  }

  // ── Upload all ────────────────────────────────────────────────────────────
  async function handleUploadAll() {
    if (!sitelinks?.length) return
    setError(null)
    const toUpload = sitelinks.map((_, i) => i).filter(i => !uploaded[i] && !isLive(sitelinks[i]?.headline))
    for (const idx of toUpload) {
      await handleUpload(idx)
    }
  }

  function startLiveEdit(idx, l) {
    setLiveEditingIdx(idx)
    setLiveEdit({ headline: l.headline || '', description1: l.description1 || '', description2: l.description2 || '', url: l.urls?.[0] || '' })
    setLiveEditError(null)
  }

  async function saveLiveEdit(l) {
    if (!liveEdit.headline.trim() || !liveEdit.url.trim()) {
      setLiveEditError('Headline and URL are required.')
      return
    }
    setLiveEditSaving(true); setLiveEditError(null)
    try {
      await window.electronAPI.rsaEditSitelinkAsset({
        customerId: selectedAccount.id, resourceName: l.resourceName,
        headline: liveEdit.headline, description1: liveEdit.description1, description2: liveEdit.description2,
        url: liveEdit.url, finalUrl: finalUrl.trim(),
      })
      setLiveEditingIdx(null)
      await autoVerifyLive()
    } catch (e) {
      setLiveEditError(e.message || 'Failed to save changes')
    } finally {
      setLiveEditSaving(false)
    }
  }

  const isGenerating  = crawlPhase !== ''
  const uploadedCount = Object.values(uploaded).filter(Boolean).length
  const liveCount     = sitelinks ? sitelinks.filter(sl => isLive(sl.headline)).length : 0
  const allUploaded   = sitelinks && sitelinks.length > 0 && sitelinks.every((sl, i) => uploaded[i] || isLive(sl.headline))

  return (
    <>
      {/* ── Step 1 + 2 + 3 — Setup card ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">Campaign, URL &amp; Settings</span>
        </div>

        <div style={{ padding: '16px' }}>

          {/* Row 1: Campaign + Ad Group */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5 }}>Ad Group</label>
              {agLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#888', fontSize: 12 }}>
                  <Loader2 size={13} className="spin" /> Loading…
                </div>
              ) : (
                <select value={selectedAG} onChange={e => setSelectedAG(e.target.value)} disabled={!selectedCamp} style={{
                  padding: '8px 10px', border: '1px solid #dde9f5', borderRadius: 6,
                  fontSize: 13, color: '#1a3a6b', outline: 'none',
                  background: !selectedCamp ? '#f5f7fa' : '#fff',
                }}>
                  <option value="">— Select Ad Group —</option>
                  {adGroups.map(ag => <option key={ag.id} value={ag.id}>{ag.name} ({ag.status})</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Row 2: Asset Level */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 8 }}>
              Asset Level
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ASSET_LEVELS.map(level => {
                const active = assetLevel === level
                const icons = { 'Account Level': Globe, 'Campaign Level': BarChart2, 'Ad Group Level': Link2 }
                const Icon = icons[level]
                return (
                  <button key={level} onClick={() => setAssetLevel(level)} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    border: `1.5px solid ${active ? '#1a3a6b' : '#dde9f5'}`,
                    background: active ? '#1a3a6b' : '#fff',
                    color:      active ? '#fff'    : '#555',
                    cursor: 'pointer', transition: 'all 0.12s',
                  }}>
                    <Icon size={13} /> {level}
                    {level === DEFAULT_LEVEL && !active && <span style={{ fontSize: 9, color: '#aaa', marginLeft: 3 }}>default</span>}
                  </button>
                )
              })}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: '#888' }}>
              {assetLevel === 'Account Level' && 'Sitelinks will apply to all campaigns in this account.'}
              {assetLevel === 'Campaign Level' && 'Sitelinks will apply to all ad groups in the selected campaign.'}
              {assetLevel === 'Ad Group Level' && 'Sitelinks will apply only to the selected ad group.'}
            </div>
          </div>

          {/* Row 3: Final URL */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 5 }}>
              Final URL <span style={{ textTransform: 'none', fontWeight: 400, color: '#c0392b', marginLeft: 4 }}>*</span>
            </label>
            <input
              type="url"
              value={finalUrl}
              onChange={e => setFinalUrl(e.target.value)}
              placeholder="https://example.com/dental-implants"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '9px 12px',
                border: '1px solid #dde9f5', borderRadius: 6,
                fontSize: 13, color: '#1a3a6b', outline: 'none', background: '#fff',
              }}
            />
            <div style={{ marginTop: 5, fontSize: 11, color: '#888', lineHeight: 1.5 }}>
              We'll crawl this page + key navigation pages (About, Contact, Services, Reviews, etc.) to generate highly relevant sitelinks.
            </div>
          </div>

          {/* Row 4: Generation settings */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>

            {/* Count */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 8 }}>
                Number of Sitelinks
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {SITELINK_COUNTS.map(n => (
                  <button key={n} onClick={() => setCount(n)} style={{
                    width: 44, height: 36, fontSize: 13, fontWeight: 700, borderRadius: 6,
                    border: `1.5px solid ${count === n ? '#1a3a6b' : '#dde9f5'}`,
                    background: count === n ? '#1a3a6b' : '#fff',
                    color:      count === n ? '#fff'    : '#555',
                    cursor: 'pointer',
                  }}>{n}</button>
                ))}
              </div>
            </div>

            {/* Type */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 8 }}>
                Sitelink Type
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {SITELINK_TYPES.map(t => (
                  <button key={t} onClick={() => setSlType(t)} style={{
                    padding: '5px 11px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                    border: `1.5px solid ${slType === t ? '#1a3a6b' : '#dde9f5'}`,
                    background: slType === t ? '#1a3a6b' : '#fff',
                    color:      slType === t ? '#fff'    : '#555',
                    cursor: 'pointer',
                  }}>{t}</button>
                ))}
              </div>
              <div style={{ marginTop: 5, fontSize: 11, color: '#888' }}>
                {slType === 'Mixed'              && 'Service-specific + generic navigation sitelinks.'}
                {slType === 'Service Based'      && 'Focused on specific services or products.'}
                {slType === 'Conversion Focused' && 'CTAs: Free Consultation, Book, Get a Quote, etc.'}
                {slType === 'Informational'      && 'Reviews, Team, FAQ, Financing, How It Works.'}
              </div>
            </div>
          </div>

          {/* Prevent ad group crossover */}
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            padding: '8px 14px', borderRadius: 6, marginBottom: 16,
            background: preventCrossover ? '#eef6ff' : '#f5f7fa', border: `1px solid ${preventCrossover ? '#9fc4ec' : '#dde9f5'}`,
          }} title="When enabled, sitelinks must stay specific to this ad group's own service intent — they won't borrow language that belongs to a sibling ad group.">
            <input type="checkbox" checked={preventCrossover} onChange={e => setPreventCrossover(e.target.checked)}
              style={{ accentColor: '#1a3a6b', width: 15, height: 15 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1a3a6b' }}>🔒 Prevent ad group crossover</span>
          </label>

          {/* Generate button */}
          <div>
            <button onClick={handleGenerate} disabled={!canGenerate} style={{
              display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 28px',
              background: canGenerate ? '#1a3a6b' : '#dde9f5',
              color:      canGenerate ? '#fff'    : '#aaa',
              fontWeight: 700, fontSize: 14, borderRadius: 7, border: 'none',
              cursor: canGenerate ? 'pointer' : 'not-allowed', boxShadow: canGenerate ? '0 2px 8px rgba(26,58,107,0.25)' : 'none',
            }}>
              {isGenerating ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
              {isGenerating ? 'Crawling sitemap & generating sitelinks…' : `Generate ${count} Sitelinks with AI`}
            </button>
          </div>

          {/* Breadcrumb */}
          {selectedCampName && (
            <div style={{ marginTop: 12, fontSize: 11, color: '#888' }}>
              <span style={{ fontWeight: 600, color: '#1a3a6b' }}>{selectedCampName}</span>
              {selectedAGName && <> › <span style={{ fontWeight: 600, color: '#2563b0' }}>{selectedAGName}</span></>}
              <span style={{ marginLeft: 8, padding: '2px 8px', background: '#e3f2fd', color: '#1565c0', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                {assetLevel}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Existing sitelinks already live at the selected level ── */}
      {levelReady && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <span className="card-title">Existing Sitelinks{!existingLoading ? ` (${liveSitelinks.length})` : ''}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: '#888' }}>
                {assetLevel === 'Account Level' && 'Account-wide'}
                {assetLevel === 'Campaign Level' && <>Campaign: <strong style={{ color: '#1a3a6b' }}>{selectedCampName}</strong></>}
                {assetLevel === 'Ad Group Level' && <><strong style={{ color: '#1a3a6b' }}>{selectedCampName}</strong> › <strong style={{ color: '#2563b0' }}>{selectedAGName}</strong></>}
              </span>
              <button onClick={handleVerify} disabled={verifying || existingLoading}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #1a3a6b', background: '#fff', color: '#1a3a6b', cursor: (verifying || existingLoading) ? 'not-allowed' : 'pointer' }}>
                {(verifying || existingLoading) ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}
                Refresh
              </button>
            </div>
          </div>
          <div style={{ padding: '14px 16px' }}>
            {existingLoading ? (
              <Spinner label="Loading existing sitelinks…" />
            ) : liveSitelinks.length === 0 ? (
              <div style={{ fontSize: 13, color: '#aaa', textAlign: 'center', padding: '8px 0' }}>No sitelinks currently live at this level.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {liveSitelinks.map((l, i) => {
                  const paused = l.status === 'Paused'
                  if (liveEditingIdx === i) {
                    return (
                      <div key={i} style={{ padding: '10px 12px', borderRadius: 6, background: '#fafcff', border: '1px solid #9fc4ec' }}>
                        <div style={{ marginBottom: 8 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 4 }}>Sitelink Text</label>
                          <EditableCell value={liveEdit.headline} max={25} onChange={v => setLiveEdit(prev => ({ ...prev, headline: v }))} placeholder="Sitelink text" />
                        </div>
                        <div style={{ marginBottom: 8 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 4 }}>URL</label>
                          <EditableCell value={liveEdit.url} max={2048} onChange={v => setLiveEdit(prev => ({ ...prev, url: v }))} placeholder="https://…" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <div>
                            <label style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 4 }}>Description 1</label>
                            <EditableCell value={liveEdit.description1} max={35} onChange={v => setLiveEdit(prev => ({ ...prev, description1: v }))} placeholder="Description 1" multiline />
                          </div>
                          <div>
                            <label style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, display: 'block', marginBottom: 4 }}>Description 2</label>
                            <EditableCell value={liveEdit.description2} max={35} onChange={v => setLiveEdit(prev => ({ ...prev, description2: v }))} placeholder="Description 2" multiline />
                          </div>
                        </div>
                        {liveEditError && <div style={{ fontSize: 10, color: '#c0392b', marginBottom: 6 }}>{liveEditError}</div>}
                        <div style={{ fontSize: 9, color: '#a56700', marginBottom: 8 }}>Editing changes this sitelink everywhere it's used.</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => saveLiveEdit(l)} disabled={liveEditSaving} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 4, border: '1px solid #1a3a6b', background: '#1a3a6b', color: '#fff', cursor: liveEditSaving ? 'not-allowed' : 'pointer' }}>
                            {liveEditSaving ? <Loader2 size={10} className="spin" /> : 'Save'}
                          </button>
                          <button onClick={() => setLiveEditingIdx(null)} disabled={liveEditSaving} style={{ fontSize: 11, padding: '4px 10px', background: 'none', color: '#888', border: '1px solid #dde9f5', borderRadius: 4, cursor: 'pointer' }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )
                  }
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '8px 12px', borderRadius: 6,
                      background: paused ? '#fff8e6' : '#f0fdf4', border: `1px solid ${paused ? '#f0c040' : '#c8e6c9'}`,
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#1a3a6b', fontWeight: 700 }}>{l.headline}</div>
                        {(l.description1 || l.description2) && (
                          <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{[l.description1, l.description2].filter(Boolean).join(' · ')}</div>
                        )}
                        {l.urls?.[0] && <div style={{ fontSize: 10, color: '#888', wordBreak: 'break-all', marginTop: 2 }}>{l.urls[0]}</div>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: paused ? '#a56700' : '#2e7d32' }}>
                          {paused ? 'Paused' : <><CheckCircle size={12} /> Live</>}
                        </span>
                        <AssetManageActions
                          selectedAccount={selectedAccount} level={levelParam(assetLevel)}
                          campaignId={selectedCamp} adGroupId={selectedAG}
                          linkResourceName={l.linkResourceName} currentStatus={l.status}
                          onChanged={autoVerifyLive}
                          onEdit={() => startLiveEdit(i, l)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertCircle size={16} color="#c0392b" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13, color: '#c0392b' }}>{error}</span>
        </div>
      )}

      {/* ── Shortfall notice — fewer sitelinks than requested were returned ── */}
      {shortfallReason && sitelinks && sitelinks.length < count && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fff8e6', border: '1px solid #ffe0b2', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertCircle size={16} color="#e65100" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13, color: '#a56700' }}>
            <strong>Returned {sitelinks.length} of {count} requested.</strong> {shortfallReason}
          </span>
        </div>
      )}

      {/* ── Loading ── */}
      {isGenerating && (
        <div className="card" style={{ marginBottom: 20 }}>
          <Spinner
            label="Discovering site pages via sitemap.xml & generating sitelinks…"
            sub={`Crawling real pages and creating ${count} ${slType} sitelinks tailored to your site…`}
          />
        </div>
      )}

      {/* ── Steps 4 + 5 — Results table + inline editing ── */}
      {sitelinks && !isGenerating && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="card-title">Generated Sitelinks ({sitelinks.length})</span>
              {liveCount > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 4,
                  background: liveCount === sitelinks.length ? '#e8f5e9' : '#fff8e6',
                  color:      liveCount === sitelinks.length ? '#2e7d32' : '#e65100',
                  border:     `1px solid ${liveCount === sitelinks.length ? '#4caf5033' : '#ffe0b2'}`,
                }}>
                  {liveCount}/{sitelinks.length} live in Google Ads
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleVerify} disabled={verifying}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #1a3a6b', background: '#fff', color: '#1a3a6b', cursor: verifying ? 'not-allowed' : 'pointer' }}>
                {verifying ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}
                {verifying ? 'Checking…' : 'Check Live Status'}
              </button>
              <button onClick={handleGenerate}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #555', background: 'transparent', color: '#555', cursor: 'pointer' }}>
                <RefreshCw size={11} /> Re-Generate All
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {[
                    ['#',             'center', 36],
                    ['Sitelink Text', 'left',   160],
                    ['URL',           'left',   180],
                    ['Description 1', 'left',   160],
                    ['Description 2', 'left',   160],
                    ['Score',         'center', 54],
                    ['Actions',       'center', 130],
                  ].map(([h, a, w]) => (
                    <th key={h} style={{
                      padding: '8px 10px', textAlign: a, fontSize: 10, fontWeight: 700,
                      color: '#fff', background: '#1a3a6b', whiteSpace: 'nowrap',
                      minWidth: w, letterSpacing: .3,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sitelinks.map((sl, idx) => {
                  const rowQ    = quality?.perSitelink?.[idx]
                  const editing = editingRow === idx
                  const live    = isLive(sl.headline)
                  const regen   = regenRow === idx
                  const upload  = uploading[idx]
                  const done    = uploaded[idx] || live
                  const rowBg   = live ? '#f0fdf4' : editing ? '#f8f9ff' : idx % 2 === 0 ? '#fff' : '#f9fafb'

                  return (
                    <tr key={idx} style={{ background: rowBg, transition: 'background 0.15s' }}>
                      {/* # */}
                      <td style={{ padding: '8px 10px', textAlign: 'center', color: '#aaa', fontSize: 11, fontWeight: 700, borderBottom: '1px solid #f0f4f8', verticalAlign: 'middle' }}>
                        {idx + 1}
                        {live && <div><CheckCircle size={11} color="#2e7d32" /></div>}
                      </td>

                      {/* Sitelink Text */}
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f4f8', verticalAlign: 'top' }}>
                        {editing ? (
                          <EditableCell value={sl.headline} max={25} onChange={v => updateRow(idx, 'headline', v)} placeholder="Sitelink text" />
                        ) : (
                          <div>
                            <div style={{ fontWeight: 700, color: live ? '#2e7d32' : '#1565c0', fontSize: 13, marginBottom: 2 }}>{sl.headline}</div>
                            <span style={{ fontSize: 9, color: charColor(sl.headline?.length || 0, 25) }}>{sl.headline?.length || 0}/25</span>
                          </div>
                        )}
                      </td>

                      {/* URL */}
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f4f8', verticalAlign: 'top' }}>
                        {editing ? (
                          <EditableCell value={sl.url} max={2048} onChange={v => updateRow(idx, 'url', v)} placeholder="https://…" />
                        ) : (
                          <div style={{ fontSize: 11, color: '#555', wordBreak: 'break-all', lineHeight: 1.4 }}>
                            {sl.url}
                            <div style={{ marginTop: 3 }}><CopyBtn text={sl.url} /></div>
                          </div>
                        )}
                      </td>

                      {/* Description 1 */}
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f4f8', verticalAlign: 'top' }}>
                        {editing ? (
                          <EditableCell value={sl.description1 || ''} max={35} onChange={v => updateRow(idx, 'description1', v)} placeholder="Description 1" multiline />
                        ) : (
                          <div>
                            <div style={{ fontSize: 12, color: '#444', lineHeight: 1.4 }}>{sl.description1}</div>
                            <span style={{ fontSize: 9, color: charColor(sl.description1?.length || 0, 35) }}>{sl.description1?.length || 0}/35</span>
                          </div>
                        )}
                      </td>

                      {/* Description 2 */}
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f4f8', verticalAlign: 'top' }}>
                        {editing ? (
                          <EditableCell value={sl.description2 || ''} max={35} onChange={v => updateRow(idx, 'description2', v)} placeholder="Description 2" multiline />
                        ) : (
                          <div>
                            <div style={{ fontSize: 12, color: '#444', lineHeight: 1.4 }}>{sl.description2}</div>
                            <span style={{ fontSize: 9, color: charColor(sl.description2?.length || 0, 35) }}>{sl.description2?.length || 0}/35</span>
                          </div>
                        )}
                      </td>

                      {/* Score */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #f0f4f8', verticalAlign: 'middle' }}>
                        {rowQ && <ScoreBadge score={rowQ.score} />}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #f0f4f8', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                          {/* Edit / Done */}
                          <button
                            onClick={() => setEditingRow(editing ? null : idx)}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4,
                              border: `1px solid ${editing ? '#2e7d32' : '#1a3a6b'}`,
                              background: editing ? '#e8f5e9' : '#fff',
                              color: editing ? '#2e7d32' : '#1a3a6b', cursor: 'pointer',
                            }}>
                            <Edit2 size={10} /> {editing ? 'Done' : 'Edit'}
                          </button>

                          {/* Re-Generate */}
                          <button
                            onClick={() => handleRegenRow(idx)}
                            disabled={regen}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4,
                              border: '1px solid #e65100', background: '#fff', color: '#e65100',
                              cursor: regen ? 'not-allowed' : 'pointer',
                            }}>
                            {regen ? <Loader2 size={10} className="spin" /> : <RefreshCw size={10} />}
                            {regen ? 'Generating…' : 'Re-Generate'}
                          </button>

                          {/* Upload */}
                          {(() => {
                            const hardIssues = (rowQ?.issues || []).filter(i =>
                              i.includes('limit') || i.includes('Invalid') || i.includes('Missing headline')
                            )
                            const blocked = upload || hardIssues.length > 0
                            return done ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#2e7d32' }}>
                                <CheckCircle size={12} /> {live ? 'Live' : 'Uploaded'}
                              </span>
                            ) : (
                              <button
                                onClick={() => handleUpload(idx)}
                                disabled={blocked}
                                title={hardIssues.length ? `Fix issues first: ${hardIssues.join(', ')}` : ''}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 4,
                                  border: `1px solid ${hardIssues.length ? '#aaa' : '#1a3a6b'}`,
                                  background: hardIssues.length ? '#f5f5f5' : '#1a3a6b',
                                  color: hardIssues.length ? '#aaa' : '#fff',
                                  cursor: blocked ? 'not-allowed' : 'pointer',
                                }}>
                                {upload ? <Loader2 size={10} className="spin" /> : <Upload size={10} />}
                                {upload ? 'Uploading…' : 'Upload'}
                              </button>
                            )
                          })()}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Duplicate warning — generated sitelinks that already exist at this level */}
          {liveCount > 0 && (
            <div style={{ margin: '0 16px 16px', padding: '10px 14px', background: '#e8f5e9', border: '1px solid #4caf5033', borderRadius: 6, fontSize: 12, color: '#2e7d32' }}>
              <CheckCircle size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              {liveCount} of these already exist at this level (matched by headline or URL) — they're marked <strong>Live</strong> above and won't be uploaded again.
            </div>
          )}

          {/* Issues highlight for below-threshold sitelinks */}
          {quality?.belowThresh?.length > 0 && (
            <div style={{ margin: '0 16px 16px', padding: '10px 14px', background: '#fff8e6', border: '1px solid #ffe0b2', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#a56700', marginBottom: 6 }}>
                ⚠ {quality.belowThresh.length} sitelink{quality.belowThresh.length > 1 ? 's' : ''} below quality threshold — recommend regenerating
              </div>
              {quality.belowThresh.map(r => (
                <div key={r.idx} style={{ fontSize: 11, color: '#a56700', marginBottom: 2 }}>
                  • Row {r.idx + 1}: {r.issues.join(' · ')}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Step 5 — Quality Validation ── */}
      {quality && !isGenerating && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="card-title">Quality Validation</span>
            <span style={{
              fontSize: 13, fontWeight: 700, padding: '4px 14px', borderRadius: 6,
              background: `${quality.gradeColor}18`, color: quality.gradeColor, border: `1px solid ${quality.gradeColor}44`,
            }}>
              {quality.overall}/100 — {quality.grade}
            </span>
          </div>
          <div style={{ padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {quality.checks.map((c, i) => (
              <div key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: c.pass ? '#e8f5e9' : '#fff5f5',
                color:      c.pass ? '#2e7d32' : '#c0392b',
                border:     `1px solid ${c.pass ? '#4caf5033' : '#ffd5cc'}`,
              }}>
                {c.pass ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
                {c.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 6 — Review & Upload ── */}
      {sitelinks && !isGenerating && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <span className="card-title">Review &amp; Upload to Google Ads</span>
          </div>
          <div style={{ padding: '16px' }}>

            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Campaign',         value: selectedCampName || '—'   },
                { label: 'Ad Group',         value: selectedAGName   || '—'   },
                { label: 'Asset Level',      value: assetLevel                 },
                { label: 'Sitelinks',        value: `${sitelinks.length} generated` },
                { label: 'Sitelink Type',    value: slType                     },
                { label: 'Overall Quality',  value: quality ? `${quality.overall}/100 — ${quality.grade}` : '—', color: quality?.gradeColor },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ padding: '10px 14px', background: '#fafcff', border: '1px solid #eef2f7', borderRadius: 7 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: color || '#1a3a6b', lineHeight: 1.3 }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Upload status */}
            {(uploadedCount > 0 || liveCount > 0) && (
              <div style={{ marginBottom: 16, padding: '10px 14px', background: '#e8f5e9', border: '1px solid #4caf5033', borderRadius: 7, fontSize: 12, color: '#2e7d32', fontWeight: 600 }}>
                <CheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                {liveCount} sitelink{liveCount !== 1 ? 's' : ''} confirmed live · {uploadedCount} uploaded this session
              </div>
            )}

            {/* Upload All button */}
            {!allUploaded ? (
              <button onClick={handleUploadAll}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 28px',
                  background: '#2e7d32', color: '#fff', fontWeight: 700, fontSize: 14,
                  borderRadius: 7, border: 'none', cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(46,125,50,0.25)',
                }}>
                <Upload size={16} />
                Upload All {sitelinks.filter((sl, i) => !uploaded[i] && !isLive(sl.headline)).length} Remaining Sitelinks to Google Ads
              </button>
            ) : (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 24px', background: '#e8f5e9', borderRadius: 7, border: '1px solid #4caf50', color: '#2e7d32', fontWeight: 700, fontSize: 14 }}>
                <CheckCircle size={18} />
                All Sitelinks Uploaded Successfully
              </div>
            )}

            <div style={{ marginTop: 12, fontSize: 11, color: '#aaa', lineHeight: 1.6 }}>
              Sitelinks will be attached at the <strong>{assetLevel}</strong>.
              Individual sitelinks can also be uploaded row-by-row from the table above.
              After uploading, click <strong>Check Live Status</strong> to confirm propagation (may take a few minutes).
            </div>
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!sitelinks && !isGenerating && !error && (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: '#aaa', fontSize: 13, lineHeight: 2 }}>
          {!levelReady
            ? (assetLevel === 'Ad Group Level'
                ? <>Select a <strong>Campaign</strong> and <strong>Ad Group</strong>, enter a <strong>Final URL</strong>, then click Generate.</>
                : <>Select a <strong>Campaign</strong>, enter a <strong>Final URL</strong>, then click Generate.</>)
            : !finalUrl.trim()
            ? <>Enter the <strong>Final URL</strong> for the page you want to create sitelinks for.</>
            : <>Configure settings above and click <strong>Generate {count} Sitelinks with AI</strong>.</>}
        </div>
      )}
    </>
  )
}
