import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { AlertCircle, RefreshCw, Copy, Check, Info, Search, X } from 'lucide-react'
import dayjs from 'dayjs'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts'
import ReportTable  from '../components/ReportTable.jsx'
import StatusBadge  from '../components/StatusBadge.jsx'
import ExportButton from '../components/ExportButton.jsx'
import KPICards     from '../components/KPICards.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import EmptyState   from '../components/EmptyState.jsx'
import { resolveEnum, CAMPAIGN_STATUS, NETWORK_TYPE, DEVICE_TYPE, CLICK_TYPE, AD_SLOT, AD_TYPE, CALL_STATUS, CALL_TYPE, CALL_TRACKING_CONDITION } from '../utils/enumMaps.js'

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtUsd  = v => '$' + Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})
const fmtNum  = v => Number(v||0).toLocaleString()
const fmtPct  = v => Number(v||0).toFixed(2) + '%'
const fmtCpc  = v => '$' + Number(v||0).toFixed(2)
const fmtRoas = v => Number(v||0).toFixed(2) + 'x'
const convRateColor = v => v > 5 ? '#2e7d32' : v >= 2 ? '#a56700' : '#c0392b'

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { key:'campaigns',        label:'Campaigns'                 },
  { key:'adGroups',         label:'Ad Groups'                 },
  { key:'assetGroups',      label:'Asset Groups'              },
  { key:'networks',         label:'Performance by Network'    },
  { key:'devices',          label:'Performance by Device'     },
  { key:'clickTypes',       label:'Performance by Click Type' },
  { key:'adSlots',          label:'Performance by Ad Slot'    },
  { key:'summary',          label:'Summary'                   },
  { key:'callLeads',        label:'Call Leads'                },
  { key:'adsPerformance',   label:'Ads Performance'           },
]

// ── Shared UI helpers ─────────────────────────────────────────────────────────
function NoAccount() {
  return <div style={{ padding:'60px 0', textAlign:'center', color:'#aaa', fontSize:14 }}>Select an account to view reports</div>
}
function ErrorState({ message, onRetry }) {
  return (
    <div style={{ padding:32, display:'flex', justifyContent:'center' }}>
      <div style={{ background:'#fff', border:'1px solid #ffd5cc', borderRadius:10, padding:'24px 28px', maxWidth:380, textAlign:'center' }}>
        <AlertCircle size={32} color="#e05c2a" style={{ marginBottom:10 }} />
        <div style={{ fontSize:14, fontWeight:600, color:'#1a3a6b', marginBottom:6 }}>Failed to load report</div>
        <div style={{ fontSize:12, color:'#666', lineHeight:1.5, marginBottom:16 }}>{message}</div>
        <button onClick={onRetry} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 18px', background:'#2563b0', color:'#fff', borderRadius:6, fontWeight:600, fontSize:13, border:'none', cursor:'pointer' }}>
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    </div>
  )
}
function Section({ title, children, extra }) {
  return (
    <div className="card" style={{ marginBottom:20 }}>
      <div className="card-header"><span className="card-title">{title}</span>{extra}</div>
      {children}
    </div>
  )
}

// ── Status helper — shows 'Eligible' for any enabled/active variant ──────────
const ACTIVE_VALS = new Set(['Active','Enabled','ENABLED','ACTIVE','active','enabled','2',2])
const reportStatusBadge = v => {
  const display = ACTIVE_VALS.has(v) ? 'Eligible'
    : resolveEnum(CAMPAIGN_STATUS, v, String(v ?? '—'))
  return <StatusBadge value={display} />
}

// ── Tab: Campaigns ────────────────────────────────────────────────────────────
const CHANNEL_TYPE_MAP = {
  '0':'Other', '1':'Unknown', '2':'Search', '3':'Display', '4':'Shopping',
  '5':'Hotel', '6':'Video', '7':'Performance Max', '8':'Local', '9':'Smart',
  '10':'Performance Max', '11':'Local Services', '12':'Demand Gen',
  '13':'Travel', '14':'Demand Gen',
}
const fmtChannelType = v => {
  if (v == null || v === '') return '—'
  return CHANNEL_TYPE_MAP[String(v)] ?? String(v)
}

const CAMPAIGN_COLS = [
  { key:'name',        label:'Campaign',   sortable:true, align:'left',   width:200, wrap:true },
  { key:'channelType', label:'Type',       sortable:true, align:'left', format:fmtChannelType },
  { key:'status',      label:'Campaign Status', sortable:true, align:'center', format: reportStatusBadge },
  { key:'impressions', label:'Impressions',sortable:true, align:'right',  format:fmtNum  },
  { key:'clicks',      label:'Clicks',     sortable:true, align:'right',  format:fmtNum  },
  { key:'ctr',         label:'CTR',        sortable:true, align:'right',  format:fmtPct  },
  { key:'cpc',         label:'Avg CPC',    sortable:true, align:'right',  format:fmtCpc  },
  { key:'cost',        label:'Cost',       sortable:true, align:'right',  format:fmtUsd  },
  { key:'conversions', label:'Conv.',      sortable:true, align:'right',  format:fmtNum  },
  { key:'convRate',    label:'Conv. Rate', sortable:true, align:'right',  format:fmtPct, colorFn:(v)=>convRateColor(v) },
  { key:'roas',        label:'ROAS',       sortable:true, align:'right',  format:fmtRoas },
]

