import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, RefreshCw, Copy, Check, Info, Search, X, FileDown, FileCode, Loader2, Layers } from 'lucide-react'
import dayjs from 'dayjs'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts'
import Modal          from '../components/Modal.jsx'
import ReportTable    from '../components/ReportTable.jsx'
import StatusBadge    from '../components/StatusBadge.jsx'
import ExportButton   from '../components/ExportButton.jsx'
import ExportPdfButton from '../components/ExportPdfButton.jsx'
import usePdfExportMode from '../hooks/usePdfExportMode.js'
import KPICards     from '../components/KPICards.jsx'
import CallLeadsBadge from '../components/CallLeadsBadge.jsx'
import BreakdownCell  from '../components/BreakdownCell.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import EmptyState   from '../components/EmptyState.jsx'
import { highlightRecommendation } from '../utils/highlightRecommendation.jsx'
import { resolveEnum, CAMPAIGN_STATUS, NETWORK_TYPE, DEVICE_TYPE, CLICK_TYPE, AD_SLOT, AD_TYPE, CALL_STATUS, CALL_TYPE, CALL_TRACKING_CONDITION } from '../utils/enumMaps.js'

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtUsd  = v => '$' + Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})
const fmtNum  = v => Number(v||0).toLocaleString()
const fmtPct  = v => Number(v||0).toFixed(2) + '%'
const fmtCpc  = v => '$' + Number(v||0).toFixed(2)
const convRateColor = v => v > 5 ? '#2e7d32' : v >= 2 ? '#a56700' : '#c0392b'

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { key:'summary',          label:'Summary'                   },
  { key:'campaigns',        label:'Campaigns'                 },
  { key:'adGroups',         label:'Ad Groups'                 },
  { key:'assetGroups',      label:'Asset Groups'              },
  { key:'networks',         label:'Performance by Network'    },
  { key:'devices',          label:'Performance by Device'     },
  { key:'clickTypes',       label:'Performance by Click Type' },
  { key:'adSlots',          label:'Performance by Ad Slot'    },
  { key:'formConversions',      label:'Form Conversions'         },
  { key:'phoneCallConversions', label:'Phone Call Conversions'   },
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
// Builds CSV rows that exactly match a ReportTable's displayed columns — runs
// each column's own text formatter so raw enum codes/unformatted numbers
// never leak into the export. Only safe for columns whose format() returns
// plain text (not JSX like a status badge) — callers with badge columns
// build their own curated shape instead of using this helper for that column.
function toDisplayCsv(rows, cols, overrides = {}) {
  return (rows || []).map(row => {
    const out = {}
    for (const c of cols) {
      const raw = row[c.key]
      const fmt = overrides[c.key] || c.format
      out[c.label] = fmt ? fmt(raw, row) : (raw ?? '—')
    }
    return out
  })
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
const reportStatusText = v => ACTIVE_VALS.has(v) ? 'Eligible' : resolveEnum(CAMPAIGN_STATUS, v, String(v ?? '—'))
const reportStatusBadge = v => <StatusBadge value={reportStatusText(v)} />

// ── Tab: Campaigns ────────────────────────────────────────────────────────────
const CHANNEL_TYPE_MAP = {
  '0':'Other', '1':'Unknown', '2':'Search', '3':'Display', '4':'Shopping',
  '5':'Hotel', '6':'Video', '7':'PMax', '8':'Local', '9':'Smart',
  '10':'PMax', '11':'Local Services', '12':'Demand Gen',
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
  { key:'conversions',     label:'Conv.',      sortable:true, align:'right', format:fmtNum },
  { key:'formConversions', label:'Form Conv.', sortable:true, align:'right',
    format:(v,row)=><BreakdownCell value={v} breakdown={row.formBreakdown} entityLabel={row.name}
      modalTitle="Form Conversions" buttonTitle="View form conversion breakdown" rowLabel="Conversion Action"/> },
  { key:'phoneConversions',label:'Call Conv.', sortable:true, align:'right',
    format:(v,row)=><BreakdownCell value={v} breakdown={row.phoneBreakdown} entityLabel={row.name}
      modalTitle="Call Conversions" buttonTitle="View call conversion breakdown" rowLabel="Conversion Action"/> },
  { key:'phoneCalls',      label:'Call Leads', sortable:true, align:'center',
    format:(v,row)=><BreakdownCell value={v} breakdown={row.callBreakdown} entityLabel={row.name} align="center"
      modalTitle="Call Leads" buttonTitle="View call status breakdown" rowLabel="Call Status"
      valueNode={<CallLeadsBadge count={v} campaignName={row.name}/>}/> },
  { key:'convRate',          label:'Conv. Rate',       sortable:true, align:'right', format:fmtPct, colorFn:(v)=>convRateColor(v) },
  { key:'costPerConversion', label:'Cost / Conversion',sortable:true, align:'right', format:fmtUsd },
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
  { key:'conversions',     label:'Conv.',      sortable:true, align:'right', format:fmtNum },
  { key:'formConversions', label:'Form Conv.', sortable:true, align:'right',
    format:(v,row)=><BreakdownCell value={v} breakdown={row.formBreakdown} entityLabel={row.name}
      modalTitle="Form Conversions" buttonTitle="View form conversion breakdown" rowLabel="Conversion Action"/> },
  { key:'phoneConversions',label:'Call Conv.', sortable:true, align:'right',
    format:(v,row)=><BreakdownCell value={v} breakdown={row.phoneBreakdown} entityLabel={row.name}
      modalTitle="Call Conversions" buttonTitle="View call conversion breakdown" rowLabel="Conversion Action"/> },
  { key:'phoneCalls',      label:'Call Leads', sortable:true, align:'center',
    format:(v,row)=><BreakdownCell value={v} breakdown={row.callBreakdown} entityLabel={row.name} align="center"
      modalTitle="Call Leads" buttonTitle="View call status breakdown" rowLabel="Call Status"
      valueNode={<CallLeadsBadge count={v} campaignName={row.campaign}/>}/> },
  { key:'convRate',          label:'Conv. Rate',       sortable:true, align:'right', format:fmtPct, colorFn:(v)=>convRateColor(v) },
  { key:'costPerConversion', label:'Cost / Conversion',sortable:true, align:'right', format:fmtUsd },
]

// ── Tab: Asset Groups ─────────────────────────────────────────────────────────
// No Call Leads column here — Google Ads doesn't support metrics.phone_calls
// on the asset_group resource (confirmed live: PROHIBITED metric/resource
// combination), unlike campaign and ad_group.
const ASSET_COLS = [
  { key:'name',       label:'Asset Group',sortable:true, align:'left',  width:200 },
  { key:'campaign',   label:'Campaign',   sortable:true, align:'left'             },
  { key:'status',     label:'Asset Group Status', sortable:true, align:'center', format: reportStatusBadge },
  { key:'impressions',label:'Impr.',      sortable:true, align:'right', format:fmtNum },
  { key:'clicks',     label:'Clicks',     sortable:true, align:'right', format:fmtNum },
  { key:'cost',       label:'Cost',       sortable:true, align:'right', format:fmtUsd },
  { key:'conversions',     label:'Conv.',      sortable:true, align:'right', format:fmtNum },
  { key:'formConversions', label:'Form Conv.', sortable:true, align:'right',
    format:(v,row)=><BreakdownCell value={v} breakdown={row.formBreakdown} entityLabel={row.name}
      modalTitle="Form Conversions" buttonTitle="View form conversion breakdown" rowLabel="Conversion Action"/> },
  { key:'phoneConversions',label:'Call Conv.', sortable:true, align:'right',
    format:(v,row)=><BreakdownCell value={v} breakdown={row.phoneBreakdown} entityLabel={row.name}
      modalTitle="Call Conversions" buttonTitle="View call conversion breakdown" rowLabel="Conversion Action"/> },
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
  { key:'adGroupName',       label:'Ad Group',     sortable:true  },
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

// ── Tab: Form Conversions / Phone Call Conversions ────────────────────────────
// Full-page version of the Form/Call Conv. drill-down shown elsewhere — one
// row per (campaign, ad group, conversion action) combination instead of
// nested behind a chevron, with campaign/ad-group/action filters.
function ConversionActionsTab({ data, loading, error, onRetry, hidePaused, title, actionColumnLabel, accountName }) {
  const [campFilter,       setCampFilter]       = useState('')
  const [campStatusFilter, setCampStatusFilter] = useState('Enabled')
  const [adGroupFilter,    setAdGroupFilter]    = useState('')
  const [actionFilter,     setActionFilter]     = useState('')

  if (error) return <ErrorState message={error} onRetry={onRetry} />

  const allData = data || []

  const campNames = [...new Set(
    (campStatusFilter ? allData.filter(r => r.campaignStatus === campStatusFilter) : allData)
      .map(r => r.campaign).filter(Boolean)
  )].sort()
  const campStatuses = [...new Set(allData.map(r => r.campaignStatus).filter(Boolean))].sort()
  const adGroupNames = [...new Set(
    (campFilter ? allData.filter(r => r.campaign === campFilter) : allData)
      .map(r => r.adGroup).filter(Boolean)
  )].sort()
  const actionNames = [...new Set(allData.map(r => r.conversionAction).filter(Boolean))].sort()

  const filtered = allData.filter(r =>
    (!campFilter       || r.campaign         === campFilter)       &&
    (!campStatusFilter || r.campaignStatus   === campStatusFilter) &&
    (!adGroupFilter    || r.adGroup          === adGroupFilter)    &&
    (!actionFilter     || r.conversionAction === actionFilter)
  )

  const totalConversions = filtered.reduce((s, r) => s + (r.conversions || 0), 0)

  const cols = [
    { key:'campaign',         label:'Campaign',           sortable:true, align:'left',  width:200 },
    { key:'adGroup',          label:'Ad Group',           sortable:true, align:'left',  width:180 },
    { key:'conversionAction', label:actionColumnLabel,    sortable:true, align:'left',  width:220 },
    { key:'conversions',      label:'Conversions',        sortable:true, align:'right', format:fmtNum },
  ]

  const selStyle = { padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }

  return (
    <Section title={title} extra={
      <div style={{ display:'flex', gap:8 }}>
        <ExportButton data={toDisplayCsv(filtered, cols)} filename={title.toLowerCase().replace(/\s+/g,'-')}/>
        <ExportPdfButton accountName={accountName} section={title} />
      </div>
    }>
      <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f4f8', background:'#fafcff', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign Name:</span>
          <select value={campFilter} onChange={e => { setCampFilter(e.target.value); setAdGroupFilter('') }} style={selStyle}>
            <option value="">All</option>
            {campNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign Status:</span>
          <select value={campStatusFilter} onChange={e => { setCampStatusFilter(e.target.value); setCampFilter('') }} style={selStyle}>
            <option value="">All</option>
            {campStatuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Ad Group:</span>
          <select value={adGroupFilter} onChange={e => setAdGroupFilter(e.target.value)} style={selStyle}>
            <option value="">All</option>
            {adGroupNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>{actionColumnLabel}:</span>
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} style={selStyle}>
            <option value="">All</option>
            {actionNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        {(campFilter || (campStatusFilter && campStatusFilter !== 'Enabled') || adGroupFilter || actionFilter) && (
          <button onClick={() => { setCampFilter(''); setCampStatusFilter('Enabled'); setAdGroupFilter(''); setActionFilter('') }}
            style={{ fontSize:11, color:'#2563b0', background:'none', border:'1px solid #dde9f5', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
            Clear
          </button>
        )}
        <span style={{ fontSize:11, color:'#888', marginLeft:'auto' }}>{filtered.length} of {allData.length} · {fmtNum(totalConversions)} total conversions</span>
      </div>
      <ReportTable columns={cols} data={filtered} loading={loading} hidePaused={hidePaused}
        emptyMessage={`No ${title.toLowerCase()} found for this period`}/>
    </Section>
  )
}

function CallLeadsTab({ data, loading, error, onRetry, initialCampaignFilter = '', accountName }) {
  const [filterCampaign, setFilterCampaign] = useState(initialCampaignFilter)
  const [filterAdGroup,  setFilterAdGroup]  = useState('')
  const [filterStatus,   setFilterStatus]   = useState('all')
  const [minDuration,    setMinDuration]    = useState(0)
  const [page,           setPage]           = useState(0)
  const [pageSize,       setPageSize]       = useState(25)
  const [sortKey,        setSortKey]        = useState('startTime')
  const [sortAsc,        setSortAsc]        = useState(false)
  // Show every row during a PDF export instead of just the current page —
  // see usePdfExportMode.
  const pdfExportMode = usePdfExportMode()



  const calls   = data?.calls   ?? []
  const summary = data?.summary ?? {}

  const campaignOptions = useMemo(() =>
    [...new Set(calls.map(c => c.campaignName).filter(Boolean))].sort()
  , [calls])

  // Ad group options scoped to the selected campaign (if any), same pattern
  // as the campaign-scoped ad group filters elsewhere in Reports.
  const adGroupOptions = useMemo(() =>
    [...new Set(
      (filterCampaign ? calls.filter(c => c.campaignName === filterCampaign) : calls)
        .map(c => c.adGroupName).filter(Boolean)
    )].sort()
  , [calls, filterCampaign])

  const filtered = useMemo(() => {
    let r = calls
    if (filterCampaign) r = r.filter(c => c.campaignName === filterCampaign)
    if (filterAdGroup)  r = r.filter(c => c.adGroupName === filterAdGroup)
    if (filterStatus !== 'all') r = r.filter(c => resolveEnum(CALL_STATUS, c.callStatus, '') === filterStatus)
    if (minDuration > 0)        r = r.filter(c => (c.durationSeconds || 0) >= minDuration)
    return [...r].sort((a, b) => {
      const va = a[sortKey] ?? '', vb = b[sortKey] ?? ''
      if (typeof va === 'number') return sortAsc ? va - vb : vb - va
      return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    })
  }, [calls, filterCampaign, filterAdGroup, filterStatus, minDuration, sortKey, sortAsc])

  useEffect(() => { setPage(0) }, [filterCampaign, filterAdGroup, filterStatus, minDuration, sortKey, sortAsc])

  // Curated to match exactly what the Call Log table displays — not a raw
  // dump of `filtered`, whose fields are unformatted (raw enum codes, raw
  // seconds, raw timestamp) and carry extra columns the table doesn't show.
  const callCsvRows = filtered.map((c, i) => ({
    '#':           i + 1,
    'Start Time':  c.startTime ? dayjs(c.startTime).format('DD MMM YYYY, HH:mm') : '—',
    'Duration':    fmtDurSec(c.durationSeconds || 0),
    'Country':     fmtCountry(c.callerCountryCode),
    'Area Code':   c.callerAreaCode || '—',
    'Phone':       c.callerPhoneNumber || '—',
    'Status':      resolveEnum(CALL_STATUS, c.callStatus, String(c.callStatus ?? '—')),
    'Call Source': resolveEnum(CALL_TRACKING_CONDITION, c.callSource, c.callSource || '—'),
    'Campaign':    c.campaignName || '—',
    'Ad Group':    c.adGroupName || '—',
  }))

  // All hooks above — early returns below
  if (error)   return <ErrorState message={error} onRetry={onRetry} />
  if (loading) return <div style={{ padding:20 }}><div className="skeleton" style={{ height:300, borderRadius:6 }}/></div>
  if (!data)   return null

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated  = pdfExportMode ? filtered : filtered.slice(page * pageSize, (page + 1) * pageSize)
  const rangeStart = page * pageSize + 1
  const rangeEnd   = Math.min((page + 1) * pageSize, filtered.length)

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
      case 'callSource':        return resolveEnum(CALL_TRACKING_CONDITION, v, v || '—')
      case 'callType':          return resolveEnum(CALL_TYPE, v, v || '—')
      case 'campaignName':
      case 'adGroupName': {
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
        <select value={filterCampaign} onChange={e => { setFilterCampaign(e.target.value); setFilterAdGroup(''); setPage(0) }}
          style={{ padding:'6px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, outline:'none', color:'#1a3a6b', background:'#fff', cursor:'pointer' }}>
          <option value="">All Campaigns</option>
          {campaignOptions.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={filterAdGroup} onChange={e => { setFilterAdGroup(e.target.value); setPage(0) }}
          style={{ padding:'6px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, outline:'none', color:'#1a3a6b', background:'#fff', cursor:'pointer' }}>
          <option value="">All Ad Groups</option>
          {adGroupOptions.map(n => <option key={n} value={n}>{n}</option>)}
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
        <ExportButton data={callCsvRows} filename="call-leads" />
        <ExportPdfButton accountName={accountName} section="Call Leads" />
      </div>

      {/* Call log table */}
      <div className="card" style={{ marginBottom:12, display:'flex', flexDirection:'column', maxHeight: pdfExportMode ? 'none' : '70vh' }}>
        <div className="card-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <span className="card-title">Call Log ({filtered.length} call{filtered.length !== 1 ? 's' : ''})</span>
          {filtered.length > 0 && <span style={{ fontSize:12, color:'#888' }}>{rangeStart}–{rangeEnd} of {filtered.length}</span>}
        </div>
        <div style={{ overflowX:'auto', flex:1 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                {CALL_COLS.map(col => (
                  <th key={col.key} onClick={() => handleSort(col.key)}
                    style={{ ...thStyle(col), position:'sticky', top:0, zIndex:2 }}>
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
        {!pdfExportMode && filtered.length > 0 && (
          <div className="no-print" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderTop:'1px solid #f0f4f8', flexShrink:0, flexWrap:'wrap', gap:8 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:12, color:'#888' }}>Rows per page:</span>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
                style={{ padding:'4px 8px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer' }}>
                {[10,25,50,100,250].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <span style={{ fontSize:12, color:'#888' }}>{rangeStart}–{rangeEnd} of {filtered.length}</span>
              {totalPages > 1 && (
                <>
                  <button onClick={() => setPage(0)} disabled={page === 0}
                    style={{ padding:'4px 8px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background:page===0?'#f5f7fa':'#fff', color:page===0?'#aaa':'#1a3a6b', cursor:page===0?'not-allowed':'pointer' }}>«</button>
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                    style={{ padding:'5px 12px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background: page===0 ? '#f5f7fa' : '#fff', color: page===0 ? '#aaa' : '#1a3a6b', cursor: page===0 ? 'not-allowed' : 'pointer' }}>
                    ‹ Prev
                  </button>
                  <span style={{ padding:'4px 8px', fontSize:12, color:'#555', border:'1px solid #dde9f5', borderRadius:5, background:'#f5f7fa' }}>Page {page + 1} of {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                    style={{ padding:'5px 12px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background: page>=totalPages-1 ? '#f5f7fa' : '#fff', color: page>=totalPages-1 ? '#aaa' : '#1a3a6b', cursor: page>=totalPages-1 ? 'not-allowed' : 'pointer' }}>
                    Next ›
                  </button>
                  <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                    style={{ padding:'4px 8px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:5, background:page>=totalPages-1?'#f5f7fa':'#fff', color:page>=totalPages-1?'#aaa':'#1a3a6b', cursor:page>=totalPages-1?'not-allowed':'pointer' }}>»</button>
                </>
              )}
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

// ── Ad performance classifier ────────────────────────────────────────────────
const PERF_CATEGORIES = {
  TOP:          { label:'⭐ Top Performer',           color:'#7c5700', bg:'#fff8e1', border:'#ffd54f' },
  STRONG:       { label:'✓ Strong Performer',        color:'#1b5e20', bg:'#e8f5e9', border:'#66bb6a' },
  AVERAGE:      { label:'Average Performer',         color:'#1a3a6b', bg:'#e3edff', border:'#b3c8f0' },
  UNDER:        { label:'Underperforming',           color:'#e65100', bg:'#fff3e0', border:'#ffcc80' },
  LOW_VIS:      { label:'Low Visibility',            color:'#546e7a', bg:'#eceff1', border:'#cfd8dc' },
  HIGH_ENG:     { label:'High Engagement / Low Conv.',color:'#6a1b9a', bg:'#f3e5f5', border:'#ce93d8' },
  HIGH_CONV:    { label:'High Conv. / Low Traffic',  color:'#1565c0', bg:'#e3f2fd', border:'#90caf9' },
  WASTED:       { label:'Under Performer',            color:'#b71c1c', bg:'#ffebee', border:'#ef9a9a' },
  LEARNING:     { label:'Learning Phase',            color:'#4527a0', bg:'#ede7f6', border:'#b39ddb' },
  SEASONAL:     { label:'Seasonal / Trend',          color:'#00695c', bg:'#e0f2f1', border:'#80cbc4' },
}

function classifyAdPerformance(row) {
  const impr  = row.impressions  || 0
  const clicks = row.clicks      || 0
  const ctr    = row.ctr         || 0   // already %
  const conv   = row.conversions || 0
  const rate   = row.convRate    || 0   // already %
  const cost   = row.cost        || 0
  const cpa    = conv > 0 ? cost / conv : null

  // 1. Learning Phase — not enough data to judge
  if (impr < 100 || (clicks < 5 && impr < 500)) {
    const c = PERF_CATEGORIES.LEARNING
    return { ...c, explanation: `Only ${fmtNum(impr)} impr. / ${fmtNum(clicks)} clicks — insufficient data to assess performance.` }
  }

  // 2. Wasted Spend — real traffic, meaningful spend, zero output
  if (cost >= 20 && conv === 0 && clicks >= 10) {
    const c = PERF_CATEGORIES.WASTED
    return { ...c, explanation: `${fmtUsd(cost)} spent across ${fmtNum(clicks)} clicks with 0 conversions.` }
  }

  // 3. High Engagement / Low Conversion — clicks happen but don't convert
  if (ctr >= 3.5 && clicks >= 15 && rate < 1) {
    const c = PERF_CATEGORIES.HIGH_ENG
    return { ...c, explanation: `${fmtPct(ctr)} CTR shows strong ad relevance but ${fmtPct(rate)} conv. rate — likely a landing page or offer issue.` }
  }

  // 4. High Conversion / Low Traffic — converting well but barely shown
  if (rate >= 8 && impr < 400) {
    const c = PERF_CATEGORIES.HIGH_CONV
    return { ...c, explanation: `Strong ${fmtPct(rate)} conv. rate on very limited reach — only ${fmtNum(impr)} impressions.` }
  }

  // 5. Top Performer — high output across all key metrics
  if (conv >= 5 && rate >= 5 && ctr >= 2.5) {
    const c = PERF_CATEGORIES.TOP
    return { ...c, explanation: `${fmtNum(conv)} conv. at ${fmtPct(rate)} rate · ${fmtPct(ctr)} CTR${cpa ? ` · CPA ${fmtUsd(cpa)}` : ''}.` }
  }

  // 6. Strong Performer — solid, consistent results
  if (conv >= 2 && rate >= 3 && ctr >= 1.5) {
    const c = PERF_CATEGORIES.STRONG
    return { ...c, explanation: `${fmtNum(conv)} conv. · ${fmtPct(rate)} conv. rate · ${fmtPct(ctr)} CTR${cpa ? ` · CPA ${fmtUsd(cpa)}` : ''}.` }
  }

  // 7. Low Visibility — impressions exist but ad barely runs
  if (impr < 300 && cost < 10) {
    const c = PERF_CATEGORIES.LOW_VIS
    return { ...c, explanation: `${fmtNum(impr)} impressions in this period — limited reach, possibly low bid or budget.` }
  }

  // 8. Seasonal / Trend — traffic & spend but no conversions despite decent CTR
  if (impr >= 400 && cost > 5 && conv === 0 && ctr >= 1.5) {
    const c = PERF_CATEGORIES.SEASONAL
    return { ...c, explanation: `${fmtNum(impr)} impr. · ${fmtPct(ctr)} CTR · ${fmtUsd(cost)} spent but 0 conv. — may be tied to a seasonal offer or expired promotion.` }
  }

  // 9. Underperforming — low CTR and poor or zero conversions
  if (ctr < 1.5 && (conv === 0 || rate < 1.5)) {
    const c = PERF_CATEGORIES.UNDER
    return { ...c, explanation: `${fmtPct(ctr)} CTR · ${fmtNum(conv)} conv. · ${fmtPct(rate)} conv. rate — below acceptable thresholds.` }
  }

  // 10. Average Performer — mixed or moderate metrics
  const c = PERF_CATEGORIES.AVERAGE
  return { ...c, explanation: `${fmtPct(ctr)} CTR · ${fmtNum(conv)} conv. · ${fmtPct(rate)} conv. rate${cpa ? ` · CPA ${fmtUsd(cpa)}` : ''}.` }
}

// ── Per-cell component so AI rec state is isolated per row ───────────────────
function PerfCell({ row }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [recs,    setRecs]    = useState(null)
  const [recErr,  setRecErr]  = useState(null)

  const p = classifyAdPerformance(row)
  const isUnderPerformer = p.label === 'Under Performer'
  const canEditInRsaBuilder = isUnderPerformer && !!row.campaignId && !!row.adGroupId && !!row.id

  function editInRsaBuilder() {
    navigate('/ai-rsa-builder', {
      state: {
        campaignId: row.campaignId, adGroupId: row.adGroupId, adId: row.id,
        intent: 'audit', // land on the Audit tab with this ad's Edit modal already open
      },
    })
  }

  async function fetchRec() {
    setLoading(true); setRecErr(null)
    try {
      // customerId + adId only — the backend looks up this ad's LIVE current
      // headlines/descriptions itself rather than trusting row.headlines/
      // descriptions here, which can be stale if the ad was edited elsewhere
      // (e.g. the RSA Builder's Edit modal) since this table last loaded.
      const result = await window.electronAPI.adsUnderPerformerRec({
        customerId:   row.customerId   || '',
        adId:         row.id           || '',
        campaign:     row.campaign     || '',
        adGroup:      row.adGroup      || '',
        impressions:  row.impressions  || 0,
        clicks:       row.clicks       || 0,
        cost:         row.cost         || 0,
        ctr:          row.ctr          || 0,
        cpc:          row.cpc          || 0,
      })
      setRecs(result.recs || [])
    } catch (e) {
      setRecErr(e.message || 'Failed to get recommendation')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4, maxWidth:'100%', minWidth:0 }}>
      {/* Badge */}
      <span style={{
        display:'inline-block', padding:'2px 9px', borderRadius:4,
        fontSize:11, fontWeight:700, whiteSpace:'nowrap',
        background:p.bg, color:p.color, border:`1px solid ${p.border}`,
      }}>{p.label}</span>

      {/* Short explanation */}
      <span style={{ fontSize:11, color:'#555', lineHeight:1.45 }}>{p.explanation}</span>

      {/* AI recommendation — Under Performer only */}
      {isUnderPerformer && !recs && !loading && (
        <button
          onClick={fetchRec}
          style={{
            alignSelf:'flex-start', marginTop:2, padding:'2px 10px',
            fontSize:11, fontWeight:600, border:'1px solid #b71c1c',
            borderRadius:4, background:'#fff', color:'#b71c1c',
            cursor:'pointer', display:'flex', alignItems:'center', gap:5,
          }}
        >
          ✦ Get AI Suggestion
        </button>
      )}

      {/* Jump to RSA Builder's Audit tab with this exact ad's Edit modal
          already open — pre-selected campaign/ad group, data pre-loaded,
          AI recommendations ready to compare side-by-side. */}
      {canEditInRsaBuilder && (
        <button
          onClick={editInRsaBuilder}
          title="Open this ad in the RSA Builder to edit it with AI recommendations"
          style={{
            alignSelf:'flex-start', marginTop:2, padding:'2px 10px',
            fontSize:11, fontWeight:600, border:'1px solid #1a3a6b',
            borderRadius:4, background:'#fff', color:'#1a3a6b',
            cursor:'pointer', display:'flex', alignItems:'center', gap:5,
          }}
        >
          ✎ Edit with AI Recommendations
        </button>
      )}

      {isUnderPerformer && loading && (
        <span style={{ fontSize:11, color:'#888', display:'flex', alignItems:'center', gap:5 }}>
          <Loader2 size={11} className="spin" /> Analyzing…
        </span>
      )}

      {isUnderPerformer && recs && recs.length > 0 && (
        <div style={{ marginTop:4, padding:'8px 10px', background:'#fff8e1', border:'1px solid #ffd54f', borderRadius:6, maxWidth:'100%', boxSizing:'border-box', overflow:'hidden' }}>
          <div style={{ fontSize:10, fontWeight:700, color:'#7c5700', textTransform:'uppercase', letterSpacing:.6, marginBottom:5 }}>
            ✦ AI Suggestions
          </div>
          <ul style={{ margin:0, paddingLeft:14, display:'flex', flexDirection:'column', gap:8, maxWidth:'100%' }}>
            {recs.map((r, i) => (
              <li key={i} style={{ fontSize:11, color:'#444', lineHeight:1.5, wordBreak:'break-word', overflowWrap:'anywhere' }}>
                {highlightRecommendation(r.issue)}
                {r.suggestedText && (
                  <div style={{ marginTop:4, padding:'6px 8px', background:'#fff', border:'1px solid #ffe082', borderRadius:4, maxWidth:'100%', boxSizing:'border-box' }}>
                    <div style={{ fontSize:10, color:'#999', wordBreak:'break-word', overflowWrap:'anywhere' }}>
                      Current {r.replaceType} #{r.replaceIndex}: <span style={{ color:'#666' }}>"{r.currentText}"</span>
                    </div>
                    <div style={{ fontSize:11, color:'#1a3a6b', fontWeight:600, marginTop:2, wordBreak:'break-word', overflowWrap:'anywhere' }}>
                      → "{r.suggestedText}"
                      <span style={{ fontSize:9, fontWeight:400, color: r.suggestedText.length <= (r.replaceType === 'headline' ? 30 : 90) ? '#888' : '#c0392b', marginLeft:6 }}>
                        {r.suggestedText.length}/{r.replaceType === 'headline' ? 30 : 90}
                      </span>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canEditInRsaBuilder && (
            <div style={{ fontSize:10, color:'#a56700', marginTop:8, wordBreak:'break-word', overflowWrap:'anywhere' }}>
              Use <strong>Edit with AI Recommendations</strong> above to apply any of these directly to the ad.
            </div>
          )}
        </div>
      )}

      {isUnderPerformer && recErr && (
        <span style={{ fontSize:11, color:'#c0392b' }}>{recErr}</span>
      )}
    </div>
  )
}

// AD_TYPE maps several raw values (numeric 15, numeric 19, and the string
// 'RESPONSIVE_SEARCH_AD') all to the same "Responsive Search Ad" label
// depending on API version — comparing a raw value directly would miss
// whichever variant wasn't checked, so this shortens the already-resolved
// label instead. Shared by the table column and the filter-option list so
// the dropdown and the rows it filters always say the same thing.
const adTypeLabel = v => {
  const label = resolveEnum(AD_TYPE, v, String(v ?? '—'))
  return label === 'Responsive Search Ad' ? 'RSA' : label
}

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
  { key:'type',        label:'Ad Type',    sortable:true,  align:'left',   format: adTypeLabel },
  { key:'campaign',    label:'Campaign / Ad Group', sortable:true, align:'left', width:200, wrap:true,
    sortValue: row => row.campaign || '',
    format: (_, row) => (
      <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
        <span>{row.campaign || '—'}</span>
        <span style={{ fontSize:11, color:'#888' }}>{row.adGroup || '—'}</span>
      </div>
    ) },
  { key:'status',      label:'Ad Status',   sortable:true,  align:'center', badge:true  },
  { key:'_perfCategory', label:'Ad Performance', sortable:true, align:'left', width:230, wrap:true,
    format: (_, row) => <PerfCell row={row} />,
  },
  { key:'impressions', label:'Impr.',      sortable:true,  align:'right',  format:fmtNum  },
  { key:'clicks',      label:'Clicks',     sortable:true,  align:'right',  format:fmtNum  },
  { key:'ctr',         label:'CTR',        sortable:true,  align:'right',  format:fmtPct  },
  { key:'conversions',     label:'Conv.',      sortable:true,  align:'right', format:fmtNum },
  { key:'formConversions', label:'Form Conv.', sortable:true,  align:'right',
    format:(v,row)=><BreakdownCell value={v} breakdown={row.formBreakdown} entityLabel={`${row.campaign} — ${row.adGroup}`}
      modalTitle="Form Conversions" buttonTitle="View form conversion breakdown" rowLabel="Conversion Action"/> },
  { key:'phoneConversions',label:'Call Conv.', sortable:true,  align:'right',
    format:(v,row)=><BreakdownCell value={v} breakdown={row.phoneBreakdown} entityLabel={`${row.campaign} — ${row.adGroup}`}
      modalTitle="Call Conversions" buttonTitle="View call conversion breakdown" rowLabel="Conversion Action"/> },
  { key:'phoneCalls',      label:'Call Leads', sortable:true,  align:'center',
    format:(v,row)=><BreakdownCell value={v} breakdown={row.callBreakdown} entityLabel={`${row.campaign} — ${row.adGroup}`} align="center"
      modalTitle="Call Leads" buttonTitle="View call status breakdown" rowLabel="Call Status"
      valueNode={<CallLeadsBadge count={v} campaignName={row.campaign}/>}/> },
  { key:'convRate',    label:'Conv. Rate', sortable:true,  align:'right',  format:fmtPct,
    colorFn: v => v > 5 ? '#2e7d32' : v >= 2 ? '#a56700' : '#c0392b' },
  { key:'cost',        label:'Cost',       sortable:true,  align:'right',  format:fmtUsd  },
  { key:'cpc',         label:'Avg. CPC',   sortable:true,  align:'right',  format:fmtCpc  },
  { key:'_costPerConv',label:'Cost / Conv',sortable:true,  align:'right',
    sortValue: row => row.conversions > 0 ? row.cost / row.conversions : 0,
    format: (_, row) => fmtUsd(row.conversions > 0 ? row.cost / row.conversions : 0) },
]

const selStyle = {
  padding:'5px 10px', border:'1px solid #dde9f5', borderRadius:6,
  fontSize:12, color:'#1a3a6b', background:'#fff', outline:'none', cursor:'pointer', minWidth:130,
}

function AdsPerformanceTab({ data, loading, error, onRetry, hidePaused, customerId, accountName }) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />

  const [fCampaign, setFCampaign] = useState('')
  const [fStatus,   setFStatus]   = useState('Enabled')
  const [fAdGroup,  setFAdGroup]  = useState('')
  const [fAdStatus, setFAdStatus] = useState('Active')
  const [fAdType,   setFAdType]   = useState('')
  const [fPerf,     setFPerf]     = useState('')

  // Base rows — computed labels (source of truth for filter options). This report
  // shows ads of every status by default; the global "hide paused" preference is
  // intentionally not applied here — use the Ad Status filter below instead.
  const baseRows = useMemo(() => {
    const r = data || []
    return r.map(a => ({
      ...a,
      customerId,
      _perfCategory: classifyAdPerformance(a).label,
      _adTypeLabel:  adTypeLabel(a.type),
    }))
  }, [data, customerId])

  // ── Filter option lists (only values that actually exist in the data) ─────
  const optCampaigns = useMemo(() =>
    [...new Set(baseRows.map(r => r.campaign).filter(Boolean))].sort()
  , [baseRows])

  const optStatuses = useMemo(() =>
    [...new Set(baseRows.map(r => r.campaignStatus).filter(Boolean))].sort()
  , [baseRows])

  const optAdGroups = useMemo(() => {
    const src = fCampaign ? baseRows.filter(r => r.campaign === fCampaign) : baseRows
    return [...new Set(src.map(r => r.adGroup).filter(Boolean))].sort()
  }, [baseRows, fCampaign])

  const optAdStatuses = useMemo(() =>
    [...new Set(baseRows.map(r => r.status).filter(Boolean))].sort()
  , [baseRows])

  const optAdTypes = useMemo(() =>
    [...new Set(baseRows.map(r => r._adTypeLabel).filter(Boolean))].sort()
  , [baseRows])

  const optPerf = useMemo(() =>
    [...new Set(baseRows.map(r => r._perfCategory).filter(Boolean))].sort()
  , [baseRows])

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    let r = baseRows
    if (fCampaign) r = r.filter(x => x.campaign        === fCampaign)
    if (fStatus)   r = r.filter(x => x.campaignStatus  === fStatus)
    if (fAdGroup)  r = r.filter(x => x.adGroup       === fAdGroup)
    if (fAdStatus) r = r.filter(x => x.status        === fAdStatus)
    if (fAdType)   r = r.filter(x => x._adTypeLabel  === fAdType)
    if (fPerf)     r = r.filter(x => x._perfCategory === fPerf)
    return r
  }, [baseRows, fCampaign, fStatus, fAdGroup, fAdStatus, fAdType, fPerf])

  const hasFilters = fCampaign || fStatus !== 'Enabled' || fAdGroup || fAdStatus !== 'Active' || fAdType || fPerf

  function clearFilters() {
    setFCampaign(''); setFStatus('Enabled'); setFAdGroup(''); setFAdStatus('Active'); setFAdType(''); setFPerf('')
  }
  function handleCampaignChange(v) {
    setFCampaign(v); setFAdGroup('') // reset dependent ad group
  }

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
                    {[['Conv.',fmtNum(ad.conversions||0)],['Rate',fmtPct(ad.convRate||0)],['Cost',fmtUsd(ad.cost||0)]].map(([l,v]) => (
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

      <Section
        title={`All Ads (${rows.length}${rows.length !== baseRows.length ? ` of ${baseRows.length}` : ''})`}
        extra={
          <div style={{ display:'flex', gap:8 }}>
            <ExportButton data={rows.map(r=>({...r,type:r._adTypeLabel||r.type||'—'}))} filename="ads-performance" />
            <ExportPdfButton accountName={accountName} section="Ad Performance" />
          </div>
        }
      >
        {/* ── Filter bar ── */}
        <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f4f8', background:'#fafcff', display:'flex', flexWrap:'wrap', alignItems:'flex-end', gap:10 }}>

          {/* Campaign */}
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <label style={{ fontSize:10, fontWeight:700, color:'#888', textTransform:'uppercase', letterSpacing:.5 }}>Campaign</label>
            <select value={fCampaign} onChange={e => handleCampaignChange(e.target.value)} style={selStyle}>
              <option value="">All Campaigns</option>
              {optCampaigns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Campaign Status */}
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <label style={{ fontSize:10, fontWeight:700, color:'#888', textTransform:'uppercase', letterSpacing:.5 }}>Campaign Status</label>
            <select value={fStatus} onChange={e => setFStatus(e.target.value)} style={selStyle}>
              <option value="">All Statuses</option>
              {optStatuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Ad Group — cascades from Campaign */}
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <label style={{ fontSize:10, fontWeight:700, color:'#888', textTransform:'uppercase', letterSpacing:.5 }}>
              Ad Group{fCampaign ? ` (${optAdGroups.length})` : ''}
            </label>
            <select value={fAdGroup} onChange={e => setFAdGroup(e.target.value)} style={{ ...selStyle, color: optAdGroups.length === 0 ? '#aaa' : '#1a3a6b' }} disabled={optAdGroups.length === 0}>
              <option value="">All Ad Groups</option>
              {optAdGroups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          {/* Ad Status */}
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <label style={{ fontSize:10, fontWeight:700, color:'#888', textTransform:'uppercase', letterSpacing:.5 }}>Ad Status</label>
            <select value={fAdStatus} onChange={e => setFAdStatus(e.target.value)} style={selStyle}>
              <option value="">All Statuses</option>
              {optAdStatuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Ad Type */}
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <label style={{ fontSize:10, fontWeight:700, color:'#888', textTransform:'uppercase', letterSpacing:.5 }}>Ad Type</label>
            <select value={fAdType} onChange={e => setFAdType(e.target.value)} style={selStyle}>
              <option value="">All Types</option>
              {optAdTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Ad Performance */}
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <label style={{ fontSize:10, fontWeight:700, color:'#888', textTransform:'uppercase', letterSpacing:.5 }}>Ad Performance</label>
            <select value={fPerf} onChange={e => setFPerf(e.target.value)} style={{ ...selStyle, minWidth:170 }}>
              <option value="">All Categories</option>
              {optPerf.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Clear button */}
          {hasFilters && (
            <button onClick={clearFilters} style={{
              padding:'5px 12px', fontSize:11, fontWeight:600, borderRadius:6,
              border:'1px solid #c0392b', background:'#fff', color:'#c0392b',
              cursor:'pointer', alignSelf:'flex-end',
            }}>
              ✕ Clear Filters
            </button>
          )}
        </div>

        <ReportTable columns={ADS_COLS} data={rows} loading={loading} emptyMessage="No ads match the selected filters" />
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
    <div className="no-print" style={{ display:'flex', flexShrink:0, background:'#1a3a6b', borderBottom:'1px solid rgba(255,255,255,0.1)' }}>
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

// ── Summary tab helpers ───────────────────────────────────────────────────────
function SumKpi({ label, value, sub, color }) {
  return (
    <div style={{ background:'#fff', border:'1px solid #e8eef7', borderRadius:10, padding:'14px 18px', minWidth:130, flex:1 }}>
      <div style={{ fontSize:11, color:'#888', fontWeight:500, marginBottom:4, textTransform:'uppercase', letterSpacing:.5 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:700, color: color || '#1a3a6b', lineHeight:1.1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'#888', marginTop:3 }}>{sub}</div>}
    </div>
  )
}
function SumChange({ cur, prev, fmt, invertColor }) {
  if (prev == null || prev === 0) return <span style={{ color:'#aaa', fontSize:11 }}>—</span>
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  const up  = pct >= 0
  const good = invertColor ? !up : up
  return (
    <span style={{ fontSize:11, fontWeight:600, color: good ? '#2e7d32' : '#c0392b' }}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}
function SumRow({ label, children, border }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 0', borderBottom: border !== false ? '1px solid #f0f4f8' : 'none', gap:8 }}>
      <span style={{ fontSize:12, color:'#555', flex:1 }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:600, color:'#1a3a6b' }}>{children}</span>
    </div>
  )
}
function IssuePill({ type, text }) {
  const cfg = {
    error:   { bg:'#fdecea', color:'#c0392b', dot:'#e05c2a' },
    warning: { bg:'#fff8e1', color:'#a56700', dot:'#f0b429' },
    success: { bg:'#e8f5e9', color:'#2e7d32', dot:'#4caf50' },
    info:    { bg:'#e3f2fd', color:'#1565c0', dot:'#2563b0' },
  }[type] || { bg:'#f5f7fa', color:'#555', dot:'#aaa' }
  return (
    <div style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'8px 12px', background:cfg.bg, borderRadius:8, marginBottom:6 }}>
      <span style={{ width:8, height:8, borderRadius:'50%', background:cfg.dot, marginTop:4, flexShrink:0 }}/>
      <span style={{ fontSize:12, color:cfg.color, lineHeight:1.5 }}>{text}</span>
    </div>
  )
}
function ActionItem({ priority, text }) {
  const cfg = { high:{ bg:'#fdecea', color:'#c0392b', tag:'High' }, mid:{ bg:'#fff8e1', color:'#a56700', tag:'Medium' }, low:{ bg:'#e8f5e9', color:'#2e7d32', tag:'Low' } }[priority]
  return (
    <div style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'7px 0', borderBottom:'1px solid #f0f4f8' }}>
      <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:99, background:cfg.bg, color:cfg.color, flexShrink:0, marginTop:1 }}>{cfg.tag}</span>
      <span style={{ fontSize:12, color:'#333', lineHeight:1.5 }}>{text}</span>
    </div>
  )
}

function calcHealthScore(kpis, campaigns, budget, previousKpis) {
  let score = 50
  const ctr      = kpis?.ctr      || 0
  const convRate = kpis?.convRate  || 0
  const conv     = kpis?.conversions || 0
  const spend    = kpis?.spend    || 0

  // CTR scoring
  if      (ctr >= 5)  score += 15
  else if (ctr >= 3)  score += 10
  else if (ctr >= 1)  score += 5
  else                score -= 10

  // Conv rate scoring
  if      (convRate >= 5)   score += 15
  else if (convRate >= 2)   score += 8
  else if (convRate >= 0.5) score += 3
  else if (spend > 0)       score -= 10

  // Conversions
  if   (conv > 0) score += 10
  else if (spend > 100) score -= 15

  // CPA trend vs prev
  if (previousKpis && kpis?.cpa > 0 && previousKpis.cpa > 0) {
    const cpaDelta = ((kpis.cpa - previousKpis.cpa) / previousKpis.cpa) * 100
    if      (cpaDelta < -10) score += 8
    else if (cpaDelta >  20) score -= 8
  }

  // Budget issues
  const limited  = (budget || []).filter(b => b.issue === 'Limited by budget').length
  const overPace = (budget || []).filter(b => b.issue === 'Overpacing').length
  const inactive = (budget || []).filter(b => b.issue === 'No activity').length
  score -= limited * 4
  score -= overPace * 3
  score -= inactive * 2

  // Active campaigns
  const activeCamps = (campaigns || []).filter(c => c.status === 'Enabled' || c.status === 'Active').length
  if (activeCamps > 0) score += 5

  return Math.min(100, Math.max(0, Math.round(score)))
}

function healthLabel(score) {
  if (score >= 80) return { label:'Excellent', color:'#2e7d32', bg:'#e8f5e9' }
  if (score >= 65) return { label:'Good',      color:'#2563b0', bg:'#e3f2fd' }
  if (score >= 50) return { label:'Fair',      color:'#a56700', bg:'#fff8e1' }
  if (score >= 35) return { label:'Needs Attention', color:'#e05c2a', bg:'#fff3e0' }
  return                  { label:'Critical',  color:'#c0392b', bg:'#fdecea' }
}

// ── AI review markdown renderer ───────────────────────────────────────────────
function MarkdownReview({ text }) {
  if (!text) return null
  return (
    <div style={{ fontSize:12, lineHeight:1.7 }}>
      {text.split('\n').map((line, i) => {
        if (line.startsWith('## ')) return (
          <div key={i} style={{ fontSize:13, fontWeight:700, color:'#1a3a6b', marginTop: i===0?0:14, marginBottom:4, borderBottom:'1px solid #e8eef7', paddingBottom:4 }}>
            {line.slice(3)}
          </div>
        )
        if (line.startsWith('- ') || line.startsWith('• ')) return (
          <div key={i} style={{ display:'flex', gap:6, paddingLeft:8, paddingTop:2 }}>
            <span style={{ color:'#2563b0', flexShrink:0, marginTop:1 }}>•</span>
            <span style={{ color:'#333' }} dangerouslySetInnerHTML={{ __html: line.slice(2).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>') }}/>
          </div>
        )
        if (line.trim() === '') return <div key={i} style={{ height:6 }}/>
        return (
          <div key={i} style={{ color:'#444', paddingTop:2 }}
            dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>') }}/>
        )
      })}
    </div>
  )
}

// ── Keyword Analysis helpers ──────────────────────────────────────────────────
function QsBadge({ qs }) {
  if (!qs) return <span style={{ color:'#aaa', fontSize:11 }}>—</span>
  const color = qs >= 8 ? '#2e7d32' : qs >= 6 ? '#a56700' : '#c0392b'
  const bg    = qs >= 8 ? 'rgba(46,125,50,0.1)' : qs >= 6 ? 'rgba(165,103,0,0.1)' : 'rgba(192,57,43,0.1)'
  return <span style={{ fontSize:11, fontWeight:700, color, background:bg, borderRadius:4, padding:'1px 6px' }}>{qs}/10</span>
}
function MatchTypePill({ mt }) {
  const cfg = { Broad:['#1565c0','#e3f2fd'], Phrase:['#a56700','#fff8e1'], Exact:['#2e7d32','#e8f5e9'] }[mt] || ['#666','#f5f7fa']
  return <span style={{ fontSize:10, fontWeight:700, color:cfg[0], background:cfg[1], borderRadius:3, padding:'1px 5px' }}>{mt||'—'}</span>
}
function KwMiniTable({ rows, cols }) {
  if (!rows || rows.length === 0) return (
    <div style={{ padding:'12px 0', textAlign:'center', color:'#aaa', fontSize:12 }}>No data for this period</div>
  )
  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.key} style={{ padding:'5px 8px', background:'#f5f7fa', color:'#1a3a6b', fontWeight:600, fontSize:11, borderBottom:'1px solid #e8eef7', textAlign: c.right ? 'right' : 'left', whiteSpace:'nowrap' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i%2===0 ? '#fff' : '#f8fafd' }}>
              {cols.map(c => (
                <td key={c.key} style={{ padding:'5px 8px', borderBottom:'1px solid #f0f4f8', textAlign: c.right ? 'right' : 'left', color: c.colorFn ? c.colorFn(row[c.key], row) : '#333' }}>
                  {c.format ? c.format(row[c.key], row) : (row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Summary tab ───────────────────────────────────────────────────────────────
// Every toggleable widget on this page, in display order — "Manage Sections"
// shows/hides by this id. Persisted to localStorage (a pure per-viewer UI
// preference, not account data) so the choice survives reloads. Some
// sections bundle multiple visually-distinct sub-widgets (e.g. Keyword
// Analysis's "Top Performing" vs "Poor Performing" vs "Match Type" blocks) —
// those get a `subsections` list, each independently toggleable by its own
// dotted id ('parentId.subId'); hiding the parent still hides everything
// under it regardless of each sub-toggle's own state.
const SUMMARY_SECTIONS = [
  { id: 'executiveSummary', label: 'Executive Summary', subsections: [
    { id: 'executiveSummary.healthScore',         label: 'Health Score & Summary' },
    { id: 'executiveSummary.kpiCards',            label: 'KPI Cards' },
    { id: 'executiveSummary.conversionBreakdown', label: 'Conversion & Spend Breakdown' },
    { id: 'executiveSummary.bestCampaign',        label: 'Best Campaign / Biggest Concern / Structure' },
    { id: 'executiveSummary.majorWins',           label: 'Major Wins' },
  ]},
  { id: 'performanceComparison', label: 'Performance Comparison & Device Split', subsections: [
    { id: 'performanceComparison.table',      label: 'Performance Comparison Table' },
    { id: 'performanceComparison.devicePie',  label: 'Device Performance Pie' },
  ]},
  { id: 'dailyTrend',            label: 'Daily Performance Trend' },
  { id: 'callLeads',             label: 'Call Leads' },
  { id: 'campaignBreakdown',     label: 'Campaign Performance Breakdown' },
  { id: 'topCampaigns', label: 'Top Campaigns Charts', subsections: [
    { id: 'topCampaigns.bySpend',        label: 'Top Campaigns by Spend' },
    { id: 'topCampaigns.byConversions',  label: 'Top Campaigns by Conversions' },
  ]},
  { id: 'budgetHealth',          label: 'Budget Health' },
  { id: 'keywordAnalysis', label: 'Keyword Analysis', subsections: [
    { id: 'keywordAnalysis.summaryBoxes',      label: 'Summary KPI Boxes' },
    { id: 'keywordAnalysis.topPerforming',     label: 'Top Performing Keywords' },
    { id: 'keywordAnalysis.poorPerforming',    label: 'Poor Performing Keywords' },
    { id: 'keywordAnalysis.matchTypeAnalysis', label: 'Match Type Analysis' },
  ]},
  { id: 'searchTermsAnalysis', label: 'Search Terms Analysis', subsections: [
    { id: 'searchTermsAnalysis.overview',    label: 'Overview KPIs' },
    { id: 'searchTermsAnalysis.highIntent',  label: 'High Intent Search Terms' },
    { id: 'searchTermsAnalysis.wastedSpend', label: 'Wasted Spend Search Terms' },
    { id: 'searchTermsAnalysis.suggestions', label: 'Suggestions' },
  ]},
  { id: 'adPerformance', label: 'Ad Performance Analysis', subsections: [
    { id: 'adPerformance.overview',   label: 'Overview KPIs' },
    { id: 'adPerformance.top3',       label: 'Top 3 Best Performing Ads' },
    { id: 'adPerformance.bestAds',    label: 'Best Ads' },
    { id: 'adPerformance.rsaQuality', label: 'RSA Asset Strength' },
    { id: 'adPerformance.weakAds',    label: 'Weak Ads' },
    { id: 'adPerformance.extensions', label: 'Extensions / Assets Usage' },
  ]},
  { id: 'issuesRisks',           label: 'Issues & Risks' },
  { id: 'opportunities',         label: 'Growth Opportunities' },
  { id: 'actionPlan',            label: 'Recommended Action Plan' },
]
const SUMMARY_SECTIONS_STORAGE_KEY = 'reportsSummaryVisibleSections'

function loadVisibleSections() {
  try {
    const saved = JSON.parse(localStorage.getItem(SUMMARY_SECTIONS_STORAGE_KEY) || '{}')
    return saved && typeof saved === 'object' ? saved : {}
  } catch { return {} }
}

function ManageSectionsModal({ visibleSections, setVisibleSections, onClose }) {
  function toggle(id) {
    setVisibleSections(prev => {
      const next = { ...prev, [id]: prev[id] === false ? true : false }
      try { localStorage.setItem(SUMMARY_SECTIONS_STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }
  function setAll(value) {
    setVisibleSections(() => {
      const next = {}
      SUMMARY_SECTIONS.forEach(s => {
        next[s.id] = value
        s.subsections?.forEach(sub => { next[sub.id] = value })
      })
      try { localStorage.setItem(SUMMARY_SECTIONS_STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }
  return (
    <Modal title="Manage Sections" subtitle="Choose which widgets appear on the Summary page" onClose={onClose} maxWidth={460}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
        <button onClick={() => setAll(true)} style={{ fontSize: 11, color: '#2563b0', background: 'none', border: '1px solid #dde9f5', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}>Show All</button>
        <button onClick={() => setAll(false)} style={{ fontSize: 11, color: '#2563b0', background: 'none', border: '1px solid #dde9f5', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}>Hide All</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: '60vh', overflowY: 'auto' }}>
        {SUMMARY_SECTIONS.map(s => {
          const parentVisible = visibleSections[s.id] !== false
          return (
            <div key={s.id} style={{ borderBottom: '1px solid #f5f7fa', paddingBottom: s.subsections ? 4 : 0 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px', fontSize: 13, fontWeight: 600, color: '#1a3a6b', cursor: 'pointer' }}>
                <input type="checkbox" checked={parentVisible} onChange={() => toggle(s.id)} />
                {s.label}
              </label>
              {s.subsections && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginLeft: 26 }}>
                  {s.subsections.map(sub => (
                    <label key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 2px', fontSize: 12, color: parentVisible ? '#4a4a4a' : '#bbb', cursor: parentVisible ? 'pointer' : 'not-allowed' }}>
                      <input type="checkbox" disabled={!parentVisible} checked={visibleSections[sub.id] !== false} onChange={() => toggle(sub.id)} />
                      {sub.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function SummaryTab({ dashboardData, loading, customerId, dateRange, accountName }) {
  const [aiReview,  setAiReview]  = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError,   setAiError]   = useState(null)

  const [visibleSections, setVisibleSections] = useState(loadVisibleSections)
  const [manageSectionsOpen, setManageSectionsOpen] = useState(false)
  const isSectionVisible = id => visibleSections[id] !== false

  const [pdfExporting, setPdfExporting] = useState(false)
  async function handleExportPDF() {
    if (pdfExporting) return
    setPdfExporting(true)
    try {
      await window.electronAPI.exportPDF({ accountName, section: 'Summary' })
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setPdfExporting(false)
    }
  }

  const [htmlExporting, setHtmlExporting] = useState(false)
  async function handleExportHTML() {
    if (htmlExporting) return
    setHtmlExporting(true)
    try {
      await window.electronAPI.exportHTML({ accountName, section: 'Summary' })
    } catch (err) {
      console.error('HTML export failed:', err)
    } finally {
      setHtmlExporting(false)
    }
  }

  const [kwAnalysis,        setKwAnalysis]        = useState(null)
  const [kwAnalysisLoading, setKwAnalysisLoading] = useState(false)
  const [kwAnalysisError,   setKwAnalysisError]   = useState(null)

  const [stAnalysis,        setStAnalysis]        = useState(null)
  const [stAnalysisLoading, setStAnalysisLoading] = useState(false)
  const [stAnalysisError,   setStAnalysisError]   = useState(null)

  const [adAnalysis,        setAdAnalysis]        = useState(null)
  const [adAnalysisLoading, setAdAnalysisLoading] = useState(false)
  const [adAnalysisError,   setAdAnalysisError]   = useState(null)

  // ── Campaign / Ad Group filter ──────────────────────────────────────────
  // Lets the user scope the whole Summary page down to one campaign (or one
  // ad group within it). This is kept separate from the shared `dashboardData`
  // prop (which also feeds the Dashboard page and must stay account-wide) —
  // when a campaign is selected, SummaryTab fetches its own scoped copy below.
  const [filterCampaignId, setFilterCampaignId] = useState('')
  const [filterAdGroupId,  setFilterAdGroupId]  = useState('')
  const [campaignOptions,  setCampaignOptions]  = useState([])
  const [adGroupOptions,   setAdGroupOptions]   = useState([])
  const [adGroupsLoading,  setAdGroupsLoading]  = useState(false)
  const hasFilter = !!filterCampaignId

  const [scopedData,    setScopedData]    = useState(null)
  const [scopedLoading, setScopedLoading] = useState(false)

  useEffect(() => {
    setFilterCampaignId('')
    setFilterAdGroupId('')
    if (!customerId) { setCampaignOptions([]); return }
    let cancelled = false
    window.electronAPI.campaignList({ customerId })
      .then(rows => {
        if (cancelled) return
        // Local Services has no ad groups/keywords/ads — none of this page's
        // widgets apply to it, so it's left out of the picker entirely.
        const eligible = (rows || []).filter(c => c.channelType !== 'LOCAL_SERVICES')
        const sorted = [...eligible].sort((a, b) => {
          if (a.status === 'Active' && b.status !== 'Active') return -1
          if (b.status === 'Active' && a.status !== 'Active') return 1
          return a.name.localeCompare(b.name)
        })
        setCampaignOptions(sorted)
      })
      .catch(() => { if (!cancelled) setCampaignOptions([]) })
    return () => { cancelled = true }
  }, [customerId])

  useEffect(() => {
    setFilterAdGroupId('')
    if (!customerId || !filterCampaignId) { setAdGroupOptions([]); return }
    let cancelled = false
    setAdGroupsLoading(true)
    window.electronAPI.adGroupList({ customerId, campaignId: filterCampaignId })
      .then(rows => { if (!cancelled) { setAdGroupOptions(rows || []); setAdGroupsLoading(false) } })
      .catch(() => { if (!cancelled) { setAdGroupOptions([]); setAdGroupsLoading(false) } })
    return () => { cancelled = true }
  }, [customerId, filterCampaignId])

  const dateKey = typeof dateRange === 'string' ? dateRange : `${dateRange?.startDate}_${dateRange?.endDate}`

  useEffect(() => {
    if (!customerId || !hasFilter) { setScopedData(null); return }
    let cancelled = false
    setScopedLoading(true)
    window.electronAPI.fetchDashboard({ customerId, dateRange, campaignId: filterCampaignId, adGroupId: filterAdGroupId || undefined })
      .then(r  => { if (!cancelled) { setScopedData(r); setScopedLoading(false) } })
      .catch(() => { if (!cancelled) { setScopedData(null); setScopedLoading(false) } })
    return () => { cancelled = true }
  }, [customerId, dateKey, filterCampaignId, filterAdGroupId])

  useEffect(() => {
    if (!customerId) return
    let cancelled = false
    setKwAnalysis(null)
    setKwAnalysisLoading(true)
    setKwAnalysisError(null)
    window.electronAPI.fetchKeywordAnalysis({ customerId, dateRange, campaignId: filterCampaignId || undefined, adGroupId: filterAdGroupId || undefined })
      .then(r  => { if (!cancelled) { setKwAnalysis(r);               setKwAnalysisLoading(false) } })
      .catch(e => { if (!cancelled) { setKwAnalysisError(e.message || 'Failed to load keyword analysis'); setKwAnalysisLoading(false) } })
    return () => { cancelled = true }
  }, [customerId, dateKey, filterCampaignId, filterAdGroupId])

  useEffect(() => {
    if (!customerId) return
    let cancelled = false
    setStAnalysis(null)
    setStAnalysisLoading(true)
    setStAnalysisError(null)
    window.electronAPI.fetchSearchTermAnalysis({ customerId, dateRange, campaignId: filterCampaignId || undefined, adGroupId: filterAdGroupId || undefined })
      .then(r  => { if (!cancelled) { setStAnalysis(r);               setStAnalysisLoading(false) } })
      .catch(e => { if (!cancelled) { setStAnalysisError(e.message || 'Failed to load search term analysis'); setStAnalysisLoading(false) } })
    return () => { cancelled = true }
  }, [customerId, dateKey, filterCampaignId, filterAdGroupId])

  useEffect(() => {
    if (!customerId) return
    let cancelled = false
    setAdAnalysis(null)
    setAdAnalysisLoading(true)
    setAdAnalysisError(null)
    window.electronAPI.fetchAdPerformanceAnalysis({ customerId, dateRange, campaignId: filterCampaignId || undefined, adGroupId: filterAdGroupId || undefined })
      .then(r  => { if (!cancelled) { setAdAnalysis(r);               setAdAnalysisLoading(false) } })
      .catch(e => { if (!cancelled) { setAdAnalysisError(e.message || 'Failed to load ad analysis'); setAdAnalysisLoading(false) } })
    return () => { cancelled = true }
  }, [customerId, dateKey, filterCampaignId, filterAdGroupId])

  async function generateReview() {
    if (aiLoading) return
    setAiLoading(true)
    setAiError(null)
    try {
      const result = await window.electronAPI.aiAccountReview({ customerId, dashboardData, dateRange })
      setAiReview(result)
    } catch (err) {
      setAiError(err.message === 'NO_API_KEY'
        ? 'Claude API key not configured. Add it in Settings → AI Features.'
        : (err.message || 'AI review failed — please try again.'))
    } finally {
      setAiLoading(false)
    }
  }

  if (!customerId) return (
    <div style={{ padding:60, textAlign:'center', color:'#aaa', fontSize:13 }}>
      Select an account and load the dashboard to view the summary.
    </div>
  )

  const effectiveData    = hasFilter ? scopedData    : dashboardData
  const effectiveLoading = hasFilter ? scopedLoading : loading

  const filterBar = (
    <div className="no-print" style={{ padding:'10px 14px', border:'1px solid #e3eaf5', borderRadius:8, background:'#fafcff', display:'flex', flexWrap:'wrap', alignItems:'flex-end', gap:10 }}>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:10, fontWeight:700, color:'#888', textTransform:'uppercase', letterSpacing:.5 }}>Campaign</label>
        <select value={filterCampaignId} onChange={e => setFilterCampaignId(e.target.value)} style={{ ...selStyle, minWidth:220 }}>
          <option value="">All Campaigns</option>
          {campaignOptions.map(c => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
        </select>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:10, fontWeight:700, color:'#888', textTransform:'uppercase', letterSpacing:.5 }}>
          Ad Group{filterCampaignId ? ` (${adGroupOptions.length})` : ''}
        </label>
        <select
          value={filterAdGroupId}
          onChange={e => setFilterAdGroupId(e.target.value)}
          style={{ ...selStyle, minWidth:220, color: !filterCampaignId || adGroupOptions.length === 0 ? '#aaa' : '#1a3a6b' }}
          disabled={!filterCampaignId || adGroupsLoading || adGroupOptions.length === 0}
        >
          <option value="">All Ad Groups</option>
          {adGroupOptions.map(g => <option key={g.id} value={g.id}>{g.name} ({g.status})</option>)}
        </select>
      </div>
      {hasFilter && (
        <button
          onClick={() => { setFilterCampaignId(''); setFilterAdGroupId('') }}
          style={{ padding:'5px 12px', border:'1px solid #dde9f5', borderRadius:6, fontSize:12, color:'#2563b0', background:'#fff', cursor:'pointer' }}
        >
          Clear filter
        </button>
      )}
    </div>
  )

  if (!effectiveData) return (
    <div style={{ display:'flex', flexDirection:'column', gap:16, maxWidth:1500, width:'100%', margin:'0 auto' }}>
      {filterBar}
      <div style={{ padding:40, textAlign:'center', color:'#aaa', fontSize:13 }}>
        {effectiveLoading ? 'Loading summary…' : 'No data available for this selection.'}
      </div>
    </div>
  )

  const { kpis, previousKpis, dailySeries, dailyCallLeads, campaigns, deviceSplit, budget, spendByType } = effectiveData
  const prev = previousKpis

  // ── Derived metrics ──────────────────────────────────────────────────────
  const healthScore  = calcHealthScore(kpis, campaigns, budget, prev)
  const healthInfo   = healthLabel(healthScore)
  const activeCamps  = (campaigns||[]).filter(c => ['Enabled','Active'].includes(c.status))
  const pausedCamps  = (campaigns||[]).filter(c => c.status === 'Paused')
  const sortedByConv = [...(campaigns||[])].sort((a,b) => b.conversions - a.conversions)
  const sortedByCost = [...(campaigns||[])].sort((a,b) => b.cost - a.cost)
  const bestCamp     = sortedByConv[0]
  const highSpendNoConv = (campaigns||[]).filter(c => c.cost > 50 && c.conversions === 0)
  const limitedBudget   = (budget||[]).filter(b => b.issue === 'Limited by budget')
  const overPacing      = (budget||[]).filter(b => b.issue === 'Overpacing')
  const noActivity      = (budget||[]).filter(b => b.issue === 'No activity' && b.status === 'Enabled')
  const top5Spend = sortedByCost.slice(0,5).map(c => ({ name:c.name.slice(0,30), value:c.cost }))
  const top5Conv  = sortedByConv.slice(0,5).map(c => ({ name:c.name.slice(0,30), value:c.conversions }))

  // ── Issues ───────────────────────────────────────────────────────────────
  const issues = []
  const opps   = []
  const actions = []

  if (kpis.conversions === 0 && kpis.spend > 100) {
    issues.push({ type:'error', text:`No conversions recorded despite $${kpis.spend.toFixed(0)} in spend. Check conversion tracking setup immediately.` })
    actions.push({ priority:'high', text:'Audit conversion tracking — verify tags fire on thank-you/confirmation pages.' })
  }
  if (kpis.ctr < 1 && kpis.impressions > 500) {
    issues.push({ type:'error', text:`Very low CTR of ${kpis.ctr.toFixed(2)}%. Ads are not compelling enough — headlines and CTAs need revision.` })
    actions.push({ priority:'high', text:'Rewrite ad headlines with stronger value propositions and calls to action.' })
  } else if (kpis.ctr < 2.5 && kpis.impressions > 500) {
    issues.push({ type:'warning', text:`Below-average CTR of ${kpis.ctr.toFixed(2)}%. Industry average is 3–5%. Consider improving ad copy and extensions.` })
    actions.push({ priority:'mid', text:'A/B test new headline variants — focus on benefits and urgency.' })
  }
  if (kpis.convRate < 1 && kpis.clicks > 100) {
    issues.push({ type:'warning', text:`Low conversion rate of ${kpis.convRate.toFixed(2)}%. Landing pages may have friction, slow load speed, or weak CTAs.` })
    actions.push({ priority:'mid', text:'Audit landing pages — improve page speed, simplify forms, and align ad-to-page messaging.' })
  }
  if (highSpendNoConv.length > 0) {
    issues.push({ type:'error', text:`${highSpendNoConv.length} campaign(s) spending $50+ with zero conversions: ${highSpendNoConv.slice(0,2).map(c=>c.name).join(', ')}${highSpendNoConv.length>2?'…':''}.` })
    actions.push({ priority:'high', text:`Pause or reduce budgets on zero-conversion campaigns: ${highSpendNoConv.slice(0,2).map(c=>c.name).join(', ')}.` })
  }
  if (limitedBudget.length > 0) {
    issues.push({ type:'warning', text:`${limitedBudget.length} campaign(s) are limited by budget and missing impressions. Consider increasing budgets for top performers.` })
    actions.push({ priority:'mid', text:`Increase daily budget for budget-limited campaigns: ${limitedBudget.slice(0,2).map(b=>b.name).join(', ')}.` })
  }
  if (overPacing.length > 0) {
    issues.push({ type:'warning', text:`${overPacing.length} campaign(s) are overpacing their daily budget. Risk of overspend — review budget caps.` })
    actions.push({ priority:'mid', text:`Review and adjust daily budget caps for overpacing campaigns.` })
  }
  if (noActivity.length > 0) {
    issues.push({ type:'warning', text:`${noActivity.length} enabled campaign(s) have no spend in this period — may have targeting, approval, or payment issues.` })
    actions.push({ priority:'mid', text:`Investigate inactive enabled campaigns — check ad approvals and targeting settings.` })
  }
  if (prev && kpis.cpa > 0 && prev.cpa > 0) {
    const cpaDelta = ((kpis.cpa - prev.cpa) / prev.cpa) * 100
    if (cpaDelta > 25) {
      issues.push({ type:'warning', text:`Cost per conversion increased ${cpaDelta.toFixed(1)}% vs previous period ($${prev.cpa.toFixed(2)} → $${kpis.cpa.toFixed(2)}). Review bid strategies.` })
      actions.push({ priority:'mid', text:'Review bid strategy targets — CPA has risen significantly vs the prior period.' })
    }
  }
  if (pausedCamps.length > activeCamps.length && activeCamps.length > 0) {
    issues.push({ type:'info', text:`More campaigns are paused (${pausedCamps.length}) than active (${activeCamps.length}). Review paused campaigns for reactivation opportunities.` })
  }
  if (kpis.wastedSpend > 0) {
    issues.push({ type:'warning', text:`Estimated wasted spend of ${fmtUsd(kpis.wastedSpend)} on non-converting keywords — adding negative keywords can recover this budget.` })
    actions.push({ priority:'mid', text:`Add negative keywords to recover ~${fmtUsd(kpis.wastedSpend)} in wasted spend.` })
  }

  // ── Opportunities ────────────────────────────────────────────────────────
  if (bestCamp && bestCamp.conversions > 0) {
    const bestCpa = bestCamp.cost / bestCamp.conversions
    opps.push({ type:'success', text:`Scale "${bestCamp.name.slice(0,40)}" — your top converting campaign (${bestCamp.conversions} conv, $${bestCpa.toFixed(2)} CPA). Increasing its budget could drive more results.` })
    actions.push({ priority:'low', text:`Increase budget for top-performing campaign "${bestCamp.name.slice(0,35)}" to scale conversions.` })
  }
  if (limitedBudget.length > 0 && sortedByConv.some(c => limitedBudget.some(b => b.name === c.name) && c.conversions > 0)) {
    opps.push({ type:'success', text:'Budget-limited campaigns are also your top converters — unlocking budget here can directly increase leads/sales.' })
  }
  if (kpis.convRate > 0 && kpis.convRate < 3 && kpis.clicks > 500) {
    opps.push({ type:'info', text:`Conversion rate of ${kpis.convRate.toFixed(2)}% has significant room to improve. CRO improvements on landing pages could double conversions without increasing spend.` })
    actions.push({ priority:'low', text:'Implement CRO improvements — clearer CTAs, trust signals, and mobile UX optimizations on landing pages.' })
  }
  if (prev && prev.conversions > 0) {
    const convGrowth = ((kpis.conversions - prev.conversions) / prev.conversions) * 100
    if (convGrowth > 20) {
      opps.push({ type:'success', text:`Conversions are up ${convGrowth.toFixed(0)}% vs the previous period — momentum is positive. This is a good time to test new campaigns or ad groups.` })
    }
  }
  if (kpis.ctr >= 4) {
    opps.push({ type:'success', text:`Strong CTR of ${kpis.ctr.toFixed(2)}% indicates ad copy is resonating. Focus on improving landing page conversion rate to maximize this traffic quality.` })
  }

  // Positive wins for exec summary
  const wins = []
  if (prev) {
    if (kpis.conversions > prev.conversions * 1.1) wins.push(`Conversions up ${(((kpis.conversions-prev.conversions)/prev.conversions)*100).toFixed(0)}% vs prior period`)
    if (kpis.ctr > prev.ctr * 1.05) wins.push(`CTR improved from ${prev.ctr.toFixed(2)}% to ${kpis.ctr.toFixed(2)}%`)
    if (kpis.cpa > 0 && prev.cpa > kpis.cpa * 1.05) wins.push(`CPA improved from $${prev.cpa.toFixed(2)} to $${kpis.cpa.toFixed(2)}`)
    if (kpis.convRate > prev.convRate * 1.05) wins.push(`Conversion rate up from ${prev.convRate.toFixed(2)}% to ${kpis.convRate.toFixed(2)}%`)
  }
  if (kpis.ctr >= 5) wins.push(`Excellent CTR of ${kpis.ctr.toFixed(2)}% — ads are highly relevant`)
  if (kpis.conversions > 0 && kpis.cpa < 100) wins.push(`Conversions tracked with CPA of ${fmtUsd(kpis.cpa)}`)

  const tblStyle = { width:'100%', borderCollapse:'collapse', fontSize:13 }
  const th = { padding:'8px 12px', background:'#f5f7fa', color:'#1a3a6b', fontWeight:600, fontSize:11, textAlign:'center', borderBottom:'2px solid #dde9f5', textTransform:'uppercase', letterSpacing:.4 }
  const thL = { ...th, textAlign:'left' }
  const td = (align='left') => ({ padding:'9px 12px', borderBottom:'1px solid #f0f4f8', fontSize:13, textAlign:align, color:'#333' })
  const tdN = td('center')

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20, maxWidth:1500, width:'100%', margin:'0 auto' }}>

      {filterBar}

      {hasFilter && (
        <div style={{ fontSize:12, color:'#2563b0', background:'rgba(37,99,176,0.07)', border:'1px solid rgba(37,99,176,0.2)', borderRadius:8, padding:'8px 14px' }}>
          Showing data for {campaignOptions.find(c => c.id === filterCampaignId)?.name || 'selected campaign'}
          {filterAdGroupId ? ` → ${adGroupOptions.find(g => g.id === filterAdGroupId)?.name || 'selected ad group'}` : ' (all ad groups)'}.
          Budget Pacing always reflects the campaign's full budget, and Ad Performance Analysis's Extensions list is account-wide — Google Ads doesn't expose either at the ad-group level.
        </div>
      )}

      {/* ── Export toolbar ───────────────────────────────────────────────── */}
      <div className="no-print" style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
        <button
          onClick={() => setManageSectionsOpen(true)}
          style={{
            display:'inline-flex', alignItems:'center', gap:6,
            padding:'7px 16px', background:'#fff',
            color:'#2563b0', border:'1px solid #2563b0', borderRadius:6,
            fontSize:13, fontWeight:600, cursor:'pointer',
          }}
        >
          <Layers size={14} />
          Manage Sections
        </button>
        <button
          onClick={handleExportHTML}
          disabled={htmlExporting}
          style={{
            display:'inline-flex', alignItems:'center', gap:6,
            padding:'7px 16px', background: htmlExporting ? '#5a8fd4' : '#fff',
            color: htmlExporting ? '#fff' : '#2563b0', border:'1px solid #2563b0', borderRadius:6,
            fontSize:13, fontWeight:600,
            cursor: htmlExporting ? 'wait' : 'pointer',
            transition:'background 0.15s',
          }}
        >
          <FileCode size={14} />
          {htmlExporting ? 'Exporting…' : 'Export HTML'}
        </button>
        <button
          onClick={handleExportPDF}
          disabled={pdfExporting}
          style={{
            display:'inline-flex', alignItems:'center', gap:6,
            padding:'7px 16px', background: pdfExporting ? '#5a8fd4' : '#2563b0',
            color:'#fff', border:'none', borderRadius:6,
            fontSize:13, fontWeight:600,
            cursor: pdfExporting ? 'wait' : 'pointer',
            transition:'background 0.15s',
          }}
        >
          <FileDown size={14} />
          {pdfExporting ? 'Exporting…' : 'Export PDF'}
        </button>
      </div>

      {manageSectionsOpen && (
        <ManageSectionsModal
          visibleSections={visibleSections}
          setVisibleSections={setVisibleSections}
          onClose={() => setManageSectionsOpen(false)}
        />
      )}

      {/* ── 1. Executive Summary ─────────────────────────────────────────── */}
      {isSectionVisible('executiveSummary') && (
      <div className="card">
        <div className="card-header"><span className="card-title">Executive Summary</span></div>
        <div style={{ padding:'16px 20px' }}>

          {/* Health Score */}
          {isSectionVisible('executiveSummary.healthScore') && (
          <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:16 }}>
            <div style={{ background: healthInfo.bg, border:`1px solid ${healthInfo.color}33`, borderRadius:12, padding:'16px 22px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minWidth:130, flexShrink:0 }}>
              <div style={{ fontSize:48, fontWeight:800, color: healthInfo.color, lineHeight:1 }}>{healthScore}</div>
              <div style={{ fontSize:12, fontWeight:700, color: healthInfo.color, marginTop:4 }}>{healthInfo.label}</div>
              <div style={{ fontSize:10, color:'#888', marginTop:2 }}>Account Health Score</div>
            </div>
            {/* Description paragraph */}
            <div style={{ flex:1, background:'#f8fafd', border:'1px solid #e3eaf5', borderRadius:10, padding:'14px 18px', fontSize:13, color:'#333', lineHeight:1.7 }}>
              {(() => {
                const parts = []
                parts.push(`This account generated ${fmtNum(kpis.impressions)} impressions and ${fmtNum(kpis.clicks)} clicks with a CTR of ${kpis.ctr.toFixed(2)}%.`)
                parts.push(`Total spend was ${fmtUsd(kpis.spend)}${kpis.conversions > 0 ? `, delivering ${fmtNum(kpis.conversions)} conversion${kpis.conversions !== 1 ? 's' : ''} at a CPA of ${fmtUsd(kpis.cpa)}` : ' with no conversions recorded'}.`)
                if (kpis.phoneConversions > 0 || kpis.formConversions > 0) {
                  const convParts = []
                  if (kpis.phoneConversions > 0) convParts.push(`${fmtNum(kpis.phoneConversions)} phone call${kpis.phoneConversions !== 1 ? 's' : ''}`)
                  if (kpis.formConversions  > 0) convParts.push(`${fmtNum(kpis.formConversions)} form submission${kpis.formConversions !== 1 ? 's' : ''}`)
                  parts.push(`Conversion breakdown includes ${convParts.join(' and ')}.`)
                }
                if (prev) {
                  const spendDelta = prev.spend > 0 ? ((kpis.spend - prev.spend) / prev.spend * 100) : null
                  const convDelta  = prev.conversions > 0 ? ((kpis.conversions - prev.conversions) / prev.conversions * 100) : null
                  if (spendDelta != null) parts.push(`Compared to the previous period, spend ${spendDelta >= 0 ? 'increased' : 'decreased'} by ${Math.abs(spendDelta).toFixed(1)}%${convDelta != null ? ` and conversions ${convDelta >= 0 ? 'rose' : 'fell'} by ${Math.abs(convDelta).toFixed(1)}%` : ''}.`)
                }
                if (issues.length === 0) parts.push('No critical issues detected — the account is performing within healthy parameters.')
                else parts.push(`${issues.length} issue${issues.length !== 1 ? 's' : ''} identified — see the Issues & Suggestions section below for details.`)
                return parts.join(' ')
              })()}
            </div>
          </div>
          )}

          {/* KPI Cards — same as Dashboard */}
          {isSectionVisible('executiveSummary.kpiCards') && (
          <div style={{ marginBottom:12 }}>
            <KPICards kpis={kpis} previousKpis={prev} />
          </div>
          )}

          {/* Conversion + Spend breakdown boxes */}
          {isSectionVisible('executiveSummary.conversionBreakdown') && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:16 }}>
            {/* Call Leads */}
            <div style={{ background:'rgba(37,99,176,0.08)', border:'1px solid rgba(37,99,176,0.25)', borderRadius:8, padding:'13px 15px' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#2563b0', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:6 }}>Call Leads</div>
              <div style={{ fontSize:22, fontWeight:700, color:'#1a3a6b', lineHeight:1.1, marginBottom:4 }}>📞 {fmtNum(kpis.phoneCalls || 0)}</div>
              <div style={{ fontSize:11, color:'#7a90ab' }}>Phone calls tracked</div>
            </div>
            {/* Phone Conversions */}
            <div style={{ background:'#dde9f5', border:'1px solid #c8d9ed', borderRadius:8, padding:'13px 15px' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:6 }}>Phone Conversions</div>
              <div style={{ fontSize:22, fontWeight:700, color:'#1565c0', lineHeight:1.1, marginBottom:4 }}>
                📞 <BreakdownCell value={kpis.phoneConversions || 0} breakdown={kpis.phoneBreakdown} entityLabel={accountName}
                  modalTitle="Phone Conversions" buttonTitle="View phone conversion breakdown" rowLabel="Conversion Action"
                  align="flex-start" fullWidth={false} valueNode={fmtNum(kpis.phoneConversions || 0)} />
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ fontSize:11, color:'#7a90ab' }}>Qualified calls as Conversion</span>
                <div style={{ position:'relative', display:'inline-flex' }} className="phone-conv-help">
                  <span style={{
                    display:'inline-flex', alignItems:'center', justifyContent:'center',
                    width:14, height:14, borderRadius:'50%', fontSize:9, fontWeight:700,
                    background:'rgba(21,101,192,0.15)', color:'#1565c0', cursor:'default', flexShrink:0,
                  }}>i</span>
                  <div style={{
                    position:'absolute', bottom:'calc(100% + 6px)', left:'50%', transform:'translateX(-50%)',
                    width:260, background:'#1a3a6b', color:'#fff', borderRadius:7, padding:'10px 12px',
                    fontSize:11, lineHeight:1.6, zIndex:999, pointerEvents:'none',
                    boxShadow:'0 4px 16px rgba(0,0,0,0.22)',
                    display:'none',
                  }} className="phone-conv-tooltip">
                    <div style={{ marginBottom:6 }}><strong>Call Leads</strong> — Total phone calls received from ads or tracked numbers.</div>
                    <div style={{ marginBottom:6 }}><strong>Phone Call Conversions</strong> — Calls that met your Google Ads conversion rules (such as minimum call duration).</div>
                    <div style={{ color:'#b3c8f0', fontStyle:'italic' }}>Example: If your conversion rule counts calls longer than 60 seconds, shorter calls will appear as Call Leads but not as Phone Call Conversions.</div>
                  </div>
                </div>
              </div>
            </div>
            {/* Form Submissions */}
            <div style={{ background:'#dde9f5', border:'1px solid #c8d9ed', borderRadius:8, padding:'13px 15px' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:6 }}>Form Submissions</div>
              <div style={{ fontSize:22, fontWeight:700, color:'#2e7d32', lineHeight:1.1, marginBottom:4 }}>
                📝 <BreakdownCell value={kpis.formConversions || 0} breakdown={kpis.formBreakdown} entityLabel={accountName}
                  modalTitle="Form Conversions" buttonTitle="View form conversion breakdown" rowLabel="Conversion Action"
                  align="flex-start" fullWidth={false} valueNode={fmtNum(kpis.formConversions || 0)} />
              </div>
              <div style={{ fontSize:11, color:'#7a90ab' }}>Form submit conversions</div>
            </div>
            {/* Search Spend */}
            <div style={{ background:'#dde9f5', border:'1px solid #c8d9ed', borderRadius:8, padding:'13px 15px' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:6 }}>Search Spend</div>
              <div style={{ fontSize:22, fontWeight:700, color:'#1a3a6b', lineHeight:1.1, marginBottom:4 }}>{fmtUsd(spendByType?.search || 0)}</div>
              <div style={{ fontSize:11, color:'#7a90ab' }}>Total spend from Search campaigns</div>
            </div>
            {/* PMax Spend */}
            <div style={{ background:'#dde9f5', border:'1px solid #c8d9ed', borderRadius:8, padding:'13px 15px' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:6 }}>PMax Spend</div>
              <div style={{ fontSize:22, fontWeight:700, color:'#1a3a6b', lineHeight:1.1, marginBottom:4 }}>{fmtUsd(spendByType?.pmax || 0)}</div>
              <div style={{ fontSize:11, color:'#7a90ab' }}>Total spend from Performance Max campaigns</div>
            </div>
          </div>
          )}

          {/* Best campaign / top concern */}
          {isSectionVisible('executiveSummary.bestCampaign') && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:16 }}>
            <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'10px 14px' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#2e7d32', textTransform:'uppercase', letterSpacing:.5, marginBottom:4 }}>Best Campaign</div>
              <div style={{ fontSize:12, fontWeight:600, color:'#1a3a6b' }}>{bestCamp ? bestCamp.name.slice(0,40) : '—'}</div>
              {bestCamp && <div style={{ fontSize:11, color:'#555', marginTop:2 }}>{bestCamp.conversions} conv · {fmtUsd(bestCamp.cost)}</div>}
            </div>
            <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8, padding:'10px 14px' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#c2410c', textTransform:'uppercase', letterSpacing:.5, marginBottom:4 }}>Biggest Concern</div>
              <div style={{ fontSize:12, fontWeight:600, color:'#1a3a6b' }}>
                {highSpendNoConv.length > 0 ? `${highSpendNoConv.length} campaign(s) spending with 0 conv.`
                  : limitedBudget.length > 0 ? `${limitedBudget.length} budget-limited campaign(s)`
                  : issues.length > 0        ? 'See Issues section below'
                  : 'No critical issues found'}
              </div>
            </div>
            <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'10px 14px' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#1d4ed8', textTransform:'uppercase', letterSpacing:.5, marginBottom:4 }}>Account Structure</div>
              <div style={{ fontSize:12, color:'#333' }}>{(campaigns||[]).length} campaigns ({activeCamps.length} active, {pausedCamps.length} paused)</div>
            </div>
          </div>
          )}

          {/* Wins */}
          {wins.length > 0 && isSectionVisible('executiveSummary.majorWins') && (
            <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'10px 14px', marginBottom:10 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#2e7d32', marginBottom:6, textTransform:'uppercase', letterSpacing:.5 }}>Major Wins</div>
              {wins.map((w,i) => <div key={i} style={{ fontSize:12, color:'#166534', marginBottom:3 }}>✓ {w}</div>)}
            </div>
          )}
        </div>
      </div>
      )}{/* end Executive Summary card */}

      {/* ── 2. Performance Comparison + Device Pie ──────────────────────── */}
      {prev && isSectionVisible('performanceComparison') && (
        <div style={{ display:'flex', gap:16, alignItems:'flex-start' }}>
          {/* Performance Comparison table */}
          {isSectionVisible('performanceComparison.table') && (
          <div style={{ flex:'0 0 50%' }}>
            <Section title="Performance Comparison — Current vs Previous Period">
              <div style={{ overflowX:'auto' }}>
                <table style={tblStyle}>
                  <thead>
                    <tr>
                      {['Metric','Current Period','Previous Period','Change'].map((h,i) => <th key={h} style={i===0 ? thL : th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label:'Spend',           cur:fmtUsd(kpis.spend),             pv:fmtUsd(prev.spend),               curV:kpis.spend,       pvV:prev.spend,       inv:true },
                      { label:'Clicks',          cur:fmtNum(kpis.clicks),            pv:fmtNum(prev.clicks),              curV:kpis.clicks,      pvV:prev.clicks },
                      { label:'Impressions',     cur:fmtNum(kpis.impressions),       pv:fmtNum(prev.impressions),         curV:kpis.impressions, pvV:prev.impressions },
                      { label:'CTR',             cur:kpis.ctr.toFixed(2)+'%',        pv:prev.ctr.toFixed(2)+'%',          curV:kpis.ctr,         pvV:prev.ctr },
                      { label:'Avg CPC',         cur:fmtCpc(kpis.avgCpc||(kpis.spend/Math.max(kpis.clicks,1))), pv:fmtCpc(prev.avgCpc||(prev.spend/Math.max(prev.clicks,1))), curV:kpis.avgCpc||0, pvV:prev.avgCpc||0, inv:true },
                      { label:'Conversions',     cur:fmtNum(kpis.conversions),       pv:fmtNum(prev.conversions),         curV:kpis.conversions, pvV:prev.conversions },
                      { label:'Cost / Conv.',    cur:kpis.cpa>0?fmtUsd(kpis.cpa):'—', pv:prev.cpa>0?fmtUsd(prev.cpa):'—', curV:kpis.cpa,       pvV:prev.cpa,         inv:true },
                      { label:'Conv. Rate',      cur:kpis.convRate.toFixed(2)+'%',   pv:prev.convRate.toFixed(2)+'%',     curV:kpis.convRate,    pvV:prev.convRate },
                    ].map(r => (
                      <tr key={r.label} style={{ background:'#fff' }}>
                        <td style={{ ...td(), fontWeight:600, color:'#1a3a6b' }}>{r.label}</td>
                        <td style={tdN}>{r.cur}</td>
                        <td style={{ ...tdN, color:'#888' }}>{r.pv}</td>
                        <td style={tdN}><SumChange cur={r.curV} prev={r.pvV} invertColor={r.inv} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
          )}

          {/* Device Performance pie chart */}
          {(deviceSplit||[]).length > 0 && isSectionVisible('performanceComparison.devicePie') && (() => {
            const DEV_COLORS = { Mobile:'#2563b0', Desktop:'#4caf50', Tablet:'#f0b429', Other:'#aaa' }
            const pieData = deviceSplit.map(d => ({
              name: d.device,
              value: d.clicks || 0,
              color: DEV_COLORS[d.device] || '#888',
            })).filter(d => d.value > 0)
            const totalClicks = pieData.reduce((s, d) => s + d.value, 0)
            return (
              <div style={{ flex:1 }}>
                <div className="card">
                  <div className="card-header"><span className="card-title">Device Performance</span></div>
                  <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
                    <PieChart width={200} height={200}>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50}>
                        {pieData.map(d => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(v, name) => [`${((v/totalClicks)*100).toFixed(1)}% (${v.toLocaleString()} clicks)`, name]} />
                    </PieChart>
                    <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:6 }}>
                      {pieData.map(d => (
                        <div key={d.name} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:12 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                            <span style={{ width:10, height:10, borderRadius:'50%', background:d.color, display:'inline-block', flexShrink:0 }}/>
                            <span style={{ color:'#333', fontWeight:500 }}>{d.name}</span>
                          </div>
                          <span style={{ color:'#1a3a6b', fontWeight:600 }}>
                            {((d.value/totalClicks)*100).toFixed(1)}%
                            <span style={{ color:'#888', fontWeight:400, marginLeft:6 }}>({d.value.toLocaleString()})</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── 3. Daily Trend ───────────────────────────────────────────────── */}
      {(dailySeries||[]).length > 0 && isSectionVisible('dailyTrend') && (
        <Section title="Daily Performance Trend">
          <div className="card-body">
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={dailySeries} margin={{ top:4, right:16, bottom:0, left:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="date" tick={{ fontSize:10, fill:'#888' }} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
                <YAxis yAxisId="l" tick={{ fontSize:10, fill:'#888' }} axisLine={false} tickLine={false} width={36} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize:10, fill:'#888' }} axisLine={false} tickLine={false} width={28}/>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize:11 }}/>
                <Line yAxisId="l" type="monotone" dataKey="clicks"      name="Clicks"      stroke="#2563b0" strokeWidth={2} dot={false}/>
                <Line yAxisId="r" type="monotone" dataKey="conversions" name="Conversions" stroke="#4caf50" strokeWidth={2} dot={false} strokeDasharray="5 4"/>
                <Line yAxisId="l" type="monotone" dataKey="impressions" name="Impressions" stroke="#9e9e9e" strokeWidth={1} dot={false} strokeDasharray="3 3"/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {/* ── 3b. Call Leads by Day ───────────────────────────────────────── */}
      {(dailyCallLeads||[]).length > 0 && isSectionVisible('callLeads') && (
        <Section title="Call Leads">
          <div className="card-body">
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={dailyCallLeads} margin={{ top:4, right:16, bottom:0, left:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="date" tick={{ fontSize:10, fill:'#888' }} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
                <YAxis tick={{ fontSize:10, fill:'#888' }} axisLine={false} tickLine={false} width={28} allowDecimals={false}/>
                <Tooltip formatter={v => [fmtNum(v), 'Call Leads']}/>
                <Bar dataKey="calls" name="Call Leads" fill="#2563b0" radius={[3,3,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {/* ── 4. Campaign Performance Breakdown ───────────────────────────── */}
      {(campaigns||[]).length > 0 && isSectionVisible('campaignBreakdown') && (() => {
        const campaignRows = [...campaigns].sort((a,b)=>b.cost-a.cost).map((c,i) => ({
          ...c,
          ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
          cpa: c.conversions > 0 ? c.cost / c.conversions : null,
          isTop: i === 0,
          isWasted: c.cost > 50 && c.conversions === 0,
        }))
        const campaignCsvRows = campaignRows.map(c => ({
          'Campaign':    c.name,
          'Status':      c.status,
          'Spend':       fmtUsd(c.cost),
          'Clicks':      fmtNum(c.clicks),
          'Impressions': fmtNum(c.impressions),
          'CTR':         c.ctr.toFixed(2) + '%',
          'Avg CPC':     fmtCpc(c.cpc),
          'Conv.':       c.conversions > 0 ? fmtNum(c.conversions) : '—',
          'CPA':         c.cpa ? fmtUsd(c.cpa) : '—',
        }))
        return (
        <Section title="Campaign Performance Breakdown" extra={
          <div style={{ display:'flex', gap:8 }}>
            <ExportButton data={campaignCsvRows} filename="campaign-performance-breakdown" />
            <ExportPdfButton accountName={accountName} section="Campaign Performance Breakdown" />
          </div>
        }>
          <ReportTable
            pagination defaultPageSize={25}
            emptyMessage="No campaign data available"
            columns={[
              { key: 'name', label: 'Campaign', sortable: true, align: 'left',
                format: (v, row) => (
                  <span>
                    <span>{v}</span>
                    {row.isTop    && <span style={{ fontSize:9, background:'#e8f5e9', color:'#2e7d32', borderRadius:99, padding:'1px 6px', fontWeight:700, marginLeft:6 }}>TOP</span>}
                    {row.isWasted && <span style={{ fontSize:9, background:'#fdecea', color:'#c0392b', borderRadius:99, padding:'1px 6px', fontWeight:700, marginLeft:2 }}>WASTED</span>}
                  </span>
                ) },
              { key: 'status', label: 'Status', sortable: true, align: 'center', format: v => <StatusBadge value={v}/> },
              { key: 'cost', label: 'Spend', sortable: true, align: 'right', format: v => fmtUsd(v) },
              { key: 'clicks', label: 'Clicks', sortable: true, align: 'right', format: v => fmtNum(v) },
              { key: 'impressions', label: 'Impressions', sortable: true, align: 'right', format: v => fmtNum(v) },
              { key: 'ctr', label: 'CTR', sortable: true, align: 'right', format: v => v.toFixed(2) + '%' },
              { key: 'cpc', label: 'Avg CPC', sortable: true, align: 'right', format: v => fmtCpc(v) },
              { key: 'conversions', label: 'Conv.', sortable: true, align: 'right',
                format: v => <span style={{ color: v > 0 ? '#2e7d32' : '#aaa', fontWeight: v>0?700:400 }}>{v > 0 ? fmtNum(v) : '—'}</span> },
              { key: 'cpa', label: 'CPA', sortable: true, align: 'right', format: v => v ? fmtUsd(v) : '—' },
            ]}
            data={campaignRows}
          />
        </Section>
        )
      })()}

      {/* ── 5. Top Campaigns Charts ──────────────────────────────────────── */}
      {(top5Spend.length > 0 || top5Conv.length > 0) && isSectionVisible('topCampaigns') && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
          {top5Spend.length > 0 && isSectionVisible('topCampaigns.bySpend') && (
            <Section title="Top Campaigns by Spend">
              <div className="card-body">
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={top5Spend} layout="vertical" margin={{ left:8, right:12 }}>
                    <XAxis type="number" tick={{ fontSize:10, fill:'#888' }} axisLine={false} tickLine={false} tickFormatter={v=>'$'+v.toFixed(0)}/>
                    <YAxis type="category" dataKey="name" width={140} tick={{ fontSize:10, fill:'#1a3a6b' }} axisLine={false} tickLine={false}/>
                    <Tooltip formatter={v => fmtUsd(v)}/>
                    <Bar dataKey="value" name="Spend" fill="#1a3a6b" radius={[0,3,3,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          )}
          {top5Conv.filter(c=>c.value>0).length > 0 && isSectionVisible('topCampaigns.byConversions') && (
            <Section title="Top Campaigns by Conversions">
              <div className="card-body">
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={top5Conv.filter(c=>c.value>0)} layout="vertical" margin={{ left:8, right:12 }}>
                    <XAxis type="number" tick={{ fontSize:10, fill:'#888' }} axisLine={false} tickLine={false}/>
                    <YAxis type="category" dataKey="name" width={140} tick={{ fontSize:10, fill:'#1a3a6b' }} axisLine={false} tickLine={false}/>
                    <Tooltip/>
                    <Bar dataKey="value" name="Conversions" fill="#4caf50" radius={[0,3,3,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          )}
        </div>
      )}

      {/* ── 6. Budget Health ─────────────────────────────────────────────── */}
      {(budget||[]).length > 0 && isSectionVisible('budgetHealth') && (() => {
        const budgetCsvRows = budget.map(b => ({
          'Campaign':      b.name,
          'Status':        b.status,
          'Daily Budget':  b.budget > 0 ? fmtUsd(b.budget) : '—',
          'Daily Spend':   fmtUsd(b.spend),
          'Utilization':   b.utilization.toFixed(0) + '%',
          'Health':        b.issue || 'Healthy',
        }))
        return (
        <Section title="Budget Health" extra={
          <div style={{ display:'flex', gap:8 }}>
            <ExportButton data={budgetCsvRows} filename="budget-health" />
            <ExportPdfButton accountName={accountName} section="Budget Health" />
          </div>
        }>
          <ReportTable
            pagination defaultPageSize={25}
            emptyMessage="No budget data available"
            columns={[
              { key: 'name', label: 'Campaign', sortable: true, align: 'left' },
              { key: 'status', label: 'Status', sortable: true, align: 'center', format: v => <StatusBadge value={v}/> },
              { key: 'budget', label: 'Daily Budget', sortable: true, align: 'right', format: v => v > 0 ? fmtUsd(v) : '—' },
              { key: 'spend', label: 'Daily Spend', sortable: true, align: 'right', format: v => fmtUsd(v) },
              { key: 'utilization', label: 'Utilization', sortable: true, align: 'center',
                format: v => {
                  const pct = Math.min(v, 150)
                  const barColor = v > 120 ? '#c0392b' : v > 95 ? '#f0b429' : v > 60 ? '#4caf50' : '#2563b0'
                  return (
                    <div style={{ display:'flex', alignItems:'center', gap:6, justifyContent:'center' }}>
                      <div style={{ width:80, height:6, background:'#f0f4f8', borderRadius:3, overflow:'hidden' }}>
                        <div style={{ width:`${pct}%`, height:'100%', background:barColor, borderRadius:3 }}/>
                      </div>
                      <span style={{ fontSize:11, color:barColor, fontWeight:600, minWidth:36 }}>{v.toFixed(0)}%</span>
                    </div>
                  )
                } },
              { key: 'issue', label: 'Health', sortable: true, align: 'center',
                format: v => v
                  ? <span style={{ fontSize:11, fontWeight:600, color: v==='Limited by budget'?'#f0b429' : v==='Overpacing'?'#c0392b':'#888' }}>{v}</span>
                  : <span style={{ fontSize:11, color:'#2e7d32', fontWeight:600 }}>Healthy</span> },
            ]}
            data={budget}
          />
        </Section>
        )
      })()}


      {/* ── 7. Keyword Analysis ─────────────────────────────────────────── */}
      {isSectionVisible('keywordAnalysis') && (
      <div className="card">
        <div className="card-header"><span className="card-title">Keyword Analysis</span></div>
        <div style={{ padding:'16px 20px' }}>
          {kwAnalysisLoading && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:12, padding:'40px 0', color:'#555' }}>
              <div style={{ width:22, height:22, border:'3px solid #dde9f5', borderTopColor:'#1a3a6b', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
              <span style={{ fontSize:13 }}>Loading keyword analysis…</span>
            </div>
          )}
          {kwAnalysisError && !kwAnalysisLoading && (
            <div style={{ padding:'12px 0', color:'#c0392b', fontSize:12 }}>{kwAnalysisError}</div>
          )}
          {kwAnalysis && !kwAnalysisLoading && (() => {
            const { topByConv, topByLowCpa, topByCtr, topByConvRate, highSpendNoConv, lowQsKws, expensiveCpc, lowCtrKws, mtStats, wastedByMatchType, totalKeywords, withConvCount, avgQs, highSpendNoConvCount } = kwAnalysis
            const truncKw = (t, maxLen=35) => t && t.length > maxLen ? t.slice(0, maxLen) + '…' : (t || '—')
            const subHeadStyle = { fontSize:12, fontWeight:700, marginBottom:8, display:'flex', alignItems:'center', gap:6 }
            const totalWastedBroadPhrase = (wastedByMatchType.Broad||0) + (wastedByMatchType.Phrase||0)
            const broadPhrasePoorKws = (highSpendNoConv||[]).filter(k => k.matchType === 'Broad' || k.matchType === 'Phrase').slice(0, 3)
            return (
              <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

                {/* Summary KPI boxes */}
                {isSectionVisible('keywordAnalysis.summaryBoxes') && (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
                  {[
                    { label:'Total Keywords',       value: fmtNum(totalKeywords),    sub:'active in period' },
                    { label:'With Conversions',     value: fmtNum(withConvCount),    sub:`${totalKeywords > 0 ? ((withConvCount/totalKeywords)*100).toFixed(0) : 0}% of total`, color:'#2e7d32' },
                    { label:'Avg. Quality Score',   value: avgQs > 0 ? avgQs.toFixed(1)+'/10' : '—', sub:'across all keywords', color: avgQs >= 7 ? '#2e7d32' : avgQs >= 5 ? '#a56700' : '#c0392b' },
                    { label:'High Spend, No Conv.', value: fmtNum(highSpendNoConvCount), sub:'keywords needing review', color: highSpendNoConvCount > 0 ? '#c0392b' : '#2e7d32' },
                  ].map(({ label, value, sub, color }) => (
                    <div key={label} style={{ background:'#dde9f5', border:'1px solid #c8d9ed', borderRadius:8, padding:'12px 14px' }}>
                      <div style={{ fontSize:11, fontWeight:600, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:4 }}>{label}</div>
                      <div style={{ fontSize:20, fontWeight:700, color: color||'#1a3a6b', lineHeight:1.2 }}>{value}</div>
                      <div style={{ fontSize:11, color:'#7a90ab' }}>{sub}</div>
                    </div>
                  ))}
                </div>
                )}

                {/* Top Performing Keywords */}
                {isSectionVisible('keywordAnalysis.topPerforming') && (
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#2e7d32', marginBottom:12, paddingBottom:6, borderBottom:'2px solid #e8f5e9' }}>Top Performing Keywords</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                    <div>
                      <div style={{ ...subHeadStyle, color:'#2e7d32' }}>🏆 Highest Conversions</div>
                      <KwMiniTable rows={topByConv} cols={[
                        { key:'text',        label:'Keyword',  format:(v) => <span title={v}>{truncKw(v)}</span> },
                        { key:'matchType',   label:'Type',     format:(v) => <MatchTypePill mt={v} /> },
                        { key:'conversions', label:'Conv.',    right:true, format:fmtNum },
                        { key:'cost',        label:'CPA',      right:true, format:(_,r) => r.conversions > 0 ? fmtCpc(r.cost/r.conversions) : '—' },
                      ]} />
                    </div>
                    <div>
                      <div style={{ ...subHeadStyle, color:'#1565c0' }}>💰 Lowest CPA</div>
                      <KwMiniTable rows={topByLowCpa} cols={[
                        { key:'text',        label:'Keyword',  format:(v) => <span title={v}>{truncKw(v)}</span> },
                        { key:'matchType',   label:'Type',     format:(v) => <MatchTypePill mt={v} /> },
                        { key:'cpa',         label:'CPA',      right:true, format:fmtCpc },
                        { key:'conversions', label:'Conv.',    right:true, format:fmtNum },
                      ]} />
                    </div>
                    <div>
                      <div style={{ ...subHeadStyle, color:'#1a3a6b' }}>📈 Highest CTR</div>
                      <KwMiniTable rows={topByCtr} cols={[
                        { key:'text',      label:'Keyword', format:(v) => <span title={v}>{truncKw(v)}</span> },
                        { key:'matchType', label:'Type',    format:(v) => <MatchTypePill mt={v} /> },
                        { key:'ctr',       label:'CTR',     right:true, format:fmtPct },
                        { key:'clicks',    label:'Clicks',  right:true, format:fmtNum },
                      ]} />
                    </div>
                    <div>
                      <div style={{ ...subHeadStyle, color:'#a56700' }}>⭐ Best Conv. Rate</div>
                      <KwMiniTable rows={topByConvRate} cols={[
                        { key:'text',        label:'Keyword',    format:(v) => <span title={v}>{truncKw(v)}</span> },
                        { key:'matchType',   label:'Type',       format:(v) => <MatchTypePill mt={v} /> },
                        { key:'cr',          label:'Conv. Rate', right:true, format:fmtPct },
                        { key:'conversions', label:'Conv.',      right:true, format:fmtNum },
                      ]} />
                    </div>
                  </div>
                </div>
                )}

                {/* Poor Performing Keywords */}
                {isSectionVisible('keywordAnalysis.poorPerforming') && (
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#c0392b', marginBottom:12, paddingBottom:6, borderBottom:'2px solid #fdecea' }}>Poor Performing Keywords</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                    <div>
                      <div style={{ ...subHeadStyle, color:'#c0392b' }}>⚠️ High Spend + No Conversions</div>
                      <KwMiniTable rows={highSpendNoConv} cols={[
                        { key:'text',      label:'Keyword', format:(v) => <span title={v}>{truncKw(v)}</span> },
                        { key:'matchType', label:'Type',    format:(v) => <MatchTypePill mt={v} /> },
                        { key:'cost',      label:'Spend',   right:true, format:fmtUsd, colorFn:() => '#c0392b' },
                        { key:'clicks',    label:'Clicks',  right:true, format:fmtNum },
                      ]} />
                    </div>
                    <div>
                      <div style={{ ...subHeadStyle, color:'#e05c2a' }}>🔴 Low Quality Score (≤ 5)</div>
                      <KwMiniTable rows={lowQsKws} cols={[
                        { key:'text',         label:'Keyword', format:(v) => <span title={v}>{truncKw(v)}</span> },
                        { key:'matchType',    label:'Type',    format:(v) => <MatchTypePill mt={v} /> },
                        { key:'qualityScore', label:'QS',      right:true, format:(v) => <QsBadge qs={v} /> },
                        { key:'cost',         label:'Spend',   right:true, format:fmtUsd },
                      ]} />
                    </div>
                    <div>
                      <div style={{ ...subHeadStyle, color:'#a56700' }}>💸 Expensive CPC Keywords</div>
                      <KwMiniTable rows={expensiveCpc} cols={[
                        { key:'text',      label:'Keyword',  format:(v) => <span title={v}>{truncKw(v)}</span> },
                        { key:'matchType', label:'Type',     format:(v) => <MatchTypePill mt={v} /> },
                        { key:'cpc',       label:'Avg CPC',  right:true, format:fmtCpc, colorFn:(v) => v > 10 ? '#c0392b' : v > 5 ? '#a56700' : '#333' },
                        { key:'clicks',    label:'Clicks',   right:true, format:fmtNum },
                      ]} />
                    </div>
                    <div>
                      <div style={{ ...subHeadStyle, color:'#888' }}>📉 Low CTR Keywords</div>
                      <KwMiniTable rows={lowCtrKws} cols={[
                        { key:'text',        label:'Keyword', format:(v) => <span title={v}>{truncKw(v)}</span> },
                        { key:'matchType',   label:'Type',    format:(v) => <MatchTypePill mt={v} /> },
                        { key:'ctr',         label:'CTR',     right:true, format:fmtPct, colorFn:() => '#c0392b' },
                        { key:'impressions', label:'Impr.',   right:true, format:fmtNum },
                      ]} />
                    </div>
                  </div>
                </div>
                )}

                {/* Match Type Analysis */}
                {isSectionVisible('keywordAnalysis.matchTypeAnalysis') && (
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#1a3a6b', marginBottom:12, paddingBottom:6, borderBottom:'2px solid #dde9f5' }}>Match Type Analysis</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:14 }}>
                    {[
                      { mt:'Broad',  label:'Broad Match',  desc:'Widest reach — shows for related searches. Lowest precision, highest risk of irrelevant traffic.',  color:'#1565c0', bg:'#e3f2fd', border:'#bbdefb' },
                      { mt:'Phrase', label:'Phrase Match', desc:'Balanced — shows when search contains your phrase. Good mix of reach and relevance.',                color:'#a56700', bg:'#fff8e1', border:'#ffe082' },
                      { mt:'Exact',  label:'Exact Match',  desc:'Highest precision — shows for exact keyword or close variants only. Best search term relevance.',    color:'#2e7d32', bg:'#e8f5e9', border:'#a5d6a7' },
                    ].map(({ mt, label, desc, color, bg, border }) => {
                      const s      = (mtStats||{})[mt] || { count:0, cost:0, conv:0, clicks:0, impr:0 }
                      const ctr    = s.impr > 0 ? (s.clicks / s.impr * 100) : 0
                      const cpa    = s.conv > 0 ? s.cost / s.conv : 0
                      const wasted = (wastedByMatchType||{})[mt] || 0
                      return (
                        <div key={mt} style={{ background:bg, border:`1px solid ${border}`, borderRadius:10, padding:'14px 16px' }}>
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                            <span style={{ fontSize:14, fontWeight:700, color }}>{label}</span>
                            <span style={{ fontSize:11, fontWeight:600, color, background:'#fff', borderRadius:99, padding:'2px 8px', border:`1px solid ${border}` }}>{fmtNum(s.count)} kw</span>
                          </div>
                          <div style={{ fontSize:11, color:'#555', lineHeight:1.5, marginBottom:10 }}>{desc}</div>
                          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                            {[
                              ['Spend', fmtUsd(s.cost)],
                              ['Conv.',  fmtNum(s.conv)],
                              ['CTR',   s.impr > 0 ? fmtPct(ctr) : '—'],
                              ['CPA',   cpa > 0 ? fmtCpc(cpa) : '—'],
                            ].map(([lbl, val]) => (
                              <div key={lbl}>
                                <div style={{ fontSize:10, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:.4 }}>{lbl}</div>
                                <div style={{ fontSize:13, fontWeight:700, color }}>{val}</div>
                              </div>
                            ))}
                          </div>
                          {wasted > 0 && (
                            <div style={{ marginTop:10, padding:'5px 8px', background:'rgba(192,57,43,0.08)', borderRadius:6, fontSize:11 }}>
                              <span style={{ fontWeight:600, color:'#c0392b' }}>Wasted: {fmtUsd(wasted)}</span>
                              <span style={{ color:'#888', marginLeft:4 }}>(0 conv keywords)</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {totalWastedBroadPhrase > 0 && (
                    <div style={{ background:'#fff8e1', border:'1px solid #ffe082', borderRadius:8, padding:'12px 16px' }}>
                      <div style={{ fontSize:12, fontWeight:700, color:'#a56700', marginBottom:6 }}>Missing Negative Keywords Insight</div>
                      <div style={{ fontSize:12, color:'#555', lineHeight:1.7 }}>
                        {fmtUsd(totalWastedBroadPhrase)} in wasted spend detected across Broad and Phrase match keywords with zero conversions.
                        {broadPhrasePoorKws.length > 0 && (
                          <> Top wasted keywords — {broadPhrasePoorKws.map(k => `"${truncKw(k.text, 30)}"`).join(', ')} — are likely
                          triggering irrelevant search terms. Review their search term reports and add missing negatives.</>
                        )}
                      </div>
                      <div style={{ fontSize:11, color:'#a56700', marginTop:6, fontWeight:500 }}>
                        Tip: Use the Keywords page → Search Terms tab to identify irrelevant queries triggering these keywords.
                      </div>
                    </div>
                  )}
                </div>
                )}

              </div>
            )
          })()}
        </div>
      </div>
      )}

      {/* ── 8. Search Terms Analysis ─────────────────────────────────────── */}
      {isSectionVisible('searchTermsAnalysis') && (
      <div className="card" style={{ marginBottom:24 }}>
        <div className="card-header"><span className="card-title">Search Terms Analysis</span></div>
        <div style={{ padding:'16px' }}>
          {stAnalysisLoading && (
            <div style={{ padding:'20px 0', textAlign:'center', color:'#2563b0', fontSize:13 }}>
              Loading search term analysis…
            </div>
          )}
          {stAnalysisError && !stAnalysisLoading && (
            <div style={{ padding:'12px 0', color:'#c0392b', fontSize:12 }}>{stAnalysisError}</div>
          )}
          {stAnalysis && !stAnalysisLoading && (() => {
            const { overview, highIntent, wastedSpend, recommendations } = stAnalysis
            const stCols = [
              { key:'term',        label:'Search Term', format:(v)=><span style={{fontWeight:500,color:'#1a3a6b',fontSize:11}}>{v}</span> },
              { key:'cost',        label:'Spend',       right:true, format:v=>fmtUsd(v) },
              { key:'clicks',      label:'Clicks',      right:true, format:v=>fmtNum(v) },
              { key:'conversions', label:'Conv.',        right:true, format:v=>fmtNum(v) },
              { key:'cpa',         label:'CPA',         right:true, format:(v,row)=> row.conversions > 0 ? fmtCpc(v) : '—' },
            ]
            const negCols = [
              { key:'term',  label:'Search Term', format:(v)=><span style={{fontWeight:500,color:'#c0392b',fontSize:11}}>{v}</span> },
              { key:'cost',  label:'Wasted Spend', right:true, format:v=>fmtUsd(v) },
              { key:'clicks',label:'Clicks',       right:true, format:v=>fmtNum(v) },
              { key:'ctr',   label:'CTR',           right:true, format:v=>fmtPct(v) },
            ]
            const emCols = [
              { key:'term',        label:'Search Term', format:(v)=><span style={{fontWeight:500,color:'#2e7d32',fontSize:11}}>{v}</span> },
              { key:'conversions', label:'Conv.',        right:true, format:v=>fmtNum(v) },
              { key:'cost',        label:'Spend',        right:true, format:v=>fmtUsd(v) },
              { key:'ctr',         label:'CTR',           right:true, format:v=>fmtPct(v) },
            ]
            return (
              <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

                {/* Overview KPIs */}
                {isSectionVisible('searchTermsAnalysis.overview') && (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
                  {[
                    { label:'Total Search Terms', value: fmtNum(overview.totalCount),       color:'#1a3a6b' },
                    { label:'Converting Terms',   value: fmtNum(overview.convertingCount),  color:'#2e7d32' },
                    { label:'Wasted Spend Terms', value: fmtNum(overview.wastedCount),      color:'#c0392b' },
                    { label:'Total Wasted Spend', value: fmtUsd(overview.totalWasted),      color:'#e05c2a' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background:'#f5f7fa', border:'1px solid #e8eef7', borderRadius:8, padding:'12px 14px' }}>
                      <div style={{ fontSize:10, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:.4, marginBottom:4 }}>{label}</div>
                      <div style={{ fontSize:20, fontWeight:700, color }}>{value}</div>
                    </div>
                  ))}
                </div>
                )}

                {/* High Intent */}
                {isSectionVisible('searchTermsAnalysis.highIntent') && (
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#2e7d32', marginBottom:10, display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ background:'#e8f5e9', border:'1px solid #c8e6c9', borderRadius:6, padding:'2px 10px' }}>High Intent Search Terms</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:'#2e7d32', marginBottom:6, textTransform:'uppercase', letterSpacing:.4 }}>Driving Conversions</div>
                      <KwMiniTable rows={highIntent.drivingConversions} cols={stCols} />
                    </div>
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:'#1565c0', marginBottom:6, textTransform:'uppercase', letterSpacing:.4 }}>New Keyword Opportunities (not yet added)</div>
                      <KwMiniTable rows={highIntent.newKwOpportunities} cols={stCols} />
                    </div>
                  </div>
                </div>
                )}

                {/* Wasted Spend */}
                {isSectionVisible('searchTermsAnalysis.wastedSpend') && (
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#c0392b', marginBottom:10, display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ background:'#fdecea', border:'1px solid #ffcdd2', borderRadius:6, padding:'2px 10px' }}>Wasted Spend Search Terms</span>
                    <span style={{ fontSize:11, color:'#888' }}>(0 conversions)</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                    {[
                      { key:'irrelevantTraffic',  label:'Irrelevant Traffic',    color:'#b71c1c', bg:'#fff5f5' },
                      { key:'informational',       label:'Informational Searches', color:'#e65100', bg:'#fff8f0' },
                      { key:'competitorLeakage',   label:'Competitor Leakage',    color:'#6a1b9a', bg:'#f9f0ff' },
                      { key:'lowIntentQueries',    label:'Low Intent Queries',    color:'#c0392b', bg:'#fdf5e4' },
                    ].map(({ key, label, color, bg }) => (
                      <div key={key} style={{ background:bg, border:`1px solid ${color}22`, borderRadius:8, padding:'12px' }}>
                        <div style={{ fontSize:11, fontWeight:700, color, textTransform:'uppercase', letterSpacing:.4, marginBottom:8 }}>{label}</div>
                        <KwMiniTable rows={wastedSpend[key]} cols={negCols} />
                      </div>
                    ))}
                  </div>
                </div>
                )}

                {/* Suggestions */}
                {isSectionVisible('searchTermsAnalysis.suggestions') && (
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#1a3a6b', marginBottom:10 }}>Suggestions</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                    <div style={{ background:'#fdecea', border:'1px solid #ffcdd2', borderRadius:8, padding:'12px' }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'#c0392b', textTransform:'uppercase', letterSpacing:.4, marginBottom:6 }}>Add as Negative Keywords</div>
                      <div style={{ fontSize:11, color:'#666', marginBottom:8 }}>High spend, zero conversions — block these search terms.</div>
                      <KwMiniTable rows={recommendations.negatives} cols={negCols} />
                    </div>
                    <div style={{ background:'#e8f5e9', border:'1px solid #c8e6c9', borderRadius:8, padding:'12px' }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'#2e7d32', textTransform:'uppercase', letterSpacing:.4, marginBottom:6 }}>Add as Exact Match Keywords</div>
                      <div style={{ fontSize:11, color:'#666', marginBottom:8 }}>Converting terms not yet added as exact match — capture this intent directly.</div>
                      <KwMiniTable rows={recommendations.exactMatch} cols={emCols} />
                    </div>
                  </div>
                </div>
                )}

              </div>
            )
          })()}
        </div>
      </div>
      )}

      {/* ── 9. Ad Performance Analysis ───────────────────────────────────── */}
      {isSectionVisible('adPerformance') && (
      <div className="card" style={{ marginBottom:24 }}>
        <div className="card-header"><span className="card-title">Ad Performance Analysis</span></div>
        <div style={{ padding:'16px' }}>
          {adAnalysisLoading && (
            <div style={{ padding:'20px 0', textAlign:'center', color:'#2563b0', fontSize:13 }}>
              Loading ad performance analysis…
            </div>
          )}
          {adAnalysisError && !adAnalysisLoading && (
            <div style={{ padding:'12px 0', color:'#c0392b', fontSize:12 }}>{adAnalysisError}</div>
          )}
          {adAnalysis && !adAnalysisLoading && (() => {
            const { overview, best, weak, rsaQuality, extensions } = adAnalysis
            const adCols = [
              { key:'_headline', label:'Ad (Headline)', format:(v,row)=>(
                <div>
                  <div style={{fontWeight:500,color:'#1a3a6b',fontSize:11,lineHeight:1.3}}>{v}</div>
                  <div style={{fontSize:10,color:'#888',marginTop:2}}>{row.campaign?.length>30?row.campaign.slice(0,30)+'…':row.campaign}</div>
                </div>
              )},
              { key:'ctr',      label:'CTR',       right:true, format:v=>fmtPct(v) },
              { key:'conversions', label:'Conv.',   right:true, format:v=>fmtNum(v) },
              { key:'cost',     label:'Spend',      right:true, format:v=>fmtUsd(v) },
              { key:'adStrength', label:'Strength', right:true, format:v=>{
                const cfg = {Excellent:['#2e7d32','#e8f5e9'],Good:['#1565c0','#e3f2fd'],Average:['#a56700','#fff8e1'],Poor:['#c0392b','#fdecea']}[v]||['#888','#f5f7fa']
                return <span style={{fontSize:10,fontWeight:700,color:cfg[0],background:cfg[1],borderRadius:3,padding:'1px 5px'}}>{v||'—'}</span>
              }},
            ]
            const str = rsaQuality.strengthDist
            const strTotal = Object.values(str).reduce((s,v)=>s+v,0)
            return (
              <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

                {/* Overview KPIs */}
                {isSectionVisible('adPerformance.overview') && (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
                  {[
                    { label:'Total Ads',    value:fmtNum(overview.totalAds),   color:'#1a3a6b' },
                    { label:'RSA Ads',      value:fmtNum(overview.rsaCount),   color:'#1565c0' },
                    { label:'Strong (Ex+Good)', value:fmtNum(overview.strongAds), color:'#2e7d32' },
                    { label:'Weak (Poor+Avg)',  value:fmtNum(overview.weakAds),   color:'#c0392b' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background:'#f5f7fa', border:'1px solid #e8eef7', borderRadius:8, padding:'12px 14px' }}>
                      <div style={{ fontSize:10, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:.4, marginBottom:4 }}>{label}</div>
                      <div style={{ fontSize:20, fontWeight:700, color }}>{value}</div>
                    </div>
                  ))}
                </div>
                )}

                {/* Top 3 Best Performing Ads */}
                {best.byConversions?.length > 0 && isSectionVisible('adPerformance.top3') && (
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:'#1a3a6b', marginBottom:10 }}>
                      <span style={{ background:'#e8f0fb', border:'1px solid #b6d0f7', borderRadius:6, padding:'2px 10px' }}>Top 3 Best Performing Ads</span>
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                      {best.byConversions.map((ad, i) => (
                        <div key={i} style={{ border:'2px solid #4caf50', borderRadius:8, padding:'12px 16px', background:'rgba(76,175,80,0.04)', position:'relative' }}>
                          <span style={{ position:'absolute', top:-10, right:12, background:'#4caf50', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10 }}>⭐ Top Performer</span>
                          <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                            <div style={{ flex:2 }}>
                              <div style={{ fontSize:12, fontWeight:600, color:'#1a3a6b', marginBottom:4 }}>{ad.campaign || '—'}</div>
                              <div style={{ fontSize:11, color:'#888' }}>{ad.adGroup || '—'}</div>
                              {ad.headline1 && ad.headline1 !== '—' && (
                                <div style={{ fontSize:12, color:'#4a4a4a', marginTop:4, lineHeight:1.4 }}>{ad.headline1}</div>
                              )}
                            </div>
                            {[['Conv.',fmtNum(ad.conversions||0)],['Rate',fmtPct(ad.convRate||0)],['Cost',fmtUsd(ad.cost||0)]].map(([l,v]) => (
                              <div key={l} style={{ textAlign:'center' }}>
                                <div style={{ fontSize:10, color:'#888', marginBottom:2 }}>{l}</div>
                                <div style={{ fontSize:14, fontWeight:700, color:'#1a3a6b' }}>{v}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Best Ads */}
                {isSectionVisible('adPerformance.bestAds') && (
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#2e7d32', marginBottom:10 }}>
                    <span style={{ background:'#e8f5e9', border:'1px solid #c8e6c9', borderRadius:6, padding:'2px 10px' }}>Best Ads</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
                    {[
                      { key:'byCtr',      label:'Highest CTR',         color:'#1565c0', bg:'#e3f2fd', border:'#bbdefb' },
                      { key:'byConvRate', label:'Highest Conv. Rate',   color:'#2e7d32', bg:'#e8f5e9', border:'#c8e6c9' },
                      { key:'byStrength', label:'Highest Quality Score', color:'#6a1b9a', bg:'#f3e5f5', border:'#e1bee7' },
                    ].map(({ key, label, color, bg, border }) => (
                      <div key={key} style={{ background:bg, border:`1px solid ${border}`, borderRadius:8, padding:'12px' }}>
                        <div style={{ fontSize:11, fontWeight:700, color, textTransform:'uppercase', letterSpacing:.4, marginBottom:8 }}>{label}</div>
                        <KwMiniTable rows={best[key]} cols={adCols} />
                      </div>
                    ))}
                  </div>
                </div>
                )}

                {/* RSA Quality */}
                {isSectionVisible('adPerformance.rsaQuality') && (
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#1a3a6b', marginBottom:10 }}>
                    <span style={{ background:'#e3f2fd', border:'1px solid #bbdefb', borderRadius:6, padding:'2px 10px' }}>RSA Asset Strength</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:16, alignItems:'start' }}>
                    {/* Strength Distribution */}
                    <div style={{ background:'#f5f7fa', border:'1px solid #e8eef7', borderRadius:8, padding:'14px 18px', minWidth:200 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'#1a3a6b', textTransform:'uppercase', letterSpacing:.4, marginBottom:10 }}>Ad Strength Distribution</div>
                      {[
                        ['Excellent', '#2e7d32', '#e8f5e9'],
                        ['Good',      '#1565c0', '#e3f2fd'],
                        ['Average',   '#a56700', '#fff8e1'],
                        ['Poor',      '#c0392b', '#fdecea'],
                      ].map(([lbl, color, bg]) => {
                        const cnt = str[lbl] || 0
                        const pct = strTotal > 0 ? Math.round(cnt / strTotal * 100) : 0
                        return (
                          <div key={lbl} style={{ marginBottom:8 }}>
                            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:3 }}>
                              <span style={{ fontWeight:600, color }}>{lbl}</span>
                              <span style={{ color:'#555' }}>{cnt} ({pct}%)</span>
                            </div>
                            <div style={{ height:6, background:'#e8eef7', borderRadius:3, overflow:'hidden' }}>
                              <div style={{ width:`${pct}%`, height:'100%', background:color, borderRadius:3 }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {/* Issues Grid */}
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
                      {[
                        { label:'Missing CTA',           value:rsaQuality.noCta,        desc:'RSAs with no call-to-action in headlines/descriptions',     color:'#c0392b', bg:'#fdecea' },
                        { label:'Pinning Issues',         value:rsaQuality.pinningIssue, desc:'Over 60% of headlines pinned — limits machine learning',     color:'#e65100', bg:'#fff3e0' },
                        { label:'Keyword Insertion',      value:rsaQuality.withKwInsert, desc:'RSAs using {KeyWord:} insertion',                             color:'#1565c0', bg:'#e3f2fd' },
                        { label:'Low Headline Count',     value:rsaQuality.lowHeadlines, desc:'RSAs with fewer than 10 headlines (max 15)',                  color:'#a56700', bg:'#fff8e1' },
                        { label:'Low Description Count',  value:rsaQuality.lowDescs,     desc:'RSAs with fewer than 4 descriptions (max 4)',                 color:'#6a1b9a', bg:'#f3e5f5' },
                        { label:'Ad Relevance Issues',    value:rsaQuality.noCta,        desc:'Ads that may lack keyword relevance signals in copy',         color:'#37474f', bg:'#eceff1' },
                      ].map(({ label, value, desc, color, bg }) => (
                        <div key={label} style={{ background:bg, borderRadius:8, padding:'10px 12px', border:`1px solid ${color}22` }}>
                          <div style={{ fontSize:20, fontWeight:700, color, marginBottom:2 }}>{value}</div>
                          <div style={{ fontSize:11, fontWeight:600, color, marginBottom:4 }}>{label}</div>
                          <div style={{ fontSize:10, color:'#666', lineHeight:1.4 }}>{desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Ads needing CTA */}
                  {rsaQuality.topNoCta?.length > 0 && (
                    <div style={{ marginTop:12 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'#c0392b', textTransform:'uppercase', letterSpacing:.4, marginBottom:6 }}>Top RSAs Missing CTA (by impressions)</div>
                      <KwMiniTable rows={rsaQuality.topNoCta} cols={adCols} />
                    </div>
                  )}
                </div>
                )}

                {/* Weak Ads */}
                {isSectionVisible('adPerformance.weakAds') && (
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#c0392b', marginBottom:10 }}>
                    <span style={{ background:'#fdecea', border:'1px solid #ffcdd2', borderRadius:6, padding:'2px 10px' }}>Weak Ads</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
                    {[
                      { key:'byLowCtr',      label:'Low CTR (≥100 impr, CTR<1%)',    color:'#b71c1c', bg:'#fff5f5', border:'#ffcdd2' },
                      { key:'byLowConvRate', label:'Low Conv. Rate (≥20 clicks, <0.5%)', color:'#e65100', bg:'#fff8f0', border:'#ffccbc' },
                      { key:'byStrength',    label:'Poor/Average Ad Strength',        color:'#6a1b9a', bg:'#f9f0ff', border:'#e1bee7' },
                    ].map(({ key, label, color, bg, border }) => (
                      <div key={key} style={{ background:bg, border:`1px solid ${border}`, borderRadius:8, padding:'12px' }}>
                        <div style={{ fontSize:11, fontWeight:700, color, textTransform:'uppercase', letterSpacing:.4, marginBottom:8 }}>{label}</div>
                        <KwMiniTable rows={weak[key]} cols={adCols} />
                      </div>
                    ))}
                  </div>
                </div>
                )}

                {/* Extensions */}
                {isSectionVisible('adPerformance.extensions') && (
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#1a3a6b', marginBottom:10 }}>
                    <span style={{ background:'#f5f7fa', border:'1px solid #c8d9ed', borderRadius:6, padding:'2px 10px' }}>Extensions / Assets Usage</span>
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
                    {extensions.map(({ name, active }) => (
                      <div key={name} style={{
                        display:'flex', alignItems:'center', gap:6,
                        background: active ? '#e8f5e9' : '#fdecea',
                        border: `1px solid ${active ? '#c8e6c9' : '#ffcdd2'}`,
                        borderRadius:8, padding:'10px 16px',
                      }}>
                        <span style={{ fontSize:16 }}>{active ? '✓' : '✗'}</span>
                        <div>
                          <div style={{ fontSize:12, fontWeight:600, color: active ? '#2e7d32' : '#c0392b' }}>{name}</div>
                          <div style={{ fontSize:10, color:'#888' }}>{active ? 'Active' : 'Not set up'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {extensions.filter(e => !e.active).length > 0 && (
                    <div style={{ marginTop:10, background:'#fff8e1', border:'1px solid #ffe082', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#a56700' }}>
                      <strong>Missing extensions:</strong> {extensions.filter(e => !e.active).map(e => e.name).join(', ')} — each missing extension is a missed opportunity to increase click-through rate and provide more information to searchers.
                    </div>
                  )}
                </div>
                )}

              </div>
            )
          })()}
        </div>
      </div>
      )}

      {/* ── 10. Issues & Risks ───────────────────────────────────────────── */}
      {isSectionVisible('issuesRisks') && (
      <Section title={`Issues & Risks ${issues.length > 0 ? `(${issues.length})` : ''}`}>
        <div style={{ padding:'12px 16px' }}>
          {issues.length === 0
            ? <IssuePill type="success" text="No critical issues detected in this period. Account appears to be running well." />
            : issues.map((iss, i) => <IssuePill key={i} type={iss.type} text={iss.text} />)
          }
        </div>
      </Section>
      )}

      {/* ── 9. Opportunities ─────────────────────────────────────────────── */}
      {opps.length > 0 && isSectionVisible('opportunities') && (
        <Section title="Growth Opportunities">
          <div style={{ padding:'12px 16px' }}>
            {opps.map((o, i) => <IssuePill key={i} type={o.type} text={o.text} />)}
          </div>
        </Section>
      )}

      {/* ── 10. Action Plan ──────────────────────────────────────────────── */}
      {actions.length > 0 && isSectionVisible('actionPlan') && (
        <Section title="Recommended Action Plan">
          <div style={{ padding:'12px 20px' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#1a3a6b', marginBottom:8, textTransform:'uppercase', letterSpacing:.5 }}>Immediate (1–7 days)</div>
            {actions.filter(a=>a.priority==='high').map((a,i) => <ActionItem key={i} priority="high" text={a.text}/>)}
            {actions.filter(a=>a.priority==='high').length === 0 && <div style={{ fontSize:12, color:'#aaa', marginBottom:8 }}>No immediate actions required.</div>}

            <div style={{ fontSize:11, fontWeight:600, color:'#1a3a6b', marginTop:14, marginBottom:8, textTransform:'uppercase', letterSpacing:.5 }}>Short-Term (30 days)</div>
            {actions.filter(a=>a.priority==='mid').map((a,i) => <ActionItem key={i} priority="mid" text={a.text}/>)}
            {actions.filter(a=>a.priority==='mid').length === 0 && <div style={{ fontSize:12, color:'#aaa', marginBottom:8 }}>No short-term actions identified.</div>}

            <div style={{ fontSize:11, fontWeight:600, color:'#1a3a6b', marginTop:14, marginBottom:8, textTransform:'uppercase', letterSpacing:.5 }}>Long-Term Growth (90+ days)</div>
            {actions.filter(a=>a.priority==='low').map((a,i) => <ActionItem key={i} priority="low" text={a.text}/>)}
            {actions.filter(a=>a.priority==='low').length === 0 && <div style={{ fontSize:12, color:'#aaa', marginBottom:8 }}>No long-term actions identified.</div>}
          </div>
        </Section>
      )}

    </div>
  )
}

// ── Device tab ────────────────────────────────────────────────────────────────
function DevicesTab({ data, loading, error, onRetry, accountName }) {
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
      <Section title="Device Breakdown" extra={
        <div style={{ display:'flex', gap:8 }}>
          <ExportButton data={toDisplayCsv(data, cols)} filename="devices"/>
          <ExportPdfButton accountName={accountName} section="Devices" />
        </div>
      }>
        <ReportTable columns={cols} data={data} loading={loading}/>
      </Section>
    </div>
  )
}

// ── Ad Slots tab ──────────────────────────────────────────────────────────────
function AdSlotsTab({ data, loading, error, onRetry, accountName }) {
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
      <Section title="Ad Slot Breakdown" extra={
        <div style={{ display:'flex', gap:8 }}>
          <ExportButton data={toDisplayCsv(safeData, cols)} filename="ad-slots"/>
          <ExportPdfButton accountName={accountName} section="Ad Slots" />
        </div>
      }>
        <ReportTable columns={cols} data={safeData} loading={loading}/>
      </Section>
    </div>
  )
}

// ── Main Reports component ────────────────────────────────────────────────────
export default function Reports({ selectedAccount, dateRange, dashboardData, hidePaused }) {
  const location = useLocation()
  const [activeTab,       setActiveTab]       = useState('summary')
  const [data,            setData]            = useState(null)
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState(null)
  const [drillCampaign,      setDrillCampaign]      = useState('')
  const [campTypeFilter,      setCampTypeFilter]      = useState('')
  const [agCampaignFilter,    setAgCampaignFilter]    = useState('')
  const [agCampStatusFilter,  setAgCampStatusFilter]  = useState('Enabled')
  const [asgCampaignFilter,   setAsgCampaignFilter]   = useState('')
  const [asgCampStatusFilter, setAsgCampStatusFilter] = useState('Enabled')

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
          dateRange,
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
    const props = { data, loading, error, onRetry: loadReport, hidePaused, customerId: selectedAccount?.id, accountName: selectedAccount?.name }
    switch (activeTab) {
      case 'campaigns': {
        const campAllData = Array.isArray(data) ? data : []
        const campTypes   = [...new Set(campAllData.map(r => fmtChannelType(r.channelType)).filter(v => v && v !== '—'))].sort()
        const campFiltered = campTypeFilter
          ? campAllData.filter(r => fmtChannelType(r.channelType) === campTypeFilter)
          : campAllData
        const selStyle = { padding:'4px 10px', border:'1px solid #dde9f5', borderRadius:5, fontSize:12, color:'#1a3a6b', outline:'none', cursor:'pointer', background:'#fff' }
        return (
          <Section title="Campaigns" extra={
            <div style={{ display:'flex', gap:8 }}>
              <ExportButton data={toDisplayCsv(campFiltered, CAMPAIGN_COLS, { status: reportStatusText, phoneCalls: fmtNum, formConversions: fmtNum, phoneConversions: fmtNum })} filename="campaigns"/>
              <ExportPdfButton accountName={selectedAccount?.name} section="Campaigns" />
            </div>
          }>
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
          <Section title="Ad Groups" extra={
            <div style={{ display:'flex', gap:8 }}>
              <ExportButton data={toDisplayCsv(agFiltered, AD_GROUP_COLS, { status: reportStatusText, phoneCalls: fmtNum, formConversions: fmtNum, phoneConversions: fmtNum })} filename="ad-groups"/>
              <ExportPdfButton accountName={selectedAccount?.name} section="Ad Groups" />
            </div>
          }>
            <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f4f8', background:'#fafcff', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign Name:</span>
                <select value={agCampaignFilter} onChange={e => { setAgCampaignFilter(e.target.value); setAgCampStatusFilter('Enabled') }} style={selStyle}>
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
              {(agCampaignFilter || (agCampStatusFilter && agCampStatusFilter !== 'Enabled')) && (
                <button onClick={() => { setAgCampaignFilter(''); setAgCampStatusFilter('Enabled') }}
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
          <Section title="Asset Groups (PMax)" extra={
            <div style={{ display:'flex', gap:8 }}>
              <ExportButton data={toDisplayCsv(asgFiltered, ASSET_COLS, { status: reportStatusText, formConversions: fmtNum, phoneConversions: fmtNum })} filename="asset-groups"/>
              <ExportPdfButton accountName={selectedAccount?.name} section="Asset Groups" />
            </div>
          }>
            <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f4f8', background:'#fafcff', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>Campaign Name:</span>
                <select value={asgCampaignFilter} onChange={e => { setAsgCampaignFilter(e.target.value); setAsgCampStatusFilter('Enabled') }} style={selStyle}>
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
              {(asgCampaignFilter || (asgCampStatusFilter && asgCampStatusFilter !== 'Enabled')) && (
                <button onClick={() => { setAsgCampaignFilter(''); setAsgCampStatusFilter('Enabled') }}
                  style={{ fontSize:11, color:'#2563b0', background:'none', border:'1px solid #dde9f5', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
                  Clear
                </button>
              )}
              <span style={{ fontSize:11, color:'#888', marginLeft:'auto' }}>{asgFiltered.length} of {asgAllData.length}</span>
            </div>
            <ReportTable columns={ASSET_COLS} data={asgFiltered} loading={loading} hidePaused={hidePaused} emptyMessage="No asset groups found. Shows PMax only."/>
          </Section>
        )
      }
      case 'networks':         return <><Section title="Performance by Network"><div className="card-body">{!loading&&data?.length>0&&<ResponsiveContainer width="100%" height={180}><BarChart data={data} margin={{top:4,right:16,left:0,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke="#eef2f7"/><XAxis dataKey="label" tick={{fontSize:11,fill:'#888'}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:10,fill:'#888'}} axisLine={false} tickLine={false} width={40}/><Tooltip/><Bar dataKey="clicks" name="Clicks" fill="#2563b0" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer>}</div></Section><Section title="Network Breakdown" extra={<div style={{display:'flex',gap:8}}><ExportButton data={toDisplayCsv(data, NETWORK_COLS)} filename="networks"/><ExportPdfButton accountName={selectedAccount?.name} section="Networks" /></div>}><ReportTable columns={NETWORK_COLS} data={data} loading={loading}/></Section></>
      case 'devices':          return <DevicesTab {...props} />
      case 'clickTypes': {
        const clickTypeCols = [{key:'label',label:'Click Type',sortable:true,align:'left',format:v=>resolveLbl(CLICK_TYPE,v)},{key:'impressions',label:'Impr.',sortable:true,align:'right',format:fmtNum},{key:'clicks',label:'Clicks',sortable:true,align:'right',format:fmtNum},{key:'ctr',label:'CTR',sortable:true,align:'right',format:fmtPct},{key:'cpc',label:'Avg CPC',sortable:true,align:'right',format:fmtUsd},{key:'cost',label:'Cost',sortable:true,align:'right',format:fmtUsd},{key:'conversions',label:'Conv.',sortable:true,align:'right',format:fmtNum}]
        return <Section title="Performance by Click Type" extra={<div style={{display:'flex',gap:8}}><ExportButton data={toDisplayCsv(data, clickTypeCols)} filename="click-types"/><ExportPdfButton accountName={selectedAccount?.name} section="Click Types" /></div>}><ReportTable columns={clickTypeCols} data={data} loading={loading}/></Section>
      }
      case 'adSlots':          return <AdSlotsTab {...props} />
      case 'summary':          return <SummaryTab dashboardData={dashboardData} loading={!dashboardData} customerId={selectedAccount?.id} dateRange={dateRange} accountName={selectedAccount?.name} />
      case 'formConversions':      return <ConversionActionsTab {...props} title="Form Conversions" actionColumnLabel="Conversion Action" />
      case 'phoneCallConversions': return <ConversionActionsTab {...props} title="Phone Call Conversions" actionColumnLabel="Conversion Action" />
      case 'callLeads':        return <CallLeadsTab {...props} initialCampaignFilter={drillCampaign} />
      case 'adsPerformance':   return <AdsPerformanceTab {...props} />
      default: return null
    }
  }

  return (
    <div className="reports-page-wrap" style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <TabBar active={activeTab} onSelect={tab => { setData(null); setError(null); setActiveTab(tab) }} />
      <div className="page-scroll-area" style={{ flex:1, overflowY:'auto', padding:'20px 24px', background:'#f5f7fa' }}>
        <ErrorBoundary key={activeTab}>
          {renderTab()}
        </ErrorBoundary>
      </div>
    </div>
  )
}
