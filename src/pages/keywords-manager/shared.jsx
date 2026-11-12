import React, { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { NoAccount, Spinner, selectStyle, channelTypeLabel, sortByStatus } from '../campaign-manager/shared.jsx'

export { NoAccount, Spinner, selectStyle, channelTypeLabel }

// ── Formatting helpers (mirrors Keywords.jsx's local versions — not exported
//    there, so duplicated here rather than refactoring that file) ────────────

export const fmtNum = v => Number(v || 0).toLocaleString()
export const fmtUsd = v => '$' + Number(v || 0).toFixed(2)
export const fmtPct = v => Number(v || 0).toFixed(2) + '%'
export const fmtCostPerConv = (cost, conversions) => Number(conversions || 0) > 0 ? fmtUsd(Number(cost || 0) / Number(conversions)) : '-'
export const qsColor = s => (s >= 7 ? '#4caf50' : s >= 4 ? '#f0b429' : '#e05c2a')

// Parses a bulk-pasted keyword/negative-keyword list, one term per line,
// using the Google Ads Editor match-type convention: [bracketed] = Exact,
// "quoted" = Phrase, plain text = Broad. Blank lines are ignored; the
// wrapping brackets/quotes and surrounding whitespace are stripped from
// the term itself.
export function parseKeywordPasteText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      if (line.length >= 2 && line.startsWith('[') && line.endsWith(']')) {
        return { text: line.slice(1, -1).trim(), matchType: 'EXACT' }
      }
      if (line.length >= 2 && line.startsWith('"') && line.endsWith('"')) {
        return { text: line.slice(1, -1).trim(), matchType: 'PHRASE' }
      }
      return { text: line, matchType: 'BROAD' }
    })
    .filter(r => r.text)
}

// Keyword text color by status — same mapping as Keywords.jsx's kwStatusColor.
export function kwStatusColor(status) {
  const s = String(status || '')
  if (s === 'Enabled' || s === 'Active' || s === 'Eligible') return '#2e7d32'
  if (s === 'Paused') return '#a56700'
  if (s === 'Removed') return '#9e9e9e'
  return '#1a3a6b'
}

export const RECOMMENDATION_STYLE = {
  Keep:     { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' },
  Optimize: { bg: '#fff3e0', text: '#a56700', border: '#f0b429' },
  Pause:    { bg: '#fdecea', text: '#c62828', border: '#e05c2a' },
  Monitor:  { bg: '#f5f5f5', text: '#4a4a4a', border: '#9e9e9e' },
}

export function RecommendationBadge({ value }) {
  const s = RECOMMENDATION_STYLE[value] || RECOMMENDATION_STYLE.Monitor
  return (
    <span style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}`, borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 600, display: 'inline-block', whiteSpace: 'nowrap' }}>
      {value}
    </span>
  )
}

export const LEAD_POTENTIAL_STYLE = {
  High:   { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' },
  Medium: { bg: '#fff3e0', text: '#a56700', border: '#f0b429' },
  Low:    { bg: '#f5f5f5', text: '#4a4a4a', border: '#9e9e9e' },
}

export function LeadPotentialBadge({ value }) {
  const s = LEAD_POTENTIAL_STYLE[value] || LEAD_POTENTIAL_STYLE.Medium
  return (
    <span style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}`, borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 600, display: 'inline-block', whiteSpace: 'nowrap' }}>
      {value}
    </span>
  )
}

// ── Cascading campaign → ad group picker ──────────────────────────────────────
// Keywords are a Search construct. Performance Max campaigns are included in
// the campaign list (per user request) since they're real campaigns staff
// need to find, but PMax has no ad groups and no keyword criteria at all —
// Google's automation selects targeting from the asset group's signals — so
// when a PMax campaign is selected the Ad Group select is replaced with an
// explanatory message instead of a dropdown that would always be empty.