// ── Tab: Ad Groups ────────────────────────────────────────────────────────────
const AD_GROUP_COLS = [
  { key:'name',       label:'Ad Group', sortable:true, align:'left',  width:200 },
  { key:'campaign',   label:'Campaign', sortable:true, align:'left',  width:180 },
  { key:'status',     label:'Ad Group Status', sortable:true, align:'center', format: reportStatusBadge },
  { key:'impressions',label:'Impr.',    sortable:true, align:'right', format:fmtNum },
  { key:'clicks',     label:'Clicks',   sortable:true, align:'right', format:fmtNum },
  { key:'ctr',        label:'CTR',      sortable:true, align:'right', format:fmtPct },
  { key:'cpc',        label:'CPC',      sortable:true, align:'right', format:fmtCpc },
  { key:'cost',       label:'Cost',     sortable:true, align:'right', format:fmtUsd },
  { key:'conversions',label:'Conv.',    sortable:true, align:'right', format:fmtNum },
]

// ── Tab: Asset Groups ─────────────────────────────────────────────────────────
const ASSET_COLS = [
  { key:'name',       label:'Asset Group',sortable:true, align:'left',  width:200 },
  { key:'campaign',   label:'Campaign',   sortable:true, align:'left'             },
  { key:'status',     label:'Asset Group Status', sortable:true, align:'center', format: reportStatusBadge },
  { key:'impressions',label:'Impr.',      sortable:true, align:'right', format:fmtNum },
  { key:'clicks',     label:'Clicks',     sortable:true, align:'right', format:fmtNum },
  { key:'cost',       label:'Cost',       sortable:true, align:'right', format:fmtUsd },
  { key:'conversions',label:'Conv.',      sortable:true, align:'right', format:fmtNum },
]

// ── Network tab ───────────────────────────────────────────────────────────────
const resolveLbl = (map, v) => (v && isNaN(Number(v))) ? v : resolveEnum(map, v, String(v ?? '—'))
const NETWORK_COLS = [
  { key:'label', label:'Network', sortable:true, align:'left', format: v => resolveLbl(NETWORK_TYPE, v) },
  { key:'impressions',label:'Impr.',     sortable:true, align:'right', format:fmtNum },
  { key:'clicks',     label:'Clicks',    sortable:true, align:'right', format:fmtNum },
  { key:'ctr',        label:'CTR',       sortable:true, align:'right', format:fmtPct },
  { key:'cpc',        label:'Avg CPC',   sortable:true, align:'right', format:fmtCpc },
  { key:'cost',       label:'Cost',      sortable:true, align:'right', format:fmtUsd },
  { key:'conversions',label:'Conv.',     sortable:true, align:'right', format:fmtNum },
]

// ── Device tab ────────────────────────────────────────────────────────────────
const DEVICE_COLORS = { Mobile:'#2563b0', Desktop:'#4caf50', Tablet:'#e8a020', 'Connected TV':'#3a8fd1' }

// ── Slot tab ──────────────────────────────────────────────────────────────────
const SLOT_PIE_COLORS = ['#1a3a6b','#2563b0','#3a8fd1','#e8a020']

// ── Call Leads tab ────────────────────────────────────────────────────────────
const CALL_PAGE_SIZE = 10

// Dialing code → ISO 2-letter country code
const DIALING_TO_ISO = {
  '1':'US','7':'RU','20':'EG','27':'ZA','30':'GR','31':'NL','32':'BE',
  '33':'FR','34':'ES','36':'HU','39':'IT','40':'RO','41':'CH','43':'AT',
  '44':'GB','45':'DK','46':'SE','47':'NO','48':'PL','49':'DE','51':'PE',
  '52':'MX','54':'AR','55':'BR','56':'CL','57':'CO','60':'MY','61':'AU',
  '62':'ID','63':'PH','64':'NZ','65':'SG','66':'TH','81':'JP','82':'KR',
  '84':'VN','86':'CN','90':'TR','91':'IN','92':'PK','94':'LK','98':'IR',
  '212':'MA','213':'DZ','216':'TN','234':'NG','254':'KE','351':'PT',
  '353':'IE','358':'FI','380':'UA','420':'CZ','502':'GT','506':'CR',
  '595':'PY','598':'UY','673':'BN','852':'HK','880':'BD','886':'TW',
  '960':'MV','961':'LB','962':'JO','964':'IQ','965':'KW','966':'SA',
  '967':'YE','971':'AE','972':'IL','973':'BH','974':'QA','995':'GE',
}

const fmtCountry = code => {
  if (!code) return '—'
  const iso = DIALING_TO_ISO[String(code)]
  return iso ? `${iso} (${code})` : String(code)
}

const CALL_COLS = [
  { key:'_sno',              label:'#',            sortable:false },
  { key:'startTime',         label:'Start Time',   sortable:true  },
  { key:'durationSeconds',   label:'Duration',     sortable:true  },
  { key:'callerCountryCode', label:'Country',      sortable:true, format: fmtCountry },
  { key:'callerAreaCode',    label:'Area Code',    sortable:true  },
  { key:'callerPhoneNumber', label:'Phone',        sortable:false },
  { key:'callStatus',        label:'Status',       sortable:true  },
  { key:'callSource',        label:'Call Source',  sortable:true  },
  { key:'campaignName',      label:'Campaign',     sortable:true  },
]

function CallStatusBadge({ v }) {
  const label = resolveEnum(CALL_STATUS, v, String(v ?? '—'))
  const ok    = label === 'Received'
  return (
    <span style={{ 
      fontSize:11, fontWeight:600, padding:'2px 7px', borderRadius:4, whiteSpace:'nowrap',
      background: ok ? 'rgba(76,175,80,0.12)'          : 'rgba(224,92,42,0.12)',
      color:      ok ? '#2e7d32'                        : '#c0392b',
      border:     ok ? '1px solid rgba(76,175,80,0.3)' : '1px solid rgba(224,92,42,0.3)',
    }}>{label}</span>
  )
}

