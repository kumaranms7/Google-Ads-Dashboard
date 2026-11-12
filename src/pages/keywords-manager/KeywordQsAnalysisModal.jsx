import React, { useState } from 'react'
import { Bot, Loader2, AlertCircle, CheckCircle, Sparkles, Wand2 } from 'lucide-react'
import Modal, { ModalError, ModalWarning, ModalSuccess, ModalFooter } from '../../components/Modal.jsx'
import { btnPrimary, btnGhost } from '../campaign-manager/manage-panels/EditPanels.jsx'
import { qsColor } from './shared.jsx'

const PRIORITY_STYLE = {
  High:   { bg: '#fdecea', text: '#c0392b', border: '#e05c2a' },
  Medium: { bg: '#fff8e1', text: '#a56700', border: '#f0b429' },
  Low:    { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' },
}

function isHeadlineAction(action = '')    { return /headline/i.test(action) }
function isDescriptionAction(action = '') { return /description/i.test(action) }

// Applies one AI-suggested headline/description to the currently-serving RSA
// — either as a new slot (if there's room) or replacing an existing one the
// user picks. Uses the same direct-mutate + before/after changelog pattern
// the AI RSA Builder's existing-ad editor already uses (that backend call has
// no validateOnly/dry-run support, so this mirrors that flow rather than the
// separate validate-then-publish ReviewModal pattern used elsewhere).
function ApplyPanel({ type, suggestion, context, selectedAccount, keyword, onCancel, onApplied }) {
  const current  = type === 'headline' ? context.headlines : context.descriptions
  const maxCount = type === 'headline' ? 15 : 4
  const limit    = type === 'headline' ? 30 : 90
  const hasRoom  = current.length < maxCount

  const [mode,       setMode]       = useState(hasRoom ? 'add' : 'replace')
  const [replaceIdx, setReplaceIdx] = useState(0)
  const [confirmed,  setConfirmed]  = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState(null)
  const [done,       setDone]       = useState(false)

  const text = String(suggestion || '').trim().slice(0, limit)
  const nextHeadlines    = type === 'headline'
    ? (mode === 'add' ? [...context.headlines, { text, pinned: null }] : context.headlines.map((h, i) => i === replaceIdx ? { ...h, text } : h))
    : context.headlines
  const nextDescriptions = type === 'description'
    ? (mode === 'add' ? [...context.descriptions, { text, pinned: null }] : context.descriptions.map((d, i) => i === replaceIdx ? { ...d, text } : d))
    : context.descriptions

  async function apply() {
    setSubmitting(true); setError(null)
    try {
      await window.electronAPI.rsaUpdateExistingAd({
        customerId:   selectedAccount.id,
        adGroupId:    keyword.adGroupId,
        adId:         context.adId,
        campaignName: keyword.campaignName,
        adGroupName:  keyword.adGroupName,
        headlines:    nextHeadlines,
        descriptions: nextDescriptions,
        finalUrl:     context.finalUrl,
        path1:        context.path1,
        path2:        context.path2,
        before: { headlines: context.headlines, descriptions: context.descriptions, finalUrl: context.finalUrl, path1: context.path1, path2: context.path2 },
      })
      setDone(true)
      onApplied({ ...context, headlines: nextHeadlines, descriptions: nextDescriptions })
    } catch (e) {
      setError(e.message || 'Failed to update the ad.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return <ModalSuccess><CheckCircle size={14} style={{ marginRight: 6 }} />Ad updated with the suggested {type}.</ModalSuccess>
  }

  return (
    <div style={{ padding: 12, background: '#f5f8ff', border: '1px solid #dbe6fa', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: '#1a3a6b' }}>
        Applying: <strong>"{text}"</strong> as a {type}
      </div>

      {hasRoom && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#333', cursor: 'pointer' }}>
          <input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} /> Add as a new {type} ({current.length}/{maxCount} used)
        </label>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#333', cursor: 'pointer' }}>
        <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace an existing {type}
      </label>
      {mode === 'replace' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 22 }}>
          {current.map((c, i) => (
            <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11.5, color: '#555', cursor: 'pointer' }}>
              <input type="radio" name="replaceSlot" checked={replaceIdx === i} onChange={() => setReplaceIdx(i)} style={{ marginTop: 2 }} />
              <span>#{i + 1}: "{c.text}"{c.pinned ? ` [pinned]` : ''}</span>
            </label>
          ))}
        </div>
      )}

      {error && <ModalError><AlertCircle size={13} style={{ marginRight: 6 }} />{error}</ModalError>}

      <ModalWarning>This will make a real, live change to the ad in Google Ads.</ModalWarning>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#555', cursor: 'pointer' }}>
        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
        I understand this will make a live change to the Google Ads account.
      </label>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button style={btnGhost} onClick={onCancel} disabled={submitting}>Cancel</button>
        <button
          style={{ ...btnPrimary, opacity: confirmed && !submitting ? 1 : 0.5, cursor: confirmed && !submitting ? 'pointer' : 'not-allowed' }}
          disabled={!confirmed || submitting}
          onClick={apply}
        >
          {submitting ? 'Applying…' : 'Apply to Ad'}
        </button>
      </div>
    </div>
  )
}

