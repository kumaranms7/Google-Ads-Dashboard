import React, { useEffect, useState } from 'react'
import { Plus, X, Sparkles, Loader2, AlertCircle, CheckCircle, Info } from 'lucide-react'
import { selectStyle, inputStyle } from '../campaign-manager/shared.jsx'
import { btnPrimary } from '../campaign-manager/manage-panels/EditPanels.jsx'
import { Spinner, CampaignAdGroupPicker, EmptyPickerHint, usePagination, PaginationFooter, parseKeywordPasteText } from './shared.jsx'
import PublishNegativeKeywordsModal from '../../components/PublishNegativeKeywordsModal.jsx'

const MATCH_TYPES = { EXACT: 'Exact', PHRASE: 'Phrase', BROAD: 'Broad' }
const LEVEL_LABEL = { CAMPAIGN: 'Campaign', AD_GROUP: 'Ad Group', LIST: 'Negative Keyword List' }
const scoreColor = s => (s >= 70 ? '#c0392b' : s >= 40 ? '#a56700' : '#2e7d32')

function ScoreBadge({ value }) {
  return <span style={{ fontWeight: 700, fontSize: 12, color: scoreColor(value) }}>{value}</span>
}
function ConfidenceBadge({ value }) {
  const style = value === 'High' ? { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' } : value === 'Low' ? { bg: '#f5f5f5', text: '#4a4a4a', border: '#9e9e9e' } : { bg: '#fff3e0', text: '#a56700', border: '#f0b429' }
  return <span style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}`, borderRadius: 99, padding: '2px 9px', fontSize: 10.5, fontWeight: 600 }}>{value}</span>
}
function LevelTag({ value }) {
  return <span style={{ fontSize: 10.5, fontWeight: 600, color: '#555', background: '#eef2f7', borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap' }}>{LEVEL_LABEL[value] || value}</span>
}

export default function AddNegativeKeywordsTab({ selectedAccount, dateRange }) {
  const [campaignId, setCampaignId] = useState('')
  const [adGroupId,  setAdGroupId]  = useState('')
  const [campaignObj, setCampaignObj] = useState(null)
  const [adGroupObj,  setAdGroupObj]  = useState(null)

  const [contextLoading, setContextLoading] = useState(false)
  const [existingKeywords,      setExistingKeywords]      = useState([])
  const [campaignLevelNegatives, setCampaignLevelNegatives] = useState([])
  const [adGroupLevelNegatives,  setAdGroupLevelNegatives]  = useState([])
  const [negativeLists,          setNegativeLists]          = useState([])

  const [userContext, setUserContext] = useState('')

  const [aiRec,        setAiRec]        = useState(null) // { scenario, recommendations }
  const [aiRecLoading, setAiRecLoading] = useState(false)
  const [aiRecError,   setAiRecError]   = useState(null)
  const [aiSelected,   setAiSelected]   = useState(new Set()) // indices into highPriority

  const [manualText, setManualText] = useState('')
  const [manualMatchType, setManualMatchType] = useState('BROAD')
  const [manualRows, setManualRows] = useState([]) // [{ text, matchType }]
  const [bulkText, setBulkText] = useState('')

  const [publishRows,   setPublishRows]   = useState(null) // rows passed to the shared publish modal, or null when closed
  const [publishSource, setPublishSource] = useState(null) // 'ai' | 'manual'

  const pg = usePagination(25)

  function handleChangeCampaign(id, obj) { setCampaignId(id); setCampaignObj(obj); setAiRec(null); setAiSelected(new Set()) }
  function handleChangeAdGroup(id, obj)  { setAdGroupId(id); setAdGroupObj(obj); setAiRec(null); setAiSelected(new Set()) }

  function refreshContext() {
    if (!selectedAccount || !campaignId || !adGroupId) return
    setContextLoading(true)
    Promise.all([
      window.electronAPI.keywordManagerList({ customerId: selectedAccount.id, adGroupId, dateRange }),
      window.electronAPI.fetchCampaignLevelNegatives({ customerId: selectedAccount.id, campaignId }),
      window.electronAPI.fetchAdGroupLevelNegatives({ customerId: selectedAccount.id, adGroupId }),
      window.electronAPI.fetchNegativeListsForCampaign({ customerId: selectedAccount.id, campaignId }),
    ])
      .then(([kws, campNegs, agNegs, lists]) => {
        setExistingKeywords(kws || [])
        setCampaignLevelNegatives(campNegs || [])
        setAdGroupLevelNegatives(agNegs || [])
        setNegativeLists(lists || [])
      })
      .catch(() => { setExistingKeywords([]); setCampaignLevelNegatives([]); setAdGroupLevelNegatives([]); setNegativeLists([]) })
      .finally(() => setContextLoading(false))
  }

  useEffect(refreshContext, [selectedAccount, campaignId, adGroupId, dateRange])

  function fetchAiRec() {
    setAiRecLoading(true); setAiRecError(null); setAiSelected(new Set()); pg.setPage(0)
    window.electronAPI.keywordManagerListSearchTerms({ customerId: selectedAccount.id, adGroupId, dateRange })
      .then(searchTerms => window.electronAPI.keywordManagerAiRecommendNegativeKeywords({
        campaignName: campaignObj?.name, adGroupName: adGroupObj?.name,
        existingKeywords, searchTerms,
        campaignLevelNegatives, adGroupLevelNegatives, negativeLists,
        userContext,
      }))
      .then(setAiRec)
      .catch(err => setAiRecError(err.message || 'Failed to get AI recommendations'))
      .finally(() => setAiRecLoading(false))
  }

  const highPriority = (aiRec?.recommendations || []).filter(r => r.recommendation === 'Add')

  function toggleAiSelect(i) {
    setAiSelected(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  }
  function toggleAiSelectAll() {
    const selectable = highPriority.map((r, i) => i).filter(i => !highPriority[i].existingNegativeConflict)
    setAiSelected(s => s.size === selectable.length ? new Set() : new Set(selectable))
  }

  function addManualRow() {
    const text = manualText.trim()
    if (!text) return
    const key = `${text.toLowerCase()}|${manualMatchType}`
    if (manualRows.some(r => `${r.text.toLowerCase()}|${r.matchType}` === key)) { setManualText(''); return }
    setManualRows(prev => [...prev, { text, matchType: manualMatchType }])
    setManualText('')
  }
  function removeManualRow(i) { setManualRows(rows => rows.filter((_, idx) => idx !== i)) }

  // Bulk-paste — one negative keyword per line, Google Ads Editor match-type
  // syntax ([exact], "phrase", plain = broad). Skips anything already in the
  // list (no isBlocked check exists for manual negatives — same as single-add).
  function addBulkRows() {
    const parsed = parseKeywordPasteText(bulkText)
    if (parsed.length === 0) return
    setManualRows(prev => {
      const next = [...prev]
      const seen = new Set(next.map(r => `${r.text.toLowerCase()}|${r.matchType}`))
      for (const { text, matchType } of parsed) {
        const key = `${text.toLowerCase()}|${matchType}`
        if (seen.has(key)) continue
        seen.add(key)
        next.push({ text, matchType })
      }
      return next
    })
    setBulkText('')
  }

  function openAiPublish() {
    const rows = [...aiSelected].map(i => highPriority[i]).filter(Boolean)
      .map(r => ({ term: r.text, recommendedMatchType: r.matchType }))
    if (rows.length === 0) return
    setPublishRows(rows); setPublishSource('ai')
  }
  function openManualPublish() {
    if (manualRows.length === 0) return
    setPublishRows(manualRows.map(r => ({ term: r.text, recommendedMatchType: r.matchType })))
    setPublishSource('manual')
  }
  function closePublish() { setPublishRows(null); setPublishSource(null) }
  function handlePublishSuccess() {
    if (publishSource === 'ai') setAiSelected(new Set())
    if (publishSource === 'manual') setManualRows([])
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
        <div className="card"><EmptyPickerHint>Select a campaign and ad group to get negative keyword recommendations.</EmptyPickerHint></div>
      ) : (
        <>
          <div className="card" style={{ padding: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Business Context / Exclusions <span style={{ fontWeight: 400, color: '#aaa', textTransform: 'none' }}>(optional)</span></div>
            <textarea
              value={userContext} onChange={e => setUserContext(e.target.value)}
              placeholder="e.g. We only offer commercial roofing, not residential. No DIY or wholesale customers. Service area is Miami-Dade only."
              rows={2}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #dde9f5', borderRadius: 6, fontSize: 12.5, color: '#1a3a6b', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ fontSize: 10.5, color: '#aaa', marginTop: 4 }}>Especially useful for a new ad group with little or no search history yet — helps the AI apply a conservative pre-launch strategy.</div>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Manually Add Negative Keywords</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <input
                value={manualText} onChange={e => setManualText(e.target.value)} placeholder="Type a negative keyword…"
                style={{ ...inputStyle, flex: 1, minWidth: 200, maxWidth: 320 }} onKeyDown={e => { if (e.key === 'Enter') addManualRow() }}
              />
              <select value={manualMatchType} onChange={e => setManualMatchType(e.target.value)} style={{ ...selectStyle, width: 110 }}>
                {Object.entries(MATCH_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
                  placeholder={'wholesale\n"free plumber"\n[plumbing jobs]'}
                  rows={3}
                  style={{ flex: 1, minWidth: 240, maxWidth: 420, padding: '8px 10px', border: '1px solid #dde9f5', borderRadius: 6, fontSize: 12.5, color: '#1a3a6b', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                />
                <button onClick={addBulkRows} disabled={!bulkText.trim()}
                  style={{ ...btnPrimary, padding: '8px 16px', fontSize: 12, opacity: bulkText.trim() ? 1 : 0.5, cursor: bulkText.trim() ? 'pointer' : 'not-allowed' }}>
                  Add All
                </button>
              </div>
            </div>

            {manualRows.length > 0 && (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                  {manualRows.map((r, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 6px 4px 10px', borderRadius: 12, background: '#eaf1fb', color: '#1a3a6b' }}>
                      {r.text} <span style={{ opacity: 0.6, fontSize: 10 }}>· {MATCH_TYPES[r.matchType] || r.matchType}</span>
                      <button onClick={() => removeManualRow(i)} style={{ display: 'flex', border: 'none', background: 'none', cursor: 'pointer', color: '#7391b8', padding: 2 }}><X size={11} /></button>
                    </span>
                  ))}
                </div>
                <button onClick={openManualPublish} style={{ ...btnPrimary, padding: '8px 18px', fontSize: 12.5 }}>
                  Proceed to Publish {manualRows.length} negative keyword{manualRows.length === 1 ? '' : 's'}
                </button>
              </>
            )}
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={14} color="#6a3fc0" /> AI Negative Keyword Suggestions
              </div>
              <button
                onClick={fetchAiRec} disabled={aiRecLoading || contextLoading}
                style={{ ...btnPrimary, opacity: (aiRecLoading || contextLoading) ? 0.5 : 1, cursor: (aiRecLoading || contextLoading) ? 'not-allowed' : 'pointer', padding: '7px 16px', fontSize: 12 }}
              >
                {aiRec ? '↻ Refresh Suggestions' : 'Get AI Suggestions'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 12 }}>
              Analyzes this ad group's search terms, keyword performance, and existing negatives (campaign, ad group, and list level) — or, if there's no history yet, falls back to a conservative pre-launch strategy based on the campaign/ad group context.
            </div>

            {aiRecLoading && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#888', padding: '14px 0' }}><Loader2 size={13} className="spin" /> Analyzing search terms, keyword performance, and existing negatives…</div>}
            {aiRecError && <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#c0392b', padding: '10px 14px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 7 }}><AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />{aiRecError}</div>}

            {aiRec && !aiRecLoading && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#3a5a80', background: '#eef4fc', border: '1px solid #dde9f5', borderRadius: 6, padding: '6px 10px', marginBottom: 12 }}>
                  <Info size={12} style={{ flexShrink: 0 }} />
                  {aiRec.scenario === 'NEW'
                    ? 'This ad group has little or no performance history — suggestions use a conservative pre-launch strategy based on business/campaign context.'
                    : 'Suggestions are grounded in this ad group\'s real search-term and keyword performance history.'}
                </div>

                {highPriority.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#aaa', padding: '14px 0' }}>No high-priority negative keyword recommendations — nothing clearly irrelevant was found.</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#c0392b' }}>High Priority ({highPriority.length})</div>
                      {aiSelected.size > 0 && (
                        <button onClick={openAiPublish} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: '#1a3a6b', color: '#fff', fontSize: 12, fontWeight: 600, borderRadius: 5, border: 'none', cursor: 'pointer' }}>
                          🚀 Proceed to Publish {aiSelected.size} selected
                        </button>
                      )}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ padding: '7px 10px', width: 1 }}>
                              <input type="checkbox" onChange={toggleAiSelectAll}
                                checked={aiSelected.size > 0 && aiSelected.size === highPriority.filter(r => !r.existingNegativeConflict).length} />
                            </th>
                            <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 11, color: '#888' }}>Keyword</th>
                            <th style={{ textAlign: 'center', padding: '7px 10px', fontSize: 11, color: '#888' }}>Match</th>
                            <th style={{ textAlign: 'center', padding: '7px 10px', fontSize: 11, color: '#888' }}>Level</th>
                            <th style={{ textAlign: 'center', padding: '7px 10px', fontSize: 11, color: '#888' }}>Score</th>
                            <th style={{ textAlign: 'center', padding: '7px 10px', fontSize: 11, color: '#888' }}>Confidence</th>
                            <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 11, color: '#888' }}>Reason</th>
                            <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 11, color: '#888' }}>Expected Impact</th>
                          </tr>
                        </thead>
                        <tbody>
                          {highPriority.slice(pg.page * pg.pageSize, pg.page * pg.pageSize + pg.pageSize).map((r, vi) => {
                            const i = pg.page * pg.pageSize + vi
                            return (
                            <tr key={i}>
                              <td style={{ padding: '7px 10px', borderTop: '1px solid #f0f4f8' }}>
                                {r.existingNegativeConflict ? (
                                  <span title="Already covered by an existing negative keyword" style={{ display: 'inline-flex', color: '#aaa' }}><CheckCircle size={14} /></span>
                                ) : (
                                  <input type="checkbox" checked={aiSelected.has(i)} onChange={() => toggleAiSelect(i)} />
                                )}
                              </td>
                              <td style={{ padding: '7px 10px', fontSize: 12, fontWeight: 500, color: '#1a3a6b', borderTop: '1px solid #f0f4f8', whiteSpace: 'nowrap' }}>{r.text}</td>
                              <td style={{ padding: '7px 10px', fontSize: 11.5, textAlign: 'center', borderTop: '1px solid #f0f4f8' }}>{MATCH_TYPES[r.matchType] || r.matchType}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'center', borderTop: '1px solid #f0f4f8' }}><LevelTag value={r.level} /></td>
                              <td style={{ padding: '7px 10px', textAlign: 'center', borderTop: '1px solid #f0f4f8' }}><ScoreBadge value={r.negativePotentialScore} /></td>
                              <td style={{ padding: '7px 10px', textAlign: 'center', borderTop: '1px solid #f0f4f8' }}><ConfidenceBadge value={r.confidence} /></td>
                              <td style={{ padding: '7px 10px', fontSize: 11, color: '#888', borderTop: '1px solid #f0f4f8', maxWidth: 260 }}>{r.reason}</td>
                              <td style={{ padding: '7px 10px', fontSize: 11, color: '#888', borderTop: '1px solid #f0f4f8', maxWidth: 220 }}>{r.expectedImpact}</td>
                            </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <PaginationFooter page={pg.page} pageSize={pg.pageSize} total={highPriority.length}
                      onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}

      {publishRows && selectedAccount && (
        <PublishNegativeKeywordsModal
          rows={publishRows}
          selectedAccount={selectedAccount}
          onClose={closePublish}
          onSuccess={handlePublishSuccess}
        />
      )}
    </div>
  )
}
