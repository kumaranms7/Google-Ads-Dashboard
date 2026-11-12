'use strict'

// Campaign Manager backend — peer module to googleAdsClient.js. Kept separate
// because campaign creation (Phase 1+) uses the atomic multi-resource
// `customer.mutateResources()` API with temporary resource IDs, a different
// mutate style from googleAdsClient.js's single-resource sequential
// `.create()`/`.update()` calls. Phase 0 only needs read queries; create/update
// mutate functions land in Phase 1.

const { makeCustomer, parseGoogleAdsError, enumStr, n } = require('./googleAdsClient')
const { enums, ResourceNames, toMicros } = require('google-ads-api')
const https = require('https')
const http = require('http')

const STATUS_MAP = {
  ENABLED: 'Active', PAUSED: 'Paused', REMOVED: 'Removed',
  '2': 'Active', '3': 'Paused', '4': 'Removed',
}

// Google Ads has no real "no end date" state on the wire — the web UI's
// "None" radio button is implemented by writing this far-future sentinel
// date under the hood (confirmed live: setting end_date_time actually
// requires a real date, and the API rejects clearing the field back to
// empty/null — it's silently dropped from the update, not cleared).
const NO_END_DATE = '2037-12-30'
function dateOnlyOrNone(rawDateTime) {
  const d = String(rawDateTime || '').slice(0, 10)
  return (!d || d >= NO_END_DATE) ? null : d
}

// Pulls every `resource_name` out of a mutateResources() response regardless
// of which `*_result` key it landed under (campaign_result, ad_group_result,
// etc.) — the response shape varies per operation entity type.
function extractResourceNames(mutateResult) {
  return (mutateResult?.mutate_operation_responses || [])
    .map(r => {
      const key = Object.keys(r || {}).find(k => k.endsWith('_result'))
      return key ? r[key]?.resource_name : null
    })
    .filter(Boolean)
}

// Resolves the REAL resource name assigned by Google Ads for the operation at
// a given index — mutate_operation_responses is positionally aligned with the
// operations array that was submitted. The `campaignRN`/`budgetRN`/etc. temp
// resource names (e.g. "customers/123/campaigns/-2") are only valid for
// cross-referencing WITHIN the same atomic mutate call; anything returned to
// the caller (for the changelog, rollback, or a deep-link) must use the real
// post-creation resource name instead, or every later lookup 404s.
function resultResourceName(mutateResult, opIndex, fallback) {
  const r = mutateResult?.mutate_operation_responses?.[opIndex]
  if (!r) return fallback
  const key = Object.keys(r).find(k => k.endsWith('_result'))
  return (key && r[key]?.resource_name) || fallback
}

// campaign_criterion.type comes back from customer.query() as a raw numeric
// value (e.g. "20" for LANGUAGE), not the symbolic name — confirmed live
// against the API. enumStr() alone just stringifies that number, so any
// `enumStr(type) === 'LOCATION'`-style check silently never matches. Compare
// against both the numeric CriterionType enum value AND the symbolic name so
// it's correct regardless of which form a given query shape returns.
const CRITERION_TYPE_NUM = { DEVICE: 6, LOCATION: 7, AD_SCHEDULE: 9, LANGUAGE: 20 }
function isCriterionType(raw, name) {
  const s = enumStr(raw)
  return s === name || s === String(CRITERION_TYPE_NUM[name])
}

// Same story for campaign_criterion.device.type — comes back as a raw
// number ("2") rather than "MOBILE". Resolve to the symbolic name once at
// extraction time so downstream code (diffing against the UI's MOBILE/
// DESKTOP/TABLET strings) can compare directly.
const DEVICE_TYPE_NUM = { MOBILE: 2, TABLET: 3, DESKTOP: 4, CONNECTED_TV: 6 }
function deviceTypeName(raw) {
  const s = enumStr(raw)
  const hit = Object.entries(DEVICE_TYPE_NUM).find(([name, num]) => s === name || s === String(num))
  return hit ? hit[0] : s
}

// Same story for campaign_criterion.ad_schedule.day_of_week ("2" vs "MONDAY").
const DAY_OF_WEEK_NUM = { MONDAY: 2, TUESDAY: 3, WEDNESDAY: 4, THURSDAY: 5, FRIDAY: 6, SATURDAY: 7, SUNDAY: 8 }
function dayOfWeekName(raw) {
  const s = enumStr(raw)
  const hit = Object.entries(DAY_OF_WEEK_NUM).find(([name, num]) => s === name || s === String(num))
  return hit ? hit[0] : s
}

// campaign.bidding_strategy_type has the exact same raw-numeric-vs-symbolic
// gotcha (confirmed live: a MAXIMIZE_CONVERSIONS campaign came back as "10")
// — the UI's BiddingStrategyPicker matches against symbolic values like
// 'TARGET_CPA', so an unresolved number silently fails to match any option
// and always displays/defaults to the first one (Manual CPC), and can even
// cause the Save button to submit the wrong strategy. Reverse-map using the
// library's own enum object rather than hand-maintaining another number list.
const BIDDING_STRATEGY_TYPE_NUM = Object.fromEntries(Object.entries(enums.BiddingStrategyType).map(([name, num]) => [String(num), name]))
function biddingStrategyTypeName(raw) {
  const s = enumStr(raw)
  return BIDDING_STRATEGY_TYPE_NUM[s] || s
}

function matchTypeEnum(mt) {
  const s = String(mt || '').toLowerCase().trim()
  if (s.includes('exact'))  return enums.KeywordMatchType.EXACT
  if (s.includes('phrase')) return enums.KeywordMatchType.PHRASE
  return enums.KeywordMatchType.BROAD
}

// ad_group_criterion.keyword.match_type comes back as a raw number (confirmed
// live: EXACT=2, PHRASE=3, BROAD=4) — same reverse-enum-lookup story as
// biddingStrategyTypeName above.
const KEYWORD_MATCH_TYPE_NUM = Object.fromEntries(Object.entries(enums.KeywordMatchType).map(([name, num]) => [String(num), name]))
function matchTypeName(raw) {
  const s = enumStr(raw)
  return KEYWORD_MATCH_TYPE_NUM[s] || s
}

// Maps a UI bidding-strategy key to the Campaign resource's bidding_scheme
// oneof field. Setting one of these on create/update implicitly clears any
// other bidding oneof field already on the campaign (standard protobuf oneof
// behavior) — no need to explicitly unset the previous strategy.
//
// MAXIMIZE_CONVERSIONS/MAXIMIZE_CONVERSION_VALUE deliberately set
// cpc_bid_floor_micros: 0 rather than passing an empty {} — confirmed live
// that {} is a real bug in this npm package's client-side update_mask
// deriver (google-ads-api/build/src/utils.js recursiveFieldMaskSearch):
// an object-valued field with zero own keys never gets pushed onto the
// mask's path list at all, not even its own key, so the mutate silently
// no-ops (no error, no server-side change — the campaign's bidding
// strategy on Google Ads simply never updates). A bid floor of 0 imposes
// no real constraint and is a no-op for the account, but its presence
// forces the mask to include the parent path so the strategy switch
// actually takes effect. Do NOT use cpc_bid_ceiling_micros for this — 0
// there means "never bid more than $0," which would break the campaign.
function biddingSchemeField(strategy, targetValue) {
  switch (String(strategy || '').toUpperCase()) {
    case 'MAXIMIZE_CONVERSIONS':       return { maximize_conversions: { cpc_bid_floor_micros: 0 } }
    case 'MAXIMIZE_CONVERSION_VALUE':  return { maximize_conversion_value: { cpc_bid_floor_micros: 0 } }
    case 'TARGET_CPA':                 return { target_cpa: { target_cpa_micros: toMicros(Number(targetValue) || 0) } }
    case 'TARGET_ROAS':                return { target_roas: { target_roas: Number(targetValue) || 0 } }
    case 'MANUAL_CPC':
    default:                           return { manual_cpc: { enhanced_cpc_enabled: false } }
  }
}

// ── Campaign list (Manage tab) ────────────────────────────────────────────────

