import React, { useState, useEffect } from 'react'
import { Settings, Eye, EyeOff, Copy, ExternalLink, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

import logoAsset from '../assets/logo-white.webp'
const LOGO_URL = logoAsset

const FIELDS = [
  { key: 'mccCustomerId',     label: 'MCC Customer ID',    helper: 'Your top-level manager account ID (e.g. 123-456-7890)', placeholder: '123-456-7890',                  type: 'text'     },
  { key: 'developerToken',    label: 'Developer Token',    helper: 'From Google Ads API Center in your manager account',   placeholder: 'ABcDE_fGhIJkLmNoPQrsTu',       type: 'text'     },
  { key: 'oauthClientId',     label: 'OAuth Client ID',    helper: 'From Google Cloud Console → Credentials',             placeholder: '123456789-abc.apps.googleusercontent.com', type: 'text' },
  { key: 'oauthClientSecret', label: 'OAuth Client Secret',helper: 'Keep this secret — never share publicly',             placeholder: 'GOCSPX-...',                    type: 'text'     },
  { key: 'refreshToken',      label: 'Refresh Token',      helper: 'Generated via OAuth2 playground or your auth flow',   placeholder: '1//04...',                      type: 'password' },
]

function LogoHeader({ small }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <div style={{ color: '#3a8fd1', fontWeight: 700, fontSize: small ? 12 : 13, textAlign: 'center', marginBottom: small ? 6 : 10 }}>Top Ten Website Marketing</div>
  }
  return (
    <img
      src={LOGO_URL}
      alt="Top Ten Website Marketing"
      onError={() => setFailed(true)}
      style={{ display: 'block', margin: '0 auto', width: small ? 120 : 160, objectFit: 'contain', marginBottom: small ? 6 : 10 }}
    />
  )
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(value).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      title="Copy"
      style={{ padding: '0 8px', height: 36, display: 'flex', alignItems: 'center', color: copied ? '#4caf50' : '#888', flexShrink: 0, borderLeft: '1px solid #dde9f5', background: 'transparent' }}
    >
      {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
    </button>
  )
}

