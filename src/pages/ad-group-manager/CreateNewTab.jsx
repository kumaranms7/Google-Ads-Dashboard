import React, { useEffect, useState } from 'react'
import { Spinner, selectStyle, channelTypeLabel, sortByStatus } from '../campaign-manager/shared.jsx'
import CreateAdGroupPanel from './CreateAdGroupPanel.jsx'
import CreateAssetGroupPanel from './CreateAssetGroupPanel.jsx'

// Same channel-type scope as ManageTab — Create Ad Group is Search-only
// (keyword criteria don't generalize to Display/Shopping/Video ad groups),
// Create Asset Group is Performance-Max-only.
const CREATABLE_CHANNEL_TYPES = ['Search', 'Performance Max']

export default function CreateNewTab({ selectedAccount }) {
  const [campaigns, setCampaigns] = useState([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [campaignId, setCampaignId] = useState('')
  const [existingAdGroupNames, setExistingAdGroupNames] = useState([])

  useEffect(() => {
    if (!selectedAccount) return
    setLoading(true); setError(null); setCampaignId('')
    window.electronAPI.campaignList({ customerId: selectedAccount.id, hidePaused: false })
      .then(data => setCampaigns(sortByStatus((data || []).filter(c => CREATABLE_CHANNEL_TYPES.includes(channelTypeLabel(c.channelType))))))
      .catch(err => setError(err.message || 'Failed to load campaigns'))
      .finally(() => setLoading(false))
  }, [selectedAccount])

  const selectedCampaign = campaigns.find(c => c.id === campaignId) || null
  const isSearch = selectedCampaign && channelTypeLabel(selectedCampaign.channelType) === 'Search'
  const isPMax   = selectedCampaign && channelTypeLabel(selectedCampaign.channelType) === 'Performance Max'

  useEffect(() => {
    if (!selectedAccount || !selectedCampaign || !isSearch) { setExistingAdGroupNames([]); return }
    window.electronAPI.adGroupList({ customerId: selectedAccount.id, campaignId: selectedCampaign.id, hidePaused: false })
      .then(data => setExistingAdGroupNames((data || []).map(ag => ag.name)))
      .catch(() => setExistingAdGroupNames([]))
  }, [selectedAccount, selectedCampaign, isSearch])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Campaign picker ── */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 6 }}>Campaign <span style={{ fontWeight: 400, color: '#aaa' }}>(Search or Performance Max)</span></div>
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
              <option key={c.id} value={c.id}>{c.name}{c.status === 'Paused' ? ' (Paused)' : ''} — {channelTypeLabel(c.channelType)}</option>
            ))}
          </select>
        )}
      </div>

      {selectedCampaign && isSearch && (
        <CreateAdGroupPanel
          key={selectedCampaign.id}
          selectedAccount={selectedAccount}
          campaignId={selectedCampaign.id}
          campaignName={selectedCampaign.name}
          existingAdGroupNames={existingAdGroupNames}
          onClose={() => setCampaignId('')}
          onCreated={() => {}}
        />
      )}

      {selectedCampaign && isPMax && (
        <CreateAssetGroupPanel
          key={selectedCampaign.id}
          selectedAccount={selectedAccount}
          campaignId={selectedCampaign.id}
          campaignName={selectedCampaign.name}
          onClose={() => setCampaignId('')}
          onCreated={() => {}}
        />
      )}
    </div>
  )
}
