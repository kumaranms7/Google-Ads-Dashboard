import React, { useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Plus, X } from 'lucide-react'
import Modal, { ModalWarning, ModalError, ModalSuccess, ModalFooter } from '../../../components/Modal.jsx'
import { BiddingStrategyPicker, ChipPicker, biddingStrategyLabel, formatMicros, microsToDollars, inputStyle, selectStyle, PanelSplit, AIRecommendationPanel } from '../shared.jsx'

const DEVICE_TYPES = [
  { type: 'DESKTOP',      label: 'Computers' },
  { type: 'MOBILE',       label: 'Mobile Phones' },
  { type: 'TABLET',       label: 'Tablets' },
  { type: 'CONNECTED_TV', label: 'TV screens' },
]

// Connected TV is only a real serving surface for Video and Display
// campaigns — Search ads never appear on TV screens, so Google Ads rejects
// a CONNECTED_TV campaign_criterion on a Search (or Shopping/PMax/etc.)
// campaign with CONTEXT_ERROR / OPERATION_NOT_PERMITTED_FOR_CONTEXT
// (confirmed live). Hide that option outside the channel types that
// actually support it, rather than let the user hit that error.
function deviceTypesForChannel(channelType) {
  const supportsCTV = ['VIDEO', '6', 'DISPLAY', '3'].includes(channelType)
  return supportsCTV ? DEVICE_TYPES : DEVICE_TYPES.filter(d => d.type !== 'CONNECTED_TV')
}
const DAYS_OF_WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const HOURS = Array.from({ length: 25 }, (_, i) => i) // 0-24 (24 = midnight/end of day, for end_hour only)

// Google Ads' own "Devices" section (the reference screenshot) presents this
// as plain include/exclude checkboxes, not a bid-adjustment percentage —
// under the hood exclusion is still a -100% bid modifier (the API has no
// separate "negative device" concept), so this maps checked->1 (no
// adjustment) / unchecked->0 (excluded) rather than exposing the raw range.
function deviceChecked(bidModifier) { return Number(bidModifier ?? 1) !== 0 }