function FormField({ fieldDef, value, onChange, showToken, onToggleToken }) {
  const isPass    = fieldDef.type === 'password'
  const inputType = isPass && !showToken ? 'password' : 'text'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#1a3a6b' }}>{fieldDef.label}</label>
      <div
        style={{ display: 'flex', alignItems: 'center', border: '1px solid #dde9f5', borderRadius: 6, background: '#fff', overflow: 'hidden' }}
        onFocusCapture={e => { e.currentTarget.style.borderColor = '#2563b0' }}
        onBlurCapture={e  => { e.currentTarget.style.borderColor = '#dde9f5' }}
      >
        <input
          type={inputType}
          value={value}
          onChange={e => onChange(fieldDef.key, e.target.value)}
          placeholder={fieldDef.placeholder}
          style={{ flex: 1, height: 36, padding: '0 12px', border: 'none', outline: 'none', fontSize: 13, color: '#1a3a6b', background: 'transparent' }}
        />
        {isPass && (
          <button type="button" onClick={onToggleToken}
            style={{ padding: '0 8px', height: 36, color: '#888', borderLeft: '1px solid #dde9f5', background: 'transparent' }}
            title={showToken ? 'Hide' : 'Show'}>
            {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        <CopyButton value={value} />
      </div>
      <p style={{ fontSize: 11, color: '#888', margin: 0 }}>{fieldDef.helper}</p>
    </div>
  )
}

export default function SettingsModal({ settings, onSave, onClose, canClose }) {
  const [form,           setForm]          = useState({ mccCustomerId:'', developerToken:'', oauthClientId:'', oauthClientSecret:'', refreshToken:'', claudeApiKey:'', merchantCenterId:'' })
  const [showToken,      setShowToken]     = useState(false)
  const [showClaudeKey,  setShowClaudeKey] = useState(false)
  const [saving,         setSaving]        = useState(false)
  const [testError,      setTestError]     = useState(null)
  const [testSuccess,    setTestSuccess]   = useState(null)
  const [validationErr,  setValidationErr] = useState(null)

  useEffect(() => {
    if (settings) setForm({ mccCustomerId: settings.mccCustomerId||'', developerToken: settings.developerToken||'', oauthClientId: settings.oauthClientId||'', oauthClientSecret: settings.oauthClientSecret||'', refreshToken: settings.refreshToken||'', claudeApiKey: settings.claudeApiKey||'', merchantCenterId: settings.merchantCenterId||'' })
  }, [settings])

  function handleChange(key, val) { setForm(f => ({ ...f, [key]: val })); setValidationErr(null); setTestError(null) }

  async function handleSave() {
    const missing = FIELDS.filter(f => !form[f.key].trim()).map(f => f.label)
    if (missing.length) { setValidationErr(`Required: ${missing.join(', ')}`); return }
    setSaving(true); setTestError(null); setTestSuccess(null)
    try {
      await window.electronAPI.saveSettings(form)
      const accounts = await window.electronAPI.fetchAccounts()
      setTestSuccess(`Connected! Found ${accounts.length} account${accounts.length===1?'':'s'}.`)
      setTimeout(() => onSave(form, accounts), 1200)
    } catch (err) {
      setTestError(err.message || 'Could not connect. Check your credentials and try again.')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(10,20,50,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ background: '#1a3a6b', padding: '16px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, position: 'relative' }}>
          {canClose && (
            <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 16, color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#fff' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)' }}>
              <X size={18} />
            </button>
          )}
          <LogoHeader small />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <Settings size={16} color="rgba(255,255,255,0.8)" />
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Connect Google Ads Account</span>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {FIELDS.map(field => (
            <FormField key={field.key} fieldDef={field} value={form[field.key]} onChange={handleChange}
              showToken={showToken} onToggleToken={() => setShowToken(s => !s)} />
          ))}

          {/* AI Features divider */}
          <div style={{ display:'flex', alignItems:'center', gap:8, margin:'4px 0' }}>
            <div style={{ flex:1, height:1, background:'#dde9f5' }}/>
            <span style={{ fontSize:11, color:'#888', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px', whiteSpace:'nowrap' }}>AI Features (Optional)</span>
            <div style={{ flex:1, height:1, background:'#dde9f5' }}/>
          </div>

          {/* Claude API Key */}
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            <label style={{ fontSize:12, fontWeight:600, color:'#1a3a6b' }}>Claude API Key</label>
            <div
              style={{ display:'flex', alignItems:'center', border:'1px solid #dde9f5', borderRadius:6, background:'#fff', overflow:'hidden' }}
              onFocusCapture={e => { e.currentTarget.style.borderColor = '#2563b0' }}
              onBlurCapture={e  => { e.currentTarget.style.borderColor = '#dde9f5' }}
            >
              <input
                type={showClaudeKey ? 'text' : 'password'}
                value={form.claudeApiKey}
                onChange={e => handleChange('claudeApiKey', e.target.value)}
                placeholder="sk-ant-..."
                style={{ flex:1, height:36, padding:'0 12px', border:'none', outline:'none', fontSize:13, color:'#1a3a6b', background:'transparent' }}
              />
              <button type="button" onClick={() => setShowClaudeKey(s => !s)}
                style={{ padding:'0 8px', height:36, color:'#888', borderLeft:'1px solid #dde9f5', background:'transparent' }}
                title={showClaudeKey ? 'Hide' : 'Show'}>
                {showClaudeKey ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
              <CopyButton value={form.claudeApiKey}/>
            </div>
            <p style={{ fontSize:11, color:'#888', margin:0 }}>
              Powers the AI Keyword Planner. Get your key at{' '}
              <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer"
                style={{ color:'#2563b0', textDecoration:'none', display:'inline-flex', alignItems:'center', gap:2 }}>
                console.anthropic.com <ExternalLink size={10}/>
              </a>
            </p>
          </div>

          {/* Campaign Manager divider */}
          <div style={{ display:'flex', alignItems:'center', gap:8, margin:'4px 0' }}>
            <div style={{ flex:1, height:1, background:'#dde9f5' }}/>
            <span style={{ fontSize:11, color:'#888', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px', whiteSpace:'nowrap' }}>Campaign Manager (Optional)</span>
            <div style={{ flex:1, height:1, background:'#dde9f5' }}/>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            <label style={{ fontSize:12, fontWeight:600, color:'#1a3a6b' }}>Merchant Center ID</label>
            <input
              type="text"
              value={form.merchantCenterId}
              onChange={e => handleChange('merchantCenterId', e.target.value)}
              placeholder="e.g. 123456789"
              style={{ height:36, padding:'0 12px', border:'1px solid #dde9f5', borderRadius:6, outline:'none', fontSize:13, color:'#1a3a6b', background:'#fff' }}
            />
            <p style={{ fontSize:11, color:'#888', margin:0 }}>
              Required to create Shopping campaigns. Must already be linked to this Google Ads account in Merchant Center.
            </p>
          </div>

          {validationErr && <div style={{ display:'flex',gap:8,padding:'10px 14px',background:'#fff5f5',border:'1px solid #ffc5c5',borderRadius:6 }}><AlertCircle size={14} color="#e05c2a" style={{flexShrink:0,marginTop:1}}/><span style={{fontSize:12,color:'#c0392b'}}>{validationErr}</span></div>}
          {testError    && <div style={{ display:'flex',gap:8,padding:'10px 14px',background:'#fff5f5',border:'1px solid #ffc5c5',borderRadius:6 }}><AlertCircle size={14} color="#e05c2a" style={{flexShrink:0,marginTop:1}}/><span style={{fontSize:12,color:'#c0392b'}}>{testError}</span></div>}
          {testSuccess  && <div style={{ display:'flex',gap:8,padding:'10px 14px',background:'#f0faf0',border:'1px solid #a8e0a8',borderRadius:6 }}><CheckCircle size={14} color="#4caf50" style={{flexShrink:0,marginTop:1}}/><span style={{fontSize:12,color:'#2e7d32'}}>{testSuccess}</span></div>}
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid #dde9f5', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button onClick={handleSave} disabled={saving}
            style={{ width:'100%',padding:'11px 0',background:saving?'#c4830e':'#e8a020',color:'#1a3a6b',fontWeight:700,fontSize:14,borderRadius:7,border:'none',cursor:saving?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,transition:'background 0.15s' }}>
            {saving && <Loader2 size={15} className="spin" />}
            {saving ? 'Connecting…' : 'Save & Connect'}
          </button>
          <div style={{ textAlign: 'center' }}>
            <a href="https://developers.google.com/google-ads/api/docs/get-started/introduction" target="_blank" rel="noopener noreferrer"
              style={{ fontSize:12,color:'#2563b0',display:'inline-flex',alignItems:'center',gap:4,textDecoration:'none' }}>
              How to get these credentials <ExternalLink size={11} />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
