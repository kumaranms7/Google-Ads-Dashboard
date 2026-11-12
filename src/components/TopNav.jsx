import React, { useState, useRef, useEffect } from 'react'
import { RefreshCw, ChevronDown, ChevronRight, Calendar, ZoomIn, ZoomOut } from 'lucide-react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const PRESETS = [
  { label: 'Today',        value: 'TODAY'        },
  { label: 'Yesterday',    value: 'YESTERDAY'    },
  { label: 'Last 7 Days',  value: 'LAST_7_DAYS'  },
  { label: 'Last 14 Days', value: 'LAST_14_DAYS' },
  { label: 'Last 30 Days', value: 'LAST_30_DAYS' },
  { label: 'Last 90 Days', value: 'LAST_90_DAYS' },
  { label: 'This Month',   value: 'THIS_MONTH'   },
  { label: 'Last Month',   value: 'LAST_MONTH'   },
]

function getLabel(dateRange) {
  if (!dateRange) return 'Last 30 Days'
  if (typeof dateRange === 'string') return PRESETS.find(r => r.value === dateRange)?.label || dateRange
  const s = dayjs(dateRange.startDate).format('MMM D')
  const e = dayjs(dateRange.endDate).format('MMM D, YYYY')
  return `${s} – ${e}`
}

const isCustom = dr => dr && typeof dr === 'object'

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', userSelect:'none' }}>
      <span style={{ fontSize:12, color:'rgba(255,255,255,0.8)', fontWeight:500 }}>{label}</span>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 34, height: 18, borderRadius: 9,
          background: checked ? '#2563b0' : '#dde9f5',
          position: 'relative', transition: 'background 0.2s', flexShrink: 0,
          border: checked ? '1px solid #1a4a90' : '1px solid #b0c4d8',
        }}
      >
        <div style={{
          width: 14, height: 14, borderRadius: '50%',
          background: '#fff',
          position: 'absolute', top: 1,
          left: checked ? 17 : 1,
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>
    </label>
  )
}

// ── Date range dropdown ───────────────────────────────────────────────────────

