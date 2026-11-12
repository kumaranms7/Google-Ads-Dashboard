import React, { useState, useMemo, useEffect, useRef } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, X } from 'lucide-react'
import StatusBadge from './StatusBadge.jsx'
import usePdfExportMode from '../hooks/usePdfExportMode.js'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250]

function SkeletonRow({ colCount }) {
  return (
    <tr>
      {Array.from({ length: colCount }, (_, i) => (
        <td key={i} style={{ padding:'9px 12px', borderBottom:'1px solid #f0f4f8' }}>
          <div className="skeleton" style={{ height:11, width: i===0?'70%':'50%', borderRadius:3 }} />
        </td>
      ))}
    </tr>
  )
}

function SortIcon({ colKey, sortKey, sortAsc }) {
  if (sortKey !== colKey) return <ChevronsUpDown size={11} style={{ opacity:0.3, marginLeft:2 }} />
  return sortAsc ? <ChevronUp size={11} style={{ opacity:0.9, marginLeft:2 }} /> : <ChevronDown size={11} style={{ opacity:0.9, marginLeft:2 }} />
}

function isPaused(row) {
  const s = row.status
  if (s == null) return false
  const v = typeof s === 'number' ? s : String(s).toUpperCase()
  return v === 'PAUSED' || v === '3' || v === 'Paused'
}