async function listCampaigns({ api, credentials }, customerId, mccCustomerId, { hidePaused } = {}) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  let rows
  try {
    rows = await customer.query(`
      SELECT campaign.id, campaign.name, campaign.status,
        campaign.advertising_channel_type, campaign.advertising_channel_sub_type,
        campaign.bidding_strategy_type,
        campaign_budget.id, campaign_budget.amount_micros, campaign_budget.delivery_method
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ${hidePaused ? "AND campaign.status = 'ENABLED'" : ''}
      ORDER BY campaign.name
    `)
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }

  return rows.map(r => ({
    id:                String(r.campaign?.id ?? ''),
    name:              r.campaign?.name ?? '',
    status:            STATUS_MAP[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status),
    channelType:       enumStr(r.campaign?.advertising_channel_type),
    channelSubType:    enumStr(r.campaign?.advertising_channel_sub_type),
    biddingStrategy:   biddingStrategyTypeName(r.campaign?.bidding_strategy_type),
    budgetId:          String(r.campaign_budget?.id ?? ''),
    budgetMicros:      n(r.campaign_budget?.amount_micros ?? 0),
    budgetDelivery:    enumStr(r.campaign_budget?.delivery_method),
  }))
}

// ── Single campaign detail (edit panel) ───────────────────────────────────────

