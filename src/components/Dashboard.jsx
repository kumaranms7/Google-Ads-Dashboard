import React, { useState } from 'react'
import { AlertCircle, RefreshCw, FileDown, CheckCircle, Phone, AlertTriangle, PhoneCall, FileText } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import LoadingSkeleton from './LoadingSkeleton.jsx'
import KPICards from './KPICards.jsx'
import PerformanceChart from './PerformanceChart.jsx'
import DonutChart from './DonutChart.jsx'
import CampaignTable from './CampaignTable.jsx'
import BreakdownPanel, { BudgetSection } from './BreakdownPanel.jsx'
import BreakdownCell from './BreakdownCell.jsx'

// ── PDF export button ─────────────────────────────────────────────────────────
function ExportPDFButton({ selectedAccount }) {
  const [state, setState] = useState('idle')
  async function handleExport() {
    if (state === 'exporting') return
    setState('exporting')
    try {
      const result = await window.electronAPI.exportPDF({ accountName: selectedAccount?.name })
      if (result?.canceled) { setState('idle'); return }
      setState('done'); setTimeout(() => setState('idle'), 2500)
    } catch { setState('error'); setTimeout(() => setState('idle'), 3000) }
  }
  const label = state==='exporting'?'Exporting…':state==='done'?'PDF Saved!':state==='error'?'Export Failed':'Export PDF'
  const bg = state==='done'?'#2e7d32':state==='error'?'#e05c2a':'#2563b0'
  const Icon = state==='done'?CheckCircle:FileDown
  return (
    <button onClick={handleExport} disabled={state==='exporting'} style={{
      display:'inline-flex', alignItems:'center', gap:6, padding:'7px 14px',
      background:bg, color:'#fff', fontWeight:600, fontSize:12,
      borderRadius:6, border:'none', cursor: state==='exporting'?'not-allowed':'pointer',
      opacity: state==='exporting'?0.7:1, transition:'background 0.2s',
    }}>
      <Icon size={13} className={state==='exporting'?'spin':''} />{label}
    </button>
  )
}

