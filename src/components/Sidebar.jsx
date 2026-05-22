import React, { useState } from 'react'
import { LayoutDashboard, BarChart2, Tag, ShieldCheck, Settings, AlertCircle, ChevronDown } from 'lucide-react'

// Import local logo — Vite hashes it and copies to dist/assets automatically
import logoAsset from '../assets/logo-white.webp'
const LOGO_URL = logoAsset

const NAV = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/'         },
  { icon: BarChart2,       label: 'Reports',   path: '/reports'  },
  { icon: Tag,             label: 'Keywords',  path: '/keywords' },
  { icon: ShieldCheck,     label: 'Audit',     path: '/audit'    },
]

function Logo({ width = 160 }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div style={{ width, textAlign:'center', padding:'6px 0' }}>
        <div style={{ color:'#e8a020', fontWeight:800, fontSize:17, letterSpacing:'1px', lineHeight:1.1 }}>TOP TEN</div>
        <div style={{ color:'rgba(255,255,255,0.75)', fontSize:9, letterSpacing:'2px', marginTop:2, textTransform:'uppercase' }}>Website Marketing</div>
      </div>
    )
  }
  return (
    <img
      src={LOGO_URL}
      alt="Top Ten Website Marketing"
      width={width}
      onError={() => setFailed(true)}
      style={{ display:'block', margin:'0 auto', objectFit:'contain', maxHeight:60 }}
    />
  )
}

function NavItem({ icon: Icon, label, path, activePath, onNavigate }) {
  const active = activePath === path
  return (
    <div onClick={() => onNavigate(path)} style={{
      display:'flex', alignItems:'center', gap:10, padding:'9px 16px',
      color: active ? '#ffffff' : '#3a8fd1',
      background: active ? '#2563b0' : 'transparent',
      borderLeft: active ? '3px solid #e8a020' : '3px solid transparent',
      cursor:'pointer', fontSize:13, fontWeight: active ? 600 : 400,
      transition:'background 0.12s, color 0.12s', userSelect:'none',
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background='rgba(37,99,176,0.5)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background='transparent' }}
    >
      <Icon size={15} />{label}
    </div>
  )
}

function AccountRow({ account, selected, onSelect }) {
  return (
    <div onClick={() => onSelect(account)} style={{
      padding:'9px 14px', cursor:'pointer',
      background:  selected ? '#2563b0' : 'transparent',
      borderLeft:  selected ? '3px solid #e8a020' : '3px solid transparent',
      transition:'background 0.12s',
    }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background='rgba(255,255,255,0.06)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background='transparent' }}
    >
      <div style={{ fontSize:13, fontWeight:500, color:'#ffffff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{account.name}</div>
      <div style={{ fontSize:11, color:'#3a8fd1', marginTop:2 }}>ID: {account.id}</div>
    </div>
  )
}

function AccountSkeleton() {
  return (
    <div style={{ padding:'8px 14px', display:'flex', flexDirection:'column', gap:5 }}>
      {[1,2,3].map(i => (
        <div key={i} style={{ padding:'8px 0' }}>
          <div className="skeleton" style={{ height:12, width:'75%', marginBottom:4 }} />
          <div className="skeleton" style={{ height:10, width:'45%' }} />
        </div>
      ))}
    </div>
  )
}

export default function Sidebar({ accounts, selectedAccount, onSelectAccount, onOpenSettings, hasCredentials, loading, error, activePath, onNavigate }) {
  const [accountsOpen, setAccountsOpen] = useState(false)

  function handleSelectAccount(acct) {
    onSelectAccount(acct)
    setAccountsOpen(false)
  }

  return (
    <div style={{ width:240, flexShrink:0, background:'#1a3a6b', display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden' }}>
      <div style={{ padding:'16px 12px', borderBottom:'1px solid #2563b0', flexShrink:0, textAlign:'center' }}>
        <Logo width={160} />
        <div style={{ marginTop:8, fontSize:15, fontWeight:700, color:'#ffffff', lineHeight:1.1 }}>GAds Dashboard</div>
        <div style={{ fontSize:11, color:'#3a8fd1', marginTop:2 }}>Top Ten Website Marketing</div>
      </div>

      <div style={{ flexShrink:0, padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
        {NAV.map(item => <NavItem key={item.path} {...item} activePath={activePath} onNavigate={onNavigate} />)}
      </div>

      {/* Account dropdown */}
      <div style={{ flexShrink:0, borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
        {/* Dropdown trigger — shows selected account */}
        <div
          onClick={() => setAccountsOpen(o => !o)}
          style={{
            padding:'10px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:8,
            background: accountsOpen ? 'rgba(37,99,176,0.4)' : 'transparent',
            transition:'background 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background='rgba(37,99,176,0.4)' }}
          onMouseLeave={e => { if (!accountsOpen) e.currentTarget.style.background='transparent' }}
        >
          {loading ? (
            <div style={{ flex:1 }}>
              <div className="skeleton" style={{ height:12, width:'70%', marginBottom:4 }} />
              <div className="skeleton" style={{ height:10, width:'45%' }} />
            </div>
          ) : selectedAccount ? (
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:600, color:'#ffffff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{selectedAccount.name}</div>
              <div style={{ fontSize:11, color:'#3a8fd1', marginTop:2 }}>ID: {selectedAccount.id}</div>
            </div>
          ) : (
            <div style={{ flex:1, fontSize:13, color:'rgba(255,255,255,0.4)' }}>Select account</div>
          )}
          <ChevronDown size={14} color="rgba(255,255,255,0.5)"
            style={{ flexShrink:0, transform: accountsOpen ? 'rotate(180deg)' : 'none', transition:'transform 0.15s' }} />
        </div>

        {/* Expanded account list */}
        {accountsOpen && (
          <div style={{ maxHeight:220, overflowY:'auto', borderTop:'1px solid rgba(255,255,255,0.08)' }}>
            {error && <div style={{ padding:'12px 14px', display:'flex', gap:8, color:'#e8a020', fontSize:12 }}><AlertCircle size={14} style={{ flexShrink:0, marginTop:1 }} />{error}</div>}
            {!error && accounts.length === 0 && <div style={{ padding:14, fontSize:12, color:'rgba(255,255,255,0.35)', lineHeight:1.5 }}>No accounts found.</div>}
            {!error && accounts.map(acct => (
              <AccountRow key={acct.id} account={acct} selected={selectedAccount?.id === acct.id} onSelect={handleSelectAccount} />
            ))}
          </div>
        )}
      </div>

      <div style={{ flex:1 }} />

      <div style={{ flexShrink:0, padding:'12px 16px', borderTop:'1px solid rgba(255,255,255,0.1)' }}>
        <button onClick={onOpenSettings} style={{
          width:'100%', display:'flex', alignItems:'center', gap:10,
          padding:'9px 12px', borderRadius:6, color:'rgba(255,255,255,0.7)', fontSize:13, fontWeight:500,
          background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', transition:'background 0.15s',
        }}
          onMouseEnter={e => { e.currentTarget.style.background='rgba(255,255,255,0.13)' }}
          onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.07)' }}
        >
          <Settings size={15} />
          <span style={{ flex:1, textAlign:'left' }}>Settings</span>
          {!hasCredentials && <span style={{ width:7, height:7, borderRadius:'50%', background:'#e8a020', flexShrink:0 }} />}
        </button>
      </div>
    </div>
  )
}