function fmtDurSec(s) { return s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s` }

function CallLeadsTab({ data, loading, error, onRetry, initialCampaignFilter = '' }) {
  const [filterCampaign, setFilterCampaign] = useState(initialCampaignFilter)
  const [filterStatus,   setFilterStatus]   = useState('all')
  const [minDuration,    setMinDuration]    = useState(0)
  const [page,           setPage]           = useState(0)
  const [sortKey,        setSortKey]        = useState('startTime')
  const [sortAsc,        setSortAsc]        = useState(false)



  const calls   = data?.calls   ?? []
  const summary = data?.summary ?? {}

  const campaignOptions = useMemo(() =>
    [...new Set(calls.map(c => c.campaignName).filter(Boolean))].sort()
  , [calls])

  const filtered = useMemo(() => {
    let r = calls
    if (filterCampaign) r = r.filter(c => c.campaignName === filterCampaign)
    if (filterStatus !== 'all') r = r.filter(c => resolveEnum(CALL_STATUS, c.callStatus, '') === filterStatus)
    if (minDuration > 0)        r = r.filter(c => (c.durationSeconds || 0) >= minDuration)
    return [...r].sort((a, b) => {
      const va = a[sortKey] ?? '', vb = b[sortKey] ?? ''
      if (typeof va === 'number') return sortAsc ? va - vb : vb - va
      return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    })
  }, [calls, filterCampaign, filterStatus, minDuration, sortKey, sortAsc])

  useEffect(() => { setPage(0) }, [filterCampaign, filterStatus, minDuration, sortKey, sortAsc])

  // All hooks above — early returns below
  if (error)   return <ErrorState message={error} onRetry={onRetry} />
  if (loading) return <div style={{ padding:20 }}><div className="skeleton" style={{ height:300, borderRadius:6 }}/></div>
  if (!data)   return null

  const totalPages = Math.max(1, Math.ceil(filtered.length / CALL_PAGE_SIZE))
  const paginated  = filtered.slice(page * CALL_PAGE_SIZE, (page + 1) * CALL_PAGE_SIZE)
  const rangeStart = page * CALL_PAGE_SIZE + 1
  const rangeEnd   = Math.min((page + 1) * CALL_PAGE_SIZE, filtered.length)

  function handleSort(key) {
    if (!CALL_COLS.find(c => c.key === key)?.sortable) return
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  function renderCell(row, col, rowIndex) {
    if (col.key === '_sno') return rowIndex + 1
    const v = row[col.key]
    switch (col.key) {
      case 'startTime':         return v ? dayjs(v).format('DD MMM YYYY, HH:mm') : '—'
      case 'durationSeconds':   return fmtDurSec(v || 0)
      case 'callerCountryCode': return v || '—'
      case 'callerAreaCode':    return v || '—'
      case 'callerPhoneNumber': return v || '—'
      case '_recording':        return <span style={{ color:'#aaa', fontSize:11 }}>—</span>
      case 'callStatus':        return <CallStatusBadge v={v} />
      case 'callSource':        return resolveEnum(CALL_TRACKING_CONDITION, v, v || 'Ad')
      case 'callType':          return resolveEnum(CALL_TYPE, v, v || '—')
      case 'campaignName': {
        const label = String(v || '—')
        return <span title={label}>{label.length > 40 ? label.slice(0, 39) + '…' : label}</span>
      }
      default: return v ?? '—'
    }
  }

  const thStyle = (col) => ({
    background:'#1a3a6b', color:'#fff', padding:'9px 11px', fontSize:11, fontWeight:600,
    textAlign:'left', whiteSpace:'nowrap', userSelect:'none',
    cursor: col.sortable ? 'pointer' : 'default',
  })

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
        {[
          { label:'Total Calls',    value: summary.totalCalls      ?? 0,  fmt: v => Number(v).toLocaleString()    },
          { label:'Connected',      value: summary.connectedCalls  ?? 0,  fmt: v => Number(v).toLocaleString()    },
          { label:'Avg Duration',   value: summary.avgDurationSeconds ?? 0, fmt: fmtDurSec                        },
          { label:'Cost per Call',  value: summary.costPerCall     ?? 0,  fmt: v => '$' + Number(v).toFixed(2)   },
        ].map(({ label, value, fmt }) => (
          <div key={label} style={{ background:'#dde9f5', border:'1px solid #c8d9ed', borderRadius:8, padding:'13px 15px' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:6 }}>{label}</div>
            <div style={{ fontSize:22, fontWeight:700, color:'#1a3a6b' }}>{fmt(value)}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <select value={filterCampaign} onChange={e => { setFilterCampaign(e.target.value); setPage(0) }}
          style={{ padding:'6px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, outline:'none', color:'#1a3a6b', background:'#fff', cursor:'pointer' }}>
          <option value="">All Campaigns</option>
          {campaignOptions.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(0) }}
          style={{ padding:'6px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, outline:'none' }}>
          <option value="all">All statuses</option>
          <option value="Received">Received</option>
          <option value="Missed">Missed</option>
        </select>
        <input type="number" min={0} value={minDuration || ''} onChange={e => { setMinDuration(Number(e.target.value) || 0); setPage(0) }}
          placeholder="Min duration (sec)"
          style={{ padding:'6px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, outline:'none', width:160 }} />
        <ExportButton data={filtered} filename="call-leads" />
      </div>

      {/* Call log table */}
      <div className="card" style={{ marginBottom:12 }}>
        <div className="card-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span className="card-title">Call Log ({filtered.length} call{filtered.length !== 1 ? 's' : ''})</span>
          {filtered.length > 0 && <span style={{ fontSize:12, color:'#888' }}>{rangeStart}–{rangeEnd} of {filtered.length}</span>}
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                {CALL_COLS.map(col => (
                  <th key={col.key} onClick={() => handleSort(col.key)} style={thStyle(col)}>
                    {col.label}
                    {col.sortable && (
                      <span style={{ marginLeft:4, opacity: sortKey === col.key ? 1 : 0.3 }}>
                        {sortKey === col.key ? (sortAsc ? '▲' : '▼') : '⇕'}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={CALL_COLS.length} style={{ padding:'28px 0', textAlign:'center', color:'#aaa' }}>
                    No call data found for the selected period
                  </td>
                </tr>
              ) : paginated.map((row, ri) => (
                <tr key={ri}
                  style={{ background: ri % 2 === 0 ? '#fff' : '#f5f7fa' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#edf3fb' }}
                  onMouseLeave={e => { e.currentTarget.style.background = ri % 2 === 0 ? '#fff' : '#f5f7fa' }}
                >
                  {CALL_COLS.map((col, ci) => (
                    <td key={col.key} style={{
                      padding:'8px 11px', borderBottom:'1px solid #f0f4f8',
                      color: ci === 0 ? '#aaa' : ci === 1 ? '#1a3a6b' : '#4a4a4a',
                      fontWeight: ci === 1 ? 500 : 400,
                      textAlign: col.key === '_sno' ? 'center' : undefined,
                      maxWidth: col.key === 'campaignName' ? 260 : undefined,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    }}>
                      {renderCell(row, col, ri)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderTop:'1px solid #f0f4f8' }}>
            <span style={{ fontSize:12, color:'#888' }}>{rangeStart}–{rangeEnd} of {filtered.length}</span>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                style={{ padding:'5px 14px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background: page===0 ? '#f5f7fa' : '#fff', color: page===0 ? '#aaa' : '#1a3a6b', cursor: page===0 ? 'not-allowed' : 'pointer' }}>
                ← Prev
              </button>
              <span style={{ fontSize:12, color:'#555' }}>Page {page + 1} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                style={{ padding:'5px 14px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background: page>=totalPages-1 ? '#f5f7fa' : '#fff', color: page>=totalPages-1 ? '#aaa' : '#1a3a6b', cursor: page>=totalPages-1 ? 'not-allowed' : 'pointer' }}>
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Note banner */}
      <div style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 14px', background:'#dde9f5', borderRadius:7, fontSize:12, color:'#1a3a6b', lineHeight:1.6 }}>
        <Info size={15} style={{ flexShrink:0, marginTop:2, color:'#2563b0' }} />
        <div>
          <strong>Recording links are not available via the Google Ads API.</strong><br />
          To access call recordings, open <em>Google Ads → Reports → Call Details</em> directly.
        </div>
      </div>

    </div>
  )
}

// ── Ads Performance tab ───────────────────────────────────────────────────────

// Columns defined at module level to avoid recreation/JSX issues on each render
const ADS_COLS = [
  { key:'_ad', label:'Ad', sortable:false, align:'left', wrap:true, width:280,
    format: (_, row) => {
      const url       = (row.finalUrls || [])[0] || ''
      const headlines = (row.headlines || []).join(' | ')
      const desc      = (row.descriptions || [])[0] || ''
      return (
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {url       && <div style={{ fontSize:11, color:'#2e7d32', wordBreak:'break-all', lineHeight:1.4 }}>{url}</div>}
          {headlines && <div style={{ fontSize:12, color:'#2563b0', fontWeight:500, whiteSpace:'normal', wordBreak:'break-word', lineHeight:1.5 }}>{headlines}</div>}
          {desc      && <div style={{ fontSize:11, color:'#666',    whiteSpace:'normal', wordBreak:'break-word', lineHeight:1.5 }}>{desc}</div>}
          {!url && !headlines && !desc && <span style={{ color:'#aaa', fontSize:11 }}>—</span>}
        </div>
      )
    }
  },
  { key:'type',        label:'Ad Type',    sortable:true,  align:'left',   format: v => resolveEnum(AD_TYPE, v, String(v ?? '—')) },
  { key:'campaign',    label:'Campaign',   sortable:true,  align:'left',   width:160  },
  { key:'adGroup',     label:'Ad Group',   sortable:true,  align:'left',   width:140  },
  { key:'status',      label:'Ad Status',   sortable:true,  align:'center', badge:true  },
  { key:'impressions', label:'Impr.',      sortable:true,  align:'right',  format:fmtNum  },
  { key:'clicks',      label:'Clicks',     sortable:true,  align:'right',  format:fmtNum  },
  { key:'ctr',         label:'CTR',        sortable:true,  align:'right',  format:fmtPct  },
  { key:'conversions', label:'Conv.',      sortable:true,  align:'right',  format:fmtNum  },
  { key:'convRate',    label:'Conv. Rate', sortable:true,  align:'right',  format:fmtPct,
    colorFn: v => v > 5 ? '#2e7d32' : v >= 2 ? '#a56700' : '#c0392b' },
  { key:'cost',        label:'Cost',       sortable:true,  align:'right',  format:fmtUsd  },
  { key:'roas',        label:'ROAS',       sortable:true,  align:'right',  format:fmtRoas },
]

function AdsPerformanceTab({ data, loading, error, onRetry, hidePaused }) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />

  const rows = useMemo(() => {
    let r = data || []
    if (hidePaused) r = r.filter(a => {
      const s = String(a.status || '').toUpperCase()
      return s !== 'PAUSED' && s !== '3'
    })
    return r
  }, [data, hidePaused])

  const top3 = rows.slice(0, 3)

  return (
    <div>
      {!loading && top3.length > 0 && (
        <Section title="Top 3 Best Performing Ads">
          <div className="card-body" style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {top3.map((ad, i) => {
              const headlines = Array.isArray(ad.headlines) ? ad.headlines : []
              return (
                <div key={i} style={{ border:'2px solid #4caf50', borderRadius:8, padding:'12px 16px', background:'rgba(76,175,80,0.04)', position:'relative' }}>
                  <span style={{ position:'absolute', top:-10, right:12, background:'#4caf50', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10 }}>⭐ Top Performer</span>
                  <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                    <div style={{ flex:2 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'#1a3a6b', marginBottom:4 }}>{ad.campaign || '—'}</div>
                      <div style={{ fontSize:11, color:'#888' }}>{ad.adGroup || '—'}</div>
                      {headlines.length > 0 && (
                        <div style={{ fontSize:12, color:'#4a4a4a', marginTop:4, lineHeight:1.4 }}>
                          {headlines.slice(0,2).join(' | ')}
                        </div>
                      )}
                    </div>
                    {[['Conv.',fmtNum(ad.conversions||0)],['Rate',fmtPct(ad.convRate||0)],['ROAS',fmtRoas(ad.roas||0)],['Cost',fmtUsd(ad.cost||0)]].map(([l,v]) => (
                      <div key={l} style={{ textAlign:'center' }}>
                        <div style={{ fontSize:10, color:'#888', marginBottom:2 }}>{l}</div>
                        <div style={{ fontSize:14, fontWeight:700, color:'#1a3a6b' }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}
      <Section title={`All Ads (${rows.length})`} extra={<ExportButton data={rows.map(r=>({...r,type:resolveEnum(AD_TYPE,r.type,r.type||'—')}))} filename="ads-performance" />}>
        <ReportTable columns={ADS_COLS} data={rows} loading={loading} emptyMessage="No ad data found for the selected period" />
      </Section>
    </div>
  )
}


// ── Tab bar with scroll arrows ────────────────────────────────────────────────
function TabBar({ active, onSelect }) {
  const scrollRef = useRef(null)
  const [canLeft,  setCanLeft]  = useState(false)
  const [canRight, setCanRight] = useState(false)

  function updateArrows() {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateArrows()
    el.addEventListener('scroll', updateArrows)
    window.addEventListener('resize', updateArrows)
    return () => { el.removeEventListener('scroll', updateArrows); window.removeEventListener('resize', updateArrows) }
  }, [])

  function scroll(dir) {
    const el = scrollRef.current
    if (el) el.scrollBy({ left: dir * 200, behavior: 'smooth' })
  }

  // Scroll the active tab into view when it changes
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const btn = el.querySelector(`[data-tab="${active}"]`)
    if (btn) btn.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'nearest' })
    setTimeout(updateArrows, 350)
  }, [active])

  const arrowStyle = (enabled) => ({
    flexShrink: 0, width: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#1a3a6b', border: 'none', color: enabled ? '#fff' : 'rgba(255,255,255,0.2)',
    cursor: enabled ? 'pointer' : 'default', fontSize: 14, paddingBottom: 4,
    borderBottom: '1px solid rgba(255,255,255,0.1)',
  })

  return (
    <div style={{ display:'flex', flexShrink:0, background:'#1a3a6b', borderBottom:'1px solid rgba(255,255,255,0.1)' }}>
      <button onClick={() => scroll(-1)} disabled={!canLeft}  style={arrowStyle(canLeft)}>‹</button>
      <div ref={scrollRef} className="tab-bar-scroll"
        style={{ display:'flex', overflowX:'auto', flex:1, padding:'0 4px' }}
      >
        {TABS.map(tab => (
          <button key={tab.key} data-tab={tab.key} onClick={() => onSelect(tab.key)} style={{
            flexShrink:0, padding:'12px 14px', fontSize:13,
            fontWeight: active===tab.key ? 600 : 400,
            color:      active===tab.key ? '#ffffff' : 'rgba(255,255,255,0.55)',
            background:'transparent', border:'none',
            borderBottom: active===tab.key ? '3px solid #e8a020' : '3px solid transparent',
            cursor:'pointer', transition:'color 0.12s, border-color 0.12s', whiteSpace:'nowrap',
          }}
            onMouseEnter={e => { if (active!==tab.key) e.currentTarget.style.color='rgba(255,255,255,0.85)' }}
            onMouseLeave={e => { if (active!==tab.key) e.currentTarget.style.color='rgba(255,255,255,0.55)' }}
          >{tab.label}</button>
        ))}
      </div>
      <button onClick={() => scroll(1)} disabled={!canRight} style={arrowStyle(canRight)}>›</button>
    </div>
  )
}

// ── Summary tab ───────────────────────────────────────────────────────────────
function SummaryTab({ dashboardData, loading }) {
  if (!dashboardData && !loading) return <div style={{ padding:32, textAlign:'center', color:'#aaa', fontSize:13 }}>Load the dashboard first to see the summary.</div>
  const top5spend = dashboardData?.campaigns?.slice(0,5).map(c=>({name:c.name.slice(0,28),value:c.cost}))||[]
  const top5conv  = dashboardData?.campaigns?[...dashboardData.campaigns].sort((a,b)=>b.conversions-a.conversions).slice(0,5).map(c=>({name:c.name.slice(0,28),value:c.conversions})):[]
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <KPICards kpis={dashboardData?.kpis} previousKpis={dashboardData?.previousKpis} />
      {dashboardData?.dailySeries?.length > 0 && (
        <Section title="Daily Trend — Clicks & Conversions">
          <div className="card-body">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={dashboardData.dailySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="date" tick={{fontSize:10,fill:'#888'}} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
                <YAxis tick={{fontSize:10,fill:'#888'}} axisLine={false} tickLine={false} width={36} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                <Tooltip /><Legend wrapperStyle={{fontSize:11}}/>
                <Line type="monotone" dataKey="clicks"      name="Clicks"      stroke="#2563b0" strokeWidth={2} dot={false}/>
                <Line type="monotone" dataKey="conversions" name="Conversions" stroke="#4caf50" strokeWidth={2} dot={false} strokeDasharray="5 4"/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
        {top5spend.length>0&&<Section title="Top 5 Campaigns by Spend"><div className="card-body"><ResponsiveContainer width="100%" height={180}><BarChart data={top5spend} layout="vertical" margin={{left:8}}><XAxis type="number" tick={{fontSize:10,fill:'#888'}} axisLine={false} tickLine={false} tickFormatter={v=>'$'+v.toFixed(0)}/><YAxis type="category" dataKey="name" width={130} tick={{fontSize:10,fill:'#1a3a6b'}} axisLine={false} tickLine={false}/><Tooltip formatter={v=>'$'+v.toFixed(2)}/><Bar dataKey="value" name="Cost" fill="#1a3a6b" radius={[0,3,3,0]}/></BarChart></ResponsiveContainer></div></Section>}
        {top5conv.length>0&&<Section title="Top 5 Campaigns by Conversions"><div className="card-body"><ResponsiveContainer width="100%" height={180}><BarChart data={top5conv} layout="vertical" margin={{left:8}}><XAxis type="number" tick={{fontSize:10,fill:'#888'}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" width={130} tick={{fontSize:10,fill:'#1a3a6b'}} axisLine={false} tickLine={false}/><Tooltip/><Bar dataKey="value" name="Conversions" fill="#4caf50" radius={[0,3,3,0]}/></BarChart></ResponsiveContainer></div></Section>}
      </div>
    </div>
  )
}

// ── Device tab ────────────────────────────────────────────────────────────────
function DevicesTab({ data, loading, error, onRetry }) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />
  const totalClicks = data?.reduce((s,d)=>s+d.clicks,0)||0
  const chartData   = data?.map(d=>({...d,pct:totalClicks>0?Math.round((d.clicks/totalClicks)*100):0}))||[]
  const cols = [
    {key:'label',      label:'Device',    sortable:true, align:'left', format: v => resolveLbl(DEVICE_TYPE, v)},
    {key:'impressions',label:'Impr.',     sortable:true, align:'right',format:fmtNum},
    {key:'clicks',     label:'Clicks',    sortable:true, align:'right',format:fmtNum},
    {key:'ctr',        label:'CTR',       sortable:true, align:'right',format:fmtPct},
    {key:'cpc',        label:'Avg CPC',   sortable:true, align:'right',format:fmtCpc},
    {key:'cost',       label:'Cost',      sortable:true, align:'right',format:fmtUsd},
    {key:'conversions',label:'Conv.',     sortable:true, align:'right',format:fmtNum},
  ]
  return (
    <div>
      <Section title="Device Distribution">
        <div className="card-body" style={{display:'flex',flexDirection:'column',gap:10}}>
          {!loading&&chartData.map(d=>(
            <div key={d.device} style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:70,fontSize:12,color:'#555',flexShrink:0}}>{d.label}</div>
              <div style={{flex:1,height:10,background:'#dde9f5',borderRadius:5,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${d.pct}%`,background:DEVICE_COLORS[d.label]||'#2563b0',borderRadius:5,transition:'width 0.6s ease'}}/>
              </div>
              <div style={{width:80,textAlign:'right',fontSize:12,fontWeight:600,color:'#1a3a6b'}}>{fmtNum(d.clicks)} ({d.pct}%)</div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Device Breakdown" extra={<ExportButton data={data} filename="devices"/>}>
        <ReportTable columns={cols} data={data} loading={loading}/>
      </Section>
    </div>
  )
}

