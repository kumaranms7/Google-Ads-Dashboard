import React, { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { ModalError } from '../../components/Modal.jsx'
import { formatMicros, microsToDollars, inputStyle, selectStyle } from '../campaign-manager/shared.jsx'
import { useReviewFlow, ReviewModal, btnPrimary } from '../campaign-manager/manage-panels/EditPanels.jsx'

export default function EditPanel({ adGroup, customerId, onSaved }) {
  const [name,   setName]   = useState(adGroup.name)
  const [status, setStatus] = useState(adGroup.status)
  const [cpcBid, setCpcBid] = useState(String(microsToDollars(adGroup.cpcBidMicros)))

  const nameChanged   = name.trim() !== adGroup.name && name.trim().length > 0
  const statusChanged = status !== adGroup.status
  const bidChanged     = Number(cpcBid) !== microsToDollars(adGroup.cpcBidMicros)
  const dirty = nameChanged || statusChanged || bidChanged

  const flow = useReviewFlow({
    validateFn: async () => {
      if (nameChanged)   await window.electronAPI.adGroupUpdateName({ customerId, adGroupId: adGroup.id, name: name.trim(), validateOnly: true })
      if (statusChanged) await window.electronAPI.adGroupUpdateStatus({ customerId, adGroupId: adGroup.id, status, validateOnly: true })
      if (bidChanged)    await window.electronAPI.adGroupUpdateBid({ customerId, adGroupId: adGroup.id, cpcBid: Number(cpcBid), validateOnly: true })
    },
    publishFn: async () => {
      const results = []
      if (nameChanged)   results.push(await window.electronAPI.adGroupUpdateName({ customerId, adGroupId: adGroup.id, name: name.trim(), before: { name: adGroup.name } }))
      if (statusChanged) results.push(await window.electronAPI.adGroupUpdateStatus({ customerId, adGroupId: adGroup.id, adGroupName: name.trim() || adGroup.name, status, before: { status: adGroup.status } }))
      if (bidChanged)    results.push(await window.electronAPI.adGroupUpdateBid({ customerId, adGroupId: adGroup.id, adGroupName: name.trim() || adGroup.name, cpcBid: Number(cpcBid), before: { cpcBid: microsToDollars(adGroup.cpcBidMicros) } }))
      return results
    },
  })

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Name, Status &amp; Default Bid</div>

      <div style={{ marginBottom: 16, maxWidth: 340 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Ad Group Name</div>
        <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 160 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Status</div>
          <select value={status} onChange={e => setStatus(e.target.value)} style={selectStyle}>
            <option value="Active">Active</option>
            <option value="Paused">Paused</option>
            <option value="Removed">Removed</option>
          </select>
        </div>
        <div style={{ minWidth: 160 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Default Bid ($)</div>
          <input type="number" min="0" step="0.01" value={cpcBid} onChange={e => setCpcBid(e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <button style={{ ...btnPrimary, opacity: dirty ? 1 : 0.4, cursor: dirty ? 'pointer' : 'not-allowed' }} disabled={!dirty} onClick={flow.start}>Save Changes</button>
      </div>

      <ReviewModal title="Update Ad Group" subtitle={adGroup.name} flow={flow} canConfirmExtra={dirty} onDone={onSaved}>
        {nameChanged   && <div style={{ fontSize: 12, color: '#555' }}>Name: <strong>{adGroup.name}</strong> → <strong>{name.trim()}</strong></div>}
        {statusChanged && <div style={{ fontSize: 12, color: '#555' }}>Status: <strong>{adGroup.status}</strong> → <strong>{status}</strong></div>}
        {bidChanged    && <div style={{ fontSize: 12, color: '#555' }}>Default Bid: <strong>{formatMicros(adGroup.cpcBidMicros)}</strong> → <strong>${Number(cpcBid).toFixed(2)}</strong></div>}
        {statusChanged && status === 'Removed' && (
          <ModalError><AlertCircle size={14} style={{ marginRight: 6 }} /><strong>Removing an ad group is permanent.</strong> Google Ads does not allow restoring a removed ad group — it will also disappear from this list. Pause it instead if you might need it again.</ModalError>
        )}
      </ReviewModal>
    </div>
  )
}
