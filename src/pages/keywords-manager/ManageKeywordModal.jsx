import React, { useEffect, useState } from 'react'
import { AlertCircle, Loader2, Sparkles } from 'lucide-react'
import Modal, { ModalError } from '../../components/Modal.jsx'
import { PanelSplit, selectStyle } from '../campaign-manager/shared.jsx'
import { useReviewFlow, ReviewModal, btnPrimary } from '../campaign-manager/manage-panels/EditPanels.jsx'
import { CampaignAdGroupPicker, RECOMMENDATION_STYLE } from './shared.jsx'

const MATCH_TYPES = [{ value: 'BROAD', label: 'Broad' }, { value: 'PHRASE', label: 'Phrase' }, { value: 'EXACT', label: 'Exact' }]
const STATUSES = ['Active', 'Paused', 'Removed']

function AIRecommendationPanel({ loading, error, data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#6a3fc0', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        <Sparkles size={12} /> AI Suggestion
      </div>
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888', padding: '10px 12px' }}>
          <Loader2 size={12} className="spin" /> Analyzing keyword performance…
        </div>
      )}
      {!loading && error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: '#c0392b', padding: '10px 12px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 7 }}>
          <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
        </div>
      )}
      {!loading && !error && data && (
        <div style={{ padding: '10px 12px', background: '#f7f5ff', border: '1px solid #e0d9fb', borderRadius: 7 }}>
          {(() => {
            const s = RECOMMENDATION_STYLE[data.recommendation] || RECOMMENDATION_STYLE.Monitor
            return (
              <span style={{ display: 'inline-block', marginBottom: 6, fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99, background: s.bg, color: s.text, border: `1px solid ${s.border}` }}>
                {data.recommendation}
              </span>
            )
          })()}
          <div style={{ fontSize: 12, color: '#3d2470', lineHeight: 1.6 }}>{data.reasoning}</div>
        </div>
      )}
    </div>
  )
}

export default function ManageKeywordModal({ keyword: kw, selectedAccount, onClose, onSaved }) {
  const [status,     setStatus]     = useState(kw.status)
  const [matchType,  setMatchType]  = useState(kw.matchType)
  const [campaignId, setCampaignId] = useState(kw.campaignId)
  const [adGroupId,  setAdGroupId]  = useState(kw.adGroupId)

  const [aiRec,       setAiRec]       = useState(null)
  const [aiRecLoading, setAiRecLoading] = useState(true)
  const [aiRecError,  setAiRecError]  = useState(null)

  useEffect(() => {
    setAiRecLoading(true); setAiRecError(null)
    window.electronAPI.keywordManagerAiRecommendForKeyword({ keyword: kw })
      .then(setAiRec)
      .catch(err => setAiRecError(err.message || 'Failed to get AI recommendation'))
      .finally(() => setAiRecLoading(false))
  }, [kw.resourceName])

  const statusChanged = status !== kw.status
  const matchTypeChanged = matchType !== kw.matchType
  const adGroupChanged = String(adGroupId) !== String(kw.adGroupId)
  const dirty = statusChanged || matchTypeChanged || adGroupChanged
  const canSave = dirty && (status === 'Removed' || !!adGroupId)

  const flow = useReviewFlow({
    validateFn: () => window.electronAPI.keywordManagerUpdateKeyword({
      customerId: selectedAccount.id,
      resourceName: kw.resourceName, text: kw.text,
      currentMatchType: kw.matchType, currentAdGroupId: kw.adGroupId,
      newStatus: status, newMatchType: matchType, newAdGroupId: adGroupId,
      validateOnly: true,
    }),
    publishFn: () => window.electronAPI.keywordManagerUpdateKeyword({
      customerId: selectedAccount.id,
      resourceName: kw.resourceName, text: kw.text,
      currentMatchType: kw.matchType, currentAdGroupId: kw.adGroupId,
      newStatus: status, newMatchType: matchType, newAdGroupId: adGroupId,
    }),
  })

  return (
    <Modal title="Manage Keyword" subtitle={kw.text} onClose={onClose} maxWidth={860}>
      <PanelSplit
        left={<>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Keyword</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1a3a6b' }}>{kw.text}</div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Status</div>
              <select value={status} onChange={e => setStatus(e.target.value)} style={selectStyle}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Match Type</div>
              <select value={matchType} onChange={e => setMatchType(e.target.value)} disabled={status === 'Removed'} style={selectStyle}>
                {MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Campaign &amp; Ad Group</div>
          <div style={{ fontSize: 10, color: '#aaa', marginBottom: 8 }}>Changing either moves this keyword — it's removed from its current ad group and re-created in the one selected here.</div>
          <CampaignAdGroupPicker
            selectedAccount={selectedAccount}
            campaignId={campaignId} adGroupId={adGroupId}
            onChangeCampaign={setCampaignId} onChangeAdGroup={setAdGroupId}
            disabled={status === 'Removed'}
          />

          <div style={{ marginTop: 18 }}>
            <button style={{ ...btnPrimary, opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'not-allowed' }} disabled={!canSave} onClick={flow.start}>Save Changes</button>
          </div>
        </>}
        right={<AIRecommendationPanel loading={aiRecLoading} error={aiRecError} data={aiRec} />}
      />

      <ReviewModal title="Update Keyword" subtitle={kw.text} flow={flow} canConfirmExtra={canSave} onDone={onSaved}>
        {statusChanged    && <div style={{ fontSize: 12, color: '#555' }}>Status: <strong>{kw.status}</strong> → <strong>{status}</strong></div>}
        {matchTypeChanged && status !== 'Removed' && <div style={{ fontSize: 12, color: '#555' }}>Match Type: <strong>{kw.matchType}</strong> → <strong>{matchType}</strong></div>}
        {adGroupChanged   && status !== 'Removed' && <div style={{ fontSize: 12, color: '#555' }}>Ad Group: <strong>{kw.adGroupName}</strong> → moved to a different ad group</div>}
        {status === 'Removed' && (
          <ModalError><AlertCircle size={14} style={{ marginRight: 6 }} /><strong>Removing a keyword is permanent.</strong> Google Ads does not allow restoring a removed keyword.</ModalError>
        )}
      </ReviewModal>
    </Modal>
  )
}
