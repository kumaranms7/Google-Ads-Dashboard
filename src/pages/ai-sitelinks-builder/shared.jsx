import React, { useState } from 'react'
import { Loader2, Copy, Check } from 'lucide-react'

// ── Asset level (Account / Campaign / Ad Group) ───────────────────────────────

export const ASSET_LEVELS  = ['Account Level', 'Campaign Level', 'Ad Group Level']
export const DEFAULT_LEVEL = 'Ad Group Level'

// Maps a UI-facing level label to the backend's `level` param key
export function levelParam(assetLevel) {
  if (assetLevel === 'Account Level')  return 'account'
  if (assetLevel === 'Campaign Level') return 'campaign'
  return 'adGroup'
}

// ── Shared small components ────────────────────────────────────────────────────

export function NoAccount() {
  return (
    <div style={{ padding: 80, textAlign: 'center', color: '#aaa', fontSize: 14 }}>
      Select an account from the sidebar to use the AI Assets Builder.
    </div>
  )
}

export function Spinner({ label = 'Loading…', sub }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '40px 20px', color: '#888', fontSize: 13 }}>
      <Loader2 size={22} className="spin" color="#1a3a6b" />
      <div style={{ fontWeight: 600, color: '#1a3a6b' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: '#aaa' }}>{sub}</div>}
    </div>
  )
}

export function CopyBtn({ text }) {
  const [done, setDone] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000) }) }}
      title="Copy"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', fontSize: 10, fontWeight: 600, border: `1px solid ${done ? '#4caf50' : '#dde9f5'}`, borderRadius: 3, background: 'transparent', color: done ? '#2e7d32' : '#1a3a6b', cursor: 'pointer' }}>
      {done ? <Check size={10} /> : <Copy size={10} />}
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

export function charColor(len, max) {
  return len > max ? '#c0392b' : '#2e7d32'
}

export function EditableCell({ value, max, onChange, placeholder, multiline = false }) {
  const over = value.length > max
  const color = charColor(value.length, max)
  const base  = {
    width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 12,
    border: `1px solid ${over ? '#ffd5cc' : '#dde9f5'}`, borderRadius: 4,
    background: over ? '#fff5f5' : '#fff', outline: 'none', color: '#1a3a6b', resize: 'vertical',
    fontFamily: 'inherit',
  }
  return (
    <div style={{ position: 'relative' }}>
      {multiline
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={2} style={base} />
        : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={base} />
      }
      <span style={{ position: 'absolute', bottom: 4, right: 6, fontSize: 9, fontWeight: 600, color, pointerEvents: 'none' }}>
        {value.length}/{max}
      </span>
    </div>
  )
}

export function ScoreBadge({ score }) {
  const color = score >= 90 ? '#2e7d32' : score >= 75 ? '#4caf50' : score >= 55 ? '#e65100' : '#c0392b'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 36, height: 36, borderRadius: '50%', fontWeight: 700, fontSize: 12,
      background: `${color}18`, color, border: `2px solid ${color}44`, flexShrink: 0,
    }}>{score}</span>
  )
}

export const CTA_WORDS = ['free', 'book', 'schedule', 'call', 'get', 'contact', 'request', 'start', 'sign', 'try', 'quote', 'consult']

// ── Manage existing assets (Pause / Resume / Remove) ──────────────────────────
// Shared by every asset tab (Sitelinks, Headline, Description, Callout,
// Structured Snippet, Call) — they all ultimately link through the same
// customer_asset/campaign_asset/ad_group_asset family, so one Pause/Remove
// control (backed by rsa:updateAssetLinkStatus) works for all of them.
export function AssetManageActions({ selectedAccount, level, campaignId, adGroupId, linkResourceName, currentStatus, onChanged, onEdit }) {
  const [mode,  setMode]  = useState(null) // null | 'confirmPause' | 'confirmRemove'
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState(null)

  if (!linkResourceName || !selectedAccount) return null

  async function run(newStatus) {
    setBusy(true); setError(null)
    try {
      await window.electronAPI.rsaUpdateAssetLinkStatus({
        customerId: selectedAccount.id, level, campaignId, adGroupId, linkResourceName, status: newStatus,
      })
      onChanged?.(linkResourceName, newStatus)
    } catch (e) {
      setError(e.message || `Failed to ${newStatus === 'Removed' ? 'remove' : 'update'} this asset`)
    } finally {
      setBusy(false); setMode(null)
    }
  }

  if (busy) return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#888' }}><Loader2 size={10} className="spin" /> Working…</span>

  if (mode) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 10, color: '#c0392b', fontWeight: 600 }}>{mode === 'confirmPause' ? 'Pause?' : 'Remove?'}</span>
        <button onClick={() => run(mode === 'confirmPause' ? 'Paused' : 'Removed')}
          style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: '#c0392b', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}>
          Yes
        </button>
        <button onClick={() => setMode(null)}
          style={{ fontSize: 10, padding: '2px 7px', background: 'none', color: '#888', border: '1px solid #dde9f5', borderRadius: 3, cursor: 'pointer' }}>
          Cancel
        </button>
      </span>
    )
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {onEdit && (
        <button onClick={onEdit} title="Edit"
          style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: 'none', color: '#1a3a6b', border: '1px solid #dde9f5', borderRadius: 3, cursor: 'pointer' }}>
          Edit
        </button>
      )}
      {currentStatus === 'Paused' ? (
        <button onClick={() => run('Enabled')} title="Resume"
          style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: 'none', color: '#2e7d32', border: '1px solid #4caf50', borderRadius: 3, cursor: 'pointer' }}>
          Resume
        </button>
      ) : (
        <button onClick={() => setMode('confirmPause')} title="Pause"
          style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: 'none', color: '#a56700', border: '1px solid #f0b429', borderRadius: 3, cursor: 'pointer' }}>
          Pause
        </button>
      )}
      <button onClick={() => setMode('confirmRemove')} title="Remove"
        style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: 'none', color: '#c0392b', border: '1px solid #e05c2a', borderRadius: 3, cursor: 'pointer' }}>
        Remove
      </button>
      {error && <span style={{ fontSize: 9, color: '#c0392b' }}>{error}</span>}
    </span>
  )
}
