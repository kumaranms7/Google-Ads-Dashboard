'use strict'

// Keywords Manager backend — peer module to campaignClient.js/adGroupClient.js.
// Search only (keywords are a Search construct — same scope boundary already
// established for Ad Group Manager's keyword features). Covers: listing an
// ad group's keywords with full performance metrics + a rule-based
// Keep/Optimize/Pause/Monitor recommendation, editing a keyword (status,
// match type, or moving it to a different campaign/ad group), and bulk-
// adding new keywords. AI recommendation endpoints live in main.js
// alongside the other Claude-backed handlers, matching the existing
// convention (campaign:aiRecommend, adGroup:aiRecommendKeywords, etc.).

const { makeCustomer, parseGoogleAdsError, enumStr, n, buildDateClause, isPhoneConversionAction, fetchConversionActionCategoryMap } = require('./googleAdsClient')
const { matchTypeEnum, matchTypeName } = require('./campaignClient')
const { enums, ResourceNames } = require('google-ads-api')

const STATUS_MAP = {
  ENABLED: 'Active', PAUSED: 'Paused', REMOVED: 'Removed',
  '2': 'Active', '3': 'Paused', '4': 'Removed',
}

// Rule-based, not AI — needs to be instant and always-available for a table
// column that may render 100+ rows. The Manage popup's AI recommendation
// (a single Claude call per keyword, on demand) is the deep-dive version of
// this same question, and is explicitly told this table's verdict so the two
// stay reconciled instead of silently disagreeing (see the
// keywordManager:aiRecommendForKeyword prompt in main.js).
//
// A clear "spending real money, zero results" signal must outrank the
// low-impressions/"not enough data yet" bucket — otherwise a keyword with
// e.g. 45 impressions but $80 spent and 0 conversions gets stamped Monitor
// here while the AI (seeing the same cost/conversions) correctly says Pause,
// which is exactly the contradiction this ordering exists to prevent.
function computeRecommendation({ impressions, clicks, cost, conversions, ctr, qualityScore }) {
  if (conversions === 0 && (cost >= 50 || clicks >= 20)) return 'Pause'
  if (impressions < 50) return 'Monitor'
  if (qualityScore > 0 && qualityScore <= 3) return 'Optimize'
  if (impressions > 500 && ctr < 1) return 'Optimize'
  if (conversions > 0) return 'Keep'
  return 'Optimize'
}

// ── List keywords for one ad group, with performance metrics ─────────────────

