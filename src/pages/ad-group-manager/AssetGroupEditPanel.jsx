import React, { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { ModalError } from '../../components/Modal.jsx'
import { selectStyle } from '../campaign-manager/shared.jsx'
import { useReviewFlow, ReviewModal, btnPrimary } from '../campaign-manager/manage-panels/EditPanels.jsx'

// Name lives in AssetGroupContentPanel now (edited alongside the rest of the
// creative, since a name change and a content change often go together) —
// this panel is just the quick Active/Paused/Removed toggle.
export default function AssetGroupEditPanel({ assetGroup, customerId, onSaved }) {
  const [status, setStatus] = useState(assetGroup.status)

  const statusChanged = status !== assetGroup.status

  const flow = useReviewFlow({
    validateFn: () => window.electronAPI.assetGroupUpdateStatus({ customerId, assetGroupId: assetGroup.id, status, validateOnly: true }),
    publishFn:  () => window.electronAPI.assetGroupUpdateStatus({ customerId, assetGroupId: assetGroup.id, assetGroupName: assetGroup.name, status, before: { status: assetGroup.status } }),
  })

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Status</div>

      <div style={{ minWidth: 160, maxWidth: 200 }}>
        <select value={status} onChange={e => setStatus(e.target.value)} style={selectStyle}>
          <option value="Active">Active</option>
          <option value="Paused">Paused</option>
          <option value="Removed">Removed</option>
        </select>
      </div>
      <div style={{ marginTop: 14 }}>
        <button style={{ ...btnPrimary, opacity: statusChanged ? 1 : 0.4, cursor: statusChanged ? 'pointer' : 'not-allowed' }} disabled={!statusChanged} onClick={flow.start}>Save Changes</button>
      </div>

      <ReviewModal title="Update Asset Group Status" subtitle={assetGroup.name} flow={flow} canConfirmExtra={statusChanged} onDone={onSaved}>
        <div style={{ fontSize: 12, color: '#555' }}>Status: <strong>{assetGroup.status}</strong> → <strong>{status}</strong></div>
        {status === 'Removed' && (
          <ModalError><AlertCircle size={14} style={{ marginRight: 6 }} /><strong>Removing an asset group is permanent.</strong> Google Ads does not allow restoring a removed asset group — it will also disappear from this list. Pause it instead if you might need it again.</ModalError>
        )}
      </ReviewModal>
    </div>
  )
}
