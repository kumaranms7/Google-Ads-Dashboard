import React, { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, History, RotateCcw } from 'lucide-react'
import Modal, { ModalError } from '../../components/Modal.jsx'
import { resolveEnum, BIDDING_STRATEGY_TYPE } from '../../utils/enumMaps.js'
import { Spinner } from './shared.jsx'

const ACTION_LABEL = {
  create:           'Created',
  updateName:       'Name Changed',
  updateStatus:     'Status Changed',
  updateBudget:     'Budget Changed',
  updateBidding:    'Bidding Changed',
  updateTargeting:  'Targeting Changed',
  updateEndDate:    'End Date Changed',
}

const ACTION_COLOR = {
  create:          { bg: 'rgba(46,125,50,0.1)',  color: '#2e7d32' },
  updateName:      { bg: 'rgba(74,74,74,0.1)',   color: '#555' },
  updateStatus:    { bg: 'rgba(26,58,107,0.1)',  color: '#1a3a6b' },
  updateBudget:    { bg: 'rgba(230,81,0,0.1)',   color: '#e65100' },
  updateBidding:   { bg: 'rgba(106,27,154,0.1)', color: '#6a1b9a' },
  updateTargeting: { bg: 'rgba(13,115,119,0.1)', color: '#0d7377' },
  updateEndDate:   { bg: 'rgba(0,121,107,0.1)',  color: '#00796b' },
}

function locNames(list) { return (list || []).map(l => l.canonicalName || l.name).filter(Boolean).join(', ') || 'none' }

function EntrySummary({ entry }) {
  switch (entry.action) {
    case 'create':
      return <span>Campaign "{entry.campaignName}" created.</span>
    case 'updateName':
      return <span>Name: <strong>{entry.before?.name}</strong> → <strong>{entry.after?.name}</strong></span>
    case 'updateStatus':
      return <span>Status: <strong>{entry.before?.status}</strong> → <strong>{entry.after?.status}</strong></span>
    case 'updateBudget':
      return <span>Daily Budget: <strong>${Number(entry.before?.dailyBudget || 0).toFixed(2)}</strong> → <strong>${Number(entry.after?.dailyBudget || 0).toFixed(2)}</strong></span>
    case 'updateBidding':
      return <span>Bidding: <strong>{resolveEnum(BIDDING_STRATEGY_TYPE, entry.before?.biddingStrategy, entry.before?.biddingStrategy || '—')}</strong> → <strong>{resolveEnum(BIDDING_STRATEGY_TYPE, entry.after?.biddingStrategy, entry.after?.biddingStrategy || '—')}</strong></span>
    case 'updateTargeting':
      return <span>Locations: <strong>{locNames(entry.before?.locations)}</strong> → <strong>{locNames(entry.after?.locations)}</strong><br />Languages: <strong>{locNames(entry.before?.languages)}</strong> → <strong>{locNames(entry.after?.languages)}</strong></span>
    case 'updateEndDate':
      return <span>End Date: <strong>{entry.before?.endDate || 'None'}</strong> → <strong>{entry.after?.endDate || 'None'}</strong></span>
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
    window.electronAPI.campaignGetChangelog({ customerId: selectedAccount.id })
      .then(setEntries)
      .catch(err => setError(err.message || 'Failed to load change history'))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [selectedAccount])

  async function handleRollback(entry) {
    if (!window.confirm(`Roll back this change to "${entry.campaignName}"?\n\n${entry.action === 'create' ? 'This will pause the campaign that was created.' : 'This will restore the previous value.'}`)) return
    setRollingId(entry.id); setRollbackError(null)
    try {
      await window.electronAPI.campaignRollback({ entryId: entry.id, customerId: selectedAccount.id })
      refresh()
      onRolledBack?.()
    } catch (err) {
      setRollbackError(err.message || 'Rollback failed')
    } finally {
      setRollingId(null)
    }
  }

  return (
    <Modal title="Recent Campaign Changes" subtitle={selectedAccount.name} onClose={onClose} maxWidth={640}>
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
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1a3a6b' }}>{entry.campaignName}</span>
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
