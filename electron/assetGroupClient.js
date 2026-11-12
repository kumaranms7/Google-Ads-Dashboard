'use strict'

// Performance Max asset group backend — peer module to adGroupClient.js.
// PMax campaigns have no ad groups at all (that's the whole reason Ad Group
// Manager excluded PMax originally) — they use "asset groups" instead, a
// genuinely different resource with no keywords, no per-group bid, and no
// concept of "move to a different campaign." Covers: list, create, rename,
// status, and full creative content (headlines/descriptions/images/business
// name/final URL) editing. No keywords (PMax has none — Google's ML selects
// targeting automatically from the asset group's signals).

const { makeCustomer, parseGoogleAdsError, enumStr, n } = require('./googleAdsClient')
const { extractResourceNames, resultResourceName, fetchImageBuffer, mimeTypeFromUrl } = require('./campaignClient')
const { enums, ResourceNames } = require('google-ads-api')

const STATUS_MAP = {
  ENABLED: 'Active', PAUSED: 'Paused', REMOVED: 'Removed',
  '2': 'Active', '3': 'Paused', '4': 'Removed',
}

// asset_group.ad_strength comes back as a raw number (confirmed live) — same
// reverse-enum-lookup story used throughout this codebase (biddingStrategyTypeName,
// matchTypeName, etc). Built fresh here rather than reusing
// src/utils/enumMaps.js's AD_STRENGTH map — that map's numeric keys don't
// match the real AssetGroupAdStrengthEnum values (off by one, plus an extra
// "Fair" state that doesn't exist), so reusing it would show wrong labels.
const AD_STRENGTH_NUM = Object.fromEntries(Object.entries(enums.AdStrength).map(([name, num]) => [String(num), name]))
function adStrengthName(raw) {
  const s = enumStr(raw)
  const name = AD_STRENGTH_NUM[s] || s
  const LABELS = { UNSPECIFIED: '—', UNKNOWN: '—', PENDING: 'Pending', NO_ADS: 'No Ads', POOR: 'Poor', AVERAGE: 'Average', GOOD: 'Good', EXCELLENT: 'Excellent' }
  return LABELS[name] || name
}

async function listAssetGroups({ api, credentials }, customerId, mccCustomerId, campaignId, { hidePaused } = {}) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  let rows
  try {
    rows = await customer.query(`
      SELECT asset_group.id, asset_group.name, asset_group.status, asset_group.ad_strength,
        campaign.id, campaign.name
      FROM asset_group
      WHERE campaign.id = ${campaignId}
        AND asset_group.status != 'REMOVED'
        ${hidePaused ? "AND asset_group.status = 'ENABLED'" : ''}
      ORDER BY asset_group.name
    `)
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }

  return rows.map(r => ({
    id:            String(r.asset_group?.id ?? ''),
    name:          r.asset_group?.name ?? '',
    status:        STATUS_MAP[enumStr(r.asset_group?.status)] || enumStr(r.asset_group?.status),
    adStrength:    adStrengthName(r.asset_group?.ad_strength),
    campaignId:    String(r.campaign?.id ?? ''),
    campaignName:  r.campaign?.name ?? '',
  }))
}

