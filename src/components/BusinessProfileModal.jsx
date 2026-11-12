import React, { useState, useEffect } from 'react'
import { Building2, X, Search, Loader2, CheckCircle, AlertCircle, Plus, Trash2 } from 'lucide-react'

function makeId() {
  return `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function emptyWebsite() {
  return { id: makeId(), websiteUrl: '', advertiser: '', whatWeSell: '', updatedAt: '' }
}

// One website/brand card — an account can run more than one site through it
// (some clients advertise several businesses from a single Google Ads
// account), so this is a repeater rather than a single form.
function WebsiteCard({ website, index, onChange, onDetect, onSave, onRemove, detecting, saving, saved, error, removing, canRemove }) {
  return (
    <div style={{ border:'1px solid #dde9f5', borderRadius:8, padding:'14px 16px', display:'flex', flexDirection:'column', gap:12, position:'relative' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontSize:11, fontWeight:700, color:'#888', textTransform:'uppercase', letterSpacing:0.5 }}>Website {index + 1}</span>
        {canRemove && (
          <button
            onClick={onRemove}
            disabled={removing}
            title="Remove this website"
            style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:5, fontSize:11, fontWeight:600, color:'#c0392b', background:'transparent', border:'1px solid #ffd5cc', cursor: removing ? 'default' : 'pointer' }}
          >
            {removing ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />}
            Remove
          </button>
        )}
      </div>

      {/* Website URL + Detect */}
      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
        <label style={{ fontSize:12, fontWeight:600, color:'#1a3a6b' }}>Business Website</label>
        <div style={{ display:'flex', gap:8 }}>
          <input
            type="text"
            value={website.websiteUrl}
            onChange={e => onChange('websiteUrl', e.target.value)}
            placeholder="https://www.example.com"
            style={{ flex:1, height:36, padding:'0 12px', border:'1px solid #dde9f5', borderRadius:6, outline:'none', fontSize:13, color:'#1a3a6b' }}
          />
          <button
            onClick={onDetect}
            disabled={detecting || !website.websiteUrl.trim()}
            style={{
              display:'flex', alignItems:'center', gap:6, padding:'0 14px', height:36, borderRadius:6,
              background: detecting ? '#a9c6e8' : '#2563b0', color:'#fff', fontSize:13, fontWeight:600,
              border:'none', cursor: detecting || !website.websiteUrl.trim() ? 'default' : 'pointer', whiteSpace:'nowrap',
            }}
          >
            {detecting ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
            Detect
          </button>
        </div>
        <p style={{ fontSize:11, color:'#888', margin:0 }}>Scrapes the homepage to auto-fill the fields below — review and edit them after.</p>
      </div>

      {/* Advertiser */}
      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
        <label style={{ fontSize:12, fontWeight:600, color:'#1a3a6b' }}>Advertiser</label>
        <input
          type="text"
          value={website.advertiser}
          onChange={e => onChange('advertiser', e.target.value)}
          placeholder="Example website"
          style={{ height:36, padding:'0 12px', border:'1px solid #dde9f5', borderRadius:6, outline:'none', fontSize:13, color:'#1a3a6b' }}
        />
      </div>

      {/* What We Sell */}
      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
        <label style={{ fontSize:12, fontWeight:600, color:'#1a3a6b' }}>What We Sell</label>
        <textarea
          value={website.whatWeSell}
          onChange={e => onChange('whatWeSell', e.target.value)}
          placeholder="Describe what this website's business actually sells — its core products/services, who it typically serves, and anything that sets it apart (e.g. commercial security monitoring, live video monitoring, remote guarding, and surveillance services for businesses across the US, backed by 24/7 live agents)."
          rows={4}
          style={{ padding:'8px 12px', border:'1px solid #dde9f5', borderRadius:6, outline:'none', fontSize:13, color:'#1a3a6b', resize:'vertical', fontFamily:'inherit' }}
        />
      </div>

      {error && (
        <div style={{ display:'flex', gap:6, color:'#c0392b', fontSize:12, alignItems:'flex-start' }}>
          <AlertCircle size={14} style={{ flexShrink:0, marginTop:1 }} />{error}
        </div>
      )}

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
        <p style={{ fontSize:11, color:'#aaa', margin:0 }}>
          {website.updatedAt ? `Last updated ${new Date(website.updatedAt).toLocaleString()}` : 'Not saved yet'}
        </p>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderRadius:6, fontSize:12, fontWeight:600,
            color:'#fff', background: saved ? '#2e7d32' : '#1a3a6b', border:'none', cursor: saving ? 'default' : 'pointer', flexShrink:0,
          }}
        >
          {saving ? <Loader2 size={12} className="spin" /> : saved ? <CheckCircle size={12} /> : null}
          {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export default function BusinessProfileModal({ account, onClose }) {
  const [loading,   setLoading]   = useState(true)
  const [websites,  setWebsites]  = useState([])
  const [detecting, setDetecting] = useState({}) // id -> bool
  const [saving,    setSaving]    = useState({}) // id -> bool
  const [saved,     setSaved]     = useState({}) // id -> bool
  const [errors,    setErrors]    = useState({}) // id -> string
  const [removing,  setRemoving]  = useState({}) // id -> bool

  useEffect(() => {
    if (!account?.id) return
    let cancelled = false
    setLoading(true)
    window.electronAPI.accountGetProfile({ customerId: account.id })
      .then(list => { if (!cancelled) setWebsites(list || []) })
      .catch(() => { if (!cancelled) setWebsites([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [account?.id])

  function updateField(id, field, value) {
    setWebsites(prev => prev.map(w => w.id === id ? { ...w, [field]: value } : w))
  }

  function addWebsite() {
    setWebsites(prev => [...prev, emptyWebsite()])
  }

  async function handleRemove(id) {
    const website = websites.find(w => w.id === id)
    setRemoving(prev => ({ ...prev, [id]: true }))
    try {
      // Only hits the backend if this entry was ever actually saved — an
      // unsaved new card can just be dropped locally.
      if (website?.updatedAt) await window.electronAPI.accountDeleteProfile({ customerId: account.id, id })
      setWebsites(prev => prev.filter(w => w.id !== id))
    } catch (err) {
      setErrors(prev => ({ ...prev, [id]: err.message || 'Failed to remove' }))
    } finally {
      setRemoving(prev => ({ ...prev, [id]: false }))
    }
  }

  async function handleDetect(id) {
    const website = websites.find(w => w.id === id)
    if (!website?.websiteUrl?.trim()) { setErrors(prev => ({ ...prev, [id]: 'Enter a website URL first.' })); return }
    setDetecting(prev => ({ ...prev, [id]: true })); setErrors(prev => ({ ...prev, [id]: null }))
    try {
      const profile = await window.electronAPI.accountDetectProfile({ customerId: account.id, id, websiteUrl: website.websiteUrl.trim() })
      setWebsites(prev => prev.map(w => w.id === id ? profile : w))
    } catch (err) {
      setErrors(prev => ({ ...prev, [id]: err.message || 'Could not detect business profile from that website' }))
    } finally {
      setDetecting(prev => ({ ...prev, [id]: false }))
    }
  }

  async function handleSave(id) {
    const website = websites.find(w => w.id === id)
    setSaving(prev => ({ ...prev, [id]: true })); setErrors(prev => ({ ...prev, [id]: null })); setSaved(prev => ({ ...prev, [id]: false }))
    try {
      const profile = await window.electronAPI.accountSaveProfile({
        customerId: account.id, id,
        websiteUrl: website.websiteUrl.trim(), advertiser: website.advertiser.trim(), whatWeSell: website.whatWeSell.trim(),
      })
      setWebsites(prev => prev.map(w => w.id === id ? profile : w))
      setSaved(prev => ({ ...prev, [id]: true }))
      setTimeout(() => setSaved(prev => ({ ...prev, [id]: false })), 2000)
    } catch (err) {
      setErrors(prev => ({ ...prev, [id]: err.message || 'Failed to save business profile' }))
    } finally {
      setSaving(prev => ({ ...prev, [id]: false }))
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,20,50,0.65)', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:600, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.25)', overflow:'hidden' }}>
        {/* Header */}
        <div style={{ background:'#1a3a6b', padding:'16px 24px', display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0, position:'relative' }}>
          <button onClick={onClose} style={{ position:'absolute', top:12, right:16, color:'rgba(255,255,255,0.6)', display:'flex', alignItems:'center' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)' }}>
            <X size={18} />
          </button>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
            <Building2 size={16} color="rgba(255,255,255,0.8)" />
            <span style={{ color:'#fff', fontWeight:700, fontSize:15 }}>Business Profile</span>
          </div>
          <div style={{ fontSize:12, color:'#a9c6e8' }}>{account?.name} · ID: {account?.id}</div>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:14 }}>
          <p style={{ fontSize:12, color:'#666', margin:0, lineHeight:1.5 }}>
            Tells the AI who this client actually is and what they sell, so campaign/ad group names that describe
            a target industry (e.g. "Dealership") are never mistaken for the advertiser's own business. Used by
            AI RSA Builder and AI Assets Builder. If this account runs more than one website through it, add each
            one below — the app matches the right business to each ad group automatically by its landing page URL.
          </p>

          {loading ? (
            <div style={{ display:'flex', alignItems:'center', gap:8, color:'#888', fontSize:13, padding:'12px 0' }}>
              <Loader2 size={14} className="spin" /> Loading…
            </div>
          ) : (
            <>
              {websites.length === 0 && (
                <div style={{ fontSize:12, color:'#aaa', padding:'12px 0', textAlign:'center' }}>No websites added yet.</div>
              )}

              {websites.map((website, i) => (
                <WebsiteCard
                  key={website.id}
                  website={website}
                  index={i}
                  canRemove={websites.length > 0}
                  onChange={(field, value) => updateField(website.id, field, value)}
                  onDetect={() => handleDetect(website.id)}
                  onSave={() => handleSave(website.id)}
                  onRemove={() => handleRemove(website.id)}
                  detecting={!!detecting[website.id]}
                  saving={!!saving[website.id]}
                  saved={!!saved[website.id]}
                  error={errors[website.id]}
                  removing={!!removing[website.id]}
                />
              ))}

              <button
                onClick={addWebsite}
                style={{
                  display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'10px', borderRadius:8,
                  fontSize:12, fontWeight:600, color:'#2563b0', background:'#fafcff', border:'1px dashed #a9c6e8', cursor:'pointer',
                }}
              >
                <Plus size={14} /> Add Website
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ flexShrink:0, padding:'14px 24px', borderTop:'1px solid #eef2f7', display:'flex', justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ padding:'9px 16px', borderRadius:6, fontSize:13, fontWeight:600, color:'#666', background:'transparent', border:'1px solid #dde9f5' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
