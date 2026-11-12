import React, { useEffect, useState } from 'react'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Settings2, Search, X, Bot } from 'lucide-react'
import StatusBadge from '../../components/StatusBadge.jsx'
import CallLeadsBadge from '../../components/CallLeadsBadge.jsx'
import BreakdownCell from '../../components/BreakdownCell.jsx'
import { Spinner, CampaignAdGroupPicker, EmptyPickerHint, fmtNum, fmtUsd, fmtPct, fmtCostPerConv, qsColor, kwStatusColor, RecommendationBadge } from './shared.jsx'
import ManageKeywordModal from './ManageKeywordModal.jsx'
import BulkKeywordModal from './BulkKeywordModal.jsx'
import KeywordQsAnalysisModal from './KeywordQsAnalysisModal.jsx'

const COLS = [
  { key: 'text',            label: 'Keyword',        align: 'left'   },
  { key: 'matchType',       label: 'Match',          align: 'center' },
  { key: 'qualityScore',    label: 'Quality Score',  align: 'center' },
  { key: 'impressions',     label: 'Impr.',          align: 'right', fmt: fmtNum },
  { key: 'clicks',          label: 'Clicks',         align: 'right', fmt: fmtNum },
  { key: 'ctr',             label: 'CTR',            align: 'right', fmt: fmtPct },
  { key: 'cpc',             label: 'CPC',            align: 'right', fmt: fmtUsd },
  { key: 'costPerConv',     label: 'Cost / Conv',    align: 'right', fmt: (v, row) => fmtCostPerConv(row.cost, row.conversions) },
  { key: 'cost',            label: 'Cost',           align: 'right', fmt: fmtUsd },
  { key: 'conversions',     label: 'Conv.',          align: 'right', fmt: fmtNum },
  { key: 'formConversions', label: 'Form Conv.',     align: 'right',
    fmt: (v, row) => <BreakdownCell value={v} breakdown={row.formBreakdown} entityLabel={row.text}
      modalTitle="Form Conversions" buttonTitle="View form conversion breakdown" rowLabel="Conversion Action"/> },
  { key: 'phoneConversions',label: 'Phone Conv.',    align: 'right',
    fmt: (v, row) => <BreakdownCell value={v} breakdown={row.phoneBreakdown} entityLabel={row.text}
      modalTitle="Call Conversions" buttonTitle="View call conversion breakdown" rowLabel="Conversion Action"/> },
  { key: 'phoneCalls',      label: 'Call Leads',     align: 'center', fmt: (v, row) => <CallLeadsBadge count={v} campaignName={row.campaignName} /> },
  { key: 'recommendation',  label: 'Suggestion',     align: 'center' },
]

function SortIcon({ col, sortKey, sortAsc }) {
  if (sortKey !== col) return <ChevronUp size={11} style={{ opacity: 0.25 }} />
  return sortAsc ? <ChevronUp size={11} style={{ opacity: 0.9 }} /> : <ChevronDown size={11} style={{ opacity: 0.9 }} />
}

