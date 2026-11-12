import React, { useState } from 'react'
import { X } from 'lucide-react'
import { inputStyle, PanelSplit } from '../campaign-manager/shared.jsx'
import { TextListEditor, ImageUrlEditor, CreativeSuggestionList } from '../campaign-manager/CreateTab.jsx'
import { useReviewFlow, ReviewModal, btnPrimary } from '../campaign-manager/manage-panels/EditPanels.jsx'

const label11 = { fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }

const DEFAULT_FORM = {
  name: '', finalUrl: '', businessName: '',
  headlines: [''], longHeadline: '', descriptions: [''],
  marketingImageUrls: [''], squareMarketingImageUrls: [''], logoImageUrls: [''],
}

export default function CreateAssetGroupPanel({ selectedAccount, campaignId, campaignName, onClose, onCreated }) {
  const [form, setForm] = useState(DEFAULT_FORM)
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const [headlineRec,        setHeadlineRec]        = useState([])
  const [headlineRecLoading, setHeadlineRecLoading] = useState(false)
  const [headlineRecError,   setHeadlineRecError]   = useState(null)
  const [addedHeadlineIdx,   setAddedHeadlineIdx]   = useState(new Set())

  const [descriptionRec,        setDescriptionRec]        = useState([])
  const [descriptionRecLoading, setDescriptionRecLoading] = useState(false)
  const [descriptionRecError,   setDescriptionRecError]   = useState(null)
  const [addedDescriptionIdx,   setAddedDescriptionIdx]   = useState(new Set())

  const [longHeadlineRec,        setLongHeadlineRec]        = useState([])
  const [longHeadlineRecLoading, setLongHeadlineRecLoading] = useState(false)
  const [longHeadlineRecError,   setLongHeadlineRecError]   = useState(null)
  const [addedLongHeadlineIdx,   setAddedLongHeadlineIdx]   = useState(new Set())

  function fetchHeadlineRec() {
    setHeadlineRecLoading(true); setHeadlineRecError(null); setAddedHeadlineIdx(new Set())
    window.electronAPI.rsaGenerateHeadlinesAI({
      campaignName, businessName: form.businessName || campaignName,
      existingHeadlines: form.headlines.filter(Boolean), count: 8,
    })
      .then(res => setHeadlineRec(res.headlines || []))
      .catch(err => setHeadlineRecError(err.message || 'Failed to get AI suggestions'))
      .finally(() => setHeadlineRecLoading(false))
  }

  function fetchDescriptionRec() {
    setDescriptionRecLoading(true); setDescriptionRecError(null); setAddedDescriptionIdx(new Set())
    window.electronAPI.rsaGenerateDescriptionsAI({
      campaignName, businessName: form.businessName || campaignName,
      existingDescriptions: form.descriptions.filter(Boolean), count: 5,
    })
      .then(res => setDescriptionRec(res.descriptions || []))
      .catch(err => setDescriptionRecError(err.message || 'Failed to get AI suggestions'))
      .finally(() => setDescriptionRecLoading(false))
  }

  function fetchLongHeadlineRec() {
    setLongHeadlineRecLoading(true); setLongHeadlineRecError(null); setAddedLongHeadlineIdx(new Set())
    window.electronAPI.rsaGenerateLongHeadlinesAI({
      campaignName, businessName: form.businessName || campaignName,
      existingLongHeadlines: form.longHeadline.trim() ? [form.longHeadline.trim()] : [], count: 4,
    })
      .then(res => setLongHeadlineRec(res.longHeadlines || []))
      .catch(err => setLongHeadlineRecError(err.message || 'Failed to get AI suggestions'))
      .finally(() => setLongHeadlineRecLoading(false))
  }

  // Long Headline is a single-value field, unlike headlines/descriptions —
  // "adding" a suggestion replaces whatever's currently there rather than
  // appending to a list.
  function addSuggestedLongHeadline(text, idx) {
    set('longHeadline', text)
    setAddedLongHeadlineIdx(prev => new Set(prev).add(idx))
  }

  function addSuggestedHeadline(text, idx) {
    setForm(f => {
      const isDefaultEmpty = f.headlines.length === 1 && !f.headlines[0].trim()
      const headlines = isDefaultEmpty ? [text] : f.headlines.length < 15 ? [...f.headlines, text] : f.headlines
      return { ...f, headlines }
    })
    setAddedHeadlineIdx(prev => new Set(prev).add(idx))
  }

  function addSuggestedDescription(text, idx) {
    setForm(f => {
      const isDefaultEmpty = f.descriptions.length === 1 && !f.descriptions[0].trim()
      const descriptions = isDefaultEmpty ? [text] : f.descriptions.length < 5 ? [...f.descriptions, text] : f.descriptions
      return { ...f, descriptions }
    })
    setAddedDescriptionIdx(prev => new Set(prev).add(idx))
  }

  const hs = form.headlines.filter(Boolean), ds = form.descriptions.filter(Boolean)
  const hasImgs = form.marketingImageUrls.some(Boolean) && form.squareMarketingImageUrls.some(Boolean) && form.logoImageUrls.some(Boolean)
  const canReview = form.name.trim().length > 0 && form.finalUrl.trim().length > 0 && form.businessName.trim().length > 0
    && hs.length >= 3 && ds.length >= 2 && hasImgs

  const payload = () => ({
    customerId: selectedAccount.id, campaignId,
    name: form.name.trim(), finalUrl: form.finalUrl.trim(), businessName: form.businessName.trim() || campaignName,
    headlines: hs, longHeadline: form.longHeadline.trim() || undefined, descriptions: ds,
    marketingImageUrls: form.marketingImageUrls.filter(Boolean),
    squareMarketingImageUrls: form.squareMarketingImageUrls.filter(Boolean),
    logoImageUrls: form.logoImageUrls.filter(Boolean),
  })

  const flow = useReviewFlow({
    validateFn: () => window.electronAPI.assetGroupCreate({ ...payload(), validateOnly: true }),
    publishFn:  () => window.electronAPI.assetGroupCreate({ ...payload(), campaignName }),
  })

  function handleDone() {
    onCreated?.()
    onClose?.()
  }

  return (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5 }}>New Asset Group</div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#aaa' }}><X size={16} /></button>
      </div>

      <PanelSplit
        left={<div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <div style={label11}>Asset Group Name</div>
              <input value={form.name} onChange={e => set('name', e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <div style={label11}>Business Name</div>
              <input value={form.businessName} onChange={e => set('businessName', e.target.value)} placeholder={campaignName} style={inputStyle} />
            </div>
          </div>
          <div>
            <div style={label11}>Final URL</div>
            <input value={form.finalUrl} onChange={e => set('finalUrl', e.target.value)} placeholder="https://example.com/landing-page" style={inputStyle} />
          </div>
          <TextListEditor label="Headlines" items={form.headlines} onChange={v => set('headlines', v)} max={15} placeholder="Headline (max 30 chars)" minRequired={3} />
          <div>
            <div style={label11}>Long Headline</div>
            <input value={form.longHeadline} onChange={e => set('longHeadline', e.target.value)} placeholder="A longer, complete headline sentence" style={inputStyle} />
          </div>

          <TextListEditor label="Descriptions" items={form.descriptions} onChange={v => set('descriptions', v)} max={5} placeholder="Description" minRequired={2} />
          <ImageUrlEditor label="Marketing Images (1.91:1 landscape)" urls={form.marketingImageUrls} onChange={v => set('marketingImageUrls', v)} hint="At least one, e.g. 1200×628px" />
          <ImageUrlEditor label="Square Marketing Images (1:1)" urls={form.squareMarketingImageUrls} onChange={v => set('squareMarketingImageUrls', v)} hint="At least one, e.g. 1200×1200px" />
          <ImageUrlEditor label="Logo (1:1 square)" urls={form.logoImageUrls} onChange={v => set('logoImageUrls', v)} hint="Required per asset group" />

          <div>
            <button style={{ ...btnPrimary, opacity: canReview ? 1 : 0.4, cursor: canReview ? 'pointer' : 'not-allowed' }} disabled={!canReview} onClick={flow.start}>Create Asset Group</button>
          </div>
        </div>}
        right={<div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <CreativeSuggestionList title="AI Suggested Headlines" loading={headlineRecLoading} error={headlineRecError} items={headlineRec} addedIdx={addedHeadlineIdx} onFetch={fetchHeadlineRec} onAdd={addSuggestedHeadline} />
          <CreativeSuggestionList title="AI Suggested Long Headline" loading={longHeadlineRecLoading} error={longHeadlineRecError} items={longHeadlineRec} addedIdx={addedLongHeadlineIdx} onFetch={fetchLongHeadlineRec} onAdd={addSuggestedLongHeadline} />
          <CreativeSuggestionList title="AI Suggested Descriptions" loading={descriptionRecLoading} error={descriptionRecError} items={descriptionRec} addedIdx={addedDescriptionIdx} onFetch={fetchDescriptionRec} onAdd={addSuggestedDescription} />
        </div>}
      />

      <ReviewModal
        title="Create Asset Group" subtitle={campaignName} flow={flow} canConfirmExtra={canReview} onDone={handleDone}
        confirmLabel="Create Asset Group" confirmingLabel="Creating…"
        successMessage={`Asset group "${form.name.trim()}" created.`}
        warningMessage="This will create a real asset group in this Google Ads account."
        confirmCheckboxLabel="I understand this will create a live asset group in the Google Ads account."
      >
        <div style={{ fontSize: 12, color: '#555' }}>Name: <strong>{form.name.trim()}</strong></div>
        <div style={{ fontSize: 12, color: '#555' }}>Final URL: <strong>{form.finalUrl.trim()}</strong></div>
        <div style={{ fontSize: 12, color: '#555' }}>Creative: <strong>{hs.length} headlines, {ds.length} descriptions, {form.marketingImageUrls.filter(Boolean).length + form.squareMarketingImageUrls.filter(Boolean).length + form.logoImageUrls.filter(Boolean).length} images</strong></div>
      </ReviewModal>
    </div>
  )
}