function DateDropdown({ dateRange, onChange }) {
  const [open,    setOpen]    = useState(false)
  const [showCal, setShowCal] = useState(false)
  const [range,   setRange]   = useState([null, null])
  const [startDate, endDate]  = range
  const ref = useRef(null)

  useEffect(() => {
    function handleMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setShowCal(false) }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  useEffect(() => {
    if (isCustom(dateRange)) setRange([new Date(dateRange.startDate), new Date(dateRange.endDate)])
  }, [dateRange])

  function applyCustom() {
    if (!startDate || !endDate) return
    onChange({ startDate: dayjs(startDate).format('YYYY-MM-DD'), endDate: dayjs(endDate).format('YYYY-MM-DD') })
    setOpen(false); setShowCal(false)
  }

  function handlePreset(value) { onChange(value); setOpen(false); setShowCal(false); setRange([null, null]) }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(o => !o); if (open) setShowCal(false) }}
        style={{
          display:'flex', alignItems:'center', gap:6, padding:'6px 12px',
          background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)',
          borderRadius:6, color:'#ffffff', fontSize:13, fontWeight:500, cursor:'pointer',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
      >
        <Calendar size={13} style={{ opacity:0.8 }} />
        {getLabel(dateRange)}
        <ChevronDown size={11} style={{ opacity:0.7, transform: open ? 'rotate(180deg)' : 'none', transition:'transform 0.15s' }} />
      </button>

      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 6px)', right:0,
          background:'#fff', border:'1px solid #dde9f5',
          borderRadius:8, boxShadow:'0 6px 24px rgba(0,0,0,0.14)', zIndex:2000,
        }}>
          <div style={{ minWidth:180 }}>
            {PRESETS.map(r => {
              const active = typeof dateRange === 'string' && dateRange === r.value
              return (
                <div key={r.value} onClick={() => handlePreset(r.value)} style={{
                  padding:'9px 14px', fontSize:13, color:'#1a3a6b', cursor:'pointer',
                  fontWeight: active ? 600 : 400,
                  borderLeft: active ? '3px solid #e8a020' : '3px solid transparent',
                  background: active ? '#f5f7fa' : 'transparent',
                }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background='#f5f7fa' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background='transparent' }}
                >{r.label}</div>
              )
            })}
            <div style={{ height:1, background:'#dde9f5' }} />
            <div onClick={() => setShowCal(c => !c)} style={{
              padding:'9px 14px', fontSize:13, cursor:'pointer', color:'#1a3a6b',
              fontWeight: isCustom(dateRange) ? 600 : 400,
              borderLeft: isCustom(dateRange) ? '3px solid #e8a020' : '3px solid transparent',
              background: showCal || isCustom(dateRange) ? '#f5f7fa' : 'transparent',
              display:'flex', alignItems:'center', gap:6,
            }}>
              <Calendar size={13} /> Custom Range
              <ChevronDown size={11} style={{ marginLeft:'auto', opacity:0.5, transform: showCal ? 'rotate(180deg)' : 'none' }} />
            </div>
          </div>

          {showCal && (
            <div style={{ borderTop:'1px solid #dde9f5', padding:'10px 12px 12px' }}>
              <div style={{ fontSize:12, color:'#1a3a6b', fontWeight:500, marginBottom:8, textAlign:'center' }}>
                {startDate && endDate
                  ? `${dayjs(startDate).format('MMM D')} – ${dayjs(endDate).format('MMM D, YYYY')}`
                  : startDate ? `${dayjs(startDate).format('MMM D, YYYY')} → select end date` : 'Select start date'}
              </div>
              <DatePicker
                selectsRange startDate={startDate} endDate={endDate}
                onChange={(update) => setRange(Array.isArray(update) ? update : [update, null])}
                monthsShown={1} maxDate={new Date()} inline
              />
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:10 }}>
                <button onClick={() => { setShowCal(false); setRange([null,null]) }} style={{ padding:'7px 16px', fontSize:12, fontWeight:600, border:'1px solid #dde9f5', borderRadius:6, color:'#555', background:'#fff', cursor:'pointer' }}>Cancel</button>
                <button onClick={applyCustom} disabled={!startDate||!endDate} style={{ padding:'7px 16px', fontSize:12, fontWeight:700, border:'none', borderRadius:6, background: startDate&&endDate?'#e8a020':'#dde9f5', color: startDate&&endDate?'#1a3a6b':'#aaa', cursor: startDate&&endDate?'pointer':'not-allowed' }}>Apply</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main TopNav ───────────────────────────────────────────────────────────────

const FONT_MIN = 80
const FONT_MAX = 130
const FONT_STEP = 5