async function updateAssetGroupName({ api, credentials }, customerId, mccCustomerId, { assetGroupId, name, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('Asset group name is required.')
  try {
    await customer.assetGroups.update([{
      resource_name: ResourceNames.assetGroup(customerId, assetGroupId),
      name: trimmed,
    }], validateOnly ? { validate_only: true } : undefined)
    return { success: true, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// REMOVED can't be set through a regular update (same "Enum value 'REMOVED'
// cannot be used" restriction confirmed live for campaigns/ad groups/keywords)
// — it's a dedicated mutate operation type.
async function updateAssetGroupStatus({ api, credentials }, customerId, mccCustomerId, { assetGroupId, status, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const resourceName = ResourceNames.assetGroup(customerId, assetGroupId)
  try {
    if (status === 'Removed') {
      await customer.assetGroups.remove([resourceName], validateOnly ? { validate_only: true } : undefined)
      return { success: true, validateOnly: !!validateOnly }
    }
    const statusEnum = { Active: enums.AssetGroupStatus.ENABLED, Paused: enums.AssetGroupStatus.PAUSED }[status]
    if (!statusEnum) throw new Error(`Invalid status: ${status}`)
    await customer.assetGroups.update([{
      resource_name: resourceName,
      status: statusEnum,
    }], validateOnly ? { validate_only: true } : undefined)
    return { success: true, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Full creative detail (for the Manage modal — same shape the Create form uses) ──

// Field types this app manages, mapped to the grouped-detail key they land
// under. PORTRAIT_MARKETING_IMAGE (and anything else Google or the account
// has attached) is deliberately left out — same scope as the Create form,
// which never collects a portrait image either — so any existing portrait
// image just doesn't show up here and is left completely untouched by update.
const FIELD_TYPE_KEY = {
  [String(enums.AssetFieldType.HEADLINE)]:               'headlines',
  [String(enums.AssetFieldType.DESCRIPTION)]:             'descriptions',
  [String(enums.AssetFieldType.LONG_HEADLINE)]:           'longHeadlines',
  [String(enums.AssetFieldType.MARKETING_IMAGE)]:         'marketingImages',
  [String(enums.AssetFieldType.SQUARE_MARKETING_IMAGE)]:  'squareImages',
  [String(enums.AssetFieldType.LOGO)]:                    'logos',
  [String(enums.AssetFieldType.BUSINESS_NAME)]:           'businessNames',
}

async function getAssetGroupDetail({ api, credentials }, customerId, mccCustomerId, assetGroupId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  let agRows, assetRows
  try {
    agRows = await customer.query(`
      SELECT asset_group.id, asset_group.name, asset_group.status, asset_group.final_urls, asset_group.ad_strength,
        campaign.id, campaign.name
      FROM asset_group
      WHERE asset_group.id = ${assetGroupId}
    `)
    assetRows = await customer.query(`
      SELECT asset_group_asset.resource_name, asset_group_asset.field_type,
        asset.resource_name, asset.text_asset.text, asset.image_asset.full_size.url
      FROM asset_group_asset
      WHERE asset_group_asset.asset_group = 'customers/${customerId}/assetGroups/${assetGroupId}'
    `)
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }

  const ag = agRows[0]?.asset_group
  if (!ag) throw new Error('Asset group not found.')

  const grouped = { headlines: [], descriptions: [], longHeadlines: [], marketingImages: [], squareImages: [], logos: [], businessNames: [] }
  for (const r of assetRows) {
    const key = FIELD_TYPE_KEY[enumStr(r.asset_group_asset?.field_type)]
    if (!key) continue
    grouped[key].push({
      linkResourceName:  r.asset_group_asset?.resource_name ?? '',
      assetResourceName: r.asset?.resource_name ?? '',
      text: r.asset?.text_asset?.text ?? null,
      url:  r.asset?.image_asset?.full_size?.url ?? null,
    })
  }

  return {
    id:           String(ag.id),
    name:         ag.name ?? '',
    status:       STATUS_MAP[enumStr(ag.status)] || enumStr(ag.status),
    finalUrl:     (ag.final_urls || [])[0] || '',
    campaignId:   String(agRows[0].campaign?.id ?? ''),
    campaignName: agRows[0].campaign?.name ?? '',
    headlines:        grouped.headlines,
    descriptions:     grouped.descriptions,
    longHeadline:     grouped.longHeadlines[0] || null,
    marketingImages:  grouped.marketingImages,
    squareImages:     grouped.squareImages,
    logos:            grouped.logos,
    businessName:     grouped.businessNames[0] || null,
  }
}

// ── Update an asset group's full creative content ──────────────────────────
// Content-based diffing, same convention as Keywords Manager's keyword-set
// updates: compare the submitted text/URL lists against `existing` (the
// getAssetGroupDetail snapshot the frontend fetched to populate the form).
// Anything present in `existing` but missing from the new list gets its
// asset_group_asset link removed; anything new gets a fresh asset created
// and linked. Unchanged items are left alone entirely — no needless
// re-fetch/re-upload of an image whose URL didn't change. asset_group_asset
// has no "update" operation on the wire (confirmed via the same
// remove-old+create-new pattern already used for keyword match-type changes)
// so this is the only correct way to change what's linked.
//
// Removing and creating asset_group_asset links for the same field type in
// one combined mutate call works reliably — but ONLY when the operations
// are ordered [all raw `asset` creates] → [all `asset_group_asset` removes]
// → [all `asset_group_asset` link creates]. Confirmed live via direct
// experiment against the real API: identical operations, same field, same
// counts, fail with "Headline/Business name/... asset for a valid asset
// group is not enough" whenever a remove appears in the array before the
// matching create — even a single 1-for-1 swap of a field already at its
// min (or max) fails if ordered [remove, create], but succeeds if ordered
// [create, remove] or [create-the-raw-asset, remove, create-the-link].
// Google appears to process the batch in array order and evaluates each
// field type's running link count as it goes, so creating the replacement
// (or at least the new raw asset) before removing the old link keeps every
// intermediate state — and the final one — within that field's real bounds.
// This holds even for large-scale swaps (e.g. replacing all 11 of 11
// headlines with 15 new ones in a single call) and for single-slot fields
// (business name, logo, marketing/square image) where the "old" item being
// removed is the only one that exists.
async function updateAssetGroupContent({ api, credentials }, customerId, mccCustomerId, args) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const {
    assetGroupId, name, finalUrl, businessName,
    headlines = [], longHeadline, descriptions = [],
    marketingImageUrls = [], squareMarketingImageUrls = [], logoImageUrls = [],
    existing, validateOnly = false,
  } = args || {}

  if (!assetGroupId)                    throw new Error('An asset group is required.')
  if (!String(name || '').trim())       throw new Error('Asset group name is required.')
  if (!finalUrl)                        throw new Error('Final URL is required.')
  if (!String(businessName || '').trim()) throw new Error('Business name is required.')
  const hs = headlines.filter(Boolean), ds = descriptions.filter(Boolean)
  if (hs.length < 3) throw new Error('At least 3 headlines are required for Performance Max.')
  if (ds.length < 2) throw new Error('At least 2 descriptions are required for Performance Max.')
  const mUrls = marketingImageUrls.filter(Boolean)
  const sUrls = squareMarketingImageUrls.filter(Boolean)
  const lUrls = logoImageUrls.filter(Boolean)
  if (mUrls.length === 0) throw new Error('At least one marketing image is required.')
  if (sUrls.length === 0) throw new Error('At least one square marketing image is required.')
  if (lUrls.length === 0) throw new Error('At least one logo image is required.')

  const assetGroupRN = ResourceNames.assetGroup(customerId, assetGroupId)
  const assetCreateOps = []
  const removeOps      = []
  const linkCreateOps  = []

  const agUpdate = { resource_name: assetGroupRN }
  let agDirty = false
  if (String(name).trim() !== existing?.name)   { agUpdate.name = String(name).trim(); agDirty = true }
  if (finalUrl !== existing?.finalUrl)          { agUpdate.final_urls = [finalUrl]; agDirty = true }

  let tempId = -100
  function diffTextField(newTexts, oldItems, fieldTypeName) {
    const oldTexts = oldItems.map(i => i.text)
    for (const item of oldItems) {
      if (!newTexts.includes(item.text)) {
        removeOps.push({ entity: 'asset_group_asset', operation: 'remove', resource: item.linkResourceName })
      }
    }
    for (const text of newTexts) {
      if (!oldTexts.includes(text)) {
        const rn = ResourceNames.asset(customerId, String(tempId)); tempId -= 1
        assetCreateOps.push({ entity: 'asset', operation: 'create', resource: { resource_name: rn, name: `Asset Group ${assetGroupId} - ${fieldTypeName}`, type: enums.AssetType.TEXT, text_asset: { text } } })
        linkCreateOps.push({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType[fieldTypeName] } })
      }
    }
  }
  diffTextField(hs, existing?.headlines || [], 'HEADLINE')
  diffTextField(ds, existing?.descriptions || [], 'DESCRIPTION')
  diffTextField(longHeadline ? [longHeadline] : [], existing?.longHeadline ? [existing.longHeadline] : [], 'LONG_HEADLINE')
  diffTextField([businessName.trim()], existing?.businessName ? [existing.businessName] : [], 'BUSINESS_NAME')

  async function diffImageField(newUrls, oldItems, fieldTypeName) {
    const oldUrls = oldItems.map(i => i.url)
    for (const item of oldItems) {
      if (!newUrls.includes(item.url)) {
        removeOps.push({ entity: 'asset_group_asset', operation: 'remove', resource: item.linkResourceName })
      }
    }
    for (const url of newUrls) {
      if (!oldUrls.includes(url)) {
        const buf = await fetchImageBuffer(url)
        const rn = ResourceNames.asset(customerId, String(tempId)); tempId -= 1
        assetCreateOps.push({ entity: 'asset', operation: 'create', resource: { resource_name: rn, name: `Asset Group ${assetGroupId} - ${fieldTypeName} image`, type: enums.AssetType.IMAGE, image_asset: { data: buf, mime_type: mimeTypeFromUrl(url) } } })
        linkCreateOps.push({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType[fieldTypeName] } })
      }
    }
  }
  await diffImageField(mUrls, existing?.marketingImages || [], 'MARKETING_IMAGE')
  await diffImageField(sUrls, existing?.squareImages || [], 'SQUARE_MARKETING_IMAGE')
  await diffImageField(lUrls, existing?.logos || [], 'LOGO')

  const operations = [...assetCreateOps, ...removeOps, ...linkCreateOps]
  if (agDirty) operations.push({ entity: 'asset_group', operation: 'update', resource: agUpdate })

  if (operations.length === 0) return { success: true, validateOnly: !!validateOnly, noChanges: true }

  try {
    await customer.mutateResources(operations, validateOnly ? { validate_only: true } : undefined)
    return { success: true, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Create a new asset group in an existing Performance Max campaign ──────────

/**
 * args: {
 *   campaignId, name, finalUrl, businessName,
 *   headlines: [string] (3+), longHeadline, descriptions: [string] (2+),
 *   marketingImageUrls: [string] (1+), squareMarketingImageUrls: [string] (1+), logoImageUrls: [string] (1+),
 *   validateOnly,
 * }
 * Business name + logo ARE required here, per asset group — even though
 * createPerformanceMaxCampaign (campaignClient.js) links those at the
 * CAMPAIGN level instead when it creates a campaign's first asset group
 * atomically alongside the campaign (this account has PMax "Brand
 * Guidelines" on). Confirmed live that this doesn't extend to a SECOND
 * asset group added afterward to an already-existing campaign: creating one
 * without its own business name/logo fails validation ("Business name asset
 * for a valid asset group is not enough" / same for Logo) — Brand
 * Guidelines' auto-population of new asset groups is evidently a Google Ads
 * UI behavior, not something the raw create API does on its own. So every
 * asset group created here gets its own asset-group-level links.
 */
async function createAssetGroup({ api, credentials }, customerId, mccCustomerId, args) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const {
    campaignId, name, finalUrl, businessName,
    headlines = [], longHeadline, descriptions = [],
    marketingImageUrls = [], squareMarketingImageUrls = [], logoImageUrls = [],
    validateOnly = false,
  } = args || {}

  if (!campaignId)                 throw new Error('A campaign is required.')
  if (!String(name || '').trim())  throw new Error('Asset group name is required.')
  if (!finalUrl)                   throw new Error('Final URL is required.')
  if (!String(businessName || '').trim())      throw new Error('Business name is required.')
  if (headlines.filter(Boolean).length < 3)    throw new Error('At least 3 headlines are required for Performance Max.')
  if (descriptions.filter(Boolean).length < 2) throw new Error('At least 2 descriptions are required for Performance Max.')
  if (marketingImageUrls.filter(Boolean).length === 0)       throw new Error('At least one marketing image is required.')
  if (squareMarketingImageUrls.filter(Boolean).length === 0) throw new Error('At least one square marketing image is required.')
  if (logoImageUrls.filter(Boolean).length === 0)             throw new Error('At least one logo image is required.')

  let tempId = -100
  const assetOps = []
  const textRNs  = { headline: [], longHeadline: [], description: [], businessName: [] }
  const imageRNs = { marketing: [], square: [], logo: [] }

  function addTextAsset(text, bucket) {
    const rn = ResourceNames.asset(customerId, String(tempId)); tempId -= 1
    assetOps.push({ entity: 'asset', operation: 'create', resource: { resource_name: rn, name: `${name} - ${bucket}`, type: enums.AssetType.TEXT, text_asset: { text } } })
    textRNs[bucket].push(rn)
  }
  headlines.filter(Boolean).slice(0, 15).forEach(h => addTextAsset(h, 'headline'))
  descriptions.filter(Boolean).slice(0, 5).forEach(d => addTextAsset(d, 'description'))
  if (longHeadline) addTextAsset(longHeadline, 'longHeadline')
  addTextAsset(businessName.trim(), 'businessName')

  async function addImages(urls, bucket) {
    for (const url of urls.filter(Boolean)) {
      const buf = await fetchImageBuffer(url)
      const rn = ResourceNames.asset(customerId, String(tempId)); tempId -= 1
      assetOps.push({ entity: 'asset', operation: 'create', resource: { resource_name: rn, name: `${name} - ${bucket} image`, type: enums.AssetType.IMAGE, image_asset: { data: buf, mime_type: mimeTypeFromUrl(url) } } })
      imageRNs[bucket].push(rn)
    }
  }
  await addImages(marketingImageUrls, 'marketing')
  await addImages(squareMarketingImageUrls, 'square')
  await addImages(logoImageUrls, 'logo')

  const campaignRN   = ResourceNames.campaign(customerId, campaignId)
  const assetGroupRN = ResourceNames.assetGroup(customerId, '-1')
  const assetGroupOpIdx = assetOps.length

  const operations = [
    ...assetOps,
    {
      entity: 'asset_group', operation: 'create',
      resource: { resource_name: assetGroupRN, campaign: campaignRN, name: name.trim(), final_urls: [finalUrl], status: enums.AssetGroupStatus.ENABLED },
    },
    ...textRNs.headline.map(rn     => ({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType.HEADLINE } })),
    ...textRNs.description.map(rn  => ({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType.DESCRIPTION } })),
    ...textRNs.longHeadline.map(rn => ({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType.LONG_HEADLINE } })),
    ...imageRNs.marketing.map(rn   => ({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType.MARKETING_IMAGE } })),
    ...imageRNs.square.map(rn      => ({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType.SQUARE_MARKETING_IMAGE } })),
    ...textRNs.businessName.map(rn => ({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType.BUSINESS_NAME } })),
    ...imageRNs.logo.map(rn        => ({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType.LOGO } })),
  ]

  try {
    const result = await customer.mutateResources(operations, validateOnly ? { validate_only: true } : undefined)
    if (validateOnly) return { success: true, validateOnly: true }
    return {
      success: true,
      assetGroupResourceName: resultResourceName(result, assetGroupOpIdx, assetGroupRN),
      createdResourceNames: extractResourceNames(result),
    }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Rollback ────────────────────────────────────────────────────────────────

async function rollbackAssetGroupCreate({ api, credentials }, customerId, mccCustomerId, { assetGroupResourceName }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  try {
    await customer.assetGroups.update([{ resource_name: assetGroupResourceName, status: enums.AssetGroupStatus.PAUSED }])
    return { success: true }
  } catch (e) {
    return { success: false, errors: [parseGoogleAdsError(e)] }
  }
}

async function rollbackAssetGroupUpdate({ api, credentials }, customerId, mccCustomerId, { action, assetGroupId, before, after }) {
  try {
    if (action === 'updateName')   return await updateAssetGroupName({ api, credentials }, customerId, mccCustomerId, { assetGroupId, name: before.name })
    if (action === 'updateStatus') return await updateAssetGroupStatus({ api, credentials }, customerId, mccCustomerId, { assetGroupId, status: before.status })
    if (action === 'updateContent') {
      return await updateAssetGroupContent({ api, credentials }, customerId, mccCustomerId, {
        assetGroupId,
        name: before.name, finalUrl: before.finalUrl, businessName: before.businessName?.text,
        headlines: before.headlines.map(h => h.text), descriptions: before.descriptions.map(d => d.text),
        longHeadline: before.longHeadline?.text,
        marketingImageUrls: before.marketingImages.map(i => i.url),
        squareMarketingImageUrls: before.squareImages.map(i => i.url),
        logoImageUrls: before.logos.map(i => i.url),
        existing: after,
      })
    }
    return { success: false, errors: [`Unknown rollback action: ${action}`] }
  } catch (e) {
    return { success: false, errors: [e.message] }
  }
}

module.exports = {
  listAssetGroups, getAssetGroupDetail, updateAssetGroupName, updateAssetGroupStatus, updateAssetGroupContent,
  createAssetGroup, rollbackAssetGroupCreate, rollbackAssetGroupUpdate,
}
