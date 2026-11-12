'use strict'

// Ad Group Manager backend — peer module to campaignClient.js/googleAdsClient.js.
// Search campaigns only (confirmed with user). Covers: managing an existing
// ad group's name/status/default CPC bid, creating a new ad group (with
// initial keywords) inside an existing campaign, and managing that ad
// group's existing keywords (add/remove/change match type) — kept as its
// own file rather than folding into campaignClient.js so each resource
// type's mutate logic stays easy to find, matching how campaignClient.js
// itself was split out from googleAdsClient.js.

const { makeCustomer, parseGoogleAdsError, enumStr, n } = require('./googleAdsClient')
const { extractResourceNames, resultResourceName, matchTypeEnum, matchTypeName } = require('./campaignClient')
const { enums, ResourceNames, toMicros } = require('google-ads-api')

const STATUS_MAP = {
  ENABLED: 'Active', PAUSED: 'Paused', REMOVED: 'Removed',
  '2': 'Active', '3': 'Paused', '4': 'Removed',
}

// ── Ad group list (for a selected campaign) ───────────────────────────────────

async function listAdGroups({ api, credentials }, customerId, mccCustomerId, campaignId, { hidePaused } = {}) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  let rows
  try {
    rows = await customer.query(`
      SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros,
        campaign.id, campaign.name
      FROM ad_group
      WHERE ad_group.campaign = 'customers/${customerId}/campaigns/${campaignId}'
        AND ad_group.status != 'REMOVED'
        ${hidePaused ? "AND ad_group.status = 'ENABLED'" : ''}
      ORDER BY ad_group.name
    `)
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }

  return rows.map(r => ({
    id:            String(r.ad_group?.id ?? ''),
    name:          r.ad_group?.name ?? '',
    status:        STATUS_MAP[enumStr(r.ad_group?.status)] || enumStr(r.ad_group?.status),
    type:          enumStr(r.ad_group?.type),
    cpcBidMicros:  n(r.ad_group?.cpc_bid_micros ?? 0),
    campaignId:    String(r.campaign?.id ?? ''),
    campaignName:  r.campaign?.name ?? '',
  }))
}

// ── Create a new ad group (+ initial keywords) in an existing campaign ────────

/**
 * args: { campaignId, name, cpcBid (dollars, optional), keywords: [{ text, matchType }], validateOnly }
 * cpcBid is omitted from the mutate entirely when not a positive number, so
 * the ad group just inherits the campaign's bidding behavior instead of
 * forcing a manual override on a campaign that may use automated bidding.
 */