// ── Ad Slots tab ──────────────────────────────────────────────────────────────
function AdSlotsTab({ data, loading, error, onRetry }) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />
  if (!loading && (!Array.isArray(data) || data.length === 0)) return <EmptyState message="No ad slot data available for this period." />
  const safeData = Array.isArray(data) ? data : []
  const pieData  = safeData.filter(d=>d.impressions>0).map(d=>({name:d.label,value:d.impressions}))
  const cols = [
    {key:'label',      label:'Ad Slot',   sortable:true,align:'left', format: v => resolveLbl(AD_SLOT, v)},
    {key:'impressions',label:'Impr.',     sortable:true,align:'right',format:fmtNum},
    {key:'clicks',     label:'Clicks',    sortable:true,align:'right',format:fmtNum},
    {key:'ctr',        label:'CTR',       sortable:true,align:'right',format:fmtPct},
    {key:'cpc',        label:'Avg CPC',   sortable:true,align:'right',format:fmtCpc},
    {key:'cost',       label:'Cost',      sortable:true,align:'right',format:fmtUsd},
    {key:'conversions',label:'Conv.',     sortable:true,align:'right',format:fmtNum},
  ]
  return (
    <div>
      {!loading&&pieData.length>0&&(
        <Section title="Impression Share by Ad Slot">
          <div className="card-body" style={{display:'flex',justifyContent:'center'}}>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart margin={{top:30,right:80,bottom:30,left:80}}>
                <Pie
                  data={pieData}
                  cx="50%" cy="50%"
                  outerRadius={95}
                  dataKey="value"
                  labelLine={true}
                  label={({cx,cy,midAngle,outerRadius,name,percent})=>{
                    if(percent<0.03) return null
                    const R=Math.PI/180
                    const r=outerRadius+28
                    const x=cx+r*Math.cos(-midAngle*R)
                    const y=cy+r*Math.sin(-midAngle*R)
                    return(
                      <text x={x} y={y} fill="#1a3a6b" fontSize={11}
                        textAnchor={x>cx?'start':'end'} dominantBaseline="central">
                        {`${name} ${(percent*100).toFixed(0)}%`}
                      </text>
                    )
                  }}
                >
                  {pieData.map((_,i)=><Cell key={i} fill={SLOT_PIE_COLORS[i%SLOT_PIE_COLORS.length]} stroke="none"/>)}
                </Pie>
                <Tooltip formatter={v=>fmtNum(v)}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}
      <Section title="Ad Slot Breakdown" extra={<ExportButton data={safeData.map(({label,...r})=>({...r,slot:resolveLbl(AD_SLOT,label)}))} filename="ad-slots"/>}>
        <ReportTable columns={cols} data={safeData} loading={loading}/>
      </Section>
    </div>
  )
}

