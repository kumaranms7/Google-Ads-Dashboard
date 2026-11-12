import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { Loader2, AlertCircle, CheckCircle, Globe, Search, Copy, Check, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import ExportButton         from '../../components/ExportButton.jsx'
import StatusBadge           from '../../components/StatusBadge.jsx'
import PublishKeywordModal    from '../../components/PublishKeywordModal.jsx'
import SearchTermPublishModal from '../../components/SearchTermPublishModal.jsx'
import {
  buildKwMap, buildNegMaps, resolveKwSignal, buildOptimisticPublishRecords,
  KwSignalBadge, KwSignalModal,
} from '../../components/KwSignal.jsx'
import { analyzeCurrentRSAAssets, analyzeSearchTerms, detectLandingPageMismatch, classifyHeadlineType } from '../../services/rsaBuilderService.js'
import { analyzeLandingPage } from '../../services/landingPageAnalyzer.js'
import { estimateAdStrength } from '../../services/rsaScoringEngine.js'
import { estimateConversionReadiness } from '../../services/conversionReadiness/conversionReadinessEngine.js'
import { getEffectiveLength } from '../../utils/rsaValidation.js'
import { INTENT_CATEGORIES } from '../../services/intentClassifier.js'
import { highlightRecommendation } from '../../utils/highlightRecommendation.jsx'
import { sortByStatus } from '../campaign-manager/shared.jsx'
import RsaReportsTab from './RsaReportsTab.jsx'

// ── Shared helpers ────────────────────────────────────────────────────────────

const fmtUsd = v => '$' + Number(v || 0).toFixed(2)

// A fingerprint of the page fields the match score / mismatch analysis
// actually reads — used to tell "the refresh worked and the page really is
// unchanged" apart from "the refresh silently returned a stale cached copy"
// (a client-side CDN or WP cache plugin serving the old HTML back despite
// the cache-busting query param — outside this app's control, but worth
// surfacing explicitly instead of leaving the user to wonder if Refresh
// itself is broken).
function lpFingerprint(lp) {
  if (!lp || lp.error) return null
  return [lp.title, lp.h1, ...(lp.h2s || []), lp.metaDescription, lp.bodySnippet || ''].join('|')
}

function NoAccount() {
  return (
    <div style={{ padding: 80, textAlign: 'center', color: '#aaa', fontSize: 14 }}>
      Select an account from the sidebar to use the RSA Builder.
    </div>
  )
}

function Spinner({ label = 'Loading…' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40, color: '#888', fontSize: 13 }}>
      <Loader2 size={18} className="spin" />{label}
    </div>
  )
}

// ── Ad strength badge ─────────────────────────────────────────────────────────

const AD_STRENGTH_COLOR = {
  Excellent: '#2e7d32', Good: '#4caf50', Average: '#e65100',
  Poor: '#c0392b', Pending: '#888', 'No Ads': '#888', Unknown: '#888',
}
function AdStrengthBadge({ value }) {
  const color = AD_STRENGTH_COLOR[value] || '#888'
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4,
      background: `${color}18`, color, border: `1px solid ${color}44`,
    }}>{value || 'Unknown'}</span>
  )
}

// ── Score ring ────────────────────────────────────────────────────────────────

const GRADE_COLOR = { Excellent: '#2e7d32', Good: '#4caf50', Average: '#e65100', Poor: '#c0392b', Incomplete: '#888' }

// Conversion Readiness uses its own grade vocabulary (Strong/Moderate/Weak/Poor)
// — deliberately distinct from Ad Strength's grades so the two scores are
// never visually confused for one another.
const CONVERSION_GRADE_COLOR = { Strong: '#2e7d32', Moderate: '#4caf50', Weak: '#e65100', Poor: '#c0392b' }

function ScoreRing({ score, maxScore = 100, grade, size = 80, color: colorProp }) {
  const pct  = Math.min(100, Math.round((score / maxScore) * 100))
  const color = colorProp || GRADE_COLOR[grade] || '#888'
  const r = (size / 2) - 8
  const circ = 2 * Math.PI * r
  const dash = circ - (pct / 100) * circ
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e8eef5" strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={dash} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: size * 0.22, fontWeight: 700, color, lineHeight: 1 }}>{pct}</span>
        <span style={{ fontSize: size * 0.12, color: '#888', lineHeight: 1.2 }}>/ 100</span>
      </div>
    </div>
  )
}

// ── Score breakdown — Current vs. AI Recs ────────────────────────────────────
// Shared by both Ad Strength and Conversion Readiness: when an "after" score
// exists, every category row shows both bars side by side instead of only
// the current score's breakdown, so the AI-recommended set can be compared
// category-by-category, not just by its single total.
// A labeled list of issues/recommendations — shared by the Ad Strength and
// Conversion Readiness blocks so "problems with the current RSA" and
// "problems remaining in the AI-generated RSA" can be shown as two clearly
// separate panels instead of one list that reads as if it contradicts
// whichever score sits next to it.
function IssuesPanel({ title, issues, color = '#c0392b' }) {
  if (!issues?.length) return null
  return (
    <div style={{ flex: 1, minWidth: 180 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {issues.map((iss, i) => (
          <div key={i} style={{ fontSize: 12, color, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <span style={{ marginTop: 2, flexShrink: 0 }}>•</span>{iss}
          </div>
        ))}
      </div>
    </div>
  )
}

// Which exact headline/description indices earned a component's points —
// only Conversion Readiness's breakdown carries `assets`; Ad Strength's
// components don't, so this quietly renders nothing for those.
function assetSummary(dim) {
  if (!dim?.assets) return ''
  const hl = (dim.assets.headlines    || []).map(i => `Headline ${i + 1}`)
  const ds = (dim.assets.descriptions || []).map(i => `Description ${i + 1}`)
  const all = [...hl, ...ds]
  return all.length ? `Earned by: ${all.join(', ')}` : ''
}

function BreakdownCompareRows({ current, after, currentLabel = 'Current', afterLabel = 'With AI Recs', labelWidth = 175 }) {
  if (!current) return null
  const barColor = dim => dim.score / dim.max >= 0.7 ? '#4caf50' : dim.score / dim.max >= 0.4 ? '#e8a020' : '#e05c2a'
  const Bar = ({ dim }) => {
    if (dim.applicable === false) {
      return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }} title="Not applicable — this business has no offer or eligibility restriction on file, so it's excluded rather than penalized">
          <div style={{ flex: 1, height: 6, background: '#f2f2f2', borderRadius: 4 }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: '#aaa', width: 34, textAlign: 'right', flexShrink: 0 }}>N/A</span>
        </div>
      )
    }
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }} title={assetSummary(dim) || undefined}>
        <div style={{ flex: 1, height: 6, background: '#eef2f7', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 4, width: `${Math.round((dim.score / dim.max) * 100)}%`, background: barColor(dim), transition: 'width 0.5s ease' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#1a3a6b', width: 34, textAlign: 'right', flexShrink: 0 }}>{dim.score}/{dim.max}</span>
      </div>
    )
  }
  return (
    <div style={{ flex: 1, minWidth: after ? 400 : 220, display: 'flex', flexDirection: 'column', gap: 7 }}>
      {after && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: labelWidth, flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>{currentLabel}</span>
          <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1 }}>{afterLabel}</span>
        </div>
      )}
      {Object.entries(current).map(([key, dim]) => {
        const afterDim = after?.[key]
        return (
          <div key={dim.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: '#555', width: labelWidth, flexShrink: 0 }}>{dim.label}</span>
            <Bar dim={dim} />
            {after && (afterDim ? <Bar dim={afterDim} /> : <div style={{ flex: 1 }} />)}
          </div>
        )
      })}
    </div>
  )
}

// ── Conversion Readiness block ───────────────────────────────────────────────
// A second, separate score from Estimated Ad Strength. Ad Strength measures
// copy diversity/structure (the same dimensions Google's own rating covers);
// it says nothing about whether the ad is actually likely to convert once
// clicked. This block is always shown alongside — never merged into — the
// Ad Strength block, with its own grade vocabulary and color so the two are
// never mistaken for one another.
function ConversionReadinessBlock({
  result, ringSize = 82, showHeader = true, showIssues = true,
  after = null, afterLoading = false, beforeLabel = 'Current', afterLabel = 'With AI Recs',
}) {
  if (!result) return null
  const color = CONVERSION_GRADE_COLOR[result.grade] || '#888'
  const afterColor = after ? (CONVERSION_GRADE_COLOR[after.grade] || '#888') : null
  return (
    <div style={{ borderTop: showHeader ? '2px solid #eef2f7' : 'none', padding: '16px' }}>
      {showHeader && (
        <div title="A separate, heuristic estimate of likelihood to convert (offer strength, trust signals, CTA, lead qualification, landing-page message match) — not Ad Strength, and not a Google metric of any kind." style={{ fontSize: 10, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>
          Conversion Readiness Score (beta estimate — not Google's rating)
        </div>
      )}
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            {(after !== null || afterLoading) && (
              <span style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>{beforeLabel}</span>
            )}
            <ScoreRing score={result.score} maxScore={100} grade={result.grade} color={color} size={ringSize} />
            <span style={{ fontSize: 12, fontWeight: 700, color }}>{result.grade}</span>
          </div>
          {after ? (
            <>
              <div style={{ fontSize: 20, color: '#dde9f5', alignSelf: 'center', marginBottom: 22 }}>→</div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1 }}>{afterLabel}</span>
                <ScoreRing score={after.score} maxScore={100} grade={after.grade} color={afterColor} size={ringSize} />
                <span style={{ fontSize: 12, fontWeight: 700, color: afterColor }}>{after.grade}</span>
                {after.score > result.score && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#2e7d32' }}>+{(after.score - result.score).toFixed(1)} pts</span>
                )}
              </div>
            </>
          ) : afterLoading ? (
            <div style={{ alignSelf: 'center', fontSize: 11, color: '#aaa', maxWidth: 150, marginBottom: 22 }}>
              Generating AI content…
            </div>
          ) : null}
        </div>

        <BreakdownCompareRows current={result.breakdown} after={after?.breakdown} currentLabel={beforeLabel} afterLabel={afterLabel} />

        {showIssues && <IssuesPanel title={after ? `Recommendations for ${beforeLabel}` : 'Conversion Recommendations'} issues={result.issues} color="#a56700" />}
        {showIssues && after && <IssuesPanel title={`Still Remaining in ${afterLabel}`} issues={after.issues} color="#a56700" />}
      </div>
    </div>
  )
}

// ── Ad Action Modal (Audit tab: Update / Pause / Remove) ─────────────────────