async function createAdGroup({ api, credentials }, customerId, mccCustomerId, args) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const { campaignId, name, cpcBid, keywords = [], validateOnly = false } = args || {}

  if (!campaignId)                    throw new Error('A campaign is required.')
  if (!String(name || '').trim())     throw new Error('Ad group name is required.')
  const kws = keywords.filter(k => String(k.text || '').trim())
  if (kws.length === 0)               throw new Error('At least one keyword is required.')

  const campaignRN = ResourceNames.campaign(customerId, campaignId)
  const adGroupRN  = ResourceNames.adGroup(customerId, '-1')

  const operations = [{
    entity: 'ad_group', operation: 'create',
    resource: {
      resource_name: adGroupRN,
      name:     name.trim(),
      campaign: campaignRN,
      status:   enums.AdGroupStatus.ENABLED,
      type:     enums.AdGroupType.SEARCH_STANDARD,
      ...(Number(cpcBid) > 0 ? { cpc_bid_micros: toMicros(Number(cpcBid)) } : {}),
    },
  }]
  const adGroupOpIdx = 0

  for (const kw of kws) {
    operations.push({
      entity: 'ad_group_criterion', operation: 'create',
      resource: {
        ad_group: adGroupRN,
        status:   enums.AdGroupCriterionStatus.ENABLED,
        keyword:  { text: String(kw.text).trim(), match_type: matchTypeEnum(kw.matchType) },
      },
    })
  }

  try {
    const result = await customer.mutateResources(operations, validateOnly ? { validate_only: true } : undefined)
    if (validateOnly) return { success: true, validateOnly: true }
    return {
      success: true,
      adGroupResourceName: resultResourceName(result, adGroupOpIdx, adGroupRN),
      createdResourceNames: extractResourceNames(result),
    }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Keyword management (for an existing ad group) ─────────────────────────────

async function listAdGroupKeywords({ api, credentials }, customerId, mccCustomerId, adGroupId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const adGroupRN = ResourceNames.adGroup(customerId, adGroupId)
  let rows
  try {
    rows = await customer.query(`
      SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
      FROM ad_group_criterion
      WHERE ad_group_criterion.ad_group = '${adGroupRN}'
        AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.negative = false
        AND ad_group_criterion.status != 'REMOVED'
      ORDER BY ad_group_criterion.keyword.text
    `)
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
  return rows.map(r => ({
    id:        String(r.ad_group_criterion?.criterion_id ?? ''),
    text:      r.ad_group_criterion?.keyword?.text ?? '',
    matchType: matchTypeName(r.ad_group_criterion?.keyword?.match_type),
  }))
}

/**
 * Sets an ad group's keywords to exactly the given list — diffs against
 * current criteria (fetched fresh) and issues create/remove ops for the
 * delta. keywords: [{ text, matchType }] (an `id` may be present from
 * listAdGroupKeywords but is ignored here — see below).
 *
 * A keyword's identity is its (text, matchType) pair, not its criterion id.
 * That pair is unique within an ad group (Google Ads itself rejects a
 * duplicate text+match_type pair, and match_type is IMMUTABLE on update —
 * confirmed live: "Field 'keyword.match_type' cannot be modified by
 * 'UPDATE' operation", same as the real Google Ads UI, where "changing"
 * match type is really remove-old + create-new). Matching on content
 * instead of id means a "changed match type" naturally resolves to one
 * remove + one create with no special-casing, and it makes rollback (which
 * replays a `before` snapshot as the new desired list) correct even though
 * the ids in that snapshot may no longer exist on the current criteria.
 */
async function updateAdGroupKeywords({ api, credentials }, customerId, mccCustomerId, { adGroupId, keywords = [], validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const adGroupRN = ResourceNames.adGroup(customerId, adGroupId)
  const desired = keywords.filter(k => String(k.text || '').trim()).map(k => ({ text: String(k.text).trim(), matchType: String(k.matchType || 'BROAD').toUpperCase() }))

  let current
  try {
    current = await listAdGroupKeywords({ api, credentials }, customerId, mccCustomerId, adGroupId)
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }

  const sameContent = (a, b) => a.text === b.text && a.matchType === b.matchType
  const operations = []

  for (const cur of current) {
    if (!desired.some(d => sameContent(d, cur)))
      operations.push({ entity: 'ad_group_criterion', operation: 'remove', resource: ResourceNames.adGroupCriterion(customerId, adGroupId, cur.id) })
  }
  for (const d of desired) {
    if (!current.some(c => sameContent(d, c)))
      operations.push({
        entity: 'ad_group_criterion', operation: 'create',
        resource: { ad_group: adGroupRN, status: enums.AdGroupCriterionStatus.ENABLED, keyword: { text: d.text, match_type: matchTypeEnum(d.matchType) } },
      })
  }

  if (operations.length === 0) return { success: true, changed: 0, validateOnly: !!validateOnly }

  try {
    await customer.mutateResources(operations, validateOnly ? { validate_only: true } : undefined)
    return { success: true, changed: operations.length, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Mutations ──────────────────────────────────────────────────────────────────

async function updateAdGroupName({ api, credentials }, customerId, mccCustomerId, { adGroupId, name, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('Ad group name is required.')
  try {
    await customer.adGroups.update([{
      resource_name: ResourceNames.adGroup(customerId, adGroupId),
      name: trimmed,
    }], validateOnly ? { validate_only: true } : undefined)
    return { success: true, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// REMOVED can't be set through a regular update (same "Enum value 'REMOVED'
// cannot be used" restriction confirmed live for campaigns) — it's a
// dedicated mutate operation type.
async function updateAdGroupStatus({ api, credentials }, customerId, mccCustomerId, { adGroupId, status, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const resourceName = ResourceNames.adGroup(customerId, adGroupId)
  try {
    if (status === 'Removed') {
      await customer.adGroups.remove([resourceName], validateOnly ? { validate_only: true } : undefined)
      return { success: true, validateOnly: !!validateOnly }
    }
    const statusEnum = { Active: enums.AdGroupStatus.ENABLED, Paused: enums.AdGroupStatus.PAUSED }[status]
    if (!statusEnum) throw new Error(`Invalid status: ${status}`)
    await customer.adGroups.update([{
      resource_name: resourceName,
      status: statusEnum,
    }], validateOnly ? { validate_only: true } : undefined)
    return { success: true, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

async function updateAdGroupBid({ api, credentials }, customerId, mccCustomerId, { adGroupId, cpcBid, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  try {
    await customer.adGroups.update([{
      resource_name: ResourceNames.adGroup(customerId, adGroupId),
      cpc_bid_micros: toMicros(Number(cpcBid) || 0),
    }], validateOnly ? { validate_only: true } : undefined)
    return { success: true, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Rollback (restore-previous / pause-created — never a hard delete/un-remove,
//    matching the campaignClient.js convention; Google Ads doesn't support
//    un-removing an ad group any more than it does a campaign) ───────────────

async function rollbackAdGroupCreate({ api, credentials }, customerId, mccCustomerId, { adGroupResourceName }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  try {
    await customer.adGroups.update([{ resource_name: adGroupResourceName, status: enums.AdGroupStatus.PAUSED }])
    return { success: true }
  } catch (e) {
    return { success: false, errors: [parseGoogleAdsError(e)] }
  }
}

async function rollbackAdGroupUpdate({ api, credentials }, customerId, mccCustomerId, { action, adGroupId, before }) {
  try {
    if (action === 'updateName')   return await updateAdGroupName({ api, credentials }, customerId, mccCustomerId, { adGroupId, name: before.name })
    if (action === 'updateStatus') return await updateAdGroupStatus({ api, credentials }, customerId, mccCustomerId, { adGroupId, status: before.status })
    if (action === 'updateBid')    return await updateAdGroupBid({ api, credentials }, customerId, mccCustomerId, { adGroupId, cpcBid: before.cpcBid })
    if (action === 'updateKeywords') return await updateAdGroupKeywords({ api, credentials }, customerId, mccCustomerId, { adGroupId, keywords: before.keywords })
    return { success: false, errors: [`Unknown rollback action: ${action}`] }
  } catch (e) {
    return { success: false, errors: [e.message] }
  }
}

module.exports = {
  listAdGroups, createAdGroup,
  listAdGroupKeywords, updateAdGroupKeywords,
  updateAdGroupName, updateAdGroupStatus, updateAdGroupBid,
  rollbackAdGroupCreate, rollbackAdGroupUpdate,
}
