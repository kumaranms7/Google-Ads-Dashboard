import React, { useEffect, useState } from 'react'
import { Plus, X, Sparkles, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { selectStyle, inputStyle } from '../campaign-manager/shared.jsx'
import { btnPrimary } from '../campaign-manager/manage-panels/EditPanels.jsx'
import { Spinner, CampaignAdGroupPicker, EmptyPickerHint, LeadPotentialBadge, usePagination, PaginationFooter, parseKeywordPasteText } from './shared.jsx'
import PublishKeywordModal from '../../components/PublishKeywordModal.jsx'

const MATCH_TYPES = [{ value: 'BROAD', label: 'Broad' }, { value: 'PHRASE', label: 'Phrase' }, { value: 'EXACT', label: 'Exact' }]

const leadScoreColor = s => (s >= 70 ? '#2e7d32' : s >= 40 ? '#a56700' : '#c0392b')
function LeadScoreBadge({ value }) {
  return <span style={{ fontWeight: 700, fontSize: 12, color: leadScoreColor(value) }}>{value}</span>
}

// Renders **phrase** markers (the AI is instructed to wrap the single most
// important point of expectedBenefit this way) as bold text, so the key
// takeaway stands out without needing a separate Reason column.
function HighlightedText({ text }) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\*\*([^*]+)\*\*$/.exec(part)
        return m ? <strong key={i} style={{ color: '#1a3a6b' }}>{m[1]}</strong> : <React.Fragment key={i}>{part}</React.Fragment>
      })}
    </>
  )
}

function isBlocked(text, matchType, existingKeywords, negatives) {
  const t = text.toLowerCase().trim()
  if (existingKeywords.some(k => k.text.toLowerCase().trim() === t && k.matchType === matchType)) return 'Already exists in this ad group'
  const neg = negatives.find(n => n.text.toLowerCase().trim() === t && (n.matchType === 'Broad' || n.matchType.toUpperCase() === matchType))
  if (neg) return `Blocked by an existing negative keyword (${neg.level})`
  return null
}