async function listKeywords({ api, credentials }, customerId, mccCustomerId, { adGroupId, dateRange } = {}) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const adGroupRN = ResourceNames.adGroup(customerId, adGroupId)
  const dateClause = buildDateClause(dateRange)

  let rows, convRows, convActionMap
  try {
    ;[rows, convRows, convActionMap] = await Promise.all([
      customer.query(`
        SELECT ad_group_criterion.resource_name, ad_group_criterion.criterion_id,
          ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
          ad_group_criterion.quality_info.quality_score, ad_group_criterion.status,
          campaign.id, campaign.name, campaign.status,
          ad_group.id, ad_group.name, ad_group.status,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.phone_calls
        FROM keyword_view
        WHERE ad_group.id = ${adGroupId}
          AND ${dateClause}
          AND ad_group_criterion.negative = false
          AND ad_group_criterion.status != 'REMOVED'
      `),
      customer.query(`
        SELECT ad_group_criterion.resource_name, segments.conversion_action_name, metrics.conversions, metrics.all_conversions
        FROM keyword_view
        WHERE ad_group.id = ${adGroupId}
          AND ${dateClause}
          AND ad_group_criterion.negative = false
          AND metrics.all_conversions > 0
      `).catch(() => []),
      fetchConversionActionCategoryMap(customer),
    ])
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }

  // Per-action-name breakdown (not just phone/form sums) for the Form/Call
  // Conv. drill-down. No per-keyword Call Leads breakdown is possible —
  // call_view has no keyword dimension in the Google Ads API, so a call
  // can't be attributed to the specific keyword that triggered it. Phone
  // actions use metrics.all_conversions — metrics.conversions for calls lags
  // behind duration verification and can read 0 for days even though Google
  // Ads' own summary already shows the count.
  const convMap = {}
  for (const r of convRows) {
    const key  = r.ad_group_criterion?.resource_name || ''
    const name = r.segments?.conversion_action_name ?? ''
    const isPhoneRow = isPhoneConversionAction(convActionMap.get(name))
    const c    = isPhoneRow ? n(r.metrics?.all_conversions ?? 0) : n(r.metrics?.conversions ?? 0)
    if (!key) continue
    if (!convMap[key]) convMap[key] = { phone: 0, form: 0, phoneBreakdown: {}, formBreakdown: {} }
    const label = name || '(Unnamed conversion action)'
    if (isPhoneRow) {
      convMap[key].phone += c
      convMap[key].phoneBreakdown[label] = (convMap[key].phoneBreakdown[label] || 0) + c
    } else {
      convMap[key].form += c
      convMap[key].formBreakdown[label] = (convMap[key].formBreakdown[label] || 0) + c
    }
  }
  const toBreakdownList = obj => Object.entries(obj)
    .filter(([, conversions]) => conversions > 0)
    .map(([name, conversions]) => ({ name, conversions }))
    .sort((a, b) => b.conversions - a.conversions)

  const kwMap = new Map()
  for (const r of rows) {
    const id = r.ad_group_criterion?.resource_name || ''
    if (!id) continue
    if (!kwMap.has(id)) {
      const cv = convMap[id] || { phone: 0, form: 0, phoneBreakdown: {}, formBreakdown: {} }
      kwMap.set(id, {
        resourceName:     id,
        id:                String(r.ad_group_criterion?.criterion_id ?? ''),
        text:              r.ad_group_criterion?.keyword?.text || '—',
        matchType:         matchTypeName(r.ad_group_criterion?.keyword?.match_type),
        status:            STATUS_MAP[enumStr(r.ad_group_criterion?.status)] || enumStr(r.ad_group_criterion?.status),
        qualityScore:      n(r.ad_group_criterion?.quality_info?.quality_score ?? 0),
        campaignId:        String(r.campaign?.id ?? ''),
        campaignName:      r.campaign?.name || '—',
        campaignStatus:    STATUS_MAP[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status),
        adGroupId:         String(r.ad_group?.id ?? ''),
        adGroupName:       r.ad_group?.name || '—',
        adGroupStatus:     STATUS_MAP[enumStr(r.ad_group?.status)] || enumStr(r.ad_group?.status),
        impressions: 0, clicks: 0, cost: 0, conversions: 0, phoneCalls: 0,
        phoneConversions: cv.phone,
        formConversions:  cv.form,
        phoneBreakdown:   toBreakdownList(cv.phoneBreakdown),
        formBreakdown:    toBreakdownList(cv.formBreakdown),
      })
    }
    const kw = kwMap.get(id)
    kw.impressions += n(r.metrics?.impressions ?? 0)
    kw.clicks      += n(r.metrics?.clicks      ?? 0)
    kw.cost        += n(r.metrics?.cost_micros ?? 0) / 1e6
    kw.conversions += n(r.metrics?.conversions ?? 0)
    kw.phoneCalls  += n(r.metrics?.phone_calls ?? 0)
    const qs = n(r.ad_group_criterion?.quality_info?.quality_score ?? 0)
    if (qs > kw.qualityScore) kw.qualityScore = qs
  }

  return Array.from(kwMap.values())
    .map(kw => {
      const cpc = kw.clicks > 0 ? kw.cost / kw.clicks : 0
      const ctr = kw.impressions > 0 ? (kw.clicks / kw.impressions) * 100 : 0
      return { ...kw, cpc, ctr, recommendation: computeRecommendation({ ...kw, ctr }) }
    })
    .sort((a, b) => b.impressions - a.impressions)
}

// ── Search terms for one ad group (AI context for new-keyword suggestions) ──

async function listSearchTerms({ api, credentials }, customerId, mccCustomerId, { adGroupId, dateRange } = {}) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange)
  let rows
  try {
    rows = await customer.query(`
      SELECT search_term_view.search_term,
        metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM search_term_view
      WHERE ad_group.id = ${adGroupId}
        AND ${dateClause}
      ORDER BY metrics.cost_micros DESC
      LIMIT 100
    `)
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
  return rows.map(r => ({
    term:        r.search_term_view?.search_term || '',
    impressions: n(r.metrics?.impressions ?? 0),
    clicks:      n(r.metrics?.clicks ?? 0),
    cost:        n(r.metrics?.cost_micros ?? 0) / 1e6,
    conversions: n(r.metrics?.conversions ?? 0),
  })).filter(r => r.term)
}

// ── Edit a keyword: status, match type, or move to a different ad group ──────

/**
 * args: {
 *   resourceName (current ad_group_criterion resource name),
 *   text (keyword text, unchanged),
 *   currentMatchType, currentAdGroupId,
 *   newStatus ('Active'|'Paused'|'Removed'), newMatchType,
 *   newCampaignId, newAdGroupId,
 *   validateOnly,
 * }
 * match_type is IMMUTABLE on update (confirmed live, same as Ad Group
 * Manager's keyword editor) and moving ad groups obviously can't be an
 * in-place field update either — both cases resolve to remove-old +
 * create-new. A pure status flip (Active<->Paused) is the only case that's
 * a real in-place update. Setting status to Removed always just removes,
 * regardless of any other field changes (a removed keyword doesn't need to
 * also move or change match type).
 */