function DeviceTargeting({ deviceTypes = DEVICE_TYPES, deviceChecks, onChange }) {
  const checkedCount = deviceTypes.filter(d => deviceChecks[d.type]).length
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Devices</div>
      <div style={{ fontSize: 10, color: '#aaa', marginBottom: 6 }}>Choose the devices where your ads can appear. At least one is required.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {deviceTypes.map(d => {
          const isOnlyChecked = deviceChecks[d.type] && checkedCount <= 1
          return (
            <label key={d.type} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#333', cursor: isOnlyChecked ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={!!deviceChecks[d.type]}
                disabled={isOnlyChecked}
                onChange={e => onChange({ ...deviceChecks, [d.type]: e.target.checked })}
              />
              {d.label}
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ── Start & end dates ────────────────────────────────────────────────────────

function DatesEditor({ startDate, endDate, onEndDateChange }) {
  const [hasEndDate, setHasEndDate] = useState(!!endDate)
  const [dateInput,  setDateInput]  = useState(endDate || '')

  function toggleNone(none) {
    setHasEndDate(!none)
    onEndDateChange(none ? null : (dateInput || null))
  }
  function changeDate(v) {
    setDateInput(v)
    onEndDateChange(v || null)
  }

  const todayStr = new Date().toISOString().slice(0, 10)

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Start &amp; End Dates</div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Start date</div>
          <input value={startDate || '—'} disabled style={{ ...inputStyle, width: 150, background: '#f5f7fa', color: '#999', cursor: 'not-allowed' }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>End date</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#333', marginBottom: 6, cursor: 'pointer' }}>
            <input type="radio" checked={!hasEndDate} onChange={() => toggleNone(true)} />
            None
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#333' }}>
            <input type="radio" checked={hasEndDate} onChange={() => toggleNone(false)} />
            <input
              type="date" min={todayStr} disabled={!hasEndDate}
              value={dateInput || ''} onChange={e => changeDate(e.target.value)}
              style={{ ...inputStyle, width: 150, opacity: hasEndDate ? 1 : 0.5 }}
            />
          </label>
        </div>
      </div>
    </div>
  )
}

function AdScheduleEditor({ schedules, onChange }) {
  const add = () => onChange([...schedules, { dayOfWeek: 'MONDAY', startHour: 9, endHour: 17 }])
  const remove = (i) => onChange(schedules.filter((_, idx) => idx !== i))
  const update = (i, patch) => onChange(schedules.map((s, idx) => idx === i ? { ...s, ...patch } : s))

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Ad Schedule</div>
      <div style={{ fontSize: 10, color: '#aaa', marginBottom: 6 }}>Leave empty to run ads all day, every day. Adding any block restricts delivery to only those windows.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {schedules.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select value={s.dayOfWeek} onChange={e => update(i, { dayOfWeek: e.target.value })} style={{ ...selectStyle, width: 120 }}>
              {DAYS_OF_WEEK.map(d => <option key={d} value={d}>{d[0] + d.slice(1).toLowerCase()}</option>)}
            </select>
            <select value={s.startHour} onChange={e => update(i, { startHour: Number(e.target.value) })} style={{ ...selectStyle, width: 80 }}>
              {HOURS.slice(0, 24).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </select>
            <span style={{ fontSize: 11, color: '#aaa' }}>to</span>
            <select value={s.endHour} onChange={e => update(i, { endHour: Number(e.target.value) })} style={{ ...selectStyle, width: 80 }}>
              {HOURS.slice(1).map(h => <option key={h} value={h}>{h === 24 ? '24:00' : String(h).padStart(2, '0') + ':00'}</option>)}
            </select>
            <button onClick={() => remove(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#aaa' }}><X size={14} /></button>
          </div>
        ))}
      </div>
      <button onClick={add} style={{ marginTop: 6, border: 'none', background: 'none', color: '#1a3a6b', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Plus size={13} /> Add time block
      </button>
    </div>
  )
}

export const btnPrimary = { padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none', background: '#1a3a6b', color: '#fff', cursor: 'pointer' }
export const btnGhost   = { padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: '1px solid #dde9f5', background: '#fff', color: '#555', cursor: 'pointer' }

// Shared "validate -> confirm -> publish" flow used by all three panels below.
// Each panel supplies validateFn/publishFn (already bound to its own args);
// this hook only owns the modal lifecycle and confirm-checkbox gating.
export function useReviewFlow({ validateFn, publishFn }) {
  const [open, setOpen] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validateError, setValidateError] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState(null)
  const [publishError, setPublishError] = useState(null)

  async function start() {
    setOpen(true); setConfirmed(false); setPublishResult(null); setPublishError(null)
    setValidating(true); setValidateError(null)
    try { await validateFn() } catch (err) { setValidateError(err.message || 'Validation failed') }
    finally { setValidating(false) }
  }
  async function publish() {
    setPublishing(true); setPublishError(null)
    try { setPublishResult(await publishFn()) }
    catch (err) { setPublishError(err.message || 'Failed to publish') }
    finally { setPublishing(false) }
  }
  function close() { setOpen(false) }

  return { open, start, close, validating, validateError, confirmed, setConfirmed, publishing, publishResult, publishError, publish }
}

export function ReviewModal({
  title, subtitle, flow, canConfirmExtra = true, children, onDone,
  confirmLabel = 'Publish Change', confirmingLabel = 'Publishing…',
  successMessage = 'Change published to Google Ads.',
  warningMessage = 'This will make a real change in the Google Ads account. Review carefully before confirming.',
  confirmCheckboxLabel = 'I understand this will make a live change to the Google Ads account.',
}) {
  if (!flow.open) return null
  const canConfirm = !flow.validating && !flow.validateError && !flow.publishing && flow.confirmed && canConfirmExtra

  if (flow.publishResult) {
    return (
      <Modal title={title} subtitle={subtitle} onClose={() => { flow.close(); onDone?.() }}>
        <ModalSuccess><CheckCircle size={15} color="#2e7d32" style={{ marginRight: 6 }} />{successMessage}</ModalSuccess>
        <ModalFooter><button style={btnPrimary} onClick={() => { flow.close(); onDone?.() }}>Done</button></ModalFooter>
      </Modal>
    )
  }

  return (
    <Modal title={title} subtitle={subtitle} onClose={flow.close} disableClose={flow.publishing}>
      {children}
      {flow.validating && <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#888' }}><Loader2 size={13} className="spin" />Checking with Google Ads…</div>}
      {flow.validateError && <ModalError><AlertCircle size={14} style={{ marginRight: 6 }} />{flow.validateError}</ModalError>}
      {flow.publishError && <ModalError><AlertCircle size={14} style={{ marginRight: 6 }} />{flow.publishError}</ModalError>}
      {!flow.validating && !flow.validateError && (
        <ModalWarning>
          <strong>Live change:</strong> {warningMessage}
        </ModalWarning>
      )}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#555', cursor: 'pointer' }}>
        <input type="checkbox" checked={flow.confirmed} onChange={e => flow.setConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
        {confirmCheckboxLabel}
      </label>
      <ModalFooter>
        <button style={btnGhost} onClick={flow.close} disabled={flow.publishing}>Cancel</button>
        <button style={{ ...btnPrimary, opacity: canConfirm ? 1 : 0.5, cursor: canConfirm ? 'pointer' : 'not-allowed' }} disabled={!canConfirm} onClick={flow.publish}>
          {flow.publishing ? confirmingLabel : confirmLabel}
        </button>
      </ModalFooter>
    </Modal>
  )
}

// ── Status + Budget ────────────────────────────────────────────────────────────

export function StatusBudgetPanel({ campaign, customerId, onSaved, aiRec, aiRecLoading, aiRecError }) {
  const [name,        setName]        = useState(campaign.name)
  const [status,      setStatus]      = useState(campaign.status)
  const [dailyBudget, setDailyBudget] = useState(String(microsToDollars(campaign.budgetMicros)))

  const nameChanged   = name.trim() !== campaign.name && name.trim().length > 0
  const statusChanged = status !== campaign.status
  const budgetChanged = Number(dailyBudget) !== microsToDollars(campaign.budgetMicros)
  const dirty = nameChanged || statusChanged || budgetChanged

  const flow = useReviewFlow({
    validateFn: async () => {
      if (nameChanged)   await window.electronAPI.campaignUpdateName({ customerId, campaignId: campaign.id, name: name.trim(), validateOnly: true })
      if (statusChanged) await window.electronAPI.campaignUpdateStatus({ customerId, campaignId: campaign.id, status, validateOnly: true })
      if (budgetChanged) await window.electronAPI.campaignUpdateBudget({ customerId, campaignId: campaign.id, budgetId: campaign.budgetId, dailyBudget: Number(dailyBudget), validateOnly: true })
    },
    publishFn: async () => {
      const results = []
      if (nameChanged)   results.push(await window.electronAPI.campaignUpdateName({ customerId, campaignId: campaign.id, name: name.trim(), before: { name: campaign.name } }))
      if (statusChanged) results.push(await window.electronAPI.campaignUpdateStatus({ customerId, campaignId: campaign.id, campaignName: name.trim() || campaign.name, status, before: { status: campaign.status } }))
      if (budgetChanged) results.push(await window.electronAPI.campaignUpdateBudget({ customerId, campaignId: campaign.id, campaignName: name.trim() || campaign.name, budgetId: campaign.budgetId, dailyBudget: Number(dailyBudget), before: { dailyBudget: microsToDollars(campaign.budgetMicros) } }))
      return results
    },
  })

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Name, Status &amp; Budget</div>
      <PanelSplit
        left={<>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Campaign Name</div>
            <input value={name} onChange={e => setName(e.target.value)} style={{ ...inputStyle, maxWidth: 340 }} />
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
              <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Daily Budget ($)</div>
              <input type="number" min="0" step="0.01" value={dailyBudget} onChange={e => setDailyBudget(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <button style={{ ...btnPrimary, opacity: dirty ? 1 : 0.4, cursor: dirty ? 'pointer' : 'not-allowed' }} disabled={!dirty} onClick={flow.start}>Save Changes</button>
          </div>
        </>}
        right={<AIRecommendationPanel loading={aiRecLoading} error={aiRecError} data={aiRec} keys={['status', 'budget']} titles={{ status: 'Status', budget: 'Budget' }} />}
      />

      <ReviewModal title="Update Name, Status & Budget" subtitle={campaign.name} flow={flow} canConfirmExtra={dirty} onDone={onSaved}>
        {nameChanged   && <div style={{ fontSize: 12, color: '#555' }}>Name: <strong>{campaign.name}</strong> → <strong>{name.trim()}</strong></div>}
        {statusChanged && <div style={{ fontSize: 12, color: '#555' }}>Status: <strong>{campaign.status}</strong> → <strong>{status}</strong></div>}
        {budgetChanged && <div style={{ fontSize: 12, color: '#555' }}>Daily Budget: <strong>{formatMicros(campaign.budgetMicros)}</strong> → <strong>${Number(dailyBudget).toFixed(2)}</strong></div>}
        {statusChanged && status === 'Removed' && (
          <ModalError><AlertCircle size={14} style={{ marginRight: 6 }} /><strong>Removing a campaign is permanent.</strong> Google Ads does not allow restoring a removed campaign — it will also disappear from this list. Pause it instead if you might need it again.</ModalError>
        )}
      </ReviewModal>
    </div>
  )
}

// ── Bidding ────────────────────────────────────────────────────────────────────

export function BiddingPanel({ campaign, customerId, onSaved, aiRec, aiRecLoading, aiRecError }) {
  const [strategy,    setStrategy]    = useState(campaign.biddingStrategy || 'MANUAL_CPC')
  const [targetValue, setTargetValue] = useState('')

  const dirty = strategy !== campaign.biddingStrategy

  const flow = useReviewFlow({
    validateFn: () => window.electronAPI.campaignUpdateBidding({ customerId, campaignId: campaign.id, biddingStrategy: strategy, targetValue, validateOnly: true }),
    publishFn: () => window.electronAPI.campaignUpdateBidding({
      customerId, campaignId: campaign.id, campaignName: campaign.name, biddingStrategy: strategy, targetValue,
      before: { biddingStrategy: campaign.biddingStrategy },
    }),
  })

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Bidding Strategy</div>
      <PanelSplit
        left={<>
          <div style={{ maxWidth: 320 }}>
            <BiddingStrategyPicker value={strategy} targetValue={targetValue} onChange={setStrategy} onTargetChange={setTargetValue} />
          </div>
          <div style={{ marginTop: 14 }}>
            <button style={{ ...btnPrimary, opacity: dirty ? 1 : 0.4, cursor: dirty ? 'pointer' : 'not-allowed' }} disabled={!dirty} onClick={flow.start}>Save Changes</button>
          </div>
        </>}
        right={<AIRecommendationPanel loading={aiRecLoading} error={aiRecError} data={aiRec} keys={['biddingStrategy']} titles={{ biddingStrategy: 'Bidding Strategy' }} />}
      />

      <ReviewModal title="Update Bidding Strategy" subtitle={campaign.name} flow={flow} canConfirmExtra={dirty} onDone={onSaved}>
        <div style={{ fontSize: 12, color: '#555' }}>
          Bidding Strategy: <strong>{biddingStrategyLabel(campaign.biddingStrategy)}</strong> → <strong>{biddingStrategyLabel(strategy)}</strong>
        </div>
      </ReviewModal>
    </div>
  )
}

// ── Targeting (locations + languages) ──────────────────────────────────────────

export function TargetingPanel({ campaign, customerId, onSaved, aiRec, aiRecLoading, aiRecError }) {
  // Connected TV is only offered for channel types that actually support it
  // (see deviceTypesForChannel) — everything else derives from this list so
  // an excluded device type is never tracked, rendered, or sent for update.
  const availableDeviceTypes = deviceTypesForChannel(campaign.channelType)

  // Excluded (negative) locations are a separate targeting mechanism from
  // included ones — they're now edited independently via their own picker
  // and diffed/mutated separately on the backend, so adding/removing one
  // can never cross-contaminate the included-locations list (confirmed live
  // this used to happen when both were merged into one list).
  const initialLocations = (campaign.criteria || []).filter(c => (c.type === '7' || c.type === 'LOCATION') && !c.negative)
    .map(c => { const id = String(c.geoTargetConstant || '').split('/').pop(); return { id, name: c.geoTargetName || `Location ${id}`, canonicalName: c.geoTargetName } })
  const initialExcludedLocations = (campaign.criteria || []).filter(c => (c.type === '7' || c.type === 'LOCATION') && c.negative)
    .map(c => { const id = String(c.geoTargetConstant || '').split('/').pop(); return { id, name: c.geoTargetName || `Location ${id}`, canonicalName: c.geoTargetName } })
  const initialLanguages = (campaign.criteria || []).filter(c => c.type === '20' || c.type === 'LANGUAGE')
    .map(c => { const id = String(c.languageConstant || '').split('/').pop(); return { id, name: c.languageName || `Language ${id}` } })
  const initialDeviceChecks = Object.fromEntries(availableDeviceTypes.map(d => [d.type, deviceChecked((campaign.devices || []).find(x => x.type === d.type)?.bidModifier)]))
  const initialSchedules = (campaign.adSchedules || []).map(s => ({ ...s }))
  const initialEndDate = campaign.endDate || null

  const [locations, setLocations] = useState(initialLocations)
  const [excludedLocations, setExcludedLocations] = useState(initialExcludedLocations)
  const [languages, setLanguages] = useState(initialLanguages)
  const [deviceChecks, setDeviceChecks] = useState(initialDeviceChecks)
  const [schedules, setSchedules] = useState(initialSchedules)
  const [endDate, setEndDate] = useState(initialEndDate)
  const [languageOptions, setLanguageOptions] = useState(null)

  React.useEffect(() => {
    window.electronAPI.campaignListLanguages({ customerId }).then(setLanguageOptions).catch(() => setLanguageOptions([]))
  }, [customerId])

  // Performance Max campaigns don't support device bid-modifier or ad-schedule
  // criteria at all — Google Ads rejects any attempt with "operation not
  // permitted for campaign type" (confirmed live). Hide those controls for
  // PMax rather than let the user hit that error after filling them in.
  const isPMax = ['PERFORMANCE_MAX', '10'].includes(campaign.channelType)

  const devices = isPMax ? [] : availableDeviceTypes.map(d => ({ type: d.type, bidModifier: deviceChecks[d.type] ? 1 : 0 }))
  const targetingDirty = JSON.stringify(locations.map(l => l.id).sort()) !== JSON.stringify(initialLocations.map(l => l.id).sort())
    || JSON.stringify(excludedLocations.map(l => l.id).sort()) !== JSON.stringify(initialExcludedLocations.map(l => l.id).sort())
    || JSON.stringify(languages.map(l => l.id).sort()) !== JSON.stringify(initialLanguages.map(l => l.id).sort())
    || (!isPMax && JSON.stringify(deviceChecks) !== JSON.stringify(initialDeviceChecks))
    || (!isPMax && JSON.stringify(schedules) !== JSON.stringify(initialSchedules))
  const endDateChanged = (endDate || null) !== (initialEndDate || null)
  const dirty = targetingDirty || endDateChanged

  const adSchedulesToSend = isPMax ? [] : schedules

  const flow = useReviewFlow({
    validateFn: async () => {
      if (targetingDirty) await window.electronAPI.campaignUpdateTargeting({ customerId, campaignId: campaign.id, locations, excludedLocations, languages, devices, adSchedules: adSchedulesToSend, validateOnly: true })
      if (endDateChanged) await window.electronAPI.campaignUpdateEndDate({ customerId, campaignId: campaign.id, endDate, validateOnly: true })
    },
    publishFn: async () => {
      const results = []
      if (targetingDirty) results.push(await window.electronAPI.campaignUpdateTargeting({
        customerId, campaignId: campaign.id, campaignName: campaign.name, locations, excludedLocations, languages, devices, adSchedules: adSchedulesToSend,
        before: { locations: initialLocations, excludedLocations: initialExcludedLocations, languages: initialLanguages, devices: campaign.devices || [], adSchedules: initialSchedules },
      }))
      if (endDateChanged) results.push(await window.electronAPI.campaignUpdateEndDate({
        customerId, campaignId: campaign.id, campaignName: campaign.name, endDate, before: { endDate: initialEndDate },
      }))
      return results
    },
  })

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Targeting</div>
      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 12 }}>Locations, languages, devices, ad scheduling, and start/end dates.</div>
      <PanelSplit
        left={<>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <ChipPicker
                label="Locations" selected={locations} onChange={setLocations}
                placeholder="Search a city, state, or country…"
                searchFn={q => window.electronAPI.campaignSearchGeoTargets({ customerId, query: q })}
                emptyHint="No locations targeted — search above to add one."
              />
              <div style={{ marginTop: 14 }}>
                <ChipPicker
                  label="Excluded Locations" selected={excludedLocations} onChange={setExcludedLocations}
                  placeholder="Search a location to exclude…"
                  searchFn={q => window.electronAPI.campaignSearchGeoTargets({ customerId, query: q })}
                  emptyHint="No locations excluded — search above to exclude one."
                  tone="danger"
                />
              </div>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <ChipPicker
                label="Languages" selected={languages} onChange={setLanguages}
                placeholder="Search a language…"
                staticOptions={languageOptions || []}
                emptyHint={languageOptions ? 'No languages targeted — search above to add one.' : 'Loading languages…'}
              />
            </div>
          </div>
          {isPMax ? (
            <div style={{ marginTop: 16, fontSize: 11, color: '#aaa', padding: '10px 12px', background: '#fafcff', border: '1px solid #eef2f7', borderRadius: 6 }}>
              Device bid modifiers and ad scheduling aren't supported on Performance Max campaigns — Google Ads manages device and time targeting automatically for PMax.
            </div>
          ) : (
            <>
              <div style={{ marginTop: 16 }}>
                <DeviceTargeting deviceTypes={availableDeviceTypes} deviceChecks={deviceChecks} onChange={setDeviceChecks} />
              </div>
              <div style={{ marginTop: 16 }}>
                <AdScheduleEditor schedules={schedules} onChange={setSchedules} />
              </div>
            </>
          )}
          <div style={{ marginTop: 16 }}>
            <DatesEditor startDate={campaign.startDate} endDate={endDate} onEndDateChange={setEndDate} />
          </div>
          <div style={{ marginTop: 14 }}>
            <button style={{ ...btnPrimary, opacity: dirty ? 1 : 0.4, cursor: dirty ? 'pointer' : 'not-allowed' }} disabled={!dirty} onClick={flow.start}>Save Changes</button>
          </div>
        </>}
        right={<AIRecommendationPanel loading={aiRecLoading} error={aiRecError} data={aiRec} keys={['targeting', 'language']} titles={{ targeting: 'Location Targeting', language: 'Language Targeting' }} />}
      />

      <ReviewModal title="Update Targeting" subtitle={campaign.name} flow={flow} canConfirmExtra={dirty} onDone={onSaved}>
        <div style={{ fontSize: 12, color: '#555' }}>Locations: <strong>{locations.length}</strong> selected</div>
        <div style={{ fontSize: 12, color: '#555' }}>Excluded Locations: <strong>{excludedLocations.length}</strong> selected</div>
        <div style={{ fontSize: 12, color: '#555' }}>Languages: <strong>{languages.length}</strong> selected</div>
        {!isPMax && <div style={{ fontSize: 12, color: '#555' }}>Devices: <strong>{availableDeviceTypes.filter(d => deviceChecks[d.type]).map(d => d.label).join(', ') || 'none'}</strong></div>}
        {!isPMax && <div style={{ fontSize: 12, color: '#555' }}>Ad schedule: <strong>{schedules.length > 0 ? `${schedules.length} time block(s)` : 'all day, every day'}</strong></div>}
        {endDateChanged && <div style={{ fontSize: 12, color: '#555' }}>End Date: <strong>{initialEndDate || 'None'}</strong> → <strong>{endDate || 'None'}</strong></div>}
      </ReviewModal>
    </div>
  )
}