function FontSizeControl({ fontScale, onChange }) {
  const canDecrease = fontScale > FONT_MIN
  const canIncrease = fontScale < FONT_MAX

  const btnStyle = (enabled) => ({
    width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center',
    background: enabled ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
    border:'1px solid rgba(255,255,255,0.2)', borderRadius:6,
    color: enabled ? '#fff' : 'rgba(255,255,255,0.3)',
    cursor: enabled ? 'pointer' : 'not-allowed',
    flexShrink:0,
  })

  return (
    <div style={{ display:'flex', alignItems:'center', gap:3 }}>
      <button
        title="Decrease font size"
        disabled={!canDecrease}
        onClick={() => canDecrease && onChange(fontScale - FONT_STEP)}
        style={btnStyle(canDecrease)}
        onMouseEnter={e => { if (canDecrease) e.currentTarget.style.background='rgba(255,255,255,0.2)' }}
        onMouseLeave={e => { e.currentTarget.style.background = canDecrease ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)' }}
      >
        <ZoomOut size={13} />
      </button>

      <button
        title="Reset font size"
        onClick={() => onChange(100)}
        style={{
          padding:'0 7px', height:28, background:'rgba(255,255,255,0.1)',
          border:'1px solid rgba(255,255,255,0.2)', borderRadius:6,
          color: fontScale === 100 ? 'rgba(255,255,255,0.6)' : '#fff',
          fontSize:11, fontWeight:600, cursor:'pointer', flexShrink:0,
          fontVariantNumeric:'tabular-nums',
        }}
        onMouseEnter={e => { e.currentTarget.style.background='rgba(255,255,255,0.2)' }}
        onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.1)' }}
      >
        {fontScale}%
      </button>

      <button
        title="Increase font size"
        disabled={!canIncrease}
        onClick={() => canIncrease && onChange(fontScale + FONT_STEP)}
        style={btnStyle(canIncrease)}
        onMouseEnter={e => { if (canIncrease) e.currentTarget.style.background='rgba(255,255,255,0.2)' }}
        onMouseLeave={e => { e.currentTarget.style.background = canIncrease ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)' }}
      >
        <ZoomIn size={13} />
      </button>
    </div>
  )
}

export default function TopNav({
  selectedAccount, dateRange, onDateRangeChange,
  onRefresh, refreshing, lastRefreshed,
  hidePaused, onHidePausedChange,
  fontScale, onFontScaleChange,
  activePath,
  sidebarCollapsed, onToggleSidebar,
}) {
  const [showTooltip, setShowTooltip] = useState(false)
  const refreshLabel = lastRefreshed ? `Last refreshed ${dayjs(lastRefreshed).fromNow()}` : 'Click to refresh'
  const showHidePaused = activePath === '/reports'

  return (
    <div style={{
      height:56, flexShrink:0, background:'#1a3a6b',
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'0 24px', borderBottom:'1px solid rgba(255,255,255,0.1)',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:14 }}>
        {sidebarCollapsed && (
          <button
            onClick={onToggleSidebar}
            title="Show sidebar"
            style={{
              flexShrink:0, width:26, height:26, borderRadius:6,
              border:'1px solid rgba(255,255,255,0.2)', background:'rgba(255,255,255,0.07)',
              display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', padding:0,
              color:'#ffffff',
            }}
          >
            <ChevronRight size={14} />
          </button>
        )}
        <div>
          {selectedAccount ? (
            <>
              <div style={{ color:'#ffffff', fontWeight:700, fontSize:14, lineHeight:1.2 }}>{selectedAccount.name}</div>
              <div style={{ color:'#3a8fd1', fontSize:11, marginTop:1 }}>ID: {selectedAccount.id} · {selectedAccount.currencyCode}</div>
            </>
          ) : (
            <div style={{ color:'rgba(255,255,255,0.4)', fontSize:13 }}>No account selected</div>
          )}
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:14 }}>
        {/* Hide Paused toggle — only on Reports page */}
        {showHidePaused && (
          <>
            <Toggle checked={!!hidePaused} onChange={onHidePausedChange} label="Hide Paused" />
            <div style={{ width:1, height:20, background:'rgba(255,255,255,0.2)' }} />
          </>
        )}

        {/* Font size control */}
        <FontSizeControl fontScale={fontScale ?? 100} onChange={onFontScaleChange} />

        <div style={{ width:1, height:20, background:'rgba(255,255,255,0.2)' }} />

        <DateDropdown dateRange={dateRange} onChange={onDateRangeChange} />

        <div style={{ width:1, height:20, background:'rgba(255,255,255,0.2)' }} />

        {/* Refresh */}
        <div style={{ position:'relative' }}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <button
            onClick={onRefresh}
            disabled={refreshing || !selectedAccount}
            style={{
              width:34, height:34, display:'flex', alignItems:'center', justifyContent:'center',
              background:'rgba(221,233,245,0.15)', border:'1px solid rgba(255,255,255,0.2)',
              borderRadius:6, color:'#dde9f5',
              cursor: refreshing || !selectedAccount ? 'not-allowed' : 'pointer',
              opacity: !selectedAccount ? 0.4 : 1,
            }}
            onMouseEnter={e => { e.currentTarget.style.background='rgba(221,233,245,0.25)' }}
            onMouseLeave={e => { e.currentTarget.style.background='rgba(221,233,245,0.15)' }}
          >
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          </button>
          {showTooltip && (
            <div style={{ position:'absolute', bottom:'calc(100% + 6px)', right:0, background:'#1a3a6b', border:'1px solid rgba(255,255,255,0.15)', color:'#fff', fontSize:11, whiteSpace:'nowrap', padding:'4px 8px', borderRadius:4, pointerEvents:'none' }}>
              {refreshLabel}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