export function CampaignAdGroupPicker({ selectedAccount, campaignId, adGroupId, onChangeCampaign, onChangeAdGroup, disabled }) {
  const [campaigns,       setCampaigns]       = useState([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  const [campaignsError,  setCampaignsError]  = useState(null)
  const [adGroups,        setAdGroups]        = useState([])
  const [adGroupsLoading, setAdGroupsLoading] = useState(false)
  const [adGroupsError,   setAdGroupsError]   = useState(null)

  const selectedCampaign = campaigns.find(c => c.id === campaignId) || null
  const isPerformanceMax = selectedCampaign && channelTypeLabel(selectedCampaign.channelType) === 'Performance Max'

  useEffect(() => {
    if (!selectedAccount) return
    setCampaignsLoading(true); setCampaignsError(null)
    window.electronAPI.campaignList({ customerId: selectedAccount.id, hidePaused: false })
      .then(data => setCampaigns(sortByStatus((data || []).filter(c => ['Search', 'Performance Max'].includes(channelTypeLabel(c.channelType))))))
      .catch(err => setCampaignsError(err.message || 'Failed to load campaigns'))
      .finally(() => setCampaignsLoading(false))
  }, [selectedAccount])

  useEffect(() => {
    if (!selectedAccount || !campaignId || isPerformanceMax) { setAdGroups([]); return }
    setAdGroupsLoading(true); setAdGroupsError(null)
    window.electronAPI.adGroupList({ customerId: selectedAccount.id, campaignId, hidePaused: false })
      .then(data => setAdGroups(sortByStatus(data || [])))
      .catch(err => setAdGroupsError(err.message || 'Failed to load ad groups'))
      .finally(() => setAdGroupsLoading(false))
  }, [selectedAccount, campaignId, isPerformanceMax])

  function handleCampaignChange(id) {
    onChangeCampaign(id, campaigns.find(c => c.id === id) || null)
    onChangeAdGroup('', null)
  }
  function handleAdGroupChange(id) {
    onChangeAdGroup(id, adGroups.find(a => a.id === id) || null)
  }

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div style={{ minWidth: 240 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Campaign</div>
        {campaignsLoading ? (
          <div style={{ fontSize: 12, color: '#aaa', padding: '7px 0' }}>Loading…</div>
        ) : campaignsError ? (
          <div style={{ fontSize: 12, color: '#c0392b' }}>{campaignsError}</div>
        ) : (
          <select value={campaignId} onChange={e => handleCampaignChange(e.target.value)} disabled={disabled} style={selectStyle}>
            <option value="">Select a campaign…</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.status === 'Paused' ? ' (Paused)' : ''}{channelTypeLabel(c.channelType) === 'Performance Max' ? ' — Performance Max' : ''}</option>
            ))}
          </select>
        )}
      </div>
      {isPerformanceMax ? (
        <div style={{ flex: 1, minWidth: 280, padding: '9px 12px', background: '#eef4fc', border: '1px solid #dde9f5', borderRadius: 6, color: '#3a5a80', fontSize: 12 }}>
          Performance Max campaigns don't use ad groups or keywords — Google's automation handles targeting from the asset group's signals, so there's nothing to manage here.
        </div>
      ) : (
        <div style={{ minWidth: 240 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Ad Group</div>
          {adGroupsLoading ? (
            <div style={{ fontSize: 12, color: '#aaa', padding: '7px 0' }}>Loading…</div>
          ) : adGroupsError ? (
            <div style={{ fontSize: 12, color: '#c0392b' }}>{adGroupsError}</div>
          ) : (
            <select value={adGroupId} onChange={e => handleAdGroupChange(e.target.value)} disabled={disabled || !campaignId} style={selectStyle}>
              <option value="">{campaignId ? 'Select an ad group…' : 'Select a campaign first'}</option>
              {adGroups.map(ag => (
                <option key={ag.id} value={ag.id}>{ag.name}{ag.status === 'Paused' ? ' (Paused)' : ''}</option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  )
}

// ── Lightweight pagination for custom (non-ReportTable) tables ───────────────
// Same page-size options and visual style as ReportTable's built-in footer,
// for tables (AI suggestion lists with checkbox selection) that can't just
// drop in ReportTable without losing their selection/publish behavior.
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250]

export function usePagination(defaultSize = 25) {
  const [page,     setPage]     = useState(0)
  const [pageSize, setPageSize] = useState(defaultSize)
  return { page, pageSize, setPage, setPageSize: s => { setPageSize(s); setPage(0) } }
}

function pgBtnStyle(disabled) {
  return { padding: '4px 10px', fontSize: 12, fontWeight: 600, border: '1px solid #dde9f5', borderRadius: 5,
    background: disabled ? '#f5f7fa' : '#fff', color: disabled ? '#aaa' : '#1a3a6b', cursor: disabled ? 'not-allowed' : 'pointer' }
}

export function PaginationFooter({ page, pageSize, total, onPageChange, onPageSizeChange }) {
  if (!total) return null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = page * pageSize
  const end   = Math.min(start + pageSize, total)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid #f0f4f8', flexWrap: 'wrap', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#888' }}>Rows per page:</span>
        <select value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))}
          style={{ padding: '4px 8px', border: '1px solid #dde9f5', borderRadius: 5, fontSize: 12, color: '#1a3a6b', outline: 'none', cursor: 'pointer' }}>
          {PAGE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: '#888' }}>{start + 1}–{end} of {total}</span>
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => onPageChange(0)} disabled={page === 0} style={pgBtnStyle(page === 0)}>«</button>
            <button onClick={() => onPageChange(Math.max(0, page - 1))} disabled={page === 0} style={pgBtnStyle(page === 0)}>‹ Prev</button>
            <span style={{ padding: '4px 10px', fontSize: 12, color: '#555', border: '1px solid #dde9f5', borderRadius: 5, background: '#f5f7fa' }}>{page + 1} / {totalPages}</span>
            <button onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={pgBtnStyle(page >= totalPages - 1)}>Next ›</button>
            <button onClick={() => onPageChange(totalPages - 1)} disabled={page >= totalPages - 1} style={pgBtnStyle(page >= totalPages - 1)}>»</button>
          </div>
        )}
      </div>
    </div>
  )
}

export function EmptyPickerHint({ children }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: '#aaa', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <Search size={22} color="#dde9f5" />
      {children}
    </div>
  )
}
