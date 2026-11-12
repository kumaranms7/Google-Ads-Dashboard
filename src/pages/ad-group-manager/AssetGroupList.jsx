import React, { useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import ReportTable from '../../components/ReportTable.jsx'
import AssetGroupEditPanel from './AssetGroupEditPanel.jsx'
import AssetGroupContentPanel from './AssetGroupContentPanel.jsx'

const STATUS_STYLE = {
  Active:  { bg: 'rgba(76,175,80,0.12)',   color: '#2e7d32', border: '1px solid rgba(76,175,80,0.3)'   },
  Paused:  { bg: 'rgba(224,92,42,0.12)',   color: '#c0392b', border: '1px solid rgba(224,92,42,0.3)'   },
  Removed: { bg: 'rgba(150,150,150,0.12)', color: '#666',    border: '1px solid rgba(150,150,150,0.3)' },
}

const AD_STRENGTH_STYLE = {
  Excellent: { color: '#2e7d32' },
  Good:      { color: '#558b2f' },
  Average:   { color: '#b8860b' },
  Poor:      { color: '#c0392b' },
  'No Ads':  { color: '#999' },
  Pending:   { color: '#999' },
  '—':       { color: '#999' },
}

// Performance Max asset groups have no keywords, no per-group bid, and no
// concept of moving to a different campaign — Google's ML handles targeting
// automatically from the asset group's signals. So this list only offers
// Name/Status editing, unlike AdGroupList's fuller Search-oriented panel set.
export default function AssetGroupList({ selectedAccount, campaignId, campaignName, refreshSignal }) {
  const [assetGroups, setAssetGroups] = useState([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [showAll,    setShowAll]    = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  function refresh() {
    if (!selectedAccount || !campaignId) return
    setLoading(true); setError(null)
    window.electronAPI.assetGroupList({ customerId: selectedAccount.id, campaignId, hidePaused: !showAll })
      .then(data => setAssetGroups(data || []))
      .catch(err => setError(err.message || 'Failed to load asset groups'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { setSelectedId(null); refresh() }, [selectedAccount, campaignId, showAll])

  const isFirstRefreshSignal = React.useRef(true)
  useEffect(() => {
    if (isFirstRefreshSignal.current) { isFirstRefreshSignal.current = false; return }
    refresh()
  }, [refreshSignal])

  const rows = assetGroups
  const selected = rows.find(r => r.id === selectedId) || null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ padding: '10px 14px', background: '#eef4fc', border: '1px solid #dde9f5', borderRadius: 6, color: '#3a5a80', fontSize: 12 }}>
        Performance Max campaigns use <strong>asset groups</strong> instead of ad groups — Google's automation handles keyword/audience targeting, so there's nothing to manage here beyond each group's name, status, and creative.
      </div>

      <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="card-header">
          <span className="card-title">Asset Groups — {campaignName}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555', cursor: 'pointer' }}>
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
              Show paused
            </label>
            <span style={{ fontSize: 11, color: '#888' }}>{rows.length} asset groups</span>
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
            emptyMessage="No asset groups found for this campaign."
            columns={[
              { key: 'name', label: 'Asset Group', sortable: true, align: 'left' },
              { key: 'status', label: 'Status', sortable: true, align: 'center',
                format: v => {
                  const ss = STATUS_STYLE[v] ?? STATUS_STYLE.Removed
                  return <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: ss.bg, color: ss.color, border: ss.border }}>{v}</span>
                } },
              { key: 'adStrength', label: 'Ad Strength', sortable: true, align: 'center',
                format: v => {
                  const as = AD_STRENGTH_STYLE[v] ?? AD_STRENGTH_STYLE['—']
                  return <span style={{ fontWeight: 600, ...as }}>{v}</span>
                } },
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
        <>
          <AssetGroupEditPanel
            key={`edit-${selected.id}`}
            assetGroup={selected}
            customerId={selectedAccount.id}
            onSaved={refresh}
          />
          <AssetGroupContentPanel
            key={`content-${selected.id}`}
            assetGroup={selected}
            customerId={selectedAccount.id}
            onSaved={refresh}
          />
        </>
      )}
    </div>
  )
}