// ── Extended KPI cards (Call Leads + Phone Conv + Form Conv + Wasted Spend) ───
function ExtendedKPICards({ kpis, previousKpis, callSummary, accountName }) {
  if (!kpis) return null
  const phoneCalls      = callSummary?.totalCalls     ?? kpis.phoneCalls       ?? 0
  const connectedCalls  = callSummary?.connectedCalls ?? kpis.connectedCalls   ?? null
  const prevCalls       = previousKpis?.phoneCalls    || 0
  const phoneConversions = kpis.phoneConversions || 0
  const formConversions  = kpis.formConversions  || 0
  const prevPhoneConv    = previousKpis?.phoneConversions || 0
  const prevFormConv     = previousKpis?.formConversions  || 0
  const wastedSpend      = kpis.wastedSpend || 0

  function DeltaBadge({ curr, prev }) {
    if (!prev) return null
    const pct = ((curr - prev) / prev) * 100
    const up  = pct >= 0
    return (
      <span style={{ fontSize:11, fontWeight:600, color: up?'#4caf50':'#e05c2a', background: up?'rgba(76,175,80,0.1)':'rgba(224,92,42,0.1)', borderRadius:4, padding:'2px 6px' }}>
        {up?'▲':'▼'} {Math.abs(pct).toFixed(1)}%
      </span>
    )
  }

  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
      {/* Call Leads */}
      <div style={{ background:'rgba(37,99,176,0.1)', border:'1px solid rgba(37,99,176,0.3)', borderRadius:8, padding:'13px 15px', display:'flex', flexDirection:'column', gap:6 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <Phone size={13} color='#2563b0' />
            <span style={{ fontSize:11, fontWeight:600, color:'#2563b0', textTransform:'uppercase', letterSpacing:'0.5px' }}>Call Leads</span>
          </div>
          <DeltaBadge curr={phoneCalls} prev={prevCalls} />
        </div>
        <div style={{ fontSize:22, fontWeight:700, color:'#1a3a6b' }}>{phoneCalls.toLocaleString()}</div>
        <div style={{ fontSize:11, color:'#7a90ab' }}>
          {connectedCalls != null && connectedCalls > 0 ? `${connectedCalls.toLocaleString()} connected` : 'Phone calls tracked'}
        </div>
      </div>
      {/* Phone Call Conversions */}
      <div style={{ background:'rgba(21,101,192,0.08)', border:'1px solid rgba(21,101,192,0.25)', borderRadius:8, padding:'13px 15px', display:'flex', flexDirection:'column', gap:6 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <PhoneCall size={13} color='#1565c0' />
            <span style={{ fontSize:11, fontWeight:600, color:'#1565c0', textTransform:'uppercase', letterSpacing:'0.5px' }}>Phone Conv.</span>
          </div>
          <DeltaBadge curr={phoneConversions} prev={prevPhoneConv} />
        </div>
        <div style={{ fontSize:22, fontWeight:700, color:'#1565c0' }}>
          <BreakdownCell value={phoneConversions} breakdown={kpis.phoneBreakdown} entityLabel={accountName}
            modalTitle="Phone Conversions" buttonTitle="View phone conversion breakdown" rowLabel="Conversion Action"
            align="flex-start" fullWidth={false} valueNode={phoneConversions.toLocaleString()} />
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
      {/* Form Submit Conversions */}
      <div style={{ background:'rgba(46,125,50,0.08)', border:'1px solid rgba(46,125,50,0.25)', borderRadius:8, padding:'13px 15px', display:'flex', flexDirection:'column', gap:6 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <FileText size={13} color='#2e7d32' />
            <span style={{ fontSize:11, fontWeight:600, color:'#2e7d32', textTransform:'uppercase', letterSpacing:'0.5px' }}>Form Conv.</span>
          </div>
          <DeltaBadge curr={formConversions} prev={prevFormConv} />
        </div>
        <div style={{ fontSize:22, fontWeight:700, color:'#2e7d32' }}>
          <BreakdownCell value={formConversions} breakdown={kpis.formBreakdown} entityLabel={accountName}
            modalTitle="Form Conversions" buttonTitle="View form conversion breakdown" rowLabel="Conversion Action"
            align="flex-start" fullWidth={false} valueNode={formConversions.toLocaleString()} />
        </div>
        <div style={{ fontSize:11, color:'#7a90ab' }}>Form submit conversions</div>
      </div>
      {/* Wasted Spend */}
      <div style={{ background:'rgba(224,92,42,0.07)', border:'1px solid rgba(224,92,42,0.25)', borderRadius:8, padding:'13px 15px', display:'flex', flexDirection:'column', gap:6 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <AlertTriangle size={13} color='#e05c2a' />
          <span style={{ fontSize:11, fontWeight:600, color:'#e05c2a', textTransform:'uppercase', letterSpacing:'0.5px' }}>Wasted Spend</span>
        </div>
        <div style={{ fontSize:22, fontWeight:700, color:'#e05c2a' }}>
          ${wastedSpend.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
        </div>
        <div style={{ fontSize:11, color:'#7a90ab' }}>Keywords with spend & 0 conversions</div>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ loading, error, dashboardData, callSummary, selectedAccount, onRetry, hidePaused }) {
  if (!selectedAccount) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12, color:'#888', background:'#f5f7fa' }}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity={0.3}>
          <rect x="4" y="4" width="40" height="40" rx="8" stroke="#1a3a6b" strokeWidth="2"/>
          <path d="M14 32V20M22 32V16M30 32V24M38 32V12" stroke="#1a3a6b" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <div style={{ fontSize:14, fontWeight:500 }}>Select an account to view data</div>
        <div style={{ fontSize:12, color:'#aaa' }}>Choose an account from the sidebar to get started</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16, background:'#f5f7fa', padding:40 }}>
        <div style={{ background:'#fff', border:'1px solid #ffd5cc', borderRadius:10, padding:'28px 32px', maxWidth:420, textAlign:'center', boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
          <AlertCircle size={36} color="#e05c2a" style={{ marginBottom:12 }} />
          <div style={{ fontSize:15, fontWeight:600, color:'#1a3a6b', marginBottom:6 }}>Failed to load data</div>
          <div style={{ fontSize:13, color:'#666', lineHeight:1.5, marginBottom:20 }}>{error}</div>
          <button onClick={onRetry} style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'9px 20px', background:'#2563b0', color:'#fff', borderRadius:6, fontWeight:600, fontSize:13, cursor:'pointer', border:'none' }}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-scroll-area" style={{ flex:1, overflowY:'auto', padding:'20px 24px', background:'#f5f7fa' }}>
      {loading ? <LoadingSkeleton /> : dashboardData ? (
        <div className="fade-in" style={{ display:'flex', flexDirection:'column', gap:20, maxWidth:1500, width:'100%', margin:'0 auto' }}>
          <div className="no-print" style={{ display:'flex', alignItems:'center', justifyContent:'flex-end' }}>
            <ExportPDFButton selectedAccount={selectedAccount} />
          </div>
          <KPICards kpis={dashboardData.kpis} previousKpis={dashboardData.previousKpis} />
          <ExtendedKPICards kpis={dashboardData.kpis} previousKpis={dashboardData.previousKpis} callSummary={callSummary} accountName={selectedAccount?.name} />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:20 }}>
            <PerformanceChart dailySeries={dashboardData.dailySeries} />
            <DonutChart campaigns={dashboardData.campaigns} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'3.5fr 1.5fr', gap:20 }}>
            <CampaignTable campaigns={dashboardData.campaigns} hidePaused={hidePaused} />
            <BreakdownPanel deviceSplit={dashboardData.deviceSplit} keywords={dashboardData.keywords} />
          </div>
          <div className="card" style={{ paddingBottom:8 }}>
            <div className="card-header">
              <span className="card-title">Budget Pacing</span>
              <span style={{ fontSize:11, color:'#888' }}>Active campaigns only</span>
            </div>
            <div className="card-body">
              <BudgetSection
                budget={(dashboardData.budget || []).filter(b => b.status === 'Enabled')}
                hideTitle
              />
            </div>
          </div>
          {(dashboardData.dailyCallLeads || []).length > 0 && (
            <div className="card">
              <div className="card-header">
                <span className="card-title">Call Leads</span>
              </div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={dashboardData.dailyCallLeads} margin={{ top:4, right:16, bottom:0, left:0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="date" tick={{ fontSize:10, fill:'#888' }} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
                    <YAxis tick={{ fontSize:10, fill:'#888' }} axisLine={false} tickLine={false} width={28} allowDecimals={false}/>
                    <Tooltip formatter={v => [Number(v).toLocaleString(), 'Call Leads']}/>
                    <Bar dataKey="calls" name="Call Leads" fill="#2563b0" radius={[3,3,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
