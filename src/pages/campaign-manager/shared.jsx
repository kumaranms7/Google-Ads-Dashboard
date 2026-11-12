import React, { useEffect, useState } from 'react'
import { Loader2, X, Sparkles, AlertCircle } from 'lucide-react'
import { resolveEnum, ADVERTISING_CHANNEL_TYPE } from '../../utils/enumMaps.js'

export function NoAccount() {
  return (
    <div style={{ padding: 80, textAlign: 'center', color: '#aaa', fontSize: 14 }}>
      Select an account from the sidebar to use Campaign Manager.
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

// Icon/color per advertising_channel_type — used for the Manage list's channel
// column and the Create wizard's channel-type picker (Phase 1+).
export const CHANNEL_TYPE_META = {
  Search:           { color: '#1a3a6b', bg: 'rgba(26,58,107,0.1)' },
  'Performance Max': { color: '#6a1b9a', bg: 'rgba(106,27,154,0.1)' },
  Display:          { color: '#0d7377', bg: 'rgba(13,115,119,0.1)' },
  Shopping:         { color: '#2e7d32', bg: 'rgba(46,125,50,0.1)' },
  Video:            { color: '#c0392b', bg: 'rgba(192,57,43,0.1)' },
  'Demand Gen':      { color: '#e65100', bg: 'rgba(230,81,0,0.1)' },
}

export function channelTypeLabel(raw) {
  return resolveEnum(ADVERTISING_CHANNEL_TYPE, raw, String(raw ?? ''))
}

// Active-first ordering for campaign/ad-group dropdowns across the app —
// Paused items sink below Active ones (Removed, if ever present, sinks
// further still), so the options a user is most likely to want are always
// at the top of the list rather than wherever the API happened to return
// them. Stable sort preserves each group's original relative order.
const STATUS_SORT_RANK = { Paused: 1, Removed: 2 }
export function sortByStatus(items, statusKey = 'status') {
  return [...(items || [])].sort((a, b) => (STATUS_SORT_RANK[a[statusKey]] || 0) - (STATUS_SORT_RANK[b[statusKey]] || 0))
}

export function ChannelTypeBadge({ channelType }) {
  const label = channelTypeLabel(channelType)
  const meta  = CHANNEL_TYPE_META[label] || { color: '#666', bg: 'rgba(150,150,150,0.12)' }
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: meta.color, background: meta.bg }}>
      {label}
    </span>
  )
}

