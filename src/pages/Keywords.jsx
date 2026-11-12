import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, AlertCircle, AlertTriangle, Loader2, Phone, Check, Copy, X, RefreshCw, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import ExportButton          from '../components/ExportButton.jsx'
import ExportPdfButton       from '../components/ExportPdfButton.jsx'
import usePdfExportMode      from '../hooks/usePdfExportMode.js'
import StatusBadge           from '../components/StatusBadge.jsx'
import CallLeadsBadge        from '../components/CallLeadsBadge.jsx'
import BreakdownCell         from '../components/BreakdownCell.jsx'
import ReportTable           from '../components/ReportTable.jsx'
import PublishKeywordModal   from '../components/PublishKeywordModal.jsx'
import SearchTermPublishModal from '../components/SearchTermPublishModal.jsx'
import {
  normalizeKw, buildKwMap, buildNegMaps, resolveKwSignal, buildOptimisticPublishRecords,
  KwSignalBadge, KeywordRowAction, KwSignalModal,
} from '../components/KwSignal.jsx'
import { resolveEnum, MATCH_TYPE, SEARCH_TERM_STATUS } from '../utils/enumMaps.js'
import { highlightRecommendation } from '../utils/highlightRecommendation.jsx'
import { sortByStatus } from './campaign-manager/shared.jsx'
import { useReviewFlow, ReviewModal } from './campaign-manager/manage-panels/EditPanels.jsx'

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtNum  = v => Number(v||0).toLocaleString()
const fmtUsd  = v => '$' + Number(v||0).toFixed(2)
const fmtPct  = v => Number(v||0).toFixed(2) + '%'
const fmtCostPerConv = (cost, conversions) => Number(conversions||0) > 0 ? fmtUsd(Number(cost||0) / Number(conversions)) : '-'
const qsColor = s => s>=7?'#4caf50':s>=4?'#f0b429':'#e05c2a'

function Section({ title, extra, children }) {
  return (
    <div className="card" style={{ marginBottom:24 }}>
      <div className="card-header"><span className="card-title">{title}</span>{extra}</div>
      {children}
    </div>
  )
}

function QsDots({ score }) {
  return (
    <div style={{ display:'flex', gap:3, alignItems:'center' }}>
      {Array.from({length:10},(_,i)=>(
        <span key={i} style={{ width:10, height:10, borderRadius:'50%', display:'inline-block', background:i<score?'#2563b0':'#dde9f5', border:i<score?'none':'1px solid #c8d9ed' }}/>
      ))}
    </div>
  )
}

function NoAccount() {
  return (
    <div style={{ padding:80, textAlign:'center', color:'#aaa' }}>
      <Search size={36} style={{ opacity:0.2, marginBottom:10 }}/>
      <div style={{ fontWeight:500, marginBottom:4 }}>Select an account to view keyword data</div>
      <div style={{ fontSize:12 }}>Choose an account from the sidebar to get started</div>
    </div>
  )
}

function Skeleton({ rows=6 }) {
  return (
    <div style={{ padding:'8px 0' }}>
      {Array.from({length:rows},(_,i)=>(
        <div key={i} style={{ padding:'8px 14px', display:'flex', gap:12 }}>
          <div className="skeleton" style={{ flex:2, height:11 }}/>
          <div className="skeleton" style={{ flex:1, height:11 }}/>
          <div className="skeleton" style={{ flex:1, height:11 }}/>
        </div>
      ))}
    </div>
  )
}

// ── Keyword table ─────────────────────────────────────────────────────────────
const KW_PAGE_SIZES = [10, 25, 50, 100]

function KwTable({ rows, loading, hidePaused, onDrillDown }) {
  const [sort,     setSort]     = useState('impressions')
  const [asc,      setAsc]      = useState(false)
  const [hover,    setHover]    = useState(null)
  const [page,     setPage]     = useState(0)
  const [pageSize, setPageSize] = useState(25)
  // Show every row during a PDF export instead of just the current page —
  // see usePdfExportMode.
  const pdfExportMode = usePdfExportMode()

  // Keyword column width is user-adjustable (drag the header edge) instead of
  // fixed — the column used to hard-truncate to 200px with an ellipsis, which
  // cut off longer keywords entirely with no way to see the rest.
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

  useEffect(() => { setPage(0) }, [sort, asc])

  // costPerConv isn't a real field on the row — it's derived (cost/conversions,
  // -1 when there are no conversions so those sort to the bottom ascending).
  const costPerConvOf = r => Number(r.conversions||0) > 0 ? Number(r.cost||0) / Number(r.conversions) : -1

  const sorted = useMemo(() => {
    let r = rows || []
    if (hidePaused) r = r.filter(k => !['PAUSED','Paused','3'].includes(String(k.status||'')))
    return [...r].sort((a,b) => {
      if (sort === 'costPerConv') { const va=costPerConvOf(a), vb=costPerConvOf(b); return asc?va-vb:vb-va }
      const va=a[sort],vb=b[sort]
      if (typeof va==='number') return asc?va-vb:vb-va
      return asc?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va))
    })
  }, [rows, sort, asc, hidePaused])

  const COLS = [
    {key:'text',            lbl:'Keyword',       fmt:(v,row)=><span style={{color:kwStatusColor(row.status||''),fontWeight:500}}>{v}</span>},
    {key:'matchType',       lbl:'Match',         fmt:v=><StatusBadge value={v} type="match"/>},
    {key:'campaign',        lbl:'Campaign',      fmt:(v,row)=><span style={{color:kwStatusColor(row.campaignStatus||''),fontWeight:500}}>{v}</span>},
    {key:'adGroup',         lbl:'Ad Group',      fmt:(v,row)=><span style={{color:kwStatusColor(row.adGroupStatus||''),fontWeight:500}}>{v||'—'}</span>},
    {key:'qualityScore',    lbl:'Quality Score', fmt:v=><span style={{fontSize:12,fontWeight:700,color:qsColor(v)}}>{v||'—'}</span>},
    {key:'impressions',     lbl:'Impr.',         fmt:fmtNum},
    {key:'clicks',          lbl:'Clicks',        fmt:fmtNum},
    {key:'ctr',             lbl:'CTR',           fmt:fmtPct},
    {key:'cpc',             lbl:'CPC',           fmt:fmtUsd},
    {key:'costPerConv',     lbl:'Cost / Conv',   fmt:(v,row)=>fmtCostPerConv(row.cost,row.conversions)},
    {key:'cost',            lbl:'Cost',          fmt:v=>'$'+Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})},
    {key:'conversions',     lbl:'Conv.',         fmt:fmtNum},
    {key:'formConversions', lbl:'Form Conv.',    fmt:(v,row)=><BreakdownCell value={v} breakdown={row.formBreakdown} entityLabel={row.text}
      modalTitle="Form Conversions" buttonTitle="View form conversion breakdown" rowLabel="Conversion Action"/>},
    {key:'phoneConversions',lbl:'Phone Conv.',   fmt:(v,row)=><BreakdownCell value={v} breakdown={row.phoneBreakdown} entityLabel={row.text}
      modalTitle="Call Conversions" buttonTitle="View call conversion breakdown" rowLabel="Conversion Action"/>},
    {key:'phoneCalls',      lbl:'Call Leads',    fmt:(v,row)=><CallLeadsBadge count={v} campaignName={row.campaign} onDrillDown={onDrillDown}/>},
  ]

  const thStyle = key => ({
    background:'#1a3a6b',color:'#fff',padding:'9px 11px',fontSize:11,fontWeight:600,
    textAlign:['text','campaign','adGroup','matchType'].includes(key)?'left':'center',
    cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',letterSpacing:'0.3px',
    position:'sticky', top:0, zIndex:2,
  })

  const totalPages  = Math.max(1, Math.ceil(sorted.length / pageSize))
  const pageRows    = pdfExportMode ? sorted : sorted.slice(page * pageSize, (page + 1) * pageSize)
  const rangeStart  = page * pageSize + 1
  const rangeEnd    = Math.min((page + 1) * pageSize, sorted.length)

  return (
    <div>
      <div style={{ overflow: pdfExportMode ? 'visible' : 'auto', maxHeight: pdfExportMode ? 'none' : '70vh' }}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr>{COLS.map(c=>(
            <th key={c.key} onClick={()=>{if(sort===c.key)setAsc(a=>!a);else{setSort(c.key);setAsc(false)}}}
              style={{...thStyle(c.key), ...(c.key==='text'?{width:kwColWidth, minWidth:kwColWidth, position:'sticky'}:{})}}>
              {c.lbl}{sort===c.key?(asc?' ▲':' ▼'):''}
              {c.key==='text' && (
                <span
                  onClick={e=>e.stopPropagation()}
                  onMouseDown={startKwResize}
                  title="Drag to resize column"
                  style={{position:'absolute', right:0, top:0, bottom:0, width:6, cursor:'col-resize', display:'inline-block'}}
                />
              )}
            </th>
          ))}</tr></thead>
          <tbody>
            {loading
              ? Array.from({length:8},(_,i)=><tr key={i}><td colSpan={COLS.length} style={{padding:'8px 11px',borderBottom:'1px solid #f0f4f8'}}><div className="skeleton" style={{height:11,width:'60%'}}/></td></tr>)
              : sorted.length===0
                ? <tr><td colSpan={COLS.length} style={{padding:'28px 0',textAlign:'center',color:'#aaa'}}>No keywords found</td></tr>
                : pageRows.map((row,vi)=>(
                  <tr key={vi} style={{background:hover===vi?'#edf3fb':vi%2===0?'#fff':'#f5f7fa',transition:'background 0.1s'}} onMouseEnter={()=>setHover(vi)} onMouseLeave={()=>setHover(null)}>
                    {COLS.map((c,ci)=>(
                      <td key={c.key} style={{padding:'8px 11px',borderBottom:'1px solid #f0f4f8',textAlign:['text','campaign','adGroup'].includes(c.key)?'left':'center',color:c.key==='text'?'#1a3a6b':'#4a4a4a',fontWeight:c.key==='text'?500:400,
                        width:c.key==='text'?kwColWidth:undefined, maxWidth:c.key==='text'?kwColWidth:undefined,
                        overflow:c.key==='text'?'visible':'hidden', textOverflow:c.key==='text'?undefined:'ellipsis',
                        whiteSpace:c.key==='text'?'normal':'nowrap', wordBreak:c.key==='text'?'break-word':undefined}}>
                        {c.fmt?c.fmt(row[c.key],row):(row[c.key]??'—')}
                      </td>
                    ))}
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>
      {!loading && !pdfExportMode && totalPages > 1 && (
        <div className="no-print" style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderTop:'1px solid #f0f4f8',flexWrap:'wrap',gap:8}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:12,color:'#888'}}>Rows per page:</span>
            <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(0)}} style={{padding:'4px 8px',border:'1px solid #dde9f5',borderRadius:5,fontSize:12,color:'#1a3a6b',outline:'none',cursor:'pointer'}}>
              {KW_PAGE_SIZES.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:12,color:'#888'}}>{rangeStart}–{rangeEnd} of {sorted.length}</span>
            <div style={{display:'flex',gap:4}}>
              <button onClick={()=>setPage(0)} disabled={page===0} style={{padding:'4px 8px',fontSize:12,fontWeight:600,border:'1px solid #dde9f5',borderRadius:5,background:page===0?'#f5f7fa':'#fff',color:page===0?'#aaa':'#1a3a6b',cursor:page===0?'not-allowed':'pointer'}}>«</button>
              <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0} style={{padding:'4px 10px',fontSize:12,fontWeight:600,border:'1px solid #dde9f5',borderRadius:5,background:page===0?'#f5f7fa':'#fff',color:page===0?'#aaa':'#1a3a6b',cursor:page===0?'not-allowed':'pointer'}}>‹ Prev</button>
              <span style={{padding:'4px 10px',fontSize:12,color:'#555',border:'1px solid #dde9f5',borderRadius:5,background:'#f5f7fa'}}>{page+1} / {totalPages}</span>
              <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1} style={{padding:'4px 10px',fontSize:12,fontWeight:600,border:'1px solid #dde9f5',borderRadius:5,background:page>=totalPages-1?'#f5f7fa':'#fff',color:page>=totalPages-1?'#aaa':'#1a3a6b',cursor:page>=totalPages-1?'not-allowed':'pointer'}}>Next ›</button>
              <button onClick={()=>setPage(totalPages-1)} disabled={page>=totalPages-1} style={{padding:'4px 8px',fontSize:12,fontWeight:600,border:'1px solid #dde9f5',borderRadius:5,background:page>=totalPages-1?'#f5f7fa':'#fff',color:page>=totalPages-1?'#aaa':'#1a3a6b',cursor:page>=totalPages-1?'not-allowed':'pointer'}}>»</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Overspending AI recommendation ───────────────────────────────────────────
function wsAIRec(row) {
  const { cost, clicks, impressions, ctr, cpc, qualityScore, matchType, text } = row
  const kw = `"${text}"`

  if (qualityScore > 0 && qualityScore <= 3)
    return `Quality Score ${qualityScore}/10 signals poor relevance. Add ${kw} to your ad headline and align the landing page content to this keyword's intent — this will lower CPC and improve ad rank.`

  if (impressions >= 100 && clicks === 0)
    return `${Number(impressions).toLocaleString()} impressions, zero clicks — your ad copy isn't matching search intent. Rewrite the headline to directly address ${kw}, or add it as a negative keyword to stop the spend.`

  if (impressions >= 50 && ctr < 0.8)
    return `CTR of ${fmtPct(ctr)} is too low to convert profitably. Move ${kw} into its own ad group with a dedicated headline, or switch to Exact Match to filter irrelevant triggers.`

  if (['Broad', 'BROAD'].includes(matchType) && cost >= 15)
    return `Broad Match is likely triggering unrelated searches for ${kw}. Pull the Search Terms report, add irrelevant queries as negatives, then switch to Phrase or Exact Match.`

  if (cpc >= 8 && clicks <= 5)
    return `CPC of ${fmtUsd(cpc)} is high for a non-converting keyword. Reduce max bid by 25–30% or apply a Target CPA cap to cut wasteful spend while keeping visibility.`

  if (cost >= 25)
    return `Pause ${kw} for 2 weeks, analyze the Search Terms report for intent mismatches, then re-enable with tighter match type or additional negative keywords.`

  return `Low spend — monitor. If ${kw} reaches ${fmtUsd(cost * 3)} without a conversion, pause it or move it to a tightly themed ad group with dedicated ad copy.`
}

