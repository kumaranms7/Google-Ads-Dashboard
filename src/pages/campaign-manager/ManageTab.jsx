import React, { useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { resolveEnum, CAMPAIGN_STATUS, BIDDING_STRATEGY_TYPE } from '../../utils/enumMaps.js'
import { Spinner, ChannelTypeBadge, channelTypeLabel, formatMicros, microsToDollars } from './shared.jsx'
import ReportTable from '../../components/ReportTable.jsx'
import { StatusBudgetPanel, BiddingPanel, TargetingPanel } from './manage-panels/EditPanels.jsx'

// Builds the plain-language campaign summary sent to the AI recommendation
// call — resolves raw enum codes to human labels here so campaignClient.js
// doesn't need to duplicate the frontend's enum maps.
function buildAISummary(detail) {
  const locationCriteria = (detail.criteria || []).filter(c => c.type === '7' || c.type === 'LOCATION')
  const locations = locationCriteria.filter(c => !c.negative).map(c => c.geoTargetName).filter(Boolean).join(', ')
  const excludedLocations = locationCriteria.filter(c => c.negative).map(c => c.geoTargetName).filter(Boolean).join(', ')
  const languages  = (detail.criteria || []).filter(c => c.type === '20' || c.type === 'LANGUAGE').map(c => c.languageName).filter(Boolean).join(', ')
  return {
    name:            detail.name,
    channelType:     channelTypeLabel(detail.channelType),
    status:          resolveEnum(CAMPAIGN_STATUS, detail.status, detail.status),
    dailyBudget:     microsToDollars(detail.budgetMicros),
    biddingStrategy: resolveEnum(BIDDING_STRATEGY_TYPE, detail.biddingStrategy, detail.biddingStrategy),
    locations, excludedLocations, languages,
    performance: detail.performance,
  }
}

const STATUS_STYLE = {
  Active:  { bg: 'rgba(76,175,80,0.12)',  color: '#2e7d32', border: '1px solid rgba(76,175,80,0.3)'   },
  Paused:  { bg: 'rgba(224,92,42,0.12)',  color: '#c0392b', border: '1px solid rgba(224,92,42,0.3)'   },
  Removed: { bg: 'rgba(150,150,150,0.12)', color: '#666',   border: '1px solid rgba(150,150,150,0.3)' },
}

// Column set is deliberately different from components/CampaignTable.jsx —
// that table is performance-metrics-shaped (impressions/clicks/CPC/cost) for
// the Dashboard; this list is budget/bidding/targeting-shaped for management,
// and pulls no date-ranged performance data at all.
export default function ManageTab({ selectedAccount, refreshSignal }) {
  const [campaigns,   setCampaigns]   = useState([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [showAll,     setShowAll]     = useState(false) // Manage tab intentionally ignores the app-wide hidePaused toggle
  const [selectedId,  setSelectedId]  = useState(null)
  const [detail,        setDetail]        = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError,   setDetailError]   = useState(null)
  const [aiRec,         setAiRec]         = useState(null)
  const [aiRecLoading,  setAiRecLoading]  = useState(false)
  const [aiRecError,    setAiRecError]    = useState(null)

  function refresh() {
    if (!selectedAccount) return
    setLoading(true); setError(null)
    window.electronAPI.campaignList({ customerId: selectedAccount.id, hidePaused: !showAll })
      .then(data => setCampaigns(data || []))
      .catch(err => setError(err.message || 'Failed to load campaigns'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { setSelectedId(null); refresh() }, [selectedAccount, showAll])

  useEffect(() => {
    if (!selectedId || !selectedAccount) { setDetail(null); return }
    setDetailLoading(true); setDetailError(null); setDetail(null); setAiRec(null); setAiRecError(null)
    window.electronAPI.campaignGet({ customerId: selectedAccount.id, campaignId: selectedId })
      .then(setDetail)
      .catch(err => setDetailError(err.message || 'Failed to load campaign detail'))
      .finally(() => setDetailLoading(false))
  }, [selectedId, selectedAccount])

  function fetchAiRec(d) {
    setAiRecLoading(true); setAiRecError(null)
    window.electronAPI.campaignAiRecommend({ campaign: buildAISummary(d) })
      .then(setAiRec)
      .catch(err => setAiRecError(err.message || 'Failed to get AI recommendations'))
      .finally(() => setAiRecLoading(false))
  }

  // Fetch once per newly-loaded campaign detail — not on every keystroke in
  // the panels below, and not automatically re-run after a save (that would
  // mean a Claude call on every edit); use the manual refresh button instead.
  useEffect(() => { if (detail) fetchAiRec(detail) }, [detail?.id])

  function handleSaved() {
    refresh()
    if (selectedId && selectedAccount) {
      window.electronAPI.campaignGet({ customerId: selectedAccount.id, campaignId: selectedId }).then(setDetail).catch(() => {})
    }
  }

  // A rollback triggered from the Recent Changes panel doesn't go through
  // this component, so it bumps this signal from the parent instead —
  // re-pull the list and (if a campaign is open) its detail to reflect it.
  const isFirstRefreshSignal = React.useRef(true)
  useEffect(() => {
    if (isFirstRefreshSignal.current) { isFirstRefreshSignal.current = false; return }
    handleSaved()
  }, [refreshSignal])

  const rows = campaigns
  const selected = rows.find(r => r.id === selectedId) || null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="card-header">
          <span className="card-title">Campaigns</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555', cursor: 'pointer' }}>
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
              Show paused
            </label>
            <span style={{ fontSize: 11, color: '#888' }}>{rows.length} campaigns</span>
          </div>
        </div>

        {error && (
          <div style={{ margin: 12, padding: '10px 14px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 6, color: '#c0392b', fontSize: 12 }}>
            {error}
          </div>
        )}

        {error ? null : (
          <ReportTable
            loading={loading}
            pagination defaultPageSize={25}
            emptyMessage="No campaigns found for this account."
            columns={[
              { key: 'name', label: 'Campaign', sortable: true, align: 'left' },
              { key: 'status', label: 'Status', sortable: true, align: 'center',
                format: v => {
                  const statusLabel = resolveEnum(CAMPAIGN_STATUS, v, v)
                  const ss = STATUS_STYLE[statusLabel] ?? STATUS_STYLE.Removed
                  return <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: ss.bg, color: ss.color, border: ss.border }}>{statusLabel}</span>
                } },
              { key: 'channelType', label: 'Type', sortable: true, align: 'center',
                format: v => <ChannelTypeBadge channelType={v} /> },
              { key: 'budgetMicros', label: 'Daily Budget', sortable: true, align: 'right', format: v => formatMicros(v) },
              { key: 'biddingStrategy', label: 'Bidding Strategy', sortable: true, align: 'left',
                format: v => resolveEnum(BIDDING_STRATEGY_TYPE, v, v || '—') },
              { key: '_action', label: '', sortable: false, align: 'center',
                format: (_, row) => {
                  const active = row.id === selectedId
                  return (
                    <button
                      onClick={() => setSelectedId(row.id)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 11, fontWeight: 600,
                        borderRadius: 5, cursor: 'pointer',
                        border: active ? '1px solid #1a3a6b' : '1px solid #dde9f5',
                        background: active ? '#1a3a6b' : '#fff',
                        color: active ? '#fff' : '#1a3a6b',
                      }}
                    >
                      <Settings2 size={12} /> Manage
                    </button>
                  )
                } },
            ]}
            data={rows}
          />
        )}
      </div>

      {selected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a6b' }}>{selected.name}</div>
            {detail && (
              <button
                onClick={() => fetchAiRec(detail)}
                disabled={aiRecLoading}
                style={{ fontSize: 11, fontWeight: 600, color: '#6a3fc0', background: 'none', border: 'none', cursor: aiRecLoading ? 'not-allowed' : 'pointer', opacity: aiRecLoading ? 0.5 : 1 }}
              >
                ↻ Refresh AI recommendations
              </button>
            )}
          </div>
          {detailLoading ? (
            <Spinner label="Loading campaign detail…" />
          ) : detailError ? (
            <div style={{ padding: '10px 14px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 6, color: '#c0392b', fontSize: 12 }}>{detailError}</div>
          ) : detail ? (
            <>
              <StatusBudgetPanel campaign={detail} customerId={selectedAccount.id} onSaved={handleSaved} aiRec={aiRec} aiRecLoading={aiRecLoading} aiRecError={aiRecError} />
              <BiddingPanel      campaign={detail} customerId={selectedAccount.id} onSaved={handleSaved} aiRec={aiRec} aiRecLoading={aiRecLoading} aiRecError={aiRecError} />
              <TargetingPanel    campaign={detail} customerId={selectedAccount.id} onSaved={handleSaved} aiRec={aiRec} aiRecLoading={aiRecLoading} aiRecError={aiRecError} />
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
