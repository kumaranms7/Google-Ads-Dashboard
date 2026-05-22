import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, AlertCircle, Loader2, Phone, Check, Copy, X, RefreshCw } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import ExportButton  from '../components/ExportButton.jsx'
import StatusBadge   from '../components/StatusBadge.jsx'
import ReportTable   from '../components/ReportTable.jsx'

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtNum  = v => Number(v||0).toLocaleString()
const fmtUsd  = v => '$' + Number(v||0).toFixed(2)
const fmtPct  = v => Number(v||0).toFixed(2) + '%'
const qsColor = s => s>=7?'#4caf50':s>=4?'#f0b429':'#e05c2a'

// ── Phone call badge ──────────────────────────────────────────────────────────
function PhoneCallBadge({ count, campaignName, onDrillDown }) {
  const n = Number(count) || 0
  if (n === 0) return <span style={{ color:'#9e9e9e', fontSize:12 }}>—</span>
  return (
    <span
      onClick={() => onDrillDown && onDrillDown(campaignName)}
      title={`View ${n} call(s) for "${campaignName}" in Call Leads`}
      style={{
        display:'inline-flex', alignItems:'center', gap:4,
        background:'#e8f5e9', color:'#2e7d32',
        border:'1px solid #4caf50', borderRadius:99,
        padding:'2px 8px', fontSize:11, fontWeight:500,
        cursor: onDrillDown ? 'pointer' : 'default',
      }}
    >
      📞 {n}
    </span>
  )
}

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
  const [pageSize, setPageSize] = useState(10)

  useEffect(() => { setPage(0) }, [sort, asc])

  const sorted = useMemo(() => {
    let r = rows || []
    if (hidePaused) r = r.filter(k => !['PAUSED','Paused','3'].includes(String(k.status||'')))
    return [...r].sort((a,b) => {
      const va=a[sort],vb=b[sort]
      if (typeof va==='number') return asc?va-vb:vb-va
      return asc?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va))
    })
  }, [rows, sort, asc, hidePaused])

  const COLS = [
    {key:'text',         lbl:'Keyword', fmt:(v,row)=><span style={{color:kwStatusColor(row.status||''),fontWeight:500}}>{v}</span>},
    {key:'matchType',    lbl:'Match',   fmt:v=><StatusBadge value={v} type="match"/>},
    {key:'campaign',     lbl:'Campaign',fmt:(v,row)=><span style={{color:kwStatusColor(row.campaignStatus||''),fontWeight:500}}>{v}</span>},
    {key:'qualityScore', lbl:'Quality Score',      fmt:v=>(
      <div style={{display:'flex',alignItems:'center',gap:4}}>
        <QsDots score={v}/>
        <span style={{fontSize:10,fontWeight:700,color:qsColor(v),minWidth:14}}>{v||'—'}</span>
      </div>
    )},
    {key:'impressions',  lbl:'Impr.',   fmt:fmtNum},
    {key:'clicks',       lbl:'Clicks',  fmt:fmtNum},
    {key:'ctr',          lbl:'CTR',     fmt:fmtPct},
    {key:'cpc',          lbl:'CPC',     fmt:fmtUsd},
    {key:'cost',         lbl:'Cost',    fmt:v=>'$'+Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})},
    {key:'conversions',  lbl:'Conv.',   fmt:fmtNum},
    {key:'phoneCalls',   lbl:'Call Leads', fmt:(v,row)=><PhoneCallBadge count={v} campaignName={row.campaign} onDrillDown={onDrillDown}/>},
  ]

  const thStyle = key => ({
    background:'#1a3a6b',color:'#fff',padding:'9px 11px',fontSize:11,fontWeight:600,
    textAlign:['text','campaign','adGroup','matchType'].includes(key)?'left':'center',
    cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',letterSpacing:'0.3px',
    position:'sticky', top:0, zIndex:2,
  })

  const totalPages  = Math.max(1, Math.ceil(sorted.length / pageSize))
  const pageRows    = sorted.slice(page * pageSize, (page + 1) * pageSize)
  const rangeStart  = page * pageSize + 1
  const rangeEnd    = Math.min((page + 1) * pageSize, sorted.length)

  return (
    <div>
      <div style={{overflow:'auto',maxHeight:'70vh'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr>{COLS.map(c=><th key={c.key} onClick={()=>{if(sort===c.key)setAsc(a=>!a);else{setSort(c.key);setAsc(false)}}} style={thStyle(c.key)}>{c.lbl}{sort===c.key?(asc?' ▲':' ▼'):''}</th>)}</tr></thead>
          <tbody>
            {loading
              ? Array.from({length:8},(_,i)=><tr key={i}><td colSpan={COLS.length} style={{padding:'8px 11px',borderBottom:'1px solid #f0f4f8'}}><div className="skeleton" style={{height:11,width:'60%'}}/></td></tr>)
              : sorted.length===0
                ? <tr><td colSpan={COLS.length} style={{padding:'28px 0',textAlign:'center',color:'#aaa'}}>No keywords found</td></tr>
                : pageRows.map((row,vi)=>(
                  <tr key={vi} style={{background:hover===vi?'#edf3fb':vi%2===0?'#fff':'#f5f7fa',transition:'background 0.1s'}} onMouseEnter={()=>setHover(vi)} onMouseLeave={()=>setHover(null)}>
                    {COLS.map((c,ci)=>(
                      <td key={c.key} style={{padding:'8px 11px',borderBottom:'1px solid #f0f4f8',textAlign:ci<=3?'left':'center',color:ci===0?'#1a3a6b':'#4a4a4a',fontWeight:ci===0?500:400,maxWidth:ci===0?200:undefined,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {c.fmt?c.fmt(row[c.key],row):(row[c.key]??'—')}
                      </td>
                    ))}
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>
      {!loading && totalPages > 1 && (
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderTop:'1px solid #f0f4f8',flexWrap:'wrap',gap:8}}>
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

// ── Wasted spend section ──────────────────────────────────────────────────────
function WastedSpendSection({ selectedAccount, dateRange }) {
  const [data,           setData]           = useState(null)
  const [loading,        setLoading]        = useState(false)
  const [threshold,      setThreshold]      = useState(10)
  const [wsCampFilter,   setWsCampFilter]   = useState('')
  const [wsCampStatus,   setWsCampStatus]   = useState('')
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
  const actionColor = { 'Pause Immediately':'#e05c2a', 'Review & Consider Pausing':'#f0b429', 'Monitor':'#a0a020' }

  const cols = [
    {key:'text',             label:'Keyword',    sortable:true, align:'left',  width:200, format:(v,row)=><span style={{color:kwStatusColor(row.status||''),fontWeight:500}}>{v}</span>},
    {key:'matchType',        label:'Match',      sortable:true, align:'center', format:v=><StatusBadge value={v} type="match"/>},
    {key:'campaign',         label:'Campaign',   sortable:true, align:'left',  width:180, format:(v,row)=><span style={{color:kwStatusColor(row.campaignStatus||''),fontWeight:500}}>{v}</span>},
    {key:'adGroup',          label:'Ad Group',   sortable:true, align:'left'},
    {key:'cost',             label:'Spend',      sortable:true, align:'right', format:v=><span style={{color:'#e05c2a',fontWeight:600}}>{fmtUsd(v)}</span>},
    {key:'clicks',           label:'Clicks',     sortable:true, align:'right', format:fmtNum},
    {key:'impressions',      label:'Impr.',      sortable:true, align:'right', format:fmtNum},
    {key:'cpc',              label:'CPC',        sortable:true, align:'right', format:fmtUsd},
    {key:'conversions',      label:'Conv.',      sortable:true, align:'right', format:v=><span style={{color:'#e05c2a',fontWeight:700}}>0</span>},
    {key:'phoneCalls',       label:'Call Leads', sortable:true, align:'right', format:fmtNum},
    {key:'recommendedAction',label:'Action',     sortable:true, align:'center',
      format:v=><span style={{fontSize:11,fontWeight:600,padding:'2px 7px',borderRadius:4,background:`${actionColor[v]||'#888'}22`,color:actionColor[v]||'#888',border:`1px solid ${actionColor[v]||'#888'}44`}}>{v}</span>},
  ]

  return (
    <Section
      title="⚠ Overspending Keywords"
      extra={<ExportButton data={wsFiltered} filename="wasted-spend"/>}
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
  const [pageSize, setPageSize] = useState(10)

  useEffect(() => { setPage(0) }, [sort, asc])

  const sorted = useMemo(() => {
    if (!data?.length) return []
    return [...data].sort((a,b) => {
      const va=a[sort],vb=b[sort]
      if(typeof va==='number') return asc?va-vb:vb-va
      return asc?String(va||'').localeCompare(String(vb||'')):String(vb||'').localeCompare(String(va||''))
    })
  }, [data, sort, asc])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const pageRows   = sorted.slice(page * pageSize, (page + 1) * pageSize)
  const rangeStart = page * pageSize + 1
  const rangeEnd   = Math.min((page + 1) * pageSize, sorted.length)
  return (
    <div style={{overflow:'auto',maxHeight:'70vh'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead><tr>{columns.map((c,i)=><th key={c.key} onClick={()=>{if(sort===c.key)setAsc(a=>!a);else{setSort(c.key);setAsc(false)}}} style={{background:'#1a3a6b',color:'#fff',padding:'9px 11px',textAlign:c.align||(i===0?'left':'right'),fontSize:11,fontWeight:600,cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',position:'sticky',top:0,zIndex:2}}>{c.label}{sort===c.key?(asc?' ▲':' ▼'):''}</th>)}</tr></thead>
        <tbody>
          {sorted.length===0?<tr><td colSpan={columns.length} style={{padding:'24px 0',textAlign:'center',color:'#aaa'}}>No overspending keywords found for this threshold</td></tr>
          :pageRows.map((row,vi)=>(
            <tr key={vi} style={{background:vi%2===0?'#fff':'#f5f7fa'}}>
              {columns.map((c,ci)=>{
                const raw=row[c.key]
                const cell=c.format?c.format(raw,row):c.badge?<StatusBadge value={raw}/>:(raw??'—')
                return <td key={c.key} style={{padding:'8px 11px',borderBottom:'1px solid #f0f4f8',textAlign:c.align||(ci===0?'left':'right'),color:ci===0?'#1a3a6b':'#4a4a4a',fontWeight:ci===0?500:400,maxWidth:ci===0?200:undefined,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cell}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderTop:'1px solid #f0f4f8',flexWrap:'wrap',gap:8}}>
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

// ── Top converting keywords — receives already-loaded rows to avoid double fetch
function TopConvertingSection({ rows, loading }) {
  const data = useMemo(() => {
    return (rows || [])
      .filter(r => r.conversions > 0)
      .sort((a, b) => b.conversions - a.conversions)
      .map(r => ({ ...r, isTopConverter: (r.convRate || 0) > 5 }))
  }, [rows])

  const chartData = data.slice(0, 10).map(r => ({ name: r.text.slice(0, 25), conversions: r.conversions }))

  const columns = [
    { key:'text',        label:'Keyword',    sortable:true,  align:'left',
      format:(v,row) => (
        <span>
          <span style={{color:kwStatusColor(row.status||''),fontWeight:500}}>{v}</span>
          {row.isTopConverter && <span style={{marginLeft:6,fontSize:10,background:'rgba(76,175,80,0.15)',color:'#2e7d32',padding:'1px 5px',borderRadius:3,fontWeight:600}}>⭐ Top</span>}
        </span>
      )},
    { key:'matchType',   label:'Match',      sortable:true,  align:'center',
      format:v => <StatusBadge value={v} type="match"/> },
    { key:'campaign',    label:'Campaign',   sortable:true,  align:'left',
      format:(v,row) => <span style={{color:kwStatusColor(row.campaignStatus||''),fontWeight:500}}>{v}</span> },
    { key:'adGroup',     label:'Ad Group',   sortable:true,  align:'left',
      format:(v,row) => <span style={{color:kwStatusColor(row.adGroupStatus||''),fontWeight:500}}>{v||'—'}</span> },
    { key:'conversions', label:'Conv.',      sortable:true,  align:'right',
      format:v => <span style={{fontWeight:700,color:'#2e7d32'}}>{fmtNum(v)}</span> },
    { key:'convRate',    label:'Conv. Rate', sortable:true,  align:'right',
      format:v => <span style={{fontWeight:600,color:qsColor(v>5?8:v>=2?5:2)}}>{fmtPct(v)}</span> },
    { key:'cost',        label:'Cost',       sortable:true,  align:'right', format:fmtUsd },
    { key:'cpc',         label:'CPC',        sortable:true,  align:'right', format:fmtUsd },
    { key:'clicks',      label:'Clicks',     sortable:true,  align:'right', format:fmtNum },
    { key:'phoneCalls',  label:'Call Leads', sortable:true,  align:'center',
      format:(v,row) => <PhoneCallBadge count={v||0} campaignName={row.campaign}/> },
  ]

  return (
    <Section title="⭐ Top Converting Keywords (Last 90 Days)" extra={<ExportButton data={data.map(({isTopConverter,...r})=>r)} filename="top-converting-keywords"/>}>
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
        emptyMessage="No converting keywords found for the selected period"
      />
    </Section>
  )
}

// ── Keyword Planner — powered by Claude AI ───────────────────────────────────
// ── Shared prompt-mode components ────────────────────────────────────────────

const PROMPT_HELP = {
  planner: {
    title:       'Custom Keyword Research Prompt',
    help:        'Describe your business, target audience, services, location, or campaign goals. The AI will generate high-intent keywords based on your description while always returning results in the standard format.',
    example:     '"Emergency roofing company in Dallas, TX. Services: storm damage repair, roof tarping, insurance claims. Target homeowners needing immediate help after severe weather."',
    placeholder: 'Describe your business, services, target location, audience, or campaign goals…',
  },
  cpc: {
    title:       'Custom CPC Optimization Prompt',
    help:        'Describe what types of cheaper alternatives you want the AI to focus on — e.g. specific locations, service niches, or match type preferences. The AI will still return results in the standard format with CPC estimates, intent, and ad group recommendations.',
    example:     '"We run a local HVAC company in Phoenix, AZ. Focus on emergency AC repair and same-day service. Avoid broad terms and prioritize exact-match long-tail alternatives under $10 CPC."',
    placeholder: 'Describe your optimization goals, niche, location, or budget constraints…',
  },
  negative: {
    title:       'Custom Negative Keyword Prompt',
    help:        'Describe what types of irrelevant traffic you want to block or what specific wasted spend patterns to prioritize. The AI will still return results in the standard format with confidence scores, placement recommendations, and savings estimates.',
    example:     '"We are a premium commercial cleaning company in Chicago. Block all residential DIY searches, job-seeker traffic, and budget-focused searches that don\'t match our B2B positioning."',
    placeholder: 'Describe your blocking priorities, audience filters, or traffic quality goals…',
  },
}

function PromptModal({ show, context, draft, onChangeDraft, onSave, onClose }) {
  const h = PROMPT_HELP[context] || PROMPT_HELP.planner
  if (!show) return null
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9999,
      display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:10, width:560, maxWidth:'92vw',
        boxShadow:'0 8px 40px rgba(0,0,0,0.22)', display:'flex', flexDirection:'column' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #dde9f5',
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#1a3a6b' }}>{h.title}</div>
            <div style={{ fontSize:11, color:'#888', marginTop:2 }}>Describe what you want the AI to focus on</div>
          </div>
          <button onClick={onClose}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#aaa', fontSize:18, lineHeight:1, padding:4 }}>✕</button>
        </div>
        <div style={{ padding:'14px 20px', background:'#f0f4fb', borderBottom:'1px solid #dde9f5',
          fontSize:11, color:'#555', lineHeight:1.7 }}>
          <strong style={{ color:'#1a3a6b' }}>What to write:</strong> {h.help}<br/>
          <span style={{ color:'#888' }}>Example: <em>{h.example}</em></span>
        </div>
        <div style={{ padding:'16px 20px' }}>
          <textarea
            value={draft}
            onChange={e => onChangeDraft(e.target.value)}
            placeholder={h.placeholder}
            rows={6}
            style={{ width:'100%', padding:'10px 12px', border:'1px solid #dde9f5', borderRadius:6,
              fontSize:12, color:'#1a3a6b', outline:'none', resize:'vertical',
              fontFamily:'inherit', boxSizing:'border-box', lineHeight:1.6 }}
          />
          <div style={{ fontSize:11, color:'#aaa', marginTop:4 }}>
            {draft.trim().length} characters — be specific for best results
          </div>
        </div>
        <div style={{ padding:'12px 20px', borderTop:'1px solid #dde9f5',
          display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button onClick={onClose}
            style={{ padding:'7px 18px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5',
              borderRadius:6, background:'#fff', color:'#555', cursor:'pointer' }}>Cancel</button>
          <button onClick={onSave}
            style={{ padding:'7px 18px', fontSize:12, fontWeight:700, border:'none',
              borderRadius:6, background:'#1a3a6b', color:'#fff', cursor:'pointer' }}>Save Prompt</button>
        </div>
      </div>
    </div>
  )
}

function PromptModeBar({ promptMode, customPrompt, onSetDefault, onOpenModal }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, flexWrap:'wrap' }}>
      <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Prompt:</span>
      <div style={{ display:'inline-flex', borderRadius:6, border:'1px solid #dde9f5', overflow:'hidden' }}>
        {[['default','Default Prompt'],['custom','Custom Prompt']].map(([mode, label]) => (
          <button key={mode}
            onClick={() => mode === 'custom' ? onOpenModal() : onSetDefault()}
            style={{ padding:'5px 14px', fontSize:12, fontWeight: promptMode === mode ? 700 : 500,
              background: promptMode === mode ? '#1a3a6b' : '#fff',
              color: promptMode === mode ? '#fff' : '#555',
              border:'none', cursor:'pointer', whiteSpace:'nowrap' }}>
            {label}
          </button>
        ))}
      </div>
      {promptMode === 'custom' && customPrompt.trim() && (
        <>
          <button onClick={onOpenModal}
            style={{ fontSize:11, color:'#2563b0', background:'rgba(37,99,176,0.08)',
              border:'1px solid rgba(37,99,176,0.25)', borderRadius:4, padding:'3px 9px',
              cursor:'pointer', fontWeight:600 }}>✎ Edit Prompt</button>
          <span style={{ fontSize:11, color:'#2e7d32', overflow:'hidden', textOverflow:'ellipsis',
            whiteSpace:'nowrap', maxWidth:260 }} title={customPrompt}>
            ✓ {customPrompt.slice(0, 60)}{customPrompt.length > 60 ? '…' : ''}
          </span>
        </>
      )}
      {promptMode === 'custom' && !customPrompt.trim() && (
        <span style={{ fontSize:11, color:'#c0392b' }}>⚠ No custom prompt set — click "Custom Prompt" to add one</span>
      )}
    </div>
  )
}

// ── Shared prompt state hook ──────────────────────────────────────────────────
function usePromptMode() {
  const [promptMode,   setPromptMode]   = useState('default')
  const [customPrompt, setCustomPrompt] = useState('')
  const [showModal,    setShowModal]    = useState(false)
  const [draftPrompt,  setDraftPrompt]  = useState('')
  const openModal  = () => { setDraftPrompt(customPrompt); setShowModal(true) }
  const saveModal  = () => { setCustomPrompt(draftPrompt); setPromptMode(draftPrompt.trim() ? 'custom' : 'default'); setShowModal(false) }
  const closeModal = () => setShowModal(false)
  const activePrompt = promptMode === 'custom' && customPrompt.trim() ? customPrompt.trim() : null
  return { promptMode, setPromptMode, customPrompt, showModal, draftPrompt, setDraftPrompt, openModal, saveModal, closeModal, activePrompt }
}

function KeywordPlannerSection({ selectedAccount, existingKeywords = [] }) {
  const [seeds,           setSeeds]           = useState('')
  const [results,         setResults]         = useState(null)
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState(null)
  const [sortCol,         setSortCol]         = useState(null)
  const [sortDir,         setSortDir]         = useState('asc')
  const [skipped,         setSkipped]         = useState(0)
  const [kwFilterCampaign, setKwFilterCampaign] = useState('')
  const [kwFilterAdGroup,  setKwFilterAdGroup]  = useState('')
  const pm = usePromptMode()

  // Campaigns: enabled at campaign level (ad group status irrelevant)
  const enabledCampaignRows = useMemo(() =>
    (existingKeywords || []).filter(r => r.campaignStatus === 'Enabled')
  , [existingKeywords])

  // Ad groups: both campaign and ad group must be enabled
  const enabledRows = useMemo(() =>
    (existingKeywords || []).filter(r => r.campaignStatus === 'Enabled' && r.adGroupStatus === 'Enabled')
  , [existingKeywords])

  const accountCampaigns = useMemo(() =>
    [...new Set(enabledCampaignRows.map(r => r.campaign).filter(Boolean))].sort()
  , [enabledCampaignRows])

  const accountAdGroups = useMemo(() => {
    const source = kwFilterCampaign
      ? enabledRows.filter(r => r.campaign === kwFilterCampaign)
      : enabledRows
    return [...new Set(source.map(r => r.adGroup).filter(Boolean))].sort()
  }, [enabledRows, kwFilterCampaign])

  function toggleSort(col) {
    if (sortCol === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc') }
    else { setSortCol(col); setSortDir('asc') }
  }

  const normalizeKw = s => (s || '').toLowerCase().trim()
    .replace(/^\[|\]$/g, '').replace(/^"|"$/g, '').replace(/^\+/g, '').trim()

  const existingKwSet = useMemo(() =>
    new Set((existingKeywords || []).map(r => normalizeKw(r.text)))
  , [existingKeywords])

  function sortIdeas(ideas) {
    if (!sortCol) return ideas
    const COMP_ORDER  = { Low:1, Medium:2, High:3 }
    const STAGE_ORDER = { 'Ready To Buy':1, 'Comparing Options':2, 'Urgent Need':3 }
    const parseNum = s => { const m = String(s||'').replace(/,/g,'').match(/[\d.]+/); return m ? Number(m[0]) : 0 }
    const getVal = r => {
      switch (sortCol) {
        case 'Keyword Idea':    return (r.keyword || '').toLowerCase()
        case 'Match Type':      return (r.matchType || '').toLowerCase()
        case 'Search Intent':   return (r.searchIntent || '').toLowerCase()
        case 'Buyer Stage':     return STAGE_ORDER[r.buyerStage] ?? 99
        case 'Searches/mo':     return parseNum(r.monthlySearches)
        case 'Competition':     return COMP_ORDER[r.competition] ?? 99
        case 'Est. CPC':        return parseNum(r.estimatedCpc)
        case 'CPC vs Avg':      return parseNum(r.estimatedSavings)
        case 'Conv. Score':     return Number(r.conversionScore) || 0
        case 'Traffic':         return (r.trafficPotential || '').toLowerCase()
        case 'Recommended Campaign':  return (r.recommendedCampaign || '').toLowerCase()
        case 'Recommended Ad Groups': return (r.adGroup || '').toLowerCase()
        default: return 0
      }
    }
    return [...ideas].sort((a, b) => {
      const av = getVal(a), bv = getVal(b)
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sortDir === 'asc' ? cmp : -cmp
    })
  }

  async function fetchIdeas() {
    if (!seeds.trim()) return
    const kws = seeds.split(',').map(s => s.trim()).filter(Boolean)
    setLoading(true); setError(null); setResults(null); setSkipped(0)
    try {
      const payload = { seedKeywords: kws }
      if (pm.activePrompt) payload.customPrompt = pm.activePrompt
      if (accountCampaigns.length) payload.existingCampaigns = accountCampaigns.slice(0, 30)
      if (accountAdGroups.length)  payload.existingAdGroups  = accountAdGroups.slice(0, 50)
      const data = await window.electronAPI.fetchKeywordIdeas(payload)
      const raw     = Array.isArray(data) ? data : []
      const deduped = raw.filter(r => !existingKwSet.has(normalizeKw(r.keyword)))
      setSkipped(raw.length - deduped.length)
      setResults(deduped)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  const grouped = useMemo(() => {
    if (!results) return {}
    return results.reduce((acc, r) => {
      const k = r.seedKeyword || 'Unknown'
      if (!acc[k]) acc[k] = { ideas:[], analysis:null, campaignStructure:null, negKeywords:new Set() }
      acc[k].ideas.push(r)
      if (!acc[k].analysis && r.analysis) acc[k].analysis = r.analysis
      if (!acc[k].campaignStructure && r.campaignStructure) acc[k].campaignStructure = r.campaignStructure
      ;(r.negativeKeywords || []).forEach(nk => acc[k].negKeywords.add(nk))
      return acc
    }, {})
  }, [results])

  // Filter ideas by recommended campaign / ad group
  const filteredGrouped = useMemo(() => {
    if (!kwFilterCampaign && !kwFilterAdGroup) return grouped
    const out = {}
    for (const [seed, data] of Object.entries(grouped)) {
      const ideas = data.ideas.filter(r =>
        (!kwFilterCampaign || r.recommendedCampaign === kwFilterCampaign) &&
        (!kwFilterAdGroup  || r.adGroup             === kwFilterAdGroup)
      )
      if (ideas.length) out[seed] = { ...data, ideas }
    }
    return out
  }, [grouped, kwFilterCampaign, kwFilterAdGroup])

  const plannerCsvRows = useMemo(() => {
    const rows = []
    for (const [seed, { ideas }] of Object.entries(filteredGrouped)) {
      for (const r of sortIdeas(ideas)) {
        rows.push({
          'Seed Keyword':         seed,
          'Keyword Idea':         r.keyword            || '',
          'Match Type':           r.matchType          || '',
          'Search Intent':        r.searchIntent       || '',
          'Buyer Stage':          r.buyerStage         || '',
          'Searches/mo':          r.monthlySearches    || '',
          'Competition':          r.competition        || '',
          'Est. CPC':             r.estimatedCpc       || '',
          'CPC vs Avg':           r.estimatedSavings   || '',
          'Conv. Score':          r.conversionScore    ?? '',
          'Traffic':              r.trafficPotential   || '',
          'Recommended Campaign': r.recommendedCampaign || '',
          'Recommended Ad Group': r.adGroup            || '',
          'Why It Converts':      r.whyItConverts      || '',
        })
      }
    }
    return rows
  }, [filteredGrouped, sortCol, sortDir])

  // Filter dropdowns sourced from AI results only
  const filterableCampaigns = useMemo(() => {
    const ideas = Object.values(grouped).flatMap(g => g.ideas)
    return [...new Set(ideas.map(r => r.recommendedCampaign).filter(Boolean))].sort()
  }, [grouped])

  const filterableAdGroups = useMemo(() => {
    const ideas = Object.values(grouped).flatMap(g => g.ideas)
    const source = kwFilterCampaign ? ideas.filter(r => r.recommendedCampaign === kwFilterCampaign) : ideas
    return [...new Set(source.map(r => r.adGroup).filter(Boolean))].sort()
  }, [grouped, kwFilterCampaign])

  return (
    <Section title="🤖 AI Keyword Planner">
      <PromptModal show={pm.showModal} context="planner" draft={pm.draftPrompt}
        onChangeDraft={pm.setDraftPrompt} onSave={pm.saveModal} onClose={pm.closeModal}/>

      {/* ── Input panel ── */}
      <div className="card-body" style={{ borderBottom:'1px solid #dde9f5' }}>
        <PromptModeBar promptMode={pm.promptMode} customPrompt={pm.customPrompt}
          onSetDefault={() => pm.setPromptMode('default')} onOpenModal={pm.openModal}/>

        <div style={{ fontSize:12, color:'#555', marginBottom:8 }}>
          Enter seed keywords separated by commas:<br/>
          <code style={{ fontSize:11, background:'#f0f4f8', padding:'2px 6px', borderRadius:3 }}>
            plumber, roof repair, junk removal
          </code>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <input
            value={seeds}
            onChange={e => setSeeds(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') fetchIdeas() }}
            placeholder="plumber, roof repair, junk removal..."
            style={{ flex:1, padding:'8px 12px', border:'1px solid #dde9f5', borderRadius:6,
              fontSize:13, color:'#1a3a6b', outline:'none' }}
          />
          <button
            onClick={fetchIdeas}
            disabled={loading || !seeds.trim() || (pm.promptMode === 'custom' && !pm.customPrompt.trim())}
            style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 18px',
              background: loading || !seeds.trim() || (pm.promptMode === 'custom' && !pm.customPrompt.trim()) ? '#dde9f5' : '#e8a020',
              color:      loading || !seeds.trim() || (pm.promptMode === 'custom' && !pm.customPrompt.trim()) ? '#aaa'    : '#1a3a6b',
              fontWeight:700, fontSize:13, borderRadius:6, border:'none',
              cursor: loading || !seeds.trim() || (pm.promptMode === 'custom' && !pm.customPrompt.trim()) ? 'not-allowed' : 'pointer' }}
          >
            {loading && <Loader2 size={13} className="spin"/>}
            {loading ? 'Generating…' : 'Get Ideas'}
          </button>
        </div>
        {results && (
          <div style={{ marginTop:8, fontSize:12, color:'#888' }}>
            {results.length} keyword idea{results.length !== 1 ? 's' : ''} found for {Object.keys(grouped).length} seed{Object.keys(grouped).length !== 1 ? 's' : ''}
          </div>
        )}
        {error && <div style={{ marginTop:8, fontSize:12, color:'#c0392b' }}>⚠ {error}</div>}
        {skipped > 0 && (
          <div style={{ marginTop:8, fontSize:12, color:'#a56700', display:'flex', alignItems:'center', gap:5 }}>
            <span>⚠</span>
            <span><strong>{skipped}</strong> idea{skipped !== 1 ? 's' : ''} removed — already exist in your keyword list (adding them would create keyword crossover).</span>
          </div>
        )}
      </div>

      {results && results.length === 0 && (
        <div style={{ padding:'24px 0', textAlign:'center', color:'#aaa', fontSize:13 }}>
          No keyword ideas returned. Try different seed keywords.
        </div>
      )}

      {/* ── Results filter bar ── */}
      {results && results.length > 0 && (
        <div style={{ padding:'10px 16px', background:'#fafcff', borderBottom:'1px solid #f0f4f8',
          display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign:</span>
            <select
              value={kwFilterCampaign}
              onChange={e => { setKwFilterCampaign(e.target.value); setKwFilterAdGroup('') }}
              style={{ padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }}
            >
              <option value="">All</option>
              {filterableCampaigns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Ad Group:</span>
            <select
              value={kwFilterAdGroup}
              onChange={e => setKwFilterAdGroup(e.target.value)}
              style={{ padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }}
            >
              <option value="">All</option>
              {filterableAdGroups.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {(kwFilterCampaign || kwFilterAdGroup) && (
            <button onClick={() => { setKwFilterCampaign(''); setKwFilterAdGroup('') }}
              style={{ fontSize:11, color:'#2563b0', background:'none', border:'1px solid #dde9f5', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
              Clear
            </button>
          )}
          <div style={{ display:'flex', alignItems:'center', gap:10, marginLeft:'auto' }}>
            <span style={{ fontSize:11, color:'#888' }}>
              {Object.values(filteredGrouped).reduce((s, g) => s + g.ideas.length, 0)} of {results.length} ideas
            </span>
            <ExportButton data={plannerCsvRows} filename="ai_keyword_planner.csv" label="Export CSV"/>
          </div>
        </div>
      )}

      {Object.entries(filteredGrouped).map(([seed, { ideas, analysis, campaignStructure, negKeywords }]) => (
        <div key={seed} style={{ borderBottom:'2px solid #dde9f5' }}>

          {/* Seed keyword header */}
          <div style={{ padding:'10px 16px', background:'#e8f5e9', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, fontWeight:700, color:'#2e7d32', padding:'2px 8px',
              background:'rgba(76,175,80,0.15)', borderRadius:4, border:'1px solid rgba(76,175,80,0.4)' }}>
              🌱 Seed
            </span>
            <span style={{ fontSize:14, fontWeight:700, color:'#1a3a6b' }}>{seed}</span>
          </div>

          {/* AI Analysis panel */}
          {analysis && (
            <div style={{ padding:'12px 16px', background:'#f0f4fb', borderBottom:'1px solid #dde9f5' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#1a3a6b', letterSpacing:1,
                textTransform:'uppercase', marginBottom:8 }}>AI Analysis</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom: analysis.market_opportunity ? 10 : 0 }}>
                {analysis.intent && (
                  <div style={{ background:'#fff', border:'1px solid #dde9f5', borderRadius:6, padding:'6px 12px' }}>
                    <div style={{ fontSize:9, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>Search Intent</div>
                    <ColorBadge value={analysis.intent} colorMap={INTENT_COLORS}/>
                  </div>
                )}
                {analysis.buyer_stage && (
                  <div style={{ background:'#fff', border:'1px solid #dde9f5', borderRadius:6, padding:'6px 12px' }}>
                    <div style={{ fontSize:9, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>Buyer Stage</div>
                    <ColorBadge value={analysis.buyer_stage} colorMap={STAGE_COLORS}/>
                  </div>
                )}
                {analysis.estimated_cpc_range && (
                  <div style={{ background:'#fff', border:'1px solid #dde9f5', borderRadius:6, padding:'6px 12px' }}>
                    <div style={{ fontSize:9, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>Est. CPC Range</div>
                    <span style={{ fontSize:13, fontWeight:700, color:'#1a3a6b' }}>{analysis.estimated_cpc_range}</span>
                  </div>
                )}
              </div>
              {analysis.market_opportunity && (
                <div style={{ fontSize:12, color:'#4a4a4a', background:'#fff', border:'1px solid #dde9f5',
                  borderRadius:6, padding:'8px 12px', lineHeight:1.6 }}>
                  <span style={{ fontWeight:600, color:'#2e7d32' }}>Market Opportunity: </span>
                  {analysis.market_opportunity}
                </div>
              )}
            </div>
          )}

          {/* Ideas table */}
          <div style={{ overflow:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr>
                  {[
                    ['Keyword Idea',  'left',   160],
                    ['Match Type',    'center',   90],
                    ['Search Intent', 'center',  115],
                    ['Buyer Stage',   'center',  115],
                    ['Searches/mo',   'center',   85],
                    ['Competition',   'center',   88],
                    ['Est. CPC',      'center',   80],
                    ['CPC vs Avg',    'center',   88],
                    ['Conv. Score',   'center',   80],
                    ['Traffic',              'center',   95],
                    ['Recommended Campaign', 'left',    160],
                    ['Recommended Ad Groups','left',    160],
                    ['Why It Converts',      'left',    220],
                  ].map(([l, a, w]) => {
                    const active = sortCol === l
                    const sortable = l !== 'Why It Converts'
                    return (
                      <th key={l}
                        onClick={sortable ? () => toggleSort(l) : undefined}
                        style={{ background: active ? '#0f2850' : '#1a3a6b', color:'#fff',
                          padding:'8px 10px', textAlign:a, fontSize:10, fontWeight:600,
                          whiteSpace:'nowrap', position:'sticky', top:0, zIndex:2, minWidth:w,
                          cursor: sortable ? 'pointer' : 'default', userSelect:'none' }}>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:4,
                          justifyContent: a === 'center' ? 'center' : 'flex-start' }}>
                          {l}
                          {sortable && (
                            <span style={{ fontSize:9, opacity: active ? 1 : 0.35, lineHeight:1 }}>
                              {active ? (sortDir === 'asc' ? '▲' : '▼') : '⬍'}
                            </span>
                          )}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sortIdeas(ideas).map((r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f5f7fa' }}>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', fontWeight:600, color:'#2563b0' }}>
                      {r.keyword}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <StatusBadge value={r.matchType} type="match"/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ColorBadge value={r.searchIntent} colorMap={INTENT_COLORS}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ColorBadge value={r.buyerStage} colorMap={STAGE_COLORS}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', color:'#555', fontSize:11 }}>
                      {r.monthlySearches || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      {r.competition && (
                        <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:4, whiteSpace:'nowrap',
                          background:`${COMPETITION_BADGE[r.competition]||'#888'}22`,
                          color:      COMPETITION_BADGE[r.competition]||'#888',
                          border:`1px solid ${COMPETITION_BADGE[r.competition]||'#888'}44` }}>
                          {r.competition}
                        </span>
                      )}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', fontWeight:600, color:'#1a3a6b', whiteSpace:'nowrap' }}>
                      {r.estimatedCpc || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', fontWeight:700, color:'#2e7d32', whiteSpace:'nowrap' }}>
                      {r.estimatedSavings || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ConvScore score={r.conversionScore}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ColorBadge value={r.trafficPotential} colorMap={TRAFFIC_COLORS}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', color:'#1a3a6b', fontSize:11,
                      maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {r.recommendedCampaign || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', color:'#2563b0', fontSize:11,
                      maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {r.adGroup || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', color:'#4a4a4a', lineHeight:1.5 }}>
                      {r.whyItConverts || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Campaign structure + negative keywords */}
          {(campaignStructure || negKeywords.size > 0) && (
            <div style={{ display:'flex', flexWrap:'wrap', borderTop:'1px solid #f0f4f8', background:'#fafbfd' }}>
              {campaignStructure && (campaignStructure.campaign_name || campaignStructure.ad_groups?.length > 0) && (
                <div style={{ flex:'1 1 260px', padding:'12px 16px', borderRight:'1px solid #f0f4f8' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'#1a3a6b', letterSpacing:1,
                    textTransform:'uppercase', marginBottom:6 }}>Campaign Structure</div>
                  {campaignStructure.campaign_name && (
                    <div style={{ fontSize:11, fontWeight:700, color:'#1a3a6b', marginBottom:7 }}>
                      📁 {campaignStructure.campaign_name}
                    </div>
                  )}
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {(campaignStructure.ad_groups || []).map((ag, i) => (
                      <span key={i} style={{ fontSize:11, padding:'3px 9px', background:'#e3f2fd',
                        color:'#1565c0', border:'1px solid #2196f330', borderRadius:4, fontWeight:500 }}>
                        {ag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {negKeywords.size > 0 && (
                <div style={{ flex:'1 1 260px', padding:'12px 16px' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'#1a3a6b', letterSpacing:1,
                    textTransform:'uppercase', marginBottom:6 }}>Suggested Negative Keywords</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {[...negKeywords].map((nk, i) => (
                      <span key={i} style={{ fontSize:11, padding:'3px 9px', background:'#ffebee',
                        color:'#b71c1c', border:'1px solid #f4433630', borderRadius:4, fontWeight:500 }}>
                        −{nk}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
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
function NegativeKeywordsTab({ data, loading, error, onRetry }) {
  const [selected,         setSelected]         = useState(new Set())
  const [copied,           setCopied]           = useState(false)
  const [recFilter,        setRecFilter]        = useState('')
  const [appliedRecFilter, setAppliedRecFilter] = useState('')
  const [recPage,          setRecPage]          = useState(0)
  const [recPageSize,      setRecPageSize]      = useState(10)
  const [recSortKey,       setRecSortKey]       = useState('')
  const [recSortAsc,       setRecSortAsc]       = useState(false)
  const [negCampFilter,    setNegCampFilter]    = useState('')
  const [negCampStatus,    setNegCampStatus]    = useState('')
  const [negKwStatus,      setNegKwStatus]      = useState('')
  const [recCampFilter,    setRecCampFilter]    = useState('')
  const [recCampStatus,    setRecCampStatus]    = useState('')
  const [recKwStatus,      setRecKwStatus]      = useState('')

  useEffect(() => { const t = setTimeout(() => setAppliedRecFilter(recFilter), 300); return () => clearTimeout(t) }, [recFilter])
  useEffect(() => { setRecPage(0) }, [appliedRecFilter, recSortKey, recSortAsc])

  if (error)   return <ErrorState message={error} onRetry={onRetry} />
  if (loading) return <div style={{ padding:20 }}><div className="skeleton" style={{ height:300, borderRadius:6 }} /></div>
  if (!data)   return null

  const { recommendations = [], existingNegatives = [], potentialSavings = 0 } = data

  const campFilteredRecs = recommendations.filter(r =>
    (!recCampFilter || r.campaign       === recCampFilter) &&
    (!recCampStatus || r.campaignStatus === recCampStatus) &&
    (!recKwStatus   || r.status         === recKwStatus)
  )

  const filteredRecs = appliedRecFilter.trim()
    ? campFilteredRecs.filter(r => Object.values(r).some(v => v != null && typeof v !== 'object' && String(v).toLowerCase().includes(appliedRecFilter.toLowerCase())))
    : campFilteredRecs

  const visibleRecs = recSortKey
    ? [...filteredRecs].sort((a, b) => {
        const va = a[recSortKey], vb = b[recSortKey]
        if (va == null) return 1
        if (vb == null) return -1
        const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))
        return recSortAsc ? cmp : -cmp
      })
    : filteredRecs

  function toggleSelect(i) { setSelected(s => { const n = new Set(s); n.has(i)?n.delete(i):n.add(i); return n }) }

  function copySelected() {
    const lines = [...selected].map(i => { const r = recommendations[i]; return r ? `[${r.recommendedMatchType}] ${r.term}` : '' }).filter(Boolean)
    navigator.clipboard?.writeText(lines.join('\n')).catch(()=>{})
    setCopied(true); setTimeout(()=>setCopied(false), 2000)
  }

  const reasonColor = { 'Wasted spend':'#e05c2a', 'Low relevance':'#f0b429', 'Irrelevant intent':'#2563b0' }

  const recCols = [
    { key:'term',       label:'Search Term', sortable:true, align:'left',   width:200, format:(v,row)=><span style={{color:kwStatusColor(row.campaignStatus||''),fontWeight:500}}>{v}</span> },
    { key:'campaign',   label:'Campaign',    sortable:true, align:'left', format:(v,row)=><span style={{color:kwStatusColor(row.campaignStatus||''),fontWeight:500}}>{v}</span> },
    { key:'impressions',label:'Impr.',       sortable:true, align:'right',  format:fmtNum },
    { key:'clicks',     label:'Clicks',      sortable:true, align:'right',  format:fmtNum },
    { key:'cost',       label:'Cost',        sortable:true, align:'right',  format:fmtUsd },
    { key:'conversions',label:'Conv.',       sortable:true, align:'right',  format:fmtNum },
    { key:'reason',     label:'Reason',      sortable:true, align:'center',
      format: v => <span style={{ fontSize:11, fontWeight:600, padding:'2px 7px', borderRadius:4, background:`${reasonColor[v]||'#888'}22`, color:reasonColor[v]||'#888', border:`1px solid ${reasonColor[v]||'#888'}55` }}>{v}</span> },
    { key:'recommendedMatchType', label:'Match', sortable:true, align:'center', format: v => <StatusBadge value={v} type="match"/> },
  ]
  const negCols = [
    { key:'text',      label:'Keyword',   sortable:true, align:'left', format:(v,row)=><span style={{color:kwStatusColor(row.status||row.campaignStatus||''),fontWeight:500}}>{v}</span> },
    { key:'matchType', label:'Match Type',sortable:true, align:'center', format: v => <StatusBadge value={v} type="match"/> },
    { key:'campaign',  label:'Campaign',  sortable:true, align:'left', format:(v,row)=><span style={{color:kwStatusColor(row.campaignStatus||''),fontWeight:500}}>{v}</span> },
    { key:'adGroup',   label:'Ad Group',  sortable:true, align:'left'   },
    { key:'level',     label:'Level',     sortable:true, align:'center' },
  ]

  return (
    <div>
      {recommendations.length > 0 && (
        <div style={{ background:'#fff8e1', border:'1px solid #f0b429', borderRadius:8, padding:'12px 16px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:13, color:'#a56700', fontWeight:500 }}>
            {recommendations.length} search terms recommended as negatives · potential savings: {fmtUsd(potentialSavings)}
          </span>
          <div style={{ display:'flex', gap:8 }}>
            {selected.size > 0 && (
              <button onClick={copySelected} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 12px', background:'#2563b0', color:'#fff', fontSize:12, fontWeight:600, borderRadius:5, border:'none', cursor:'pointer' }}>
                {copied ? <><Check size={12}/> Copied!</> : <><Copy size={12}/> Copy {selected.size} selected</>}
              </button>
            )}
            <ExportButton data={recommendations} filename="negative-recommendations" />
          </div>
        </div>
      )}

      <Section title="Recommended Negative Keywords">
        <CampFilterBar allData={recommendations} campFilter={recCampFilter} setCampFilter={setRecCampFilter} campStatusFilter={recCampStatus} setCampStatusFilter={setRecCampStatus} kwStatusFilter={recKwStatus} setKwStatusFilter={setRecKwStatus}/>
        <div style={{ padding:'8px 12px', borderBottom:'1px solid #f0f4f8', display:'flex', alignItems:'center', gap:8, background:'#fafcff' }}>
          <Search size={13} style={{ color:'#aaa', flexShrink:0 }} />
          <input value={recFilter} onChange={e => setRecFilter(e.target.value)} placeholder="Filter rows…"
            style={{ flex:1, border:'none', outline:'none', fontSize:12, color:'#1a3a6b', background:'transparent' }} />
          {recFilter && <button onClick={() => { setRecFilter(''); setAppliedRecFilter('') }} style={{ color:'#aaa', display:'flex', alignItems:'center' }}><X size={12}/></button>}
          {appliedRecFilter && <span style={{ fontSize:11, color:'#888', whiteSpace:'nowrap' }}>{visibleRecs.length} result{visibleRecs.length!==1?'s':''}</span>}
        </div>
        <div style={{ overflow:'auto', maxHeight:'70vh' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                <th style={{ background:'#1a3a6b', color:'#fff', padding:'9px 10px', width:40, textAlign:'center', position:'sticky', top:0, zIndex:2 }}>
                  <input type="checkbox" onChange={e => setSelected(e.target.checked ? new Set(visibleRecs.map((_,i)=>i)) : new Set())} />
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
              </tr>
            </thead>
            <tbody>
              {visibleRecs.length === 0
                ? <tr><td colSpan={recCols.length+2} style={{ padding:'28px 0', textAlign:'center', color:'#aaa' }}>No negative keyword recommendations for this period</td></tr>
                : visibleRecs.slice(recPage*recPageSize, (recPage+1)*recPageSize).map((row, vi) => {
                    const ri = recPage * recPageSize + vi
                    return (
                      <tr key={ri} style={{ background:selected.has(ri)?'#e8f0fb':vi%2===0?'#fff':'#f5f7fa' }}>
                        <td style={{ padding:'8px 12px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                          <input type="checkbox" checked={selected.has(ri)} onChange={() => toggleSelect(ri)} />
                        </td>
                        <td style={{ padding:'8px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', color:'#aaa', fontSize:11 }}>{ri + 1}</td>
                        {recCols.map((c,ci) => {
                          const raw = row[c.key]
                          const cell = c.format ? c.format(raw,row) : c.badge ? <StatusBadge value={raw}/> : (raw??'—')
                          return <td key={c.key} style={{ padding:'8px 12px', borderBottom:'1px solid #f0f4f8', textAlign:c.align||'left', color:ci===0?'#1a3a6b':'#4a4a4a', fontWeight:ci===0?500:400, maxWidth:ci===0?240:undefined, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cell}</td>
                        })}
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
        {Math.ceil(visibleRecs.length / recPageSize) > 1 && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderTop:'1px solid #f0f4f8', flexWrap:'wrap', gap:8 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:12, color:'#888' }}>Rows per page:</span>
              <select value={recPageSize} onChange={e=>{setRecPageSize(Number(e.target.value));setRecPage(0)}} style={{ padding:'4px 8px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer' }}>
                {[10,25,50,100].map(s=><option key={s} value={s}>{s}</option>)}
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

      {(() => {
        const negFiltered = existingNegatives.filter(r =>
          (!negCampFilter || r.campaign       === negCampFilter) &&
          (!negCampStatus || r.campaignStatus === negCampStatus) &&
          (!negKwStatus   || r.status         === negKwStatus)
        )
        return (
          <Section title={`Existing Negative Keywords (${existingNegatives.length})`} extra={<ExportButton data={negFiltered} filename="existing-negatives" />}>
            <CampFilterBar allData={existingNegatives} campFilter={negCampFilter} setCampFilter={setNegCampFilter} campStatusFilter={negCampStatus} setCampStatusFilter={setNegCampStatus} kwStatusFilter={negKwStatus} setKwStatusFilter={setNegKwStatus}/>
            <ReportTable columns={negCols} data={negFiltered} loading={loading}
              emptyMessage="No existing negative keywords found"
              pagination={true} defaultPageSize={10} noFilter />
          </Section>
        )
      })()}
    </div>
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

function AllKeywordsTab({ rows, loading, onDrillDown }) {
  const [campaignFilter,       setCampaignFilter]       = useState('')
  const [adGroupFilter,        setAdGroupFilter]        = useState('')
  const [campaignStatusFilter, setCampaignStatusFilter] = useState('')
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

  const hasFilter = campaignFilter || adGroupFilter || campaignStatusFilter || adGroupStatusFilter || keywordStatusFilter

  const cols = [
    { key:'text', label:'Keyword', sortable:true, align:'left',
      format: (v, row) => <span style={{ color: kwStatusColor(row.status), fontWeight:500 }}>{v}</span> },
    { key:'adGroup',  label:'Ad Group',  sortable:true, align:'left',
      format: (v, row) => <span style={{ color: kwStatusColor(row.adGroupStatus), fontWeight:500 }}>{v}</span> },
    { key:'campaign', label:'Campaign',  sortable:true, align:'left',
      format: (v, row) => <span style={{ color: kwStatusColor(row.campaignStatus), fontWeight:500 }}>{v}</span> },
    { key:'matchType',    label:'Match Type',     sortable:true,  align:'center',
      format: v => <StatusBadge value={v} type="match"/> },
    { key:'qualityScore', label:'Quality Score',  sortable:true,  align:'center',
      format: v => (
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <QsDots score={v}/>
          <span style={{ fontSize:10, fontWeight:700, color:qsColor(v), minWidth:14 }}>{v||'—'}</span>
        </div>
      )},
    { key:'impressions',  label:'Impressions',    sortable:true,  align:'right', format:fmtNum },
    { key:'clicks',       label:'Clicks',         sortable:true,  align:'right', format:fmtNum },
    { key:'ctr',          label:'CTR',            sortable:true,  align:'right', format:fmtPct },
    { key:'cpc',          label:'CPC',            sortable:true,  align:'right', format:fmtUsd },
    { key:'cost',         label:'Cost',           sortable:true,  align:'right',
      format: v => '$'+Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) },
    { key:'conversions',  label:'Conversions',    sortable:true,  align:'right', format:fmtNum },
    { key:'phoneCalls',   label:'Call Leads',     sortable:true,  align:'center',
      format: (v,row) => <PhoneCallBadge count={v} campaignName={row.campaign} onDrillDown={onDrillDown}/> },
  ]

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
          <button onClick={() => { setCampaignFilter(''); setAdGroupFilter(''); setCampaignStatusFilter(''); setAdGroupStatusFilter(''); setKeywordStatusFilter('') }}
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
          <ExportButton data={filtered} filename="all-keywords"/>
        </div>
      </div>

      <ReportTable
        columns={cols}
        data={filtered}
        loading={loading}
        noFilter
        defaultPageSize={10}
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

  const hasFilter = campFilter || campStatusFilter || (setAdGroupFilter && adGroupFilter) || (setKwStatusFilter && kwStatusFilter)

  return (
    <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f4f8', background:'#fafcff', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign Name:</span>
        <select value={campFilter} onChange={e => { setCampFilter(e.target.value); setCampStatusFilter(''); setAdGroupFilter?.('') }} style={selStyle}>
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
        <button onClick={() => { setCampFilter(''); setCampStatusFilter(''); setAdGroupFilter?.(''); setKwStatusFilter?.('') }}
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

// ── CPC Keyword Optimizer ────────────────────────────────────────────────────
const COMPETITION_BADGE = { Low:'#2e7d32', Medium:'#a56700', High:'#c0392b' }

const INTENT_COLORS = {
  'Transactional':    { bg:'#e8f5e9', text:'#2e7d32', border:'#4caf5040' },
  'Commercial':       { bg:'#e3f2fd', text:'#1565c0', border:'#2196f340' },
  'Local Service':    { bg:'#f3e5f5', text:'#6a1b9a', border:'#9c27b040' },
  'Emergency':        { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
  'Price Comparison': { bg:'#fff3e0', text:'#e65100', border:'#ff980040' },
}
const STAGE_COLORS = {
  'Ready To Buy':      { bg:'#e8f5e9', text:'#2e7d32', border:'#4caf5040' },
  'Comparing Options': { bg:'#e3f2fd', text:'#1565c0', border:'#2196f340' },
  'Urgent Need':       { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
}
const TRAFFIC_COLORS = {
  'High Traffic':    { bg:'#e3f2fd', text:'#1565c0', border:'#2196f340' },
  'Balanced':        { bg:'#f5f5f5', text:'#555555', border:'#99999940' },
  'High Conversion': { bg:'#e8f5e9', text:'#2e7d32', border:'#4caf5040' },
}

function ColorBadge({ value, colorMap }) {
  if (!value) return <span style={{ color:'#bbb', fontSize:11 }}>—</span>
  const c = colorMap[value] || { bg:'#f5f5f5', text:'#555', border:'#99999940' }
  return (
    <span style={{ display:'inline-block', fontSize:10, fontWeight:600, padding:'2px 7px',
      borderRadius:4, background:c.bg, color:c.text, border:`1px solid ${c.border}`, whiteSpace:'nowrap' }}>
      {value}
    </span>
  )
}

function ConvScore({ score }) {
  const n = Number(score) || 0
  if (!n) return <span style={{ color:'#bbb', fontSize:11 }}>—</span>
  const color = n >= 80 ? '#2e7d32' : n >= 60 ? '#a56700' : '#888'
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
      <span style={{ fontSize:12, fontWeight:700, color }}>{n}<span style={{ fontSize:9, fontWeight:400, color:'#aaa' }}>/100</span></span>
      <div style={{ width:38, height:4, borderRadius:2, background:'#eee', overflow:'hidden' }}>
        <div style={{ width:`${n}%`, height:'100%', background:color, borderRadius:2 }}/>
      </div>
    </div>
  )
}

// ── Negative Keywords Optimizer ──────────────────────────────────────────────
const NEG_PRIORITY_COLORS = {
  Critical: { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
  High:     { bg:'#fff3e0', text:'#e65100', border:'#ff980040' },
  Medium:   { bg:'#fff8e1', text:'#f57f17', border:'#fbc02d40' },
  Low:      { bg:'#f5f5f5', text:'#555',    border:'#99999940' },
}
const NEG_SAFETY_COLORS = {
  Safe:   { bg:'#e8f5e9', text:'#2e7d32', border:'#4caf5040' },
  Review: { bg:'#fff3e0', text:'#e65100', border:'#ff980040' },
  Risky:  { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
}
const NEG_SEVERITY_COLORS = {
  'Critical Waste': { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
  'Moderate Waste': { bg:'#fff3e0', text:'#e65100', border:'#ff980040' },
  'Low Waste':      { bg:'#fff8e1', text:'#f57f17', border:'#fbc02d40' },
}
const NEG_INTENT_COLORS = {
  'Transactional Intent':    { bg:'#e8f5e9', text:'#2e7d32', border:'#4caf5040' },
  'Commercial Intent':       { bg:'#e3f2fd', text:'#1565c0', border:'#2196f340' },
  'Informational Intent':    { bg:'#f3e5f5', text:'#6a1b9a', border:'#9c27b040' },
  'DIY Intent':              { bg:'#fff3e0', text:'#e65100', border:'#ff980040' },
  'Employment Intent':       { bg:'#fce4ec', text:'#880e4f', border:'#e91e6340' },
  'Educational Intent':      { bg:'#e8eaf6', text:'#283593', border:'#3f51b540' },
  'Research Intent':         { bg:'#e0f2f1', text:'#004d40', border:'#00968840' },
  'Freebie Intent':          { bg:'#fff9c4', text:'#f57f17', border:'#ffd54f40' },
  'Competitor Research':     { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
  'Low Commercial Intent':   { bg:'#f5f5f5', text:'#555',    border:'#99999940' },
  'Geographic Mismatch':     { bg:'#f3e5f5', text:'#6a1b9a', border:'#9c27b040' },
}
const NEG_ISSUE_COLORS = {
  Duplicate:    { bg:'#fff3e0', text:'#e65100', border:'#ff980040' },
  Conflict:     { bg:'#ffebee', text:'#b71c1c', border:'#f4433640' },
  Overblocking: { bg:'#fce4ec', text:'#880e4f', border:'#e91e6340' },
  Redundant:    { bg:'#fff8e1', text:'#f57f17', border:'#fbc02d40' },
}

function NegBadge({ value, colorMap }) {
  if (!value) return <span style={{ color:'#bbb', fontSize:11 }}>—</span>
  const c = colorMap[value] || { bg:'#f5f5f5', text:'#555', border:'#99999940' }
  return (
    <span style={{ display:'inline-block', fontSize:10, fontWeight:600, padding:'2px 7px',
      borderRadius:4, background:c.bg, color:c.text, border:`1px solid ${c.border}`, whiteSpace:'nowrap' }}>
      {value}
    </span>
  )
}

function NegConfidenceBar({ score }) {
  const n = Number(score) || 0
  if (!n) return <span style={{ color:'#bbb', fontSize:11 }}>—</span>
  const color = n >= 80 ? '#2e7d32' : n >= 60 ? '#a56700' : '#888'
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
      <span style={{ fontSize:12, fontWeight:700, color }}>{n}<span style={{ fontSize:9, fontWeight:400, color:'#aaa' }}>/100</span></span>
      <div style={{ width:38, height:4, borderRadius:2, background:'#eee', overflow:'hidden' }}>
        <div style={{ width:`${n}%`, height:'100%', background:color, borderRadius:2 }}/>
      </div>
    </div>
  )
}

const NEG_INNER_TABS = [
  { id:'recommendations', label:'Recommendations' },
  { id:'conflicts',       label:'Duplicates & Conflicts' },
  { id:'patterns',        label:'Pattern Analysis' },
]

function NegRecCell({ rec, rowLoading, onRetry }) {
  if (rowLoading) return (
    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
      <div className="skeleton" style={{ height:10, width:'90%', borderRadius:3 }}/>
      <div className="skeleton" style={{ height:10, width:'70%', borderRadius:3 }}/>
    </div>
  )
  if (!rec) return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <span style={{ color:'#bbb', fontSize:11 }}>—</span>
      {onRetry && (
        <button
          onClick={e => { e.stopPropagation(); onRetry() }}
          title="Generate recommendation for this row"
          style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'2px 7px', fontSize:10,
            color:'#2563b0', background:'rgba(37,99,176,0.08)', border:'1px solid rgba(37,99,176,0.25)',
            borderRadius:4, cursor:'pointer', fontWeight:600, whiteSpace:'nowrap' }}>
          <RefreshCw size={9}/> Retry
        </button>
      )}
    </div>
  )
  return (
    <div style={{ fontSize:11, color:'#1a3a6b', lineHeight:1.6, fontWeight:500 }}>
      {rec}
    </div>
  )
}

function NegativeKeywordsOptimizerSection({ rows, negData }) {
  const [result,       setResult]       = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [innerTab,     setInnerTab]     = useState('recommendations')
  const [retryingRows, setRetryingRows] = useState(new Set())
  const pm = usePromptMode()

  const kwCount  = (rows || []).filter(r => r.cost > 0 || r.conversions > 0).length
  const negCount = (negData?.existingNegatives || []).length

  async function analyze() {
    setLoading(true); setError(null); setResult(null)
    try {
      const keywords = (rows || [])
        .filter(r => r.cost > 0 || r.conversions > 0)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 60)
        .map(k => ({
          keyword:   k.text,
          matchType: k.matchType,
          campaign:  k.campaign,
          adGroup:   k.adGroup,
          clicks:      k.clicks,
          impressions: k.impressions,
          cost:        Number((k.cost   || 0).toFixed(2)),
          conversions: k.conversions,
          cpc:         Number((k.cpc   || 0).toFixed(2)),
          ctr:         Number((k.ctr   || 0).toFixed(2)),
          convRate:    Number((k.convRate || 0).toFixed(2)),
        }))

      const negatives = (negData?.existingNegatives || []).slice(0, 50).map(n => ({
        keyword:   n.text,
        matchType: n.matchType,
        level:     n.level,
        campaign:  n.campaign,
        adGroup:   n.adGroup || '',
      }))

      const payload = { keywords, negatives }
      if (pm.activePrompt) payload.customPrompt = pm.activePrompt
      const data = await window.electronAPI.negativeOptimize(payload)
      if (!data || typeof data !== 'object') throw new Error('Empty response from AI. Please try again.')
      // Normalise: ensure all expected keys exist
      setResult({
        summary:         data.summary         || {},
        recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
        conflicts:       Array.isArray(data.conflicts)       ? data.conflicts       : [],
        patterns:        Array.isArray(data.patterns)        ? data.patterns        : [],
      })
    } catch (err) {
      setError(err.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  async function retryRec(index) {
    const row = (result?.recommendations || [])[index]
    if (!row) return
    setRetryingRows(prev => new Set(prev).add(index))
    try {
      const rec = await window.electronAPI.negativeRowRecommend({ row })
      setResult(prev => {
        const recs = [...(prev?.recommendations || [])]
        recs[index] = { ...recs[index], ai_recommendation: rec }
        return { ...prev, recommendations: recs }
      })
    } catch (e) {
      console.error('Row retry failed:', e.message)
    } finally {
      setRetryingRows(prev => { const s = new Set(prev); s.delete(index); return s })
    }
  }

  const summary = result?.summary || {}
  const recommendations = result?.recommendations || []
  const conflicts = result?.conflicts || []
  const patterns  = result?.patterns  || []

  const recCsvRows = useMemo(() => recommendations.map(r => ({
    'Negative Keyword':  r.negative_keyword  || '',
    'Match Type':        r.match_type        || '',
    'Intent':            r.intent_type       || '',
    'Priority':          r.priority          || '',
    'Confidence Score':  r.confidence_score  ?? '',
    'Waste Severity':    r.waste_severity    || '',
    'Safety':            r.blocking_safety   || '',
    'Est. Savings':      r.estimated_savings || '',
    'Placement':         r.placement         || '',
    'AI Explanation':    r.ai_explanation    || '',
    'AI Recommendation': r.ai_recommendation || '',
  })), [recommendations])

  const conflictCsvRows = useMemo(() => conflicts.map(r => ({
    'Keyword':           r.keyword    || '',
    'Issue Type':        r.issue_type || '',
    'Severity':          r.severity   || '',
    'Locations':         Array.isArray(r.locations) ? r.locations.join(', ') : (r.locations || ''),
    'Impact':            r.impact         || '',
    'AI Recommendation': r.recommendation || '',
  })), [conflicts])

  const patternCsvRows = useMemo(() => patterns.map(r => ({
    'Pattern':              r.pattern              || '',
    'Intent':               r.intent_category      || '',
    'Affected Terms':       Array.isArray(r.affected_terms) ? r.affected_terms.join(', ') : (r.affected_terms || ''),
    'Recommended Negative': r.recommended_negative || '',
    'Match Type':           r.match_type           || '',
  })), [patterns])

  const recColumns = [
    { key:'negative_keyword', label:'Negative Keyword', sortable:true, align:'left',
      format:(v,row) => <span style={{ fontWeight:600, color:'#c0392b' }}>{v}</span> },
    { key:'match_type',    label:'Match Type',    sortable:true, align:'center',
      format:v => <StatusBadge value={v} type="match"/> },
    { key:'intent_type',   label:'Intent',        sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_INTENT_COLORS}/> },
    { key:'priority',      label:'Priority',      sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_PRIORITY_COLORS}/> },
    { key:'confidence_score', label:'Confidence', sortable:true, align:'center',
      format:v => <NegConfidenceBar score={v}/> },
    { key:'waste_severity', label:'Waste',        sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_SEVERITY_COLORS}/> },
    { key:'blocking_safety', label:'Safety',      sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_SAFETY_COLORS}/> },
    { key:'estimated_savings', label:'Est. Savings', sortable:true, align:'center',
      format:v => <span style={{ fontWeight:700, color:'#2e7d32' }}>{v||'—'}</span> },
    { key:'placement',     label:'Placement',     sortable:true, align:'left', width:130,
      format:v => <span style={{ fontSize:11, color:'#555' }}>{v||'—'}</span> },
    { key:'ai_explanation', label:'AI Explanation', sortable:false, align:'left', width:200, wrap:true,
      format:v => <span style={{ fontSize:11, color:'#4a4a4a', lineHeight:1.6, whiteSpace:'normal', wordBreak:'break-word', display:'block' }}>{v||'—'}</span> },
    { key:'ai_recommendation', label:'AI Recommendation', sortable:false, align:'left', width:260, wrap:true,
      format:(v, row) => <NegRecCell rec={v||''} rowLoading={retryingRows.has(row._recIdx)} onRetry={() => retryRec(row._recIdx)}/> },
  ]

  const conflictColumns = [
    { key:'keyword',    label:'Keyword',    sortable:true, align:'left',
      format:v => <span style={{ fontWeight:600, color:'#1a3a6b' }}>{v}</span> },
    { key:'issue_type', label:'Issue Type', sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_ISSUE_COLORS}/> },
    { key:'severity',   label:'Severity',  sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_PRIORITY_COLORS}/> },
    { key:'locations',  label:'Locations', sortable:false, align:'left',
      format:v => <span style={{ fontSize:11, color:'#555' }}>{Array.isArray(v) ? v.join(', ') : v||'—'}</span> },
    { key:'impact',          label:'Impact',            sortable:false, align:'left', width:180, wrap:true,
      format:v => <span style={{ fontSize:11, color:'#4a4a4a', lineHeight:1.6, whiteSpace:'normal', wordBreak:'break-word', display:'block' }}>{v||'—'}</span> },
    { key:'recommendation',  label:'AI Recommendation', sortable:false, align:'left', width:240, wrap:true,
      format:v => <span style={{ fontSize:11, color:'#1a3a6b', fontWeight:500, lineHeight:1.6, whiteSpace:'normal', wordBreak:'break-word', display:'block' }}>{v||'—'}</span> },
  ]

  const patternColumns = [
    { key:'pattern',          label:'Pattern',       sortable:true, align:'left',
      format:v => <span style={{ fontWeight:600, color:'#c0392b', fontFamily:'monospace', fontSize:12 }}>{v}</span> },
    { key:'intent_category',  label:'Intent',        sortable:true, align:'center',
      format:v => <NegBadge value={v} colorMap={NEG_INTENT_COLORS}/> },
    { key:'affected_terms',   label:'Affected Terms', sortable:false, align:'left', width:200, wrap:true,
      format:v => <span style={{ fontSize:11, color:'#555', lineHeight:1.6, whiteSpace:'normal', wordBreak:'break-word', display:'block' }}>{Array.isArray(v) ? v.join(', ') : v||'—'}</span> },
    { key:'recommended_negative', label:'Recommended Negative', sortable:true, align:'left',
      format:v => <span style={{ fontWeight:600, color:'#c0392b' }}>{v||'—'}</span> },
    { key:'match_type',       label:'Match Type',    sortable:true, align:'center',
      format:v => <StatusBadge value={v} type="match"/> },
  ]

  const summaryCards = result ? [
    { label:'Est. Wasted Spend',   value: summary.estimated_monthly_wasted_spend || '—', color:'#c0392b' },
    { label:'Recommendations',     value: summary.total_recommendations ?? recommendations.length, color:'#1a3a6b' },
    { label:'Critical Issues',     value: summary.critical_issues ?? 0, color:'#e65100' },
    { label:'Duplicates Found',    value: summary.duplicates_found ?? conflicts.length, color:'#a56700' },
    { label:'Overblocking Risks',  value: summary.overblocking_risks ?? 0, color:'#880e4f' },
    { label:'Est. Monthly Savings',value: summary.estimated_monthly_savings || '—', color:'#2e7d32' },
  ] : []

  return (
    <Section title="🚫 Negative Keywords Optimizer">
      <PromptModal show={pm.showModal} context="negative" draft={pm.draftPrompt}
        onChangeDraft={pm.setDraftPrompt} onSave={pm.saveModal} onClose={pm.closeModal}/>

      {/* Trigger panel */}
      <div className="card-body" style={{ borderBottom:'1px solid #dde9f5' }}>
        <PromptModeBar promptMode={pm.promptMode} customPrompt={pm.customPrompt}
          onSetDefault={() => pm.setPromptMode('default')} onOpenModal={pm.openModal}/>
        <div style={{ fontSize:12, color:'#555', marginBottom:10 }}>
          Analyzes your keyword performance data and existing negative keywords to identify wasted spend, detect conflicts, and recommend strategic negatives.
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <button
            onClick={analyze}
            disabled={loading || !kwCount || (pm.promptMode === 'custom' && !pm.customPrompt.trim())}
            style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 18px',
              background: loading || !kwCount ? '#dde9f5' : '#c0392b',
              color: loading || !kwCount ? '#aaa' : '#fff',
              fontWeight:700, fontSize:13, borderRadius:6, border:'none',
              cursor: loading || !kwCount ? 'not-allowed' : 'pointer' }}
          >
            {loading && <Loader2 size={13} className="spin"/>}
            {loading ? 'Analysing…' : '🚫 Analyze & Optimize Negatives'}
          </button>
          <span style={{ fontSize:12, color:'#888' }}>
            {kwCount} keywords with spend{negCount > 0 ? ` · ${negCount} existing negatives` : ' · no existing negatives loaded'}
          </span>
        </div>
        {error && <div style={{ marginTop:8, fontSize:12, color:'#c0392b' }}>⚠ {error}</div>}
      </div>

      {/* Summary cards */}
      {result && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:0, borderBottom:'1px solid #dde9f5' }}>
          {summaryCards.map(({ label, value, color }) => (
            <div key={label} style={{ flex:'1 1 120px', padding:'14px 16px', borderRight:'1px solid #f0f4f8', textAlign:'center' }}>
              <div style={{ fontSize:20, fontWeight:700, color }}>{value}</div>
              <div style={{ fontSize:11, color:'#888', marginTop:3 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Inner tabs */}
      {result && (
        <>
          <div style={{ background:'#fff', borderBottom:'1px solid #dde9f5', padding:'0 16px', display:'flex', gap:0, alignItems:'center' }}>
            {NEG_INNER_TABS.map(t => {
              const count = t.id === 'recommendations' ? recommendations.length : t.id === 'conflicts' ? conflicts.length : patterns.length
              return (
                <button key={t.id} onClick={() => setInnerTab(t.id)}
                  style={{ padding:'10px 16px', fontSize:12, fontWeight: innerTab===t.id ? 700 : 500,
                    color: innerTab===t.id ? '#1a3a6b' : '#666', background:'none', border:'none',
                    cursor:'pointer', borderBottom: innerTab===t.id ? '2px solid #1a3a6b' : '2px solid transparent',
                    marginBottom:-1, display:'inline-flex', alignItems:'center', gap:6 }}>
                  {t.label}
                  {count > 0 && (
                    <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10,
                      background: innerTab===t.id ? '#1a3a6b' : '#e05c2a', color:'#fff' }}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
            <div style={{ marginLeft:'auto', paddingRight:4 }}>
              {innerTab === 'recommendations' && <ExportButton data={recCsvRows} filename="negative_recommendations.csv" label="Export CSV"/>}
              {innerTab === 'conflicts'       && <ExportButton data={conflictCsvRows} filename="negative_conflicts.csv" label="Export CSV"/>}
              {innerTab === 'patterns'        && <ExportButton data={patternCsvRows} filename="negative_patterns.csv" label="Export CSV"/>}
            </div>
          </div>

          {innerTab === 'recommendations' && (
            <ReportTable
              columns={recColumns}
              data={recommendations.map((r, i) => ({ ...r, _recIdx: i }))}
              noFilter
              resizable
              emptyMessage="No recommendations generated."
            />
          )}
          {innerTab === 'conflicts' && (
            <ReportTable
              columns={conflictColumns}
              data={conflicts}
              noFilter
              resizable
              emptyMessage="No duplicate or conflict issues detected."
            />
          )}
          {innerTab === 'patterns' && (
            <ReportTable
              columns={patternColumns}
              data={patterns}
              noFilter
              resizable
              emptyMessage="No recurring patterns detected."
            />
          )}
        </>
      )}
    </Section>
  )
}

function CpcOptimizerSection({ existingKeywords = [] }) {
  const [input,   setInput]   = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [skipped, setSkipped] = useState(0)
  const pm = usePromptMode()

  // Strips match-type notation so comparisons work regardless of how the AI formats keywords
  const normalizeKw = s => (s || '').toLowerCase().trim()
    .replace(/^\[|\]$/g, '').replace(/^"|"$/g, '').replace(/^\+/g, '').trim()

  const existingKwSet = useMemo(() =>
    new Set((existingKeywords || []).map(r => normalizeKw(r.text)))
  , [existingKeywords])

  function toggleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  function sortAlts(alts) {
    if (!sortCol) return alts
    const COMP_ORDER = { Low:1, Medium:2, High:3 }
    const STAGE_ORDER = { 'Ready To Buy':1, 'Comparing Options':2, 'Urgent Need':3 }
    const parseNum = s => { const m = String(s||'').replace(/,/g,'').match(/[\d.]+/); return m ? Number(m[0]) : 0 }
    const getVal = alt => {
      switch (sortCol) {
        case 'Alternative Keyword': return (alt.alternative || '').toLowerCase()
        case 'Match Type':          return (alt.matchType || '').toLowerCase()
        case 'Search Intent':       return (alt.searchIntent || '').toLowerCase()
        case 'Buyer Stage':         return STAGE_ORDER[alt.buyerStage] ?? 99
        case 'Searches/mo':         return parseNum(alt.monthlySearches)
        case 'Competition':         return COMP_ORDER[alt.competition] ?? 99
        case 'Est. CPC':            return parseNum(alt.estimatedCpc)
        case 'CPC Savings':         return parseNum(alt.estimatedSavings)
        case 'Conv. Score':         return Number(alt.conversionScore) || 0
        case 'Traffic':             return (alt.trafficPotential || '').toLowerCase()
        case 'Ad Group':            return (alt.adGroup || '').toLowerCase()
        default: return 0
      }
    }
    return [...alts].sort((a, b) => {
      const av = getVal(a), bv = getVal(b)
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sortDir === 'asc' ? cmp : -cmp
    })
  }

  function parseKeywords() {
    return input.split('\n')
      .map(line => line.trim()).filter(Boolean)
      .map(line => {
        const parts = line.split(/[,|]/)
        const keyword = (parts[0] || '').trim()
        const cpcRaw  = (parts[1] || '').replace(/[^0-9.]/g, '').trim()
        const cpc     = cpcRaw ? Number(cpcRaw).toFixed(2) : null
        return keyword ? { keyword, cpc } : null
      })
      .filter(Boolean)
  }

  async function optimize() {
    const keywords = parseKeywords()
    if (!keywords.length) return
    setLoading(true); setError(null); setResults(null); setSkipped(0)
    try {
      const payload = { keywords }
      if (pm.activePrompt) payload.customPrompt = pm.activePrompt
      const data = await window.electronAPI.cpcOptimize(payload)
      const raw     = Array.isArray(data) ? data : []
      const deduped = raw.filter(r => !existingKwSet.has(normalizeKw(r.alternative)))
      setSkipped(raw.length - deduped.length)
      setResults(deduped)
    } catch (err) {
      setError(err.message || 'Failed to get alternatives')
    } finally { setLoading(false) }
  }

  const grouped = useMemo(() => {
    if (!results) return {}
    return results.reduce((acc, r) => {
      const k = r.expensiveKeyword || 'Unknown'
      if (!acc[k]) acc[k] = { alts:[], analysis:null, campaignStructure:null, negKeywords:new Set() }
      acc[k].alts.push(r)
      if (!acc[k].analysis && r.analysis) acc[k].analysis = r.analysis
      if (!acc[k].campaignStructure && r.campaignStructure) acc[k].campaignStructure = r.campaignStructure
      ;(r.negativeKeywords || []).forEach(nk => acc[k].negKeywords.add(nk))
      return acc
    }, {})
  }, [results])

  const cpcCsvRows = useMemo(() => {
    const rows = []
    for (const [expKw, { alts }] of Object.entries(grouped)) {
      for (const alt of sortAlts(alts)) {
        rows.push({
          'Expensive Keyword':   expKw,
          'Alternative Keyword': alt.alternative      || '',
          'Match Type':          alt.matchType        || '',
          'Search Intent':       alt.searchIntent     || '',
          'Buyer Stage':         alt.buyerStage       || '',
          'Searches/mo':         alt.monthlySearches  || '',
          'Competition':         alt.competition      || '',
          'Est. CPC':            alt.estimatedCpc     || '',
          'CPC Savings':         alt.estimatedSavings || '',
          'Conv. Score':         alt.conversionScore  ?? '',
          'Traffic':             alt.trafficPotential || '',
          'Ad Group':            alt.adGroup          || '',
          'Why It Converts':     alt.whyItWorks       || '',
        })
      }
    }
    return rows
  }, [grouped, sortCol, sortDir])

  return (
    <Section title="💰 CPC Keyword Optimizer">
      <PromptModal show={pm.showModal} context="cpc" draft={pm.draftPrompt}
        onChangeDraft={pm.setDraftPrompt} onSave={pm.saveModal} onClose={pm.closeModal}/>

      {/* ── Input panel ── */}
      <div className="card-body" style={{ borderBottom:'1px solid #dde9f5' }}>
        <PromptModeBar promptMode={pm.promptMode} customPrompt={pm.customPrompt}
          onSetDefault={() => pm.setPromptMode('default')} onOpenModal={pm.openModal}/>
        <div style={{ fontSize:12, color:'#555', marginBottom:8 }}>
          Enter your expensive keywords — one per line. Optionally include the CPC:<br/>
          <code style={{ fontSize:11, background:'#f0f4f8', padding:'2px 6px', borderRadius:3 }}>
            plumber near me, $18.50
          </code>
        </div>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={'plumber near me, $18.50\nemergency electrician\nroof repair cost, $22.00'}
          rows={5}
          style={{ width:'100%', padding:'8px 12px', border:'1px solid #dde9f5', borderRadius:6,
            fontSize:12, color:'#1a3a6b', outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box' }}
        />
        <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:10 }}>
          <button
            onClick={optimize}
            disabled={loading || !input.trim()}
            style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 18px',
              background: loading || !input.trim() ? '#dde9f5' : '#e8a020',
              color:      loading || !input.trim() ? '#aaa'    : '#1a3a6b',
              fontWeight:700, fontSize:13, borderRadius:6, border:'none',
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer' }}
          >
            {loading && <Loader2 size={13} className="spin"/>}
            {loading ? 'Analysing…' : 'Find Cheaper Alternatives'}
          </button>
          {results && (
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:12, color:'#888' }}>
                {results.length} alternative{results.length !== 1 ? 's' : ''} found for{' '}
                {Object.keys(grouped).length} keyword{Object.keys(grouped).length !== 1 ? 's' : ''}
              </span>
              <ExportButton data={cpcCsvRows} filename="cpc_optimizer.csv" label="Export CSV"/>
            </div>
          )}
        </div>
        {error && <div style={{ marginTop:8, fontSize:12, color:'#c0392b' }}>⚠ {error}</div>}
        {skipped > 0 && (
          <div style={{ marginTop:8, fontSize:12, color:'#a56700', display:'flex', alignItems:'center', gap:5 }}>
            <span>⚠</span>
            <span><strong>{skipped}</strong> alternative{skipped !== 1 ? 's' : ''} removed — already exist in your keyword list (adding them would create keyword crossover).</span>
          </div>
        )}
      </div>

      {results && results.length === 0 && (
        <div style={{ padding:'24px 0', textAlign:'center', color:'#aaa', fontSize:13 }}>
          No alternatives returned. Try different keywords.
        </div>
      )}

      {Object.entries(grouped).map(([expKw, { alts, analysis, campaignStructure, negKeywords }]) => (
        <div key={expKw} style={{ borderBottom:'2px solid #dde9f5' }}>

          {/* ── Seed keyword header ── */}
          <div style={{ padding:'10px 16px', background:'#fff8e1', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, fontWeight:700, color:'#a56700', padding:'2px 8px',
              background:'rgba(240,180,41,0.15)', borderRadius:4, border:'1px solid rgba(240,180,41,0.4)' }}>
              💸 Expensive
            </span>
            <span style={{ fontSize:14, fontWeight:700, color:'#1a3a6b' }}>{expKw}</span>
          </div>

          {/* ── AI Analysis panel ── */}
          {analysis && (
            <div style={{ padding:'12px 16px', background:'#f0f4fb', borderBottom:'1px solid #dde9f5' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#1a3a6b', letterSpacing:1,
                textTransform:'uppercase', marginBottom:8 }}>
                AI Analysis
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom: analysis.why_cpc_is_high ? 10 : 0 }}>
                {analysis.intent && (
                  <div style={{ background:'#fff', border:'1px solid #dde9f5', borderRadius:6, padding:'6px 12px' }}>
                    <div style={{ fontSize:9, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>Search Intent</div>
                    <ColorBadge value={analysis.intent} colorMap={INTENT_COLORS}/>
                  </div>
                )}
                {analysis.buyer_stage && (
                  <div style={{ background:'#fff', border:'1px solid #dde9f5', borderRadius:6, padding:'6px 12px' }}>
                    <div style={{ fontSize:9, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>Buyer Stage</div>
                    <ColorBadge value={analysis.buyer_stage} colorMap={STAGE_COLORS}/>
                  </div>
                )}
                {analysis.estimated_cpc_reduction && (
                  <div style={{ background:'#fff', border:'1px solid #dde9f5', borderRadius:6, padding:'6px 12px' }}>
                    <div style={{ fontSize:9, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>Est. CPC Reduction</div>
                    <span style={{ fontSize:13, fontWeight:700, color:'#2e7d32' }}>{analysis.estimated_cpc_reduction}</span>
                  </div>
                )}
              </div>
              {analysis.why_cpc_is_high && (
                <div style={{ fontSize:12, color:'#4a4a4a', background:'#fff', border:'1px solid #dde9f5',
                  borderRadius:6, padding:'8px 12px', lineHeight:1.6 }}>
                  <span style={{ fontWeight:600, color:'#a56700' }}>Why CPC is high: </span>
                  {analysis.why_cpc_is_high}
                </div>
              )}
            </div>
          )}

          {/* ── Alternatives table ── */}
          <div style={{ overflow:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr>
                  {[
                    ['Alternative Keyword', 'left',   160],
                    ['Match Type',          'center',   90],
                    ['Search Intent',       'center',  115],
                    ['Buyer Stage',         'center',  115],
                    ['Searches/mo',         'center',   85],
                    ['Competition',         'center',   88],
                    ['Est. CPC',            'center',   80],
                    ['CPC Savings',         'center',   88],
                    ['Conv. Score',         'center',   80],
                    ['Traffic',             'center',   95],
                    ['Ad Group',            'left',    140],
                    ['Why It Converts',     'left',    220],
                  ].map(([l, a, w]) => {
                    const active = sortCol === l
                    const sortable = l !== 'Why It Converts'
                    return (
                      <th key={l}
                        onClick={sortable ? () => toggleSort(l) : undefined}
                        style={{ background: active ? '#0f2850' : '#1a3a6b', color:'#fff',
                          padding:'8px 10px', textAlign:a, fontSize:10, fontWeight:600,
                          whiteSpace:'nowrap', position:'sticky', top:0, zIndex:2, minWidth:w,
                          cursor: sortable ? 'pointer' : 'default',
                          userSelect:'none' }}>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:4, justifyContent: a === 'center' ? 'center' : 'flex-start' }}>
                          {l}
                          {sortable && (
                            <span style={{ fontSize:9, opacity: active ? 1 : 0.35, lineHeight:1 }}>
                              {active ? (sortDir === 'asc' ? '▲' : '▼') : '⬍'}
                            </span>
                          )}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sortAlts(alts).map((alt, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f5f7fa' }}>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', fontWeight:600, color:'#2e7d32' }}>
                      {alt.alternative}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <StatusBadge value={alt.matchType} type="match"/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ColorBadge value={alt.searchIntent} colorMap={INTENT_COLORS}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ColorBadge value={alt.buyerStage} colorMap={STAGE_COLORS}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', color:'#555', fontSize:11 }}>
                      {alt.monthlySearches || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      {alt.competition && (
                        <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:4, whiteSpace:'nowrap',
                          background:`${COMPETITION_BADGE[alt.competition]||'#888'}22`,
                          color:      COMPETITION_BADGE[alt.competition]||'#888',
                          border:`1px solid ${COMPETITION_BADGE[alt.competition]||'#888'}44` }}>
                          {alt.competition}
                        </span>
                      )}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', fontWeight:600, color:'#1a3a6b', whiteSpace:'nowrap' }}>
                      {alt.estimatedCpc || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center', fontWeight:700, color:'#2e7d32', whiteSpace:'nowrap' }}>
                      {alt.estimatedSavings || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ConvScore score={alt.conversionScore}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <ColorBadge value={alt.trafficPotential} colorMap={TRAFFIC_COLORS}/>
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', color:'#1a3a6b', fontSize:11,
                      maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {alt.adGroup || '—'}
                    </td>
                    <td style={{ padding:'9px 10px', borderBottom:'1px solid #f0f4f8', color:'#4a4a4a', lineHeight:1.5 }}>
                      {alt.whyItWorks || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Campaign structure + negative keywords ── */}
          {(campaignStructure || negKeywords.size > 0) && (
            <div style={{ display:'flex', flexWrap:'wrap', borderTop:'1px solid #f0f4f8', background:'#fafbfd' }}>
              {campaignStructure && (campaignStructure.campaign_name || campaignStructure.ad_groups?.length > 0) && (
                <div style={{ flex:'1 1 260px', padding:'12px 16px', borderRight:'1px solid #f0f4f8' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'#1a3a6b', letterSpacing:1,
                    textTransform:'uppercase', marginBottom:6 }}>
                    Campaign Structure
                  </div>
                  {campaignStructure.campaign_name && (
                    <div style={{ fontSize:11, fontWeight:700, color:'#1a3a6b', marginBottom:7 }}>
                      📁 {campaignStructure.campaign_name}
                    </div>
                  )}
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {(campaignStructure.ad_groups || []).map((ag, i) => (
                      <span key={i} style={{ fontSize:11, padding:'3px 9px', background:'#e3f2fd',
                        color:'#1565c0', border:'1px solid #2196f330', borderRadius:4, fontWeight:500 }}>
                        {ag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {negKeywords.size > 0 && (
                <div style={{ flex:'1 1 260px', padding:'12px 16px' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'#1a3a6b', letterSpacing:1,
                    textTransform:'uppercase', marginBottom:6 }}>
                    Suggested Negative Keywords
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {[...negKeywords].map((nk, i) => (
                      <span key={i} style={{ fontSize:11, padding:'3px 9px', background:'#ffebee',
                        color:'#b71c1c', border:'1px solid #f4433630', borderRadius:4, fontWeight:500 }}>
                        −{nk}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </Section>
  )
}

// ── Keyword page tabs ─────────────────────────────────────────────────────────
const KW_TABS = [
  { id: 'overview',         label: 'Overview'              },
  { id: 'all',              label: 'Top Keywords by Impression' },
  { id: 'converting',       label: 'Top Converting'        },
  { id: 'overspending',     label: 'Overspending'          },
  { id: 'negativeKeywords', label: 'Negative Keywords'     },
  { id: 'allKeywords',      label: 'All Keywords'         },
  { id: 'planner',          label: '🤖 AI Planner'        },
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
  const [kwCampStatus,    setKwCampStatus]    = useState('')
  const [kwKwStatus,      setKwKwStatus]      = useState('')
  // Filters for Top Converting tab
  const [tcCampFilter,      setTcCampFilter]      = useState('')
  const [tcCampStatus,      setTcCampStatus]      = useState('')
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

  // Fetch negative keywords when negativeKeywords or planner tab becomes active
  useEffect(() => {
    if (!['negativeKeywords','planner'].includes(activeTab) || !selectedAccount || negData || negLoading) return
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

  const tcFiltered = useMemo(() => {
    if (!rows) return []
    let r = rows
    if (tcCampFilter)    r = r.filter(row => row.campaign       === tcCampFilter)
    if (tcCampStatus)    r = r.filter(row => row.campaignStatus === tcCampStatus)
    if (tcAdGroupFilter) r = r.filter(row => row.adGroup        === tcAdGroupFilter)
    if (tcKwStatus)      r = r.filter(row => row.status         === tcKwStatus)
    return r
  }, [rows, tcCampFilter, tcCampStatus, tcAdGroupFilter, tcKwStatus])

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

      {/* ── Tab bar ── */}
      <div style={{ background:'#fff', borderBottom:'2px solid #dde9f5', padding:'0 24px', display:'flex', gap:0, flexShrink:0 }}>
        {KW_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding:'12px 20px', fontSize:13, fontWeight: activeTab===t.id ? 700 : 500,
              color: activeTab===t.id ? '#1a3a6b' : '#666',
              background:'none', border:'none', cursor:'pointer', whiteSpace:'nowrap',
              borderBottom: activeTab===t.id ? '2px solid #1a3a6b' : '2px solid transparent',
              marginBottom: -2, transition:'color 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

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
                  <ExportButton data={filtered} filename="keywords-top-impressions"/>
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
            <TopConvertingSection rows={tcFiltered} loading={loading}/>
          </>
        )}

        {/* ── Overspending ── */}
        {activeTab === 'overspending' && (
          <WastedSpendSection selectedAccount={selectedAccount} dateRange={dateRange}/>
        )}

        {/* ── Negative Keywords ── */}
        {activeTab === 'negativeKeywords' && (
          <NegativeKeywordsTab
            data={negData}
            loading={negLoading}
            error={negError}
            onRetry={() => { setNegData(null); setNegError(null) }}
          />
        )}

        {/* ── All Keywords ── */}
        {activeTab === 'allKeywords' && (
          <AllKeywordsTab
            rows={rows}
            loading={loading}
            onDrillDown={handleCallDrillDown}
          />
        )}

        {/* ── AI Keyword Planner ── */}
        {activeTab === 'planner' && (
          <>
            <KeywordPlannerSection selectedAccount={selectedAccount} existingKeywords={rows || []}/>
            <CpcOptimizerSection existingKeywords={rows || []}/>
            <NegativeKeywordsOptimizerSection rows={rows} negData={negData}/>
          </>
        )}

      </div>
    </div>
  )
}
