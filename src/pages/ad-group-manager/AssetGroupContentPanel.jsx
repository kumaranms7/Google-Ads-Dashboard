import React, { useEffect, useState } from 'react'
import { Spinner, inputStyle, PanelSplit } from '../campaign-manager/shared.jsx'
import { TextListEditor, ImageUrlEditor, CreativeSuggestionList } from '../campaign-manager/CreateTab.jsx'
import { useReviewFlow, ReviewModal, btnPrimary } from '../campaign-manager/manage-panels/EditPanels.jsx'

const label11 = { fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }

function formFromDetail(detail) {
  return {
    name: detail.name, finalUrl: detail.finalUrl, businessName: detail.businessName?.text || '',
    headlines: detail.headlines.map(h => h.text),
    longHeadline: detail.longHeadline?.text || '',
    descriptions: detail.descriptions.map(d => d.text),
    marketingImageUrls: detail.marketingImages.map(i => i.url),
    squareMarketingImageUrls: detail.squareImages.map(i => i.url),
    logoImageUrls: detail.logos.map(i => i.url),
  }
}

// Same field set as CreateAssetGroupPanel — pre-populated from a live fetch
// of the asset group's current creative (getAssetGroupDetail), and saved via
// content-diffing (updateAssetGroupContent) rather than a full replace, so
// untouched headlines/images aren't needlessly removed and recreated.
export default function AssetGroupContentPanel({ assetGroup, customerId, onSaved }) {
  const [detail,  setDetail]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [form,    setForm]    = useState(null)

  function refresh() {
    setLoading(true); setError(null); setDetail(null); setForm(null)
    window.electronAPI.assetGroupGetDetail({ customerId, assetGroupId: assetGroup.id })
      .then(d => { setDetail(d); setForm(formFromDetail(d)) })
      .catch(err => setError(err.message || 'Failed to load asset group content'))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [assetGroup.id, customerId])

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
      campaignName: assetGroup.campaignName, businessName: form.businessName || assetGroup.campaignName,
      existingHeadlines: form.headlines.filter(Boolean), count: 8,
    })
      .then(res => setHeadlineRec(res.headlines || []))
      .catch(err => setHeadlineRecError(err.message || 'Failed to get AI suggestions'))
      .finally(() => setHeadlineRecLoading(false))
  }

  function fetchDescriptionRec() {
    setDescriptionRecLoading(true); setDescriptionRecError(null); setAddedDescriptionIdx(new Set())
    window.electronAPI.rsaGenerateDescriptionsAI({
      campaignName: assetGroup.campaignName, businessName: form.businessName || assetGroup.campaignName,
      existingDescriptions: form.descriptions.filter(Boolean), count: 5,
    })
      .then(res => setDescriptionRec(res.descriptions || []))
      .catch(err => setDescriptionRecError(err.message || 'Failed to get AI suggestions'))
      .finally(() => setDescriptionRecLoading(false))
  }

  function fetchLongHeadlineRec() {
    setLongHeadlineRecLoading(true); setLongHeadlineRecError(null); setAddedLongHeadlineIdx(new Set())
    window.electronAPI.rsaGenerateLongHeadlinesAI({
      campaignName: assetGroup.campaignName, businessName: form.businessName || assetGroup.campaignName,
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

  const hs = form?.headlines.filter(Boolean) || [], ds = form?.descriptions.filter(Boolean) || []
  const hasImgs = form && form.marketingImageUrls.some(Boolean) && form.squareMarketingImageUrls.some(Boolean) && form.logoImageUrls.some(Boolean)
  const canReview = !!form && form.name.trim().length > 0 && form.finalUrl.trim().length > 0 && form.businessName.trim().length > 0
    && hs.length >= 3 && ds.length >= 2 && hasImgs

  const payload = () => ({
    customerId, assetGroupId: assetGroup.id, assetGroupName: form.name.trim(),
    name: form.name.trim(), finalUrl: form.finalUrl.trim(), businessName: form.businessName.trim(),
    headlines: hs, longHeadline: form.longHeadline.trim() || undefined, descriptions: ds,
    marketingImageUrls: form.marketingImageUrls.filter(Boolean),
    squareMarketingImageUrls: form.squareMarketingImageUrls.filter(Boolean),
    logoImageUrls: form.logoImageUrls.filter(Boolean),
    existing: detail,
  })

  const flow = useReviewFlow({
    validateFn: () => window.electronAPI.assetGroupUpdateContent({ ...payload(), validateOnly: true }),
    publishFn:  () => window.electronAPI.assetGroupUpdateContent({ ...payload(), before: detail }),
  })

  function handleDone() {
    onSaved?.()
    refresh()
  }

  if (loading || !form) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Creative Content</div>
        {error ? (
          <div style={{ padding: '10px 14px', background: '#fff5f5', border: '1px solid #ffd5cc', borderRadius: 6, color: '#c0392b', fontSize: 12 }}>{error}</div>
        ) : (
          <Spinner label="Loading current creative…" />
        )}
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Creative Content</div>

      <PanelSplit
        left={<div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <div style={label11}>Asset Group Name</div>
              <input value={form.name} onChange={e => set('name', e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <div style={label11}>Business Name</div>
              <input value={form.businessName} onChange={e => set('businessName', e.target.value)} style={inputStyle} />
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
            <button style={{ ...btnPrimary, opacity: canReview ? 1 : 0.4, cursor: canReview ? 'pointer' : 'not-allowed' }} disabled={!canReview} onClick={flow.start}>Save Changes</button>
          </div>
        </div>}
        right={<div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <CreativeSuggestionList title="AI Suggested Headlines" loading={headlineRecLoading} error={headlineRecError} items={headlineRec} addedIdx={addedHeadlineIdx} onFetch={fetchHeadlineRec} onAdd={addSuggestedHeadline} />
          <CreativeSuggestionList title="AI Suggested Long Headline" loading={longHeadlineRecLoading} error={longHeadlineRecError} items={longHeadlineRec} addedIdx={addedLongHeadlineIdx} onFetch={fetchLongHeadlineRec} onAdd={addSuggestedLongHeadline} />
          <CreativeSuggestionList title="AI Suggested Descriptions" loading={descriptionRecLoading} error={descriptionRecError} items={descriptionRec} addedIdx={addedDescriptionIdx} onFetch={fetchDescriptionRec} onAdd={addSuggestedDescription} />
        </div>}
      />

      <ReviewModal
        title="Update Asset Group Content" subtitle={assetGroup.name} flow={flow} canConfirmExtra={canReview} onDone={handleDone}
        confirmLabel="Save Changes" confirmingLabel="Saving…"
        successMessage="Asset group content updated."
        warningMessage="This will change the live creative Google serves for this asset group."
        confirmCheckboxLabel="I understand this will update live creative in the Google Ads account."
      >
        <div style={{ fontSize: 12, color: '#555' }}>Name: <strong>{form.name.trim()}</strong></div>
        <div style={{ fontSize: 12, color: '#555' }}>Final URL: <strong>{form.finalUrl.trim()}</strong></div>
        <div style={{ fontSize: 12, color: '#555' }}>Creative: <strong>{hs.length} headlines, {ds.length} descriptions, {form.marketingImageUrls.filter(Boolean).length + form.squareMarketingImageUrls.filter(Boolean).length + form.logoImageUrls.filter(Boolean).length} images</strong></div>
      </ReviewModal>
    </div>
  )
}