export default function ManageKeywordsTab({ selectedAccount, dateRange }) {
  const [campaignId, setCampaignId] = useState('')
  const [adGroupId,  setAdGroupId]  = useState('')
  const [keywords,   setKeywords]   = useState([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [sortKey,    setSortKey]    = useState('impressions')
  const [sortAsc,    setSortAsc]    = useState(false)
  const [managing,   setManaging]   = useState(null)
  const [analyzing,  setAnalyzing]  = useState(null)
  const [page,       setPage]       = useState(1)
  const [pageSize,   setPageSize]   = useState(25)
  const [search,     setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected,   setSelected]   = useState(new Set())
  const [bulkEditing, setBulkEditing] = useState(false)

  // Keyword column width is user-adjustable (drag the header edge) — without
  // it, a long keyword forces the whole table to scroll horizontally instead
  // of wrapping within a readable column width.
  const [kwColWidth, setKwColWidth] = useState(220)
  const kwDragRef = React.useRef(null)
  useEffect(() => {
    function onMove(e) {
      if (!kwDragRef.current) return
      setKwColWidth(Math.max(100, kwDragRef.current.startWidth + e.clientX - kwDragRef.current.startX))
    }
    function onUp() {
      if (!kwDragRef.current) return
      kwDragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])
  function startKwResize(e) {
    e.preventDefault(); e.stopPropagation()
    kwDragRef.current = { startX: e.clientX, startWidth: kwColWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function refresh() {
    if (!selectedAccount || !adGroupId) return
    setLoading(true); setError(null)
    window.electronAPI.keywordManagerList({ customerId: selectedAccount.id, adGroupId, dateRange })
      .then(data => setKeywords(data || []))
      .catch(err => setError(err.message || 'Failed to load keywords'))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [selectedAccount, adGroupId, dateRange])
  useEffect(() => { setSearch(''); setStatusFilter(''); setSelected(new Set()) }, [adGroupId])
  useEffect(() => { setPage(1) }, [adGroupId, sortKey, sortAsc, pageSize, search, statusFilter])

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  function toggleRow(resourceName) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(resourceName) ? next.delete(resourceName) : next.add(resourceName)
      return next
    })
  }

  const statusOptions = [...new Set(keywords.map(k => k.status).filter(Boolean))].sort()

  const searched = (search.trim()
    ? keywords.filter(k => k.text.toLowerCase().includes(search.trim().toLowerCase()))
    : keywords
  ).filter(k => !statusFilter || k.status === statusFilter)

  // costPerConv isn't a real field on the row — it's derived (cost/conversions,
  // undefined when there are no conversions), so it needs its own comparator
  // rather than falling through to the generic a[sortKey]/b[sortKey] path.
  const costPerConvOf = r => Number(r.conversions || 0) > 0 ? Number(r.cost || 0) / Number(r.conversions) : -1

  const rows = [...searched].sort((a, b) => {
    if (sortKey === 'costPerConv') {
      const va = costPerConvOf(a), vb = costPerConvOf(b)
      return sortAsc ? va - vb : vb - va
    }
    const va = a[sortKey], vb = b[sortKey]
    if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va)
    return sortAsc ? Number(va) - Number(vb) : Number(vb) - Number(va)
  })

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize)

  const pageAllSelected = pagedRows.length > 0 && pagedRows.every(r => selected.has(r.resourceName))
  function toggleSelectAllOnPage() {
    setSelected(prev => {
      const next = new Set(prev)
      if (pageAllSelected) pagedRows.forEach(r => next.delete(r.resourceName))
      else pagedRows.forEach(r => next.add(r.resourceName))
      return next
    })
  }
  const selectedKeywords = keywords.filter(k => selected.has(k.resourceName))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <CampaignAdGroupPicker
          selectedAccount={selectedAccount}
          campaignId={campaignId} adGroupId={adGroupId}
          onChangeCampaign={setCampaignId} onChangeAdGroup={setAdGroupId}
        />
      </div>

      {!adGroupId ? (
        <div className="card">
          <EmptyPickerHint>Select a campaign and ad group to see its keywords.</EmptyPickerHint>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="card-header">
            <span className="card-title">Keywords</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', border: '1px solid #dde9f5', borderRadius: 6, background: '#fff' }}>
                <Search size={12} style={{ color: '#aaa', flexShrink: 0 }} />
                <input
                  value={search} onChange={e => setSearch(e.target.value)} placeholder="Search keywords…"
                  style={{ border: 'none', outline: 'none', fontSize: 12, color: '#1a3a6b', background: 'transparent', width: 160 }}
                />
                {search && <button onClick={() => setSearch('')} style={{ display: 'flex', border: 'none', background: 'none', cursor: 'pointer', color: '#aaa', padding: 0 }}><X size={12} /></button>}
              </div>
              <select
                value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                style={{ fontSize: 12, padding: '5px 8px', border: '1px solid #dde9f5', borderRadius: 6, color: '#1a3a6b', background: '#fff' }}
              >
                <option value="">All Statuses</option>
                {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span style={{ fontSize: 11, color: '#888' }}>{rows.length} keyword{rows.length === 1 ? '' : 's'}{(search.trim() || statusFilter) ? ` of ${keywords.length}` : ''}</span>
            </div>
          </div>

          {selected.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: '#eef4fb', borderBottom: '1px solid #dde9f5' }}>
              <span style={{ fontSize: 12, color: '#1a3a6b', fontWeight: 600 }}>{selected.size} keyword{selected.size === 1 ? '' : 's'} selected</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => setBulkEditing(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer', border: 'none', background: '#1a3a6b', color: '#fff' }}
                >
                  <Settings2 size={12} /> Bulk Edit
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer', border: '1px solid #dde9f5', background: '#fff', color: '#555' }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {error && (
            <div style={{ margin: 12, padding: '10px 14px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 6, color: '#c0392b', fontSize: 12 }}>
              {error}
            </div>
          )}

          {loading ? (
            <Spinner label="Loading keywords…" />
          ) : rows.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
              {search.trim()
                ? `No keywords match "${search.trim()}".`
                : statusFilter
                  ? `No ${statusFilter.toLowerCase()} keywords found for this ad group.`
                  : 'No keywords found for this ad group.'}
            </div>
          ) : (
            <div style={{ overflow: 'auto', flex: 1, maxHeight: '62vh' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', top: 0, zIndex: 1, background: '#1a3a6b', padding: '9px 12px', width: 1 }}>
                      <input type="checkbox" checked={pageAllSelected} onChange={toggleSelectAllOnPage} />
                    </th>
                    {COLS.map(col => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        style={{ position: 'sticky', top: 0, zIndex: 1, background: '#1a3a6b', color: '#fff', padding: '9px 12px', fontSize: 11, fontWeight: 600, textAlign: col.align, letterSpacing: '0.3px', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
                          ...(col.key === 'text' ? { width: kwColWidth, minWidth: kwColWidth } : {}) }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          {col.label}
                          <SortIcon col={col.key} sortKey={sortKey} sortAsc={sortAsc} />
                        </span>
                        {col.key === 'text' && (
                          <span
                            onClick={e => e.stopPropagation()}
                            onMouseDown={startKwResize}
                            title="Drag to resize column"
                            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', display: 'inline-block' }}
                          />
                        )}
                      </th>
                    ))}
                    <th style={{ position: 'sticky', top: 0, zIndex: 1, background: '#1a3a6b', padding: '9px 12px', width: 1 }} />
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map(row => (
                    <tr key={row.resourceName} style={{ background: '#fff' }}>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f4f8' }}>
                        <input type="checkbox" checked={selected.has(row.resourceName)} onChange={() => toggleRow(row.resourceName)} />
                      </td>
                      {COLS.map(col => (
                        <td key={col.key} style={{ padding: '8px 12px', fontSize: 12, textAlign: col.align, borderBottom: '1px solid #f0f4f8',
                          whiteSpace: col.key === 'text' ? 'normal' : 'nowrap',
                          width: col.key === 'text' ? kwColWidth : undefined,
                          maxWidth: col.key === 'text' ? kwColWidth : undefined,
                          wordBreak: col.key === 'text' ? 'break-word' : undefined }}>
                          {col.key === 'text' ? (
                            <span style={{ color: kwStatusColor(row.status), fontWeight: 500 }}>{row.text}</span>
                          ) : col.key === 'matchType' ? (
                            <StatusBadge value={row.matchType} type="match" />
                          ) : col.key === 'qualityScore' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontWeight: 700, color: qsColor(row.qualityScore) }}>{row.qualityScore || '—'}</span>
                              <button
                                onClick={() => setAnalyzing(row)}
                                title="AI Quality Score analysis"
                                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, padding: 0, borderRadius: 5, border: '1px solid #dde9f5', background: '#fff', color: '#6a3fc0', cursor: 'pointer' }}
                              >
                                <Bot size={12} />
                              </button>
                            </span>
                          ) : col.key === 'recommendation' ? (
                            <RecommendationBadge value={row.recommendation} />
                          ) : (
                            col.fmt ? col.fmt(row[col.key], row) : row[col.key]
                          )}
                        </td>
                      ))}
                      <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f4f8', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => setManaging(row)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer', border: '1px solid #dde9f5', background: '#fff', color: '#1a3a6b' }}
                        >
                          <Settings2 size={12} /> Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && rows.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid #eef2f7', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#888' }}>
                Rows per page:
                <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} style={{ fontSize: 11, padding: '3px 6px', border: '1px solid #dde9f5', borderRadius: 5, color: '#1a3a6b' }}>
                  {[25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#888' }}>
                <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, rows.length)} of {rows.length}</span>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ display: 'flex', alignItems: 'center', border: '1px solid #dde9f5', background: '#fff', borderRadius: 5, padding: 4, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1 }}>
                  <ChevronLeft size={13} color="#1a3a6b" />
                </button>
                <span style={{ color: '#1a3a6b', fontWeight: 600 }}>Page {page} of {pageCount}</span>
                <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page >= pageCount} style={{ display: 'flex', alignItems: 'center', border: '1px solid #dde9f5', background: '#fff', borderRadius: 5, padding: 4, cursor: page >= pageCount ? 'not-allowed' : 'pointer', opacity: page >= pageCount ? 0.4 : 1 }}>
                  <ChevronRight size={13} color="#1a3a6b" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {bulkEditing && selectedKeywords.length > 0 && (
        <BulkKeywordModal
          keywords={selectedKeywords}
          selectedAccount={selectedAccount}
          onClose={() => setBulkEditing(false)}
          onSaved={() => { setBulkEditing(false); setSelected(new Set()); refresh() }}
        />
      )}

      {managing && (
        <ManageKeywordModal
          keyword={managing}
          selectedAccount={selectedAccount}
          onClose={() => setManaging(null)}
          onSaved={() => { setManaging(null); refresh() }}
        />
      )}

      {analyzing && (
        <KeywordQsAnalysisModal
          keyword={analyzing}
          selectedAccount={selectedAccount}
          onClose={() => setAnalyzing(null)}
        />
      )}
    </div>
  )
}