export default function AddNewKeywordsTab({ selectedAccount, dateRange }) {
  const [campaignId, setCampaignId] = useState('')
  const [adGroupId,  setAdGroupId]  = useState('')
  const [campaignObj, setCampaignObj] = useState(null)
  const [adGroupObj,  setAdGroupObj]  = useState(null)

  const [contextLoading,   setContextLoading]   = useState(false)
  const [existingKeywords, setExistingKeywords] = useState([])
  const [negatives,        setNegatives]        = useState([])

  const [aiRec,        setAiRec]        = useState(null)
  const [aiRecLoading, setAiRecLoading] = useState(false)
  const [aiRecError,   setAiRecError]   = useState(null)
  const [aiSelected,   setAiSelected]   = useState(new Set())

  const [manualText, setManualText] = useState('')
  const [manualMatchType, setManualMatchType] = useState('BROAD')
  const [manualList, setManualList] = useState([]) // [{ text, matchType }]
  const [manualError, setManualError] = useState(null)
  const [bulkText, setBulkText] = useState('')

  const [publishRows,   setPublishRows]   = useState(null) // rows passed to the shared publish modal, or null when closed
  const [publishSource, setPublishSource] = useState(null) // 'ai' | 'manual'

  const pg = usePagination(25)

  function handleChangeCampaign(id, obj) { setCampaignId(id); setCampaignObj(obj); setAiRec(null); setAiSelected(new Set()); setManualList([]) }
  function handleChangeAdGroup(id, obj)  { setAdGroupId(id); setAdGroupObj(obj); setAiRec(null); setAiSelected(new Set()); setManualList([]) }

  function refreshContext() {
    if (!selectedAccount || !adGroupId) { setExistingKeywords([]); setNegatives([]); return }
    setContextLoading(true)
    Promise.all([
      window.electronAPI.keywordManagerList({ customerId: selectedAccount.id, adGroupId, dateRange }),
      window.electronAPI.fetchExistingNegatives({ customerId: selectedAccount.id, dateRange }),
    ])
      .then(([kws, negData]) => {
        setExistingKeywords(kws || [])
        const applicable = (negData?.existingNegatives || []).filter(n =>
          (n.level === 'Ad Group' && n.adGroup === adGroupObj?.name) ||
          ((n.level === 'Campaign' || n.level === 'Campaign (List)') && n.campaign === campaignObj?.name)
        )
        setNegatives(applicable)
      })
      .catch(() => { setExistingKeywords([]); setNegatives([]) })
      .finally(() => setContextLoading(false))
  }

  useEffect(refreshContext, [selectedAccount, adGroupId, dateRange])

  function fetchAiRec() {
    setAiRecLoading(true); setAiRecError(null); setAiSelected(new Set()); pg.setPage(0)
    window.electronAPI.keywordManagerListSearchTerms({ customerId: selectedAccount.id, adGroupId, dateRange })
      .then(searchTerms => window.electronAPI.keywordManagerAiRecommendNewKeywords({
        campaignName: campaignObj?.name, adGroupName: adGroupObj?.name,
        existingKeywords, searchTerms,
        negativeKeywordTexts: negatives.map(n => n.text),
      }))
      .then(setAiRec)
      .catch(err => setAiRecError(err.message || 'Failed to get AI suggestions'))
      .finally(() => setAiRecLoading(false))
  }

  const suggestions = aiRec?.keywords || []

  function toggleAiSelect(i) {
    setAiSelected(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  }
  function toggleAiSelectAll() {
    const selectable = suggestions.map((k, i) => i).filter(i => !isBlocked(suggestions[i].text, suggestions[i].matchType, existingKeywords, negatives))
    setAiSelected(s => s.size === selectable.length ? new Set() : new Set(selectable))
  }

  function addManualRow() {
    const text = manualText.trim()
    if (!text) return
    setManualError(null)
    const key = `${text.toLowerCase()}|${manualMatchType}`
    if (manualList.some(r => `${r.text.toLowerCase()}|${r.matchType}` === key)) { setManualText(''); return }
    const blocked = isBlocked(text, manualMatchType, existingKeywords, negatives)
    if (blocked) { setManualError(blocked); return }
    setManualList(prev => [...prev, { text, matchType: manualMatchType }])
    setManualText('')
  }
  function removeManualRow(i) { setManualList(rows => rows.filter((_, idx) => idx !== i)) }

  // Bulk-paste — one keyword per line, Google Ads Editor match-type syntax
  // ([exact], "phrase", plain = broad). Skips anything already in the list
  // or blocked by an existing keyword/negative, same rules as the single-add
  // path, and reports how many were skipped rather than failing silently.
  function addBulkRows() {
    const parsed = parseKeywordPasteText(bulkText)
    if (parsed.length === 0) return
    setManualError(null)
    let blockedCount = 0
    setManualList(prev => {
      const next = [...prev]
      const seen = new Set(next.map(r => `${r.text.toLowerCase()}|${r.matchType}`))
      for (const { text, matchType } of parsed) {
        const key = `${text.toLowerCase()}|${matchType}`
        if (seen.has(key)) continue
        if (isBlocked(text, matchType, existingKeywords, negatives)) { blockedCount++; continue }
        seen.add(key)
        next.push({ text, matchType })
      }
      return next
    })
    setBulkText('')
    if (blockedCount > 0) setManualError(`${blockedCount} pasted keyword${blockedCount === 1 ? '' : 's'} skipped (already exists or blocked by a negative keyword)`)
  }

  function openAiPublish() {
    const rows = [...aiSelected].map(i => suggestions[i]).filter(Boolean)
      .map(r => ({ keyword: r.text, matchType: r.matchType, recommendedCampaign: campaignObj?.name, adGroup: adGroupObj?.name }))
    if (rows.length === 0) return
    setPublishRows(rows); setPublishSource('ai')
  }
  function openManualPublish() {
    if (manualList.length === 0) return
    setPublishRows(manualList.map(r => ({ keyword: r.text, matchType: r.matchType, recommendedCampaign: campaignObj?.name, adGroup: adGroupObj?.name })))
    setPublishSource('manual')
  }
  function closePublish() { setPublishRows(null); setPublishSource(null) }
  function handlePublishSuccess() {
    if (publishSource === 'ai') setAiSelected(new Set())
    if (publishSource === 'manual') setManualList([])
    closePublish()
    refreshContext()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <CampaignAdGroupPicker
          selectedAccount={selectedAccount}
          campaignId={campaignId} adGroupId={adGroupId}
          onChangeCampaign={handleChangeCampaign} onChangeAdGroup={handleChangeAdGroup}
        />
      </div>

      {!adGroupId ? (
        <div className="card"><EmptyPickerHint>Select a campaign and ad group to get keyword suggestions.</EmptyPickerHint></div>
      ) : (
        <>
          <div className="card" style={{ padding: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Manually Add Keywords</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <input
                value={manualText} onChange={e => { setManualText(e.target.value); setManualError(null) }} placeholder="Type a keyword…"
                style={{ ...inputStyle, flex: 1, minWidth: 200, maxWidth: 320 }} onKeyDown={e => { if (e.key === 'Enter') addManualRow() }}
              />
              <select value={manualMatchType} onChange={e => setManualMatchType(e.target.value)} style={{ ...selectStyle, width: 110 }}>
                {MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <button onClick={addManualRow} style={{ border: 'none', background: 'none', color: '#1a3a6b', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <Plus size={13} /> Add
              </button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
                Or paste multiple at once, one per line — wrap in [brackets] for Exact match, "quotes" for Phrase match, or leave plain for Broad match.
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <textarea
                  value={bulkText} onChange={e => setBulkText(e.target.value)}
                  placeholder={'plumbing repair\n"emergency plumber"\n[24 hour plumber]'}
                  rows={3}
                  style={{ flex: 1, minWidth: 240, maxWidth: 420, padding: '8px 10px', border: '1px solid #dde9f5', borderRadius: 6, fontSize: 12.5, color: '#1a3a6b', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                />
                <button onClick={addBulkRows} disabled={!bulkText.trim()}
                  style={{ ...btnPrimary, padding: '8px 16px', fontSize: 12, opacity: bulkText.trim() ? 1 : 0.5, cursor: bulkText.trim() ? 'pointer' : 'not-allowed' }}>
                  Add All
                </button>
              </div>
            </div>

            {manualError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#c0392b', marginBottom: 12 }}><AlertCircle size={12} />{manualError}</div>
            )}

            {manualList.length > 0 && (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                  {manualList.map((k, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 6px 4px 10px', borderRadius: 12, background: '#eaf1fb', color: '#1a3a6b' }}>
                      {k.text} <span style={{ opacity: 0.6, fontSize: 10 }}>· {MATCH_TYPES.find(m => m.value === k.matchType)?.label || k.matchType}</span>
                      <button onClick={() => removeManualRow(i)} style={{ display: 'flex', border: 'none', background: 'none', cursor: 'pointer', color: '#7391b8', padding: 2 }}><X size={11} /></button>
                    </span>
                  ))}
                </div>
                <button onClick={openManualPublish} style={{ ...btnPrimary, padding: '8px 18px', fontSize: 12.5 }}>
                  Proceed to Publish {manualList.length} keyword{manualList.length === 1 ? '' : 's'}
                </button>
              </>
            )}
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={14} color="#6a3fc0" /> AI Suggested Keywords
              </div>
              <button
                onClick={fetchAiRec} disabled={aiRecLoading || contextLoading}
                style={{ ...btnPrimary, opacity: (aiRecLoading || contextLoading) ? 0.5 : 1, cursor: (aiRecLoading || contextLoading) ? 'not-allowed' : 'pointer', padding: '7px 16px', fontSize: 12 }}
              >
                {aiRec ? '↻ Refresh Suggestions' : 'Get AI Suggestions'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 12 }}>Based on this ad group's existing keyword performance, real search terms that triggered its ads, and its existing negative keywords.</div>

            {aiRecLoading && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#888', padding: '14px 0' }}><Loader2 size={13} className="spin" /> Analyzing ad group performance, search terms, and existing keywords…</div>}
            {aiRecError && <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#c0392b', padding: '10px 14px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 7 }}><AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />{aiRecError}</div>}

            {aiRec && !aiRecLoading && (
              suggestions.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#555', padding: '10px 14px', background: '#f7f9fb', border: '1px solid #eef2f7', borderRadius: 7 }}>
                  <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1, color: '#888' }} />
                  {aiRec.noRecommendationsReason || 'No strong new keyword opportunities found for this ad group right now.'}
                </div>
              ) : (
                <>
                  {aiSelected.size > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                      <button onClick={openAiPublish} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: '#1a3a6b', color: '#fff', fontSize: 12, fontWeight: 600, borderRadius: 5, border: 'none', cursor: 'pointer' }}>
                        🚀 Proceed to Publish {aiSelected.size} selected
                      </button>
                    </div>
                  )}
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '7px 10px', width: 1 }}>
                            <input type="checkbox" onChange={toggleAiSelectAll}
                              checked={aiSelected.size > 0 && aiSelected.size === suggestions.filter((k) => !isBlocked(k.text, k.matchType, existingKeywords, negatives)).length} />
                          </th>
                          <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 11, color: '#888' }}>Keyword</th>
                          <th style={{ textAlign: 'center', padding: '7px 10px', fontSize: 11, color: '#888' }}>Match Type</th>
                          <th style={{ textAlign: 'center', padding: '7px 10px', fontSize: 11, color: '#888' }}>Lead Score</th>
                          <th style={{ textAlign: 'center', padding: '7px 10px', fontSize: 11, color: '#888' }}>Confidence</th>
                          <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 11, color: '#888' }}>Expected Benefit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suggestions.slice(pg.page * pg.pageSize, pg.page * pg.pageSize + pg.pageSize).map((k, vi) => {
                          const i = pg.page * pg.pageSize + vi
                          const blocked = isBlocked(k.text, k.matchType, existingKeywords, negatives)
                          return (
                            <tr key={i}>
                              <td style={{ padding: '7px 10px', borderTop: '1px solid #f0f4f8' }}>
                                {blocked ? (
                                  <span title={blocked} style={{ display: 'inline-flex', color: '#aaa' }}><CheckCircle size={14} /></span>
                                ) : (
                                  <input type="checkbox" checked={aiSelected.has(i)} onChange={() => toggleAiSelect(i)} />
                                )}
                              </td>
                              <td style={{ padding: '7px 10px', fontSize: 12, fontWeight: 500, color: '#1a3a6b', borderTop: '1px solid #f0f4f8', whiteSpace: 'nowrap' }}>{k.text}</td>
                              <td style={{ padding: '7px 10px', fontSize: 11.5, textAlign: 'center', borderTop: '1px solid #f0f4f8' }}>{k.matchType}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'center', borderTop: '1px solid #f0f4f8' }}><LeadScoreBadge value={k.leadPotentialScore} /></td>
                              <td style={{ padding: '7px 10px', textAlign: 'center', borderTop: '1px solid #f0f4f8' }}><LeadPotentialBadge value={k.confidence} /></td>
                              <td style={{ padding: '7px 10px', fontSize: 11, color: '#888', borderTop: '1px solid #f0f4f8', maxWidth: 380 }}><HighlightedText text={k.expectedBenefit} /></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <PaginationFooter page={pg.page} pageSize={pg.pageSize} total={suggestions.length}
                    onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
                </>
              )
            )}
          </div>
        </>
      )}

      {publishRows && selectedAccount && (
        <PublishKeywordModal
          rows={publishRows}
          selectedAccount={selectedAccount}
          onClose={closePublish}
          onSuccess={handlePublishSuccess}
        />
      )}
    </div>
  )
}