export function formatMicros(micros) {
  return '$' + (Number(micros || 0) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function microsToDollars(micros) { return Number(micros || 0) / 1_000_000 }

// ── Bidding strategy — shared by the Create wizard and the Manage tab's BiddingPanel ──

export const BIDDING_STRATEGIES = [
  { value: 'MANUAL_CPC',                label: 'Manual CPC' },
  { value: 'MAXIMIZE_CONVERSIONS',      label: 'Maximize Conversions' },
  { value: 'MAXIMIZE_CONVERSION_VALUE', label: 'Maximize Conversion Value' },
  { value: 'TARGET_CPA',  label: 'Target CPA',  needsTarget: true, targetLabel: 'Target CPA ($)',  targetPlaceholder: 'e.g. 45' },
  { value: 'TARGET_ROAS', label: 'Target ROAS', needsTarget: true, targetLabel: 'Target ROAS (ratio, e.g. 4.0 = 400%)', targetPlaceholder: 'e.g. 4.0' },
]

export function biddingStrategyLabel(value) {
  return BIDDING_STRATEGIES.find(b => b.value === value)?.label || value || 'Manual CPC'
}

export function BiddingStrategyPicker({ value, targetValue, onChange, onTargetChange, strategies }) {
  const options = strategies || BIDDING_STRATEGIES
  const current = options.find(b => b.value === value) || options[0]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Bidding Strategy</div>
        <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>
          {options.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
      </div>
      {current.needsTarget && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>{current.targetLabel}</div>
          <input
            type="number" min="0" step="0.01"
            value={targetValue ?? ''} onChange={e => onTargetChange(e.target.value)}
            placeholder={current.targetPlaceholder}
            style={inputStyle}
          />
        </div>
      )}
    </div>
  )
}

// ── Location / language chip pickers — Create wizard's Targeting step and the
//    Manage tab's TargetingPanel share this ──────────────────────────────────

export const selectStyle = { width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: 13, border: '1px solid #dde9f5', borderRadius: 6, background: '#fff', color: '#1a3a6b', outline: 'none' }
export const inputStyle  = { width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: 13, border: '1px solid #dde9f5', borderRadius: 6, background: '#fff', color: '#1a3a6b', outline: 'none' }

// ── Bulk keyword paste — shared by the Create Campaign wizard's Ad Groups &
//    Keywords step, the Ad Group Manager's Create panel, and its Manage tab's
//    Keywords panel — anywhere a user builds up a keyword list one row at a
//    time normally, but may want to paste in a whole list at once instead.
const PASTE_MATCH_TYPES = [{ value: 'BROAD', label: 'Broad' }, { value: 'PHRASE', label: 'Phrase' }, { value: 'EXACT', label: 'Exact' }]

// Parses one pasted keyword per line. Recognises Google Ads Editor's own
// bracket/quote notation ([exact], "phrase") to auto-detect match type per
// line; anything plain falls back to whichever match type is selected in
// the paste box. Also strips a trailing match-type word if the user pasted
// straight out of a report/spreadsheet column (e.g. "roof repair  Broad").
export function parsePastedKeywords(text, defaultMatchType) {
  const MATCH_WORD = { broad: 'BROAD', phrase: 'PHRASE', exact: 'EXACT' }
  return text
    .split(/\r?\n/)
    .map(line => line.split(',')).flat() // also tolerate comma-separated on one line
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      if (line.startsWith('[') && line.endsWith(']')) return { text: line.slice(1, -1).trim(), matchType: 'EXACT' }
      if (line.startsWith('"') && line.endsWith('"')) return { text: line.slice(1, -1).trim(), matchType: 'PHRASE' }
      const trailingMatch = line.match(/^(.*\S)\s+(broad|phrase|exact)$/i)
      if (trailingMatch) return { text: trailingMatch[1].trim(), matchType: MATCH_WORD[trailingMatch[2].toLowerCase()] }
      return { text: line, matchType: defaultMatchType }
    })
    .filter(k => k.text)
}