function AdActionModal({ ad, customerId, adGroupId, adGroupName, initialMode, onClose, onSuccess }) {
  const [mode, setMode]             = useState(initialMode || 'eligible')
  const [confirmed, setConfirmed]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [submitError, setSubmitError]   = useState(null)

  function switchMode(m) { setMode(m); setConfirmed(false); setSubmitError(null) }

  async function handleEnable() {
    setSubmitting(true); setSubmitError(null)
    try {
      await window.electronAPI.rsaEnableAd({ customerId, adGroupId, adId: ad.adId })
      setSubmitResult('eligible')
    } catch (e) { setSubmitError(e.message) }
    finally { setSubmitting(false) }
  }
  async function handlePause() {
    setSubmitting(true); setSubmitError(null)
    try {
      await window.electronAPI.rsaPauseAd({ customerId, adGroupId, adId: ad.adId })
      setSubmitResult('pause')
    } catch (e) { setSubmitError(e.message) }
    finally { setSubmitting(false) }
  }
  async function handleRemove() {
    setSubmitting(true); setSubmitError(null)
    try {
      await window.electronAPI.rsaRemoveAd({ customerId, adGroupId, adId: ad.adId })
      setSubmitResult('remove')
    } catch (e) { setSubmitError(e.message) }
    finally { setSubmitting(false) }
  }

  const ACTION_COLOR = { eligible: '#2e7d32', pause: '#e65100', remove: '#c0392b' }
  const handleConfirm = mode === 'eligible' ? handleEnable : mode === 'pause' ? handlePause : handleRemove

  const isEnabled = ad.status === 'ENABLED'
  const isPaused  = ad.status === 'PAUSED'
  const isRemoved = ad.status === 'REMOVED'

  // ── Success screen ──
  if (submitResult) {
    const msgs   = { eligible: 'Ad has been set to Eligible and will start showing again.', pause: 'Ad has been paused. You can re-enable it at any time.', remove: 'Ad has been permanently removed from Google Ads.' }
    const titles = { eligible: 'Ad Enabled!', pause: 'Ad Paused!', remove: 'Ad Removed!' }
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', borderRadius:12, padding:36, maxWidth:480, width:'90%', textAlign:'center', boxShadow:'0 8px 40px rgba(0,0,0,0.2)' }}>
          <CheckCircle size={48} color="#2e7d32" style={{ marginBottom:12 }} />
          <div style={{ fontSize:18, fontWeight:700, color:'#1a3a6b', marginBottom:8 }}>{titles[submitResult]}</div>
          <div style={{ fontSize:13, color:'#555', marginBottom:20 }}>{msgs[submitResult]}</div>
          <button onClick={onSuccess} style={{ padding:'8px 28px', background:'#1a3a6b', color:'#fff', border:'none', borderRadius:6, fontWeight:700, fontSize:13, cursor:'pointer' }}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'#fff', borderRadius:12, maxWidth:920, width:'100%', maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 8px 40px rgba(0,0,0,0.2)' }}>

        {/* Header */}
        <div style={{ padding:'16px 24px', borderBottom:'1px solid #eef2f7', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, background:'#fff', zIndex:1 }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:'#1a3a6b' }}>Apply Changes to Google Ads</div>
            <div style={{ fontSize:11, color:'#888', marginTop:2 }}>{adGroupName} · Ad #{ad.adId}</div>
          </div>
          <button onClick={onClose} disabled={submitting} style={{ background:'none', border:'none', cursor:'pointer', color:'#888', fontSize:22, lineHeight:1, padding:'0 4px' }}>×</button>
        </div>

        {/* Mode tabs */}
        <div style={{ padding:'12px 24px', borderBottom:'1px solid #eef2f7', display:'flex', gap:8, flexWrap:'wrap' }}>
          {[
            { id:'eligible', label:'Set Eligible', disabled: isEnabled  },
            { id:'pause',    label:'Pause Ad',     disabled: isPaused   },
            { id:'remove',   label:'Remove Ad',    disabled: isRemoved  },
          ].map(m => (
            <button key={m.id} onClick={() => !m.disabled && switchMode(m.id)}
              style={{
                padding:'7px 18px', fontSize:12, fontWeight:600, borderRadius:6,
                cursor: m.disabled ? 'not-allowed' : 'pointer',
                opacity: m.disabled ? 0.4 : 1,
                background: mode === m.id ? ACTION_COLOR[m.id] : '#fff',
                color:      mode === m.id ? '#fff' : ACTION_COLOR[m.id],
                border:     `1px solid ${ACTION_COLOR[m.id]}`,
              }}>{m.label}</button>
          ))}
          <span style={{ marginLeft:'auto', fontSize:11, color:'#aaa', alignSelf:'center' }}>
            Current status: <strong style={{ color: isEnabled?'#2e7d32':isPaused?'#e65100':'#c0392b' }}>
              {isEnabled?'Eligible':isPaused?'Paused':'Removed'}
            </strong>
          </span>
        </div>

        {/* Content */}
        <div style={{ flex:1, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:18 }}>

          {/* ── Set Eligible ── */}
          {mode === 'eligible' && (
            <div style={{ textAlign:'center', padding:'20px 0' }}>
              <div style={{ fontSize:44, marginBottom:12 }}>✅</div>
              <div style={{ fontSize:16, fontWeight:700, color:'#2e7d32', marginBottom:10 }}>Set Ad as Eligible?</div>
              <div style={{ fontSize:13, color:'#555', lineHeight:1.7, marginBottom:16 }}>
                Ad <strong>#{ad.adId}</strong> in <strong>{adGroupName}</strong> will be set to <strong>Enabled</strong>.<br />
                It will become eligible to show in search results.
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                {ad.headlines.slice(0,3).map((h,i) => <div key={i} style={{ fontSize:12, color:'#aaa' }}>{h.text}</div>)}
              </div>
            </div>
          )}

          {/* ── Pause ── */}
          {mode === 'pause' && (
            <div style={{ textAlign:'center', padding:'20px 0' }}>
              <div style={{ fontSize:44, marginBottom:12 }}>⏸</div>
              <div style={{ fontSize:16, fontWeight:700, color:'#e65100', marginBottom:10 }}>Pause This Ad?</div>
              <div style={{ fontSize:13, color:'#555', lineHeight:1.7, marginBottom:16 }}>
                Ad <strong>#{ad.adId}</strong> in <strong>{adGroupName}</strong> will be paused.<br />
                It will stop showing immediately. You can re-enable it at any time from Google Ads.
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:3, marginBottom:4 }}>
                {ad.headlines.slice(0,3).map((h,i) => <div key={i} style={{ fontSize:12, color:'#aaa' }}>{h.text}</div>)}
              </div>
            </div>
          )}

          {/* ── Remove ── */}
          {mode === 'remove' && (
            <div style={{ textAlign:'center', padding:'20px 0' }}>
              <div style={{ fontSize:44, marginBottom:12 }}>🗑️</div>
              <div style={{ fontSize:16, fontWeight:700, color:'#c0392b', marginBottom:10 }}>Remove This Ad?</div>
              <div style={{ fontSize:13, color:'#555', lineHeight:1.7, marginBottom:16 }}>
                Ad <strong>#{ad.adId}</strong> in <strong>{adGroupName}</strong> will be permanently removed.<br />
                <strong style={{ color:'#c0392b' }}>This cannot be undone.</strong>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:3, marginBottom:4 }}>
                {ad.headlines.slice(0,3).map((h,i) => <div key={i} style={{ fontSize:12, color:'#aaa' }}>{h.text}</div>)}
              </div>
            </div>
          )}

          {/* Confirm checkbox */}
          <label style={{ display:'flex', alignItems:'flex-start', gap:10, cursor:'pointer', padding:'10px 14px', background:'#fafcff', border:'1px solid #dde9f5', borderRadius:7 }}>
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ accentColor:'#1a3a6b', width:15, height:15, marginTop:1, flexShrink:0 }} />
            <span style={{ fontSize:12, color:'#333', lineHeight:1.6 }}>
              I understand this will <strong>make live changes</strong> to my Google Ads account and I have reviewed the changes above.
            </span>
          </label>

          {submitError && (
            <div style={{ padding:'10px 14px', background:'#fff5f5', border:'1px solid #ffd5cc', borderRadius:7, fontSize:12, color:'#c0392b' }}>
              {submitError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'14px 24px', borderTop:'1px solid #eef2f7', display:'flex', justifyContent:'flex-end', gap:10, position:'sticky', bottom:0, background:'#fff' }}>
          <button onClick={onClose} disabled={submitting} style={{ padding:'8px 20px', fontWeight:600, fontSize:13, borderRadius:6, border:'1px solid #dde9f5', background:'#fff', color:'#555', cursor: submitting?'not-allowed':'pointer' }}>
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={!confirmed || submitting}
            style={{ padding:'8px 22px', fontWeight:700, fontSize:13, borderRadius:6, border:'none', cursor: !confirmed||submitting?'not-allowed':'pointer',
              background: !confirmed||submitting ? '#dde9f5' : ACTION_COLOR[mode],
              color: !confirmed||submitting ? '#aaa' : '#fff',
              display:'inline-flex', alignItems:'center', gap:8,
            }}>
            {submitting ? <><Loader2 size={13} className="spin" /> Processing…</> :
              mode==='eligible' ? '✓ Set Eligible' :
              mode==='pause'    ? '⏸ Confirm Pause' :
              '🗑️ Confirm Remove'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Existing RSA Content ─────────────────────────────────────────────────
// Genuinely edits a live, already-published RSA's headlines/descriptions/URL
// in place via AdService (customer.ads.update — confirmed live this works),
// instead of the pause-old+create-new flow the Generate tab's Publish uses.
// Same ad resource name and performance history the whole time.
function EditAdContentModal({
  ad, customerId, adGroupId, adGroupName, campaignName, keywords, landingPage,
  businessName, preventCrossover, siblingAdGroupNames,
  aiHeadlines, aiHeadlineTypes, aiDescriptions, aiLoading, aiError, onRegenerateAi, onUpdateAiItem,
  onClose, onSuccess,
}) {
  const [headlines,    setHeadlines]    = useState(() => (ad.headlines    || []).map(h => ({ text: h.text, pinned: h.pinned })))
  const [descriptions, setDescriptions] = useState(() => (ad.descriptions || []).map(d => ({ text: d.text, pinned: d.pinned })))

  // Per-row "Regenerate" on the AI Recommended reference list — refreshes just
  // that one AI suggestion via the same on-demand single-item call the normal
  // (non-popup) accordion view uses, and persists the change up through
  // onUpdateAiItem so both views stay in sync (they share the same underlying
  // adGenResults[adId] state in the parent).
  const [aiRegenLoading, setAiRegenLoading] = useState({})
  const [aiRegenError,   setAiRegenError]   = useState({})

  async function handleRegenAiItem(assetType, index) {
    const key = `${assetType}_${index}`
    setAiRegenLoading(prev => ({ ...prev, [key]: true }))
    setAiRegenError(prev => ({ ...prev, [key]: null }))
    try {
      const isHl = assetType === 'headline'
      const currentText = isHl ? aiHeadlines?.[index] : aiDescriptions?.[index]
      const res = await window.electronAPI.rsaRegenerateSingleAsset({
        customerId, assetType, currentText, index,
        adGroupName, businessName: businessName || '', tone: 'Professional',
        keywords: keywords || [],
        allHeadlines:    aiHeadlines    || [],
        allDescriptions: aiDescriptions || [],
        crossSetTexts: [],
        preventCrossover, siblingAdGroupNames,
        landingPageUrl: ad?.finalUrls?.[0] || '',
      })
      if (res?.text) onUpdateAiItem?.(assetType, index, res.text)
    } catch (e) {
      setAiRegenError(prev => ({ ...prev, [key]: e.message || 'Regeneration failed. Please try again.' }))
    } finally {
      setAiRegenLoading(prev => ({ ...prev, [key]: false }))
    }
  }
  const [finalUrl, setFinalUrl] = useState(ad.finalUrls?.[0] || '')
  const [path1,    setPath1]    = useState(ad.path1 || '')
  const [path2,    setPath2]    = useState(ad.path2 || '')
  const [confirmed,   setConfirmed]   = useState(false)
  const [submitting,  setSubmitting]  = useState(false)
  const [submitDone,  setSubmitDone]  = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // Must pass the same landingPage the Audit card's own score used (see
  // call site) — without it, the keyword-relevance and landing-page-match
  // components both fall back to a neutral default instead of the real
  // page-overlap score, which is exactly why this popup's number used to
  // disagree with the ad's actual score shown in the Audit tab.
  const adStrength = useMemo(() => estimateAdStrength({
    headlines,    // already [{text, pinned}] — keep pinning so combination flexibility scores correctly
    descriptions,
    keywords,
    landingPage,
    hasFinalUrl: !!finalUrl,
  }), [headlines, descriptions, keywords, landingPage, finalUrl])

  const conversionReadiness = useMemo(() => estimateConversionReadiness({
    headlines, descriptions, keywords, landingPage,
  }), [headlines, descriptions, keywords, landingPage])

  function updateHeadline(i, text)    { setHeadlines(prev => prev.map((h, idx) => idx === i ? { ...h, text } : h)) }
  function updateDescription(i, text) { setDescriptions(prev => prev.map((d, idx) => idx === i ? { ...d, text } : d)) }
  function addHeadline()    { if (headlines.length    < 15) setHeadlines(prev => [...prev, { text: '', pinned: null }]) }
  function removeHeadline(i)    { if (headlines.length    > 3) setHeadlines(prev => prev.filter((_, idx) => idx !== i)) }
  function addDescription() { if (descriptions.length < 4)  setDescriptions(prev => [...prev, { text: '', pinned: null }]) }
  function removeDescription(i) { if (descriptions.length > 2)  setDescriptions(prev => prev.filter((_, idx) => idx !== i)) }

  // Swap ANY existing slot's text for ANY AI-recommended item — e.g. existing
  // #1 can take AI #7 — keeps that slot's pin (if any) since only the text
  // is being replaced, not the slot itself.
  function replaceHeadlineWithAi(i, aiIdx) {
    if (!aiHeadlines?.[aiIdx]) return
    setHeadlines(prev => prev.map((h, idx) => idx === i ? { ...h, text: aiHeadlines[aiIdx] } : h))
  }
  function replaceDescriptionWithAi(i, aiIdx) {
    if (!aiDescriptions?.[aiIdx]) return
    setDescriptions(prev => prev.map((d, idx) => idx === i ? { ...d, text: aiDescriptions[aiIdx] } : d))
  }
  // Bulk swap — separate for headlines vs descriptions, per request. Drops
  // pins since the whole set is being replaced wholesale, not slot-by-slot.
  function replaceAllHeadlinesWithAi() {
    if (!aiHeadlines?.length) return
    setHeadlines(aiHeadlines.slice(0, 15).map(text => ({ text, pinned: null })))
  }
  function replaceAllDescriptionsWithAi() {
    if (!aiDescriptions?.length) return
    setDescriptions(aiDescriptions.slice(0, 4).map(text => ({ text, pinned: null })))
  }

  const hlErrors  = headlines.filter(h => !h.text.trim() || getEffectiveLength(h.text) > 30)
  const dsErrors  = descriptions.filter(d => !d.text.trim() || getEffectiveLength(d.text) > 90)
  const hasErrors = hlErrors.length > 0 || dsErrors.length > 0 || headlines.length < 3 || descriptions.length < 2

  const original = {
    headlines:    (ad.headlines    || []).map(h => h.text).join('|'),
    descriptions: (ad.descriptions || []).map(d => d.text).join('|'),
    finalUrl:     ad.finalUrls?.[0] || '', path1: ad.path1 || '', path2: ad.path2 || '',
  }
  const dirty = headlines.map(h => h.text).join('|') !== original.headlines
    || descriptions.map(d => d.text).join('|') !== original.descriptions
    || finalUrl !== original.finalUrl || path1 !== original.path1 || path2 !== original.path2

  async function handleSave() {
    setSubmitting(true); setSubmitError(null)
    try {
      const cleanHeadlines    = headlines.map(h => ({ text: h.text.trim(), pinned: h.pinned }))
      const cleanDescriptions = descriptions.map(d => ({ text: d.text.trim(), pinned: d.pinned }))
      const cleanFinalUrl = finalUrl.trim(), cleanPath1 = path1.trim(), cleanPath2 = path2.trim()
      await window.electronAPI.rsaUpdateExistingAd({
        customerId, adGroupId, adId: ad.adId, campaignName, adGroupName,
        headlines: cleanHeadlines, descriptions: cleanDescriptions,
        finalUrl: cleanFinalUrl, path1: cleanPath1, path2: cleanPath2,
        before: {
          headlines: (ad.headlines || []).map(h => ({ text: h.text, pinned: h.pinned })),
          descriptions: (ad.descriptions || []).map(d => ({ text: d.text, pinned: d.pinned })),
          finalUrl: original.finalUrl, path1: original.path1, path2: original.path2,
        },
      })
      setSubmitDone(true)
      onSuccess?.(ad.adId, {
        headlines: cleanHeadlines, descriptions: cleanDescriptions,
        finalUrls: [cleanFinalUrl].filter(Boolean), path1: cleanPath1, path2: cleanPath2,
      })
    } catch (e) {
      setSubmitError(e.message)
    } finally {
      setSubmitting(false)
    }
  }


  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'#fff', borderRadius:12, maxWidth:1120, width:'100%', maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 8px 40px rgba(0,0,0,0.2)' }}>

        {/* Header */}
        <div style={{ padding:'16px 24px', borderBottom:'1px solid #eef2f7', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, background:'#fff', zIndex:1 }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:'#1a3a6b' }}>Edit RSA Content</div>
            <div style={{ fontSize:11, color:'#888', marginTop:2 }}>{adGroupName} · Ad #{ad.adId} — edits this ad directly, no pause or recreate</div>
          </div>
          <button onClick={onClose} disabled={submitting} style={{ background:'none', border:'none', cursor:'pointer', color:'#888', fontSize:22, lineHeight:1, padding:'0 4px' }}>×</button>
        </div>

        <div style={{ padding:'14px 24px', display:'flex', gap:24, alignItems:'center', borderBottom:'1px solid #eef2f7', flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:16, alignItems:'center' }}>
            <ScoreRing score={adStrength.score} maxScore={100} grade={adStrength.grade} size={56} />
            <div>
              <div style={{ fontSize:10, color:'#888', fontWeight:600, textTransform:'uppercase', letterSpacing:1 }}>Est. Ad Strength (with your edits)</div>
              <div style={{ fontSize:14, fontWeight:700, color: GRADE_COLOR[adStrength.grade] || '#888' }}>{adStrength.grade}</div>
            </div>
          </div>
          <div style={{ display:'flex', gap:16, alignItems:'center' }}>
            <ScoreRing score={conversionReadiness.score} maxScore={100} grade={conversionReadiness.grade} color={CONVERSION_GRADE_COLOR[conversionReadiness.grade]} size={56} />
            <div>
              <div style={{ fontSize:10, color:'#888', fontWeight:600, textTransform:'uppercase', letterSpacing:1 }}>Conversion Readiness</div>
              <div style={{ fontSize:14, fontWeight:700, color: CONVERSION_GRADE_COLOR[conversionReadiness.grade] || '#888' }}>{conversionReadiness.grade}</div>
            </div>
          </div>
        </div>

        {/* Content */}
        {submitDone ? (
          <div style={{ padding:'40px 24px', textAlign:'center' }}>
            <CheckCircle size={48} color="#2e7d32" style={{ marginBottom:12 }} />
            <div style={{ fontSize:18, fontWeight:700, color:'#1a3a6b', marginBottom:8 }}>Ad Updated!</div>
            <div style={{ fontSize:13, color:'#555', marginBottom:20 }}>This RSA's content was updated in place — same ad, same performance history.</div>
            <button onClick={onClose} style={{ padding:'8px 28px', background:'#1a3a6b', color:'#fff', border:'none', borderRadius:6, fontWeight:700, fontSize:13, cursor:'pointer' }}>Done</button>
          </div>
        ) : (
        <div style={{ flex:1, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:18 }}>

          <div style={{ padding:'10px 14px', background:'#fff8e6', border:'1px solid #ffe0b2', borderRadius:7, display:'flex', gap:10, alignItems:'flex-start' }}>
            <AlertCircle size={15} color="#e65100" style={{ flexShrink:0, marginTop:1 }} />
            <div style={{ fontSize:12, color:'#a56700', lineHeight:1.6 }}>
              <strong>Live changes:</strong> This edits the ad's actual content in Google Ads immediately on save — the same ad keeps running with its existing performance history, it isn't paused or replaced.
            </div>
          </div>

          {/* Headlines */}
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8, flexWrap:'wrap', gap:8 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:.5 }}>
                Headlines ({headlines.length}/15)
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={replaceAllHeadlinesWithAi} disabled={!aiHeadlines?.length}
                  title="Replace every existing headline with the AI-recommended set"
                  style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:4, border:'1px solid #2e7d32', background:'#fff', color:'#2e7d32', cursor: aiHeadlines?.length ? 'pointer' : 'not-allowed', opacity: aiHeadlines?.length ? 1 : 0.4 }}>
                  ↺ Replace All with AI
                </button>
                <button onClick={addHeadline} disabled={headlines.length >= 15}
                  style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:4, border:'1px solid #1a3a6b', background:'#fff', color:'#1a3a6b', cursor: headlines.length >= 15 ? 'not-allowed':'pointer', opacity: headlines.length >= 15 ? 0.4 : 1 }}>
                  + Add Headline
                </button>
              </div>
            </div>
            <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
              {/* Existing — editable */}
              <div style={{ flex:'1 1 380px', minWidth:0, display:'flex', flexDirection:'column', gap:6 }}>
                {headlines.map((h, i) => {
                  const hLen = getEffectiveLength(h.text)
                  const ok = h.text.length > 0 && hLen <= 30
                  return (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ fontSize:10, color:'#aaa', minWidth:18, flexShrink:0 }}>{i+1}</span>
                      <div style={{ flex:1, position:'relative' }}>
                        <input value={h.text} onChange={e => updateHeadline(i, e.target.value)}
                          style={{ width:'100%', boxSizing:'border-box', padding:'6px 44px 6px 8px', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', border:`1px solid ${ok ? '#dde9f5' : '#ffd5cc'}`, background: ok ? '#fff' : '#fff5f5' }} />
                        <span style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', fontSize:10, fontWeight:600, color: ok?'#aaa':'#c0392b', pointerEvents:'none' }}>{hLen}/30</span>
                      </div>
                      {aiHeadlines?.length > 0 && (
                        <select value="" onChange={e => { if (e.target.value !== '') replaceHeadlineWithAi(i, Number(e.target.value)) }}
                          title="Replace this headline with an AI-recommended one"
                          style={{ fontSize:10, padding:'4px 2px', borderRadius:4, border:'1px solid #4caf50', background:'#f0fff4', color:'#2e7d32', width:52, flexShrink:0 }}>
                          <option value="">AI ▾</option>
                          {aiHeadlines.map((hl, ai) => <option key={ai} value={ai}>#{ai+1}: {hl.slice(0,30)}</option>)}
                        </select>
                      )}
                      {h.pinned && <span title={`Pinned to ${h.pinned}`} style={{ fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:3, background:'#e3f2fd', color:'#1565c0', flexShrink:0 }}>📌</span>}
                      <button onClick={() => removeHeadline(i)} disabled={headlines.length <= 3} title="Remove headline"
                        style={{ fontSize:13, width:22, height:22, flexShrink:0, borderRadius:4, border:'1px solid #dde9f5', background:'#fff', color: headlines.length <= 3 ? '#ccc' : '#c0392b', cursor: headlines.length <= 3 ? 'not-allowed' : 'pointer' }}>×</button>
                    </div>
                  )
                })}
              </div>

              {/* AI Recommended — reference list */}
              <div style={{ flex:'1 1 300px', minWidth:0, background:'#fafcff', border:'1px solid #eef2f7', borderRadius:6, padding:'8px 10px' }}>
                <div style={{ fontSize:10, fontWeight:700, color:'#2e7d32', textTransform:'uppercase', letterSpacing:.5, marginBottom:6 }}>AI Recommended</div>
                {aiLoading ? (
                  <div style={{ display:'flex', alignItems:'center', gap:6, color:'#888', fontSize:11 }}><Loader2 size={12} className="spin"/> Generating…</div>
                ) : aiError ? (
                  <div style={{ fontSize:11, color:'#c0392b' }}>⚠ {aiError} {onRegenerateAi && <button onClick={onRegenerateAi} style={{ marginLeft:4, fontSize:10, color:'#1a3a6b', background:'none', border:'none', textDecoration:'underline', cursor:'pointer' }}>Retry</button>}</div>
                ) : aiHeadlines?.length > 0 ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {aiHeadlines.map((hl, ai) => (
                      <div key={ai} style={{ fontSize:12, color:'#1a3a6b', display:'flex', alignItems:'center', gap:8, padding:'6px 8px', borderRadius:5, border:'1px solid #dde9f5', background:'#fff' }}>
                        <span style={{ color:'#888', fontSize:11, minWidth:16, flexShrink:0 }}>{ai+1}</span>
                        <span style={{ flex:1, lineHeight:1.4 }}>{hl}</span>
                        {aiRegenLoading[`headline_${ai}`] ? (
                          <Loader2 size={12} className="spin" color="#888" style={{ flexShrink:0 }} />
                        ) : (
                          <button onClick={() => handleRegenAiItem('headline', ai)} title="Regenerate this AI suggestion"
                            style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:20, height:20, flexShrink:0, borderRadius:4, border:'1px solid #dde9f5', background:'#fff', cursor:'pointer', color:'#1a3a6b' }}>
                            <RefreshCw size={10} />
                          </button>
                        )}
                        {aiRegenError[`headline_${ai}`] && (
                          <AlertCircle size={12} color="#c0392b" title={aiRegenError[`headline_${ai}`]} style={{ flexShrink:0 }} />
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize:11, color:'#aaa' }}>No AI recommendations yet. {onRegenerateAi && <button onClick={onRegenerateAi} style={{ fontSize:10, color:'#1a3a6b', background:'none', border:'none', textDecoration:'underline', cursor:'pointer' }}>Generate</button>}</div>
                )}
              </div>
            </div>
          </div>

          {/* Descriptions */}
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8, flexWrap:'wrap', gap:8 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:.5 }}>
                Descriptions ({descriptions.length}/4)
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={replaceAllDescriptionsWithAi} disabled={!aiDescriptions?.length}
                  title="Replace every existing description with the AI-recommended set"
                  style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:4, border:'1px solid #2e7d32', background:'#fff', color:'#2e7d32', cursor: aiDescriptions?.length ? 'pointer' : 'not-allowed', opacity: aiDescriptions?.length ? 1 : 0.4 }}>
                  ↺ Replace All with AI
                </button>
                <button onClick={addDescription} disabled={descriptions.length >= 4}
                  style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:4, border:'1px solid #1a3a6b', background:'#fff', color:'#1a3a6b', cursor: descriptions.length >= 4 ? 'not-allowed':'pointer', opacity: descriptions.length >= 4 ? 0.4 : 1 }}>
                  + Add Description
                </button>
              </div>
            </div>
            <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
              {/* Existing — editable */}
              <div style={{ flex:'1 1 380px', minWidth:0, display:'flex', flexDirection:'column', gap:8 }}>
                {descriptions.map((d, i) => {
                  const dLen = getEffectiveLength(d.text)
                  const ok = d.text.length > 0 && dLen <= 90
                  return (
                    <div key={i}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                        <span style={{ fontSize:10, color:'#aaa' }}>D{i+1} {d.pinned && <span title={`Pinned to ${d.pinned}`} style={{ marginLeft:4 }}>📌</span>}</span>
                        <span style={{ fontSize:10, fontWeight:600, color: ok?'#aaa':'#c0392b' }}>{dLen}/90</span>
                      </div>
                      <div style={{ display:'flex', gap:6, alignItems:'flex-start' }}>
                        <textarea value={d.text} rows={2} onChange={e => updateDescription(i, e.target.value)}
                          style={{ flex:1, boxSizing:'border-box', resize:'vertical', padding:'6px 8px', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', border:`1px solid ${ok ? '#dde9f5' : '#ffd5cc'}`, background: ok ? '#fff' : '#fff5f5' }} />
                        {aiDescriptions?.length > 0 && (
                          <select value="" onChange={e => { if (e.target.value !== '') replaceDescriptionWithAi(i, Number(e.target.value)) }}
                            title="Replace this description with an AI-recommended one"
                            style={{ fontSize:10, padding:'4px 2px', borderRadius:4, border:'1px solid #4caf50', background:'#f0fff4', color:'#2e7d32', width:52, flexShrink:0, alignSelf:'flex-start' }}>
                            <option value="">AI ▾</option>
                            {aiDescriptions.map((ds, ai) => <option key={ai} value={ai}>#{ai+1}: {ds.slice(0,40)}</option>)}
                          </select>
                        )}
                        <button onClick={() => removeDescription(i)} disabled={descriptions.length <= 2} title="Remove description"
                          style={{ fontSize:13, width:22, height:22, flexShrink:0, alignSelf:'flex-start', borderRadius:4, border:'1px solid #dde9f5', background:'#fff', color: descriptions.length <= 2 ? '#ccc' : '#c0392b', cursor: descriptions.length <= 2 ? 'not-allowed' : 'pointer' }}>×</button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* AI Recommended — reference list */}
              <div style={{ flex:'1 1 300px', minWidth:0, background:'#fafcff', border:'1px solid #eef2f7', borderRadius:6, padding:'8px 10px' }}>
                <div style={{ fontSize:10, fontWeight:700, color:'#2e7d32', textTransform:'uppercase', letterSpacing:.5, marginBottom:6 }}>AI Recommended</div>
                {aiLoading ? (
                  <div style={{ display:'flex', alignItems:'center', gap:6, color:'#888', fontSize:11 }}><Loader2 size={12} className="spin"/> Generating…</div>
                ) : aiError ? (
                  <div style={{ fontSize:11, color:'#c0392b' }}>⚠ {aiError} {onRegenerateAi && <button onClick={onRegenerateAi} style={{ marginLeft:4, fontSize:10, color:'#1a3a6b', background:'none', border:'none', textDecoration:'underline', cursor:'pointer' }}>Retry</button>}</div>
                ) : aiDescriptions?.length > 0 ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {aiDescriptions.map((ds, ai) => (
                      <div key={ai} style={{ fontSize:12, color:'#1a3a6b', display:'flex', alignItems:'flex-start', gap:8, padding:'6px 8px', borderRadius:5, border:'1px solid #dde9f5', background:'#fff' }}>
                        <span style={{ color:'#888', fontSize:11, minWidth:16, flexShrink:0, marginTop:1 }}>{ai+1}</span>
                        <span style={{ flex:1, lineHeight:1.4 }}>{ds}</span>
                        {aiRegenLoading[`description_${ai}`] ? (
                          <Loader2 size={12} className="spin" color="#888" style={{ flexShrink:0, marginTop:1 }} />
                        ) : (
                          <button onClick={() => handleRegenAiItem('description', ai)} title="Regenerate this AI suggestion"
                            style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:20, height:20, flexShrink:0, borderRadius:4, border:'1px solid #dde9f5', background:'#fff', cursor:'pointer', color:'#1a3a6b' }}>
                            <RefreshCw size={10} />
                          </button>
                        )}
                        {aiRegenError[`description_${ai}`] && (
                          <AlertCircle size={12} color="#c0392b" title={aiRegenError[`description_${ai}`]} style={{ flexShrink:0, marginTop:1 }} />
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize:11, color:'#aaa' }}>No AI recommendations yet. {onRegenerateAi && <button onClick={onRegenerateAi} style={{ fontSize:10, color:'#1a3a6b', background:'none', border:'none', textDecoration:'underline', cursor:'pointer' }}>Generate</button>}</div>
                )}
              </div>
            </div>
          </div>

          {/* Final URL + Display Path */}
          <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
            <div style={{ flex:'1 1 260px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#555', marginBottom:4 }}>Final URL</div>
              <input value={finalUrl} onChange={e => setFinalUrl(e.target.value)} placeholder="https://…"
                style={{ width:'100%', boxSizing:'border-box', padding:'7px 9px', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', border:'1px solid #dde9f5' }} />
            </div>
            <div style={{ width:120 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#555', marginBottom:4 }}>Path 1</div>
              <input value={path1} onChange={e => setPath1(e.target.value)} maxLength={15}
                style={{ width:'100%', boxSizing:'border-box', padding:'7px 9px', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', border:'1px solid #dde9f5' }} />
            </div>
            <div style={{ width:120 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#555', marginBottom:4 }}>Path 2</div>
              <input value={path2} onChange={e => setPath2(e.target.value)} maxLength={15}
                style={{ width:'100%', boxSizing:'border-box', padding:'7px 9px', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', border:'1px solid #dde9f5' }} />
            </div>
          </div>

          {hasErrors && (
            <div style={{ padding:'10px 14px', background:'#fff5f5', border:'1px solid #ffd5cc', borderRadius:7, fontSize:12, color:'#c0392b' }}>
              {headlines.length < 3 && <div>• At least 3 headlines are required.</div>}
              {descriptions.length < 2 && <div>• At least 2 descriptions are required.</div>}
              {hlErrors.length > 0 && <div>• Every headline must be 1–30 characters.</div>}
              {dsErrors.length > 0 && <div>• Every description must be 1–90 characters.</div>}
            </div>
          )}

          <label style={{ display:'flex', alignItems:'flex-start', gap:10, cursor:'pointer', padding:'10px 14px', background:'#fafcff', border:'1px solid #dde9f5', borderRadius:7 }}>
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ accentColor:'#1a3a6b', width:15, height:15, marginTop:1, flexShrink:0 }} />
            <span style={{ fontSize:12, color:'#333', lineHeight:1.6 }}>
              I understand this will <strong>make live changes</strong> to this ad in my Google Ads account.
            </span>
          </label>

          {submitError && (
            <div style={{ padding:'10px 14px', background:'#fff5f5', border:'1px solid #ffd5cc', borderRadius:7, fontSize:12, color:'#c0392b' }}>
              {submitError}
            </div>
          )}
        </div>
        )}

        {/* Footer */}
        {!submitDone && (
          <div style={{ padding:'14px 24px', borderTop:'1px solid #eef2f7', display:'flex', justifyContent:'flex-end', gap:10, position:'sticky', bottom:0, background:'#fff' }}>
            <button onClick={onClose} disabled={submitting} style={{ padding:'8px 20px', fontWeight:600, fontSize:13, borderRadius:6, border:'1px solid #dde9f5', background:'#fff', color:'#555', cursor: submitting?'not-allowed':'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={!confirmed || submitting || hasErrors || !dirty}
              style={{ padding:'8px 22px', fontWeight:700, fontSize:13, borderRadius:6, border:'none', cursor: (!confirmed||submitting||hasErrors||!dirty)?'not-allowed':'pointer',
                background: (!confirmed||submitting||hasErrors||!dirty) ? '#dde9f5' : '#1a3a6b',
                color: (!confirmed||submitting||hasErrors||!dirty) ? '#aaa' : '#fff',
                display:'inline-flex', alignItems:'center', gap:8,
              }}>
              {submitting ? <><Loader2 size={13} className="spin" /> Saving…</> : '✓ Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Apply Modal ───────────────────────────────────────────────────────────────

function ApplyModal({ onClose, onConfirm, applying, applyResult, applyError, onViewChangelog,
  config, newAssets, existingAds, keywords, landingPage, usps, promotion }) {

  const [confirmed,          setConfirmed]          = useState(false)
  const [editedHeadlines,    setEditedHeadlines]    = useState(() => [...(newAssets?.headlines    || [])])
  const [editedDescriptions, setEditedDescriptions] = useState(() => [...(newAssets?.descriptions || [])])
  // Which existing enabled ad(s) to pause alongside creating this one — an ad
  // group has a hard cap on enabled RSAs, so publishing with no room left
  // fails with RESOURCE_COUNT_LIMIT_EXCEEDED unless something is freed up first.
  const [pauseSelected, setPauseSelected] = useState(new Set())
  function togglePause(i) { setPauseSelected(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n }) }

  const hlErrors   = editedHeadlines.filter(h => getEffectiveLength(h) > 30)
  const descErrors = editedDescriptions.filter(d => getEffectiveLength(d) > 90)
  const hasCharErrors = hlErrors.length > 0 || descErrors.length > 0

  // Client-side Google Ads policy pre-flight (runs on edited values)
  const POLICY_CHECKS = [
    { re: /!/,                                             reason: 'Exclamation mark (!) — prohibited in headlines, restricted in descriptions' },
    { re: /\b(the best|world'?s? best|#1 rated|unbeatable)\b/i, reason: 'Unverifiable superlative claim' },
    { re: /\bguaranteed\b/i,                              reason: '"Guaranteed" — restricted without certified proof' },
    { re: /[A-Z]{4,}/,                                    reason: 'Excessive capitalization (4+ consecutive capitals)' },
    { re: /[!?]{2,}/,                                     reason: 'Repeated punctuation (!!, ??)' },
    { re: /\bclick here\b/i,                              reason: 'Clickbait phrase ("Click Here")' },
    { re: /\b(cure[sd]?|get rich|instant profit)\b/i,     reason: 'Prohibited medical/financial claim' },
  ]
  const policyWarnings = []
  const allAssets = [
    ...editedHeadlines.map((t, i)    => ({ text: t, label: `Headline ${i + 1}` })),
    ...editedDescriptions.map((t, i) => ({ text: t, label: `Description ${i + 1}` })),
  ]
  for (const asset of allAssets) {
    for (const check of POLICY_CHECKS) {
      if (check.re.test(asset.text)) {
        policyWarnings.push({ label: asset.label, text: asset.text, reason: check.reason })
        break
      }
    }
  }


  const newScore = estimateAdStrength({
    headlines:    (newAssets?.headlines    || []).map(t => ({ text: t })),
    descriptions: (newAssets?.descriptions || []).map(t => ({ text: t })),
    keywords,
    hasFinalUrl: !!newAssets?.finalUrl,
  })

  const newConversionReadiness = estimateConversionReadiness({
    headlines:    (newAssets?.headlines    || []).map(t => ({ text: t })),
    descriptions: (newAssets?.descriptions || []).map(t => ({ text: t })),
    keywords, landingPage, usps, promotion,
  })

  const canConfirm = !applying && !hasCharErrors && confirmed && !!newAssets?.finalUrl

  // ── Success screen ─────────────────────────────────────────────────────────
  if (applyResult && !applying) {
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'#fff', borderRadius:12, padding:36, maxWidth:500, width:'90%', boxShadow:'0 8px 40px rgba(0,0,0,0.2)', textAlign:'center' }}>
          <CheckCircle size={52} color="#2e7d32" style={{ marginBottom:12 }} />
          <div style={{ fontSize:20, fontWeight:700, color:'#1a3a6b', marginBottom:8 }}>Changes Applied!</div>
          <div style={{ fontSize:13, color:'#555', marginBottom:6 }}>
            New RSA created in <strong>{config.adGroupName}</strong>
          </div>
          {applyResult.paused?.length > 0 && (
            <div style={{ fontSize:12, color:'#888', marginBottom:4 }}>
              {applyResult.paused.length} existing ad{applyResult.paused.length > 1 ? 's' : ''} paused
            </div>
          )}
          {applyResult.labeled?.length > 0 && (
            <div style={{ fontSize:12, color:'#888', marginBottom:4 }}>Label applied: {applyResult.labeled.join(', ')}</div>
          )}
          {applyResult.errors?.length > 0 && (
            <div style={{ marginTop:10, padding:'8px 12px', background:'#fff8e6', borderRadius:6, fontSize:12, color:'#a56700' }}>
              ⚠ Partial issues: {applyResult.errors.join(' · ')}
            </div>
          )}
          <div style={{ display:'flex', gap:10, justifyContent:'center', marginTop:20 }}>
            <button onClick={onViewChangelog} style={{ padding:'7px 18px', fontSize:12, fontWeight:600, borderRadius:6, border:'1px solid #dde9f5', background:'#fff', color:'#1a3a6b', cursor:'pointer' }}>
              📋 View Change Log
            </button>
            <button onClick={onClose} style={{ padding:'7px 18px', fontSize:12, fontWeight:700, borderRadius:6, border:'none', background:'#1a3a6b', color:'#fff', cursor:'pointer' }}>
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Approval screen ──
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'#fff', borderRadius:12, maxWidth:780, width:'100%', maxHeight:'92vh', overflowY:'auto', boxShadow:'0 8px 40px rgba(0,0,0,0.2)', display:'flex', flexDirection:'column' }}>

        {/* Header */}
        <div style={{ padding:'16px 24px', borderBottom:'1px solid #eef2f7', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, background:'#fff', zIndex:1 }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:'#1a3a6b' }}>Publish RSA to Google Ads</div>
            <div style={{ fontSize:11, color:'#888', marginTop:2 }}>{config.adGroupName} › {config.campaignName}</div>
          </div>
          <button onClick={onClose} disabled={applying} style={{ background:'none', border:'none', cursor:'pointer', color:'#888', fontSize:22, lineHeight:1, padding:'0 4px' }}>×</button>
        </div>

        <div style={{ padding:'20px 24px', display:'flex', flexDirection:'column', gap:18 }}>

          {/* Live-change warning */}
          <div style={{ padding:'10px 14px', background:'#fff8e6', border:'1px solid #ffe0b2', borderRadius:7, display:'flex', gap:10, alignItems:'flex-start' }}>
            <AlertCircle size={15} color="#e65100" style={{ flexShrink:0, marginTop:1 }} />
            <div style={{ fontSize:12, color:'#a56700', lineHeight:1.6 }}>
              <strong>Live changes:</strong> This will make real changes in your Google Ads account. Review carefully before confirming.
            </div>
          </div>

          {/* Action summary */}
          <div style={{ padding:'10px 14px', background:'#e8f5e9', border:'1px solid #4caf5033', borderRadius:7, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <CheckCircle size={15} color="#2e7d32" style={{ flexShrink:0 }} />
            <div style={{ fontSize:13, color:'#1b5e20', lineHeight:1.7 }}>
              <strong>Create New RSA</strong>{' '}
              <span style={{ color:'#388e3c' }}>
                {newAssets?.headlines?.length} headlines · {newAssets?.descriptions?.length} descriptions
                {(newAssets?.displayPath1 || newAssets?.displayPath2) && ` · path: /${newAssets.displayPath1}${newAssets.displayPath2 ? `/${newAssets.displayPath2}` : ''}`}
              </span>
              {newAssets?.finalUrl && <div style={{ fontSize:11, color:'#388e3c', marginTop:2 }}>{newAssets.finalUrl}</div>}
            </div>
          </div>

          {/* Estimated Ad Strength + Conversion Readiness */}
          <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
            <div style={{ flex:'1 1 260px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:.5, marginBottom:10 }}>Estimated Ad Strength</div>
              <div style={{ display:'flex', alignItems:'center', gap:16, padding:'14px 18px', background:'#fafcff', borderRadius:8, border:'1px solid #eef2f7' }}>
                <ScoreRing score={newScore.score} maxScore={100} grade={newScore.grade} size={72} />
                <div>
                  <div style={{ fontSize:16, fontWeight:700, color:GRADE_COLOR[newScore.grade] }}>{newScore.grade}</div>
                  <div style={{ fontSize:12, color:'#888', marginTop:2 }}>{newScore.score} / 100</div>
                </div>
              </div>
            </div>
            <div style={{ flex:'1 1 260px' }}>
              <div title="A separate, heuristic estimate of likelihood to convert — not Ad Strength, and not a Google metric." style={{ fontSize:11, fontWeight:700, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:.5, marginBottom:10 }}>Conversion Readiness (beta)</div>
              <div style={{ display:'flex', alignItems:'center', gap:16, padding:'14px 18px', background:'#fafcff', borderRadius:8, border:'1px solid #eef2f7' }}>
                <ScoreRing score={newConversionReadiness.score} maxScore={100} grade={newConversionReadiness.grade} color={CONVERSION_GRADE_COLOR[newConversionReadiness.grade]} size={72} />
                <div>
                  <div style={{ fontSize:16, fontWeight:700, color:CONVERSION_GRADE_COLOR[newConversionReadiness.grade] }}>{newConversionReadiness.grade}</div>
                  <div style={{ fontSize:12, color:'#888', marginTop:2 }}>{newConversionReadiness.score} / 100</div>
                </div>
              </div>
            </div>
          </div>

          {/* New RSA — Editable before publish */}
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:.5 }}>Headlines &amp; Descriptions</div>
              <span style={{ fontSize:11, color:'#888' }}>Edit directly before publishing</span>
            </div>
            <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>

              {/* Editable Headlines */}
              <div style={{ flex:'1 1 300px' }}>
                <div style={{ fontSize:11, fontWeight:600, color:'#555', marginBottom:6 }}>Headlines ({editedHeadlines.length})</div>
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  {editedHeadlines.map((h, i) => {
                    const hLen = getEffectiveLength(h)
                    const ok = hLen <= 30
                    return (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ fontSize:10, color:'#aaa', minWidth:18, flexShrink:0 }}>{i+1}</span>
                        <div style={{ flex:1, position:'relative' }}>
                          <input
                            value={h}
                            onChange={e => { const v=[...editedHeadlines]; v[i]=e.target.value; setEditedHeadlines(v) }}
                            style={{
                              width:'100%', boxSizing:'border-box',
                              padding:'5px 40px 5px 8px', borderRadius:5, fontSize:12,
                              color:'#1a3a6b', outline:'none',
                              border:`1px solid ${ok ? '#dde9f5' : '#ffd5cc'}`,
                              background: ok ? '#fff' : '#fff5f5',
                            }}
                          />
                          <span style={{ position:'absolute', right:7, top:'50%', transform:'translateY(-50%)', fontSize:10, fontWeight:600, color: ok?'#aaa':'#c0392b', pointerEvents:'none' }}>
                            {hLen}/30
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Editable Descriptions */}
              <div style={{ flex:'1 1 260px' }}>
                <div style={{ fontSize:11, fontWeight:600, color:'#555', marginBottom:6 }}>Descriptions ({editedDescriptions.length})</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {editedDescriptions.map((d, i) => {
                    const dLen = getEffectiveLength(d)
                    const ok = dLen <= 90
                    return (
                      <div key={i}>
                        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                          <span style={{ fontSize:10, color:'#aaa' }}>D{i+1}</span>
                          <span style={{ fontSize:10, fontWeight:600, color: ok?'#aaa':'#c0392b' }}>{dLen}/90</span>
                        </div>
                        <textarea
                          value={d}
                          rows={2}
                          onChange={e => { const v=[...editedDescriptions]; v[i]=e.target.value; setEditedDescriptions(v) }}
                          style={{
                            width:'100%', boxSizing:'border-box', resize:'vertical',
                            padding:'6px 8px', borderRadius:5, fontSize:12,
                            color:'#1a3a6b', outline:'none',
                            border:`1px solid ${ok ? '#dde9f5' : '#ffd5cc'}`,
                            background: ok ? '#fff' : '#fff5f5',
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
                {newAssets?.finalUrl && (
                  <div style={{ marginTop:10, padding:'6px 8px', borderRadius:4, background:'#f4f7fc', fontSize:11, color:'#555', wordBreak:'break-all' }}>
                    <span style={{ fontWeight:600, color:'#888' }}>Final URL: </span>{newAssets.finalUrl}
                  </div>
                )}
              </div>
            </div>

            {/* Display Path */}
            {(newAssets?.displayPath1 || newAssets?.displayPath2) && (
              <div style={{ marginTop:14, padding:'10px 12px', borderRadius:6, background:'#f4f7fc', border:'1px solid #eef2f7' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:.5, marginBottom:6 }}>Display Path</div>
                <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                  <span style={{ fontSize:12, color:'#888' }}>yourdomain.com</span>
                  {newAssets.displayPath1 && (<>
                    <span style={{ fontSize:12, color:'#888' }}>/</span>
                    <span style={{ padding:'2px 10px', background:'#e3f2fd', color:'#1565c0', borderRadius:4, fontSize:12, fontWeight:600 }}>{newAssets.displayPath1}</span>
                    <span style={{ fontSize:10, color: newAssets.displayPath1.length > 15 ? '#c0392b' : '#aaa' }}>{newAssets.displayPath1.length}/15</span>
                  </>)}
                  {newAssets.displayPath2 && (<>
                    <span style={{ fontSize:12, color:'#888' }}>/</span>
                    <span style={{ padding:'2px 10px', background:'#e3f2fd', color:'#1565c0', borderRadius:4, fontSize:12, fontWeight:600 }}>{newAssets.displayPath2}</span>
                    <span style={{ fontSize:10, color: newAssets.displayPath2.length > 15 ? '#c0392b' : '#aaa' }}>{newAssets.displayPath2.length}/15</span>
                  </>)}
                </div>
              </div>
            )}

          </div>

          {/* Character errors */}
          {hasCharErrors && (
            <div style={{ padding:'10px 14px', background:'#fff5f5', border:'1px solid #ffd5cc', borderRadius:7 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#c0392b', marginBottom:6 }}>Character Limit Violations — Fix Before Applying</div>
              {hlErrors.map((h, i)   => <div key={i} style={{ fontSize:11, color:'#c0392b' }}>• Headline "{h.slice(0,28)}…" is {getEffectiveLength(h)} chars (max 30)</div>)}
              {descErrors.map((d, i) => <div key={i} style={{ fontSize:11, color:'#c0392b' }}>• Description "{d.slice(0,40)}…" is {getEffectiveLength(d)} chars (max 90)</div>)}
            </div>
          )}

          {/* Policy pre-flight warnings */}
          {policyWarnings.length > 0 && (
            <div style={{ padding:'10px 14px', background:'#fff8e6', border:'1px solid #ffe0b2', borderRadius:7 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#a56700', marginBottom:6 }}>
                ⚠ Potential Policy Issues Detected — Google Ads may disapprove this ad
              </div>
              {policyWarnings.map((w, i) => (
                <div key={i} style={{ fontSize:11, color:'#a56700', marginBottom:3 }}>
                  • <strong>{w.label}:</strong> {w.reason}
                </div>
              ))}
              <div style={{ fontSize:11, color:'#888', marginTop:6 }}>
                Regenerate the assets to fix these issues, or proceed at your own risk.
              </div>
            </div>
          )}

          {/* Missing final URL */}
          {!newAssets?.finalUrl && (
            <div style={{ padding:'10px 14px', background:'#fff8e6', border:'1px solid #ffe0b2', borderRadius:7, fontSize:12, color:'#a56700' }}>
              ⚠ Final URL is required. Enter a Landing Page URL above and click "Analyze Page" first.
            </div>
          )}

          {/* Replace an existing ad — optional, needed once the ad group is at Google Ads' enabled-ad limit */}
          {existingAds?.length > 0 && (
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:.5, marginBottom:6 }}>
                Replace an Existing Ad <span style={{ fontWeight:400, color:'#aaa', textTransform:'none' }}>(optional)</span>
              </div>
              <div style={{ fontSize:11, color:'#888', marginBottom:8 }}>
                Selected ads are paused right before the new one is created. If this ad group is already at Google Ads' limit on enabled ads, publishing will fail unless you pause one here first.
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {existingAds.map((ad, i) => (
                  <label key={ad.adId} style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'8px 10px', borderRadius:6, border:'1px solid #eef2f7', background: pauseSelected.has(i) ? '#fff8e6' : '#fafcff', cursor:'pointer' }}>
                    <input type="checkbox" checked={pauseSelected.has(i)} onChange={() => togglePause(i)} style={{ marginTop:2, flexShrink:0 }} />
                    <span style={{ fontSize:12, color:'#1a3a6b', lineHeight:1.5 }}>
                      {(ad.headlines || []).slice(0, 3).map(h => h.text).join(' | ') || '(no headlines)'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Confirm checkbox */}
          <label style={{ display:'flex', alignItems:'flex-start', gap:10, cursor:'pointer', padding:'10px 14px', background:'#fafcff', border:'1px solid #dde9f5', borderRadius:7 }}>
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ accentColor:'#1a3a6b', width:15, height:15, marginTop:1, flexShrink:0 }} />
            <span style={{ fontSize:12, color:'#333', lineHeight:1.6 }}>
              I understand this will <strong>make live changes</strong> to my Google Ads account and I have reviewed the new RSA above.
            </span>
          </label>

          {applyError && (
            <div style={{ padding:'10px 14px', background:'#fff5f5', border:'1px solid #ffd5cc', borderRadius:7, fontSize:12, color:'#c0392b' }}>
              {applyError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'14px 24px', borderTop:'1px solid #eef2f7', display:'flex', justifyContent:'flex-end', gap:10, position:'sticky', bottom:0, background:'#fff' }}>
          <button onClick={onClose} disabled={applying} style={{ padding:'8px 20px', fontWeight:600, fontSize:13, borderRadius:6, border:'1px solid #dde9f5', background:'#fff', color:'#555', cursor: applying ? 'not-allowed' : 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ editedHeadlines, editedDescriptions, pauseAdIds: [...pauseSelected].map(i => existingAds[i].adId) })}
            disabled={!canConfirm}
            style={{
              padding:'8px 22px', fontWeight:700, fontSize:13, borderRadius:6, border:'none',
              background: canConfirm ? '#1a3a6b' : '#dde9f5',
              color:      canConfirm ? '#fff'    : '#aaa',
              cursor:     canConfirm ? 'pointer' : 'not-allowed',
              display:'inline-flex', alignItems:'center', gap:8,
            }}
          >
            {applying ? <><Loader2 size={13} className="spin" /> Applying…</> : '✓ Confirm & Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Change Log Panel ──────────────────────────────────────────────────────────

function ChangeLogPanel({ onClose }) {
  const [log,     setLog]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [rolling, setRolling] = useState({})

  useEffect(() => {
    window.electronAPI.rsaGetChangelog()
      .then(setLog).catch(() => setLog([]))
      .finally(() => setLoading(false))
  }, [])

  async function handleRollback(entry) {
    const isEdit = entry.type === 'rsaEdit'
    const confirmMsg = isEdit
      ? `Revert this content edit on "${entry.adGroupName}"?\n\nThe ad will be reverted to its previous headlines/descriptions in place — same ad, no pause or recreate.`
      : `Roll back changes to "${entry.adGroupName}"?\n\nThe newly created RSA will be paused and previously paused ads will be re-enabled.`
    if (!window.confirm(confirmMsg)) return
    setRolling(r => ({ ...r, [entry.id]: true }))
    try {
      if (isEdit) {
        await window.electronAPI.rsaRollbackEditAd({ entryId: entry.id, customerId: entry.customerId })
      } else {
        await window.electronAPI.rsaRollback({ entryId: entry.id, customerId: entry.customerId, adGroupId: entry.adGroupId })
      }
      const updated = await window.electronAPI.rsaGetChangelog()
      setLog(updated)
    } catch (e) {
      window.alert('Rollback failed: ' + e.message)
    } finally {
      setRolling(r => ({ ...r, [entry.id]: false }))
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'#fff', borderRadius:12, maxWidth:680, width:'100%', maxHeight:'84vh', overflowY:'auto', boxShadow:'0 8px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ padding:'16px 24px', borderBottom:'1px solid #eef2f7', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, background:'#fff', zIndex:1 }}>
          <div style={{ fontSize:15, fontWeight:700, color:'#1a3a6b' }}>RSA Change Log</div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#888', fontSize:22, lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:'16px 24px' }}>
          {loading && <Spinner label="Loading change log…" />}
          {!loading && (!log || log.length === 0) && (
            <div style={{ textAlign:'center', color:'#aaa', padding:40, fontSize:13 }}>No changes applied yet.</div>
          )}
          {!loading && log?.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {log.map(entry => (
                <div key={entry.id} style={{ padding:'12px 16px', borderRadius:8, border:'1px solid #eef2f7', background: entry.rolledBack ? '#f9f9f9' : '#fafcff' }}>
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:8, gap:10 }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color: entry.rolledBack ? '#888' : '#1a3a6b', display:'flex', alignItems:'center', gap:8 }}>
                        {entry.adGroupName || entry.adGroupId}
                        {entry.rolledBack && <span style={{ fontSize:10, fontWeight:700, padding:'1px 7px', borderRadius:3, background:'#f0f0f0', color:'#888' }}>ROLLED BACK</span>}
                      </div>
                      <div style={{ fontSize:11, color:'#888', marginTop:2 }}>
                        {new Date(entry.timestamp).toLocaleString()} · {entry.campaignName || entry.campaignId}
                      </div>
                    </div>
                    {!entry.rolledBack && (
                      <button
                        onClick={() => handleRollback(entry)}
                        disabled={!!rolling[entry.id]}
                        style={{ padding:'4px 12px', fontSize:11, fontWeight:600, borderRadius:4, border:'1px solid #c0392b', background:'#fff', color:'#c0392b', cursor: rolling[entry.id] ? 'not-allowed' : 'pointer', display:'inline-flex', alignItems:'center', gap:5, flexShrink:0 }}
                      >
                        {rolling[entry.id] ? <><Loader2 size={11} className="spin" /> Rolling back…</> : '↩ Rollback'}
                      </button>
                    )}
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                    {entry.type === 'rsaEdit' && <span style={{ fontSize:11, padding:'2px 8px', background:'#e3f2fd', color:'#1565c0', borderRadius:4 }}>✎ Content Edited{entry.adId ? ` (Ad #${entry.adId})` : ''}</span>}
                    {entry.after?.resourceName && <span style={{ fontSize:11, padding:'2px 8px', background:'#e8f5e9', color:'#2e7d32', borderRadius:4 }}>✓ Created RSA</span>}
                    {entry.paused?.length > 0  && <span style={{ fontSize:11, padding:'2px 8px', background:'#fff8e6', color:'#e65100', borderRadius:4 }}>⏸ Paused {entry.paused.length} ad{entry.paused.length > 1 ? 's' : ''}</span>}
                    {entry.labeled?.length > 0 && <span style={{ fontSize:11, padding:'2px 8px', background:'#e3f2fd', color:'#1565c0', borderRadius:4 }}>🏷 {entry.labeled.join(', ')}</span>}
                    {entry.errors?.length > 0  && <span style={{ fontSize:11, padding:'2px 8px', background:'#fff5f5', color:'#c0392b', borderRadius:4 }}>⚠ {entry.errors.length} issue{entry.errors.length > 1 ? 's' : ''}</span>}
                  </div>
                  {entry.type !== 'rsaEdit' && entry.after?.headlines?.length > 0 && (
                    <div style={{ marginTop:8, fontSize:11, color:'#888' }}>
                      <strong>New headlines: </strong>
                      {entry.after.headlines.slice(0, 3).join(' · ')}
                      {entry.after.headlines.length > 3 ? ` +${entry.after.headlines.length - 3} more` : ''}
                    </div>
                  )}
                  {entry.type === 'rsaEdit' && entry.after?.headlines?.length > 0 && (
                    <div style={{ marginTop:8, fontSize:11, color:'#888' }}>
                      <strong>Updated headlines: </strong>
                      {entry.after.headlines.slice(0, 3).map(h => h.text || h).join(' · ')}
                      {entry.after.headlines.length > 3 ? ` +${entry.after.headlines.length - 3} more` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyBtn({ text }) {
  const [done, setDone] = useState(false)
  function handle() {
    navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000) })
  }
  return (
    <button onClick={handle} title="Copy" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', fontSize: 11, fontWeight: 600,
      border: `1px solid ${done ? '#4caf50' : '#dde9f5'}`,
      borderRadius: 4, background: 'transparent',
      color: done ? '#2e7d32' : '#1a3a6b', cursor: 'pointer',
    }}>
      {done ? <Check size={11} /> : <Copy size={11} />}
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

// ── Lightweight pagination for custom (non-ReportTable) tables ───────────────
const PG_SIZES = [10, 25, 50, 100]

function usePg(defaultSize = 10) {
  const [page,     setPage]     = useState(0)
  const [pageSize, setPageSize] = useState(defaultSize)
  return { page, pageSize, setPage, setPageSize: s => { setPageSize(s); setPage(0) } }
}

function pgBtnStyle(disabled) {
  return { padding: '4px 10px', fontSize: 11, fontWeight: 600, border: '1px solid #dde9f5', borderRadius: 5,
    background: disabled ? '#f5f7fa' : '#fff', color: disabled ? '#aaa' : '#1a3a6b', cursor: disabled ? 'not-allowed' : 'pointer' }
}

function PgFooter({ page, pageSize, total, onPageChange, onPageSizeChange }) {
  if (!total) return null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = page * pageSize
  const end   = Math.min(start + pageSize, total)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderTop: '1px solid #f0f4f8', flexWrap: 'wrap', gap: 8, background: '#fafcff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#888' }}>Rows per page:</span>
        <select value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))}
          style={{ padding: '3px 7px', border: '1px solid #dde9f5', borderRadius: 5, fontSize: 11, color: '#1a3a6b', outline: 'none', cursor: 'pointer' }}>
          {PG_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#888' }}>{start + 1}–{end} of {total}</span>
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => onPageChange(0)} disabled={page===0} style={pgBtnStyle(page===0)}>«</button>
            <button onClick={() => onPageChange(Math.max(0, page-1))} disabled={page===0} style={pgBtnStyle(page===0)}>‹ Prev</button>
            <span style={{ padding:'3px 9px', fontSize:11, color:'#555', border:'1px solid #dde9f5', borderRadius:5, background:'#f5f7fa' }}>{page+1} / {totalPages}</span>
            <button onClick={() => onPageChange(Math.min(totalPages-1, page+1))} disabled={page>=totalPages-1} style={pgBtnStyle(page>=totalPages-1)}>Next ›</button>
            <button onClick={() => onPageChange(totalPages-1)} disabled={page>=totalPages-1} style={pgBtnStyle(page>=totalPages-1)}>»</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Card({ title, extra, children }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="card-title">{title}</span>
        {extra}
      </div>
      {children}
    </div>
  )
}

// ── Score improvement actions ─────────────────────────────────────────────────

function generateScoreActions(scoreResult, keywords = [], headlines = []) {
  const { breakdown } = scoreResult
  const actions = []
  const hlTexts = (headlines || []).map(h => h.text || h)

  if (breakdown.assetQuantity.score < breakdown.assetQuantity.max) {
    actions.push({
      dim: 'Asset Quantity',
      gap: breakdown.assetQuantity.max - breakdown.assetQuantity.score,
      action: `Add more headlines and descriptions — Google rewards up to 15 headlines and 4 descriptions (have ${hlTexts.length} headlines).`,
    })
  }

  if (breakdown.headlineUniqueness.score < breakdown.headlineUniqueness.max) {
    actions.push({
      dim: 'Headline Uniqueness',
      gap: breakdown.headlineUniqueness.max - breakdown.headlineUniqueness.score,
      action: 'Remove duplicate or near-duplicate headlines. Each headline must use a different angle and different main words.',
    })
  }

  if (breakdown.descriptionUniqueness.score < breakdown.descriptionUniqueness.max) {
    actions.push({
      dim: 'Description Uniqueness',
      gap: breakdown.descriptionUniqueness.max - breakdown.descriptionUniqueness.score,
      action: 'Give each description a different job — service coverage, customer benefit, trust/differentiator, and CTA/offer.',
    })
  }

  if (breakdown.keywordRelevance.score < breakdown.keywordRelevance.max) {
    const kwTexts = (keywords || []).map(k => (k.text || k).toLowerCase())
    const uncovered = kwTexts
      .filter(kw => !hlTexts.some(h => h.toLowerCase().includes(kw)))
      .slice(0, 5)
    actions.push({
      dim: 'Keyword Relevance',
      gap: breakdown.keywordRelevance.max - breakdown.keywordRelevance.score,
      action: uncovered.length
        ? `Add headlines containing: ${uncovered.join(', ')}`
        : 'Increase keyword coverage — include your top keyword theme in at least 2 headlines and 1 description.',
    })
  }

  if (breakdown.messageVariety.score < breakdown.messageVariety.max) {
    actions.push({
      dim: 'Message Variety',
      gap: breakdown.messageVariety.max - breakdown.messageVariety.score,
      action: 'Cover more distinct message angles: keyword/service, benefit, trust, offer, CTA, and location — not just variations on one idea.',
    })
  }

  if (breakdown.combinationFlexibility.score < breakdown.combinationFlexibility.max) {
    actions.push({
      dim: 'Combination Flexibility',
      gap: breakdown.combinationFlexibility.max - breakdown.combinationFlexibility.score,
      action: 'Unpin assets where possible — pinning (especially similar assets pinned together) restricts how many combinations Google can test.',
    })
  }

  return actions.sort((a, b) => b.gap - a.gap)
}

// ── Type badge ────────────────────────────────────────────────────────────────

const TYPE_COLORS = {
  Keyword:            '#1565c0',
  Secondary:          '#0277bd',
  CTA:                '#2e7d32',
  Trust:              '#6a1b9a',
  Urgency:            '#c0392b',
  Benefit:            '#00695c',
  Location:           '#e65100',
  'Problem-Solution': '#4527a0',
  Problem:            '#4527a0',
  Differentiator:     '#8d6e63',
}

function TypeBadge({ type }) {
  const color = TYPE_COLORS[type] || '#888'
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
      background: `${color}15`, color, border: `1px solid ${color}33`,
      whiteSpace: 'nowrap',
    }}>{type}</span>
  )
}

// ── Keyword Suggestions Section ──────────────────────────────────────────────

const KW_INTENT_COLORS   = { Transactional:'#2e7d32', Commercial:'#1565c0', Navigational:'#6a1b9a', Informational:'#888', Emergency:'#c0392b', 'Local Service':'#e65100' }
const KW_STAGE_COLORS    = { 'Ready To Buy':'#2e7d32', 'Comparing Options':'#e65100', 'Urgent Need':'#c0392b' }
const KW_TRAFFIC_COLORS  = { 'High Conversion':'#2e7d32', Balanced:'#1565c0', 'High Volume':'#e65100', Niche:'#888' }
const KW_COMP_COLORS     = { Low:'#2e7d32', Medium:'#e65100', High:'#c0392b' }

function KwBadge({ value, colorMap }) {
  const color = colorMap[value] || '#888'
  return value ? (
    <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:4, whiteSpace:'nowrap',
      background:`${color}18`, color, border:`1px solid ${color}33` }}>{value}</span>
  ) : <span style={{ color:'#aaa' }}>—</span>
}

function KeywordSuggestionsSection({ keywords, adGroupName, campaignName, selectedAccount, landingPage }) {
  const pg = usePg(25)
  const [loaded,        setLoaded]        = useState(false)
  const [results,       setResults]       = useState(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [publishRow,    setPublishRow]    = useState(null)
  const [publishedKeys, setPublishedKeys] = useState(new Set())
  const [sortCol,       setSortCol]       = useState(null)
  const [sortDir,       setSortDir]       = useState('asc')

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function sortedResults(rows) {
    if (!sortCol || !rows) return rows
    const COMP  = { Low:1, Medium:2, High:3 }
    const STAGE = { 'Ready To Buy':1, 'Comparing Options':2, 'Urgent Need':3 }
    const parseNum = s => { const m = String(s||'').replace(/,/g,'').match(/[\d.]+/); return m ? Number(m[0]) : 0 }
    const getVal = r => {
      switch (sortCol) {
        case 'Keyword Idea':     return (r.keyword           || '').toLowerCase()
        case 'Match Type':       return (r.matchType         || '').toLowerCase()
        case 'Intent':           return (r.searchIntent      || '').toLowerCase()
        case 'Buyer Stage':      return STAGE[r.buyerStage]  ?? 99
        case 'Searches/mo':      return parseNum(r.monthlySearches)
        case 'Competition':      return COMP[r.competition]  ?? 99
        case 'Est. CPC':         return parseNum(r.estimatedCpc)
        case 'CPC Savings':      return parseNum(r.estimatedSavings)
        case 'Conv.Score':       return Number(r.conversionScore) || 0
        case 'Traffic':          return (r.trafficPotential  || '').toLowerCase()
        case 'Rec. Campaign':    return (r.recommendedCampaign || '').toLowerCase()
        case 'Rec. Ad Group':    return (r.adGroup            || '').toLowerCase()
        default: return 0
      }
    }
    return [...rows].sort((a, b) => {
      const av = getVal(a), bv = getVal(b)
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sortDir === 'asc' ? cmp : -cmp
    })
  }

  async function fetchIdeas() {
    setLoading(true); setError(null); setResults(null); setLoaded(true); pg.setPage(0)
    try {
      const data = await window.electronAPI.rsaSuggestKeywords({
        adGroupName:  adGroupName  || '',
        campaignName: campaignName || '',
        keywords:     keywords     || [],
        landingPage:  landingPage  || null,
      })
      setResults(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function markPublished(row) {
    setPublishedKeys(prev => new Set([...prev, `${row.keyword}|${row.matchType}`]))
  }

  const tdBase = { padding:'7px 8px', borderBottom:'1px solid #f0f4f8', fontSize:12 }

  if (!loaded) {
    return (
      <div style={{ borderTop:'2px solid #eef2f7', padding:'12px 16px', display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:12, fontWeight:600, color:'#1a3a6b' }}>🔍 AI Keyword Suggestions</span>
        <button
          onClick={fetchIdeas}
          style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 14px', fontSize:11, fontWeight:600,
            borderRadius:5, background:'#e8a020', color:'#1a3a6b', border:'none', cursor:'pointer' }}>
          <Search size={11}/> Generate Keyword Suggestions
        </button>
      </div>
    )
  }

  return (
    <div style={{ borderTop:'2px solid #eef2f7' }}>
      {publishRow && selectedAccount && (
        <PublishKeywordModal
          row={publishRow}
          selectedAccount={selectedAccount}
          onClose={() => setPublishRow(null)}
          onSuccess={() => { markPublished(publishRow); setPublishRow(null) }}
        />
      )}

      {/* Section header */}
      <div style={{ padding:'10px 16px', background:'#f0f4fb', borderBottom:'1px solid #eef2f7', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <span style={{ fontSize:12, fontWeight:700, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:.5 }}>
          🔍 AI Keyword Suggestions
        </span>
        {results && <span style={{ fontSize:11, color:'#888' }}>{results.length} idea{results.length !== 1 ? 's' : ''}</span>}
        <button onClick={fetchIdeas} disabled={loading}
          style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 12px', fontSize:11, fontWeight:600,
            borderRadius:5, border:'1px solid #1a3a6b', background:'#fff', color:'#1a3a6b',
            cursor: loading ? 'not-allowed' : 'pointer', marginLeft:'auto' }}>
          {loading ? <><Loader2 size={11} className="spin"/> Generating…</> : <><RefreshCw size={11}/> Refresh</>}
        </button>
      </div>

      {loading && <div style={{ display:'flex', alignItems:'center', gap:8, padding:'20px 16px', color:'#888', fontSize:12 }}><Loader2 size={14} className="spin"/> Generating AI keyword suggestions…</div>}
      {error  && <div style={{ padding:'12px 16px', color:'#c0392b', fontSize:12 }}>⚠ {error}</div>}

      {results && results.length === 0 && (
        <div style={{ padding:'24px 16px', textAlign:'center', color:'#aaa', fontSize:12 }}>No keyword ideas returned. Click Refresh to try again.</div>
      )}

      {results && results.length > 0 && (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                {[['Keyword Idea','left',160],['Match Type','center',80],['Intent','center',100],['Buyer Stage','center',110],
                  ['Searches/mo','center',80],['Competition','center',80],['Est. CPC','center',72],['CPC Savings','center',80],['Conv.Score','center',72],
                  ['Traffic','center',90],['Rec. Campaign','left',140],['Rec. Ad Group','left',130],['','center',80]
                ].map(([h,a,w]) => {
                  const active = sortCol === h
                  const sortable = h !== ''
                  return (
                    <th key={h}
                      onClick={sortable ? () => toggleSort(h) : undefined}
                      style={{ padding:'7px 8px', background: active ? '#0f2850' : '#1a3a6b', color:'#fff', fontSize:10, fontWeight:600,
                        whiteSpace:'nowrap', textAlign:a, minWidth:w, position:'sticky', top:0, zIndex:2,
                        cursor: sortable ? 'pointer' : 'default', userSelect:'none' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:3, justifyContent: a==='center' ? 'center' : 'flex-start' }}>
                        {h}
                        {sortable && <span style={{ fontSize:9, opacity: active ? 1 : 0.35 }}>{active ? (sortDir==='asc' ? '▲' : '▼') : '⬍'}</span>}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sortedResults(results).slice(pg.page * pg.pageSize, pg.page * pg.pageSize + pg.pageSize).map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f5f7fa' }}>
                  <td style={{ ...tdBase, fontWeight:600, color:'#2563b0' }}>{r.keyword}</td>
                  <td style={{ ...tdBase, textAlign:'center' }}><StatusBadge value={r.matchType} type="match"/></td>
                  <td style={{ ...tdBase, textAlign:'center' }}><KwBadge value={r.searchIntent} colorMap={KW_INTENT_COLORS}/></td>
                  <td style={{ ...tdBase, textAlign:'center' }}><KwBadge value={r.buyerStage}    colorMap={KW_STAGE_COLORS}/></td>
                  <td style={{ ...tdBase, textAlign:'center', color:'#555' }}>{r.monthlySearches || '—'}</td>
                  <td style={{ ...tdBase, textAlign:'center' }}><KwBadge value={r.competition}  colorMap={KW_COMP_COLORS}/></td>
                  <td style={{ ...tdBase, textAlign:'center', fontWeight:600, color:'#1a3a6b' }}>{r.estimatedCpc || '—'}</td>
                  <td style={{ ...tdBase, textAlign:'center', fontWeight:700, color:'#2e7d32' }}>{r.estimatedSavings || '—'}</td>
                  <td style={{ ...tdBase, textAlign:'center', fontWeight:700, color: r.conversionScore >= 80 ? '#2e7d32' : r.conversionScore >= 60 ? '#e65100' : '#888' }}>
                    {r.conversionScore ?? '—'}
                  </td>
                  <td style={{ ...tdBase, textAlign:'center' }}><KwBadge value={r.trafficPotential} colorMap={KW_TRAFFIC_COLORS}/></td>
                  <td style={{ ...tdBase, fontSize:11, color:'#1a3a6b', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.recommendedCampaign || '—'}</td>
                  <td style={{ ...tdBase, fontSize:11, color:'#2563b0', maxWidth:130, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.adGroup || '—'}</td>
                  <td style={{ ...tdBase, textAlign:'center' }}>
                    {publishedKeys.has(`${r.keyword}|${r.matchType}`) ? (
                      <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:600, color:'#2e7d32' }}>
                        <CheckCircle size={11}/> Published
                      </span>
                    ) : (
                      <button onClick={() => setPublishRow(r)}
                        style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 9px',
                          fontSize:11, fontWeight:600, borderRadius:4, cursor:'pointer', whiteSpace:'nowrap',
                          border:'1px solid #1a3a6b', background:'#1a3a6b', color:'#fff' }}>
                        🚀 Publish
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PgFooter page={pg.page} pageSize={pg.pageSize} total={results.length}
            onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
        </div>
      )}
    </div>
  )
}

// ── RSA Asset Audit ───────────────────────────────────────────────────────────

function AssetAuditSection({ rsaAds, keywords, searchTerms, landingPages, lpLoading, lpErrors, agName, aiRecs, aiRecsLoading, onGenerateRecs, customerId, adGroupId, selectedAccount, campaignName, businessName, preventCrossover, siblingAdGroupNames, onRefreshLandingPage, refreshingLpUrls, lpUnchangedUrls, onAdContentUpdated, autoOpenAdId, onAutoOpenConsumed }) {
  const [openCards,    setOpenCards]    = useState(() => new Set(rsaAds?.map((_, i) => i) || []))
  const [adAction,     setAdAction]     = useState(null)
  const [editingAdIdx, setEditingAdIdx] = useState(null)

  // Arriving via deep link from Reports → Ads Performance ("Edit with AI
  // Recommendations") — once this specific ad shows up in the loaded list,
  // expand its card and open the Edit modal for it automatically, so the
  // user lands directly on the fix instead of having to find the ad by hand.
  useEffect(() => {
    if (!autoOpenAdId || !rsaAds?.length) return
    const idx = rsaAds.findIndex(a => a.adId === autoOpenAdId)
    if (idx === -1) return
    setOpenCards(prev => new Set([...prev, idx]))
    setEditingAdIdx(idx)
    onAutoOpenConsumed?.()
  }, [autoOpenAdId, rsaAds])
  const [adGenResults,     setAdGenResults]     = useState({})
  const [adGenLoading,     setAdGenLoading]     = useState({})
  const [adUrlRecs,        setAdUrlRecs]        = useState({})
  const [adUrlRecsLoading, setAdUrlRecsLoading] = useState({})
  const [applyState,       setApplyState]       = useState(null)

  async function generateForAd(adId, landingPage, finalUrl, existingSets = []) {
    setAdGenLoading(prev => ({ ...prev, [adId]: true }))
    setAdGenResults(prev => { const p = { ...prev }; delete p[adId]; return p })
    setAdUrlRecs(prev => { const p = { ...prev }; delete p[adId]; return p })
    try {
      const response = await window.electronAPI.rsaGenerateAssets({
        customerId, businessName: businessName || '', adGroupName: agName || '',
        campaignName: campaignName || '', keywords: keywords || [],
        searchTerms: searchTerms || [],
        landingPage: landingPage || null,
        usps: [], serviceArea: '', yearsInBusiness: '', promotion: '', tone: 'Professional',
        preventCrossover, siblingAdGroupNames, count: 1,
        existingSets, // headlines/descriptions already used by sibling ads in this ad group — keeps Keyword-type headlines from converging on the same picks
        realActionItems: rsaAds.find(a => a.adId === adId)?.actionItems || [], // Google's own real reasons this specific live ad isn't rated higher
      })
      const result = response?.sets?.[0]
      if (!result?.headlines?.length) throw new Error('No headlines returned. Try again.')
      setAdGenResults(prev => ({ ...prev, [adId]: result }))

      // Auto-fetch display path if we have a final URL
      if (finalUrl) {
        setAdUrlRecsLoading(prev => ({ ...prev, [adId]: true }))
        window.electronAPI.rsaRecommendUrlAssets({
          url: finalUrl,
          landingPage: landingPage || null,
          keywords: keywords || [],
          adGroupName: agName || '',
        }).then(recs => {
          if (recs) setAdUrlRecs(prev => ({ ...prev, [adId]: recs }))
        }).catch(() => {}).finally(() => {
          setAdUrlRecsLoading(prev => ({ ...prev, [adId]: false }))
        })
      }
      return result
    } catch (e) {
      setAdGenResults(prev => ({ ...prev, [adId]: { error: e.message } }))
      return null
    } finally {
      setAdGenLoading(prev => ({ ...prev, [adId]: false }))
    }
  }

  function updateAdGenItem(adId, assetType, index, newText) {
    setAdGenResults(prev => {
      const res = prev[adId]; if (!res) return prev
      if (assetType === 'headline') {
        const headlines = [...(res.headlines || [])]; headlines[index] = newText
        return { ...prev, [adId]: { ...res, headlines } }
      }
      const descriptions = [...(res.descriptions || [])]; descriptions[index] = newText
      return { ...prev, [adId]: { ...res, descriptions } }
    })
  }

  // Per-row "Regenerate" on the AI Generated headline/description tables
  // (normal accordion view, right side) — on-demand single-item AI call, same
  // as the new RSA builder's Generate tab uses. Keyed by adId since this
  // section renders one card per ad, not by a single item index alone.
  const [regenGenLoading, setRegenGenLoading] = useState({})
  const [regenGenError,   setRegenGenError]   = useState({})

  async function handleRegenGenItem(adId, assetType, index) {
    const key = `${adId}_${assetType}_${index}`
    setRegenGenLoading(prev => ({ ...prev, [key]: true }))
    setRegenGenError(prev => ({ ...prev, [key]: null }))
    try {
      const res0 = adGenResults[adId]
      const isHl = assetType === 'headline'
      const currentText = isHl ? res0?.headlines?.[index] : res0?.descriptions?.[index]
      const res = await window.electronAPI.rsaRegenerateSingleAsset({
        customerId, assetType, currentText, index,
        adGroupName: agName || '', businessName: businessName || '', tone: 'Professional',
        keywords: keywords || [],
        allHeadlines:    res0?.headlines    || [],
        allDescriptions: res0?.descriptions || [],
        crossSetTexts: [],
        preventCrossover, siblingAdGroupNames,
        landingPageUrl: rsaAds.find(a => a.adId === adId)?.finalUrls?.[0] || '',
      })
      if (res?.text) updateAdGenItem(adId, assetType, index, res.text)
    } catch (e) {
      setRegenGenError(prev => ({ ...prev, [key]: e.message || 'Regeneration failed. Please try again.' }))
    } finally {
      setRegenGenLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  async function handlePublishConfirm({ editedHeadlines, editedDescriptions, pauseAdIds }) {
    if (!applyState) return
    const { adId } = applyState
    const urlRecs  = adUrlRecs[adId]
    const ad       = rsaAds.find(a => a.adId === adId)
    setApplyState(prev => ({ ...prev, applying: true, applyError: null }))
    try {
      const res = await window.electronAPI.rsaApply({
        customerId, adGroupId, campaignId: null, adGroupName: agName, campaignName,
        newHeadlines:    editedHeadlines,
        newDescriptions: editedDescriptions,
        finalUrl:        ad?.finalUrls?.[0] || '',
        displayPath1:    urlRecs?.displayPath1 || '',
        displayPath2:    urlRecs?.displayPath2 || '',
        beforeAds:       rsaAds || [],
        pauseAdIds:      pauseAdIds || [],
      })
      setApplyState(prev => ({ ...prev, applying: false, applyResult: res }))
    } catch (e) {
      setApplyState(prev => ({ ...prev, applying: false, applyError: e.message }))
    }
  }

  // Auto-generate for all ads when rsaAds loads — run SEQUENTIALLY (not
  // Promise.all/forEach) so each ad's generation can be told what the
  // earlier ads in this batch already used, keeping Keyword-type headlines
  // (and everything else) unique across sibling RSAs in the same ad group.
  useEffect(() => {
    if (!rsaAds?.length) return
    let cancelled = false
    ;(async () => {
      const generatedSoFar = []
      for (const ad of rsaAds) {
        if (cancelled) return
        const adUrl = ad.finalUrls?.[0] || ''
        const adLp  = adUrl ? (landingPages?.[adUrl] ?? null) : null
        const result = await generateForAd(ad.adId, adLp, adUrl, generatedSoFar)
        if (result) generatedSoFar.push(result)
      }
    })()
    return () => { cancelled = true }
  }, [rsaAds])

  // AI-classified headline types: { [adId]: string[] }
  const [aiTypes,    setAiTypes]    = useState({})

  // Auto-classify headline types for all ads when ads first load
  useEffect(() => {
    if (!rsaAds?.length) return
    rsaAds.forEach(ad => {
      if (!ad.adId || !ad.headlines?.length) return
      const hlTexts = ad.headlines.map(h => h.text || '')
      window.electronAPI.rsaClassifyHeadlineTypes({
        headlines:   hlTexts,
        keywords:    keywords || [],
        adGroupName: agName   || '',
      }).then(res => {
        if (res?.types?.length) {
          setAiTypes(prev => ({ ...prev, [ad.adId]: res.types }))
        }
      }).catch(() => {})
    })
  }, [rsaAds])

  function toggleCard(idx) {
    setOpenCards(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  if (!rsaAds || rsaAds.length === 0) {
    return (
      <Card title="Current RSA Audit">
        <div style={{ padding: '24px 16px', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
          No Responsive Search Ads found in this ad group.
        </div>
      </Card>
    )
  }


  return (
    <>
      {/* Ad Action Modal */}
      {adAction !== null && (
        <AdActionModal
          ad={rsaAds[adAction.idx]}
          customerId={customerId}
          adGroupId={adGroupId}
          adGroupName={agName}
          initialMode={adAction.mode}
          onClose={() => setAdAction(null)}
          onSuccess={() => setAdAction(null)}
        />
      )}

      {/* Edit Existing RSA Content Modal */}
      {editingAdIdx !== null && (
        (() => {
          const editingAd = rsaAds[editingAdIdx]
          const editUrl   = editingAd.finalUrls?.[0] || ''
          const editLp    = editUrl ? (landingPages?.[editUrl] ?? null) : null
          const genResult = adGenResults[editingAd.adId]
          return (
            <EditAdContentModal
              ad={editingAd}
              customerId={customerId}
              adGroupId={adGroupId}
              adGroupName={agName}
              campaignName={campaignName}
              keywords={keywords}
              landingPage={editLp}
              businessName={businessName}
              preventCrossover={preventCrossover}
              siblingAdGroupNames={siblingAdGroupNames}
              aiHeadlines={genResult && !genResult.error ? genResult.headlines : null}
              aiHeadlineTypes={genResult?.headlineTypes}
              aiDescriptions={genResult && !genResult.error ? genResult.descriptions : null}
              aiLoading={!!adGenLoading[editingAd.adId]}
              aiError={genResult?.error || null}
              onRegenerateAi={() => generateForAd(editingAd.adId, editLp, editUrl, rsaAds
                .filter(a => a.adId !== editingAd.adId)
                .map(a => adGenResults[a.adId])
                .filter(r => r && !r.error && r.headlines?.length)
              )}
              onUpdateAiItem={(assetType, index, text) => updateAdGenItem(editingAd.adId, assetType, index, text)}
              onClose={() => setEditingAdIdx(null)}
              onSuccess={(adId, updated) => {
                onAdContentUpdated?.(adId, updated)
                setEditingAdIdx(null)
              }}
            />
          )
        })()
      )}

      {/* Apply Modal for audit-generated RSA publish */}
      {applyState && (() => {
        const applyAd      = rsaAds.find(a => a.adId === applyState.adId)
        const applyGenRes  = adGenResults[applyState.adId]
        const applyUrlRecs = adUrlRecs[applyState.adId]
        if (!applyGenRes || applyGenRes.error) return null
        return (
          <ApplyModal
            onClose={() => { if (!applyState.applying) setApplyState(null) }}
            onConfirm={handlePublishConfirm}
            onViewChangelog={() => setApplyState(null)}
            applying={applyState.applying}
            applyResult={applyState.applyResult}
            applyError={applyState.applyError}
            config={{ customerId, adGroupId, campaignId: null, adGroupName: agName, campaignName }}
            newAssets={{
              headlines:    applyGenRes.headlines    || [],
              descriptions: applyGenRes.descriptions || [],
              finalUrl:     applyAd?.finalUrls?.[0]  || '',
              displayPath1: applyUrlRecs?.displayPath1 || '',
              displayPath2: applyUrlRecs?.displayPath2 || '',
            }}
            existingAds={rsaAds.filter(a => a.status === 'ENABLED')}
            keywords={keywords}
            landingPage={null}
          />
        )
      })()}

      {rsaAds.map((ad, adIdx) => {
        const audit   = analyzeCurrentRSAAssets(ad, keywords)
        const recs    = aiRecs[adIdx] || {}
        const loading = aiRecsLoading[adIdx] || false
        const nonKeep = audit.headlines.filter(h => h.label !== 'Keep')

        const adUrl       = ad.finalUrls?.[0] || ''
        const adLp        = adUrl ? (landingPages?.[adUrl] ?? null) : null
        const adLpLoading = lpLoading && !!adUrl && !landingPages?.[adUrl] && !lpErrors?.[adUrl]
        const adLpError   = adUrl ? (lpErrors?.[adUrl] ?? null) : null
        const adLpMatch   = adLp ? detectLandingPageMismatch(agName || '', keywords, adLp) : null

        // Same estimateAdStrength() heuristic used at publish time (Generate
        // tab / ApplyModal), run on this ad's actual current content — NOT
        // Google's own ad_strength rating. Those are two different scoring
        // systems on different rubrics; showing Google's real (typically
        // stricter) rating here while the Generate tab only ever shows our
        // heuristic made a freshly-published "97" look like it "dropped to
        // 70" once audited, when nothing about the ad had actually changed.
        // Using the same function both places keeps the number the user saw
        // at publish time stable when they come back to audit that same ad.
        const before = estimateAdStrength({ headlines: ad.headlines, descriptions: ad.descriptions, keywords, landingPage: adLp, hasFinalUrl: !!adUrl })
        const beforeConversion = estimateConversionReadiness({ headlines: ad.headlines, descriptions: ad.descriptions, keywords, landingPage: adLp })

        const genResult  = adGenResults[ad.adId]
        const genLoading = adGenLoading[ad.adId]
        // With AI Recs: estimated score since the new RSA hasn't been published yet
        const after = (genResult && !genResult.error)
          ? estimateAdStrength({ headlines: genResult.headlines.map(t => ({ text: t })), descriptions: genResult.descriptions.map(t => ({ text: t })), keywords, landingPage: adLp, hasFinalUrl: !!adUrl })
          : null
        const afterConversion = (genResult && !genResult.error)
          ? estimateConversionReadiness({ headlines: genResult.headlines.map(t => ({ text: t })), descriptions: genResult.descriptions.map(t => ({ text: t })), keywords, landingPage: adLp })
          : null

        const isOpen = openCards.has(adIdx)
        return (
          <div key={ad.adId || adIdx} className="card" style={{ marginBottom: 20 }}>
            {/* Accordion header */}
            <div
              className="card-header"
              onClick={() => toggleCard(adIdx)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isOpen ? <ChevronDown size={15} color="#1a3a6b" /> : <ChevronRight size={15} color="#1a3a6b" />}
                <span className="card-title">
                  RSA Audit {rsaAds.length > 1 ? `#${adIdx + 1}` : ''}
                </span>
                {ad.finalUrls?.[0] && (
                  <span style={{ fontSize: 11, color: '#888', fontWeight: 400, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    — {ad.finalUrls[0]}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} onClick={e => e.stopPropagation()}>
                <span title="Google's own Ad Strength rating for this ad — a separate, typically stricter rubric than this app's estimate below" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 10, color: '#aaa', fontWeight: 600 }}>Google:</span>
                  <AdStrengthBadge value={ad.adStrength} />
                </span>
                {ad.impressions > 0 && (
                  <span style={{ fontSize: 11, color: '#888' }}>
                    {ad.impressions.toLocaleString()} impr · {ad.clicks.toLocaleString()} clicks · {fmtUsd(ad.cost)}
                  </span>
                )}
                <button
                  disabled={ad.status === 'REMOVED'}
                  onClick={() => setEditingAdIdx(adIdx)}
                  title="Edit this ad's actual content in Google Ads — no pause or recreate"
                  style={{
                    padding:'3px 10px', fontSize:11, fontWeight:600, borderRadius:4, whiteSpace:'nowrap',
                    cursor: ad.status === 'REMOVED' ? 'not-allowed' : 'pointer',
                    opacity: ad.status === 'REMOVED' ? 0.35 : 1,
                    border: '1px solid #1a3a6b', background:'#fff', color:'#1a3a6b',
                  }}
                >Edit</button>
                {[
                  { mode:'eligible', label:'Eligible', color:'#2e7d32', disabled: ad.status === 'ENABLED'  },
                  { mode:'pause',    label:'Pause',    color:'#e65100', disabled: ad.status === 'PAUSED'   },
                  { mode:'remove',   label:'Remove',   color:'#c0392b', disabled: ad.status === 'REMOVED'  },
                ].map(btn => (
                  <button key={btn.mode}
                    disabled={btn.disabled}
                    onClick={() => setAdAction({ idx: adIdx, mode: btn.mode })}
                    style={{
                      padding:'3px 10px', fontSize:11, fontWeight:600, borderRadius:4, whiteSpace:'nowrap',
                      cursor: btn.disabled ? 'not-allowed' : 'pointer',
                      opacity: btn.disabled ? 0.35 : 1,
                      border: `1px solid ${btn.color}`,
                      background: btn.disabled ? '#fff' : btn.color,
                      color: btn.disabled ? btn.color : '#fff',
                    }}
                  >{btn.label}</button>
                ))}
              </div>
            </div>

            {/* Accordion body */}
            {isOpen && <div style={{ padding: '0 0 4px' }}>
              {/* Copy action bar — uses AI generated content when available */}
              {(() => {
                const aiHls  = genResult && !genResult.error ? genResult.headlines    : null
                const aiDss  = genResult && !genResult.error ? genResult.descriptions : null
                function copyHeadlines()    { navigator.clipboard.writeText((aiHls || ad.headlines.map(h => h.text)).join('\n')) }
                function copyDescriptions() { navigator.clipboard.writeText((aiDss || ad.descriptions.map(d => d.text)).join('\n')) }
                return (
                  <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f4f8', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#888' }}>AI Generated:</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button onClick={copyHeadlines}    style={btnStyle('#1565c0')}>Copy All Headlines</button>
                      <button onClick={copyDescriptions} style={btnStyle('#6a1b9a')}>Copy All Descriptions</button>
                      <button onClick={() => generateForAd(ad.adId, adLp, adUrl, rsaAds
                        .filter(a => a.adId !== ad.adId)
                        .map(a => adGenResults[a.adId])
                        .filter(r => r && !r.error && r.headlines?.length)
                      )} disabled={genLoading}
                        style={btnStyle('#555', true)}>
                        {genLoading ? <><Loader2 size={11} className="spin"/> Generating…</> : '🔄 Re-Generate'}
                      </button>
                    </div>
                  </div>
                )
              })()}

              {/* ── Side-by-side: Current | AI Generated ── */}
              <div style={{ display: 'flex', borderBottom: '1px solid #f0f4f8' }}>

                {/* LEFT: Current Headlines */}
                <div style={{ flex: 1, borderRight: '2px solid #eef2f7', overflow: 'auto' }}>
                  <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1, background: '#fafcff' }}>
                    Current Headlines ({audit.headlines.length})
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {[['#','center',24],['Headline','left','auto'],['Type','center',72],['Chars','center',48]].map(([h,a,w]) => (
                          <th key={h} style={{ padding: '5px 8px', textAlign: a, fontSize: 10, fontWeight: 600, color: '#fff', background: '#1a3a6b', whiteSpace: 'nowrap', width: w !== 'auto' ? w : undefined }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {audit.headlines.map((h, i) => {
                        const hLen = getEffectiveLength(h.text)
                        const charOk = hLen <= 30
                        const hlType = aiTypes[ad.adId]?.[i] || h.type
                        return (
                          <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f5f7fa' }}>
                            <td style={{ padding: '5px 8px', textAlign: 'center', color: '#aaa', fontSize: 11, borderBottom: '1px solid #f0f4f8' }}>{i + 1}</td>
                            <td style={{ padding: '5px 8px', color: '#555', borderBottom: '1px solid #f0f4f8' }}>{h.text}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'center', borderBottom: '1px solid #f0f4f8' }}><TypeBadge type={hlType} /></td>
                            <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 600, borderBottom: '1px solid #f0f4f8', color: charOk ? '#2e7d32' : '#c0392b', fontSize: 11 }}>{hLen}/30</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* RIGHT: AI Generated Headlines */}
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, background: '#f0f4fb' }}>
                    AI Generated Headlines
                  </div>
                  {genLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '20px 12px', color: '#888', fontSize: 12 }}>
                      <Loader2 size={13} className="spin"/> Generating…
                    </div>
                  ) : genResult?.error ? (
                    <div style={{ padding: '12px', color: '#c0392b', fontSize: 12 }}>⚠ {genResult.error}</div>
                  ) : genResult ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>
                          {[['#','center',24],['AI Headline','left','auto'],['Type','center',72],['Chars','center',48],['','center',60]].map(([h,a,w]) => (
                            <th key={h} style={{ padding: '5px 8px', textAlign: a, fontSize: 10, fontWeight: 600, color: '#fff', background: '#2e7d32', whiteSpace: 'nowrap', width: w !== 'auto' ? w : undefined }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {genResult.headlines.map((hl, i) => {
                          const type   = genResult.headlineTypes?.[i] || classifyHeadlineType(hl, keywords, '')
                          const hlLen  = getEffectiveLength(hl)
                          const charOk = hlLen <= 30
                          const regenKey = `${ad.adId}_headline_${i}`
                          return (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f5f7fa' }}>
                              <td style={{ padding: '5px 8px', textAlign: 'center', color: '#aaa', fontSize: 11, borderBottom: '1px solid #f0f4f8' }}>{i + 1}</td>
                              <td style={{ padding: '5px 8px', color: '#1a3a6b', fontWeight: 500, borderBottom: '1px solid #f0f4f8' }}>{hl}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'center', borderBottom: '1px solid #f0f4f8' }}><TypeBadge type={type} /></td>
                              <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 600, borderBottom: '1px solid #f0f4f8', color: charOk ? '#2e7d32' : '#c0392b', fontSize: 11 }}>{hlLen}/30</td>
                              <td style={{ padding: '4px 6px', textAlign: 'center', borderBottom: '1px solid #f0f4f8' }}>
                                <div style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                                  <CopyBtn text={hl} />
                                  {regenGenLoading[regenKey] ? (
                                    <Loader2 size={12} className="spin" color="#888" />
                                  ) : (
                                    <button onClick={() => handleRegenGenItem(ad.adId, 'headline', i)} title="Regenerate this headline"
                                      style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:20, height:20, borderRadius:4, border:'1px solid #dde9f5', background:'#fff', cursor:'pointer', color:'#1a3a6b' }}>
                                      <RefreshCw size={10} />
                                    </button>
                                  )}
                                  {regenGenError[regenKey] && (
                                    <AlertCircle size={12} color="#c0392b" title={regenGenError[regenKey]} />
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              </div>

              {/* ── Side-by-side: Current | AI Descriptions ── */}
              <div style={{ display: 'flex', borderBottom: '1px solid #f0f4f8' }}>

                {/* LEFT: Current Descriptions */}
                <div style={{ flex: 1, borderRight: '2px solid #eef2f7', padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                    Current Descriptions ({audit.descriptions.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {audit.descriptions.map((d, i) => {
                      const dLen = getEffectiveLength(d.text)
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 8px', borderRadius: 4, background: '#fafcff', border: '1px solid #eef2f7' }}>
                          <span style={{ fontSize: 10, color: '#aaa', minWidth: 14, marginTop: 2 }}>{i + 1}</span>
                          <span style={{ flex: 1, fontSize: 12, color: '#555', lineHeight: 1.4 }}>{d.text}</span>
                          <span style={{ fontSize: 10, color: dLen <= 90 ? '#aaa' : '#c0392b', flexShrink: 0 }}>{dLen}/90</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* RIGHT: AI Generated Descriptions */}
                <div style={{ flex: 1, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                    AI Generated Descriptions
                  </div>
                  {genLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#888', fontSize: 12 }}>
                      <Loader2 size={13} className="spin"/> Generating…
                    </div>
                  ) : genResult && !genResult.error ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {(genResult.descriptions || []).map((d, i) => {
                        const dLen = getEffectiveLength(d)
                        const charOk = dLen >= 70 && dLen <= 90
                        const regenKey = `${ad.adId}_description_${i}`
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 8px', borderRadius: 4, background: '#f0fff4', border: '1px solid #4caf5033' }}>
                            <span style={{ fontSize: 10, color: '#888', minWidth: 14, marginTop: 2 }}>{i + 1}</span>
                            <span style={{ flex: 1, fontSize: 12, color: '#1a3a6b', fontWeight: 500, lineHeight: 1.4 }}>{d}</span>
                            <span style={{ fontSize: 10, fontWeight: 600, color: charOk ? '#2e7d32' : '#c0392b', flexShrink: 0 }}>{dLen}/90</span>
                            <CopyBtn text={d} />
                            {regenGenLoading[regenKey] ? (
                              <Loader2 size={12} className="spin" color="#888" style={{ flexShrink:0, marginTop:2 }} />
                            ) : (
                              <button onClick={() => handleRegenGenItem(ad.adId, 'description', i)} title="Regenerate this description"
                                style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:20, height:20, flexShrink:0, borderRadius:4, border:'1px solid #dde9f5', background:'#fff', cursor:'pointer', color:'#1a3a6b' }}>
                                <RefreshCw size={10} />
                              </button>
                            )}
                            {regenGenError[regenKey] && (
                              <AlertCircle size={12} color="#c0392b" title={regenGenError[regenKey]} style={{ flexShrink:0, marginTop:2 }} />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* ── Display Path (AI suggested) ── */}
              {(() => {
                const urlRecs    = adUrlRecs[ad.adId]
                const urlLoading = adUrlRecsLoading[ad.adId]
                if (!genResult || genResult.error) return null
                return (
                  <div style={{ borderTop: '1px solid #f0f4f8', padding: '12px 16px', background: '#fafcff' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                      Display Path
                      {urlLoading && <Loader2 size={11} className="spin" style={{ marginLeft: 8, verticalAlign: 'middle' }} />}
                    </div>

                    {/* Display Path */}
                    {urlRecs && (urlRecs.displayPath1 || urlRecs.displayPath2) && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: '#888' }}>yourdomain.com</span>
                          {urlRecs.displayPath1 && (<>
                            <span style={{ fontSize: 12, color: '#888' }}>/</span>
                            <span style={{ padding: '2px 10px', background: '#e3f2fd', color: '#1565c0', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                              {urlRecs.displayPath1}
                            </span>
                            <span style={{ fontSize: 10, color: urlRecs.displayPath1.length > 15 ? '#c0392b' : '#aaa' }}>
                              {urlRecs.displayPath1.length}/15
                            </span>
                          </>)}
                          {urlRecs.displayPath2 && (<>
                            <span style={{ fontSize: 12, color: '#888' }}>/</span>
                            <span style={{ padding: '2px 10px', background: '#e3f2fd', color: '#1565c0', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                              {urlRecs.displayPath2}
                            </span>
                            <span style={{ fontSize: 10, color: urlRecs.displayPath2.length > 15 ? '#c0392b' : '#aaa' }}>
                              {urlRecs.displayPath2.length}/15
                            </span>
                          </>)}
                        </div>
                      </div>
                    )}

                    {!urlRecs && !urlLoading && adUrl && (
                      <div style={{ fontSize: 11, color: '#aaa' }}>Display path will load after generation completes.</div>
                    )}
                    {!adUrl && (
                      <div style={{ fontSize: 11, color: '#aaa' }}>No final URL on this ad — display path requires a landing page URL.</div>
                    )}
                  </div>
                )
              })()}

              {/* ── Estimated Ad Strength ── */}
              <div style={{ borderTop: '2px solid #eef2f7', padding: '16px' }}>
                <div title="This app's own content-completeness estimate (headline/description count, keyword coverage, message diversity) — NOT Google's real Ad Strength rating shown above, which also weighs relevance and performance signals this app can't see." style={{ fontSize: 10, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>
                  Estimated Ad Strength (this app's content score, not Google's rating)
                </div>
                <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>

                  {/* Rings */}
                  <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Current</span>
                      <ScoreRing score={before.score} maxScore={100} grade={before.grade} size={82} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: GRADE_COLOR[before.grade] || '#888' }}>{before.grade}</span>
                    </div>
                    {after ? (
                      <>
                        <div style={{ fontSize: 20, color: '#dde9f5', alignSelf: 'center', marginBottom: 22 }}>→</div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1 }}>With AI Recs</span>
                          <ScoreRing score={after.score} maxScore={100} grade={after.grade} size={82} />
                          <span style={{ fontSize: 12, fontWeight: 700, color: GRADE_COLOR[after.grade] || '#888' }}>{after.grade}</span>
                          {after.score > before.score && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#2e7d32' }}>+{(after.score - before.score).toFixed(1)} pts</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div style={{ alignSelf: 'center', fontSize: 11, color: '#aaa', maxWidth: 150, marginBottom: 22 }}>
                        {genLoading ? 'Generating AI content…' : 'AI score shown after generation.'}
                      </div>
                    )}
                  </div>

                  {/* Breakdown bars */}
                  <BreakdownCompareRows current={before.breakdown} after={after?.breakdown} currentLabel="Current" afterLabel="With AI Recs" labelWidth={155} />

                </div>

                {/* Ad Strength target */}
                {before.score < 85 && (
                  <div style={{ marginTop: 14, padding: '10px 14px', background: '#fff8e6', border: '1px solid #ffe0b2', borderRadius: 7, fontSize: 12, color: '#a56700' }}>
                    ⚡ Click <strong>Re-Generate AI Suggestions</strong> above — the AI will target 85+ Ad Strength by improving keyword coverage, message diversity, and headline length.
                  </div>
                )}

                {/* What Google says — its own real diagnostic reasons for this
                    ad's actual ad_strength rating above, straight from Google's
                    classifier. This is the one explanation of "why doesn't the
                    score above match Google" that isn't this app's own guess. */}
                {ad.actionItems?.length > 0 && (
                  <div style={{ marginTop: 14, padding: '10px 14px', background: '#eef6ff', border: '1px solid #9fc4ec', borderRadius: 7 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#1a3a6b', marginBottom: 6 }}>
                      What Google says is holding this ad's real rating back:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#1a3a6b', lineHeight: 1.7 }}>
                      {ad.actionItems.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              <ConversionReadinessBlock result={beforeConversion} after={afterConversion} afterLoading={genLoading} showIssues={false} />

              <LandingPageSection
                landingPage={adLp}
                lpMatch={adLpMatch}
                lpLoading={adLpLoading}
                lpError={adLpError}
                embedded
                onRefresh={adUrl && onRefreshLandingPage ? () => onRefreshLandingPage(adUrl) : undefined}
                refreshing={!!refreshingLpUrls?.has(adUrl)}
                unchanged={!!lpUnchangedUrls?.has(adUrl)}
                businessName={businessName}
                campaignName={campaignName}
                adGroupName={agName}
              />
              <KeywordSuggestionsSection
                keywords={keywords}
                adGroupName={agName}
                campaignName={campaignName}
                selectedAccount={selectedAccount}
                landingPage={adLp}
              />
            </div>}
          </div>
        )
      })}
    </>
  )
}

// ── RSA Score ─────────────────────────────────────────────────────────────────

function ScoreSection({ rsaAds, keywords, landingPage, aiRecs }) {
  if (!rsaAds || rsaAds.length === 0) return null
  const ad     = rsaAds[0]
  const before = estimateAdStrength({ headlines: ad.headlines, descriptions: ad.descriptions, keywords, landingPage, hasFinalUrl: !!ad.finalUrls?.[0] })
  const beforeConversion = estimateConversionReadiness({ headlines: ad.headlines, descriptions: ad.descriptions, keywords, landingPage })

  const recs0   = (aiRecs || {})[0] || {}
  const hasRecs = Object.keys(recs0).length > 0

  let after = null
  let afterConversion = null
  if (hasRecs) {
    const afterHeadlines = (ad.headlines || []).map((h, i) => ({
      ...h, text: recs0[i] !== undefined ? recs0[i] : h.text,
    }))
    after = estimateAdStrength({ headlines: afterHeadlines, descriptions: ad.descriptions, keywords, landingPage, hasFinalUrl: !!ad.finalUrls?.[0] })
    afterConversion = estimateConversionReadiness({ headlines: afterHeadlines, descriptions: ad.descriptions, keywords, landingPage })
  }


  return (
    <>
    <Card title="Estimated Ad Strength">
      <div style={{ padding: '16px', display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>

        {/* Before / After rings */}
        <div style={{ display: 'flex', gap: 28, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Before</span>
            <ScoreRing score={before.score} maxScore={100} grade={before.grade} size={90} />
            <span style={{ fontSize: 12, fontWeight: 700, color: GRADE_COLOR[before.grade] || '#888' }}>{before.grade}</span>
          </div>

          {after && (
            <>
              <div style={{ fontSize: 22, color: '#dde9f5', alignSelf: 'center', marginBottom: 24 }}>→</div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1 }}>After (AI Recs)</span>
                <ScoreRing score={after.score} maxScore={100} grade={after.grade} size={90} />
                <span style={{ fontSize: 12, fontWeight: 700, color: GRADE_COLOR[after.grade] || '#888' }}>{after.grade}</span>
                {after.score > before.score && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#2e7d32' }}>+{(after.score - before.score).toFixed(1)} pts</span>
                )}
              </div>
            </>
          )}

          {!after && (
            <div style={{ alignSelf: 'center', fontSize: 11, color: '#aaa', maxWidth: 160, marginBottom: 24 }}>
              Generate AI suggestions to see the projected score.
            </div>
          )}
        </div>

        {/* Breakdown bars */}
        <BreakdownCompareRows current={before.breakdown} after={after?.breakdown} currentLabel="Before" afterLabel="After (AI Recs)" labelWidth={160} />

        {/* Issues — split current vs. after so a resolved issue doesn't read
            as if it still applies to the "After (AI Recs)" score beside it. */}
        <IssuesPanel title={after ? 'Issues in Before' : 'Issues to Fix'} issues={before.issues} color="#c0392b" />
        {after && <IssuesPanel title="Still Remaining After (AI Recs)" issues={after.issues} color="#c0392b" />}
      </div>

      {/* What's blocking Excellent — excellentReady is a stricter gate than
          the numeric score alone, so a high score can still fail it (e.g.
          on pinning or sitelinks) and this is the only place that explains why. */}
      {!before.excellentReady && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f4f8' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            What's Blocking "Excellent"
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {before.excellentChecks.filter(c => !c.pass).map(c => (
              <div key={c.key} style={{ fontSize: 12, color: '#a56700', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0 }}>✗</span>
                <span>{c.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Actions to reach 95+ */}
      {before.score < 95 && (() => {
        const actions = generateScoreActions(before, keywords, ad.headlines)
        if (actions.length === 0) return null
        return (
          <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f4f8' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              AI Recommended Actions — Reach 95+ Score (gap: {(95 - before.score).toFixed(1)} pts)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {actions.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 12px', borderRadius: 6, background: '#f8faff', border: '1px solid #dde9f5', alignItems: 'flex-start' }}>
                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                      background: a.gap >= 10 ? '#fff0f0' : a.gap >= 5 ? '#fff8e6' : '#f0fff4',
                      color:      a.gap >= 10 ? '#c0392b'  : a.gap >= 5 ? '#a56700'  : '#2e7d32',
                      border:     `1px solid ${a.gap >= 10 ? '#ffd5cc' : a.gap >= 5 ? '#ffe0b2' : '#c8e6c9'}`,
                      whiteSpace: 'nowrap',
                    }}>+{a.gap.toFixed(1)} pts</span>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#1a3a6b', marginBottom: 2 }}>{a.dim}</div>
                    <div style={{ fontSize: 12, color: '#444', lineHeight: 1.5 }}>{highlightRecommendation(a.action)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}
    </Card>
    <Card title="Conversion Readiness Score (beta estimate — not Google's rating)">
      <ConversionReadinessBlock result={beforeConversion} after={afterConversion} ringSize={90} showHeader={false} beforeLabel="Before" afterLabel="After (AI Recs)" />
    </Card>
    </>
  )
}

// ── Intent Warnings ───────────────────────────────────────────────────────────

const CAT_COLORS = {
  [INTENT_CATEGORIES.HIGH_INTENT]:   '#2e7d32',
  [INTENT_CATEGORIES.LOW_INTENT]:    '#888',
  [INTENT_CATEGORIES.FREE]:          '#c0392b',
  [INTENT_CATEGORIES.CHEAP]:         '#a56700',
  [INTENT_CATEGORIES.PRICING]:       '#1565c0',
  [INTENT_CATEGORIES.DIY]:           '#880e4f',
  [INTENT_CATEGORIES.DUMP_NEAR_ME]:  '#e65100',
  [INTENT_CATEGORIES.CITY_PICKUP]:   '#e65100',
  [INTENT_CATEGORIES.JOBS]:          '#c0392b',
  [INTENT_CATEGORIES.COMPETITOR]:    '#555',
  [INTENT_CATEGORIES.WRONG_SERVICE]: '#6a1b9a',
}

function IntentSection({
  classified, groups, warnings,
  selectedAccount, campaignId, campaignName, adGroupId, adGroupName,
  kwMap, negMaps, onPublished, onKeywordChanged, onSwitchRemoved,
}) {
  const [expanded,    setExpanded]    = useState(null)
  const [signalModal, setSignalModal] = useState(null)
  const [publishRows, setPublishRows] = useState(null)

  // Switch K <-> NK — same pattern as the Keywords page's Search Terms tabs.
  // Keyed by an absolute index within the expanded category's own term list
  // (not the page-local slice index), so it stays correct across pagination;
  // cleared whenever the expanded category changes so a stale selection from
  // one category's list can never apply to a different one.
  const [switchSelected, setSwitchSelected] = useState(new Set())
  const [switchRows,     setSwitchRows]     = useState(null)
  const pg = usePg(25)

  function getSignal(t) { return resolveKwSignal(t.term, campaignName, adGroupName, kwMap, negMaps) }

  const categoryOrder = [
    INTENT_CATEGORIES.HIGH_INTENT, INTENT_CATEGORIES.PRICING,
    INTENT_CATEGORIES.LOW_INTENT, INTENT_CATEGORIES.CHEAP,
    INTENT_CATEGORIES.FREE, INTENT_CATEGORIES.DIY,
    INTENT_CATEGORIES.DUMP_NEAR_ME, INTENT_CATEGORIES.CITY_PICKUP,
    INTENT_CATEGORIES.JOBS, INTENT_CATEGORIES.COMPETITOR, INTENT_CATEGORIES.WRONG_SERVICE,
  ]

  const sortedCats = categoryOrder.filter(c => groups[c])

  const intentCsvRows = classified.map(t => ({
    'Search Term':   t.term,
    'Category':      t.category,
    'Warning':       t.isWarning ? 'Yes' : '',
    'Clicks':        t.clicks,
    'Impressions':   t.impressions,
    'Cost':          t.cost?.toFixed(2),
    'Conversions':   t.conversions,
    'CTR':           t.ctr?.toFixed(2) + '%',
  }))

  const expandedTerms = (expanded && groups[expanded]) ? groups[expanded].terms : []

  const switchLockedStatus = switchSelected.size > 0 ? getSignal(expandedTerms[[...switchSelected][0]])?.status : null
  function toggleSwitchRow(idx) {
    setSwitchSelected(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n })
  }
  function startSwitch() {
    const rowsToSwitch = [...switchSelected].map(i => expandedTerms[i]).filter(Boolean)
    if (rowsToSwitch.length) setSwitchRows(rowsToSwitch)
  }
  const switchRemovalByRow = switchRows ? switchRows.map(r => {
    const sig = getSignal(r)
    return { matches: (sig?.matches || []).map(m => ({ resourceName: m.resourceName, level: sig.status === 'keyword' ? 'keyword' : m.level })) }
  }) : null
  const switchFromStatus = switchRows?.length ? getSignal(switchRows[0])?.status : null
  const switchToKwType   = switchFromStatus === 'keyword' ? 'Negative Keyword' : 'Keyword'

  function handleSwitchRemoved() {
    const removedKeywordRNs = new Set()
    const removedNegRNs     = new Set()
    for (const removal of (switchRemovalByRow || [])) {
      for (const m of removal.matches) {
        if (!m.resourceName) continue
        if (m.level === 'keyword') removedKeywordRNs.add(m.resourceName)
        else removedNegRNs.add(m.resourceName)
      }
    }
    onSwitchRemoved?.(removedKeywordRNs, removedNegRNs)
  }

  return (
    <Card title="Intent Analysis" extra={
      <ExportButton data={intentCsvRows} filename="search_term_intent.csv" label="Export CSV" />
    }>
      {/* Warning banners */}
      {warnings.length > 0 && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f4f8', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 12px', borderRadius: 6, background: '#fff5f5', border: '1px solid #ffd5cc', alignItems: 'flex-start' }}>
              <AlertCircle size={14} color="#c0392b" style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#c0392b' }}>{w.type}</div>
                <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{w.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Category summary chips */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f4f8', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {sortedCats.map(cat => {
          const g = groups[cat]
          const color = CAT_COLORS[cat] || '#888'
          const active = expanded === cat
          return (
            <button key={cat} onClick={() => { setExpanded(active ? null : cat); pg.setPage(0); setSwitchSelected(new Set()) }} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px',
              borderRadius: 20, border: `1px solid ${color}44`,
              background: active ? `${color}18` : '#fff',
              color, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.12s',
            }}>
              {cat}
              <span style={{ fontSize: 11, fontWeight: 700, background: `${color}22`, borderRadius: 10, padding: '0 6px' }}>
                {g.terms.length}
              </span>
              {g.totalCost > 0 && (
                <span style={{ fontSize: 10, color: '#888' }}>{fmtUsd(g.totalCost)}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Expanded term list */}
      {expanded && groups[expanded] && (
        <div style={{ padding: '10px 16px' }}>
          {switchSelected.size > 0 && (
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 16px', marginBottom:10, background:'#fff3e0', border:'1px solid #ffcc80', borderRadius:7 }}>
              <span style={{ fontSize:13, color:'#a56700', fontWeight:600 }}>{switchSelected.size} term{switchSelected.size!==1?'s':''} selected</span>
              <button
                onClick={startSwitch}
                style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 16px', background:'#a56700', color:'#fff', fontSize:12, fontWeight:700, borderRadius:6, border:'none', cursor:'pointer' }}>
                🔁 Switch to {switchLockedStatus === 'keyword' ? 'Negative Keyword' : 'Keyword'}
              </button>
              <button onClick={() => setSwitchSelected(new Set())}
                style={{ fontSize:12, color:'#555', background:'none', border:'1px solid #dde9f5', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
                Clear
              </button>
            </div>
          )}
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['Search Term', 'Triggered Keyword', 'Impressions', 'Clicks', 'Cost', 'Conv.', 'CTR', 'Status'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: h === 'Search Term' || h === 'Triggered Keyword' ? 'left' : 'right', fontSize: 10, fontWeight: 600, color: '#fff', background: '#1a3a6b', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups[expanded].terms.slice(pg.page * pg.pageSize, pg.page * pg.pageSize + pg.pageSize).map((t, vi) => {
                const i      = pg.page * pg.pageSize + vi
                const signal = getSignal(t)
                return (
                <tr key={i} style={{ background: vi % 2 === 0 ? '#fff' : '#f5f7fa' }}>
                  <td style={{ padding: '5px 8px', color: '#1a3a6b', fontWeight: 500, borderBottom: '1px solid #f0f4f8' }}>{t.term}</td>
                  <td style={{ padding: '5px 8px', borderBottom: '1px solid #f0f4f8' }}>
                    {t.triggeredKeyword
                      ? <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
                          <span style={{ fontSize:12, color:'#1a3a6b' }}>{t.triggeredKeyword}</span>
                          {t.matchType && <span style={{ fontSize:9, fontWeight:600, padding:'1px 5px', borderRadius:3, background:'#e3f2fd', color:'#1565c0' }}>{t.matchType}</span>}
                        </span>
                      : <span style={{ color:'#aaa', fontSize:11 }}>—</span>}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#555', borderBottom: '1px solid #f0f4f8' }}>{(t.impressions||0).toLocaleString()}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#555', borderBottom: '1px solid #f0f4f8' }}>{t.clicks}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#555', borderBottom: '1px solid #f0f4f8' }}>{fmtUsd(t.cost)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#555', borderBottom: '1px solid #f0f4f8' }}>{t.conversions}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#555', borderBottom: '1px solid #f0f4f8' }}>{t.ctr?.toFixed(1)}%</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid #f0f4f8' }}>
                    {signal ? (
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3 }}>
                        <KwSignalBadge status={signal.status} onClick={() => setSignalModal(signal)} />
                        {selectedAccount && (() => {
                          const switchDisabled = !!switchLockedStatus && switchLockedStatus !== signal.status
                          return (
                            <label style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10,
                              color: switchDisabled ? '#ccc' : '#a56700', cursor: switchDisabled ? 'not-allowed' : 'pointer' }}>
                              <input type="checkbox" disabled={switchDisabled} checked={switchSelected.has(i)} onChange={() => toggleSwitchRow(i)} />
                              Switch
                            </label>
                          )
                        })()}
                      </div>
                    ) : selectedAccount ? (
                      <button
                        onClick={() => setPublishRows([t])}
                        style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 9px',
                          fontSize:10, fontWeight:600, borderRadius:5, cursor:'pointer', whiteSpace:'nowrap',
                          border:'1px solid #1a3a6b', background:'#1a3a6b', color:'#fff' }}>
                        🚀 Proceed to Publish
                      </button>
                    ) : <span style={{ color:'#aaa', fontSize:11 }}>—</span>}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
          </div>
          <PgFooter page={pg.page} pageSize={pg.pageSize} total={groups[expanded].terms.length}
            onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
        </div>
      )}

      {!expanded && (
        <div style={{ padding: '8px 16px', fontSize: 11, color: '#aaa' }}>
          Click a category chip to expand its search terms.
        </div>
      )}

      <KwSignalModal
        signal={signalModal}
        onClose={() => setSignalModal(null)}
        selectedAccount={selectedAccount}
        allowKeywordActions
        onKeywordChanged={onKeywordChanged}
      />

      {publishRows && selectedAccount && (
        <SearchTermPublishModal
          rows={publishRows.map(r => ({ searchTerm: r.term, conversions: r.conversions, phoneCalls: 0 }))}
          selectedAccount={selectedAccount}
          initialKwType={publishRows[0]?.isWarning ? 'Negative Keyword' : 'Keyword'}
          initialCampaignId={campaignId}
          initialAdGroupId={adGroupId}
          onClose={() => setPublishRows(null)}
          onSuccess={payload => {
            onPublished?.(buildOptimisticPublishRecords(payload))
            setPublishRows(null)
          }}
        />
      )}

      {switchRows && selectedAccount && (
        <SearchTermPublishModal
          rows={switchRows.map(r => ({ searchTerm: r.term, conversions: r.conversions, phoneCalls: 0 }))}
          selectedAccount={selectedAccount}
          lockKwType={switchToKwType}
          initialLevel="Ad Group"
          initialCampaignId={campaignId}
          initialAdGroupId={adGroupId}
          removalByRow={switchRemovalByRow}
          onRemoved={handleSwitchRemoved}
          onClose={() => setSwitchRows(null)}
          onSuccess={payload => {
            onPublished?.(buildOptimisticPublishRecords(payload))
            setSwitchRows(null); setSwitchSelected(new Set())
          }}
        />
      )}
    </Card>
  )
}

// ── Landing Page ──────────────────────────────────────────────────────────────

function LandingPageSection({ landingPage, lpMatch, lpLoading, lpError, embedded = false, onRefresh, refreshing = false, unchanged = false, businessName, campaignName, adGroupName }) {
  const GRADE_COLOR = { Good: '#2e7d32', Average: '#e65100', Poor: '#c0392b', Unknown: '#888' }
  const gc    = lpMatch ? (GRADE_COLOR[lpMatch.grade] || '#888') : '#888'
  const extra = (lpMatch || onRefresh) && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {lpMatch && (
        <span title="Plain word-level coverage — a secondary diagnostic, not the main indicator of relevance. See Theme Coverage Opportunities below for what actually matters."
          style={{ fontSize: 12, fontWeight: 700, padding: '3px 12px', borderRadius: 4, background: `${gc}18`, color: gc, border: `1px solid ${gc}44` }}>
          Raw Theme Coverage: {lpMatch.score}% ({lpMatch.grade})
        </span>
      )}
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={refreshing || lpLoading}
          title="Re-fetch the landing page — use this after editing the page content so stale missing-word results don't linger"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px',
            fontSize: 11, fontWeight: 600, borderRadius: 5, border: '1px solid #dde9f5',
            background: '#fff', color: '#1a3a6b',
            cursor: (refreshing || lpLoading) ? 'not-allowed' : 'pointer',
            opacity: (refreshing || lpLoading) ? 0.6 : 1,
          }}>
          {refreshing ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      )}
    </div>
  )

  // Fetched successfully, but came back byte-identical to the previous
  // fetch — nearly always means the site's own CDN/cache plugin is still
  // serving the pre-edit page despite the cache-busting query param this
  // app appends, not that the refresh itself failed silently.
  const unchangedBanner = (unchanged && !refreshing && !lpLoading && !lpError && !landingPage?.error) && (
    <div style={{ margin: embedded ? '0 0 10px' : '0 16px 10px', padding: '10px 14px', background: '#fff8e6', border: '1px solid #ffe0b2', borderRadius: 7, fontSize: 12, color: '#a56700', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
    <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
    <span>This looks identical to the last fetch. If you just edited the live page, your site's cache (CDN or a caching plugin like WP Rocket/LiteSpeed/Cloudflare) is likely still serving the old version — purge that cache, then click Refresh again in a minute.</span>
    </div>
  )

  let content
  if (lpLoading) {
    content = <Spinner label="Fetching landing page…" />
  } else if (lpError || landingPage?.error) {
    content = (
      <div style={{ padding: embedded ? '6px 0' : 16, display: 'flex', gap: 10, alignItems: 'center', color: '#c0392b', fontSize: 13 }}>
        <AlertCircle size={16} />
        {lpError || landingPage?.error || 'Could not fetch landing page.'}
      </div>
    )
  } else if (!landingPage) {
    return null
  } else {
    content = (
      <div style={{ padding: embedded ? '8px 0 4px' : 16, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {/* LP data */}
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Extracted Content</div>
          {[
            ['URL',       landingPage.url],
            ['Title',     landingPage.title],
            ['H1',        landingPage.h1],
            ['Meta Desc', landingPage.metaDescription],
          ].map(([label, val]) => val ? (
            <div key={label} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#888', fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 14, color: '#333', wordBreak: 'break-word' }}>{val}</div>
            </div>
          ) : null)}
          {landingPage.h2s?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#888', fontWeight: 600 }}>H2s</div>
              <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
                {landingPage.h2s.map((h, i) => <li key={i} style={{ fontSize: 13, color: '#555' }}>{h}</li>)}
              </ul>
            </div>
          )}
          {landingPage.ctas?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#888', fontWeight: 600 }}>CTAs Found</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                {landingPage.ctas.map((c, i) => (
                  <span key={i} style={{ fontSize: 12, padding: '2px 8px', background: '#e8f5e9', color: '#2e7d32', borderRadius: 4, border: '1px solid #4caf5033' }}>{c}</span>
                ))}
              </div>
            </div>
          )}
          {landingPage.trustSignals?.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: '#888', fontWeight: 600 }}>Trust Signals</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                {landingPage.trustSignals.map((t, i) => (
                  <span key={i} style={{ fontSize: 12, padding: '2px 8px', background: '#e3f2fd', color: '#1565c0', borderRadius: 4 }}>{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Match analysis */}
        {lpMatch && (
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Match Analysis</div>
            {lpMatch.mismatches?.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {lpMatch.mismatches.map((m, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 5, background: '#fff5f5', border: '1px solid #ffd5cc', fontSize: 13 }}>
                    <AlertCircle size={14} color="#c0392b" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ color: '#c0392b' }}>{m}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 5, background: '#e8f5e9', border: '1px solid #4caf5033', fontSize: 13 }}>
                <CheckCircle size={14} color="#2e7d32" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ color: '#2e7d32' }}>Landing page content aligns well with ad group theme.</span>
              </div>
            )}
            {lpMatch.matched?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 4 }}>Matched Keywords</div>
                <div style={{ fontSize: 13, color: '#2e7d32' }}>{lpMatch.matched.slice(0, 10).join(', ')}</div>
              </div>
            )}
            {lpMatch.prioritized && (lpMatch.prioritized.high.length + lpMatch.prioritized.medium.length + lpMatch.prioritized.low.length > 0) && (
              <div style={{ marginTop: 12 }}>
                <div title="Not every missing word needs fixing — grouped by how much it actually matters, so low-value query modifiers (near, cheap, best...) don't compete for attention with real service/intent gaps."
                  style={{ fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 6 }}>
                  Theme Coverage Opportunities
                </div>
                <ThemeOpportunityGroup label="High Priority" color="#c0392b" items={lpMatch.prioritized.high} statusLabel="Action Recommended" />
                <ThemeOpportunityGroup label="Medium Priority" color="#a56700" items={lpMatch.prioritized.medium} statusLabel="Consider" />
                <ThemeOpportunityGroup label="Low Priority" color="#888" items={lpMatch.prioritized.low} statusLabel="No Change Required" />

                <LandingPageRelevanceAnalysisBox
                  prioritized={lpMatch.prioritized}
                  currentH2s={landingPage.h2s}
                  h2Sections={landingPage.h2Sections}
                  landingPage={landingPage}
                  businessName={businessName}
                  campaignName={campaignName}
                  adGroupName={adGroupName}
                />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (embedded) return (
    <div style={{ borderTop: '2px solid #eef2f7', padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1 }}>Landing Page Analysis</div>
        {extra}
      </div>
      {unchangedBanner}
      {content}
    </div>
  )

  return <Card title="Landing Page Analysis" extra={extra}>{unchangedBanner}{content}</Card>
}

// One priority tier of theme-coverage opportunities — a plain list with a
// status label, not an action list, since LOW-priority modifiers especially
// should read as "informational," not "go fix this."
function ThemeOpportunityGroup({ label, color, items, statusLabel }) {
  if (!items?.length) return null
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 3 }}>{label} ({items.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((o, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
            <span style={{ color: '#333' }}>{o.text}</span>
            <span style={{ color, fontSize: 10.5, fontWeight: 600, flexShrink: 0 }}>{statusLabel}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const H2_STATE_COLOR = { CHANGE: '#2e7d32', CONSIDER: '#a56700' }

// Runs the combined AI pass — a weighted Landing Page Relevance score plus
// section-aware H2 edit recommendations (current → recommended, with the
// state, priority, and reason for each) — over the already-classified
// priority opportunities and each H2's real section content. Only shows
// recommendations the model itself marked CHANGE/CONSIDER; a heading it
// would leave alone never appears here at all, by design.
function LandingPageRelevanceAnalysisBox({ prioritized, currentH2s, h2Sections, landingPage, businessName, campaignName, adGroupName }) {
  const [result,    setResult]    = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [copiedIdx, setCopiedIdx] = useState(null)
  // Headings already given a recommendation in an earlier run THIS session —
  // told to the model on every subsequent call so "Regenerate" spreads
  // remaining concepts across other headings instead of piling more edits
  // onto the same one it already suggested (which otherwise happens easily:
  // nothing else tells the model that heading was just addressed).
  const [editedHeadings, setEditedHeadings] = useState([])
  const h2Fingerprint = (currentH2s || []).join('|')
  const prevFingerprint = useRef(h2Fingerprint)
  if (prevFingerprint.current !== h2Fingerprint) {
    // The H2 list itself changed — the page was re-fetched (e.g. after the
    // user applied an edit live and hit Refresh). Old "already addressed"
    // tracking no longer applies to a page that's actually different now.
    prevFingerprint.current = h2Fingerprint
    if (editedHeadings.length > 0) setEditedHeadings([])
    if (result) setResult(null)
  }

  async function generate() {
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await window.electronAPI.rsaAnalyzeLandingPageRelevance({
        url:        landingPage?.url || '',
        currentH2s: currentH2s || [],
        h2Sections: h2Sections || [],
        prioritized,
        alreadyEditedHeadings: editedHeadings,
        adGroupName, campaignName, businessName,
      })
      setResult(res)
      if (res?.h2Updates?.length) {
        setEditedHeadings(prev => [...new Set([...prev, ...res.h2Updates.map(u => u.current)])])
      }
    } catch (e) {
      setError(e.message || 'Failed to analyze landing page relevance')
    } finally {
      setLoading(false)
    }
  }

  function copyOne(text, i) {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopiedIdx(i); setTimeout(() => setCopiedIdx(null), 2000)
  }

  const rel = result?.relevance
  const relColor = rel?.grade === 'Excellent' || rel?.grade === 'Good' ? '#2e7d32' : rel?.grade === 'Average' ? '#a56700' : '#c0392b'

  return (
    <div style={{ marginTop: 12 }}>
      {!result && (
        <button onClick={generate} disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px',
            fontSize: 11, fontWeight: 600, borderRadius: 5, border: '1px solid #1a3a6b',
            background: loading ? '#dde9f5' : '#1a3a6b', color: loading ? '#888' : '#fff',
            cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? <Loader2 size={11} className="spin" /> : '✨'}
          {loading ? 'Analyzing…' : 'Analyze Relevance & Suggest H2 Updates'}
        </button>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#c0392b', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />{error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 8 }}>
          {rel?.total != null && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                Landing Page Relevance
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: relColor }}>{rel.total}/100</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: relColor }}>{rel.grade}</span>
              </div>
              {rel.breakdown && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {Object.entries(rel.breakdown).map(([key, dim]) => (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#555' }}>
                      <span>{key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}</span>
                      <span style={{ fontWeight: 600, color: '#1a3a6b' }}>{dim.score}/{dim.max}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {result.h2Updates?.length > 0 ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                Recommended H2 Updates
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, color: '#888', borderBottom: '1px solid #eef2f7' }}>Current H2</th>
                      <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, color: '#888', borderBottom: '1px solid #eef2f7' }}>Recommended H2</th>
                      <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, color: '#888', borderBottom: '1px solid #eef2f7' }}>Reason</th>
                      <th style={{ width: 1, padding: '6px 10px', borderBottom: '1px solid #eef2f7' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {result.h2Updates.map((u, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f7f9fb' }}>
                        <td style={{ padding: '8px 10px', color: '#888', verticalAlign: 'top', borderBottom: '1px solid #f0f4f8' }}>{u.current}</td>
                        <td style={{ padding: '8px 10px', verticalAlign: 'top', borderBottom: '1px solid #f0f4f8' }}>
                          <div style={{ fontWeight: 600, color: '#1a3a6b' }}>{u.recommended}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: `${H2_STATE_COLOR[u.state]}18`, color: H2_STATE_COLOR[u.state] }}>{u.state}</span>
                            {u.covers.map((k, ki) => (
                              <span key={ki} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#e8f5e9', color: '#2e7d32' }}>{k}</span>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 11.5, color: '#888', verticalAlign: 'top', borderBottom: '1px solid #f0f4f8', maxWidth: 260 }}>{u.reason}</td>
                        <td style={{ padding: '8px 10px', verticalAlign: 'top', borderBottom: '1px solid #f0f4f8' }}>
                          <button onClick={() => copyOne(u.recommended, i)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px',
                              fontSize: 10, fontWeight: 600, borderRadius: 4, border: 'none', whiteSpace: 'nowrap',
                              background: copiedIdx === i ? '#2e7d32' : '#2563b0', color: '#fff', cursor: 'pointer' }}>
                            {copiedIdx === i ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#2e7d32', display: 'flex', gap: 6, alignItems: 'flex-start', padding: '8px 10px', background: '#e8f5e9', border: '1px solid #4caf5033', borderRadius: 6 }}>
              <CheckCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              No H2 changes recommended — the existing headings already align well with the ad group's service and intent.
            </div>
          )}

          {result.contentOpportunities?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div title="These concepts don't fit naturally into any existing section — that's a gap in what the page offers/establishes, not just wording, so no H2 edit was suggested for them."
                style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                Content Opportunities
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {result.contentOpportunities.map((c, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#555' }}>
                    <strong style={{ color: '#1a3a6b' }}>{c.concept}</strong> — {c.reason}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={generate} disabled={loading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                fontSize: 11, fontWeight: 600, borderRadius: 5, border: '1px solid #dde9f5', background: '#fff',
                color: '#1a3a6b', cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />} Regenerate
            </button>
            {editedHeadings.length > 0 && (
              <span title={`Already addressed this session, so Regenerate won't re-target these unless nothing else fits: ${editedHeadings.join(' | ')}`}
                style={{ fontSize: 10.5, color: '#aaa' }}>
                {editedHeadings.length} heading{editedHeadings.length === 1 ? '' : 's'} already addressed — if you edited your live page, click <strong>Refresh</strong> above first so Regenerate sees the update.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Keywords section ──────────────────────────────────────────────────────────

const QS_COLOR = { 'Above Average': '#2e7d32', 'Average': '#e65100', 'Below Average': '#c0392b', 'Unknown': '#888' }

function KeywordsSection({ keywords }) {
  const pg = usePg(25)
  if (!keywords || keywords.length === 0) return null

  const kwCsvRows = keywords.map(k => ({
    'Keyword':         k.text,
    'Match Type':      k.matchType,
    'Quality Score':   k.qualityScore,
    'Ad Relevance':    k.adRelevance,
    'Landing Page':    k.landingPageExp,
    'Expected CTR':    k.expectedCtr,
    'Impressions':     k.impressions,
    'Clicks':          k.clicks,
    'Cost':            k.cost?.toFixed(2),
    'Conversions':     k.conversions,
    'CTR':             k.ctr?.toFixed(2) + '%',
  }))

  return (
    <Card title="Keywords" extra={
      <ExportButton data={kwCsvRows} filename="keywords_quality.csv" label="Export CSV" />
    }>
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {[['Keyword','left'], ['Match','center'], ['QS','center'], ['Ad Rel.','center'], ['Landing','center'], ['Exp.CTR','center'], ['Impr.','right'], ['Clicks','right'], ['Cost','right'], ['Conv.','right']].map(([h,a]) => (
                <th key={h} style={{ padding: '7px 8px', textAlign: a, fontSize: 10, fontWeight: 600, color: '#fff', background: '#1a3a6b', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keywords.slice(pg.page * pg.pageSize, pg.page * pg.pageSize + pg.pageSize).map((k, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f5f7fa' }}>
                <td style={{ padding: '6px 8px', fontWeight: 600, color: '#1a3a6b', borderBottom: '1px solid #f0f4f8' }}>{k.text}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #f0f4f8' }}>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#e3f2fd', color: '#1565c0' }}>{k.matchType}</span>
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700, borderBottom: '1px solid #f0f4f8', color: k.qualityScore >= 7 ? '#2e7d32' : k.qualityScore >= 5 ? '#e65100' : '#c0392b' }}>
                  {k.qualityScore || '—'}
                </td>
                {[k.adRelevance, k.landingPageExp, k.expectedCtr].map((v, vi) => (
                  <td key={vi} style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #f0f4f8' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: QS_COLOR[v] || '#888' }}>{v}</span>
                  </td>
                ))}
                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#555', borderBottom: '1px solid #f0f4f8' }}>{k.impressions.toLocaleString()}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#555', borderBottom: '1px solid #f0f4f8' }}>{k.clicks.toLocaleString()}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#555', borderBottom: '1px solid #f0f4f8' }}>{fmtUsd(k.cost)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#2e7d32', fontWeight: 600, borderBottom: '1px solid #f0f4f8' }}>{k.conversions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PgFooter page={pg.page} pageSize={pg.pageSize} total={keywords.length}
        onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
    </Card>
  )
}

// ── Phase 2 — Generate New RSA Assets ────────────────────────────────────────

function InputField({ label, value, onChange, placeholder, type = 'text', required = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#555' }}>
        {label}{required && <span style={{ color: '#c0392b', marginLeft: 2 }}>*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: '7px 10px', border: '1px solid #dde9f5', borderRadius: 6,
          fontSize: 13, color: '#1a3a6b', outline: 'none', background: '#fff',
        }}
      />
    </div>
  )
}

function GeneratedAssetsView({ result, keywords, landingPage, serviceArea, usps, promotion, onRegenerate, onApply, regenCtx, onUpdateItem, onReplaceDescriptions, crossSetTexts }) {
  const [regenLoading, setRegenLoading] = useState({})
  const [regenError,   setRegenError]   = useState({})
  const [refreshingAllDesc, setRefreshingAllDesc] = useState(false)
  const [refreshAllDescError, setRefreshAllDescError] = useState(null)

  const adStrength = useMemo(() => {
    if (!result?.headlines?.length) return null
    return estimateAdStrength({
      headlines:    result.headlines.map(t => ({ text: t })),
      descriptions: (result.descriptions || []).map(t => ({ text: t })),
      keywords,
      landingPage,
    })
  }, [result, keywords, landingPage])

  const conversionReadiness = useMemo(() => {
    if (!result?.headlines?.length) return null
    return estimateConversionReadiness({
      headlines:    result.headlines.map(t => ({ text: t })),
      descriptions: (result.descriptions || []).map(t => ({ text: t })),
      keywords,
      landingPage, usps, promotion,
    })
  }, [result, keywords, landingPage, usps, promotion])


  function copyAll(items) {
    navigator.clipboard.writeText(items.join('\n'))
  }

  function copyForGoogleAds() {
    const sep = '─'.repeat(40)
    const hl  = result.headlines.join('\n')
    const ds  = result.descriptions.join('\n')
    navigator.clipboard.writeText(`Headlines\n${sep}\n${hl}\n\nDescriptions\n${sep}\n${ds}`)
  }

  async function handleRegenItem(assetType, index) {
    const key = `${assetType}_${index}`
    setRegenLoading(prev => ({ ...prev, [key]: true }))
    setRegenError(prev => ({ ...prev, [key]: null }))
    try {
      const currentText = assetType === 'headline' ? result.headlines[index] : result.descriptions[index]
      const res = await window.electronAPI.rsaRegenerateSingleAsset({
        customerId:      regenCtx?.customerId,
        assetType,
        currentText,
        index,
        adGroupName:     regenCtx?.adGroupName     || '',
        businessName:    regenCtx?.businessName    || '',
        tone:            regenCtx?.tone            || 'Professional',
        keywords:        keywords || [],
        allHeadlines:    result.headlines    || [],
        allDescriptions: result.descriptions || [],
        crossSetTexts:       crossSetTexts || [],
        preventCrossover:    regenCtx?.preventCrossover,
        siblingAdGroupNames: regenCtx?.siblingAdGroupNames,
        landingPageUrl:      regenCtx?.landingPageUrl,
      })
      if (res?.text && onUpdateItem) onUpdateItem(assetType, index, res.text)
    } catch (e) {
      setRegenError(prev => ({ ...prev, [key]: e.message || 'Regeneration failed. Please try again.' }))
    } finally {
      setRegenLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  // Regenerates all 4 descriptions together as a coordinated set (one leads
  // with keyword relevance, one with benefits, one with trust, one with a
  // CTA) instead of 4 independently-regenerated items — analyzes the current
  // headlines, keywords, and landing page together, same as initial generation.
  async function handleRefreshAllDescriptions() {
    setRefreshingAllDesc(true); setRefreshAllDescError(null)
    try {
      const res = await window.electronAPI.rsaRefreshAllDescriptions({
        customerId:           regenCtx?.customerId,
        adGroupName:          regenCtx?.adGroupName  || '',
        businessName:         regenCtx?.businessName || '',
        tone:                 regenCtx?.tone          || 'Professional',
        keywords:             keywords || [],
        headlines:            result.headlines || [],
        landingPage:          landingPage || null,
        existingDescriptions: result.descriptions || [],
        crossSetTexts:        crossSetTexts || [],
        preventCrossover:     regenCtx?.preventCrossover,
        siblingAdGroupNames:  regenCtx?.siblingAdGroupNames,
      })
      if (res?.descriptions?.length && onReplaceDescriptions) onReplaceDescriptions(res.descriptions)
    } catch (e) {
      setRefreshAllDescError(e.message || 'Refresh failed. Please try again.')
    } finally {
      setRefreshingAllDesc(false)
    }
  }

  return (
    <div style={{ padding: '0 0 4px' }}>
      {/* Score + action bar */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f4f8', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        {adStrength && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ScoreRing score={adStrength.score} maxScore={100} grade={adStrength.grade} size={64} />
            <div>
              <div style={{ fontSize: 10, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Est. Ad Strength</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: GRADE_COLOR[adStrength.grade] || '#888' }}>{adStrength.grade}</div>
            </div>
          </div>
        )}
        {conversionReadiness && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} title="A separate, heuristic estimate of likelihood to convert — not Ad Strength, and not a Google metric.">
            <ScoreRing score={conversionReadiness.score} maxScore={100} grade={conversionReadiness.grade} color={CONVERSION_GRADE_COLOR[conversionReadiness.grade]} size={64} />
            <div>
              <div style={{ fontSize: 10, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Conversion Readiness</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: CONVERSION_GRADE_COLOR[conversionReadiness.grade] || '#888' }}>{conversionReadiness.grade}</div>
            </div>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => copyAll(result.headlines)} style={btnStyle('#1565c0')}>Copy All Headlines</button>
        <button onClick={() => copyAll(result.descriptions)} style={btnStyle('#6a1b9a')}>Copy All Descriptions</button>
        <button onClick={copyForGoogleAds} style={btnStyle('#1a3a6b')}>📋 Copy for Google Ads</button>
        {onApply && <button onClick={onApply} style={btnStyle('#2e7d32')}>🚀 Publish to Google Ads</button>}
        <button onClick={onRegenerate} style={btnStyle('#555', true)}>🔄 Re-Generate</button>
      </div>

      {/* Headlines + Descriptions side by side */}
      <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>

        {/* Headlines table */}
        <div style={{ flex: '1 1 420px', padding: '12px 16px', borderRight: '1px solid #f0f4f8' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Headlines ({result.headlines.length})
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {[['#','center',26],['Headline','left','auto'],['Type','center',80],['Chars','center',52],['','center',42],['','center',36]].map(([h,a,w]) => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: a, fontSize: 10, fontWeight: 600, color: '#fff', background: '#1a3a6b', whiteSpace: 'nowrap', width: w !== 'auto' ? w : undefined }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.headlines.map((hl, i) => {
                const type   = result.headlineTypes?.[i] || classifyHeadlineType(hl, keywords, serviceArea)
                const hlLen  = getEffectiveLength(hl)
                const charOk = hlLen <= 30
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f5f7fa' }}>
                    <td style={{ padding: '6px 8px', textAlign: 'center', color: '#aaa', fontSize: 11, borderBottom: '1px solid #f0f4f8' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px', color: '#1a3a6b', fontWeight: 500, borderBottom: '1px solid #f0f4f8' }}>{hl}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #f0f4f8' }}><TypeBadge type={type} /></td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, borderBottom: '1px solid #f0f4f8', color: charOk ? '#2e7d32' : '#c0392b' }}>{hlLen}/30</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #f0f4f8' }}><CopyBtn text={hl} /></td>
                    <td style={{ padding: '4px 6px', textAlign: 'center', borderBottom: '1px solid #f0f4f8' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {regenLoading[`headline_${i}`]
                          ? <Loader2 size={12} className="spin" color="#888" />
                          : (
                            <button onClick={() => handleRegenItem('headline', i)} title="Regenerate this headline"
                              style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:22, height:22, borderRadius:4, border:'1px solid #dde9f5', background:'#fff', cursor:'pointer', color:'#1a3a6b' }}>
                              <RefreshCw size={11} />
                            </button>
                          )}
                        {regenError[`headline_${i}`] && (
                          <AlertCircle size={13} color="#c0392b" title={regenError[`headline_${i}`]} style={{ flexShrink: 0 }} />
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Descriptions */}
        <div style={{ flex: '0 1 340px', padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1 }}>
              Descriptions ({result.descriptions.length})
            </div>
            <button onClick={handleRefreshAllDescriptions} disabled={refreshingAllDesc || !onReplaceDescriptions}
              title="Regenerate all 4 descriptions together as a coordinated set — one for keyword relevance, one for benefits, one for trust, one for a strong CTA"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', fontSize: 10.5, fontWeight: 600, borderRadius: 4,
                border: '1px solid #6a1b9a', background: '#fff', color: '#6a1b9a',
                cursor: (refreshingAllDesc || !onReplaceDescriptions) ? 'not-allowed' : 'pointer', opacity: (refreshingAllDesc || !onReplaceDescriptions) ? 0.5 : 1,
                whiteSpace: 'nowrap',
              }}>
              {refreshingAllDesc ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}
              {refreshingAllDesc ? 'Refreshing…' : 'Refresh All Descriptions'}
            </button>
          </div>
          {refreshAllDescError && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start', marginBottom: 8, fontSize: 11, color: '#c0392b' }}>
              <AlertCircle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
              {refreshAllDescError}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {result.descriptions.map((d, i) => {
              const dLen = getEffectiveLength(d)
              const charOk = dLen >= 70 && dLen <= 90
              return (
                <div key={i} style={{ padding: '10px 12px', borderRadius: 6, background: i % 2 === 0 ? '#fafcff' : '#fff', border: '1px solid #eef2f7' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: '#aaa', fontWeight: 600 }}>D{i + 1}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: charOk ? '#2e7d32' : '#c0392b' }}>{dLen}/90</span>
                    <div style={{ flex: 1 }} />
                    <CopyBtn text={d} />
                    {regenLoading[`description_${i}`]
                      ? <Loader2 size={12} className="spin" color="#888" />
                      : (
                        <button onClick={() => handleRegenItem('description', i)} title="Regenerate this description"
                          style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:22, height:22, borderRadius:4, border:'1px solid #dde9f5', background:'#fff', cursor:'pointer', color:'#1a3a6b' }}>
                          <RefreshCw size={11} />
                        </button>
                      )}
                  </div>
                  <div style={{ fontSize: 12, color: '#333', lineHeight: 1.5 }}>{d}</div>
                  {regenError[`description_${i}`] && (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start', marginTop: 5, fontSize: 11, color: '#c0392b' }}>
                      <AlertCircle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                      {regenError[`description_${i}`]}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Ad Strength issues */}
          {adStrength?.issues?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#c0392b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Ad Strength Improvements</div>
              {adStrength.issues.map((iss, i) => (
                <div key={i} style={{ fontSize: 11, color: '#c0392b', display: 'flex', gap: 5, alignItems: 'flex-start', marginBottom: 4 }}>
                  <span style={{ flexShrink: 0, marginTop: 2 }}>•</span>{iss}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const btnStyle = (color, outline = false) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4,
  border: `1px solid ${color}`,
  background: outline ? 'transparent' : color,
  color:      outline ? color          : '#fff',
  cursor: 'pointer',
})

function Phase2Section({ builderData, landingPage: fallbackLp, keywords, adGroupName, campaignName, businessName: accountName, customerId, adGroupId, campaignId, loading, result, error, onGenerate, onRegenerate, onUpdateItem, onReplaceSet, preventCrossover, siblingAdGroupNames }) {
  const [form, setForm] = useState({
    serviceArea: '', yearsInBusiness: '',
    usp1: '', usp2: '', usp3: '', promotion: '', tone: 'Professional',
    lpUrl: '', rsaCount: 1,
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Apply-to-Google-Ads state — applyForSetIdx tracks WHICH generated RSA set is being published
  const [applyForSetIdx, setApplyForSetIdx] = useState(null)
  const [applying,       setApplying]       = useState(false)
  const [applyResult,    setApplyResult]    = useState(null)
  const [applyError,     setApplyError]     = useState(null)
  const [showChangelog,  setShowChangelog]  = useState(false)

  // Accordion + per-card regenerate state
  const [closedCards,     setClosedCards]     = useState(new Set()) // manually collapsed set indices
  const [regenSetLoading, setRegenSetLoading] = useState({})        // { setIdx: bool }

  function toggleCard(idx) {
    setClosedCards(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n })
  }

  async function handleApplyConfirm({ editedHeadlines, editedDescriptions, pauseAdIds } = {}) {
    const finalUrl = form.lpUrl.trim() || builderData?.rsaAds?.[0]?.finalUrls?.[0] || ''
    const targetSet = result?.sets?.[applyForSetIdx]
    setApplying(true); setApplyError(null)
    try {
      const res = await window.electronAPI.rsaApply({
        customerId, adGroupId, campaignId, adGroupName, campaignName,
        newHeadlines:    editedHeadlines    || targetSet?.headlines,
        newDescriptions: editedDescriptions || targetSet?.descriptions,
        finalUrl,
        displayPath1: urlRecs?.displayPath1 || '',
        displayPath2: urlRecs?.displayPath2 || '',
        beforeAds: builderData?.rsaAds || [],
        pauseAdIds: pauseAdIds || [],
      })
      setApplyResult(res)
    } catch (e) {
      setApplyError(e.message)
    } finally {
      setApplying(false)
    }
  }

  // Per-section LP state
  const [p2Lp,          setP2Lp]          = useState(null)
  const [p2LpLoading,   setP2LpLoading]   = useState(false)
  const [p2LpError,     setP2LpError]     = useState(null)
  const [p2LpRefreshing,setP2LpRefreshing]= useState(false)
  const [p2LpUnchanged, setP2LpUnchanged] = useState(false)
  const [urlRecs,        setUrlRecs]        = useState(null)
  const [urlRecsLoading, setUrlRecsLoading] = useState(false)
  const [urlRecsError,   setUrlRecsError]   = useState(null)

  // Use the custom LP if fetched, else fall back to Phase 1 LP
  const activeLp = p2Lp || fallbackLp

  function handleSubmit() {
    const url = form.lpUrl.trim()
    // Reset output from any previous run
    setP2Lp(null); setP2LpError(null); setUrlRecs(null); setUrlRecsError(null)
    setClosedCards(new Set())

    // Fire RSA generation immediately (uses fallback LP if already available)
    const currentScore = builderData?.rsaAds?.[0]
      ? estimateAdStrength({ headlines: builderData.rsaAds[0].headlines, descriptions: builderData.rsaAds[0].descriptions, keywords, landingPage: fallbackLp, hasFinalUrl: !!builderData.rsaAds[0].finalUrls?.[0] })
      : null
    onGenerate({
      ...form,
      customerId,
      businessName:   accountName,
      usps:           [form.usp1, form.usp2, form.usp3].filter(Boolean),
      adGroupName, campaignName, keywords,
      searchTerms:    builderData?.searchTerms || [],
      landingPage:    fallbackLp,
      scoreBreakdown: currentScore?.breakdown,
      issues:         currentScore?.issues,
      realActionItems: builderData?.rsaAds?.[0]?.actionItems || [], // Google's own real reasons the existing live ad in this ad group isn't rated higher
      count:          form.rsaCount,
      preventCrossover, siblingAdGroupNames,
    })

    // In parallel: analyze LP then get URL recommendations
    if (url) {
      setP2LpLoading(true)
      analyzeLandingPage(url)
        .then(lp => {
          setP2Lp(lp)
          setUrlRecsLoading(true)
          window.electronAPI.rsaRecommendUrlAssets({ url, landingPage: lp, keywords, adGroupName })
            .then(recs => setUrlRecs(recs))
            .catch(e   => setUrlRecsError(e.message))
            .finally(() => setUrlRecsLoading(false))
        })
        .catch(e => setP2LpError(e.message))
        .finally(() => setP2LpLoading(false))
    }
  }

  // Re-fetches the active landing page bypassing any client-side cache, so
  // editing the page and clicking Refresh doesn't just show the same stale
  // "missing from LP" words again.
  function refreshP2Lp() {
    const url = activeLp?.url
    if (!url) return
    const previousFingerprint = lpFingerprint(activeLp)
    setP2LpRefreshing(true); setP2LpError(null)
    analyzeLandingPage(url, { bustCache: true })
      .then(lp => {
        if (lp?.error) { setP2LpError(lp.error); setP2LpUnchanged(false); return }
        setP2Lp(lp)
        setP2LpUnchanged(previousFingerprint != null && lpFingerprint(lp) === previousFingerprint)
      })
      .catch(e => setP2LpError(e.message))
      .finally(() => setP2LpRefreshing(false))
  }

  async function handleRegenerateSet(setIdx) {
    const sets = result?.sets || []
    setRegenSetLoading(prev => ({ ...prev, [setIdx]: true }))
    try {
      const response = await window.electronAPI.rsaGenerateAssets({
        customerId,
        businessName:   accountName,
        usps:           [form.usp1, form.usp2, form.usp3].filter(Boolean),
        serviceArea:    form.serviceArea, yearsInBusiness: form.yearsInBusiness,
        promotion:      form.promotion,   tone:            form.tone,
        adGroupName, campaignName, keywords,
        searchTerms:    builderData?.searchTerms || [],
        landingPage:    activeLp,
        count:          1,
        existingSets:   sets.filter((_, i) => i !== setIdx),
        preventCrossover, siblingAdGroupNames,
      })
      const newSet = response?.sets?.[0]
      if (newSet?.headlines?.length && onReplaceSet) onReplaceSet(setIdx, newSet)
    } catch (e) {
      console.error('Regenerate RSA set failed:', e)
    } finally {
      setRegenSetLoading(prev => ({ ...prev, [setIdx]: false }))
    }
  }

  const canSubmit = !loading

  if (result?.sets?.length && !loading) {
    const finalUrl   = form.lpUrl.trim() || builderData?.rsaAds?.[0]?.finalUrls?.[0] || ''
    const enabledAds = (builderData?.rsaAds || []).filter(ad => ad.status === 'ENABLED')
    const sets       = result.sets

    return (
      <>
        {/* Apply Modal — scoped to whichever RSA set is being published */}
        {applyForSetIdx !== null && sets[applyForSetIdx] && (
          <ApplyModal
            onClose={() => { if (!applying) { setApplyForSetIdx(null); setApplyResult(null); setApplyError(null) } }}
            onConfirm={handleApplyConfirm}
            onViewChangelog={() => { setApplyForSetIdx(null); setApplyResult(null); setShowChangelog(true) }}
            applying={applying}
            applyResult={applyResult}
            applyError={applyError}
            config={{ customerId, adGroupId, campaignId, adGroupName, campaignName }}
            newAssets={{
              headlines:    sets[applyForSetIdx].headlines,
              descriptions: sets[applyForSetIdx].descriptions,
              finalUrl,
              displayPath1: urlRecs?.displayPath1 || '',
              displayPath2: urlRecs?.displayPath2 || '',
            }}
            existingAds={enabledAds}
            keywords={keywords}
            landingPage={activeLp}
            usps={[form.usp1, form.usp2, form.usp3].filter(Boolean)}
            promotion={form.promotion}
          />
        )}

        {/* Change Log Panel */}
        {showChangelog && <ChangeLogPanel onClose={() => setShowChangelog(false)} />}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a6b' }}>
            🚀 {sets.length} Generated RSA{sets.length > 1 ? 's' : ''}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowChangelog(true)} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 12px', fontSize:11, fontWeight:600, borderRadius:4, border:'1px solid #dde9f5', background:'#fff', color:'#1a3a6b', cursor:'pointer' }}>
              📋 Change Log
            </button>
            <button onClick={onRegenerate} style={btnStyle('#555', true)}>↺ Start Over</button>
          </div>
        </div>

        {/* One accordion card per generated RSA set */}
        {sets.map((set, idx) => {
          const isOpen   = !closedCards.has(idx)
          const regenBusy = !!regenSetLoading[idx]
          const crossSetTexts = sets
            .filter((_, i) => i !== idx)
            .flatMap(s => [...(s.headlines || []), ...(s.descriptions || [])])
          return (
            <div key={idx} className="card" style={{ marginBottom: 16 }}>
              <div
                className="card-header"
                onClick={() => toggleCard(idx)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isOpen ? <ChevronDown size={15} color="#1a3a6b" /> : <ChevronRight size={15} color="#1a3a6b" />}
                  <span className="card-title">RSA {sets.length > 1 ? `#${idx + 1} of ${sets.length}` : ''}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => handleRegenerateSet(idx)} disabled={regenBusy} style={btnStyle('#555', true)}>
                    {regenBusy ? <Loader2 size={11} className="spin" /> : '🔄'} {regenBusy ? 'Generating…' : 'Re-Generate This RSA'}
                  </button>
                  <button
                    onClick={() => { setApplyResult(null); setApplyError(null); setApplyForSetIdx(idx) }}
                    style={btnStyle('#2e7d32')}>
                    🚀 Publish to Google Ads
                  </button>
                </div>
              </div>

              {isOpen && (
                <GeneratedAssetsView
                  result={set}
                  keywords={keywords}
                  landingPage={activeLp}
                  serviceArea={form.serviceArea}
                  usps={[form.usp1, form.usp2, form.usp3].filter(Boolean)}
                  promotion={form.promotion}
                  onRegenerate={() => handleRegenerateSet(idx)}
                  regenCtx={{ customerId, adGroupName, businessName: accountName, tone: form.tone, preventCrossover, siblingAdGroupNames, landingPageUrl: activeLp?.url }}
                  onUpdateItem={(assetType, index, text) => onUpdateItem(idx, assetType, index, text)}
                  onReplaceDescriptions={newDescriptions => onReplaceSet(idx, { ...set, descriptions: newDescriptions })}
                  crossSetTexts={crossSetTexts}
                />
              )}
            </div>
          )
        })}

        {/* Shared Landing Page Analysis */}
        {(p2LpLoading || p2LpError || p2Lp || activeLp) && (
          <div className="card" style={{ marginBottom: 16 }}>
            <LandingPageSection
              landingPage={activeLp}
              lpMatch={activeLp ? detectLandingPageMismatch(adGroupName || '', keywords, activeLp) : null}
              lpLoading={p2LpLoading}
              lpError={p2LpError}
              embedded
              onRefresh={activeLp?.url ? refreshP2Lp : undefined}
              refreshing={p2LpRefreshing}
              unchanged={p2LpUnchanged}
              businessName={accountName}
              campaignName={campaignName}
              adGroupName={adGroupName}
            />
          </div>
        )}

        {/* Shared URL Suggestions */}
        {(urlRecsLoading || urlRecs || urlRecsError) && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                URL Suggestions
              </div>
              {urlRecsLoading && <div style={{ display:'flex', alignItems:'center', gap:8, color:'#888', fontSize:13 }}><Loader2 size={13} className="spin" /> Generating suggestions…</div>}
              {urlRecsError && <div style={{ color:'#c0392b', fontSize:13 }}>{urlRecsError}</div>}
              {urlRecs && (
                <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
                  {/* Final URL */}
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:.5, marginBottom:6 }}>Final URL</div>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:13, color:'#1a3a6b', fontWeight:600, wordBreak:'break-all' }}>{form.lpUrl}</span>
                      <CopyBtn text={form.lpUrl} />
                    </div>
                  </div>
                  {/* Display Path */}
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:.5, marginBottom:6 }}>Display Path</div>
                    <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                      <span style={{ fontSize:13, color:'#888' }}>yourdomain.com /</span>
                      <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                        <span style={{ padding:'3px 10px', background:'#e3f2fd', color:'#1565c0', borderRadius:4, fontSize:13, fontWeight:600 }}>{urlRecs.displayPath1 || '—'}</span>
                        <CopyBtn text={urlRecs.displayPath1} />
                      </div>
                      {urlRecs.displayPath2 && (<>
                        <span style={{ fontSize:13, color:'#888' }}>/</span>
                        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                          <span style={{ padding:'3px 10px', background:'#e3f2fd', color:'#1565c0', borderRadius:4, fontSize:13, fontWeight:600 }}>{urlRecs.displayPath2}</span>
                          <CopyBtn text={urlRecs.displayPath2} />
                        </div>
                      </>)}
                    </div>
                    <div style={{ marginTop:4, fontSize:11, color:'#aaa' }}>
                      Path 1: {(urlRecs.displayPath1||'').length}/15 chars · Path 2: {(urlRecs.displayPath2||'').length}/15 chars
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* AI Keyword Suggestions — Generate tab */}
        <div className="card" style={{ marginTop:20 }}>
          <div className="card-header">
            <span className="card-title">🔍 AI Keyword Suggestions</span>
          </div>
          <KeywordSuggestionsSection
            keywords={keywords}
            adGroupName={adGroupName}
            campaignName={campaignName}
            selectedAccount={customerId ? { id: customerId, name: accountName } : null}
            landingPage={activeLp}
          />
        </div>
      </>
    )
  }

  return (
    <Card title="🚀 Generate New RSA Assets">
      <div style={{ padding: '16px' }}>

        {/* Business name (from account) */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Business Name</div>
          <div style={{ padding: '7px 10px', background: '#f4f7fc', border: '1px solid #dde9f5', borderRadius: 6, fontSize: 13, color: '#1a3a6b', fontWeight: 600 }}>
            {accountName}
          </div>
        </div>

        {/* Row 1: area + years */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <InputField label="City / Service Area" value={form.serviceArea} onChange={v => set('serviceArea', v)} placeholder="e.g. Dallas & DFW" />
          <InputField label="In Business Since" value={form.yearsInBusiness} onChange={v => set('yearsInBusiness', v)} placeholder="e.g. 2007" type="number" />
        </div>

        {/* Row 2: USPs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <InputField label="USP 1" value={form.usp1} onChange={v => set('usp1', v)} placeholder="e.g. Licensed & Insured" />
          <InputField label="USP 2" value={form.usp2} onChange={v => set('usp2', v)} placeholder="e.g. Same-Day Service" />
          <InputField label="USP 3" value={form.usp3} onChange={v => set('usp3', v)} placeholder="e.g. Free Estimates" />
        </div>

        {/* Row 3: promotion + tone */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <InputField label="Active Promotion (optional)" value={form.promotion} onChange={v => set('promotion', v)} placeholder="e.g. 10% Off This Month" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555' }}>Tone</label>
            <select value={form.tone} onChange={e => set('tone', e.target.value)} style={{
              padding: '7px 10px', border: '1px solid #dde9f5', borderRadius: 6,
              fontSize: 13, color: '#1a3a6b', outline: 'none', background: '#fff',
            }}>
              <option>Professional</option>
              <option>Urgent</option>
              <option>Friendly</option>
            </select>
          </div>
        </div>

        {/* Row 4: Number of RSAs to generate */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>
            Number of RSAs to Generate
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3].map(n => (
              <button key={n} onClick={() => set('rsaCount', n)} style={{
                width: 40, height: 34, fontSize: 13, fontWeight: 700, borderRadius: 6,
                border: `1.5px solid ${form.rsaCount === n ? '#1a3a6b' : '#dde9f5'}`,
                background: form.rsaCount === n ? '#1a3a6b' : '#fff',
                color:      form.rsaCount === n ? '#fff'    : '#555',
                cursor: 'pointer',
              }}>{n}</button>
            ))}
          </div>
          <div style={{ marginTop: 5, fontSize: 11, color: '#888' }}>
            Each RSA gets its own unique headlines &amp; descriptions and its own Publish option.
          </div>
        </div>

        {/* Landing Page URL */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>
            Landing Page URL
            <span style={{ fontWeight: 400, color: '#aaa', marginLeft: 6 }}>— used for LP analysis &amp; display path suggestions</span>
          </div>
          <input
            type="url"
            value={form.lpUrl}
            onChange={e => set('lpUrl', e.target.value)}
            placeholder="https://example.com/service-page"
            style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: '1px solid #dde9f5', borderRadius: 6, fontSize: 13, color: '#1a3a6b', outline: 'none', background: '#fff' }}
          />
        </div>

        {error && (
          <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 6, fontSize: 12, color: '#c0392b' }}>
            {error}
          </div>
        )}

        <button onClick={handleSubmit} disabled={!canSubmit} style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 24px',
          background: canSubmit ? '#1a3a6b' : '#dde9f5',
          color:      canSubmit ? '#fff'    : '#aaa',
          fontWeight: 700, fontSize: 13, borderRadius: 6, border: 'none',
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}>
          {loading
            ? <><Loader2 size={14} className="spin" /> Generating {form.rsaCount} RSA{form.rsaCount > 1 ? 's' : ''}…</>
            : <><Search size={14} /> Generate {form.rsaCount} RSA{form.rsaCount > 1 ? 's' : ''} with AI</>}
        </button>

        <div style={{ marginTop: 10, fontSize: 11, color: '#aaa' }}>
          Keywords, quality score gaps, and landing page (if URL provided) are used automatically as context.
        </div>
      </div>
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AIRSABuilder({ selectedAccount, hidePaused }) {
  // Deep-link from Campaign Manager's "Go to AI RSA Builder" button (intent
  // absent/'generate' — pre-selects a just-created campaign/ad group) or from
  // Reports → Ads Performance's "Edit with AI Recommendations" button
  // (intent:'audit' — also auto-runs the analysis and auto-opens the Edit
  // modal for the specific ad, since arriving from Reports means there's a
  // known ad to fix, not just an ad group to browse). Consumed once so it
  // never fights a later manual selection.
  const location = useLocation()
  const deepLinkRef = useRef(
    location.state?.campaignId
      ? {
          campaignId: String(location.state.campaignId),
          adGroupId:  location.state.adGroupId ? String(location.state.adGroupId) : null,
          adId:       location.state.adId      ? String(location.state.adId)      : null,
          intent:     location.state.intent    || null,
        }
      : null
  )
  // Ad id to auto-open the Edit modal for once builderData loads (set from
  // the deep link above, consumed by AssetAuditSection after first use).
  const [autoOpenAdId, setAutoOpenAdId] = useState(null)
  // Set when the deep link's intent is 'audit' — triggers runAnalysis()
  // automatically once the ad group below is selected, instead of waiting
  // for a manual "Analyze Ad Group" click.
  const autoAnalyzeRef = useRef(false)

  const [campaigns,      setCampaigns]      = useState([])
  const [adGroups,       setAdGroups]       = useState([])
  const [selectedCamp,   setSelectedCamp]   = useState('')
  const [selectedAG,     setSelectedAG]     = useState('')
  const [campLoading,    setCampLoading]    = useState(false)
  const [agLoading,      setAgLoading]      = useState(false)
  const [dataLoading,    setDataLoading]    = useState(false)
  const [lpLoading,      setLpLoading]      = useState(false)
  const [error,          setError]          = useState(null)

  // Analysis results
  const [builderData,  setBuilderData]  = useState(null)   // { rsaAds, keywords, searchTerms }
  const [landingPages, setLandingPages] = useState({})     // { url: lpData }
  const [lpErrors,     setLpErrors]     = useState({})     // { url: errorMsg }
  // URLs currently being re-fetched via the Landing Page Analysis "Refresh"
  // button — so its spinner reflects only that one request, not the
  // account-wide lpLoading flag set during the initial full analysis.
  const [refreshingLpUrls, setRefreshingLpUrls] = useState(new Set())
  // URLs whose most recent refresh came back byte-identical to what we had
  // before — almost always means the client's own site cache (CDN / cache
  // plugin) is still serving the pre-edit page despite the cache-busting
  // query param, not that this app failed to refresh.
  const [lpUnchangedUrls, setLpUnchangedUrls] = useState(new Set())
  // Existing negative keywords scoped to the selected campaign/ad group —
  // needed alongside builderData.keywords so Intent Analysis can flag a
  // search term already added as a keyword or negative keyword in this
  // exact campaign/ad group (same K/NK signal used on the Search Terms
  // Recommended as Negative Keyword page).
  const [existingNegatives, setExistingNegatives] = useState([])

  // AI headline recommendations — { [adIdx]: { [headlineIdx]: string } }
  const [aiRecs,        setAiRecs]        = useState({})
  const [aiRecsLoading, setAiRecsLoading] = useState({})
  const [aiRecsError,   setAiRecsError]   = useState(null)

  // Phase 2 — generate new RSA assets
  const [p2Loading, setP2Loading] = useState(false)
  const [p2Result,  setP2Result]  = useState(null)
  const [p2Error,   setP2Error]   = useState(null)

  // Tab
  const [activeTab,      setActiveTab]      = useState('audit')
  const [adStatusFilter, setAdStatusFilter] = useState('ENABLED')

  // Ad Group Intent Lock — prevents headlines/descriptions from blending in
  // language that belongs to a sibling ad group's service intent
  const [preventCrossover, setPreventCrossover] = useState(true)

  // Load campaigns on account change
  useEffect(() => {
    if (!selectedAccount) return
    setCampaigns([]); setAdGroups([])
    setSelectedCamp(''); setSelectedAG('')
    setBuilderData(null); setLandingPages({}); setLpErrors({})
    setCampLoading(true); setError(null)
    // Always include paused campaigns here — unlike report-style pages, the
    // RSA Builder is a workbench you deliberately open to audit or rebuild
    // ads on a specific campaign, including ones you've paused, so it
    // shouldn't defer to the global "Hide Paused" toggle other pages use.
    window.electronAPI.rsaFetchCampaigns({ customerId: selectedAccount.id, hidePaused: false })
      .then(data => {
        setCampaigns(sortByStatus(data || []))
        const pending = deepLinkRef.current
        if (pending && (data || []).some(c => c.id === pending.campaignId)) {
          setSelectedCamp(pending.campaignId)
          setActiveTab(pending.intent === 'audit' ? 'audit' : 'generate')
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setCampLoading(false))
  }, [selectedAccount])

  // Load ad groups on campaign change
  useEffect(() => {
    if (!selectedAccount || !selectedCamp) { setAdGroups([]); setSelectedAG(''); return }
    setAdGroups([]); setSelectedAG(''); setBuilderData(null); setLandingPages({}); setLpErrors({})
    setAgLoading(true)
    window.electronAPI.rsaFetchAdGroups({ customerId: selectedAccount.id, campaignId: selectedCamp })
      .then(data => {
        setAdGroups(sortByStatus(data || []))
        const pending = deepLinkRef.current
        if (pending && pending.campaignId === selectedCamp) {
          if (pending.adGroupId && (data || []).some(a => a.id === pending.adGroupId)) {
            setSelectedAG(pending.adGroupId)
            if (pending.intent === 'audit') {
              autoAnalyzeRef.current = true
              if (pending.adId) setAutoOpenAdId(pending.adId)
            }
          }
          deepLinkRef.current = null // consumed — a later manual campaign switch won't reapply it
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setAgLoading(false))
  }, [selectedAccount, selectedCamp])

  // Auto-run the analysis once a deep-linked ad group (intent:'audit') is
  // selected above — skips the manual "Analyze Ad Group" click so arriving
  // from Reports lands on fully-loaded existing ads, not an empty tab.
  useEffect(() => {
    if (!selectedAG || !autoAnalyzeRef.current) return
    autoAnalyzeRef.current = false // consume once
    runAnalysis()
  }, [selectedAG])

  function triggerRecsGeneration(adIdx, ad, kwData, agObj) {
    const audit   = analyzeCurrentRSAAssets(ad, kwData)
    const nonKeep = audit.headlines
      .filter(h => h.label !== 'Keep')
      .map(h => ({ index: h.index !== undefined ? h.index : audit.headlines.findIndex(x => x === h), text: h.text, type: h.type, suggestion: h.label }))
    const keepHeadlines = audit.headlines.filter(h => h.label === 'Keep').map(h => ({ text: h.text, type: h.type }))
    if (nonKeep.length === 0) return
    setAiRecsLoading(prev => ({ ...prev, [adIdx]: true }))
    window.electronAPI.rsaGenerateHeadlineRecs({
      customerId: selectedAccount?.id,
      headlines: nonKeep, keepHeadlines,
      adGroupName: agObj?.name || '',
      keywords: (kwData || []).map(k => ({ text: k.text || k })),
      targetScore: 90,
      preventCrossover, siblingAdGroupNames,
      landingPageUrl: ad?.finalUrls?.[0] || '',
    }).then(result => {
      const recsMap = {}
      for (const rec of (result.recs || [])) recsMap[rec.index] = rec.text
      setAiRecs(prev => ({ ...prev, [adIdx]: recsMap }))
    }).catch(err => {
      setAiRecsError(err.message)
    }).finally(() => {
      setAiRecsLoading(prev => ({ ...prev, [adIdx]: false }))
    })
  }

  async function handleGenerateRecs(adIdx, ad, headlines, keywords) {
    setAiRecsError(null)
    const agObj = adGroups.find(a => a.id === selectedAG)
    triggerRecsGeneration(adIdx, ad, keywords, agObj)
  }

  async function runAnalysis() {
    if (!selectedAccount || !selectedAG) return
    setBuilderData(null); setLandingPages({}); setLpErrors({})
    setAiRecs({}); setAiRecsLoading({}); setAiRecsError(null)
    setP2Result(null); setP2Error(null)
    setExistingNegatives([])
    setAdStatusFilter('ENABLED')
    setDataLoading(true); setError(null)

    try {
      const data = await window.electronAPI.rsaFetchBuilderData({
        customerId: selectedAccount.id,
        adGroupId: selectedAG,
      })
      setBuilderData(data)

      // Negatives scoped to this exact campaign/ad group — campaign-level and
      // list negatives block the whole campaign (so this ad group too),
      // ad-group-level negatives block only this ad group.
      const campName = campaigns.find(c => c.id === selectedCamp)?.name || ''
      const agName   = adGroups.find(a => a.id === selectedAG)?.name    || ''
      Promise.all([
        window.electronAPI.fetchCampaignLevelNegatives({ customerId: selectedAccount.id, campaignId: selectedCamp }).catch(() => []),
        window.electronAPI.fetchAdGroupLevelNegatives({ customerId: selectedAccount.id, adGroupId: selectedAG }).catch(() => []),
        window.electronAPI.fetchNegativeListsForCampaign({ customerId: selectedAccount.id, campaignId: selectedCamp }).catch(() => []),
      ]).then(([campNegs, agNegs, lists]) => {
        const combined = [
          ...campNegs.filter(n => n.status !== 'Removed').map(n => ({ ...n, campaign: campName, level: 'Campaign' })),
          ...agNegs.filter(n => n.status !== 'Removed').map(n => ({ ...n, campaign: campName, adGroup: agName, level: 'Ad Group' })),
          ...lists.filter(l => l.status !== 'Removed').flatMap(l => l.keywords.map(k => ({ ...k, status: 'Enabled', campaign: campName, level: 'Campaign (List)' }))),
        ]
        setExistingNegatives(combined)
      }).catch(() => setExistingNegatives([]))

      // Auto-generate AI recommendations immediately after data loads
      const agObj = adGroups.find(a => a.id === selectedAG)
      if (data?.rsaAds?.length > 0) {
        data.rsaAds.forEach((ad, adIdx) => {
          triggerRecsGeneration(adIdx, ad, data.keywords || [], agObj)
        })
      }

      // Fetch landing page per unique RSA URL (each ad may have its own)
      const urls = [...new Set(
        (data?.rsaAds || []).flatMap(ad => ad.finalUrls || []).filter(Boolean)
      )]
      if (!urls.length) {
        const agUrl = adGroups.find(ag => ag.id === selectedAG)?.finalUrls?.[0]
        if (agUrl) urls.push(agUrl)
      }
      if (urls.length > 0) {
        setLpLoading(true)
        Promise.all(urls.map(url =>
          analyzeLandingPage(url)
            .then(lp  => ({ url, lp,   err: null }))
            .catch(e  => ({ url, lp:   null, err: e.message }))
        )).then(results => {
          const pages = {}, errs = {}
          results.forEach(({ url, lp, err }) => {
            if (lp)  pages[url] = lp
            if (err) errs[url]  = err
          })
          setLandingPages(pages)
          setLpErrors(errs)
        }).finally(() => setLpLoading(false))
      }
    } catch (err) {
      setError(err.message || 'Failed to load data')
    } finally {
      setDataLoading(false)
    }
  }

  // Re-fetches one landing page URL with a cache-busting query param, so
  // edits made on the live page (e.g. adding the words flagged as missing)
  // show up immediately instead of the client's CDN/cache plugin serving
  // back the same stale copy that produced the original mismatch.
  async function refreshLandingPage(url) {
    if (!url) return
    setRefreshingLpUrls(prev => new Set(prev).add(url))
    try {
      const previousFingerprint = lpFingerprint(landingPages[url])
      const lp = await analyzeLandingPage(url, { bustCache: true })
      setLandingPages(prev => ({ ...prev, [url]: lp?.error ? prev[url] : lp }))
      setLpErrors(prev => {
        const next = { ...prev }
        if (lp?.error) next[url] = lp.error
        else delete next[url]
        return next
      })
      setLpUnchangedUrls(prev => {
        const next = new Set(prev)
        const unchanged = !lp?.error && previousFingerprint != null && lpFingerprint(lp) === previousFingerprint
        if (unchanged) next.add(url); else next.delete(url)
        return next
      })
    } catch (e) {
      setLpErrors(prev => ({ ...prev, [url]: e.message || 'Failed to refresh landing page' }))
    } finally {
      setRefreshingLpUrls(prev => { const next = new Set(prev); next.delete(url); return next })
    }
  }

  // Reflects a saved in-place RSA content edit (Audit tab's "Edit" button on
  // an existing live ad) back into local state so the card shows the new
  // content immediately instead of the stale pre-edit values.
  function handleAdContentUpdated(adId, updated) {
    setBuilderData(prev => {
      if (!prev?.rsaAds) return prev
      const rsaAds = prev.rsaAds.map(a => a.adId === adId ? { ...a, ...updated } : a)
      return { ...prev, rsaAds }
    })
  }

  function handleUpdateP2ResultItem(setIdx, assetType, index, newText) {
    setP2Result(prev => {
      if (!prev?.sets) return prev
      const sets = prev.sets.map((s, i) => {
        if (i !== setIdx) return s
        if (assetType === 'headline') {
          const headlines = [...s.headlines]; headlines[index] = newText
          return { ...s, headlines }
        }
        const descriptions = [...s.descriptions]; descriptions[index] = newText
        return { ...s, descriptions }
      })
      return { ...prev, sets }
    })
  }

  function handleReplaceP2Set(setIdx, newSet) {
    setP2Result(prev => {
      if (!prev?.sets) return prev
      const sets = prev.sets.map((s, i) => i === setIdx ? newSet : s)
      return { ...prev, sets }
    })
  }

  async function handleGenerateAssets(payload) {
    setP2Loading(true); setP2Error(null); setP2Result(null)
    try {
      const result = await window.electronAPI.rsaGenerateAssets(payload)
      if (!result?.sets?.some(s => s.headlines?.length)) throw new Error('No headlines returned. Try again.')
      setP2Result(result)
    } catch (err) {
      setP2Error(err.message)
    } finally {
      setP2Loading(false)
    }
  }

  // Derived analysis
  const intentAnalysis = useMemo(() => {
    if (!builderData?.searchTerms?.length) return null
    return analyzeSearchTerms(builderData.searchTerms)
  }, [builderData])

  const selectedCampObj  = campaigns.find(c => c.id === selectedCamp)
  const selectedCampName = selectedCampObj?.name || ''
  const selectedAGName   = adGroups.find(a => a.id === selectedAG)?.name   || ''
  // Performance Max campaigns have no ad groups or RSAs at all — they run on
  // Asset Groups instead, a completely different structure. Nothing here applies.
  const isPMax = ['PERFORMANCE_MAX', '10'].includes(selectedCampObj?.channelType)

  // K/NK "already added" signal — same logic as the Search Terms Recommended
  // as Negative Keyword page, scoped to this exact campaign/ad group (the
  // whole audit is already scoped to one ad group, so every keyword/negative
  // here is automatically in-scope — no per-row campaign/adGroup matching
  // needed like the account-wide Search Terms tab has to do).
  const KW_STATUS_LBL = { ENABLED: 'Enabled', PAUSED: 'Paused', REMOVED: 'Removed' }
  const existingKeywordsForSignal = useMemo(() => (builderData?.keywords || []).map(k => ({
    ...k, status: KW_STATUS_LBL[k.status] || k.status,
    campaign: selectedCampName, adGroup: selectedAGName,
  })), [builderData, selectedCampName, selectedAGName])
  const kwMap   = useMemo(() => buildKwMap(existingKeywordsForSignal), [existingKeywordsForSignal])
  const negMaps = useMemo(() => buildNegMaps(existingNegatives), [existingNegatives])
  // Real sibling ad group names in the same campaign — used by the Ad Group
  // Intent Lock so the AI can infer each one's intent dynamically (no hardcoded list)
  const siblingAdGroupNames = adGroups.filter(a => a.id !== selectedAG).map(a => a.name).filter(Boolean)
  const canAnalyze       = selectedAccount && selectedAG && !dataLoading && !isPMax

  const filteredRsaAds = useMemo(() => {
    const ads = builderData?.rsaAds || []
    if (!adStatusFilter) return ads
    return ads.filter(ad => ad.status === adStatusFilter)
  }, [builderData, adStatusFilter])

  if (!selectedAccount) return <NoAccount />

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>

      {/* ── Page header ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1a3a6b', marginBottom: 4 }}>
          🤖 AI RSA Ad Builder
        </div>
        <div style={{ fontSize: 12, color: '#888' }}>
          Account: <strong style={{ color: '#1a3a6b' }}>{selectedAccount.name}</strong>
          <span style={{ margin: '0 6px', color: '#dde9f5' }}>|</span>
          ID: {selectedAccount.id}
        </div>
      </div>

      {/* ── Setup bar ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>

          {/* Campaign */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 260 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555' }}>Campaign</label>
            {campLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#888', fontSize: 12 }}>
                <Loader2 size={13} className="spin" /> Loading campaigns…
              </div>
            ) : (
              <select value={selectedCamp} onChange={e => setSelectedCamp(e.target.value)} style={{
                padding: '7px 10px', border: '1px solid #dde9f5', borderRadius: 6,
                fontSize: 13, color: '#1a3a6b', outline: 'none', background: '#fff', minWidth: 260,
              }}>
                <option value="">— Select Campaign —</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
                ))}
              </select>
            )}
          </div>

          {/* Ad Group */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 260 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555' }}>Ad Group</label>
            {agLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#888', fontSize: 12 }}>
                <Loader2 size={13} className="spin" /> Loading ad groups…
              </div>
            ) : (
              <select value={selectedAG} onChange={e => setSelectedAG(e.target.value)}
                disabled={!selectedCamp || isPMax}
                style={{
                  padding: '7px 10px', border: '1px solid #dde9f5', borderRadius: 6,
                  fontSize: 13, color: '#1a3a6b', outline: 'none',
                  background: (!selectedCamp || isPMax) ? '#f5f7fa' : '#fff', minWidth: 260,
                }}>
                <option value="" style={{ color: '#aaa' }}>— Select Ad Group —</option>
                {adGroups.map(ag => (
                  <option key={ag.id} value={ag.id} style={{ color: '#1a3a6b' }}>{ag.name} ({ag.status})</option>
                ))}
              </select>
            )}
          </div>

          {/* Analyze button + crossover lock — only relevant to the Audit/
              Generate tabs, which operate on the single selected ad group.
              Reports can run against a whole campaign, so this single-ad-
              group "Analyze" action would be misleading there (and an
              accidental click just burns API quota for nothing). */}
          {activeTab !== 'reports' && (
            <>
              <button onClick={runAnalysis} disabled={!canAnalyze} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 20px',
                background: canAnalyze ? '#1a3a6b' : '#dde9f5',
                color:      canAnalyze ? '#fff'    : '#aaa',
                fontWeight: 700, fontSize: 13, borderRadius: 6, border: 'none',
                cursor: canAnalyze ? 'pointer' : 'not-allowed', alignSelf: 'flex-end',
              }}>
                {dataLoading ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
                {dataLoading ? 'Analyzing…' : 'Analyze Ad Group'}
              </button>

              <label style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                padding: '8px 14px', borderRadius: 6, alignSelf: 'flex-end',
                background: preventCrossover ? '#eef6ff' : '#f5f7fa', border: `1px solid ${preventCrossover ? '#9fc4ec' : '#dde9f5'}`,
              }} title="When enabled, headlines and descriptions must stay specific to this ad group's own service intent — they won't borrow language that belongs to a sibling ad group.">
                <input type="checkbox" checked={preventCrossover} onChange={e => setPreventCrossover(e.target.checked)}
                  style={{ accentColor: '#1a3a6b', width: 15, height: 15 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#1a3a6b' }}>🔒 Prevent ad group crossover</span>
              </label>
            </>
          )}
        </div>

        {/* Breadcrumb */}
        {selectedCampName && (
          <div style={{ padding: '6px 16px', borderTop: '1px solid #f0f4f8', fontSize: 11, color: '#888' }}>
            {selectedCampName}{selectedAGName ? ` › ${selectedAGName}` : ''}
          </div>
        )}
      </div>

      {/* ── PMax warning ── */}
      {selectedCamp && isPMax && (
        <div style={{ marginBottom: 16, padding: '14px 16px', background: '#fff8e6', border: '1px solid #ffe0b2', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertCircle size={16} color="#a56700" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: '#a56700', lineHeight: 1.6 }}>
            <strong>Not applicable for Performance Max campaigns.</strong><br />
            Performance Max campaigns have no ad groups or Responsive Search Ads — they run on Asset Groups instead, a completely different structure. Select a Search campaign to use the RSA Builder.
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={16} color="#c0392b" />
          <span style={{ fontSize: 13, color: '#c0392b' }}>{error}</span>
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '2px solid #eef2f7', marginBottom: 20, gap: 0 }}>
        {[
          { id: 'audit',    label: 'Audit Existing RSA' },
          { id: 'generate', label: 'Generate New RSA using AI' },
          { id: 'reports',  label: 'RSA Reports' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 22px', fontSize: 13, fontWeight: activeTab === tab.id ? 700 : 500,
              color:      activeTab === tab.id ? '#1a3a6b' : '#888',
              background: 'transparent', border: 'none',
              borderBottom: activeTab === tab.id ? '3px solid #1a3a6b' : '3px solid transparent',
              marginBottom: -2, cursor: 'pointer', transition: 'all 0.15s',
            }}
          >{tab.label}</button>
        ))}
      </div>

      {/* ── Tab 1: Audit Existing RSA ── */}
      {activeTab === 'audit' && (
        <>
          {dataLoading && <Spinner label="Fetching RSA data, keywords, and search terms…" />}

          {builderData && !dataLoading && (
            <>
              {/* Ad Status filter */}
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, padding:'8px 12px', background:'#fafcff', border:'1px solid #eef2f7', borderRadius:7 }}>
                <span style={{ fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:.5 }}>Ad Status</span>
                {[
                  { label:'Eligible', value:'ENABLED'  },
                  { label:'Paused',   value:'PAUSED'   },
                  { label:'All',      value:''         },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setAdStatusFilter(opt.value)}
                    style={{
                      padding:'4px 14px', fontSize:12, fontWeight:600, borderRadius:5, cursor:'pointer',
                      background: adStatusFilter === opt.value ? '#1a3a6b' : '#fff',
                      color:      adStatusFilter === opt.value ? '#fff'    : '#555',
                      border:     adStatusFilter === opt.value ? '1px solid #1a3a6b' : '1px solid #dde9f5',
                    }}
                  >{opt.label}</button>
                ))}
                <span style={{ fontSize:11, color:'#aaa', marginLeft:4 }}>
                  {filteredRsaAds.length} of {builderData.rsaAds.length} ad{builderData.rsaAds.length !== 1 ? 's' : ''}
                </span>
              </div>

              <AssetAuditSection
                rsaAds={filteredRsaAds}
                keywords={builderData.keywords}
                searchTerms={builderData.searchTerms}
                landingPages={landingPages}
                lpLoading={lpLoading}
                lpErrors={lpErrors}
                agName={selectedAGName}
                aiRecs={aiRecs}
                aiRecsLoading={aiRecsLoading}
                onGenerateRecs={handleGenerateRecs}
                customerId={selectedAccount.id}
                adGroupId={selectedAG}
                selectedAccount={selectedAccount}
                campaignName={selectedCampName}
                businessName={selectedAccount.name}
                preventCrossover={preventCrossover}
                siblingAdGroupNames={siblingAdGroupNames}
                onRefreshLandingPage={refreshLandingPage}
                refreshingLpUrls={refreshingLpUrls}
                lpUnchangedUrls={lpUnchangedUrls}
                onAdContentUpdated={handleAdContentUpdated}
                autoOpenAdId={autoOpenAdId}
                onAutoOpenConsumed={() => setAutoOpenAdId(null)}
              />

              {aiRecsError && (
                <div style={{ marginBottom: 16, padding: '10px 16px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <AlertCircle size={14} color="#c0392b" />
                  <span style={{ fontSize: 12, color: '#c0392b' }}>AI Recs error: {aiRecsError}</span>
                </div>
              )}

              {intentAnalysis && (
                <IntentSection
                  classified={intentAnalysis.classified}
                  groups={intentAnalysis.groups}
                  warnings={intentAnalysis.warnings}
                  selectedAccount={selectedAccount}
                  campaignId={selectedCamp}
                  campaignName={selectedCampName}
                  adGroupId={selectedAG}
                  adGroupName={selectedAGName}
                  kwMap={kwMap}
                  negMaps={negMaps}
                  onPublished={({ keywords, negatives }) => {
                    if (keywords.length)  setBuilderData(prev => prev ? { ...prev, keywords: [...(prev.keywords || []), ...keywords] } : prev)
                    if (negatives.length) setExistingNegatives(prev => [...(prev || []), ...negatives])
                  }}
                  onKeywordChanged={(resourceName, newStatus) => {
                    const STATUS_ENUM = { Enabled: 'ENABLED', Paused: 'PAUSED', Removed: 'REMOVED' }
                    setBuilderData(prev => prev ? {
                      ...prev,
                      keywords: prev.keywords.map(k => k.resourceName === resourceName ? { ...k, status: STATUS_ENUM[newStatus] || newStatus } : k),
                    } : prev)
                  }}
                  onSwitchRemoved={(removedKeywordRNs, removedNegRNs) => {
                    if (removedKeywordRNs.size) setBuilderData(prev => prev ? { ...prev, keywords: prev.keywords.filter(k => !removedKeywordRNs.has(k.resourceName)) } : prev)
                    if (removedNegRNs.size) setExistingNegatives(prev => (prev || []).filter(n => !removedNegRNs.has(n.resourceName)))
                  }}
                />
              )}

            </>
          )}

          {!builderData && !dataLoading && !error && selectedAG && (
            <div style={{ padding: 60, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
              Click <strong>Analyze Ad Group</strong> to audit RSA assets, keywords, and search terms.
            </div>
          )}
          {!builderData && !dataLoading && !error && !selectedAG && (
            <div style={{ padding: 60, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
              Select a Campaign and Ad Group above, then click <strong>Analyze Ad Group</strong>.
            </div>
          )}
        </>
      )}

      {/* ── Tab 2: Generate New RSA using AI ── */}
      {activeTab === 'generate' && (
        <>
          {dataLoading && <Spinner label="Fetching RSA data, keywords, and search terms…" />}

          {!builderData && !dataLoading && !selectedAG && (
            <div style={{ padding: 60, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
              Select a Campaign and Ad Group above, then click <strong>Analyze Ad Group</strong> to enable generation.
            </div>
          )}
          {!builderData && !dataLoading && selectedAG && !error && (
            <div style={{ padding: 60, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
              Click <strong>Analyze Ad Group</strong> first — the generator uses your keywords, landing page, and quality score as context.
            </div>
          )}

          {builderData && !dataLoading && (
            <Phase2Section
              builderData={builderData}
              landingPage={
                builderData.rsaAds?.[0]?.finalUrls?.[0]
                  ? (landingPages[builderData.rsaAds[0].finalUrls[0]] ?? null)
                  : Object.values(landingPages)[0] ?? null
              }
              keywords={builderData.keywords}
              adGroupName={selectedAGName}
              campaignName={selectedCampName}
              businessName={selectedAccount.name}
              customerId={selectedAccount.id}
              adGroupId={selectedAG}
              campaignId={selectedCamp}
              loading={p2Loading}
              result={p2Result}
              error={p2Error}
              onGenerate={handleGenerateAssets}
              onRegenerate={() => setP2Result(null)}
              onUpdateItem={handleUpdateP2ResultItem}
              onReplaceSet={handleReplaceP2Set}
              preventCrossover={preventCrossover}
              siblingAdGroupNames={siblingAdGroupNames}
            />
          )}
        </>
      )}

      {/* ── Tab 3: RSA Reports ── */}
      {activeTab === 'reports' && (
        <RsaReportsTab
          selectedAccount={selectedAccount}
          campaigns={campaigns}
          adGroups={adGroups}
          selectedCamp={selectedCamp}
          selectedAG={selectedAG}
          selectedCampName={selectedCampName}
          selectedAGName={selectedAGName}
          isPMax={isPMax}
        />
      )}
    </div>
  )
}
