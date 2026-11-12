import React, { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, History, RotateCcw } from 'lucide-react'
import Modal, { ModalError } from '../../components/Modal.jsx'
import { Spinner } from '../campaign-manager/shared.jsx'

const ACTION_LABEL = {
  create:          'Created',
  updateName:      'Name Changed',
  updateStatus:    'Status Changed',
  updateBid:       'Bid Changed',
  updateKeywords:  'Keywords Changed',
}

const ACTION_COLOR = {
  create:          { bg: 'rgba(46,125,50,0.1)',  color: '#2e7d32' },
  updateName:      { bg: 'rgba(74,74,74,0.1)',   color: '#555' },
  updateStatus:    { bg: 'rgba(26,58,107,0.1)',  color: '#1a3a6b' },
  updateBid:       { bg: 'rgba(230,81,0,0.1)',   color: '#e65100' },
  updateKeywords:  { bg: 'rgba(13,115,119,0.1)', color: '#0d7377' },
}

function entryLabel(entry) {
  return entry.type === 'assetGroup' ? entry.assetGroupName : entry.adGroupName
}

function EntrySummary({ entry }) {
  switch (entry.action) {
    case 'create':
      return <span>{entry.type === 'assetGroup' ? 'Asset' : 'Ad'} group "{entryLabel(entry)}" created.</span>
    case 'updateName':
      return <span>Name: <strong>{entry.before?.name}</strong> → <strong>{entry.after?.name}</strong></span>
    case 'updateStatus':
      return <span>Status: <strong>{entry.before?.status}</strong> → <strong>{entry.after?.status}</strong></span>
    case 'updateBid':
      return <span>Default Bid: <strong>${Number(entry.before?.cpcBid || 0).toFixed(2)}</strong> → <strong>${Number(entry.after?.cpcBid || 0).toFixed(2)}</strong></span>
    case 'updateKeywords':
      return <span>Keywords: <strong>{(entry.before?.keywords || []).length}</strong> → <strong>{(entry.after?.keywords || []).length}</strong></span>
    default:
      return <span>{entry.action}</span>
  }
}

export default function ChangelogPanel({ selectedAccount, onClose, onRolledBack }) {
  const [entries, setEntries]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [error,   setError]     = useState(null)
  const [rollingId, setRollingId] = useState(null)
  const [rollbackError, setRollbackError] = useState(null)

  function refresh() {
    setLoading(true); setError(null)
    Promise.all([
      window.electronAPI.adGroupGetChangelog({ customerId: selectedAccount.id }),
      window.electronAPI.assetGroupGetChangelog({ customerId: selectedAccount.id }),
    ])
      .then(([adGroupEntries, assetGroupEntries]) => {
        setEntries([...(adGroupEntries || []), ...(assetGroupEntries || [])].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)))
      })
      .catch(err => setError(err.message || 'Failed to load change history'))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [selectedAccount])

  async function handleRollback(entry) {
    const kind = entry.type === 'assetGroup' ? 'asset group' : 'ad group'
    if (!window.confirm(`Roll back this change to "${entryLabel(entry)}"?\n\n${entry.action === 'create' ? `This will pause the ${kind} that was created.` : 'This will restore the previous value.'}`)) return
    setRollingId(entry.id); setRollbackError(null)
    try {
      const rollbackFn = entry.type === 'assetGroup' ? window.electronAPI.assetGroupRollback : window.electronAPI.adGroupRollback
      await rollbackFn({ entryId: entry.id, customerId: selectedAccount.id })
      refresh()
      onRolledBack?.()
    } catch (err) {
      setRollbackError(err.message || 'Rollback failed')
    } finally {
      setRollingId(null)
    }
  }

  return (
    <Modal title="Recent Changes" subtitle={selectedAccount.name} onClose={onClose} maxWidth={640}>
      {rollbackError && <ModalError><AlertCircle size={14} style={{ marginRight: 6 }} />{rollbackError}</ModalError>}
      {error && <ModalError><AlertCircle size={14} style={{ marginRight: 6 }} />{error}</ModalError>}
      {loading ? (
        <Spinner label="Loading change history…" />
      ) : entries.length === 0 ? (
        <div style={{ padding: '30px 10px', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
          <History size={26} color="#dde9f5" style={{ marginBottom: 8 }} />
          <div>No changes recorded yet for this account.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '55vh', overflowY: 'auto' }}>
          {entries.map(entry => {
            const badge = ACTION_COLOR[entry.action] || { bg: '#eef2f7', color: '#555' }
            return (
              <div key={entry.id} style={{ padding: '10px 12px', border: '1px solid #eef2f7', borderRadius: 7, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: badge.bg, color: badge.color }}>
                      {ACTION_LABEL[entry.action] || entry.action}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1a3a6b' }}>{entryLabel(entry)}</span>
                  </div>
                  <span style={{ fontSize: 10, color: '#aaa' }}>{new Date(entry.timestamp).toLocaleString()}</span>
                </div>
                <div style={{ fontSize: 12, color: '#555', lineHeight: 1.6 }}><EntrySummary entry={entry} /></div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {entry.rolledBack ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#2e7d32', fontWeight: 600 }}>
                      <CheckCircle size={12} /> Rolled back {entry.rollbackAt ? new Date(entry.rollbackAt).toLocaleDateString() : ''}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleRollback(entry)}
                      disabled={rollingId === entry.id}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#c0392b', background: 'none', border: '1px solid #ffd5cc', borderRadius: 5, padding: '3px 10px', cursor: rollingId === entry.id ? 'not-allowed' : 'pointer', opacity: rollingId === entry.id ? 0.5 : 1 }}
                    >
                      <RotateCcw size={11} /> {rollingId === entry.id ? 'Rolling back…' : 'Rollback'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
