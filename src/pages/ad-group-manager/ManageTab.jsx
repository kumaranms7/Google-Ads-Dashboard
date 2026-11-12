import React, { useEffect, useState } from 'react'
import { Spinner, selectStyle, channelTypeLabel, sortByStatus } from '../campaign-manager/shared.jsx'
import AdGroupList from './AdGroupList.jsx'
import AssetGroupList from './AssetGroupList.jsx'

// Campaign picker covers Search/Display/Shopping/Video (real ad groups) plus
// Performance Max (asset groups — a different resource, rendered via
// AssetGroupList instead of AdGroupList below). Name/Status/Bid editing is
// generic across the four ad-group types (ad_group.name/status/cpc_bid_micros
// aren't Search-specific fields), but Keyword management stays Search-only
// in AdGroupList/EditPanel — that concept doesn't cleanly generalize
// (Display ad groups don't use keywords, Shopping ad groups use listing
// groups, Video ad groups use different targeting entirely).
const MANAGEABLE_CHANNEL_TYPES = ['Search', 'Display', 'Shopping', 'Video', 'Performance Max']

export default function ManageTab({ selectedAccount, refreshSignal }) {
  const [campaigns, setCampaigns] = useState([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [campaignId, setCampaignId] = useState('')

  useEffect(() => {
    if (!selectedAccount) return
    setLoading(true); setError(null); setCampaignId('')
    window.electronAPI.campaignList({ customerId: selectedAccount.id, hidePaused: false })
      .then(data => setCampaigns(sortByStatus((data || []).filter(c => MANAGEABLE_CHANNEL_TYPES.includes(channelTypeLabel(c.channelType))))))
      .catch(err => setError(err.message || 'Failed to load campaigns'))
      .finally(() => setLoading(false))
  }, [selectedAccount])

  const selectedCampaign = campaigns.find(c => c.id === campaignId) || null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Campaign picker ── */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 6 }}>Campaign <span style={{ fontWeight: 400, color: '#aaa' }}>(Search, Display, Shopping, Video, and Performance Max)</span></div>
        {loading ? (
          <Spinner label="Loading campaigns…" />
        ) : error ? (
          <div style={{ color: '#c0392b', fontSize: 12 }}>{error}</div>
        ) : campaigns.length === 0 ? (
          <div style={{ color: '#aaa', fontSize: 12 }}>No eligible campaigns found for this account.</div>
        ) : (
          <select value={campaignId} onChange={e => setCampaignId(e.target.value)} style={{ ...selectStyle, maxWidth: 420 }}>
            <option value="">Select a campaign…</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.status === 'Paused' ? ' (Paused)' : ''}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Ad groups / asset groups for the selected campaign ── */}
      {selectedCampaign && (
        channelTypeLabel(selectedCampaign.channelType) === 'Performance Max' ? (
          <AssetGroupList
            selectedAccount={selectedAccount}
            campaignId={selectedCampaign.id}
            campaignName={selectedCampaign.name}
            refreshSignal={refreshSignal}
          />
        ) : (
          <AdGroupList
            selectedAccount={selectedAccount}
            campaignId={selectedCampaign.id}
            campaignName={selectedCampaign.name}
            channelType={channelTypeLabel(selectedCampaign.channelType)}
            refreshSignal={refreshSignal}
          />
        )
      )}
    </div>
  )
}