// onAdd receives the parsed [{text, matchType}] array — the caller decides
// how to merge/dedupe it into whatever keyword list shape it owns.
export function KeywordPasteBox({ onAdd }) {
  const [open, setOpen]           = useState(false)
  const [text, setText]           = useState('')
  const [matchType, setMatchType] = useState('BROAD')

  const parsedCount = text.trim() ? parsePastedKeywords(text, matchType).length : 0

  function handleAdd() {
    const parsed = parsePastedKeywords(text, matchType)
    if (parsed.length === 0) return
    onAdd(parsed)
    setText(''); setOpen(false)
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ marginTop: 8, border: 'none', background: 'none', color: '#555', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        📋 Paste Keywords
      </button>
    )
  }

  return (
    <div style={{ flexBasis: '100%', marginTop: 6, padding: 10, background: '#fafcff', border: '1px solid #eef2f7', borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Paste keywords — one per line (or comma-separated). Use [brackets] for Exact or "quotes" for Phrase to set match type per line.</div>
      <textarea
        value={text} onChange={e => setText(e.target.value)}
        placeholder={'roof repair\n[emergency roof repair]\n"roof replacement cost"'}
        rows={5} autoFocus
        style={{ width: '100%', padding: '8px 10px', border: '1px solid #dde9f5', borderRadius: 6, fontSize: 12.5, color: '#1a3a6b', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#888' }}>Default match type:</span>
        <select value={matchType} onChange={e => setMatchType(e.target.value)} style={{ ...selectStyle, width: 110 }}>
          {PASTE_MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>{parsedCount} keyword{parsedCount !== 1 ? 's' : ''} detected</span>
        <button onClick={handleAdd} disabled={parsedCount === 0} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: '#1a3a6b', color: '#fff', cursor: parsedCount === 0 ? 'not-allowed' : 'pointer', opacity: parsedCount === 0 ? 0.4 : 1 }}>Add All</button>
        <button onClick={() => { setText(''); setOpen(false) }} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #dde9f5', background: '#fff', color: '#555', cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  )
}

function Chip({ text, onRemove, tone = 'default' }) {
  const colors = tone === 'danger'
    ? { bg: '#fff5f5', fg: '#c0392b', close: '#e08585' }
    : { bg: '#eaf1fb', fg: '#1a3a6b', close: '#7391b8' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 6px 3px 10px', borderRadius: 14, background: colors.bg, color: colors.fg, fontSize: 12, fontWeight: 500 }}>
      {text}
      <button onClick={onRemove} style={{ display: 'flex', border: 'none', background: 'none', cursor: 'pointer', color: colors.close, padding: 2 }}><X size={11} /></button>
    </span>
  )
}

/**
 * Type-to-filter chip picker. Pass either `searchFn(query) => Promise<items>`
 * for server-side debounced search (locations), or `staticOptions` for
 * client-side filtering of an already-fetched list (languages).
 * Items shape: { id, name, canonicalName? }.
 */
export function ChipPicker({ label, selected, onChange, placeholder, searchFn, staticOptions, emptyHint, tone = 'default' }) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (staticOptions) {
      const q = query.trim().toLowerCase()
      setResults(q ? staticOptions.filter(o => o.name.toLowerCase().includes(q)).slice(0, 15) : [])
      return
    }
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      searchFn(q)
        .then(r => { if (!cancelled) setResults(r || []) })
        .catch(() => { if (!cancelled) setResults([]) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, staticOptions])

  const add = (opt) => {
    if (!selected.some(s => String(s.id) === String(opt.id))) onChange([...selected, opt])
    setQuery('')
    setResults([])
  }
  const remove = (id) => onChange(selected.filter(s => String(s.id) !== String(id)))

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: tone === 'danger' ? '#c0392b' : '#555', marginBottom: 4 }}>{label}</div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {selected.map(s => <Chip key={s.id} text={s.canonicalName || s.name} onRemove={() => remove(s.id)} tone={tone} />)}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={placeholder} style={inputStyle} />
        {loading && <Loader2 size={13} className="spin" color="#888" style={{ position: 'absolute', right: 10, top: 9 }} />}
        {results.length > 0 && (
          <div style={{ position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #dde9f5', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxHeight: 220, overflowY: 'auto' }}>
            {results.map(r => (
              <div key={r.id} onClick={() => add(r)} style={{ padding: '7px 10px', fontSize: 12, color: '#1a3a6b', cursor: 'pointer', borderBottom: '1px solid #f4f7fc' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f4f7fc' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
              >
                {r.canonicalName || r.name}{r.targetType ? <span style={{ color: '#aaa', marginLeft: 6 }}>({r.targetType})</span> : ''}
              </div>
            ))}
          </div>
        )}
      </div>
      {emptyHint && selected.length === 0 && !query && <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{emptyHint}</div>}
    </div>
  )
}

// ── AI recommendations — Manage tab panels (StatusBudgetPanel, BiddingPanel,
//    TargetingPanel) each show inputs on the left and this on the right ──────

// Two-column layout: fixed-width AI rail on the right, inputs fill the rest.
export function PanelSplit({ left, right }) {
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 260px', minWidth: 240 }}>{left}</div>
      <div style={{ flex: '0 1 300px', minWidth: 260 }}>{right}</div>
    </div>
  )
}

function AIRecBox({ title, item }) {
  return (
    <div style={{ padding: '10px 12px', background: '#f7f5ff', border: '1px solid #e0d9fb', borderRadius: 7 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6a3fc0', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#3d2470', marginBottom: 3 }}>{item.recommendation}</div>
      {item.reasoning && <div style={{ fontSize: 11, color: '#6a5a94', lineHeight: 1.5 }}>{item.reasoning}</div>}
    </div>
  )
}

/**
 * Renders one or more AI recommendation boxes for a panel's right column.
 * `keys` picks which slice(s) of the shared AI response this panel shows —
 * e.g. StatusBudgetPanel passes ['status','budget'], TargetingPanel passes
 * ['targeting','language']. `titles` maps each key to a display label.
 */
export function AIRecommendationPanel({ loading, error, data, keys, titles }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#6a3fc0', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        <Sparkles size={12} /> AI Suggestion
      </div>
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888', padding: '10px 12px' }}>
          <Loader2 size={12} className="spin" /> Analyzing campaign…
        </div>
      )}
      {!loading && error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: '#c0392b', padding: '10px 12px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 7 }}>
          <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
        </div>
      )}
      {!loading && !error && data && keys.map(k => data[k] && (
        <AIRecBox key={k} title={titles[k]} item={data[k]} />
      ))}
    </div>
  )
}