// ── Wasted spend section ──────────────────────────────────────────────────────
function WastedSpendSection({ selectedAccount, dateRange }) {
  const [data,           setData]           = useState(null)
  const [loading,        setLoading]        = useState(false)
  const [threshold,      setThreshold]      = useState(10)
  const [wsCampFilter,   setWsCampFilter]   = useState('')
  const [wsCampStatus,   setWsCampStatus]   = useState('Enabled')
  const [wsKwStatus,     setWsKwStatus]     = useState('')

  const load = useCallback(async () => {
    if (!selectedAccount) return
    setLoading(true)
    try {
      const result = await window.electronAPI.fetchWastedSpend({
        customerId:     selectedAccount.id,
        dateRange,
        thresholdMicros: Math.round(threshold * 1_000_000),
      })
      setData(result)
    } catch {}
    finally { setLoading(false) }
  }, [selectedAccount, dateRange, threshold])

  useEffect(() => { const t = setTimeout(load, 500); return () => clearTimeout(t) }, [load])

  const wsFiltered = useMemo(() => {
    let r = data || []
    if (wsCampFilter)  r = r.filter(row => row.campaign       === wsCampFilter)
    if (wsCampStatus)  r = r.filter(row => row.campaignStatus === wsCampStatus)
    if (wsKwStatus)    r = r.filter(row => row.status         === wsKwStatus)
    return r
  }, [data, wsCampFilter, wsCampStatus, wsKwStatus])

  const totalWasted = wsFiltered.reduce((s,r)=>s+r.cost,0)

  const cols = [
    {key:'text',             label:'Keyword',       sortable:true, align:'left',   width:200, format:(v,row)=><span style={{color:kwStatusColor(row.status||''),fontWeight:500}}>{v}</span>},
    {key:'matchType',        label:'Match',         sortable:true, align:'center', format:v=><StatusBadge value={v} type="match"/>},
    {key:'campaign',         label:'Campaign / Ad Group', sortable:true, align:'left', width:200,
      format:(v,row)=>(
        <span style={{display:'block'}}>
          <span style={{color:kwStatusColor(row.campaignStatus||''),fontWeight:500,display:'block'}}>{v}</span>
          <span style={{color:'#888',fontSize:11,display:'block'}}>{row.adGroup}</span>
        </span>
      )},
    {key:'qualityScore',     label:'Quality Score', sortable:true, align:'center', format:v=><span style={{fontSize:12,fontWeight:700,color:qsColor(v)}}>{v||'—'}</span>},
    {key:'impressions',      label:'Impr.',         sortable:true, align:'right',  format:fmtNum},
    {key:'clicks',           label:'Clicks',        sortable:true, align:'right',  format:fmtNum},
    {key:'ctr',              label:'CTR',           sortable:true, align:'right',  format:fmtPct},
    {key:'cpc',              label:'CPC',           sortable:true, align:'right',  format:fmtUsd},
    {key:'costPerConv',      label:'Cost / Conv',   sortable:true, align:'right',  format:(v,row)=>fmtCostPerConv(row.cost,row.conversions), sortValue:row=>Number(row.conversions||0)>0?Number(row.cost||0)/Number(row.conversions):-1},
    {key:'cost',             label:'Cost',          sortable:true, align:'right',  format:v=><span style={{color:'#e05c2a',fontWeight:600}}>{fmtUsd(v)}</span>},
    {key:'conversions',      label:'Conv.',         sortable:true, align:'right',  format:fmtNum},
    {key:'formConversions',  label:'Form Conv.',    sortable:true, align:'right',  format:fmtNum},
    {key:'phoneConversions', label:'Phone Conv.',   sortable:true, align:'right',  format:fmtNum},
    {key:'phoneCalls',       label:'Call Leads',    sortable:false, align:'center', format:(v,row)=><CallLeadsBadge count={v} campaignName={row.campaign}/>},
    {key:'_aiRec',           label:'AI Suggestion', sortable:false, align:'left',
      format:(_,row)=><span style={{fontSize:11,color:'#2c3e50',lineHeight:1.5,display:'block',minWidth:260,maxWidth:360,whiteSpace:'normal'}}>{highlightRecommendation(wsAIRec(row))}</span>},
    {key:'_action',          label:'Action',        sortable:false, align:'center',
      format:(_,row)=>(
        <KeywordRowAction
          resourceName={row.resourceName}
          selectedAccount={selectedAccount}
          onChanged={(resourceName, newStatus) => setData(prev => (prev||[]).map(r => r.resourceName === resourceName ? { ...r, status: newStatus } : r))}
        />
      )},
  ]

  // Curated to match the displayed columns exactly — the raw rows carry
  // extra internal fields and unformatted numbers the table doesn't show.
  const wsCsvRows = wsFiltered.map(r => ({
    'Keyword':       r.text,
    'Match':         r.matchType,
    'Campaign':      r.campaign,
    'Ad Group':      r.adGroup,
    'Quality Score': r.qualityScore || '—',
    'Impr.':         fmtNum(r.impressions),
    'Clicks':        fmtNum(r.clicks),
    'CTR':           fmtPct(r.ctr),
    'CPC':           fmtUsd(r.cpc),
    'Cost / Conv':   fmtCostPerConv(r.cost, r.conversions),
    'Cost':          fmtUsd(r.cost),
    'Conv.':         fmtNum(r.conversions),
    'Form Conv.':    fmtNum(r.formConversions),
    'Phone Conv.':   fmtNum(r.phoneConversions),
    'Call Leads':    fmtNum(r.phoneCalls),
    'AI Suggestion': wsAIRec(r),
  }))

  return (
    <Section
      title="⚠ Overspending Keywords"
      extra={
        <div style={{ display:'flex', gap:8 }}>
          <ExportButton data={wsCsvRows} filename="wasted-spend"/>
          <ExportPdfButton accountName={selectedAccount?.name} section="Overspending Keywords" />
        </div>
      }
    >
      <CampFilterBar allData={data||[]} campFilter={wsCampFilter} setCampFilter={setWsCampFilter} campStatusFilter={wsCampStatus} setCampStatusFilter={setWsCampStatus} kwStatusFilter={wsKwStatus} setKwStatusFilter={setWsKwStatus}/>
      <div className="card-body" style={{borderBottom:'1px solid #dde9f5', paddingBottom:12}}>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <span style={{fontSize:13,color:'#4a4a4a'}}>Flag keywords spending more than</span>
          <div style={{display:'flex',alignItems:'center',gap:4}}>
            <span style={{fontSize:13,color:'#1a3a6b',fontWeight:600}}>$</span>
            <input type="number" min={1} value={threshold} onChange={e=>setThreshold(Number(e.target.value)||1)} style={{width:70,padding:'5px 8px',border:'1px solid #dde9f5',borderRadius:5,fontSize:13,outline:'none',color:'#1a3a6b',fontWeight:600}} />
          </div>
          <span style={{fontSize:13,color:'#4a4a4a'}}>with 0 conversions</span>
        </div>
        {wsFiltered.length > 0 && (
          <div style={{marginTop:10,padding:'8px 14px',background:'#fdecea',border:'1px solid #e05c2a',borderRadius:6,fontSize:13,color:'#e05c2a',fontWeight:500}}>
            {wsFiltered.length} keywords wasting {fmtUsd(totalWasted)} total
          </div>
        )}
      </div>
      {loading ? <Skeleton rows={5}/> : <div style={{overflowX:'auto'}}><ReportTableInline columns={cols} data={wsFiltered} /></div>}
    </Section>
  )
}