async function updateKeyword({ api, credentials }, customerId, mccCustomerId, args) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const {
    resourceName, text, currentMatchType, currentAdGroupId,
    newStatus, newMatchType, newAdGroupId,
    validateOnly,
  } = args || {}

  if (!resourceName) throw new Error('A keyword is required.')

  try {
    if (newStatus === 'Removed') {
      await customer.adGroupCriteria.remove([resourceName], validateOnly ? { validate_only: true } : undefined)
      return { success: true, validateOnly: !!validateOnly }
    }

    const moving       = String(newAdGroupId) !== String(currentAdGroupId)
    const changingMatch = newMatchType && newMatchType !== currentMatchType
    const statusEnum = { Active: enums.AdGroupCriterionStatus.ENABLED, Paused: enums.AdGroupCriterionStatus.PAUSED }[newStatus] || enums.AdGroupCriterionStatus.ENABLED

    if (moving || changingMatch) {
      const targetAdGroupRN = ResourceNames.adGroup(customerId, newAdGroupId || currentAdGroupId)
      const operations = [
        { entity: 'ad_group_criterion', operation: 'remove', resource: resourceName },
        {
          entity: 'ad_group_criterion', operation: 'create',
          resource: {
            ad_group: targetAdGroupRN,
            status:   statusEnum,
            keyword:  { text, match_type: matchTypeEnum(newMatchType || currentMatchType) },
          },
        },
      ]
      await customer.mutateResources(operations, validateOnly ? { validate_only: true } : undefined)
      return { success: true, moved: moving, matchTypeChanged: changingMatch, validateOnly: !!validateOnly }
    }

    // Pure status flip — a real in-place update.
    await customer.adGroupCriteria.update([{ resource_name: resourceName, status: statusEnum }], validateOnly ? { validate_only: true } : undefined)
    return { success: true, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Bulk edit: status OR match type across many selected keywords ────────────
//
// args: {
//   keywords: [{ resourceName, text, matchType (current), status (current), adGroupId }],
//   newStatus ('Active'|'Paused'|'Removed') XOR newMatchType, validateOnly,
// }
// Same remove-old+create-new rule as the single-keyword updateKeyword above
// applies per keyword when changing match type (match_type is immutable on
// update) — each keyword keeps its own current status and ad group, only the
// match type changes. A pure status flip stays a real in-place batched
// update. The two fields are mutually exclusive here (not combined like the
// single-keyword modal) so one bulk action always has one unambiguous effect
// on every row in the selection.
async function bulkUpdateKeywords({ api, credentials }, customerId, mccCustomerId, args) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const { keywords = [], newStatus, newMatchType, validateOnly } = args || {}

  if (!Array.isArray(keywords) || keywords.length === 0) throw new Error('At least one keyword is required.')
  if (!newStatus && !newMatchType) throw new Error('Nothing to update.')
  if (newStatus && newMatchType) throw new Error('Change status or match type, not both, in one bulk action.')

  const STATUS_ENUM = { Active: enums.AdGroupCriterionStatus.ENABLED, Paused: enums.AdGroupCriterionStatus.PAUSED }

  try {
    if (newStatus === 'Removed') {
      const resourceNames = keywords.map(k => k.resourceName)
      await customer.adGroupCriteria.remove(resourceNames, validateOnly ? { validate_only: true } : undefined)
      return { success: true, count: resourceNames.length, validateOnly: !!validateOnly }
    }

    if (newMatchType) {
      const operations = []
      for (const kw of keywords) {
        const adGroupRN = ResourceNames.adGroup(customerId, kw.adGroupId)
        operations.push({ entity: 'ad_group_criterion', operation: 'remove', resource: kw.resourceName })
        operations.push({
          entity: 'ad_group_criterion', operation: 'create',
          resource: {
            ad_group: adGroupRN,
            status:   STATUS_ENUM[kw.status] || enums.AdGroupCriterionStatus.ENABLED,
            keyword:  { text: kw.text, match_type: matchTypeEnum(newMatchType) },
          },
        })
      }
      await customer.mutateResources(operations, validateOnly ? { validate_only: true } : undefined)
      return { success: true, count: keywords.length, matchTypeChanged: true, validateOnly: !!validateOnly }
    }

    // Pure status flip (Active <-> Paused) — one batched in-place update.
    const updates = keywords.map(kw => ({ resource_name: kw.resourceName, status: STATUS_ENUM[newStatus] || enums.AdGroupCriterionStatus.ENABLED }))
    await customer.adGroupCriteria.update(updates, validateOnly ? { validate_only: true } : undefined)
    return { success: true, count: updates.length, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Bulk-add new keywords to an existing ad group ─────────────────────────────

async function addKeywords({ api, credentials }, customerId, mccCustomerId, { adGroupId, keywords = [], validateOnly } = {}) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const adGroupRN = ResourceNames.adGroup(customerId, adGroupId)
  const kws = keywords.filter(k => String(k.text || '').trim())
  if (kws.length === 0) throw new Error('At least one keyword is required.')

  const operations = kws.map(kw => ({
    entity: 'ad_group_criterion', operation: 'create',
    resource: {
      ad_group: adGroupRN,
      status:   enums.AdGroupCriterionStatus.ENABLED,
      keyword:  { text: String(kw.text).trim(), match_type: matchTypeEnum(kw.matchType) },
    },
  }))

  try {
    await customer.mutateResources(operations, validateOnly ? { validate_only: true } : undefined)
    return { success: true, added: operations.length, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

module.exports = {
  listKeywords, listSearchTerms, updateKeyword, bulkUpdateKeywords, addKeywords, computeRecommendation,
}