export default function ReportTable({
  columns         = [],
  data            = [],
  loading         = false,
  emptyMessage    = 'No data available for the selected period',
  hidePaused      = false,
  pagination      = true,    // show pagination controls automatically when rows > pageSize
  defaultPageSize = 25,      // initial rows-per-page
  noFilter        = false,   // hide the built-in text filter bar
  resizable       = false,   // enable drag-to-resize column headers
  // Opt-in row-selection column (checkbox per row + a header checkbox that
  // selects/deselects every row on the CURRENT page). Selection state is
  // owned by the caller — this just renders it and reports toggles — so it
  // survives sorting/filtering/pagination the same way the caller's own
  // "Remove Selected" action needs it to.
  selectable        = false,
  rowKey             = (row, i) => row.resourceName ?? i,
  selectedKeys       = null,          // Set of currently-selected keys
  onToggleRow        = () => {},      // (key, row) => void
  onToggleAllVisible = () => {},      // (visibleKeys, allSelected) => void
}) {
  const [sortKey,       setSortKey]       = useState(columns[0]?.key || '')
  const [sortAsc,       setSortAsc]       = useState(false)
  const [filterText,    setFilterText]    = useState('')
  const [appliedFilter, setAppliedFilter] = useState('')
  const [page,     setPage]     = useState(0)
  const [pageSize, setPageSize] = useState(defaultPageSize)
  // While a PDF export is capturing this table, show every row regardless
  // of the current page — see usePdfExportMode for why pagination can't
  // just be left alone and fixed via CSS.
  const pdfExportMode = usePdfExportMode()
  const effectivePagination = pagination && !pdfExportMode

  // ── Column resize state ───────────────────────────────────────────────────
  const [colWidths, setColWidths] = useState(() => {
    const w = {}
    columns.forEach(c => { if (c.width) w[c.key] = c.width })
    return w
  })
  const dragRef = useRef(null) // { key, startX, startWidth }

  useEffect(() => {
    if (!resizable) return
    function onMouseMove(e) {
      if (!dragRef.current) return
      const { key, startX, startWidth } = dragRef.current
      setColWidths(prev => ({ ...prev, [key]: Math.max(60, startWidth + e.clientX - startX) }))
    }
    function onMouseUp() {
      if (!dragRef.current) return
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup',   onMouseUp)
    }
  }, [resizable])

  function startResize(e, key, currentWidth) {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { key, startX: e.clientX, startWidth: currentWidth || 120 }
    document.body.style.cursor    = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // Debounce: only run the expensive filter 300 ms after the user stops typing
  useEffect(() => {
    const t = setTimeout(() => setAppliedFilter(filterText), 300)
    return () => clearTimeout(t)
  }, [filterText])

  // Reset to first page whenever filter / sort / data changes
  useEffect(() => { setPage(0) }, [appliedFilter, sortKey, sortAsc, pageSize])

  const handleSort = (key) => {
    if (!columns.find(c => c.key === key)?.sortable) return
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const sorted = useMemo(() => {
    let rows = data || []
    if (hidePaused) rows = rows.filter(r => !isPaused(r))
    if (appliedFilter.trim()) {
      const q = appliedFilter.trim().toLowerCase()
      rows = rows.filter(r =>
        Object.values(r).some(v =>
          v != null && typeof v !== 'object' && String(v).toLowerCase().includes(q)
        )
      )
    }
    if (!rows.length) return []
    // A column can supply sortValue(row) for fields that aren't a plain
    // row[key] — e.g. a cost-per-conversion column derived from cost/conversions.
    const sortCol = columns.find(c => c.key === sortKey)
    return [...rows].sort((a, b) => {
      const va = sortCol?.sortValue ? sortCol.sortValue(a) : a[sortKey]
      const vb = sortCol?.sortValue ? sortCol.sortValue(b) : b[sortKey]
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number') return sortAsc ? va-vb : vb-va
      return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    })
  }, [data, sortKey, sortAsc, hidePaused, appliedFilter, columns])

  // Rows to render — either all or the current page slice
  const totalPages  = effectivePagination ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1
  const visibleRows = effectivePagination ? sorted.slice(page * pageSize, (page + 1) * pageSize) : sorted
  const rangeStart  = effectivePagination ? page * pageSize + 1 : 1
  const rangeEnd    = effectivePagination ? Math.min((page + 1) * pageSize, sorted.length) : sorted.length

  const visibleKeys       = selectable ? visibleRows.map((r, i) => rowKey(r, i)) : []
  const allVisibleSelected = selectable && visibleKeys.length > 0 && visibleKeys.every(k => selectedKeys?.has(k))

  const totalCols = columns.length + 1 + (selectable ? 1 : 0) // +1 for S.No, +1 for the checkbox column

  function renderCell(row, col, ci) {
    const raw = row[col.key]
    if (col.badge)   return <StatusBadge value={raw} />
    if (col.format)  return col.format(raw, row)
    if (col.colorFn) return <span style={{ color: col.colorFn(raw, row), fontWeight:600 }}>{raw ?? '—'}</span>
    return raw ?? '—'
  }

  return (
    <div>
      {/* Filter bar */}
      {!noFilter && <div className="no-print" style={{ padding:'8px 12px', borderBottom:'1px solid #f0f4f8', display:'flex', alignItems:'center', gap:8, background:'#fafcff' }}>
        <Search size={13} style={{ color:'#aaa', flexShrink:0 }} />
        <input
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          placeholder="Filter rows…"
          style={{ flex:1, border:'none', outline:'none', fontSize:12, color:'#1a3a6b', background:'transparent' }}
        />
        {filterText && (
          <button onClick={() => { setFilterText(''); setAppliedFilter('') }}
            style={{ color:'#aaa', display:'flex', alignItems:'center', padding:'0 2px' }}>
            <X size={12} />
          </button>
        )}
        {appliedFilter && (
          <span style={{ fontSize:11, color:'#888', whiteSpace:'nowrap' }}>{sorted.length} result{sorted.length !== 1 ? 's' : ''}</span>
        )}
      </div>}

      <div style={{ overflow: pdfExportMode ? 'visible' : 'auto', maxHeight: pdfExportMode ? 'none' : '70vh' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr>
              {selectable && (
                <th style={{
                  background:'#1a3a6b', padding:'9px 10px', textAlign:'center', width:34,
                  position:'sticky', top:0, zIndex:2,
                }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={() => onToggleAllVisible(visibleKeys, allVisibleSelected)}
                    style={{ cursor:'pointer' }}
                  />
                </th>
              )}
              <th style={{
                background:'#1a3a6b', color:'#fff', padding:'9px 10px',
                fontSize:11, fontWeight:600, textAlign:'center', whiteSpace:'nowrap', width:42,
                position:'sticky', top:0, zIndex:2,
              }}>#</th>
              {columns.map((col, i) => {
                const thWidth = resizable ? (colWidths[col.key] || col.width) : col.width
                return (
                  <th key={col.key} onClick={() => handleSort(col.key)} style={{
                    background:'#1a3a6b', color:'#fff', padding:'9px 12px',
                    textAlign: col.align || (i===0 ? 'left' : 'right'),
                    fontWeight:600, fontSize:11, letterSpacing:'0.3px', whiteSpace:'nowrap',
                    cursor: col.sortable ? 'pointer' : 'default', userSelect:'none',
                    width: thWidth, minWidth: thWidth,
                    position:'sticky', top:0, zIndex:2,
                    ...(resizable ? { position:'relative' } : {}),
                  }}>
                    <span style={{ display:'inline-flex', alignItems:'center' }}>
                      {col.label}
                      {col.sortable && <SortIcon colKey={col.key} sortKey={sortKey} sortAsc={sortAsc} />}
                    </span>
                    {resizable && (
                      <div
                        onMouseDown={e => startResize(e, col.key, colWidths[col.key] || col.width || 120)}
                        style={{
                          position:'absolute', right:0, top:0, bottom:0, width:5,
                          cursor:'col-resize', zIndex:3,
                          background:'transparent',
                          borderRight:'2px solid rgba(255,255,255,0.25)',
                        }}
                        title="Drag to resize column"
                      />
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length:5 }, (_, i) => <SkeletonRow key={i} colCount={totalCols} />)
              : sorted.length === 0
                ? <tr><td colSpan={totalCols} style={{ padding:'28px 0', textAlign:'center', color:'#aaa' }}>{emptyMessage}</td></tr>
                : visibleRows.map((row, vi) => {
                    const ri = effectivePagination ? page * pageSize + vi : vi
                    const key = selectable ? rowKey(row, vi) : null
                    return (
                      <tr key={ri}
                        style={{ background: vi%2===0 ? '#fff' : '#f5f7fa' }}
                        onMouseEnter={e => { e.currentTarget.style.background='#edf3fb' }}
                        onMouseLeave={e => { e.currentTarget.style.background=vi%2===0?'#fff':'#f5f7fa' }}
                      >
                        {selectable && (
                          <td style={{ padding:'8px 10px', textAlign:'center', borderBottom:'1px solid #f0f4f8', width:34 }}>
                            <input
                              type="checkbox"
                              checked={!!selectedKeys?.has(key)}
                              onChange={() => onToggleRow(key, row)}
                              style={{ cursor:'pointer' }}
                            />
                          </td>
                        )}
                        <td style={{ padding:'8px 10px', textAlign:'center', borderBottom:'1px solid #f0f4f8', color:'#aaa', fontSize:11, width:42 }}>
                          {ri + 1}
                        </td>
                        {columns.map((col, ci) => {
                          const tdWidth = resizable ? (colWidths[col.key] || col.width) : (col.wrap ? col.width : undefined)
                          return (
                            <td key={col.key} style={{
                              padding:'8px 12px',
                              textAlign: col.align || (ci===0 ? 'left' : 'right'),
                              borderBottom:'1px solid #f0f4f8',
                              color: ci===0 ? '#1a3a6b' : '#4a4a4a',
                              fontWeight: ci===0 ? 500 : 400,
                              maxWidth: resizable ? tdWidth : (col.wrap ? tdWidth : (ci===0 ? 240 : undefined)),
                              width:    tdWidth,
                              overflow: col.wrap ? 'hidden' : 'hidden',
                              textOverflow: col.wrap ? undefined : 'ellipsis',
                              whiteSpace: col.wrap ? 'normal' : 'nowrap',
                              verticalAlign: 'middle',
                            }}>
                              {renderCell(row, col, ci)}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })
            }
          </tbody>
        </table>
      </div>

      {/* Pagination footer — rows-per-page always shown when data exists; nav only when multi-page */}
      {effectivePagination && !loading && sorted.length > 0 && (
        <div className="no-print" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderTop:'1px solid #f0f4f8', flexWrap:'wrap', gap:8, flexShrink:0 }}>

          {/* Rows per page selector */}
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:12, color:'#888' }}>Rows per page:</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
              style={{ padding:'4px 8px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer' }}
            >
              {PAGE_SIZE_OPTIONS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Page info + nav */}
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:12, color:'#888' }}>
              {rangeStart}–{rangeEnd} of {sorted.length}
            </span>
            {totalPages > 1 && (
              <div style={{ display:'flex', gap:4 }}>
                <button onClick={() => setPage(0)} disabled={page === 0}
                  title="First page"
                  style={{ padding:'4px 8px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background: page===0?'#f5f7fa':'#fff', color: page===0?'#aaa':'#1a3a6b', cursor: page===0?'not-allowed':'pointer' }}>
                  «
                </button>
                <button onClick={() => setPage(p => Math.max(0, p-1))} disabled={page === 0}
                  title="Previous page"
                  style={{ padding:'4px 10px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background: page===0?'#f5f7fa':'#fff', color: page===0?'#aaa':'#1a3a6b', cursor: page===0?'not-allowed':'pointer' }}>
                  ‹ Prev
                </button>
                <span style={{ padding:'4px 10px', fontSize:12, color:'#555', border:'1px solid #dde9f5', borderRadius:5, background:'#f5f7fa' }}>
                  {page + 1} / {totalPages}
                </span>
                <button onClick={() => setPage(p => Math.min(totalPages-1, p+1))} disabled={page >= totalPages-1}
                  title="Next page"
                  style={{ padding:'4px 10px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background: page>=totalPages-1?'#f5f7fa':'#fff', color: page>=totalPages-1?'#aaa':'#1a3a6b', cursor: page>=totalPages-1?'not-allowed':'pointer' }}>
                  Next ›
                </button>
                <button onClick={() => setPage(totalPages-1)} disabled={page >= totalPages-1}
                  title="Last page"
                  style={{ padding:'4px 8px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background: page>=totalPages-1?'#f5f7fa':'#fff', color: page>=totalPages-1?'#aaa':'#1a3a6b', cursor: page>=totalPages-1?'not-allowed':'pointer' }}>
                  »
                </button>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