// Simple inline table (not using ReportTable to avoid import cycle)
function ReportTableInline({ columns, data }) {
  const [sort,     setSort]     = useState(columns[0]?.key||'')
  const [asc,      setAsc]      = useState(false)
  const [page,     setPage]     = useState(0)
  const [pageSize, setPageSize] = useState(25)
  // Show every row during a PDF export instead of just the current page —
  // see usePdfExportMode.
  const pdfExportMode = usePdfExportMode()

  // First column (Keyword) width is user-adjustable — it used to hard-
  // truncate to 200px with an ellipsis, cutting off longer keywords entirely.
  const [col0Width, setCol0Width] = useState(220)
  const col0DragRef = React.useRef(null)
  useEffect(() => {
    function onMove(e) {
      if (!col0DragRef.current) return
      setCol0Width(Math.max(100, col0DragRef.current.startWidth + e.clientX - col0DragRef.current.startX))
    }
    function onUp() {
      if (!col0DragRef.current) return
      col0DragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])
  function startCol0Resize(e) {
    e.preventDefault(); e.stopPropagation()
    col0DragRef.current = { startX: e.clientX, startWidth: col0Width }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => { setPage(0) }, [sort, asc])

  const sorted = useMemo(() => {
    if (!data?.length) return []
    // A column can supply sortValue(row) for derived fields that aren't a
    // plain row[key] — e.g. a cost-per-conversion column.
    const sortCol = columns.find(c => c.key === sort)
    return [...data].sort((a,b) => {
      const va=sortCol?.sortValue?sortCol.sortValue(a):a[sort], vb=sortCol?.sortValue?sortCol.sortValue(b):b[sort]
      if(typeof va==='number') return asc?va-vb:vb-va
      return asc?String(va||'').localeCompare(String(vb||'')):String(vb||'').localeCompare(String(va||''))
    })
  }, [data, sort, asc, columns])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const pageRows   = pdfExportMode ? sorted : sorted.slice(page * pageSize, (page + 1) * pageSize)
  const rangeStart = page * pageSize + 1
  const rangeEnd   = Math.min((page + 1) * pageSize, sorted.length)
  return (
    <div style={{ display:'flex', flexDirection:'column', maxHeight: pdfExportMode ? 'none' : '70vh' }}>
      <div style={{ overflow: pdfExportMode ? 'visible' : 'auto', flex:1 }}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr>{columns.map((c,i)=>(
            <th key={c.key} onClick={()=>{if(sort===c.key)setAsc(a=>!a);else{setSort(c.key);setAsc(false)}}}
              style={{background:'#1a3a6b',color:'#fff',padding:'9px 11px',textAlign:c.align||(i===0?'left':'right'),fontSize:11,fontWeight:600,cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',position:'sticky',top:0,zIndex:2,
                ...(i===0?{width:col0Width,minWidth:col0Width}:{})}}>
              {c.label}{sort===c.key?(asc?' ▲':' ▼'):''}
              {i===0 && (
                <span
                  onClick={e=>e.stopPropagation()}
                  onMouseDown={startCol0Resize}
                  title="Drag to resize column"
                  style={{position:'absolute', right:0, top:0, bottom:0, width:6, cursor:'col-resize', display:'inline-block'}}
                />
              )}
            </th>
          ))}</tr></thead>
          <tbody>
            {sorted.length===0?<tr><td colSpan={columns.length} style={{padding:'24px 0',textAlign:'center',color:'#aaa'}}>No overspending keywords found for this threshold</td></tr>
            :pageRows.map((row,vi)=>(
              <tr key={vi} style={{background:vi%2===0?'#fff':'#f5f7fa'}}>
                {columns.map((c,ci)=>{
                  const raw=row[c.key]
                  const cell=c.format?c.format(raw,row):c.badge?<StatusBadge value={raw}/>:(raw??'—')
                  return <td key={c.key} style={{padding:'8px 11px',borderBottom:'1px solid #f0f4f8',textAlign:c.align||(ci===0?'left':'right'),color:ci===0?'#1a3a6b':'#4a4a4a',fontWeight:ci===0?500:400,
                    width:ci===0?col0Width:undefined, maxWidth:ci===0?col0Width:undefined,
                    overflow:ci===0?'visible':'hidden', textOverflow:ci===0?undefined:'ellipsis',
                    whiteSpace:ci===0?'normal':'nowrap', wordBreak:ci===0?'break-word':undefined}}>{cell}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!pdfExportMode && sorted.length > 0 && (
        <div className="no-print" style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderTop:'1px solid #f0f4f8',flexWrap:'wrap',gap:8,flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:12,color:'#888'}}>Rows per page:</span>
            <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(0)}} style={{padding:'4px 8px',border:'1px solid #dde9f5',borderRadius:5,fontSize:12,color:'#1a3a6b',outline:'none',cursor:'pointer'}}>
              {KW_PAGE_SIZES.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:12,color:'#888'}}>{rangeStart}–{rangeEnd} of {sorted.length}</span>
            {totalPages > 1 && (
              <div style={{display:'flex',gap:4}}>
                <button onClick={()=>setPage(0)} disabled={page===0} style={{padding:'4px 8px',fontSize:12,fontWeight:600,border:'1px solid #dde9f5',borderRadius:5,background:page===0?'#f5f7fa':'#fff',color:page===0?'#aaa':'#1a3a6b',cursor:page===0?'not-allowed':'pointer'}}>«</button>
                <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0} style={{padding:'4px 10px',fontSize:12,fontWeight:600,border:'1px solid #dde9f5',borderRadius:5,background:page===0?'#f5f7fa':'#fff',color:page===0?'#aaa':'#1a3a6b',cursor:page===0?'not-allowed':'pointer'}}>‹ Prev</button>
                <span style={{padding:'4px 10px',fontSize:12,color:'#555',border:'1px solid #dde9f5',borderRadius:5,background:'#f5f7fa'}}>{page+1} / {totalPages}</span>
                <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1} style={{padding:'4px 10px',fontSize:12,fontWeight:600,border:'1px solid #dde9f5',borderRadius:5,background:page>=totalPages-1?'#f5f7fa':'#fff',color:page>=totalPages-1?'#aaa':'#1a3a6b',cursor:page>=totalPages-1?'not-allowed':'pointer'}}>Next ›</button>
                <button onClick={()=>setPage(totalPages-1)} disabled={page>=totalPages-1} style={{padding:'4px 8px',fontSize:12,fontWeight:600,border:'1px solid #dde9f5',borderRadius:5,background:page>=totalPages-1?'#f5f7fa':'#fff',color:page>=totalPages-1?'#aaa':'#1a3a6b',cursor:page>=totalPages-1?'not-allowed':'pointer'}}>»</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Top converting keywords — receives already-loaded rows to avoid double fetch
function TopConvertingSection({ rows, loading, accountName }) {
  const data = useMemo(() => {
    return (rows || [])
      .filter(r => r.conversions > 0)
      .sort((a, b) => b.conversions - a.conversions)
      .map(r => ({ ...r, isTopConverter: (r.convRate || 0) > 5 }))
  }, [rows])

  const chartData = data.slice(0, 10).map(r => ({ name: r.text.slice(0, 25), conversions: r.conversions }))

  const columns = [
    { key:'text',            label:'Keyword',       sortable:true, align:'left', width:220, wrap:true,
      format:(v,row) => (
        <span>
          <span style={{color:kwStatusColor(row.status||''),fontWeight:500}}>{v}</span>
          {row.isTopConverter && <span style={{marginLeft:6,fontSize:10,background:'rgba(76,175,80,0.15)',color:'#2e7d32',padding:'1px 5px',borderRadius:3,fontWeight:600}}>⭐ Top</span>}
        </span>
      )},
    { key:'matchType',       label:'Match',         sortable:true, align:'center',
      format:v => <StatusBadge value={v} type="match"/> },
    { key:'campaign',        label:'Campaign',      sortable:true, align:'left',
      format:(v,row) => <span style={{color:kwStatusColor(row.campaignStatus||''),fontWeight:500}}>{v}</span> },
    { key:'adGroup',         label:'Ad Group',      sortable:true, align:'left',
      format:(v,row) => <span style={{color:kwStatusColor(row.adGroupStatus||''),fontWeight:500}}>{v||'—'}</span> },
    { key:'qualityScore',    label:'Quality Score', sortable:true, align:'center',
      format:v => <span style={{fontSize:12,fontWeight:700,color:qsColor(v)}}>{v||'—'}</span> },
    { key:'impressions',     label:'Impr.',         sortable:true, align:'right', format:fmtNum },
    { key:'clicks',          label:'Clicks',        sortable:true, align:'right', format:fmtNum },
    { key:'ctr',             label:'CTR',           sortable:true, align:'right', format:fmtPct },
    { key:'cpc',             label:'CPC',           sortable:true, align:'right', format:fmtUsd },
    { key:'costPerConv',     label:'Cost / Conv',   sortable:true, align:'right', format:(v,row)=>fmtCostPerConv(row.cost,row.conversions), sortValue:row=>Number(row.conversions||0)>0?Number(row.cost||0)/Number(row.conversions):-1 },
    { key:'cost',            label:'Cost',          sortable:true, align:'right', format:fmtUsd },
    { key:'conversions',     label:'Conv.',         sortable:true, align:'right', format:fmtNum },
    { key:'formConversions', label:'Form Conv.',    sortable:true, align:'right',
      format:(v,row)=><BreakdownCell value={v} breakdown={row.formBreakdown} entityLabel={row.text}
        modalTitle="Form Conversions" buttonTitle="View form conversion breakdown" rowLabel="Conversion Action"/> },
    { key:'phoneConversions',label:'Phone Conv.',   sortable:true, align:'right',
      format:(v,row)=><BreakdownCell value={v} breakdown={row.phoneBreakdown} entityLabel={row.text}
        modalTitle="Call Conversions" buttonTitle="View call conversion breakdown" rowLabel="Conversion Action"/> },
    { key:'phoneCalls',      label:'Call Leads',    sortable:true, align:'center',
      format:(v,row) => <CallLeadsBadge count={v||0} campaignName={row.campaign}/> },
  ]

  return (
    <Section title="⭐ Top Converting Keywords (Last 90 Days)" extra={
      <div style={{ display:'flex', gap:8 }}>
        <ExportButton data={data.map(({isTopConverter,...r})=>r)} filename="top-converting-keywords"/>
        <ExportPdfButton accountName={accountName} section="Top Converting Keywords" />
      </div>
    }>
      {loading && <Skeleton rows={6}/>}
      {!loading && chartData.length > 0 && (
        <div className="card-body" style={{borderBottom:'1px solid #dde9f5'}}>
          <ResponsiveContainer width="100%" height={Math.max(200, chartData.length*28)}>
            <BarChart data={chartData} layout="vertical" margin={{left:8,right:16}}>
              <XAxis type="number" tick={{fontSize:10,fill:'#888'}} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="name" width={160} tick={{fontSize:10,fill:'#1a3a6b'}} axisLine={false} tickLine={false}/>
              <Tooltip formatter={v=>[fmtNum(v),'Conversions']}/>
              <Bar dataKey="conversions" fill="#4caf50" radius={[0,3,3,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <ReportTable
        columns={columns}
        data={data}
        loading={loading}
        noFilter
        resizable
        emptyMessage="No converting keywords found for the selected period"
      />
    </Section>
  )
}
// ── Match type donut + QS distribution ───────────────────────────────────────
const MATCH_COLORS = { EXACT:'#1a3a6b', PHRASE:'#2563b0', BROAD:'#3a8fd1' }

function MatchDonut({ rows }) {
  const agg = { EXACT:0, PHRASE:0, BROAD:0 }
  for (const r of rows||[]) { const mt=(r.matchType||'').toUpperCase(); if(agg[mt]!==undefined) agg[mt]+=r.impressions||0 }
  const total=Object.values(agg).reduce((s,v)=>s+v,0)
  const data=Object.entries(agg).filter(([,v])=>v>0).map(([k,v])=>({name:k,value:v,pct:total>0?Math.round((v/total)*100):0}))
  if (!data.length) return <div style={{padding:'20px',textAlign:'center',color:'#aaa',fontSize:12}}>No data</div>
  return (
    <div style={{display:'flex',alignItems:'center',gap:32}}>
      <ResponsiveContainer width={200} height={200}>
        <PieChart><Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="value" paddingAngle={2}>
          {data.map((d,i)=><Cell key={i} fill={MATCH_COLORS[d.name]||'#888'} stroke="none"/>)}
        </Pie><Tooltip formatter={v=>fmtNum(v)}/></PieChart>
      </ResponsiveContainer>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {data.map(d=>(
          <div key={d.name} style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{width:12,height:12,borderRadius:2,background:MATCH_COLORS[d.name]||'#888',flexShrink:0}}/>
            <div><div style={{fontSize:12,fontWeight:600,color:'#1a3a6b'}}>{d.name}</div><div style={{fontSize:11,color:'#888'}}>{fmtNum(d.value)} impr. ({d.pct}%)</div></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function QsDistribution({ rows }) {
  const dist=Array.from({length:10},(_,i)=>({score:i+1,count:0}))
  for (const r of rows||[]) { const qs=Math.round(r.qualityScore||0); if(qs>=1&&qs<=10) dist[qs-1].count++ }
  if (!dist.some(d=>d.count>0)) return <div style={{padding:'20px',textAlign:'center',color:'#aaa',fontSize:12}}>No quality score data</div>
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={dist} margin={{top:4,right:8,left:0,bottom:0}}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false}/>
        <XAxis dataKey="score" tick={{fontSize:11,fill:'#888'}} axisLine={false} tickLine={false}/>
        <YAxis tick={{fontSize:10,fill:'#888'}} axisLine={false} tickLine={false} width={32}/>
        <Tooltip formatter={(v,_,p)=>[v+' keywords',`QS ${p.payload.score}`]}/>
        <Bar dataKey="count" radius={[3,3,0,0]}>
          {dist.map((d,i)=><Cell key={i} fill={qsColor(d.score)}/>)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Error state ───────────────────────────────────────────────────────────────
function ErrorState({ message, onRetry }) {
  return (
    <div style={{ padding:32, display:'flex', justifyContent:'center' }}>
      <div style={{ background:'#fff', border:'1px solid #ffd5cc', borderRadius:10, padding:'24px 28px', maxWidth:380, textAlign:'center' }}>
        <AlertCircle size={28} color="#e05c2a" style={{ marginBottom:10 }}/>
        <div style={{ fontWeight:600, color:'#c0392b', marginBottom:6 }}>Failed to load data</div>
        <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>{message}</div>
        {onRetry && <button onClick={onRetry} style={{ padding:'7px 18px', background:'#e8a020', color:'#1a3a6b', fontWeight:700, fontSize:12, borderRadius:6, border:'none', cursor:'pointer' }}>Retry</button>}
      </div>
    </div>
  )
}

// ── Negative Keywords tab (moved from Reports) ────────────────────────────────
function RecommendedNegKeywordsTab({ data, loading, error, onRetry, selectedAccount, setNegData, existingKeywords, setRows }) {
  const [selected,         setSelected]         = useState(new Set())
  const [copied,           setCopied]           = useState(false)
  const [publishRows,      setPublishRows]      = useState(null)
  const [recFilter,        setRecFilter]        = useState('')
  const [appliedRecFilter, setAppliedRecFilter] = useState('')
  const [recPage,          setRecPage]          = useState(0)
  const [recPageSize,      setRecPageSize]      = useState(10)
  // Show every row during a PDF export instead of just the current page —
  // see usePdfExportMode.
  const pdfExportMode = usePdfExportMode()
  const [recSortKey,       setRecSortKey]       = useState('')
  const [recSortAsc,       setRecSortAsc]       = useState(false)
  const [recCampFilter,    setRecCampFilter]    = useState('')
  const [recCampStatus,    setRecCampStatus]    = useState('Enabled')
  const [recKwStatus,      setRecKwStatus]      = useState('')
  const [recAdGroupFilter, setRecAdGroupFilter] = useState('')
  const [signalModal,      setSignalModal]      = useState(null)

  // Switch K <-> NK — same pattern as the Search Terms tab's Switch feature.
  const [switchSelected, setSwitchSelected] = useState(new Set())
  const [switchRows,     setSwitchRows]     = useState(null)

  useEffect(() => { const t = setTimeout(() => setAppliedRecFilter(recFilter), 300); return () => clearTimeout(t) }, [recFilter])
  useEffect(() => { setRecPage(0) }, [appliedRecFilter, recSortKey, recSortAsc])

  if (error)   return <ErrorState message={error} onRetry={onRetry} />
  if (loading) return <div style={{ padding:20 }}><div className="skeleton" style={{ height:300, borderRadius:6 }} /></div>
  if (!data)   return null

  const { recommendations = [], potentialSavings = 0 } = data

  // Flags a recommended term already added as a keyword or negative keyword
  // elsewhere, so the row shows a K/NK badge instead of a selectable
  // checkbox — otherwise there's no way to tell whether a recommendation
  // you already acted on is still showing up here. Clicking the badge shows
  // which existing keyword(s)/negative(s) it matches.
  const kwMap   = buildKwMap(existingKeywords)
  const negMaps = buildNegMaps(data.existingNegatives)
  function getSignal(row) { return resolveKwSignal(row.term, row.campaign, row.adGroup, kwMap, negMaps) }

  const campFilteredRecs = recommendations.filter(r =>
    (!recCampFilter     || r.campaign       === recCampFilter) &&
    (!recCampStatus     || r.campaignStatus === recCampStatus) &&
    (!recKwStatus       || r.status         === recKwStatus)   &&
    (!recAdGroupFilter  || r.adGroup        === recAdGroupFilter)
  )

  const filteredRecs = appliedRecFilter.trim()
    ? campFilteredRecs.filter(r => Object.values(r).some(v => v != null && typeof v !== 'object' && String(v).toLowerCase().includes(appliedRecFilter.toLowerCase())))
    : campFilteredRecs

  // costPerConv isn't a real field on the row — it's derived (cost/conversions,
  // -1 when there's no conversion), so it needs its own branch rather than
  // falling through to the generic a[recSortKey]/b[recSortKey] compare.
  const recCostPerConvOf = r => Number(r.conversions||0) > 0 ? Number(r.cost||0) / Number(r.conversions) : -1

  const visibleRecs = recSortKey
    ? [...filteredRecs].sort((a, b) => {
        if (recSortKey === 'costPerConv') { const cmp = recCostPerConvOf(a) - recCostPerConvOf(b); return recSortAsc ? cmp : -cmp }
        const va = a[recSortKey], vb = b[recSortKey]
        if (va == null) return 1
        if (vb == null) return -1
        const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))
        return recSortAsc ? cmp : -cmp
      })
    : filteredRecs

  // Only actionable rows (genuinely irrelevant terms) can be selected and
  // published as negatives — "Performance Review", "Valid Search — Campaign
  // Routing Review" and "Already Excluded" rows are informational only.
  const selectableRecIdx = visibleRecs.map((_, i) => i).filter(i => visibleRecs[i].actionable && !getSignal(visibleRecs[i]))

  // Switch K <-> NK — same pattern as the Search Terms tab. Indices here are
  // against visibleRecs directly (this table has no separate "paged" array —
  // ri already accounts for the page offset in the render below).
  const switchLockedStatus = switchSelected.size > 0 ? getSignal(visibleRecs[[...switchSelected][0]])?.status : null
  function toggleSwitchRow(idx) {
    setSwitchSelected(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n })
  }
  function startSwitch() {
    const rowsToSwitch = [...switchSelected].map(i => visibleRecs[i]).filter(Boolean)
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
    if (removedKeywordRNs.size) setRows?.(prev => (prev || []).filter(k => !removedKeywordRNs.has(k.resourceName)))
    if (removedNegRNs.size) setNegData?.(prev => ({ ...(prev || {}), existingNegatives: (prev?.existingNegatives || []).filter(n => !removedNegRNs.has(n.resourceName)) }))
  }

  function toggleSelect(i) { setSelected(s => { const n = new Set(s); n.has(i)?n.delete(i):n.add(i); return n }) }

  function copySelected() {
    const lines = [...selected].map(i => { const r = visibleRecs[i]; return r ? `[${r.recommendedMatchType}] ${r.term}` : '' }).filter(Boolean)
    navigator.clipboard?.writeText(lines.join('\n')).catch(()=>{})
    setCopied(true); setTimeout(()=>setCopied(false), 2000)
  }

  function reasonColorFor(reason) {
    if (!reason) return '#888'
    if (reason.startsWith('Irrelevant')) return '#e05c2a'
    if (reason === 'Performance Review — Do Not Negative') return '#f0b429'
    if (reason === 'Valid Search — Campaign Routing Review') return '#2563b0'
    if (reason === 'Already Excluded') return '#6b7280'
    return '#888'
  }

  const recCols = [
    { key:'term',       label:'Search Term', sortable:true, align:'left',   width:200, format:(v,row)=><span style={{color:kwStatusColor(row.campaignStatus||''),fontWeight:500}}>{v}</span> },
    { key:'campaign',   label:'Campaign',    sortable:true, align:'left', format:(v,row)=><span style={{color:kwStatusColor(row.campaignStatus||''),fontWeight:500}}>{v}</span> },
    { key:'adGroup',    label:'Ad Group',    sortable:true, align:'left'   },
    { key:'impressions',label:'Impr.',       sortable:true, align:'right',  format:fmtNum },
    { key:'clicks',     label:'Clicks',      sortable:true, align:'right',  format:fmtNum },
    { key:'cost',       label:'Cost',        sortable:true, align:'right',  format:fmtUsd },
    { key:'costPerConv',label:'Cost / Conv', sortable:true, align:'right',  format:(v,row)=>fmtCostPerConv(row.cost,row.conversions) },
    { key:'conversions', label:'Conv.',   sortable:true, align:'right', format:fmtNum },
    { key:'reason',      label:'Reason', sortable:true, align:'center',
      format: v => <span style={{ fontSize:11, fontWeight:600, padding:'2px 7px', borderRadius:4, background:`${reasonColorFor(v)}22`, color:reasonColorFor(v), border:`1px solid ${reasonColorFor(v)}55` }}>{v}</span> },
    { key:'recommendedMatchType', label:'Match', sortable:true, align:'center',
      format: (v, row) => {
        if (row.actionable) return <StatusBadge value={v} type="match"/>
        if (row.reason === 'Already Excluded' && v) return <span style={{ fontSize:11, color:'#6b7280' }}>{v} (existing)</span>
        return <span style={{ fontSize:11, color:'#bbb' }}>N/A</span>
      } },
  ]

  // Curated to match the currently-filtered/sorted table (visibleRecs), not
  // the full unfiltered recommendation set, and using the same displayed
  // formatting as the table columns.
  const negRecCsvRows = visibleRecs.map(r => ({
    'Search Term': r.term,
    'Campaign':    r.campaign,
    'Ad Group':    r.adGroup,
    'Impr.':       fmtNum(r.impressions),
    'Clicks':      fmtNum(r.clicks),
    'Cost':        fmtUsd(r.cost),
    'Cost / Conv': fmtCostPerConv(r.cost, r.conversions),
    'Conv.':       fmtNum(r.conversions),
    'Reason':      r.reason,
    'Match':       r.recommendedMatchType,
  }))

  // Derived from visibleRecs (the same filtered/sorted set the table and CSV
  // export use) rather than the raw unfiltered recommendations — previously
  // this banner counted every recommendation while the table/CSV silently
  // applied the "Enabled" campaign-status filter, so the two disagreed.
  // Only actionable (genuinely irrelevant) rows count toward the "recommended
  // as negatives" total and its savings figure — review/routing/excluded rows
  // are shown in the table but aren't negative-keyword recommendations.
  const actionableVisible = visibleRecs.filter(r => r.actionable)
  const visibleSavings = actionableVisible.reduce((s, r) => s + (r.cost || 0), 0)

  return (
    <div>
      {recommendations.length > 0 && (
        <div style={{ background:'#fff8e1', border:'1px solid #f0b429', borderRadius:8, padding:'12px 16px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:13, color:'#a56700', fontWeight:500 }}>
            {actionableVisible.length} search terms recommended as negatives · potential savings: {fmtUsd(visibleSavings)}
          </span>
          <div style={{ display:'flex', gap:8 }}>
            {selected.size > 0 && (
              <>
                <button onClick={copySelected} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 12px', background:'#2563b0', color:'#fff', fontSize:12, fontWeight:600, borderRadius:5, border:'none', cursor:'pointer' }}>
                  {copied ? <><Check size={12}/> Copied!</> : <><Copy size={12}/> Copy {selected.size} selected</>}
                </button>
                {selectedAccount && (
                  <button onClick={() => setPublishRows([...selected].map(i => visibleRecs[i]).filter(Boolean))} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 12px', background:'#1a3a6b', color:'#fff', fontSize:12, fontWeight:600, borderRadius:5, border:'none', cursor:'pointer' }}>
                    🚀 Proceed to Publish {selected.size} selected
                  </button>
                )}
              </>
            )}
            <ExportButton data={negRecCsvRows} filename="negative-recommendations" />
            <ExportPdfButton accountName={selectedAccount?.name} section="Negative Keyword Recommendations" />
          </div>
        </div>
      )}

      <KwSignalModal
        signal={signalModal}
        onClose={() => setSignalModal(null)}
        selectedAccount={selectedAccount}
        allowKeywordActions
        onKeywordChanged={(resourceName, newStatus) => setRows?.(prev => (prev || []).map(k => k.resourceName === resourceName ? { ...k, status: newStatus } : k))}
      />

      {publishRows && selectedAccount && (
        <SearchTermPublishModal
          rows={publishRows.map(r => ({ ...r, searchTerm: r.term }))}
          selectedAccount={selectedAccount}
          initialKwType="Negative Keyword"
          initialMatchType={publishRows[0]?.recommendedMatchType}
          initialCampaignId={publishRows[0]?.campaignId}
          initialAdGroupId={publishRows[0]?.adGroupId}
          onClose={() => setPublishRows(null)}
          onSuccess={payload => {
            const publishedKeys = new Set(publishRows.map(r => `${r.campaign}::${r.adGroup}::${r.term.toLowerCase().trim()}`))
            const { negatives } = buildOptimisticPublishRecords(payload)

            setNegData(prev => {
              if (!prev) return prev
              const remainingRecs = (prev.recommendations || []).filter(r =>
                !publishedKeys.has(`${r.campaign}::${r.adGroup}::${r.term.toLowerCase().trim()}`)
              )
              const potentialSavings = remainingRecs
                .filter(r => r.actionable)
                .reduce((s, r) => s + r.cost, 0)

              return {
                ...prev,
                recommendations:  remainingRecs,
                existingNegatives: [...(prev.existingNegatives || []), ...negatives],
                potentialSavings,
              }
            })

            setPublishRows(null)
            setSelected(new Set())
          }}
        />
      )}

      {switchRows && selectedAccount && (
        <SearchTermPublishModal
          rows={switchRows.map(r => ({ ...r, searchTerm: r.term }))}
          selectedAccount={selectedAccount}
          lockKwType={switchToKwType}
          initialLevel="Ad Group"
          initialCampaignId={switchRows[0]?.campaignId}
          initialAdGroupId={switchRows[0]?.adGroupId}
          removalByRow={switchRemovalByRow}
          onRemoved={handleSwitchRemoved}
          onClose={() => setSwitchRows(null)}
          onSuccess={payload => {
            const { keywords, negatives } = buildOptimisticPublishRecords(payload)
            if (keywords.length)  setRows?.(prev => [...(prev || []), ...keywords])
            if (negatives.length) setNegData?.(prev => ({ ...(prev || {}), existingNegatives: [...(prev?.existingNegatives || []), ...negatives] }))
            setSwitchRows(null); setSwitchSelected(new Set())
          }}
        />
      )}

      <Section title="Search Terms Recommended as Negative Keywords">
        <CampFilterBar allData={recommendations} campFilter={recCampFilter} setCampFilter={setRecCampFilter} campStatusFilter={recCampStatus} setCampStatusFilter={setRecCampStatus} kwStatusFilter={recKwStatus} setKwStatusFilter={setRecKwStatus} adGroupFilter={recAdGroupFilter} setAdGroupFilter={setRecAdGroupFilter}/>
        <div style={{ padding:'8px 12px', borderBottom:'1px solid #f0f4f8', display:'flex', alignItems:'center', gap:8, background:'#fafcff' }}>
          <Search size={13} style={{ color:'#aaa', flexShrink:0 }} />
          <input value={recFilter} onChange={e => setRecFilter(e.target.value)} placeholder="Filter rows…"
            style={{ flex:1, border:'none', outline:'none', fontSize:12, color:'#1a3a6b', background:'transparent' }} />
          {recFilter && <button onClick={() => { setRecFilter(''); setAppliedRecFilter('') }} style={{ color:'#aaa', display:'flex', alignItems:'center' }}><X size={12}/></button>}
          {appliedRecFilter && <span style={{ fontSize:11, color:'#888', whiteSpace:'nowrap' }}>{visibleRecs.length} result{visibleRecs.length!==1?'s':''}</span>}
        </div>

        {switchSelected.size > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 16px', background:'#fff3e0', borderBottom:'1px solid #ffcc80' }}>
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
        <div style={{ overflow: pdfExportMode ? 'visible' : 'auto', maxHeight: pdfExportMode ? 'none' : '70vh' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                <th style={{ background:'#1a3a6b', color:'#fff', padding:'9px 10px', width:40, textAlign:'center', position:'sticky', top:0, zIndex:2 }}>
                  <input type="checkbox"
                    checked={selectableRecIdx.length > 0 && selected.size === selectableRecIdx.length}
                    onChange={e => setSelected(e.target.checked ? new Set(selectableRecIdx) : new Set())} />
                </th>
                <th style={{ background:'#1a3a6b', color:'#fff', padding:'9px 10px', fontSize:11, fontWeight:600, textAlign:'center', width:42, position:'sticky', top:0, zIndex:2 }}>#</th>
                {recCols.map(c => {
                  const active = recSortKey === c.key
                  return (
                    <th key={c.key}
                      onClick={c.sortable ? () => { if (recSortKey === c.key) setRecSortAsc(a => !a); else { setRecSortKey(c.key); setRecSortAsc(false) } } : undefined}
                      style={{ background: active ? '#0f2850' : '#1a3a6b', color:'#fff', padding:'9px 12px',
                        textAlign:c.align||'left', fontSize:11, fontWeight:600, whiteSpace:'nowrap',
                        position:'sticky', top:0, zIndex:2,
                        cursor: c.sortable ? 'pointer' : 'default', userSelect:'none' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                        {c.label}
                        {c.sortable && <span style={{ fontSize:9, opacity: active ? 1 : 0.35 }}>{active ? (recSortAsc ? '▲' : '▼') : '⬍'}</span>}
                      </span>
                    </th>
                  )
                })}
                <th style={{ background:'#1a3a6b', color:'#fff', padding:'9px 10px', width:80, textAlign:'center', position:'sticky', top:0, zIndex:2 }}>Publish</th>
              </tr>
            </thead>
            <tbody>
              {visibleRecs.length === 0
                ? <tr><td colSpan={recCols.length+3} style={{ padding:'28px 0', textAlign:'center', color:'#aaa' }}>No negative keyword recommendations for this period</td></tr>
                : (pdfExportMode ? visibleRecs : visibleRecs.slice(recPage*recPageSize, (recPage+1)*recPageSize)).map((row, vi) => {
                    const ri     = pdfExportMode ? vi : recPage * recPageSize + vi
                    const signal = getSignal(row)
                    return (
                      <tr key={ri} style={{ background:selected.has(ri)?'#e8f0fb':vi%2===0?'#fff':'#f5f7fa' }}>
                        <td style={{ padding:'8px 12px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                          {signal ? <KwSignalBadge status={signal.status} onClick={() => setSignalModal(signal)} /> : row.actionable ? (
                            <input type="checkbox" checked={selected.has(ri)} onChange={() => toggleSelect(ri)} />
                          ) : (
                            <span style={{ color:'#ccc', fontSize:11 }}>—</span>
                          )}
                        </td>
                        <td style={{ padding:'8px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', color:'#aaa', fontSize:11 }}>{ri + 1}</td>
                        {recCols.map((c,ci) => {
                          const raw = row[c.key]
                          const cell = c.format ? c.format(raw,row) : c.badge ? <StatusBadge value={raw}/> : (raw??'—')
                          return <td key={c.key} style={{ padding:'8px 12px', borderBottom:'1px solid #f0f4f8', textAlign:c.align||'left', color:ci===0?'#1a3a6b':'#4a4a4a', fontWeight:ci===0?500:400, maxWidth:ci===0?240:undefined, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cell}</td>
                        })}
                        <td style={{ padding:'7px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                          {signal && selectedAccount ? (() => {
                            const switchDisabled = !!switchLockedStatus && switchLockedStatus !== signal.status
                            return (
                              <label style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11,
                                color: switchDisabled ? '#ccc' : '#a56700', cursor: switchDisabled ? 'not-allowed' : 'pointer' }}>
                                <input type="checkbox" disabled={switchDisabled} checked={switchSelected.has(ri)} onChange={() => toggleSwitchRow(ri)} />
                                Switch
                              </label>
                            )
                          })() : signal || !selectedAccount || !row.actionable ? (
                            <span style={{ color:'#aaa', fontSize:11 }}>—</span>
                          ) : (
                            <button
                              onClick={() => setPublishRows([row])}
                              style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px',
                                fontSize:11, fontWeight:600, borderRadius:5, cursor:'pointer', whiteSpace:'nowrap',
                                border:'1px solid #1a3a6b', background:'#1a3a6b', color:'#fff' }}>
                              🚀 Proceed to Publish
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
        {!pdfExportMode && Math.ceil(visibleRecs.length / recPageSize) > 1 && (
          <div className="no-print" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderTop:'1px solid #f0f4f8', flexWrap:'wrap', gap:8 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:12, color:'#888' }}>Rows per page:</span>
              <select value={recPageSize} onChange={e=>{setRecPageSize(Number(e.target.value));setRecPage(0)}} style={{ padding:'4px 8px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer' }}>
                {[10,25,50,100,500].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:12, color:'#888' }}>{recPage*recPageSize+1}–{Math.min((recPage+1)*recPageSize,visibleRecs.length)} of {visibleRecs.length}</span>
              <div style={{ display:'flex', gap:4 }}>
                <button onClick={()=>setRecPage(0)} disabled={recPage===0} style={{ padding:'4px 8px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background:recPage===0?'#f5f7fa':'#fff', color:recPage===0?'#aaa':'#1a3a6b', cursor:recPage===0?'not-allowed':'pointer' }}>«</button>
                <button onClick={()=>setRecPage(p=>Math.max(0,p-1))} disabled={recPage===0} style={{ padding:'4px 10px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background:recPage===0?'#f5f7fa':'#fff', color:recPage===0?'#aaa':'#1a3a6b', cursor:recPage===0?'not-allowed':'pointer' }}>‹ Prev</button>
                <span style={{ padding:'4px 10px', fontSize:12, color:'#555', border:'1px solid #dde9f5', borderRadius:5, background:'#f5f7fa' }}>{recPage+1} / {Math.ceil(visibleRecs.length/recPageSize)}</span>
                <button onClick={()=>setRecPage(p=>Math.min(Math.ceil(visibleRecs.length/recPageSize)-1,p+1))} disabled={recPage>=Math.ceil(visibleRecs.length/recPageSize)-1} style={{ padding:'4px 10px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background:recPage>=Math.ceil(visibleRecs.length/recPageSize)-1?'#f5f7fa':'#fff', color:recPage>=Math.ceil(visibleRecs.length/recPageSize)-1?'#aaa':'#1a3a6b', cursor:recPage>=Math.ceil(visibleRecs.length/recPageSize)-1?'not-allowed':'pointer' }}>Next ›</button>
                <button onClick={()=>setRecPage(Math.ceil(visibleRecs.length/recPageSize)-1)} disabled={recPage>=Math.ceil(visibleRecs.length/recPageSize)-1} style={{ padding:'4px 8px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background:recPage>=Math.ceil(visibleRecs.length/recPageSize)-1?'#f5f7fa':'#fff', color:recPage>=Math.ceil(visibleRecs.length/recPageSize)-1?'#aaa':'#1a3a6b', cursor:recPage>=Math.ceil(visibleRecs.length/recPageSize)-1?'not-allowed':'pointer' }}>»</button>
              </div>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}

// ── Negative Keywords tab — split into three campaign/ad-group-scoped views ──
// (rather than one account-wide dump): negative keyword Lists (shared sets),
// Campaign-level negatives added directly (not via a list), and Ad-Group-level
// negatives. Lists and Campaign-level only need a campaign selected; Ad Group
// level needs both campaign and ad group, since ad groups are scoped to a
// campaign.

const negSelectStyle = { padding:'7px 10px', border:'1px solid #dde9f5', borderRadius:6, fontSize:12.5, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff', minWidth:220 }

const NEG_SUB_TABS = [
  { id: 'lists',    label: 'Negative Keywords List' },
  { id: 'campaign', label: 'Campaign Level' },
  { id: 'adGroup',  label: 'Ad Group Level' },
]

function NegativeKeywordsTab({ selectedAccount }) {
  const [subTab, setSubTab] = useState('lists')
  const [campaigns,        setCampaigns]        = useState([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  const [campaignId,       setCampaignId]       = useState('')
  const [adGroups,        setAdGroups]        = useState([])
  const [adGroupsLoading, setAdGroupsLoading] = useState(false)
  const [adGroupId,       setAdGroupId]       = useState('')

  useEffect(() => {
    if (!selectedAccount) { setCampaigns([]); return }
    setCampaignsLoading(true)
    window.electronAPI.campaignList({ customerId: selectedAccount.id, hidePaused: false })
      .then(data => setCampaigns(sortByStatus(data || [])))
      .catch(() => setCampaigns([]))
      .finally(() => setCampaignsLoading(false))
  }, [selectedAccount])

  // Switching tab or account starts the picker fresh — a campaign chosen for
  // "Lists" shouldn't silently carry over into "Ad Group Level", etc.
  useEffect(() => { setCampaignId(''); setAdGroupId('') }, [subTab, selectedAccount])

  useEffect(() => {
    if (!selectedAccount || !campaignId || subTab !== 'adGroup') { setAdGroups([]); setAdGroupId(''); return }
    setAdGroupsLoading(true); setAdGroupId('')
    window.electronAPI.adGroupList({ customerId: selectedAccount.id, campaignId, hidePaused: false })
      .then(data => setAdGroups(sortByStatus(data || [])))
      .catch(() => setAdGroups([]))
      .finally(() => setAdGroupsLoading(false))
  }, [selectedAccount, campaignId, subTab])

  return (
    <div>
      <div style={{ display:'flex', borderBottom:'2px solid #eef2f7', marginBottom:16, flexWrap:'wrap' }}>
        {NEG_SUB_TABS.map(t => {
          const active = subTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              style={{
                padding:'9px 16px', fontSize:12.5, fontWeight: active?700:500,
                color: active?'#1a3a6b':'#888', background:'transparent', border:'none',
                borderBottom: active?'3px solid #1a3a6b':'3px solid transparent',
                marginBottom:-2, cursor:'pointer', transition:'all 0.15s',
              }}
            >{t.label}</button>
          )
        })}
      </div>

      <div className="card" style={{ padding:16, marginBottom:16 }}>
        <div style={{ display:'flex', gap:16, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div style={{ minWidth:240 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#555', marginBottom:4 }}>Campaign</div>
            {campaignsLoading ? (
              <div style={{ fontSize:12, color:'#aaa', padding:'7px 0' }}>Loading…</div>
            ) : (
              <select value={campaignId} onChange={e => setCampaignId(e.target.value)} style={negSelectStyle}>
                <option value="">Select a campaign…</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.status==='Paused'?' (Paused)':''}</option>
                ))}
              </select>
            )}
          </div>
          {subTab === 'adGroup' && (
            <div style={{ minWidth:240 }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#555', marginBottom:4 }}>Ad Group</div>
              {adGroupsLoading ? (
                <div style={{ fontSize:12, color:'#aaa', padding:'7px 0' }}>Loading…</div>
              ) : (
                <select value={adGroupId} onChange={e => setAdGroupId(e.target.value)} disabled={!campaignId} style={negSelectStyle}>
                  <option value="">{campaignId ? 'Select an ad group…' : 'Select a campaign first'}</option>
                  {adGroups.map(ag => (
                    <option key={ag.id} value={ag.id}>{ag.name}{ag.status==='Paused'?' (Paused)':''}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      </div>

      {subTab === 'lists'    && <NegativeListsPanel    selectedAccount={selectedAccount} campaignId={campaignId} />}
      {subTab === 'campaign' && <CampaignLevelNegPanel  selectedAccount={selectedAccount} campaignId={campaignId} />}
      {subTab === 'adGroup'  && <AdGroupLevelNegPanel   selectedAccount={selectedAccount} adGroupId={adGroupId} />}
    </div>
  )
}

// Accordion: list title collapsed by default, expand to see its keywords.
// The search box filters keywords across every list at once (matching lists
// auto-expand so results are visible immediately); each opened list's
// keyword table gets its own ReportTable instance for sorting/pagination
// (search disabled there — the panel-level search box already covers it).
const dangerBtn = { display:'inline-flex', alignItems:'center', gap:6, padding:'7px 14px', border:'1px solid #e05c2a', borderRadius:6, background:'#fff5f5', color:'#c0392b', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }

function NegativeListsPanel({ selectedAccount, campaignId }) {
  const [lists,    setLists]    = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [openIds,  setOpenIds]  = useState(() => new Set())
  const [search,   setSearch]   = useState('')
  const [selected, setSelected] = useState(() => new Set())

  function refresh() {
    if (!selectedAccount || !campaignId) { setLists([]); return }
    setLoading(true); setError(null)
    window.electronAPI.fetchNegativeListsForCampaign({ customerId: selectedAccount.id, campaignId })
      .then(data => setLists(data || []))
      .catch(e => setError(e.message || 'Failed to load negative keyword lists'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { setOpenIds(new Set()); setSearch(''); setSelected(new Set()); refresh() }, [selectedAccount, campaignId])

  const q = search.trim().toLowerCase()
  const filteredLists = useMemo(() => {
    if (!q) return lists
    return lists
      .map(list => ({ ...list, keywords: list.keywords.filter(k => k.text.toLowerCase().includes(q)) }))
      .filter(list => list.keywords.length > 0)
  }, [lists, q])

  // Auto-expand every list that has a match while searching; collapse back
  // to all-closed once the search is cleared.
  useEffect(() => {
    if (q) setOpenIds(new Set(filteredLists.map(l => l.id)))
    else setOpenIds(new Set())
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleOpen(id) {
    setOpenIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function toggleRow(key) {
    setSelected(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  }
  function toggleAllVisible(visibleKeys, allSelected) {
    setSelected(prev => {
      const next = new Set(prev)
      visibleKeys.forEach(k => allSelected ? next.delete(k) : next.add(k))
      return next
    })
  }

  const exportRows = filteredLists.flatMap(list => list.keywords.map(k => ({ List: list.name, Keyword: k.text, 'Match Type': k.matchType })))
  const selectedTexts = lists.flatMap(l => l.keywords).filter(k => selected.has(k.resourceName)).map(k => k.text)

  const flow = useReviewFlow({
    validateFn: () => window.electronAPI.removeSharedListNegatives({ customerId: selectedAccount.id, resourceNames: [...selected], validateOnly: true }),
    publishFn:  () => window.electronAPI.removeSharedListNegatives({ customerId: selectedAccount.id, resourceNames: [...selected] }),
  })

  function handleDone() { setSelected(new Set()); refresh() }

  if (!campaignId) return <div className="card" style={{ padding:40, textAlign:'center', color:'#aaa', fontSize:13 }}>Select a campaign to see its negative keyword lists.</div>
  if (error)   return <ErrorState message={error} onRetry={refresh} />
  if (loading) return <div className="card"><Skeleton rows={3} /></div>
  if (lists.length === 0) return <div className="card" style={{ padding:40, textAlign:'center', color:'#aaa', fontSize:13 }}>No negative keyword lists attached to this campaign.</div>

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
        <div style={{ flex:1, minWidth:220, display:'flex', alignItems:'center', gap:8, padding:'7px 12px', border:'1px solid #dde9f5', borderRadius:6, background:'#fff' }}>
          <Search size={13} style={{ color:'#aaa', flexShrink:0 }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Search keywords across all lists…"
            style={{ flex:1, border:'none', outline:'none', fontSize:12.5, color:'#1a3a6b', background:'transparent' }}
          />
          {search && <button onClick={() => setSearch('')} style={{ color:'#aaa', display:'flex', border:'none', background:'none', cursor:'pointer', padding:0 }}><X size={13} /></button>}
        </div>
        {selected.size > 0 && (
          <button onClick={flow.start} style={dangerBtn}><Trash2 size={13} /> Remove Selected ({selected.size})</button>
        )}
        <ExportButton data={exportRows} filename="negative-keyword-lists" />
        <ExportPdfButton accountName={selectedAccount?.name} section="Negative Keyword Lists" />
      </div>

      {filteredLists.length === 0 ? (
        <div className="card" style={{ padding:40, textAlign:'center', color:'#aaa', fontSize:13 }}>No keywords match "{search}".</div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filteredLists.map(list => {
            const open = openIds.has(list.id)
            return (
              <div key={list.id} className="card" style={{ overflow:'hidden' }}>
                <button
                  onClick={() => toggleOpen(list.id)}
                  style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'12px 16px', background:'#fff', border:'none', cursor:'pointer', textAlign:'left' }}
                >
                  <span style={{ display:'flex', alignItems:'center', gap:8 }}>
                    {open ? <ChevronDown size={15} color="#1a3a6b" /> : <ChevronRight size={15} color="#1a3a6b" />}
                    <span style={{ fontSize:13, fontWeight:700, color:'#1a3a6b' }}>{list.name}</span>
                  </span>
                  <span style={{ fontSize:11, color:'#888' }}>{list.keywords.length} keyword{list.keywords.length===1?'':'s'}</span>
                </button>
                {open && (
                  list.keywords.length === 0 ? (
                    <div style={{ padding:'10px 16px 16px', fontSize:12, color:'#aaa' }}>This list has no keywords.</div>
                  ) : (
                    <div style={{ borderTop:'1px solid #f0f4f8' }}>
                      <ReportTable
                        columns={NEG_LIST_KEYWORD_COLS}
                        data={list.keywords}
                        loading={false}
                        emptyMessage="This list has no keywords."
                        pagination defaultPageSize={10} noFilter
                        resizable
                        selectable rowKey={k => k.resourceName} selectedKeys={selected}
                        onToggleRow={toggleRow} onToggleAllVisible={toggleAllVisible}
                      />
                    </div>
                  )
                )}
              </div>
            )
          })}
        </div>
      )}

      <ReviewModal
        title="Remove Negative Keywords" subtitle={`${selected.size} selected`} flow={flow} onDone={handleDone}
        confirmLabel="Remove Keywords" confirmingLabel="Removing…"
        successMessage={`${selected.size} negative keyword${selected.size === 1 ? '' : 's'} removed.`}
        warningMessage="This removes these keywords from the negative keyword LIST itself — they'll stop being blocked in every campaign that list is attached to, not just this one."
        confirmCheckboxLabel="I understand this will remove live negative keywords from the shared list, affecting every campaign it's attached to."
      >
        <div style={{ fontSize:12, color:'#555' }}>Removing: <strong>{selectedTexts.join(', ')}</strong></div>
      </ReviewModal>
    </div>
  )
}

const NEG_LIST_KEYWORD_COLS = [
  { key: 'text',      label: 'Keyword',    sortable: true, align: 'left', width: 220, wrap: true },
  { key: 'matchType', label: 'Match Type', sortable: true, align: 'center', format: v => <StatusBadge value={v} type="match" /> },
]

const NEG_BASIC_COLS = [
  { key: 'text',      label: 'Keyword',    sortable: true, align: 'left', width: 220, wrap: true, format: (v, row) => <span style={{ color: kwStatusColor(row.status), fontWeight: 500 }}>{v}</span> },
  { key: 'matchType', label: 'Match Type', sortable: true, align: 'center', format: v => <StatusBadge value={v} type="match" /> },
  { key: 'status',    label: 'Status',     sortable: true, align: 'center', format: v => <StatusBadge value={v} /> },
]

function CampaignLevelNegPanel({ selectedAccount, campaignId }) {
  const [rows,     setRows]     = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [selected, setSelected] = useState(() => new Set())

  function refresh() {
    if (!selectedAccount || !campaignId) { setRows([]); return }
    setLoading(true); setError(null)
    window.electronAPI.fetchCampaignLevelNegatives({ customerId: selectedAccount.id, campaignId })
      .then(data => setRows(data || []))
      .catch(e => setError(e.message || 'Failed to load campaign-level negative keywords'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { setSelected(new Set()); refresh() }, [selectedAccount, campaignId])

  function toggleRow(key) {
    setSelected(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  }
  function toggleAllVisible(visibleKeys, allSelected) {
    setSelected(prev => {
      const next = new Set(prev)
      visibleKeys.forEach(k => allSelected ? next.delete(k) : next.add(k))
      return next
    })
  }

  const flow = useReviewFlow({
    validateFn: () => window.electronAPI.removeCampaignLevelNegatives({ customerId: selectedAccount.id, resourceNames: [...selected], validateOnly: true }),
    publishFn:  () => window.electronAPI.removeCampaignLevelNegatives({ customerId: selectedAccount.id, resourceNames: [...selected] }),
  })

  function handleDone() { setSelected(new Set()); refresh() }

  if (!campaignId) return <div className="card" style={{ padding:40, textAlign:'center', color:'#aaa', fontSize:13 }}>Select a campaign to see its campaign-level negative keywords.</div>
  if (error)   return <ErrorState message={error} onRetry={refresh} />
  return (
    <Section
      title={`Campaign-Level Negative Keywords (${rows.length})`}
      extra={
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {selected.size > 0 && <button onClick={flow.start} style={dangerBtn}><Trash2 size={13} /> Remove Selected ({selected.size})</button>}
          <ExportButton data={rows} filename="campaign-level-negatives" />
          <ExportPdfButton accountName={selectedAccount?.name} section="Campaign-Level Negative Keywords" />
        </div>
      }
    >
      <ReportTable columns={NEG_BASIC_COLS} data={rows} loading={loading}
        emptyMessage="No campaign-level negative keywords (not counting list-based ones) for this campaign."
        pagination defaultPageSize={25} resizable
        selectable rowKey={r => r.resourceName} selectedKeys={selected}
        onToggleRow={toggleRow} onToggleAllVisible={toggleAllVisible} />

      <ReviewModal
        title="Remove Negative Keywords" subtitle={`${selected.size} selected`} flow={flow} onDone={handleDone}
        confirmLabel="Remove Keywords" confirmingLabel="Removing…"
        successMessage={`${selected.size} negative keyword${selected.size === 1 ? '' : 's'} removed.`}
        warningMessage="This will remove these negative keywords from the campaign in Google Ads — previously blocked search traffic may start showing your ads again."
        confirmCheckboxLabel="I understand this will remove live negative keywords from the Google Ads account."
      >
        <div style={{ fontSize:12, color:'#555' }}>Removing: <strong>{rows.filter(r => selected.has(r.resourceName)).map(r => r.text).join(', ')}</strong></div>
      </ReviewModal>
    </Section>
  )
}

function AdGroupLevelNegPanel({ selectedAccount, adGroupId }) {
  const [rows,     setRows]     = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [selected, setSelected] = useState(() => new Set())

  function refresh() {
    if (!selectedAccount || !adGroupId) { setRows([]); return }
    setLoading(true); setError(null)
    window.electronAPI.fetchAdGroupLevelNegatives({ customerId: selectedAccount.id, adGroupId })
      .then(data => setRows(data || []))
      .catch(e => setError(e.message || 'Failed to load ad-group-level negative keywords'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { setSelected(new Set()); refresh() }, [selectedAccount, adGroupId])

  function toggleRow(key) {
    setSelected(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  }
  function toggleAllVisible(visibleKeys, allSelected) {
    setSelected(prev => {
      const next = new Set(prev)
      visibleKeys.forEach(k => allSelected ? next.delete(k) : next.add(k))
      return next
    })
  }

  const flow = useReviewFlow({
    validateFn: () => window.electronAPI.removeAdGroupLevelNegatives({ customerId: selectedAccount.id, resourceNames: [...selected], validateOnly: true }),
    publishFn:  () => window.electronAPI.removeAdGroupLevelNegatives({ customerId: selectedAccount.id, resourceNames: [...selected] }),
  })

  function handleDone() { setSelected(new Set()); refresh() }

  if (!adGroupId) return <div className="card" style={{ padding:40, textAlign:'center', color:'#aaa', fontSize:13 }}>Select a campaign and ad group to see its negative keywords.</div>
  if (error)   return <ErrorState message={error} onRetry={refresh} />
  return (
    <Section
      title={`Ad-Group-Level Negative Keywords (${rows.length})`}
      extra={
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {selected.size > 0 && <button onClick={flow.start} style={dangerBtn}><Trash2 size={13} /> Remove Selected ({selected.size})</button>}
          <ExportButton data={rows} filename="ad-group-level-negatives" />
          <ExportPdfButton accountName={selectedAccount?.name} section="Ad-Group-Level Negative Keywords" />
        </div>
      }
    >
      <ReportTable columns={NEG_BASIC_COLS} data={rows} loading={loading}
        emptyMessage="No ad-group-level negative keywords for this ad group."
        pagination defaultPageSize={25} resizable
        selectable rowKey={r => r.resourceName} selectedKeys={selected}
        onToggleRow={toggleRow} onToggleAllVisible={toggleAllVisible} />

      <ReviewModal
        title="Remove Negative Keywords" subtitle={`${selected.size} selected`} flow={flow} onDone={handleDone}
        confirmLabel="Remove Keywords" confirmingLabel="Removing…"
        successMessage={`${selected.size} negative keyword${selected.size === 1 ? '' : 's'} removed.`}
        warningMessage="This will remove these negative keywords from the ad group in Google Ads — previously blocked search traffic may start showing your ads again."
        confirmCheckboxLabel="I understand this will remove live negative keywords from the Google Ads account."
      >
        <div style={{ fontSize:12, color:'#555' }}>Removing: <strong>{rows.filter(r => selected.has(r.resourceName)).map(r => r.text).join(', ')}</strong></div>
      </ReviewModal>
    </Section>
  )
}

// ── All Keywords tab ──────────────────────────────────────────────────────────
const kwStatusColor = s => {
  const v = String(s || '').toUpperCase()
  if (['ENABLED','ELIGIBLE','2'].includes(v)) return '#2e7d32'
  if (['PAUSED','3'].includes(v))             return '#a56700'
  if (['REMOVED','4'].includes(v))            return '#9e9e9e'
  return '#1a3a6b'
}

function AllKeywordsTab({ rows, loading, onDrillDown, accountName }) {
  const [campaignFilter,       setCampaignFilter]       = useState('')
  const [adGroupFilter,        setAdGroupFilter]        = useState('')
  const [campaignStatusFilter, setCampaignStatusFilter] = useState('Enabled')
  const [adGroupStatusFilter,  setAdGroupStatusFilter]  = useState('')
  const [keywordStatusFilter,  setKeywordStatusFilter]  = useState('')

  const allRows = rows || []

  // Status options always from full dataset
  const campaignStatuses = useMemo(() => [...new Set(allRows.map(r => r.campaignStatus).filter(Boolean))].sort(), [allRows])
  const adGroupStatuses  = useMemo(() => [...new Set(allRows.map(r => r.adGroupStatus).filter(Boolean))].sort(), [allRows])
  const keywordStatuses  = useMemo(() => [...new Set(allRows.map(r => r.status).filter(Boolean))].sort(), [allRows])

  // Rows after status filters only — drives the name dropdowns so they only
  // show campaigns/ad groups that have keywords matching the active status filters
  const statusFiltered = useMemo(() =>
    allRows.filter(r =>
      (!campaignStatusFilter || r.campaignStatus === campaignStatusFilter) &&
      (!adGroupStatusFilter  || r.adGroupStatus  === adGroupStatusFilter)  &&
      (!keywordStatusFilter  || r.status         === keywordStatusFilter)
    )
  , [allRows, campaignStatusFilter, adGroupStatusFilter, keywordStatusFilter])

  const campaignNames = useMemo(() =>
    [...new Set(statusFiltered.map(r => r.campaign).filter(Boolean))].sort()
  , [statusFiltered])

  const adGroupNames = useMemo(() => {
    const source = campaignFilter
      ? statusFiltered.filter(r => r.campaign === campaignFilter)
      : statusFiltered
    return [...new Set(source.map(r => r.adGroup).filter(Boolean))].sort()
  }, [statusFiltered, campaignFilter])

  const filtered = useMemo(() =>
    statusFiltered.filter(r =>
      (!campaignFilter || r.campaign === campaignFilter) &&
      (!adGroupFilter  || r.adGroup  === adGroupFilter)
    )
  , [statusFiltered, campaignFilter, adGroupFilter])

  const hasFilter = campaignFilter || adGroupFilter || (campaignStatusFilter && campaignStatusFilter !== 'Enabled') || adGroupStatusFilter || keywordStatusFilter

  const cols = [
    { key:'text',            label:'Keyword',       sortable:true, align:'left', width:220, wrap:true,
      format: (v, row) => <span style={{ color: kwStatusColor(row.status), fontWeight:500 }}>{v}</span> },
    { key:'matchType',       label:'Match',         sortable:true, align:'center',
      format: v => <StatusBadge value={v} type="match"/> },
    { key:'campaign',        label:'Campaign',      sortable:true, align:'left',
      format: (v, row) => <span style={{ color: kwStatusColor(row.campaignStatus), fontWeight:500 }}>{v}</span> },
    { key:'adGroup',         label:'Ad Group',      sortable:true, align:'left',
      format: (v, row) => <span style={{ color: kwStatusColor(row.adGroupStatus), fontWeight:500 }}>{v}</span> },
    { key:'qualityScore',    label:'Quality Score', sortable:true, align:'center',
      format: v => <span style={{ fontSize:12, fontWeight:700, color:qsColor(v) }}>{v||'—'}</span> },
    { key:'impressions',     label:'Impr.',         sortable:true, align:'right', format:fmtNum },
    { key:'clicks',          label:'Clicks',        sortable:true, align:'right', format:fmtNum },
    { key:'ctr',             label:'CTR',           sortable:true, align:'right', format:fmtPct },
    { key:'cpc',             label:'CPC',           sortable:true, align:'right', format:fmtUsd },
    { key:'costPerConv',     label:'Cost / Conv',   sortable:true, align:'right',
      format:(v,row)=>fmtCostPerConv(row.cost,row.conversions), sortValue:row=>Number(row.conversions||0)>0?Number(row.cost||0)/Number(row.conversions):-1 },
    { key:'cost',            label:'Cost',          sortable:true, align:'right',
      format: v => '$'+Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) },
    { key:'conversions',     label:'Conv.',         sortable:true, align:'right', format:fmtNum },
    { key:'formConversions', label:'Form Conv.',    sortable:true, align:'right',
      format:(v,row)=><BreakdownCell value={v} breakdown={row.formBreakdown} entityLabel={row.text}
        modalTitle="Form Conversions" buttonTitle="View form conversion breakdown" rowLabel="Conversion Action"/> },
    { key:'phoneConversions',label:'Phone Conv.',   sortable:true, align:'right',
      format:(v,row)=><BreakdownCell value={v} breakdown={row.phoneBreakdown} entityLabel={row.text}
        modalTitle="Call Conversions" buttonTitle="View call conversion breakdown" rowLabel="Conversion Action"/> },
    { key:'phoneCalls',      label:'Call Leads',    sortable:true, align:'center',
      format: (v,row) => <CallLeadsBadge count={v} campaignName={row.campaign} onDrillDown={onDrillDown}/> },
  ]

  // Curated to match the displayed columns exactly — the raw rows carry
  // extra internal fields and unformatted numbers the table doesn't show.
  const allKwCsvRows = filtered.map(r => ({
    'Keyword':       r.text,
    'Match':         r.matchType,
    'Campaign':      r.campaign,
    'Ad Group':      r.adGroup,
    'Quality Score': r.qualityScore || '—',
    'Impr.':         fmtNum(r.impressions),
    'Clicks':        fmtNum(r.clicks),
    'CTR':           fmtPct(r.ctr),
    'CPC':           fmtUsd(r.cpc),
    'Cost / Conv':   fmtCostPerConv(r.cost, r.conversions),
    'Cost':          '$'+Number(r.cost||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}),
    'Conv.':         fmtNum(r.conversions),
    'Form Conv.':    fmtNum(r.formConversions),
    'Phone Conv.':   fmtNum(r.phoneConversions),
    'Call Leads':    fmtNum(r.phoneCalls),
  }))

  const selectStyle = { padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }

  return (
    <div className="card">
      {/* Filters */}
      <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f4f8', background:'#fafcff', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        {/* Name filters */}
        {[
          ['Campaign Name', campaignFilter,       v => { setCampaignFilter(v); setAdGroupFilter('') }, campaignNames],
          ['Ad Group Name', adGroupFilter,        setAdGroupFilter,                                    adGroupNames ],
        ].map(([label, value, onChange, opts]) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>{label}:</span>
            <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>
              <option value="">All</option>
              {opts.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        ))}

        {/* Status filters */}
        {[
          ['Campaign Status', campaignStatusFilter, setCampaignStatusFilter, campaignStatuses],
          ['Ad Group Status', adGroupStatusFilter,  setAdGroupStatusFilter,  adGroupStatuses ],
          ['Keyword Status',  keywordStatusFilter,  setKeywordStatusFilter,  keywordStatuses ],
        ].map(([label, value, onChange, opts]) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>{label}:</span>
            <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>
              <option value="">All</option>
              {opts.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        ))}

        {hasFilter && (
          <button onClick={() => { setCampaignFilter(''); setAdGroupFilter(''); setCampaignStatusFilter('Enabled'); setAdGroupStatusFilter(''); setKeywordStatusFilter('') }}
            style={{ fontSize:11, color:'#2563b0', background:'none', border:'1px solid #dde9f5', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
            Clear All
          </button>
        )}

        <div style={{ display:'flex', alignItems:'center', gap:12, marginLeft:'auto' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, fontWeight:600 }}>
            {[['#2e7d32','Enabled'],['#a56700','Paused'],['#9e9e9e','Removed']].map(([c,l])=>(
              <span key={l} style={{ display:'flex', alignItems:'center', gap:4, color:c }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:c, flexShrink:0, display:'inline-block' }}/>
                {l}
              </span>
            ))}
          </div>
          <ExportButton data={allKwCsvRows} filename="all-keywords"/>
          <ExportPdfButton accountName={accountName} section="All Keywords" />
        </div>
      </div>

      <ReportTable
        columns={cols}
        data={filtered}
        loading={loading}
        noFilter
        resizable
        defaultPageSize={25}
        emptyMessage="No keywords found for the selected filters"
      />
    </div>
  )
}

// ── Reusable Campaign Name + Campaign Status filter bar ───────────────────────
function CampFilterBar({ allData, campFilter, setCampFilter, campStatusFilter, setCampStatusFilter, adGroupFilter, setAdGroupFilter, kwStatusFilter, setKwStatusFilter }) {
  const selStyle = { padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }

  const campNames = useMemo(() =>
    [...new Set((campStatusFilter ? allData.filter(r => r.campaignStatus === campStatusFilter) : allData).map(r => r.campaign).filter(Boolean))].sort()
  , [allData, campStatusFilter])

  const campStatuses = useMemo(() =>
    [...new Set((campFilter ? allData.filter(r => r.campaign === campFilter) : allData).map(r => r.campaignStatus).filter(Boolean))].sort()
  , [allData, campFilter])

  const adGroupNames = useMemo(() => {
    if (!setAdGroupFilter) return []
    const source = campFilter ? allData.filter(r => r.campaign === campFilter) : allData
    return [...new Set(source.map(r => r.adGroup).filter(Boolean))].sort()
  }, [allData, campFilter, setAdGroupFilter])

  const kwStatuses = useMemo(() =>
    setKwStatusFilter ? [...new Set(allData.map(r => r.status).filter(Boolean))].sort() : []
  , [allData, setKwStatusFilter])

  const hasFilter = campFilter || (campStatusFilter && campStatusFilter !== 'Enabled') || (setAdGroupFilter && adGroupFilter) || (setKwStatusFilter && kwStatusFilter)

  return (
    <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f4f8', background:'#fafcff', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign Name:</span>
        <select value={campFilter} onChange={e => { setCampFilter(e.target.value); setCampStatusFilter('Enabled'); setAdGroupFilter?.('') }} style={selStyle}>
          <option value="">All</option>
          {campNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign Status:</span>
        <select value={campStatusFilter} onChange={e => { setCampStatusFilter(e.target.value); setCampFilter(''); setAdGroupFilter?.('') }} style={selStyle}>
          <option value="">All</option>
          {campStatuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {setAdGroupFilter && (
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Ad Group:</span>
          <select value={adGroupFilter} onChange={e => setAdGroupFilter(e.target.value)} style={selStyle}>
            <option value="">All</option>
            {adGroupNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}
      {setKwStatusFilter && (
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Keyword Status:</span>
          <select value={kwStatusFilter} onChange={e => setKwStatusFilter(e.target.value)} style={selStyle}>
            <option value="">All</option>
            {kwStatuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}
      {hasFilter && (
        <button onClick={() => { setCampFilter(''); setCampStatusFilter('Enabled'); setAdGroupFilter?.(''); setKwStatusFilter?.('') }}
          style={{ fontSize:11, color:'#2563b0', background:'none', border:'1px solid #dde9f5', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
          Clear
        </button>
      )}
      <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, fontWeight:600, marginLeft:'auto' }}>
        {[['#2e7d32','Enabled'],['#a56700','Paused'],['#9e9e9e','Removed']].map(([c,l]) => (
          <span key={l} style={{ display:'flex', alignItems:'center', gap:4, color:c }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background:c, flexShrink:0, display:'inline-block' }}/>
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Search Terms section ──────────────────────────────────────────────────────

function StatChip({ label, value, color = '#1a3a6b' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 10, color: '#4a4a4a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color }}>{value}</span>
    </div>
  )
}
function StatChipDivider() {
  return <div style={{ width: 1, background: '#b0c4de', alignSelf: 'stretch', margin: '0 4px' }} />
}

function SearchTermsSection({ selectedAccount, dateRange, hidePaused, existingKeywords, negData, setRows, setNegData }) {
  const [data,        setData]        = useState([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [stSearch,    setStSearch]    = useState('')
  const [stKeyword,   setStKeyword]   = useState('')
  const [stCampaign,  setStCampaign]  = useState('')
  const [stMatchType, setStMatchType] = useState('')
  const [stMinClicks, setStMinClicks] = useState('')
  const [stConvOnly,  setStConvOnly]  = useState(false)
  const [stAdGroup,   setStAdGroup]   = useState('')
  const [stAddedFilter, setStAddedFilter] = useState('')
  const [stPage,      setStPage]      = useState(1)
  const [stPageSize,  setStPageSize]  = useState(50)
  const [sortKey,     setSortKey]     = useState('')
  const [sortAsc,     setSortAsc]     = useState(true)
  const [selected,    setSelected]    = useState(new Set())
  const [publishRows, setPublishRows] = useState(null)

  // Switch K <-> NK — a separate selection from `selected` above (that one
  // is for brand-new, not-yet-added rows). Checking one row locks the rest
  // of the batch to the SAME current type (K or NK), since a single switch
  // action can only flip one direction at a time.
  const [switchSelected, setSwitchSelected] = useState(new Set())
  const [switchRows,     setSwitchRows]     = useState(null)

  // Triggered Keyword column width is user-adjustable (drag the header
  // edge) — it used to hard-truncate to 190px with an ellipsis inside its
  // own cell styling, cutting off longer keywords entirely.
  const [tkColWidth, setTkColWidth] = useState(200)
  const tkDragRef = React.useRef(null)
  useEffect(() => {
    function onMove(e) {
      if (!tkDragRef.current) return
      setTkColWidth(Math.max(100, tkDragRef.current.startWidth + e.clientX - tkDragRef.current.startX))
    }
    function onUp() {
      if (!tkDragRef.current) return
      tkDragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])
  function startTkResize(e) {
    e.preventDefault(); e.stopPropagation()
    tkDragRef.current = { startX: e.clientX, startWidth: tkColWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    if (!selectedAccount?.id) return
    setData([]); setLoading(true); setError(null)
    window.electronAPI.fetchSearchTerms({ customerId: selectedAccount.id, dateRange })
      .then(res => { if (res.error) setError(res.error); else setData(res.data || []) })
      .catch(e => setError(e.message || 'Failed to load search terms'))
      .finally(() => setLoading(false))
  }, [selectedAccount?.id, dateRange])

  useEffect(() => { setStPage(1); setSelected(new Set()); setSwitchSelected(new Set()) }, [stSearch, stKeyword, stCampaign, stAdGroup, stMatchType, stMinClicks, stConvOnly, stAddedFilter])

  const campaigns = useMemo(() => [...new Set(data.map(r => r.campaignName).filter(Boolean))].sort(), [data])

  const adGroups = useMemo(() => {
    const source = stCampaign ? data.filter(r => r.campaignName === stCampaign) : data
    return [...new Set(source.map(r => r.adGroupName).filter(Boolean))].sort()
  }, [data, stCampaign])

  // Flags a search term already added as a keyword or negative keyword, so
  // the row shows a K/NK badge instead of a selectable checkbox — otherwise
  // there's no way to tell, after coming back to this tab, whether a term
  // you published earlier actually went through. Clicking the badge shows
  // which existing keyword(s)/negative(s) it matches. Computed ahead of
  // `filtered` so the Added Status filter below can use it too.
  const kwMap   = useMemo(() => buildKwMap(existingKeywords), [existingKeywords])
  const negMaps = useMemo(() => buildNegMaps(negData?.existingNegatives), [negData])
  function getSignal(row) { return resolveKwSignal(row.searchTerm, row.campaignName, row.adGroupName, kwMap, negMaps) }

  const filtered = useMemo(() => data.filter(row => {
    if (hidePaused && row.campaignStatus === 'Paused') return false
    if (stSearch    && !row.searchTerm.toLowerCase().includes(stSearch.toLowerCase())) return false
    if (stKeyword   && !(row.triggeredKeyword || '').toLowerCase().includes(stKeyword.toLowerCase())) return false
    if (stCampaign  && row.campaignName !== stCampaign) return false
    if (stAdGroup   && row.adGroupName  !== stAdGroup)  return false
    if (stMatchType && row.matchType    !== stMatchType) return false
    if (stMinClicks && row.clicks < Number(stMinClicks)) return false
    if (stConvOnly  && (row.conversions + row.phoneCalls) === 0) return false
    if (stAddedFilter) {
      const status = getSignal(row)?.status || 'none'
      if (stAddedFilter !== status) return false
    }
    return true
  }), [data, hidePaused, stSearch, stKeyword, stCampaign, stAdGroup, stMatchType, stMinClicks, stConvOnly, stAddedFilter, kwMap, negMaps])

  // costPerConv isn't a real field on the row — it's derived (cost / (conversions
  // + phoneCalls), -1 when there's no conversion), so it needs its own branch
  // rather than falling through to the generic a[sortKey]/b[sortKey] compare.
  const stCostPerConvOf = r => (Number(r.conversions||0) + Number(r.phoneCalls||0)) > 0
    ? Number(r.cost||0) / (Number(r.conversions||0) + Number(r.phoneCalls||0)) : -1

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    return [...filtered].sort((a, b) => {
      if (sortKey === 'costPerConv') { const cmp = stCostPerConvOf(a) - stCostPerConvOf(b); return sortAsc ? cmp : -cmp }
      const av = a[sortKey], bv = b[sortKey]
      if (av == null) return 1; if (bv == null) return -1
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortAsc ? cmp : -cmp
    })
  }, [filtered, sortKey, sortAsc])

  const paged      = sorted.slice((stPage - 1) * stPageSize, stPage * stPageSize)
  const totalPages = Math.max(1, Math.ceil(sorted.length / stPageSize))

  const [signalModal, setSignalModal] = useState(null)
  const selectableIdx = paged.map((_, i) => i).filter(i => !getSignal(paged[i]))

  function toggleSort(key) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  function toggleRow(idx) {
    setSelected(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n })
  }

  // Switch K <-> NK — locked to whichever status (keyword/negative) the
  // FIRST selected row has, so a batch can't mix K and NK (they'd need
  // different destination types).
  const switchLockedStatus = switchSelected.size > 0 ? getSignal(paged[[...switchSelected][0]])?.status : null
  function toggleSwitchRow(idx) {
    setSwitchSelected(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n })
  }
  function startSwitch() {
    const rowsToSwitch = [...switchSelected].map(i => paged[i]).filter(Boolean)
    if (rowsToSwitch.length) setSwitchRows(rowsToSwitch)
  }
  // Built fresh (not stored) whenever switchRows is set, so it always
  // reflects the current kwMap/negMaps rather than a stale snapshot.
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
    if (removedKeywordRNs.size) setRows?.(prev => (prev || []).filter(k => !removedKeywordRNs.has(k.resourceName)))
    if (removedNegRNs.size) setNegData?.(prev => ({ ...(prev || {}), existingNegatives: (prev?.existingNegatives || []).filter(n => !removedNegRNs.has(n.resourceName)) }))
  }

  const stTotalClicks  = data.reduce((s, r) => s + r.clicks,  0)
  const stTotalSpend   = data.reduce((s, r) => s + r.cost,    0)
  const stTotalConv    = data.reduce((s, r) => s + r.conversions + r.phoneCalls, 0)
  const stConverting   = data.filter(r => (r.conversions + r.phoneCalls) > 0).length
  const stWastedSpend  = data.filter(r => (r.conversions + r.phoneCalls) === 0 && r.cost > 10).reduce((s, r) => s + r.cost, 0)

  const exportData = filtered.map(r => ({
    'Search Term':       r.searchTerm,
    'Status':            r.searchTermStatus,
    'Triggered Keyword': r.triggeredKeyword,
    'Match Type':        r.matchType,
    'Campaign':          r.campaignName,
    'Ad Group':          r.adGroupName,
    'Impressions':       r.impressions,
    'Clicks':            r.clicks,
    'Cost':              '$' + r.cost.toFixed(2),
    'CTR':               (r.ctr).toFixed(2) + '%',
    'Avg CPC':           '$' + r.avgCpc.toFixed(2),
    // Matches the table's "Conv." badge, which is conversions + phone calls
    // combined — not r.conversions alone.
    'Cost / Conv':       fmtCostPerConv(r.cost, r.conversions + r.phoneCalls),
    'Conversions':       r.conversions + r.phoneCalls,
    'Phone Calls':       r.phoneCalls,
    'Conv Rate':         r.convRate.toFixed(2) + '%',
  }))

  const columns = [
    { key: 'searchTerm', label: 'Search Term', sortable: true, align: 'left', width: 220, wrap: true,
      format: (v, row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, color: '#1a3a6b', fontWeight: 500 }}>{v}</span>
          {row.searchTermStatus === 'Excluded' && (
            <span style={{ fontSize: 10, background: '#fdecea', color: '#c62828', border: '1px solid #e05c2a',
              borderRadius: 99, padding: '1px 6px', display: 'inline-block', width: 'fit-content' }}>Excluded</span>
          )}
        </div>
      )},
    { key: 'triggeredKeyword', label: 'Triggered Keyword', sortable: true, align: 'left', width: tkColWidth,
      format: (v, row) => (
        <span style={{ fontSize: 12, color: '#2563b0', background: '#e3f2fd', borderRadius: 4,
          padding: '2px 8px', display: 'inline-block', maxWidth: tkColWidth,
          whiteSpace: 'normal', wordBreak: 'break-word' }}>
          {v}{v && v !== '—' && row.matchType && row.matchType !== '—' ? ` (${row.matchType})` : ''}
        </span>
      )},
    { key: 'campaignName', label: 'Campaign', sortable: true, align: 'left', width: 180,
      format: v => <span title={v} style={{ fontSize: 12, color: '#4a4a4a', display: 'block',
        maxWidth: 175, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span> },
    { key: 'adGroupName', label: 'Ad Group', sortable: true, align: 'left', width: 160,
      format: v => <span title={v} style={{ fontSize: 12, color: '#4a4a4a', display: 'block',
        maxWidth: 155, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span> },
    { key: 'impressions', label: 'Impr.',   sortable: true, align: 'right', format: v => Number(v).toLocaleString() },
    { key: 'clicks',      label: 'Clicks',  sortable: true, align: 'right', format: v => Number(v).toLocaleString() },
    { key: 'ctr',         label: 'CTR',     sortable: true, align: 'right', format: v => Number(v).toFixed(2) + '%' },
    { key: 'cost',        label: 'Cost',    sortable: true, align: 'right',
      format: v => '$' + Number(v).toFixed(2),
      colorFn: v => Number(v) > 100 ? '#c62828' : Number(v) > 50 ? '#a56700' : '#2e7d32' },
    { key: 'avgCpc',      label: 'Avg CPC', sortable: true, align: 'right', format: v => '$' + Number(v).toFixed(2) },
    { key: 'costPerConv', label: 'Cost / Conv', sortable: true, align: 'right',
      format: (v, row) => fmtCostPerConv(row.cost, Number(row.conversions||0) + Number(row.phoneCalls||0)),
      sortValue: row => (Number(row.conversions||0) + Number(row.phoneCalls||0)) > 0 ? Number(row.cost||0) / (Number(row.conversions||0) + Number(row.phoneCalls||0)) : -1 },
    { key: 'conversions', label: 'Conv.',   sortable: true, align: 'right',
      format: (v, row) => {
        const total = Number(v) + Number(row.phoneCalls ?? 0)
        if (total === 0) return <span style={{ color: '#9e9e9e' }}>—</span>
        return <span style={{ background: '#e8f5e9', color: '#2e7d32', border: '1px solid #4caf50',
          borderRadius: 99, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{total}</span>
      }},
  ]

  const selStyle = { fontSize: 12, padding: '6px 10px', border: '1px solid #dde9f5', borderRadius: 6, color: '#4a4a4a', outline: 'none', background: '#fff' }

  if (error) return (
    <Section title="Search Terms">
      <div style={{ padding: '24px 16px', display: 'flex', gap: 10, alignItems: 'center', color: '#c0392b', fontSize: 13 }}>
        <AlertCircle size={16} />{error}
      </div>
    </Section>
  )

  return (
    <Section title="Search Terms" extra={
      <div style={{ display:'flex', gap:8 }}>
        <ExportButton data={exportData} filename={`search-terms-${selectedAccount?.id}`} label="Export CSV"/>
        <ExportPdfButton accountName={selectedAccount?.name} section="Search Terms" />
      </div>
    }>
      {/* Stats bar */}
      {!loading && data.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', background: '#dde9f5',
          borderRadius: 8, padding: '10px 16px', margin: '12px 16px 0' }}>
          <StatChip label="Total terms"      value={data.length.toLocaleString()} />
          <StatChipDivider />
          <StatChip label="Total clicks"     value={stTotalClicks.toLocaleString()} />
          <StatChipDivider />
          <StatChip label="Total spend"      value={'$' + stTotalSpend.toFixed(2)} />
          <StatChipDivider />
          <StatChip label="Converting terms" value={stConverting} color="#2e7d32" />
          <StatChipDivider />
          <StatChip label="Wasted spend"     value={'$' + stWastedSpend.toFixed(2)} color="#c62828" />
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px' }}>
        <input placeholder="Search terms…" value={stSearch} onChange={e => setStSearch(e.target.value)}
          style={{ width: 180, fontSize: 12, padding: '6px 10px', border: '1px solid #dde9f5', borderRadius: 6, color: '#4a4a4a', outline: 'none' }} />
        <input placeholder="Keyword…" value={stKeyword} onChange={e => setStKeyword(e.target.value)}
          style={{ width: 160, fontSize: 12, padding: '6px 10px', border: '1px solid #dde9f5', borderRadius: 6, color: '#4a4a4a', outline: 'none' }} />
        <select value={stCampaign} onChange={e => { setStCampaign(e.target.value); setStAdGroup('') }} style={selStyle}>
          <option value="">All campaigns</option>
          {campaigns.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={stAdGroup} onChange={e => setStAdGroup(e.target.value)} style={selStyle}>
          <option value="">All ad groups</option>
          {adGroups.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={stMatchType} onChange={e => setStMatchType(e.target.value)} style={selStyle}>
          <option value="">All match types</option>
          <option value="Broad">Broad</option>
          <option value="Phrase">Phrase</option>
          <option value="Exact">Exact</option>
        </select>
        <input type="number" placeholder="Min clicks" min={0} value={stMinClicks}
          onChange={e => setStMinClicks(e.target.value)}
          style={{ width: 100, fontSize: 12, padding: '6px 10px', border: '1px solid #dde9f5', borderRadius: 6, color: '#4a4a4a', outline: 'none' }} />
        <select value={stAddedFilter} onChange={e => setStAddedFilter(e.target.value)} style={selStyle}>
          <option value="">Added status: All</option>
          <option value="none">Not added yet</option>
          <option value="keyword">Already added (Keyword)</option>
          <option value="negative">Already added (Negative)</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#4a4a4a', cursor: 'pointer' }}>
          <input type="checkbox" checked={stConvOnly} onChange={e => setStConvOnly(e.target.checked)} />
          Converting only
        </label>
        {(stSearch || stKeyword || stCampaign || stAdGroup || stMatchType || stMinClicks || stConvOnly || stAddedFilter) && (
          <button onClick={() => { setStSearch(''); setStKeyword(''); setStCampaign(''); setStAdGroup(''); setStMatchType(''); setStMinClicks(''); setStConvOnly(false); setStAddedFilter('') }}
            style={{ fontSize: 11, color: '#2563b0', background: 'none', border: '1px solid #dde9f5', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}>
            Clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#4a4a4a' }}>
          {filtered.length.toLocaleString()} of {data.length.toLocaleString()} terms
        </span>
      </div>

      {/* Bulk publish toolbar */}
      {selected.size > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 16px', background:'#e8f0fb', borderBottom:'1px solid #c3d4f0' }}>
          <span style={{ fontSize:13, color:'#1a3a6b', fontWeight:600 }}>{selected.size} term{selected.size!==1?'s':''} selected</span>
          <button
            onClick={() => setPublishRows([...selected].map(i => paged[i]).filter(Boolean))}
            style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 16px', background:'#1a3a6b', color:'#fff', fontSize:12, fontWeight:700, borderRadius:6, border:'none', cursor:'pointer' }}>
            🚀 Proceed to Publish {selected.size} selected
          </button>
          <button onClick={() => setSelected(new Set())}
            style={{ fontSize:12, color:'#555', background:'none', border:'1px solid #dde9f5', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
            Clear
          </button>
        </div>
      )}

      {/* Bulk switch toolbar — K <-> NK */}
      {switchSelected.size > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 16px', background:'#fff3e0', borderBottom:'1px solid #ffcc80' }}>
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

      {/* Table */}
      {loading
        ? <div style={{ padding:20 }}><div className="skeleton" style={{ height:300, borderRadius:6 }}/></div>
        : paged.length === 0
          ? <div style={{ padding:'28px 0', textAlign:'center', color:'#aaa', fontSize:13 }}>No search terms found for this period.</div>
          : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr>
                    <th style={{ background:'#1a3a6b', color:'#fff', padding:'9px 10px', width:38, textAlign:'center', position:'sticky', top:0, zIndex:2 }}>
                      <input type="checkbox"
                        checked={selectableIdx.length > 0 && selected.size === selectableIdx.length}
                        onChange={e => setSelected(e.target.checked ? new Set(selectableIdx) : new Set())}
                      />
                    </th>
                    {columns.map(c => {
                      const active = sortKey === c.key
                      return (
                        <th key={c.key}
                          onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                          style={{ background: active ? '#0f2850' : '#1a3a6b', color:'#fff', padding:'9px 10px',
                            textAlign: c.align || 'left', fontSize:11, fontWeight:600, whiteSpace:'nowrap',
                            position:'sticky', top:0, zIndex:2, minWidth: c.width || undefined,
                            cursor: c.sortable ? 'pointer' : 'default', userSelect:'none' }}>
                          <span style={{ display:'inline-flex', alignItems:'center', gap:3, justifyContent: c.align==='right' ? 'flex-end' : c.align==='center' ? 'center' : 'flex-start' }}>
                            {c.label}
                            {c.sortable && <span style={{ fontSize:9, opacity: active ? 1 : 0.35 }}>{active ? (sortAsc ? '▲' : '▼') : '⬍'}</span>}
                          </span>
                          {c.key === 'triggeredKeyword' && (
                            <span
                              onClick={e => e.stopPropagation()}
                              onMouseDown={startTkResize}
                              title="Drag to resize column"
                              style={{ position:'absolute', right:0, top:0, bottom:0, width:6, cursor:'col-resize', display:'inline-block' }}
                            />
                          )}
                        </th>
                      )
                    })}
                    <th style={{ background:'#1a3a6b', color:'#fff', padding:'9px 10px', width:80, textAlign:'center', position:'sticky', top:0, zIndex:2 }}>Publish</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row, vi) => {
                    const hasConv = (Number(row.conversions||0) + Number(row.phoneCalls||0)) > 0
                    const signal  = getSignal(row)
                    return (
                      <tr key={vi} style={{ background: selected.has(vi) ? '#e8f0fb' : vi%2===0 ? '#fff' : '#f5f7fa' }}>
                        <td style={{ padding:'8px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                          {signal ? (
                            <KwSignalBadge status={signal.status} onClick={() => setSignalModal(signal)} />
                          ) : (
                            <input type="checkbox" checked={selected.has(vi)} onChange={() => toggleRow(vi)}/>
                          )}
                        </td>
                        {columns.map((c, ci) => {
                          const raw = row[c.key]
                          const cell = c.format ? c.format(raw, row) : raw ?? '—'
                          const color = c.colorFn ? c.colorFn(raw) : undefined
                          return (
                            <td key={c.key} style={{
                              padding:'8px 10px', borderBottom:'1px solid #f0f4f8',
                              textAlign: c.align || 'left', color: color || (ci===0 ? '#1a3a6b' : '#4a4a4a'),
                              fontWeight: ci===0 ? 500 : 400,
                            }}>
                              {cell}
                            </td>
                          )
                        })}
                        <td style={{ padding:'7px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                          {signal ? (() => {
                            const switchDisabled = !!switchLockedStatus && switchLockedStatus !== signal.status
                            return (
                              <label style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11,
                                color: switchDisabled ? '#ccc' : '#a56700', cursor: switchDisabled ? 'not-allowed' : 'pointer' }}>
                                <input type="checkbox" disabled={switchDisabled} checked={switchSelected.has(vi)} onChange={() => toggleSwitchRow(vi)} />
                                Switch
                              </label>
                            )
                          })() : (
                            <button
                              onClick={() => setPublishRows([row])}
                              style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px',
                                fontSize:11, fontWeight:600, borderRadius:5, cursor:'pointer', whiteSpace:'nowrap',
                                border:'1px solid #1a3a6b', background:'#1a3a6b', color:'#fff' }}>
                              🚀 Proceed to Publish
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
      }

      {/* Pagination */}
      {!loading && sorted.length > 0 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'10px 16px', fontSize:12, color:'#4a4a4a', borderTop:'1px solid #f0f4f8', flexShrink:0, flexWrap:'wrap', gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:12, color:'#888' }}>Rows per page:</span>
            <select value={stPageSize} onChange={e => { setStPageSize(Number(e.target.value)); setStPage(1) }}
              style={{ padding:'4px 8px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer' }}>
              {[10,25,50,100,250].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:12, color:'#888' }}>{((stPage-1)*stPageSize)+1}–{Math.min(stPage*stPageSize, sorted.length)} of {sorted.length}</span>
            {totalPages > 1 && (
              <div style={{ display:'flex', gap:6 }}>
                <button onClick={() => setStPage(1)} disabled={stPage===1}
                  style={{ padding:'4px 8px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background:stPage===1?'#f5f7fa':'#fff', color:stPage===1?'#aaa':'#1a3a6b', cursor:stPage===1?'not-allowed':'pointer' }}>«</button>
                <button onClick={() => setStPage(p => Math.max(1, p-1))} disabled={stPage===1}
                  style={{ padding:'4px 10px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:6,
                    background: stPage===1 ? '#f5f7fa' : '#fff', color: stPage===1 ? '#9e9e9e' : '#1a3a6b',
                    cursor: stPage===1 ? 'default' : 'pointer' }}>‹ Prev</button>
                <span style={{ padding:'4px 8px', fontSize:12, color:'#4a4a4a', border:'1px solid #dde9f5', borderRadius:5, background:'#f5f7fa' }}>Page {stPage} of {totalPages}</span>
                <button onClick={() => setStPage(p => Math.min(totalPages, p+1))} disabled={stPage>=totalPages}
                  style={{ padding:'4px 10px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:6,
                    background: stPage>=totalPages ? '#f5f7fa' : '#fff', color: stPage>=totalPages ? '#9e9e9e' : '#1a3a6b',
                    cursor: stPage>=totalPages ? 'default' : 'pointer' }}>Next ›</button>
                <button onClick={() => setStPage(totalPages)} disabled={stPage>=totalPages}
                  style={{ padding:'4px 8px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background:stPage>=totalPages?'#f5f7fa':'#fff', color:stPage>=totalPages?'#aaa':'#1a3a6b', cursor:stPage>=totalPages?'not-allowed':'pointer' }}>»</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Publish modal */}
      <KwSignalModal signal={signalModal} onClose={() => setSignalModal(null)} />

      {publishRows && selectedAccount && (
        <SearchTermPublishModal
          rows={publishRows}
          selectedAccount={selectedAccount}
          initialCampaignId={publishRows[0]?.campaignId}
          initialAdGroupId={publishRows[0]?.adGroupId}
          onClose={() => setPublishRows(null)}
          onSuccess={payload => {
            const { keywords, negatives } = buildOptimisticPublishRecords(payload)
            if (keywords.length)  setRows?.(prev => [...(prev || []), ...keywords])
            if (negatives.length) setNegData?.(prev => ({ ...(prev || {}), existingNegatives: [...(prev?.existingNegatives || []), ...negatives] }))
            setPublishRows(null); setSelected(new Set())
          }}
        />
      )}

      {switchRows && selectedAccount && (
        <SearchTermPublishModal
          rows={switchRows}
          selectedAccount={selectedAccount}
          lockKwType={switchToKwType}
          initialLevel="Ad Group"
          initialCampaignId={switchRows[0]?.campaignId}
          initialAdGroupId={switchRows[0]?.adGroupId}
          removalByRow={switchRemovalByRow}
          onRemoved={handleSwitchRemoved}
          onClose={() => setSwitchRows(null)}
          onSuccess={payload => {
            const { keywords, negatives } = buildOptimisticPublishRecords(payload)
            if (keywords.length)  setRows?.(prev => [...(prev || []), ...keywords])
            if (negatives.length) setNegData?.(prev => ({ ...(prev || {}), existingNegatives: [...(prev?.existingNegatives || []), ...negatives] }))
            setSwitchRows(null); setSwitchSelected(new Set())
          }}
        />
      )}
    </Section>
  )
}

// ── Keyword page tabs ─────────────────────────────────────────────────────────
// Two-tier: a top-level group (Keywords / Negative Keywords / Search Terms)
// plus sub-tabs within it. `activeTab` (the leaf id) stays the single source
// of truth — the active group is derived from it — so every existing
// `activeTab === '<id>'` content block below needed no changes at all.
const KW_GROUPS = [
  {
    id: 'keywords', label: 'Keywords',
    tabs: [
      { id: 'overview',     label: 'Overview' },
      { id: 'all',          label: 'Top Keywords by Impression' },
      { id: 'converting',   label: 'Top Converting Keywords' },
      { id: 'overspending', label: 'Overspending Keywords' },
      { id: 'allKeywords',  label: 'All Keywords' },
    ],
  },
  {
    id: 'negative', label: 'Negative Keywords',
    tabs: [
      { id: 'negativeKeywords', label: 'Negative Keywords' },
    ],
  },
  {
    id: 'searchTerms', label: 'Search Terms',
    tabs: [
      { id: 'searchTerms',    label: 'All Search Terms' },
      { id: 'negKeywordsRec', label: 'Search Terms Recommended as Negative Keywords' },
    ],
  },
]

// ── Main Keywords component ───────────────────────────────────────────────────
export default function Keywords({ selectedAccount, dateRange, hidePaused }) {
  const navigate   = useNavigate()
  const [rows,            setRows]            = useState(null)
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState(null)
  const [filter,          setFilter]          = useState('')
  const [activeTab,       setActiveTab]       = useState('overview')
  // Filters for Top Keywords by Impression tab
  const [kwCampFilter,    setKwCampFilter]    = useState('')
  const [kwCampStatus,    setKwCampStatus]    = useState('Enabled')
  const [kwKwStatus,      setKwKwStatus]      = useState('')
  // Filters for Top Converting tab
  const [tcCampFilter,      setTcCampFilter]      = useState('')
  const [tcCampStatus,      setTcCampStatus]      = useState('Enabled')
  const [tcAdGroupFilter,   setTcAdGroupFilter]   = useState('')
  const [tcKwStatus,        setTcKwStatus]        = useState('')
  const [negData,    setNegData]    = useState(null)
  const [negLoading, setNegLoading] = useState(false)
  const [negError,   setNegError]   = useState(null)

  useEffect(() => {
    if (!selectedAccount) return
    loadKeywords()
  }, [selectedAccount, dateRange])

  // Reset to overview when account changes
  useEffect(() => { setActiveTab('overview'); setNegData(null) }, [selectedAccount])

  // Fetch account-wide negative keyword data for the search-term-recommendation
  // tab — the Negative Keywords tab itself is self-sufficient (campaign/ad-group
  // scoped queries triggered by its own pickers), so it no longer needs this.
  useEffect(() => {
    // Search Terms also needs this — to flag terms already added as a
    // negative keyword (see SearchTermsSection's K/NK badges).
    if (!['negKeywordsRec', 'searchTerms'].includes(activeTab) || !selectedAccount || negData || negLoading) return
    setNegLoading(true); setNegError(null)
    window.electronAPI.fetchNegatives({ customerId: selectedAccount.id, dateRange })
      .then(d => setNegData(d))
      .catch(e => setNegError(e.message || 'Failed to load negative keywords'))
      .finally(() => setNegLoading(false))
  }, [activeTab, selectedAccount, dateRange])


  async function loadKeywords() {
    setLoading(true); setError(null); setRows(null)
    try {
      const data = await window.electronAPI.fetchReport({
        customerId: selectedAccount.id,
        dateRange,
        reportType: 'keywords',
      })
      setRows(data)
    } catch(err) { setError(err.message || 'Failed to load keywords') }
    finally { setLoading(false) }
  }

  function handleCallDrillDown(campaignName) {
    navigate('/reports', { state: { initialTab: 'callLeads', campaignFilter: campaignName } })
  }

  if (!selectedAccount) {
    return (
      <div style={{flex:1,overflowY:'auto',padding:'20px 24px',background:'#f5f7fa'}}>
        <NoAccount/>
      </div>
    )
  }

  const filtered = useMemo(() => {
    if (!rows) return []
    let r = rows
    if (kwCampFilter)  r = r.filter(row => row.campaign       === kwCampFilter)
    if (kwCampStatus)  r = r.filter(row => row.campaignStatus === kwCampStatus)
    if (kwKwStatus)    r = r.filter(row => row.status         === kwKwStatus)
    if (filter.trim()) {
      const q = filter.toLowerCase()
      r = r.filter(row => (row.text||'').toLowerCase().includes(q) || (row.campaign||'').toLowerCase().includes(q))
    }
    return r
  }, [rows, filter, kwCampFilter, kwCampStatus, kwKwStatus])

  // Curated to match KwTable's displayed columns exactly.
  const topImprCsvRows = filtered.map(r => ({
    'Keyword':       r.text,
    'Match':         r.matchType,
    'Campaign':      r.campaign,
    'Ad Group':      r.adGroup || '—',
    'Quality Score': r.qualityScore || '—',
    'Impr.':         fmtNum(r.impressions),
    'Clicks':        fmtNum(r.clicks),
    'CTR':           fmtPct(r.ctr),
    'CPC':           fmtUsd(r.cpc),
    'Cost':          '$'+Number(r.cost||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}),
    'Conv.':         fmtNum(r.conversions),
    'Form Conv.':    fmtNum(r.formConversions),
    'Phone Conv.':   fmtNum(r.phoneConversions),
    'Call Leads':    fmtNum(r.phoneCalls),
  }))

  const tcFiltered = useMemo(() => {
    if (!rows) return []
    let r = rows
    if (tcCampFilter)    r = r.filter(row => row.campaign       === tcCampFilter)
    if (tcCampStatus)    r = r.filter(row => row.campaignStatus === tcCampStatus)
    if (tcAdGroupFilter) r = r.filter(row => row.adGroup        === tcAdGroupFilter)
    if (tcKwStatus)      r = r.filter(row => row.status         === tcKwStatus)
    return r
  }, [rows, tcCampFilter, tcCampStatus, tcAdGroupFilter, tcKwStatus])

  const activeGroup = KW_GROUPS.find(g => g.tabs.some(t => t.id === activeTab)) || KW_GROUPS[0]

  const totalPhoneCalls = (rows||[]).reduce((s,k) => s + (k.phoneCalls||0), 0)
  const kwsWithCalls    = (rows||[]).filter(k => (k.phoneCalls||0) > 0).length
  const topCallKw       = totalPhoneCalls > 0
    ? [...(rows||[])].sort((a,b) => (b.phoneCalls||0) - (a.phoneCalls||0))[0]
    : null

  const callSummaryBar = !loading && totalPhoneCalls > 0 && (
    <div style={{ display:'flex', alignItems:'center', gap:20, padding:'10px 16px', background:'#dde9f5', borderRadius:8, marginBottom:16, fontSize:13, color:'#1a3a6b', flexWrap:'wrap' }}>
      <span style={{ display:'flex', alignItems:'center', gap:6, fontWeight:600 }}>
        <Phone size={14}/> Total Phone Calls: {totalPhoneCalls.toLocaleString()}
      </span>
      <span style={{ color:'#888' }}>|</span>
      <span>Keywords generating calls: <strong>{kwsWithCalls}</strong></span>
      {topCallKw && <>
        <span style={{ color:'#888' }}>|</span>
        <span>Top keyword: <strong>"{topCallKw.text}"</strong> ({topCallKw.phoneCalls} calls)</span>
      </>}
    </div>
  )

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#f5f7fa', overflow:'hidden' }}>

      {/* ── Top-level group tab bar ── */}
      <div className="tab-bar-scroll" style={{ background:'#1a3a6b', borderBottom:'1px solid rgba(255,255,255,0.1)', padding:'0 24px', display:'flex', gap:0, flexShrink:0, overflowX:'auto' }}>
        {KW_GROUPS.map(g => {
          const active = activeGroup.id === g.id
          return (
            <button
              key={g.id}
              onClick={() => setActiveTab(g.tabs[0].id)}
              style={{
                padding:'12px 20px', fontSize:13, fontWeight: active ? 600 : 400,
                color: active ? '#ffffff' : 'rgba(255,255,255,0.55)',
                background:'none', border:'none', cursor:'pointer', whiteSpace:'nowrap',
                borderBottom: active ? '2px solid #e8a020' : '2px solid transparent',
                marginBottom: -1, transition:'color 0.15s',
              }}
            >
              {g.label}
            </button>
          )
        })}
      </div>

      {/* ── Sub-tab bar (only when the active group has more than one page) ── */}
      {activeGroup.tabs.length > 1 && (
        <div className="tab-bar-scroll" style={{ background:'#fff', borderBottom:'1px solid #eef2f7', padding:'8px 24px', display:'flex', gap:8, flexShrink:0, overflowX:'auto' }}>
          {activeGroup.tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding:'6px 14px', fontSize:12, fontWeight: activeTab===t.id ? 600 : 500,
                color: activeTab===t.id ? '#fff' : '#1a3a6b',
                background: activeTab===t.id ? '#1a3a6b' : '#eef2f7',
                border:'none', borderRadius:16, cursor:'pointer', whiteSpace:'nowrap',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Tab content ── */}
      <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>

        {error && (
          <div style={{padding:'12px 16px',background:'#fff5f5',border:'1px solid #ffd5cc',borderRadius:8,display:'flex',gap:8,marginBottom:20}}>
            <AlertCircle size={16} color="#e05c2a" style={{flexShrink:0,marginTop:1}}/>
            <div>
              <div style={{fontWeight:600,color:'#c0392b',fontSize:13}}>Failed to load keywords</div>
              <div style={{fontSize:12,color:'#e05c2a'}}>{error}</div>
            </div>
          </div>
        )}

        {/* ── Overview ── */}
        {activeTab === 'overview' && (
          <div style={{display:'grid', gridTemplateColumns:'2fr 3fr', gap:20, alignItems:'start'}}>
            <div style={{display:'flex', flexDirection:'column', gap:0}}>
              <Section title="Top Keywords · Quality Score">
                <div className="card-body" style={{display:'flex',flexDirection:'column',gap:8}}>
                  {loading ? <Skeleton rows={6}/> : (rows||[]).filter(r=>r.qualityScore>0).length===0
                    ? <div style={{textAlign:'center',color:'#aaa',fontSize:13}}>No quality score data</div>
                    : (rows||[]).filter(r=>r.qualityScore>0).sort((a,b)=>b.impressions-a.impressions).slice(0,10).map((kw,i)=>(
                      <div key={i} style={{display:'flex',alignItems:'center',gap:10}}>
                        <span style={{flex:1,fontSize:12,color:'#4a4a4a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{kw.text}</span>
                        <QsDots score={kw.qualityScore}/>
                        <span style={{fontSize:11,fontWeight:700,color:qsColor(kw.qualityScore),minWidth:16,textAlign:'right'}}>{kw.qualityScore}</span>
                      </div>
                    ))
                  }
                </div>
              </Section>
              <Section title="Quality Score Distribution">
                <div className="card-body">{loading ? <div className="skeleton" style={{height:200,borderRadius:6}}/> : <QsDistribution rows={rows}/>}</div>
              </Section>
            </div>
            <Section title="Top 20 Keywords by Clicks">
              <div className="card-body">
                {loading ? <div style={{height:260}}><Skeleton rows={8}/></div> : (()=>{
                  const top=(rows||[]).sort((a,b)=>b.clicks-a.clicks).slice(0,20).map(r=>({name:r.text.length>30?r.text.slice(0,29)+'…':r.text,clicks:r.clicks}))
                  if (!top.length) return <div style={{textAlign:'center',color:'#aaa',fontSize:13}}>No data</div>
                  return (
                    <ResponsiveContainer width="100%" height={Math.max(200,top.length*26)}>
                      <BarChart data={top} layout="vertical" margin={{left:8,right:16}}>
                        <XAxis type="number" tick={{fontSize:10,fill:'#888'}} axisLine={false} tickLine={false} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                        <YAxis type="category" dataKey="name" width={160} tick={{fontSize:10,fill:'#1a3a6b'}} axisLine={false} tickLine={false}/>
                        <Tooltip formatter={v=>[fmtNum(v),'Clicks']}/>
                        <Bar dataKey="clicks" fill="#2563b0" radius={[0,3,3,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  )
                })()}
              </div>
            </Section>
          </div>
        )}

        {/* ── All Keywords ── */}
        {activeTab === 'all' && (
          <>
            {callSummaryBar}
            <Section
              title="Top Keywords by Impression"
              extra={
                <div style={{display:'flex',gap:10,alignItems:'center'}}>
                  <div style={{position:'relative'}}>
                    <Search size={13} style={{position:'absolute',left:9,top:'50%',transform:'translateY(-50%)',color:'#aaa',pointerEvents:'none'}}/>
                    <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filter keywords…" style={{paddingLeft:28,paddingRight:10,height:30,border:'1px solid #dde9f5',borderRadius:5,fontSize:12,color:'#1a3a6b',outline:'none',width:180}}/>
                  </div>
                  <ExportButton data={topImprCsvRows} filename="keywords-top-impressions"/>
                  <ExportPdfButton accountName={selectedAccount?.name} section="Top Keywords by Impression" />
                </div>
              }
            >
              <CampFilterBar allData={rows||[]} campFilter={kwCampFilter} setCampFilter={setKwCampFilter} campStatusFilter={kwCampStatus} setCampStatusFilter={setKwCampStatus} kwStatusFilter={kwKwStatus} setKwStatusFilter={setKwKwStatus}/>
              {loading ? <Skeleton rows={8}/> : <KwTable rows={filtered} loading={loading} hidePaused={hidePaused} onDrillDown={handleCallDrillDown}/>}
            </Section>
          </>
        )}

        {/* ── Top Converting ── */}
        {activeTab === 'converting' && (
          <>
            {callSummaryBar}
            <Section title="Top Converting Keywords">
              <CampFilterBar allData={(rows||[]).filter(r => r.conversions > 0)} campFilter={tcCampFilter} setCampFilter={setTcCampFilter} campStatusFilter={tcCampStatus} setCampStatusFilter={setTcCampStatus} adGroupFilter={tcAdGroupFilter} setAdGroupFilter={setTcAdGroupFilter} kwStatusFilter={tcKwStatus} setKwStatusFilter={setTcKwStatus}/>
            </Section>
            <TopConvertingSection rows={tcFiltered} loading={loading} accountName={selectedAccount?.name}/>
          </>
        )}

        {/* ── Overspending ── */}
        {activeTab === 'overspending' && (
          <WastedSpendSection selectedAccount={selectedAccount} dateRange={dateRange}/>
        )}

        {/* ── Negative Keywords ── */}
        {activeTab === 'negativeKeywords' && (
          <NegativeKeywordsTab selectedAccount={selectedAccount} />
        )}

        {/* ── All Keywords ── */}
        {activeTab === 'allKeywords' && (
          <AllKeywordsTab
            rows={rows}
            loading={loading}
            onDrillDown={handleCallDrillDown}
            accountName={selectedAccount?.name}
          />
        )}

        {/* ── Search Terms (Recommended as Negative Keyword) ── */}
        {activeTab === 'negKeywordsRec' && (
          <RecommendedNegKeywordsTab
            data={negData}
            loading={negLoading}
            error={negError}
            onRetry={() => { setNegData(null); setNegError(null) }}
            selectedAccount={selectedAccount}
            setNegData={setNegData}
            existingKeywords={rows}
            setRows={setRows}
          />
        )}

        {/* ── Search Terms ── */}
        {activeTab === 'searchTerms' && (
          <SearchTermsSection
            selectedAccount={selectedAccount}
            dateRange={dateRange}
            hidePaused={hidePaused}
            existingKeywords={rows}
            negData={negData}
            setRows={setRows}
            setNegData={setNegData}
          />
        )}

        {/* ── AI Keyword Planner ── */}
      </div>
    </div>
  )
}
