import React, { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import Modal, { ModalError } from '../../components/Modal.jsx'
import { selectStyle } from '../campaign-manager/shared.jsx'
import { useReviewFlow, ReviewModal, btnPrimary } from '../campaign-manager/manage-panels/EditPanels.jsx'

const MATCH_TYPES = [{ value: 'BROAD', label: 'Broad' }, { value: 'PHRASE', label: 'Phrase' }, { value: 'EXACT', label: 'Exact' }]
const STATUSES = ['Active', 'Paused', 'Removed']

// One bulk action at a time — status OR match type, applied to every
// selected keyword — mirrors the single-keyword Manage modal's fields but
// keeps the two mutually exclusive here so the confirmation summary and the
// backend's per-field remove/recreate-vs-in-place-update logic stay simple
// and unambiguous for a whole batch at once.
export default function BulkKeywordModal({ keywords, selectedAccount, onClose, onSaved }) {
  const [field,     setField]     = useState('status') // 'status' | 'matchType'
  const [status,    setStatus]    = useState('Active')
  const [matchType, setMatchType] = useState('BROAD')

  const newStatus    = field === 'status'    ? status    : undefined
  const newMatchType = field === 'matchType' ? matchType : undefined

  const payload = {
    customerId: selectedAccount.id,
    keywords: keywords.map(k => ({ resourceName: k.resourceName, text: k.text, matchType: k.matchType, status: k.status, adGroupId: k.adGroupId })),
    newStatus, newMatchType,
  }

  const flow = useReviewFlow({
    validateFn: () => window.electronAPI.keywordManagerBulkUpdateKeywords({ ...payload, validateOnly: true }),
    publishFn:  () => window.electronAPI.keywordManagerBulkUpdateKeywords(payload),
  })

  return (
    <Modal title="Bulk Edit Keywords" subtitle={`${keywords.length} keyword${keywords.length === 1 ? '' : 's'} selected`} onClose={onClose} maxWidth={520}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#333', cursor: 'pointer' }}>
          <input type="radio" checked={field === 'status'} onChange={() => setField('status')} /> Change Status
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#333', cursor: 'pointer' }}>
          <input type="radio" checked={field === 'matchType'} onChange={() => setField('matchType')} /> Change Match Type
        </label>
      </div>

      {field === 'status' ? (
        <div style={{ minWidth: 160, marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>New Status</div>
          <select value={status} onChange={e => setStatus(e.target.value)} style={selectStyle}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      ) : (
        <div style={{ minWidth: 160, marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>New Match Type</div>
          <select value={matchType} onChange={e => setMatchType(e.target.value)} style={selectStyle}>
            {MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      )}

      <button style={btnPrimary} onClick={flow.start}>Review Changes</button>

      <ReviewModal title="Bulk Edit Keywords" subtitle={`${keywords.length} keyword${keywords.length === 1 ? '' : 's'}`} flow={flow} onDone={onSaved}>
        {field === 'status' && (
          <div style={{ fontSize: 12, color: '#555' }}>
            Set status to <strong>{status}</strong> for all {keywords.length} selected keyword{keywords.length === 1 ? '' : 's'}.
          </div>
        )}
        {field === 'matchType' && (
          <div style={{ fontSize: 12, color: '#555' }}>
            Change match type to <strong>{MATCH_TYPES.find(m => m.value === matchType)?.label}</strong> for all {keywords.length} selected keyword{keywords.length === 1 ? '' : 's'}.
          </div>
        )}
        {status === 'Removed' && field === 'status' && (
          <ModalError><AlertCircle size={14} style={{ marginRight: 6 }} /><strong>Removing keywords is permanent.</strong> Google Ads does not allow restoring a removed keyword.</ModalError>
        )}
      </ReviewModal>
    </Modal>
  )
}