// ── Main Reports component ────────────────────────────────────────────────────
export default function Reports({ selectedAccount, dateRange, dashboardData, hidePaused }) {
  const location = useLocation()
  const [activeTab,       setActiveTab]       = useState('campaigns')
  const [data,            setData]            = useState(null)
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState(null)
  const [drillCampaign,      setDrillCampaign]      = useState('')
  const [campTypeFilter,      setCampTypeFilter]      = useState('')
  const [agCampaignFilter,    setAgCampaignFilter]    = useState('')
  const [agCampStatusFilter,  setAgCampStatusFilter]  = useState('')
  const [asgCampaignFilter,   setAsgCampaignFilter]   = useState('')
  const [asgCampStatusFilter, setAsgCampStatusFilter] = useState('')

  // Read router state from Keywords drill-down navigation
  useEffect(() => {
    const s = location.state
    if (s?.initialTab) { setActiveTab(s.initialTab) }
    if (s?.campaignFilter) { setDrillCampaign(s.campaignFilter) }
  }, [location.state])

  useEffect(() => {
    if (!selectedAccount) return
    if (activeTab === 'summary') return
    loadReport()
  }, [activeTab, selectedAccount, dateRange])

  async function loadReport() {
    setLoading(true); setError(null); setData(null)
    try {
      let result
      if (activeTab === 'callLeads') {
        result = await window.electronAPI.fetchCallLeads({ customerId: selectedAccount.id, dateRange })
      } else {
        result = await window.electronAPI.fetchReport({
          customerId: selectedAccount.id,
          dateRange:  activeTab === 'keywords' ? 'LAST_90_DAYS' : dateRange,
          reportType: activeTab,
        })
      }
      setData(result)
    } catch (err) {
      setError(err.message || 'Failed to load report')
    } finally { setLoading(false) }
  }

  if (!selectedAccount) {
    return (
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <TabBar active={activeTab} onSelect={setActiveTab} />
        <div style={{ padding:40 }}><NoAccount /></div>
      </div>
    )
  }

  function renderTab() {
    const props = { data, loading, error, onRetry: loadReport, hidePaused }
    switch (activeTab) {
      case 'campaigns': {
        const campAllData = data || []
        const campTypes   = [...new Set(campAllData.map(r => fmtChannelType(r.channelType)).filter(v => v && v !== '—'))].sort()
        const campFiltered = campTypeFilter
          ? campAllData.filter(r => fmtChannelType(r.channelType) === campTypeFilter)
          : campAllData
        const selStyle = { padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }
        return (
          <Section title="Campaigns" extra={<ExportButton data={campFiltered} filename="campaigns"/>}>
            <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f4f8', background:'#fafcff', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign Type:</span>
                <select value={campTypeFilter} onChange={e => setCampTypeFilter(e.target.value)} style={selStyle}>
                  <option value="">All</option>
                  {campTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {campTypeFilter && (
                <button onClick={() => setCampTypeFilter('')}
                  style={{ fontSize:11, color:'#2563b0', background:'none', border:'1px solid #dde9f5', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
                  Clear
                </button>
              )}
              <span style={{ fontSize:11, color:'#888', marginLeft:'auto' }}>{campFiltered.length} of {campAllData.length}</span>
            </div>
            <ReportTable columns={CAMPAIGN_COLS} data={campFiltered} loading={loading} hidePaused={hidePaused}/>
          </Section>
        )
      }
      case 'adGroups': {
        const agAllData = data || []

        // Mutually dependent options — each filter scopes the other's options
        const agCampNames = [...new Set(
          (agCampStatusFilter ? agAllData.filter(r => r.campaignStatus === agCampStatusFilter) : agAllData)
            .map(r => r.campaign).filter(Boolean)
        )].sort()
        const agCampStatuses = [...new Set(
          (agCampaignFilter ? agAllData.filter(r => r.campaign === agCampaignFilter) : agAllData)
            .map(r => r.campaignStatus).filter(Boolean)
        )].sort()

        const agFiltered = agAllData.filter(r =>
          (!agCampaignFilter   || r.campaign       === agCampaignFilter)   &&
          (!agCampStatusFilter || r.campaignStatus === agCampStatusFilter)
        )
        const selStyle = { padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }
        return (
          <Section title="Ad Groups" extra={<ExportButton data={agFiltered} filename="ad-groups"/>}>
            <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f4f8', background:'#fafcff', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign Name:</span>
                <select value={agCampaignFilter} onChange={e => { setAgCampaignFilter(e.target.value); setAgCampStatusFilter('') }} style={selStyle}>
                  <option value="">All</option>
                  {agCampNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign Status:</span>
                <select value={agCampStatusFilter} onChange={e => { setAgCampStatusFilter(e.target.value); setAgCampaignFilter('') }} style={selStyle}>
                  <option value="">All</option>
                  {agCampStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {(agCampaignFilter || agCampStatusFilter) && (
                <button onClick={() => { setAgCampaignFilter(''); setAgCampStatusFilter('') }}
                  style={{ fontSize:11, color:'#2563b0', background:'none', border:'1px solid #dde9f5', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
                  Clear
                </button>
              )}
              <span style={{ fontSize:11, color:'#888', marginLeft:'auto' }}>{agFiltered.length} of {agAllData.length}</span>
            </div>
            <ReportTable columns={AD_GROUP_COLS} data={agFiltered} loading={loading} hidePaused={hidePaused}/>
          </Section>
        )
      }
      case 'assetGroups': {
        const asgAllData = data || []
        const asgCampNames = [...new Set(
          (asgCampStatusFilter ? asgAllData.filter(r => r.campaignStatus === asgCampStatusFilter) : asgAllData)
            .map(r => r.campaign).filter(Boolean)
        )].sort()
        const asgCampStatuses = [...new Set(
          (asgCampaignFilter ? asgAllData.filter(r => r.campaign === asgCampaignFilter) : asgAllData)
            .map(r => r.campaignStatus).filter(Boolean)
        )].sort()
        const asgFiltered = asgAllData.filter(r =>
          (!asgCampaignFilter   || r.campaign       === asgCampaignFilter)   &&
          (!asgCampStatusFilter || r.campaignStatus === asgCampStatusFilter)
        )
        const selStyle = { padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }
        return (
          <Section title="Asset Groups (Performance Max)" extra={<ExportButton data={asgFiltered} filename="asset-groups"/>}>
            <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f4f8', background:'#fafcff', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign Name:</span>
                <select value={asgCampaignFilter} onChange={e => { setAsgCampaignFilter(e.target.value); setAsgCampStatusFilter('') }} style={selStyle}>
                  <option value="">All</option>
                  {asgCampNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign Status:</span>
                <select value={asgCampStatusFilter} onChange={e => { setAsgCampStatusFilter(e.target.value); setAsgCampaignFilter('') }} style={selStyle}>
                  <option value="">All</option>
                  {asgCampStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {(asgCampaignFilter || asgCampStatusFilter) && (
                <button onClick={() => { setAsgCampaignFilter(''); setAsgCampStatusFilter('') }}
                  style={{ fontSize:11, color:'#2563b0', background:'none', border:'1px solid #dde9f5', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
                  Clear
                </button>
              )}
              <span style={{ fontSize:11, color:'#888', marginLeft:'auto' }}>{asgFiltered.length} of {asgAllData.length}</span>
            </div>
            <ReportTable columns={ASSET_COLS} data={asgFiltered} loading={loading} hidePaused={hidePaused} emptyMessage="No asset groups found. Shows Performance Max only."/>
          </Section>
        )
      }
      case 'networks':         return <><Section title="Performance by Network"><div className="card-body">{!loading&&data?.length>0&&<ResponsiveContainer width="100%" height={180}><BarChart data={data} margin={{top:4,right:16,left:0,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke="#eef2f7"/><XAxis dataKey="label" tick={{fontSize:11,fill:'#888'}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:10,fill:'#888'}} axisLine={false} tickLine={false} width={40}/><Tooltip/><Bar dataKey="clicks" name="Clicks" fill="#2563b0" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer>}</div></Section><Section title="Network Breakdown" extra={<ExportButton data={(data||[]).map(({label,...r})=>({...r,network:resolveLbl(NETWORK_TYPE,label)}))} filename="networks"/>}><ReportTable columns={NETWORK_COLS} data={data} loading={loading}/></Section></>
      case 'devices':          return <DevicesTab {...props} />
      case 'clickTypes':       return <Section title="Performance by Click Type" extra={<ExportButton data={(data||[]).map(({label,...r})=>({...r,clickType:resolveLbl(CLICK_TYPE,label)}))} filename="click-types"/>}><ReportTable columns={[{key:'label',label:'Click Type',sortable:true,align:'left',format:v=>resolveLbl(CLICK_TYPE,v)},{key:'impressions',label:'Impr.',sortable:true,align:'right',format:fmtNum},{key:'clicks',label:'Clicks',sortable:true,align:'right',format:fmtNum},{key:'ctr',label:'CTR',sortable:true,align:'right',format:fmtPct},{key:'cpc',label:'Avg CPC',sortable:true,align:'right',format:fmtUsd},{key:'cost',label:'Cost',sortable:true,align:'right',format:fmtUsd},{key:'conversions',label:'Conv.',sortable:true,align:'right',format:fmtNum}]} data={data} loading={loading}/></Section>
      case 'adSlots':          return <AdSlotsTab {...props} />
      case 'summary':          return <SummaryTab dashboardData={dashboardData} loading={!dashboardData} />
      case 'callLeads':        return <CallLeadsTab {...props} initialCampaignFilter={drillCampaign} />
      case 'adsPerformance':   return <AdsPerformanceTab {...props} />
      default: return null
    }
  }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <TabBar active={activeTab} onSelect={setActiveTab} />
      <div style={{ flex:1, overflowY:'auto', padding:'20px 24px', background:'#f5f7fa' }}>
        <ErrorBoundary key={activeTab}>
          {renderTab()}
        </ErrorBoundary>
      </div>
    </div>
  )
}