async function getCampaign({ api, credentials }, customerId, mccCustomerId, campaignId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  let rows, criteriaRows
  try {
    rows = await customer.query(`
      SELECT campaign.id, campaign.name, campaign.status,
        campaign.advertising_channel_type, campaign.advertising_channel_sub_type,
        campaign.bidding_strategy_type,
        campaign.start_date_time, campaign.end_date_time,
        campaign.network_settings.target_google_search, campaign.network_settings.target_search_network,
        campaign.network_settings.target_content_network, campaign.network_settings.target_partner_search_network,
        campaign_budget.id, campaign_budget.amount_micros, campaign_budget.delivery_method,
        metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
        metrics.ctr, metrics.average_cpc, metrics.conversions_from_interactions_rate
      FROM campaign
      WHERE campaign.id = ${campaignId}
        AND segments.date DURING LAST_30_DAYS
      LIMIT 1
    `)
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
  let r = rows[0]
  // No rows if the campaign had zero activity in the last 30 days (metrics
  // query returns nothing) — fall back to a metrics-free lookup so the panel
  // still loads for a brand-new or fully dormant campaign.
  if (!r) {
    try {
      const fallback = await customer.query(`
        SELECT campaign.id, campaign.name, campaign.status,
          campaign.advertising_channel_type, campaign.advertising_channel_sub_type,
          campaign.bidding_strategy_type,
          campaign.start_date_time, campaign.end_date_time,
          campaign.network_settings.target_google_search, campaign.network_settings.target_search_network,
          campaign.network_settings.target_content_network, campaign.network_settings.target_partner_search_network,
          campaign_budget.id, campaign_budget.amount_micros, campaign_budget.delivery_method
        FROM campaign
        WHERE campaign.id = ${campaignId}
        LIMIT 1
      `)
      r = fallback[0]
    } catch (e) {
      throw new Error(parseGoogleAdsError(e))
    }
  }
  if (!r) throw new Error('Campaign not found.')

  try {
    criteriaRows = await customer.query(`
      SELECT campaign_criterion.type, campaign_criterion.negative, campaign_criterion.bid_modifier,
        campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant,
        campaign_criterion.device.type,
        campaign_criterion.ad_schedule.day_of_week, campaign_criterion.ad_schedule.start_hour, campaign_criterion.ad_schedule.end_hour
      FROM campaign_criterion
      WHERE campaign_criterion.campaign = 'customers/${customerId}/campaigns/${campaignId}'
        AND campaign_criterion.status = 'ENABLED'
    `)
  } catch {
    criteriaRows = [] // non-critical — targeting criteria are supplementary detail
  }

  // geo_target_constant can't be joined directly from campaign_criterion
  // (GAQL rejects the cross-resource select), so resolve display names with a
  // separate lookup by id. language_constant CAN be joined but we already
  // fetched raw ids above, so resolve both the same way for consistency.
  const geoIds  = [...new Set(criteriaRows.map(c => c.campaign_criterion?.location?.geo_target_constant).filter(Boolean).map(rn => String(rn).split('/').pop()))]
  const langIds = [...new Set(criteriaRows.map(c => c.campaign_criterion?.language?.language_constant).filter(Boolean).map(rn => String(rn).split('/').pop()))]
  const geoNames = {}, langNames = {}
  if (geoIds.length > 0) {
    try {
      const geoRows = await customer.query(`SELECT geo_target_constant.id, geo_target_constant.canonical_name FROM geo_target_constant WHERE geo_target_constant.id IN (${geoIds.join(',')})`)
      geoRows.forEach(g => { geoNames[String(g.geo_target_constant?.id)] = g.geo_target_constant?.canonical_name })
    } catch { /* best effort — chips fall back to raw id */ }
  }
  if (langIds.length > 0) {
    try {
      const langRows = await customer.query(`SELECT language_constant.id, language_constant.name FROM language_constant WHERE language_constant.id IN (${langIds.join(',')})`)
      langRows.forEach(l => { langNames[String(l.language_constant?.id)] = l.language_constant?.name })
    } catch { /* best effort — chips fall back to raw id */ }
  }

  return {
    id:              String(r.campaign?.id ?? ''),
    name:            r.campaign?.name ?? '',
    status:          STATUS_MAP[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status),
    channelType:     enumStr(r.campaign?.advertising_channel_type),
    channelSubType:  enumStr(r.campaign?.advertising_channel_sub_type),
    biddingStrategy: biddingStrategyTypeName(r.campaign?.bidding_strategy_type),
    startDate:       String(r.campaign?.start_date_time || '').slice(0, 10) || null,
    endDate:         dateOnlyOrNone(r.campaign?.end_date_time),
    networkSettings: {
      targetGoogleSearch:      !!r.campaign?.network_settings?.target_google_search,
      targetSearchNetwork:     !!r.campaign?.network_settings?.target_search_network,
      targetContentNetwork:    !!r.campaign?.network_settings?.target_content_network,
      targetPartnerSearchNetwork: !!r.campaign?.network_settings?.target_partner_search_network,
    },
    budgetId:        String(r.campaign_budget?.id ?? ''),
    budgetMicros:    n(r.campaign_budget?.amount_micros ?? 0),
    budgetDelivery:  enumStr(r.campaign_budget?.delivery_method),
    performance: {
      dateRange:        'LAST_30_DAYS',
      impressions:      n(r.metrics?.impressions ?? 0),
      clicks:           n(r.metrics?.clicks ?? 0),
      costMicros:       n(r.metrics?.cost_micros ?? 0),
      conversions:      n(r.metrics?.conversions ?? 0),
      ctr:              n(r.metrics?.ctr ?? 0),
      avgCpcMicros:     n(r.metrics?.average_cpc ?? 0),
      conversionRate:   n(r.metrics?.conversions_from_interactions_rate ?? 0),
    },
    criteria: criteriaRows.map(c => {
      const geoId  = String(c.campaign_criterion?.location?.geo_target_constant || '').split('/').pop()
      const langId = String(c.campaign_criterion?.language?.language_constant || '').split('/').pop()
      return {
        type:     enumStr(c.campaign_criterion?.type),
        negative: !!c.campaign_criterion?.negative,
        geoTargetConstant: c.campaign_criterion?.location?.geo_target_constant ?? null,
        geoTargetName:     geoNames[geoId] || null,
        languageConstant:  c.campaign_criterion?.language?.language_constant ?? null,
        languageName:      langNames[langId] || null,
        deviceType:        enumStr(c.campaign_criterion?.device?.type),
      }
    }),
    devices: criteriaRows
      .filter(c => isCriterionType(c.campaign_criterion?.type, 'DEVICE'))
      .map(c => ({ type: deviceTypeName(c.campaign_criterion?.device?.type), bidModifier: n(c.campaign_criterion?.bid_modifier ?? 1) })),
    adSchedules: criteriaRows
      .filter(c => isCriterionType(c.campaign_criterion?.type, 'AD_SCHEDULE'))
      .map(c => ({
        dayOfWeek: dayOfWeekName(c.campaign_criterion?.ad_schedule?.day_of_week),
        startHour: n(c.campaign_criterion?.ad_schedule?.start_hour),
        endHour:   n(c.campaign_criterion?.ad_schedule?.end_hour),
      })),
  }
}

// ── Image fetching (Display ad creative) ──────────────────────────────────────

function fetchImageBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith('http://') ? http : https
    lib.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume()
        return resolve(fetchImageBuffer(res.headers.location, redirectsLeft - 1))
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Could not fetch image (HTTP ${res.statusCode}): ${url}`)) }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', e => reject(new Error(`Could not fetch image: ${url} (${e.message})`)))
  })
}

function mimeTypeFromUrl(url) {
  const ext = String(url).split('?')[0].split('.').pop().toLowerCase()
  if (ext === 'png') return enums.MimeType.IMAGE_PNG
  if (ext === 'gif') return enums.MimeType.IMAGE_GIF
  return enums.MimeType.IMAGE_JPEG
}

// ── Location / language targeting lookups (Create wizard + Targeting panel) ──

async function searchGeoTargets({ api, credentials }, customerId, mccCustomerId, queryText) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const text = String(queryText || '').trim()
  if (text.length < 2) return []
  try {
    const res = await customer.geoTargetConstants.suggestGeoTargetConstants({
      locale: 'en',
      location_names: { names: [text] },
    })
    return (res.geo_target_constant_suggestions || []).slice(0, 15).map(s => ({
      id:            String(s.geo_target_constant?.id ?? ''),
      name:          s.geo_target_constant?.name ?? '',
      canonicalName: s.geo_target_constant?.canonical_name ?? s.geo_target_constant?.name ?? '',
      targetType:    s.geo_target_constant?.target_type ?? '',
      countryCode:   s.geo_target_constant?.country_code ?? '',
    }))
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

let _languageCache = null
async function listLanguages({ api, credentials }, customerId, mccCustomerId) {
  if (_languageCache) return _languageCache
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  try {
    const rows = await customer.query(`
      SELECT language_constant.id, language_constant.name, language_constant.code
      FROM language_constant
      WHERE language_constant.targetable = true
      ORDER BY language_constant.name
    `)
    _languageCache = rows.map(r => ({
      id:   String(r.language_constant?.id ?? ''),
      name: r.language_constant?.name ?? '',
      code: r.language_constant?.code ?? '',
    }))
    return _languageCache
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Create Search campaign (budget + campaign + ad groups + keywords, atomic) ──

/**
 * args: {
 *   name, dailyBudget (dollars), biddingStrategy, targetValue,
 *   startPaused, searchPartners,
 *   locations: [{ id, name }], languages: [{ id, name }],
 *   adGroups: [{ name, keywords: [{ text, matchType }] }],
 *   validateOnly,
 * }
 */
async function createSearchCampaign({ api, credentials }, customerId, mccCustomerId, args) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const {
    name, dailyBudget, biddingStrategy, targetValue,
    startPaused = true, searchPartners = true,
    locations = [], languages = [], adGroups = [],
    containsEuPoliticalAdvertising = false, // required EU transparency-regulation declaration on every new campaign
    validateOnly = false,
  } = args || {}

  if (!name)                                    throw new Error('Campaign name is required.')
  if (!(Number(dailyBudget) > 0))                throw new Error('Daily budget must be greater than $0.')
  if (!adGroups.some(ag => (ag.keywords || []).length > 0))
    throw new Error('At least one ad group with at least one keyword is required.')

  // Manual CPC has no automated bidding to fall back on — an ad group created
  // without cpc_bid_micros set effectively bids at Google Ads' $0.01 floor,
  // which silently tanks delivery. Require a default bid per ad group up
  // front rather than letting that ship unnoticed.
  const isManualCpc = String(biddingStrategy || '').toUpperCase() === 'MANUAL_CPC'
  if (isManualCpc) {
    const missing = adGroups.filter(ag => (ag.keywords || []).length > 0 && !(Number(ag.defaultMaxCpc) > 0))
    if (missing.length > 0) {
      throw new Error(`Default Max CPC is required for every ad group when using Manual CPC bidding (missing on: ${missing.map(ag => ag.name || 'unnamed ad group').join(', ')}).`)
    }
  }

  const budgetRN   = ResourceNames.campaignBudget(customerId, '-1')
  const campaignRN = ResourceNames.campaign(customerId, '-2')

  const operations = [
    {
      entity: 'campaign_budget', operation: 'create',
      resource: {
        resource_name:     budgetRN,
        name:              `${name} Budget`,
        delivery_method:   enums.BudgetDeliveryMethod.STANDARD,
        amount_micros:     toMicros(Number(dailyBudget)),
        explicitly_shared: false, // dedicated to this campaign — Phase 1 doesn't support portfolio/shared budgets
      },
    },
    {
      entity: 'campaign', operation: 'create',
      resource: {
        resource_name: campaignRN,
        name,
        advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
        status: startPaused ? enums.CampaignStatus.PAUSED : enums.CampaignStatus.ENABLED,
        campaign_budget: budgetRN,
        network_settings: {
          target_google_search:         true,
          target_search_network:        !!searchPartners,
          target_content_network:       false,
          target_partner_search_network: false,
        },
        contains_eu_political_advertising: containsEuPoliticalAdvertising
          ? enums.EuPoliticalAdvertisingStatus.CONTAINS_EU_POLITICAL_ADVERTISING
          : enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
        ...biddingSchemeField(biddingStrategy, targetValue),
      },
    },
  ]

  const budgetOpIdx = 0, campaignOpIdx = 1
  let tempId = -3
  const adGroupEntries = [] // { tempRN, name, opIdx } — resolved to real resource names after the mutate succeeds
  for (const ag of adGroups) {
    const kws = (ag.keywords || []).filter(k => String(k.text || '').trim())
    if (kws.length === 0) continue
    const adGroupRN = ResourceNames.adGroup(customerId, String(tempId))
    tempId -= 1
    adGroupEntries.push({ tempRN: adGroupRN, name: ag.name, opIdx: operations.length })
    operations.push({
      entity: 'ad_group', operation: 'create',
      resource: {
        resource_name: adGroupRN,
        name:     ag.name || 'Ad Group 1',
        campaign: campaignRN,
        status:   enums.AdGroupStatus.ENABLED,
        type:     enums.AdGroupType.SEARCH_STANDARD,
        // Only Manual CPC reads this field — other bidding strategies compute
        // their own bids, and setting it there is a meaningless no-op at best.
        ...(isManualCpc ? { cpc_bid_micros: toMicros(Number(ag.defaultMaxCpc)) } : {}),
      },
    })
    for (const kw of kws) {
      const kwMaxCpc = Number(kw.maxCpc)
      operations.push({
        entity: 'ad_group_criterion', operation: 'create',
        resource: {
          ad_group: adGroupRN,
          status:   enums.AdGroupCriterionStatus.ENABLED,
          keyword:  { text: String(kw.text).trim(), match_type: matchTypeEnum(kw.matchType) },
          // Optional per-keyword override of the ad group's default bid —
          // only meaningful under Manual CPC, same as above.
          ...(isManualCpc && kwMaxCpc > 0 ? { cpc_bid_micros: toMicros(kwMaxCpc) } : {}),
        },
      })
    }
  }

  for (const loc of locations) {
    operations.push({
      entity: 'campaign_criterion', operation: 'create',
      resource: { campaign: campaignRN, location: { geo_target_constant: ResourceNames.geoTargetConstant(loc.id) } },
    })
  }
  for (const lang of languages) {
    operations.push({
      entity: 'campaign_criterion', operation: 'create',
      resource: { campaign: campaignRN, language: { language_constant: ResourceNames.languageConstant(lang.id) } },
    })
  }

  try {
    const result = await customer.mutateResources(operations, validateOnly ? { validate_only: true } : undefined)
    if (validateOnly) return { success: true, validateOnly: true }
    return {
      success: true,
      budgetResourceName:   resultResourceName(result, budgetOpIdx, budgetRN),
      campaignResourceName: resultResourceName(result, campaignOpIdx, campaignRN),
      adGroups: adGroupEntries.map(e => ({ resourceName: resultResourceName(result, e.opIdx, e.tempRN), name: e.name })),
      createdResourceNames: extractResourceNames(result),
    }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Create Display campaign (budget + campaign + ad group + responsive display ad, atomic) ──

/**
 * args: {
 *   name, dailyBudget, biddingStrategy, targetValue, startPaused,
 *   locations, languages,
 *   adGroupName, finalUrl, businessName,
 *   headlines: [string], longHeadline, descriptions: [string],
 *   marketingImageUrls: [string], squareMarketingImageUrls: [string], logoImageUrls: [string],
 *   containsEuPoliticalAdvertising, validateOnly,
 * }
 */
async function createDisplayCampaign({ api, credentials }, customerId, mccCustomerId, args) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const {
    name, dailyBudget, biddingStrategy, targetValue,
    startPaused = true, locations = [], languages = [],
    adGroupName, finalUrl, businessName,
    headlines = [], longHeadline, descriptions = [],
    marketingImageUrls = [], squareMarketingImageUrls = [], logoImageUrls = [],
    containsEuPoliticalAdvertising = false, validateOnly = false,
  } = args || {}

  if (!name)                        throw new Error('Campaign name is required.')
  if (!(Number(dailyBudget) > 0))   throw new Error('Daily budget must be greater than $0.')
  if (!finalUrl)                    throw new Error('Final URL is required.')
  if (headlines.filter(Boolean).length === 0)    throw new Error('At least one headline is required.')
  if (descriptions.filter(Boolean).length === 0) throw new Error('At least one description is required.')
  if (marketingImageUrls.filter(Boolean).length === 0)       throw new Error('At least one marketing image is required.')
  if (squareMarketingImageUrls.filter(Boolean).length === 0) throw new Error('At least one square marketing image is required.')

  // Fetch + upload every image as its own Asset first — mutateResources can't
  // reference a resource created outside the same atomic call, and asset
  // uploads (binary bytes) are cleaner as their own preceding step than
  // shoehorned into the same operations array as everything else.
  let tempId = -100
  const imageOps = []
  const imageRNs = { marketing: [], square: [], logo: [] }
  async function addImages(urls, bucket) {
    for (const url of urls.filter(Boolean)) {
      const buf = await fetchImageBuffer(url)
      const rn = ResourceNames.asset(customerId, String(tempId)); tempId -= 1
      imageOps.push({
        entity: 'asset', operation: 'create',
        resource: { resource_name: rn, name: `${name} - ${bucket} image`, type: enums.AssetType.IMAGE, image_asset: { data: buf, mime_type: mimeTypeFromUrl(url) } },
      })
      imageRNs[bucket].push(rn)
    }
  }
  await addImages(marketingImageUrls, 'marketing')
  await addImages(squareMarketingImageUrls, 'square')
  await addImages(logoImageUrls, 'logo')

  const budgetRN   = ResourceNames.campaignBudget(customerId, '-1')
  const campaignRN = ResourceNames.campaign(customerId, '-2')
  const adGroupRN  = ResourceNames.adGroup(customerId, '-3')

  const budgetOpIdx = imageOps.length, campaignOpIdx = imageOps.length + 1, adGroupOpIdx = imageOps.length + 2
  const operations = [
    ...imageOps,
    {
      entity: 'campaign_budget', operation: 'create',
      resource: { resource_name: budgetRN, name: `${name} Budget`, delivery_method: enums.BudgetDeliveryMethod.STANDARD, amount_micros: toMicros(Number(dailyBudget)), explicitly_shared: false },
    },
    {
      entity: 'campaign', operation: 'create',
      resource: {
        resource_name: campaignRN, name,
        advertising_channel_type: enums.AdvertisingChannelType.DISPLAY,
        status: startPaused ? enums.CampaignStatus.PAUSED : enums.CampaignStatus.ENABLED,
        campaign_budget: budgetRN,
        network_settings: { target_google_search: false, target_search_network: false, target_content_network: true, target_partner_search_network: false },
        contains_eu_political_advertising: containsEuPoliticalAdvertising
          ? enums.EuPoliticalAdvertisingStatus.CONTAINS_EU_POLITICAL_ADVERTISING
          : enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
        ...biddingSchemeField(biddingStrategy, targetValue),
      },
    },
    {
      entity: 'ad_group', operation: 'create',
      resource: { resource_name: adGroupRN, name: adGroupName || 'Display Ad Group', campaign: campaignRN, status: enums.AdGroupStatus.ENABLED, type: enums.AdGroupType.DISPLAY_STANDARD },
    },
    {
      entity: 'ad_group_ad', operation: 'create',
      resource: {
        ad_group: adGroupRN,
        status: enums.AdGroupAdStatus.ENABLED, // campaign-level startPaused is the safety control, matching the Search wizard's convention
        ad: {
          final_urls: [finalUrl],
          responsive_display_ad: {
            marketing_images:        imageRNs.marketing.map(rn => ({ asset: rn })),
            square_marketing_images: imageRNs.square.map(rn => ({ asset: rn })),
            logo_images:              imageRNs.logo.map(rn => ({ asset: rn })),
            headlines:    headlines.filter(Boolean).slice(0, 5).map(text => ({ text })),
            descriptions: descriptions.filter(Boolean).slice(0, 5).map(text => ({ text })),
            long_headline: longHeadline ? { text: longHeadline } : undefined,
            business_name: businessName || name,
          },
        },
      },
    },
  ]

  for (const loc of locations) operations.push({ entity: 'campaign_criterion', operation: 'create', resource: { campaign: campaignRN, location: { geo_target_constant: ResourceNames.geoTargetConstant(loc.id) } } })
  for (const lang of languages) operations.push({ entity: 'campaign_criterion', operation: 'create', resource: { campaign: campaignRN, language: { language_constant: ResourceNames.languageConstant(lang.id) } } })

  try {
    const result = await customer.mutateResources(operations, validateOnly ? { validate_only: true } : undefined)
    if (validateOnly) return { success: true, validateOnly: true }
    return {
      success: true,
      budgetResourceName:   resultResourceName(result, budgetOpIdx, budgetRN),
      campaignResourceName: resultResourceName(result, campaignOpIdx, campaignRN),
      adGroupResourceName:  resultResourceName(result, adGroupOpIdx, adGroupRN),
      createdResourceNames: extractResourceNames(result),
    }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Create Performance Max campaign (budget + campaign + single asset group, atomic) ──

/**
 * args: {
 *   name, dailyBudget, biddingStrategy ('MAXIMIZE_CONVERSIONS'|'MAXIMIZE_CONVERSION_VALUE'|'TARGET_CPA'|'TARGET_ROAS'), targetValue,
 *   startPaused, locations, languages,
 *   finalUrl, businessName,
 *   headlines: [string] (3+), longHeadline, descriptions: [string] (2+),
 *   marketingImageUrls: [string], squareMarketingImageUrls: [string], logoImageUrls: [string],
 *   containsEuPoliticalAdvertising, validateOnly,
 * }
 * Ships a single default asset group (multi-asset-group support deferred).
 * No listing_group_filter / Shopping feed signal — that's Shopping-linked
 * PMax territory, out of scope here (plain lead-gen PMax only).
 */
async function createPerformanceMaxCampaign({ api, credentials }, customerId, mccCustomerId, args) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const {
    name, dailyBudget, biddingStrategy, targetValue,
    startPaused = true, locations = [], languages = [],
    finalUrl, businessName,
    headlines = [], longHeadline, descriptions = [],
    marketingImageUrls = [], squareMarketingImageUrls = [], logoImageUrls = [],
    containsEuPoliticalAdvertising = false, validateOnly = false,
  } = args || {}

  if (!name)                      throw new Error('Campaign name is required.')
  if (!(Number(dailyBudget) > 0)) throw new Error('Daily budget must be greater than $0.')
  if (!finalUrl)                  throw new Error('Final URL is required.')
  if (headlines.filter(Boolean).length < 3)    throw new Error('At least 3 headlines are required for Performance Max.')
  if (descriptions.filter(Boolean).length < 2) throw new Error('At least 2 descriptions are required for Performance Max.')
  if (marketingImageUrls.filter(Boolean).length === 0)       throw new Error('At least one marketing image is required.')
  if (squareMarketingImageUrls.filter(Boolean).length === 0) throw new Error('At least one square marketing image is required.')
  if (logoImageUrls.filter(Boolean).length === 0)             throw new Error('At least one logo image is required.')

  let tempId = -100
  const assetOps = []
  const textRNs = { headline: [], longHeadline: [], description: [], businessName: [] }
  const imageRNs = { marketing: [], square: [], logo: [] }

  function addTextAsset(text, bucket) {
    const rn = ResourceNames.asset(customerId, String(tempId)); tempId -= 1
    assetOps.push({ entity: 'asset', operation: 'create', resource: { resource_name: rn, name: `${name} - ${bucket}`, type: enums.AssetType.TEXT, text_asset: { text } } })
    textRNs[bucket].push(rn)
  }
  headlines.filter(Boolean).slice(0, 15).forEach(h => addTextAsset(h, 'headline'))
  descriptions.filter(Boolean).slice(0, 5).forEach(d => addTextAsset(d, 'description'))
  if (longHeadline) addTextAsset(longHeadline, 'longHeadline')
  addTextAsset(businessName || name, 'businessName')

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

  const budgetRN    = ResourceNames.campaignBudget(customerId, '-1')
  const campaignRN  = ResourceNames.campaign(customerId, '-2')
  const assetGroupRN = ResourceNames.assetGroup(customerId, '-3')

  const budgetOpIdx = assetOps.length, campaignOpIdx = assetOps.length + 1, assetGroupOpIdx = assetOps.length + 2
  const operations = [
    ...assetOps,
    {
      entity: 'campaign_budget', operation: 'create',
      resource: { resource_name: budgetRN, name: `${name} Budget`, delivery_method: enums.BudgetDeliveryMethod.STANDARD, amount_micros: toMicros(Number(dailyBudget)), explicitly_shared: false },
    },
    {
      entity: 'campaign', operation: 'create',
      resource: {
        resource_name: campaignRN, name,
        advertising_channel_type: enums.AdvertisingChannelType.PERFORMANCE_MAX,
        status: startPaused ? enums.CampaignStatus.PAUSED : enums.CampaignStatus.ENABLED,
        campaign_budget: budgetRN,
        contains_eu_political_advertising: containsEuPoliticalAdvertising
          ? enums.EuPoliticalAdvertisingStatus.CONTAINS_EU_POLITICAL_ADVERTISING
          : enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
        ...biddingSchemeField(biddingStrategy, targetValue),
      },
    },
    {
      entity: 'asset_group', operation: 'create',
      resource: { resource_name: assetGroupRN, campaign: campaignRN, name: `${name} - Asset Group`, final_urls: [finalUrl], status: enums.AssetGroupStatus.ENABLED },
    },
    ...textRNs.headline.map(rn      => ({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType.HEADLINE } })),
    ...textRNs.description.map(rn   => ({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType.DESCRIPTION } })),
    ...textRNs.longHeadline.map(rn  => ({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType.LONG_HEADLINE } })),
    ...imageRNs.marketing.map(rn    => ({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType.MARKETING_IMAGE } })),
    ...imageRNs.square.map(rn       => ({ entity: 'asset_group_asset', operation: 'create', resource: { asset_group: assetGroupRN, asset: rn, field_type: enums.AssetFieldType.SQUARE_MARKETING_IMAGE } })),
    // Business name + logo are linked at the CAMPAIGN level only (not the
    // asset group) — this account has PMax "Brand Guidelines" enabled, which
    // rejects BUSINESS_NAME/LOGO at the asset-group level as a conflict with
    // the campaign-level link (confirmed via live testing:
    // BRAND_ASSETS_NOT_LINKED_AT_CAMPAIGN_LEVEL). Campaign-level linking is
    // the modern required form either way.
    ...textRNs.businessName.map(rn  => ({ entity: 'campaign_asset', operation: 'create', resource: { campaign: campaignRN, asset: rn, field_type: enums.AssetFieldType.BUSINESS_NAME, status: enums.AssetLinkStatus.ENABLED } })),
    ...imageRNs.logo.map(rn         => ({ entity: 'campaign_asset', operation: 'create', resource: { campaign: campaignRN, asset: rn, field_type: enums.AssetFieldType.LOGO, status: enums.AssetLinkStatus.ENABLED } })),
  ]

  for (const loc of locations) operations.push({ entity: 'campaign_criterion', operation: 'create', resource: { campaign: campaignRN, location: { geo_target_constant: ResourceNames.geoTargetConstant(loc.id) } } })
  for (const lang of languages) operations.push({ entity: 'campaign_criterion', operation: 'create', resource: { campaign: campaignRN, language: { language_constant: ResourceNames.languageConstant(lang.id) } } })

  let result
  try {
    result = await customer.mutateResources(operations, validateOnly ? { validate_only: true } : undefined)
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
  if (validateOnly) return { success: true, validateOnly: true }

  const realCampaignRN   = resultResourceName(result, campaignOpIdx, campaignRN)
  const realBudgetRN     = resultResourceName(result, budgetOpIdx, budgetRN)
  const realAssetGroupRN = resultResourceName(result, assetGroupOpIdx, assetGroupRN)

  // Some accounts have PMax "Brand Guidelines" enabled, which requires a
  // dedicated follow-up RPC (not achievable inside the atomic create above —
  // it operates on the campaign's real resource_name, which doesn't exist
  // until after creation) to formally link the business name/logo already
  // attached to the asset group. Best-effort: if the account doesn't have
  // Brand Guidelines, or it's already on, this call errors harmlessly and we
  // don't fail campaign creation over it — the campaign still exists and
  // works, just without brand guidelines formally enabled.
  let brandGuidelinesWarning = null
  try {
    await customer.campaigns.enablePMaxBrandGuidelines({
      customer_id: String(customerId),
      operations: [{ campaign: realCampaignRN, auto_populate_brand_assets: true }],
    })
  } catch (e) {
    brandGuidelinesWarning = parseGoogleAdsError(e)
  }

  return {
    success: true, budgetResourceName: realBudgetRN, campaignResourceName: realCampaignRN, assetGroupResourceName: realAssetGroupRN,
    createdResourceNames: extractResourceNames(result), brandGuidelinesWarning,
  }
}

// ── Create Shopping campaign (budget + campaign + ad group + catch-all listing group, atomic) ──
// UNVERIFIED end-to-end: this app has no Merchant Center integration and no
// test Merchant Center account to validate against. Written to the documented
// API shape and structurally sound, but the merchant_id/feed_label
// combination can only be confirmed correct by trying it against a real,
// already-linked Merchant Center account. Treat the first real use as a test.

/**
 * args: {
 *   name, dailyBudget, biddingStrategy, targetValue, startPaused,
 *   merchantId, feedLabel (e.g. 'US'), campaignPriority (0-2), enableLocal,
 *   locations, languages, adGroupName,
 *   containsEuPoliticalAdvertising, validateOnly,
 * }
 * Ships one ad group with a single catch-all listing group (all products,
 * no product partitioning) — matches the simplest valid Shopping structure.
 */
async function createShoppingCampaign({ api, credentials }, customerId, mccCustomerId, args) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const {
    name, dailyBudget, biddingStrategy, targetValue, startPaused = true,
    merchantId, feedLabel, campaignPriority = 0, enableLocal = false,
    locations = [], languages = [], adGroupName,
    containsEuPoliticalAdvertising = false, validateOnly = false,
  } = args || {}

  if (!name)                      throw new Error('Campaign name is required.')
  if (!(Number(dailyBudget) > 0)) throw new Error('Daily budget must be greater than $0.')
  if (!merchantId)                throw new Error('A Merchant Center ID is required for Shopping campaigns (set one in Settings).')

  const budgetRN   = ResourceNames.campaignBudget(customerId, '-1')
  const campaignRN = ResourceNames.campaign(customerId, '-2')
  const adGroupRN  = ResourceNames.adGroup(customerId, '-3')
  const budgetOpIdx = 0, campaignOpIdx = 1, adGroupOpIdx = 2

  const operations = [
    {
      entity: 'campaign_budget', operation: 'create',
      resource: { resource_name: budgetRN, name: `${name} Budget`, delivery_method: enums.BudgetDeliveryMethod.STANDARD, amount_micros: toMicros(Number(dailyBudget)), explicitly_shared: false },
    },
    {
      entity: 'campaign', operation: 'create',
      resource: {
        resource_name: campaignRN, name,
        advertising_channel_type: enums.AdvertisingChannelType.SHOPPING,
        status: startPaused ? enums.CampaignStatus.PAUSED : enums.CampaignStatus.ENABLED,
        campaign_budget: budgetRN,
        shopping_setting: {
          merchant_id: Number(merchantId),
          feed_label: feedLabel || 'US',
          campaign_priority: Number(campaignPriority) || 0,
          enable_local: !!enableLocal,
        },
        contains_eu_political_advertising: containsEuPoliticalAdvertising
          ? enums.EuPoliticalAdvertisingStatus.CONTAINS_EU_POLITICAL_ADVERTISING
          : enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
        ...biddingSchemeField(biddingStrategy, targetValue),
      },
    },
    {
      entity: 'ad_group', operation: 'create',
      resource: { resource_name: adGroupRN, name: adGroupName || 'Shopping Ad Group', campaign: campaignRN, status: enums.AdGroupStatus.ENABLED, type: enums.AdGroupType.SHOPPING_PRODUCT_ADS },
    },
    {
      // Catch-all listing group — a single UNIT node with no case_value
      // means "all products in the feed," the simplest valid partition tree.
      entity: 'ad_group_criterion', operation: 'create',
      resource: { ad_group: adGroupRN, status: enums.AdGroupCriterionStatus.ENABLED, listing_group: { type: enums.ListingGroupType.UNIT } },
    },
  ]

  for (const loc of locations) operations.push({ entity: 'campaign_criterion', operation: 'create', resource: { campaign: campaignRN, location: { geo_target_constant: ResourceNames.geoTargetConstant(loc.id) } } })
  for (const lang of languages) operations.push({ entity: 'campaign_criterion', operation: 'create', resource: { campaign: campaignRN, language: { language_constant: ResourceNames.languageConstant(lang.id) } } })

  try {
    const result = await customer.mutateResources(operations, validateOnly ? { validate_only: true } : undefined)
    if (validateOnly) return { success: true, validateOnly: true }
    return {
      success: true,
      budgetResourceName:  resultResourceName(result, budgetOpIdx, budgetRN),
      campaignResourceName: resultResourceName(result, campaignOpIdx, campaignRN),
      adGroupResourceName: resultResourceName(result, adGroupOpIdx, adGroupRN),
      createdResourceNames: extractResourceNames(result),
    }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Create Video campaign (budget + campaign + ad group + YouTube video ad, atomic) ──

/**
 * args: {
 *   name, dailyBudget, targetCpv, startPaused,
 *   locations, languages,
 *   adGroupName, youtubeVideoId, finalUrl, actionHeadline, callToAction,
 *   containsEuPoliticalAdvertising, validateOnly,
 * }
 * Ships a single in-stream skippable video ad — the most common/simplest
 * Video campaign format. Video assets are referenced (existing YouTube video
 * ID), never uploaded — no video upload pipeline in this app. TrueView
 * in-stream ads carry no separate headline/description of their own (the
 * video itself is the ad) — only an optional CTA overlay (action_headline +
 * action_button_label).
 */
async function createVideoCampaign({ api, credentials }, customerId, mccCustomerId, args) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const {
    name, dailyBudget, targetCpv, startPaused = true,
    locations = [], languages = [], adGroupName,
    youtubeVideoId, finalUrl, actionHeadline, callToAction,
    containsEuPoliticalAdvertising = false, validateOnly = false,
  } = args || {}

  if (!name)                      throw new Error('Campaign name is required.')
  if (!(Number(dailyBudget) > 0)) throw new Error('Daily budget must be greater than $0.')
  if (!youtubeVideoId)            throw new Error('A YouTube video ID is required.')
  if (!finalUrl)                  throw new Error('Final URL is required.')

  const budgetRN     = ResourceNames.campaignBudget(customerId, '-1')
  const campaignRN   = ResourceNames.campaign(customerId, '-2')
  const adGroupRN    = ResourceNames.adGroup(customerId, '-3')
  const videoAssetRN = ResourceNames.asset(customerId, '-4')
  const videoAssetOpIdx = 0, budgetOpIdx = 1, campaignOpIdx = 2, adGroupOpIdx = 3

  const operations = [
    {
      // The YoutubeVideoAsset must exist as an Asset before an ad can
      // reference it — created first, referenced by temp resource name below.
      entity: 'asset', operation: 'create',
      resource: { resource_name: videoAssetRN, name: `${name} - YouTube Video`, type: enums.AssetType.YOUTUBE_VIDEO, youtube_video_asset: { youtube_video_id: youtubeVideoId } },
    },
    {
      entity: 'campaign_budget', operation: 'create',
      resource: { resource_name: budgetRN, name: `${name} Budget`, delivery_method: enums.BudgetDeliveryMethod.STANDARD, amount_micros: toMicros(Number(dailyBudget)), explicitly_shared: false },
    },
    {
      entity: 'campaign', operation: 'create',
      resource: {
        resource_name: campaignRN, name,
        advertising_channel_type: enums.AdvertisingChannelType.VIDEO,
        status: startPaused ? enums.CampaignStatus.PAUSED : enums.CampaignStatus.ENABLED,
        campaign_budget: budgetRN,
        network_settings: { target_youtube: true, target_google_search: false, target_search_network: false, target_content_network: false },
        target_cpv: {},
        contains_eu_political_advertising: containsEuPoliticalAdvertising
          ? enums.EuPoliticalAdvertisingStatus.CONTAINS_EU_POLITICAL_ADVERTISING
          : enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
      },
    },
    {
      entity: 'ad_group', operation: 'create',
      resource: {
        resource_name: adGroupRN, name: adGroupName || 'Video Ad Group', campaign: campaignRN,
        status: enums.AdGroupStatus.ENABLED, type: enums.AdGroupType.VIDEO_TRUE_VIEW_IN_STREAM,
        cpv_bid_micros: targetCpv ? toMicros(Number(targetCpv)) : undefined,
      },
    },
    {
      entity: 'ad_group_ad', operation: 'create',
      resource: {
        ad_group: adGroupRN, status: enums.AdGroupAdStatus.ENABLED,
        ad: {
          final_urls: [finalUrl],
          video_ad: {
            video: { asset: videoAssetRN },
            in_stream: {
              action_button_label: callToAction || 'Learn More',
              action_headline: actionHeadline || name,
            },
          },
        },
      },
    },
  ]

  for (const loc of locations) operations.push({ entity: 'campaign_criterion', operation: 'create', resource: { campaign: campaignRN, location: { geo_target_constant: ResourceNames.geoTargetConstant(loc.id) } } })
  for (const lang of languages) operations.push({ entity: 'campaign_criterion', operation: 'create', resource: { campaign: campaignRN, language: { language_constant: ResourceNames.languageConstant(lang.id) } } })

  try {
    const result = await customer.mutateResources(operations, validateOnly ? { validate_only: true } : undefined)
    if (validateOnly) return { success: true, validateOnly: true }
    return {
      success: true,
      budgetResourceName:   resultResourceName(result, budgetOpIdx, budgetRN),
      campaignResourceName: resultResourceName(result, campaignOpIdx, campaignRN),
      adGroupResourceName:  resultResourceName(result, adGroupOpIdx, adGroupRN),
      videoAssetResourceName: resultResourceName(result, videoAssetOpIdx, videoAssetRN),
      createdResourceNames: extractResourceNames(result),
    }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Manage tab: channel-agnostic updates for existing campaigns ───────────────

async function updateCampaignName({ api, credentials }, customerId, mccCustomerId, { campaignId, name, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('Campaign name is required.')
  try {
    await customer.campaigns.update([{
      resource_name: ResourceNames.campaign(customerId, campaignId),
      name: trimmed,
    }], validateOnly ? { validate_only: true } : undefined)
    return { success: true, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

async function updateCampaignStatus({ api, credentials }, customerId, mccCustomerId, { campaignId, status, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const resourceName = ResourceNames.campaign(customerId, campaignId)
  try {
    // REMOVED can't be set through a regular update — the API rejects it
    // outright ("Enum value 'REMOVED' cannot be used", confirmed live) —
    // removing a campaign is its own mutate operation type, same as the
    // existing removeRSAById() pattern in googleAdsClient.js.
    if (status === 'Removed') {
      await customer.campaigns.remove([resourceName], validateOnly ? { validate_only: true } : undefined)
      return { success: true, validateOnly: !!validateOnly }
    }
    const statusEnum = { Active: enums.CampaignStatus.ENABLED, Paused: enums.CampaignStatus.PAUSED }[status]
    if (!statusEnum) throw new Error(`Invalid status: ${status}`)
    await customer.campaigns.update([{
      resource_name: resourceName,
      status: statusEnum,
    }], validateOnly ? { validate_only: true } : undefined)
    return { success: true, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

async function updateCampaignBudget({ api, credentials }, customerId, mccCustomerId, { budgetId, dailyBudget, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  if (!(Number(dailyBudget) > 0)) throw new Error('Daily budget must be greater than $0.')
  try {
    await customer.campaignBudgets.update([{
      resource_name: ResourceNames.campaignBudget(customerId, budgetId),
      amount_micros: toMicros(Number(dailyBudget)),
    }], validateOnly ? { validate_only: true } : undefined)
    return { success: true, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

async function updateCampaignBidding({ api, credentials }, customerId, mccCustomerId, { campaignId, biddingStrategy, targetValue, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  try {
    await customer.campaigns.update([{
      resource_name: ResourceNames.campaign(customerId, campaignId),
      ...biddingSchemeField(biddingStrategy, targetValue),
    }], validateOnly ? { validate_only: true } : undefined)
    return { success: true, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// endDate: 'YYYY-MM-DD' string, or null/empty for "None" (writes the
// NO_END_DATE sentinel — see dateOnlyOrNone). Campaign start date is not
// editable here — Google Ads rejects changing it once a campaign has started
// (confirmed live: CANNOT_MODIFY_START_DATE_IF_ALREADY_STARTED), which is why
// the real Google Ads UI also shows start date as read-only/disabled.
async function updateCampaignEndDate({ api, credentials }, customerId, mccCustomerId, { campaignId, endDate, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateStr = String(endDate || '').trim() || NO_END_DATE
  try {
    await customer.campaigns.update([{
      resource_name: ResourceNames.campaign(customerId, campaignId),
      end_date_time: `${dateStr} 23:59:59`,
    }], validateOnly ? { validate_only: true } : undefined)
    return { success: true, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

const DEVICE_TYPE_ENUM = { MOBILE: 'MOBILE', DESKTOP: 'DESKTOP', TABLET: 'TABLET', CONNECTED_TV: 'CONNECTED_TV' }
const DAY_OF_WEEK_ENUM = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

/**
 * Sets campaign-level location/language/device/ad-schedule targeting to
 * exactly the given lists — diffs against current criteria (fetched fresh)
 * and issues create/update/remove ops for the delta in one mutateResources
 * call.
 *
 * devices: [{ type: 'MOBILE'|'DESKTOP'|'TABLET', bidModifier: number }] —
 *   bidModifier is a multiplier (1 = no adjustment, 1.2 = +20%, 0 = exclude
 *   the device entirely). Entries with bidModifier === 1 are treated as "no
 *   criterion needed" and removed if one exists.
 * adSchedules: [{ dayOfWeek: 'MONDAY'..'SUNDAY', startHour: 0-23, endHour: 1-24 }] —
 *   presence of ANY ad schedule criterion restricts the campaign to only
 *   those windows (Google Ads semantics — this isn't opt-in/opt-out, it's
 *   all-or-nothing once one exists), whole-hour granularity only.
 */
async function updateCampaignTargeting({ api, credentials }, customerId, mccCustomerId, { campaignId, locations = [], excludedLocations = [], languages = [], devices = [], adSchedules = [], validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const campaignRN = ResourceNames.campaign(customerId, campaignId)

  let current, channelType
  try {
    current = await customer.query(`
      SELECT campaign_criterion.criterion_id, campaign_criterion.type, campaign_criterion.bid_modifier,
        campaign_criterion.negative,
        campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant,
        campaign_criterion.device.type,
        campaign_criterion.ad_schedule.day_of_week, campaign_criterion.ad_schedule.start_hour, campaign_criterion.ad_schedule.end_hour,
        campaign.advertising_channel_type
      FROM campaign_criterion
      WHERE campaign_criterion.campaign = '${campaignRN}'
        AND campaign_criterion.status = 'ENABLED'
        AND campaign_criterion.type IN ('LOCATION', 'LANGUAGE', 'DEVICE', 'AD_SCHEDULE')
    `)
    channelType = enumStr(current[0]?.campaign?.advertising_channel_type)
    if (!channelType) {
      const [campRow] = await customer.query(`SELECT campaign.advertising_channel_type FROM campaign WHERE campaign.resource_name = '${campaignRN}'`)
      channelType = enumStr(campRow?.campaign?.advertising_channel_type)
    }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }

  // Performance Max campaigns don't support device bid-modifier or ad-schedule
  // criteria via campaign_criterion at all — Google Ads rejects any attempt
  // with OPERATION_NOT_PERMITTED_FOR_CAMPAIGN_TYPE ("not permitted on this
  // campaign type" / "not allowed for the given context", confirmed live).
  // Silently drop those two dimensions for PMax rather than let the whole
  // targeting update fail over a field PMax simply doesn't have.
  const isPMax = ['PERFORMANCE_MAX', '10'].includes(channelType)
  if (isPMax) { devices = []; adSchedules = [] }

  // Connected TV is only a real serving surface for Video and Display
  // campaigns — Search ads never appear on TV screens, so a CONNECTED_TV
  // campaign_criterion on any other channel type is rejected with
  // CONTEXT_ERROR / OPERATION_NOT_PERMITTED_FOR_CONTEXT (confirmed live
  // against a Search campaign). Drop it here too, mirroring the frontend's
  // deviceTypesForChannel filter, in case a stale payload ever reaches here.
  const supportsCTV = ['VIDEO', '6', 'DISPLAY', '3'].includes(channelType)
  if (!supportsCTV) devices = devices.filter(d => d.type !== 'CONNECTED_TV')

  // Excluded (negative) locations are a separate targeting mechanism from
  // included ones and are diffed completely independently below — mixing
  // them into one list previously caused an unrelated Save to silently
  // delete an exclusion (confirmed live). `locations` is always diffed
  // against non-negative criteria and `excludedLocations` against negative
  // ones, so the two can never cross-contaminate each other.
  const currentLocationIds = current
    .filter(r => isCriterionType(r.campaign_criterion?.type, 'LOCATION') && !r.campaign_criterion?.negative)
    .map(r => ({ criterionId: r.campaign_criterion?.criterion_id, geoId: String(r.campaign_criterion?.location?.geo_target_constant || '').split('/').pop() }))
  const currentExcludedLocationIds = current
    .filter(r => isCriterionType(r.campaign_criterion?.type, 'LOCATION') && r.campaign_criterion?.negative)
    .map(r => ({ criterionId: r.campaign_criterion?.criterion_id, geoId: String(r.campaign_criterion?.location?.geo_target_constant || '').split('/').pop() }))
  const currentLanguageIds = current
    .filter(r => isCriterionType(r.campaign_criterion?.type, 'LANGUAGE'))
    .map(r => ({ criterionId: r.campaign_criterion?.criterion_id, langId: String(r.campaign_criterion?.language?.language_constant || '').split('/').pop() }))
  const currentDevices = current
    .filter(r => isCriterionType(r.campaign_criterion?.type, 'DEVICE'))
    .map(r => ({ criterionId: r.campaign_criterion?.criterion_id, type: deviceTypeName(r.campaign_criterion?.device?.type), bidModifier: n(r.campaign_criterion?.bid_modifier ?? 1) }))
  const currentSchedules = current
    .filter(r => isCriterionType(r.campaign_criterion?.type, 'AD_SCHEDULE'))
    .map(r => ({
      criterionId: r.campaign_criterion?.criterion_id,
      dayOfWeek: dayOfWeekName(r.campaign_criterion?.ad_schedule?.day_of_week),
      startHour: n(r.campaign_criterion?.ad_schedule?.start_hour),
      endHour:   n(r.campaign_criterion?.ad_schedule?.end_hour),
    }))

  const wantLocationIds = locations.map(l => String(l.id))
  const wantExcludedLocationIds = excludedLocations.map(l => String(l.id))
  const wantLanguageIds = languages.map(l => String(l.id))
  const wantDevices  = devices.filter(d => Number(d.bidModifier) !== 1 && DEVICE_TYPE_ENUM[d.type])
  const wantSchedKey = s => `${s.dayOfWeek}-${s.startHour}-${s.endHour}`
  const curSchedKey  = s => `${s.dayOfWeek}-${s.startHour}-${s.endHour}`

  const operations = []
  for (const l of currentLocationIds) if (!wantLocationIds.includes(l.geoId))
    operations.push({ entity: 'campaign_criterion', operation: 'remove', resource: ResourceNames.campaignCriterion(customerId, campaignId, l.criterionId) })
  for (const l of currentExcludedLocationIds) if (!wantExcludedLocationIds.includes(l.geoId))
    operations.push({ entity: 'campaign_criterion', operation: 'remove', resource: ResourceNames.campaignCriterion(customerId, campaignId, l.criterionId) })
  for (const l of currentLanguageIds) if (!wantLanguageIds.includes(l.langId))
    operations.push({ entity: 'campaign_criterion', operation: 'remove', resource: ResourceNames.campaignCriterion(customerId, campaignId, l.criterionId) })
  for (const id of wantLocationIds) if (!currentLocationIds.some(l => l.geoId === id))
    operations.push({ entity: 'campaign_criterion', operation: 'create', resource: { campaign: campaignRN, location: { geo_target_constant: ResourceNames.geoTargetConstant(id) } } })
  for (const id of wantExcludedLocationIds) if (!currentExcludedLocationIds.some(l => l.geoId === id))
    operations.push({ entity: 'campaign_criterion', operation: 'create', resource: { campaign: campaignRN, negative: true, location: { geo_target_constant: ResourceNames.geoTargetConstant(id) } } })
  for (const id of wantLanguageIds) if (!currentLanguageIds.some(l => l.langId === id))
    operations.push({ entity: 'campaign_criterion', operation: 'create', resource: { campaign: campaignRN, language: { language_constant: ResourceNames.languageConstant(id) } } })

  // Devices — one criterion per type; remove if no longer wanted (or reset to
  // 1x), create if new, update in place if only the bid modifier changed.
  // Google Ads does not allow removing device bid-modifier criteria once
  // created (confirmed live: "The criterion is not allowed to be removed")
  // — resetting to neutral (1x) is the only way to "clear" one.
  for (const cur of currentDevices) {
    const want = wantDevices.find(d => d.type === cur.type)
    const targetModifier = want ? Number(want.bidModifier) : 1
    if (targetModifier !== cur.bidModifier)
      operations.push({ entity: 'campaign_criterion', operation: 'update', resource: { resource_name: ResourceNames.campaignCriterion(customerId, campaignId, cur.criterionId), bid_modifier: targetModifier } })
  }
  for (const want of wantDevices) if (!currentDevices.some(c => c.type === want.type))
    operations.push({ entity: 'campaign_criterion', operation: 'create', resource: { campaign: campaignRN, device: { type: DEVICE_TYPE_ENUM[want.type] }, bid_modifier: Number(want.bidModifier) } })

  // Ad schedules — existence-based like locations (no meaningful "update", a
  // changed block is a different criterion entirely).
  for (const cur of currentSchedules) if (!adSchedules.some(s => wantSchedKey(s) === curSchedKey(cur)))
    operations.push({ entity: 'campaign_criterion', operation: 'remove', resource: ResourceNames.campaignCriterion(customerId, campaignId, cur.criterionId) })
  for (const want of adSchedules) if (!currentSchedules.some(cur => curSchedKey(cur) === wantSchedKey(want)) && DAY_OF_WEEK_ENUM.includes(want.dayOfWeek))
    operations.push({
      entity: 'campaign_criterion', operation: 'create',
      resource: { campaign: campaignRN, ad_schedule: { day_of_week: want.dayOfWeek, start_hour: Number(want.startHour), start_minute: enums.MinuteOfHour.ZERO, end_hour: Number(want.endHour), end_minute: enums.MinuteOfHour.ZERO } },
    })

  if (operations.length === 0) return { success: true, changed: 0, validateOnly: !!validateOnly }

  try {
    await customer.mutateResources(operations, validateOnly ? { validate_only: true } : undefined)
    return { success: true, changed: operations.length, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Rollback (pause-created / restore-previous — never a hard delete) ────────

async function rollbackCampaignCreate({ api, credentials }, customerId, mccCustomerId, { campaignResourceName }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  try {
    await customer.campaigns.update([{ resource_name: campaignResourceName, status: enums.CampaignStatus.PAUSED }])
    return { success: true }
  } catch (e) {
    return { success: false, errors: [parseGoogleAdsError(e)] }
  }
}

async function rollbackCampaignUpdate({ api, credentials }, customerId, mccCustomerId, { action, campaignId, budgetId, before }) {
  try {
    if (action === 'updateName')     return await updateCampaignName({ api, credentials }, customerId, mccCustomerId, { campaignId, name: before.name })
    if (action === 'updateStatus')   return await updateCampaignStatus({ api, credentials }, customerId, mccCustomerId, { campaignId, status: before.status })
    if (action === 'updateBudget')   return await updateCampaignBudget({ api, credentials }, customerId, mccCustomerId, { budgetId, dailyBudget: before.dailyBudget })
    if (action === 'updateBidding')  return await updateCampaignBidding({ api, credentials }, customerId, mccCustomerId, { campaignId, biddingStrategy: before.biddingStrategy, targetValue: before.targetValue })
    if (action === 'updateEndDate')  return await updateCampaignEndDate({ api, credentials }, customerId, mccCustomerId, { campaignId, endDate: before.endDate })
    if (action === 'updateTargeting') return await updateCampaignTargeting({ api, credentials }, customerId, mccCustomerId, { campaignId, locations: before.locations, languages: before.languages, devices: before.devices, adSchedules: before.adSchedules })
    return { success: false, errors: [`Unknown rollback action: ${action}`] }
  } catch (e) {
    return { success: false, errors: [e.message] }
  }
}

module.exports = {
  listCampaigns, getCampaign,
  createSearchCampaign, createDisplayCampaign, createPerformanceMaxCampaign, createShoppingCampaign, createVideoCampaign,
  updateCampaignName, updateCampaignStatus, updateCampaignBudget, updateCampaignBidding, updateCampaignTargeting, updateCampaignEndDate,
  rollbackCampaignCreate, rollbackCampaignUpdate,
  searchGeoTargets, listLanguages,
  // Shared low-level mutate helpers — reused by adGroupClient.js so it
  // doesn't have to re-derive the same temp-resource-name resolution and
  // match-type mapping logic (see resultResourceName's own comment for why
  // getting this right matters — it's what the "temp resource name" bug was).
  extractResourceNames, resultResourceName, matchTypeEnum, matchTypeName,
  // Also reused by assetGroupClient.js for creating PMax asset-group image assets.
  fetchImageBuffer, mimeTypeFromUrl,
}
