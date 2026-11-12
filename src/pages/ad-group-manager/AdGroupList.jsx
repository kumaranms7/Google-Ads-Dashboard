import React, { useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { formatMicros } from '../campaign-manager/shared.jsx'
import ReportTable from '../../components/ReportTable.jsx'
import EditPanel from './EditPanel.jsx'
import KeywordsPanel from './KeywordsPanel.jsx'

const STATUS_STYLE = {
  Active:  { bg: 'rgba(76,175,80,0.12)',   color: '#2e7d32', border: '1px solid rgba(76,175,80,0.3)'   },
  Paused:  { bg: 'rgba(224,92,42,0.12)',   color: '#c0392b', border: '1px solid rgba(224,92,42,0.3)'   },
  Removed: { bg: 'rgba(150,150,150,0.12)', color: '#666',    border: '1px solid rgba(150,150,150,0.3)' },
}

export default function AdGroupList({ selectedAccount, campaignId, campaignName, channelType, refreshSignal }) {
  // Create Ad Group and Keyword management are Search-only concepts (keyword
  // criteria, match types) that don't cleanly generalize to Display/Shopping/
  // Video ad groups — those channel types only get Name/Status/Bid editing
  // here for now.
  const isSearch = channelType === 'Search'
  const [adGroups,   setAdGroups]   = useState([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [showAll,    setShowAll]    = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  function refresh() {
    if (!selectedAccount || !campaignId) return
    setLoading(true); setError(null)
    window.electronAPI.adGroupList({ customerId: selectedAccount.id, campaignId, hidePaused: !showAll })
      .then(data => setAdGroups(data || []))
      .catch(err => setError(err.message || 'Failed to load ad groups'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { setSelectedId(null); refresh() }, [selectedAccount, campaignId, showAll])

  // A rollback triggered from the Recent Changes panel doesn't go through
  // this component, so it bumps this signal from the parent instead.
  const isFirstRefreshSignal = React.useRef(true)
  useEffect(() => {
    if (isFirstRefreshSignal.current) { isFirstRefreshSignal.current = false; return }
    refresh()
  }, [refreshSignal])

  const rows = adGroups
  const selected = rows.find(r => r.id === selectedId) || null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="card-header">
          <span className="card-title">Ad Groups — {campaignName}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555', cursor: 'pointer' }}>
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
              Show paused
            </label>
            <span style={{ fontSize: 11, color: '#888' }}>{rows.length} ad groups</span>
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
            emptyMessage="No ad groups found for this campaign."
            columns={[
              { key: 'name', label: 'Ad Group', sortable: true, align: 'left' },
              { key: 'status', label: 'Status', sortable: true, align: 'center',
                format: v => {
                  const ss = STATUS_STYLE[v] ?? STATUS_STYLE.Removed
                  return <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: ss.bg, color: ss.color, border: ss.border }}>{v}</span>
                } },
              { key: 'cpcBidMicros', label: 'Default Bid', sortable: true, align: 'right', format: v => formatMicros(v) },
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
          <EditPanel
            key={`edit-${selected.id}`}
            adGroup={selected}
            customerId={selectedAccount.id}
            onSaved={refresh}
          />
          {isSearch && (
            <KeywordsPanel
              key={`keywords-${selected.id}`}
              adGroup={selected}
              customerId={selectedAccount.id}
              siblingAdGroupNames={rows.filter(r => r.id !== selected.id).map(r => r.name)}
              onSaved={refresh}
            />
          )}
        </>
      )}
    </div>
  )
}