export default function KeywordQsAnalysisModal({ keyword: kw, selectedAccount, onClose }) {
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [result,   setResult]   = useState(null) // { analysis, context }
  const [applying, setApplying] = useState(null) // { recIndex, type, suggestion }

  function generate() {
    setLoading(true); setError(null)
    window.electronAPI.keywordManagerAiAnalyzeQualityScore({ customerId: selectedAccount.id, keyword: kw })
      .then(setResult)
      .catch(err => setError(err.message || 'Failed to analyze this keyword'))
      .finally(() => setLoading(false))
  }

  const analysis = result?.analysis
  const context  = result?.context

  return (
    <Modal title="Quality Score AI Analysis" subtitle={`${kw.text} · ${kw.matchType} match`} onClose={onClose} maxWidth={720}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: '#555' }}>
        <span>Quality Score: <strong style={{ color: qsColor(kw.qualityScore) }}>{kw.qualityScore || '—'}</strong></span>
        <span>Campaign: <strong style={{ color: '#1a3a6b' }}>{kw.campaignName}</strong></span>
        <span>Ad Group: <strong style={{ color: '#1a3a6b' }}>{kw.adGroupName}</strong></span>
      </div>

      {!result && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ fontSize: 12, color: '#888' }}>
            Analyzes Google's actual Quality Score components (Expected CTR, Ad relevance, Landing-page experience) for this keyword — using its real search terms, current RSA copy and landing page content — and recommends specific fixes.
          </div>
          <button style={{ ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={generate}>
            <Sparkles size={13} /> Generate Recommendation
          </button>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#888', padding: '10px 0' }}>
          <Loader2 size={14} className="spin" /> Analyzing Quality Score components…
        </div>
      )}

      {!loading && error && (
        <>
          <ModalError><AlertCircle size={14} style={{ marginRight: 6 }} />{error}</ModalError>
          <button style={btnGhost} onClick={generate}>Try Again</button>
        </>
      )}

      {!loading && analysis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {(() => {
              const p = PRIORITY_STYLE[analysis.priority] || PRIORITY_STYLE.Medium
              return (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: p.bg, color: p.text, border: `1px solid ${p.border}` }}>
                  {analysis.priority || 'Medium'} priority
                </span>
              )
            })()}
            <span style={{ fontSize: 12, color: '#555' }}>Weakest component: <strong style={{ color: '#1a3a6b' }}>{analysis.weakestComponent || '—'}</strong></span>
          </div>

          <div style={{ fontSize: 13, color: '#2c3e50', lineHeight: 1.6 }}>{analysis.summary}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(analysis.recommendations || []).map((rec, i) => {
              const headline    = isHeadlineAction(rec.action)
              const description = isDescriptionAction(rec.action)
              const suggestionLen = String(rec.suggestion || '').trim().length
              // Some slack above the real 30/90 limit (rather than the exact
              // cutoff) so a suggestion a few characters over still offers
              // Apply — updateExistingAdContent trims to the hard limit
              // anyway. Well past that slack means the AI likely returned a
              // multi-sentence paragraph instead of one piece of ad copy, in
              // which case truncating it would just produce a mangled
              // fragment — better to show it as read-only guidance only.
              const withinApplyLength = headline ? suggestionLen <= 45 : suggestionLen <= 130
              const canApply    = (headline || description) && suggestionLen > 0 && withinApplyLength && !!context?.adId
              const type        = headline ? 'headline' : 'description'
              return (
                <div key={i} style={{ padding: '10px 12px', background: '#f7f5ff', border: '1px solid #e0d9fb', borderRadius: 7, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#3d2470' }}>{i + 1}. {rec.action}</div>
                  {rec.suggestion && <div style={{ fontSize: 12, color: '#1a3a6b', fontStyle: 'italic' }}>"{rec.suggestion}"</div>}
                  {rec.reason && <div style={{ fontSize: 11.5, color: '#6a5a94', lineHeight: 1.5 }}>{rec.reason}</div>}
                  {canApply && applying?.recIndex !== i && (
                    <button
                      style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 5, border: '1px solid #6a3fc0', background: '#fff', color: '#6a3fc0', cursor: 'pointer' }}
                      onClick={() => setApplying({ recIndex: i, type, suggestion: rec.suggestion })}
                    >
                      <Wand2 size={11} /> Apply Suggested RSA Content
                    </button>
                  )}
                  {applying?.recIndex === i && context && (
                    <ApplyPanel
                      type={type}
                      suggestion={rec.suggestion}
                      context={context}
                      selectedAccount={selectedAccount}
                      keyword={kw}
                      onCancel={() => setApplying(null)}
                      onApplied={(newContext) => { setResult(r => ({ ...r, context: newContext })); }}
                    />
                  )}
                </div>
              )
            })}
          </div>

          {analysis.expectedImpact && (
            <div style={{ fontSize: 11.5, color: '#888', fontStyle: 'italic', borderTop: '1px solid #eef2f7', paddingTop: 10 }}>
              {analysis.expectedImpact}
            </div>
          )}

          <button style={{ ...btnGhost, alignSelf: 'flex-start' }} onClick={generate}>Regenerate</button>
        </div>
      )}
    </Modal>
  )
}
