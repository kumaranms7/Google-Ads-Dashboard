'use strict'

const dayjs = require('dayjs')
const { enums, ResourceNames } = require('google-ads-api')

// ── Client factory ────────────────────────────────────────────────────────────

function createClient(credentials) {
  const { GoogleAdsApi } = require('google-ads-api')
  const api = new GoogleAdsApi({
    client_id:       credentials.oauthClientId,
    client_secret:   credentials.oauthClientSecret,
    developer_token: credentials.developerToken,
  })
  return { api, credentials }
}

// ── Date helpers ──────────────────────────────────────────────────────────────
// Google Ads records segments.date in each ACCOUNT's own configured timezone
// (customer_client.time_zone), not the machine running this app. Computing
// "today"/"N days ago" via `new Date()` + `.toISOString()` mixes the host
// machine's local wall-clock day with a UTC-formatted stamp — at the day
// boundary that can land on the wrong calendar date relative to what the
// account itself considers "today". These helpers use Intl's IANA timezone
// support (built into Node, no extra dependency) to compute the correct
// calendar date in the ACCOUNT's timezone instead.

function tzDateStr(date, timeZone) {
  // en-CA locale formats as YYYY-MM-DD, which is what GAQL date literals need.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC' }).format(date)
}
function tzToday(timeZone) {
  return tzDateStr(new Date(), timeZone)
}
// Anchored at UTC noon so subtracting whole days can't cross a DST transition
// in a way that shifts the resulting calendar date — safe once we already
// have the correct starting YYYY-MM-DD for the account's timezone.
function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().split('T')[0]
}
function monthStartStr(dateStr) {
  return dateStr.slice(0, 8) + '01'
}
function prevMonthBounds(dateStr) {
  const [y, m] = dateStr.split('-').map(Number)
  const end   = new Date(Date.UTC(y, m - 1, 0))       // day 0 of this month = last day of prev month
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}

// Returns a full "segments.date ..." clause — avoids DURING keyword which
// is not supported by some resources (e.g. call_view in certain API versions).
function buildDateClause(dateRange, timeZone) {
  if (dateRange && typeof dateRange === 'object' && dateRange.startDate) {
    return `segments.date BETWEEN '${dateRange.startDate}' AND '${dateRange.endDate}'`
  }
  const today = tzToday(timeZone)
  const ago   = days => addDays(today, -days)
  const presets = {
    TODAY:        `segments.date = '${today}'`,
    YESTERDAY:    `segments.date = '${ago(1)}'`,
    LAST_7_DAYS:  `segments.date BETWEEN '${ago(7)}' AND '${today}'`,
    LAST_14_DAYS: `segments.date BETWEEN '${ago(14)}' AND '${today}'`,
    LAST_30_DAYS: `segments.date BETWEEN '${ago(30)}' AND '${today}'`,
    LAST_90_DAYS: `segments.date BETWEEN '${ago(90)}' AND '${today}'`,
    THIS_MONTH:   `segments.date BETWEEN '${monthStartStr(today)}' AND '${today}'`,
    LAST_MONTH:   (() => { const { start, end } = prevMonthBounds(today); return `segments.date BETWEEN '${start}' AND '${end}'` })(),
  }
  return presets[dateRange] ?? `segments.date BETWEEN '${ago(30)}' AND '${today}'`
}

function getPreviousPeriodClause(dateRange, timeZone) {
  if (typeof dateRange !== 'string') {
    if (!dateRange?.startDate || !dateRange?.endDate) return null
    const start = dayjs(dateRange.startDate)
    const end   = dayjs(dateRange.endDate)
    const days  = end.diff(start, 'day') + 1
    const prevEnd   = start.subtract(1, 'day')
    const prevStart = prevEnd.subtract(days - 1, 'day')
    return `segments.date BETWEEN '${prevStart.format('YYYY-MM-DD')}' AND '${prevEnd.format('YYYY-MM-DD')}'`
  }
  const today     = tzToday(timeZone)
  const yesterday = dayjs(addDays(today, -1))
  const map = {
    TODAY: { days:1, end: dayjs(today) }, YESTERDAY: { days:1, end:yesterday },
    LAST_7_DAYS: { days:7, end:yesterday }, LAST_14_DAYS: { days:14, end:yesterday },
    LAST_30_DAYS: { days:30, end:yesterday }, LAST_90_DAYS: { days:90, end:yesterday },
  }
  const p = map[dateRange]
  if (!p) return null
  const curStart  = p.end.subtract(p.days-1, 'day')
  const prevEnd   = curStart.subtract(1, 'day')
  const prevStart = prevEnd.subtract(p.days-1, 'day')
  return `segments.date BETWEEN '${prevStart.format('YYYY-MM-DD')}' AND '${prevEnd.format('YYYY-MM-DD')}'`
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const n = v => Number(v ?? 0)

function enumStr(v) {
  if (v == null) return ''
  if (typeof v === 'object' && v.value !== undefined) return String(v.value)
  return String(v)
}

// Builds a { numericCode: 'SCREAMING_SNAKE_NAME' } lookup from a google-ads-api
// enums.* object (which maps NAME -> number) — used where the API returns a
// raw numeric code for a field the library doesn't auto-resolve to a string.
function reverseEnumMap(enumObj) {
  const out = {}
  for (const [k, v] of Object.entries(enumObj || {})) out[String(v)] = k
  return out
}
function humanizeEnumName(name) {
  if (!name) return ''
  return name.toLowerCase().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function segVal(r, snakeKey) {
  const direct = r.segments?.[snakeKey]
  if (direct !== undefined) return direct
  const camel = snakeKey.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  return r.segments?.[camel]
}

function makeCustomer({ api, credentials }, customerId, mccCustomerId) {
  return api.Customer({
    customer_id:       String(customerId).replace(/-/g, ''),
    refresh_token:     credentials.refreshToken,
    login_customer_id: String(mccCustomerId || customerId).replace(/-/g, ''),
  })
}

// Google creates system-generated Local Services Ads campaign records
// (resource names like "LocalServicesCampaign:SystemGenerated:...") that the
// API returns but the real Google Ads UI excludes from standard campaign
// lists and reporting totals — they were inflating this app's Dashboard/
// Reports totals well above what the Google Ads UI shows for the same
// account/range. Applied everywhere campaign-level metrics get summed.
const EXCLUDE_LOCAL_SERVICES = `campaign.advertising_channel_type != 'LOCAL_SERVICES'`

// Matches the Google Ads UI's default Dashboard/Overview filter chip
// ("Campaign status: Enabled") — confirmed live against a real account: it
// filters by the campaign's CURRENT status even when looking at a past date,
// not just whether the campaign existed then. A campaign that has since been
// paused or removed has its in-range historical metrics excluded from
// Google's own default totals too, even though it was genuinely active on
// that date — so this app has to match that same current-status filter, not
// "not removed" and not unfiltered, to agree with what the account manager
// is actually looking at.
const ENABLED_CAMPAIGNS_ONLY = `campaign.status = 'ENABLED'`

// Sums raw metrics across multiple campaign rows into one KPI object — the
// account-wide totals now come from a campaign-level query (excludable by
// channel type) rather than the customer-level rollup, which cannot be
// filtered by campaign attributes at all in GAQL. Ratio metrics (ctr, avgCpc,
// convRate) are recomputed from the summed raw components rather than
// summed/averaged directly, since a ratio-of-ratios across campaigns of
// different sizes would be wrong.
function sumKpiRows(rows) {
  let impressions = 0, clicks = 0, costMicros = 0, conversions = 0, allConvValue = 0
  for (const r of rows) {
    const m = r.metrics || {}
    impressions  += n(m.impressions)
    clicks       += n(m.clicks)
    costMicros   += n(m.cost_micros)
    conversions  += n(m.conversions)
    allConvValue += n(m.all_conversions_value ?? 0)
  }
  const spend = costMicros / 1_000_000
  return {
    impressions, clicks, spend, conversions,
    ctr:      impressions > 0 ? (clicks / impressions) * 100 : 0,
    avgCpc:   clicks > 0 ? spend / clicks : 0,
    convRate: clicks > 0 ? (conversions / clicks) * 100 : 0,
    cpa:      conversions > 0 ? spend / conversions : 0,
    roas:     spend > 0 ? allConvValue / spend : 0,
    phoneCalls:       0, // filled in later from the dedicated call-tracking queries
    phoneImpressions: 0,
  }
}

const ZERO_KPIS = {
  impressions:0, clicks:0, spend:0, conversions:0,
  ctr:0, avgCpc:0, convRate:0, roas:0,
  phoneCalls:0, phoneImpressions:0,
}

// ── Label maps ────────────────────────────────────────────────────────────────

const NETWORK_LABELS = {
  // String enum forms — labels match Google Ads UI exactly
  SEARCH:'Google Search', SEARCH_PARTNERS:'Search Partners',
  CONTENT:'Google Display Network',
  YOUTUBE_SEARCH:'YouTube Search', YOUTUBE_WATCH:'YouTube',
  MIXED:'Cross-network', GOOGLE_TV:'Google TV',
  UNKNOWN:'Unknown', UNSPECIFIED:'Other',
  // Proto-prefixed variants some library versions emit
  AD_NETWORK_TYPE_SEARCH:'Google Search', AD_NETWORK_TYPE_SEARCH_PARTNERS:'Search Partners',
  AD_NETWORK_TYPE_CONTENT:'Google Display Network',
  AD_NETWORK_TYPE_YOUTUBE_SEARCH:'YouTube Search',
  AD_NETWORK_TYPE_YOUTUBE_WATCH:'YouTube', AD_NETWORK_TYPE_MIXED:'Cross-network',
  AD_NETWORK_TYPE_GOOGLE_TV:'Google TV',
  // Numeric enum (0=UNSPECIFIED,1=UNKNOWN,2=SEARCH,3=SEARCH_PARTNERS,
  //   4=CONTENT,5=YOUTUBE_SEARCH,6=YOUTUBE_WATCH,7=MIXED,8=GOOGLE_TV)
  '0':'Other', '1':'Unknown', '2':'Google Search', '3':'Search Partners',
  '4':'Google Display Network', '5':'YouTube Search', '6':'YouTube',
  '7':'Cross-network', '8':'Google TV',
}
const DEVICE_LABELS = {
  MOBILE:'Mobile', DESKTOP:'Desktop', TABLET:'Tablet',
  // Google Ads UI: OTHER(6) displays as "TV screens", CONNECTED_TV(5) displays as "Other"
  CONNECTED_TV:'Other', OTHER:'TV Screen', UNKNOWN:'Unknown', UNSPECIFIED:'Unknown',
  '0':'Unknown', '1':'Unknown', '2':'Mobile', '3':'Tablet', '4':'Desktop',
  '5':'Other',      // CONNECTED_TV
  '6':'TV Screen',  // OTHER — Google Ads UI shows this as "TV screens"
}
const SLOT_LABELS = {
  SEARCH_SIDE:'Search Right Side', SEARCH_TOP:'Top of Search', SEARCH_RHS:'Search Right Side',
  SEARCH_OTHER:'Other Search', CONTENT:'Display',
  SEARCH_PARTNER_TOP:'Search Partner Top', SEARCH_PARTNER_OTHER:'Search Partner Other',
  MIXED:'Cross-network', UNKNOWN:'Unknown', UNSPECIFIED:'Other',
  // Numeric enum (0=UNSPECIFIED,1=UNKNOWN,2=SEARCH_SIDE,3=SEARCH_TOP,
  //   4=SEARCH_OTHER,5=CONTENT,6=SEARCH_PARTNER_TOP,7=SEARCH_PARTNER_OTHER,8=MIXED)
  '0':'Other', '1':'Unknown', '2':'Search Right Side', '3':'Top of Search',
  '4':'Other Search', '5':'Display', '6':'Search Partner Top', '7':'Search Partner Other', '8':'Cross-network',
}
const CLICK_LABELS = {
  // ── Numeric enum (verified against Google Ads UI) ─────────────────────────
  '0':'Unspecified',
  '1':'Lead Form Headline Interaction', // HEADLINE
  '2':'Cross-network Clicks',          // CROSS_NETWORK
  '3':'Breadcrumbs',
  '4':'Brochure Download',
  '5':'Call Tracking',
  '6':'Mobile Clicks-to-Call',         // CONTACTS
  '7':'CTA',
  '8':'Driving Direction',           // DIRECTIONS
  '9':'Get Location Details / Asset Interaction', // PRICE
  '10':'Hotel Booking',
  '11':'Hotel Property',
  '12':'Maps Pin Clicks',            // LOCATION_EXPANSION
  '13':'Location: Call',
  '14':'Location: Directions',
  '15':'Image',                      // LOCATION_FORMAT_IMAGE
  '16':'Location: Map',
  '17':'Location: Message',
  '18':'Location: Website',
  '19':'Get Location Details',       // GET_LOCATION_DETAILS
  '20':'Click to Message',           // MESSAGE
  '21':'Mobile Clicks-to-Call',      // MOBILE_CALL_TRACKING
  '22':'Sitelink / Promotion Asset',   // OFFER
  '23':'Other',
  '24':'Manually Dialed Phone Calls',// PHONE_CALLS
  '25':'Headline',                     // POST
  '26':'Product Extension',
  '27':'Product Plus Box',
  '28':'Sitelink',                   // SITELINK
  '29':'Store Visits',
  '30':'Website',                    // URL_CLICKS
  '31':'Video App Store',
  '32':'Video Call to Action',
  '33':'Video Card Headline',
  '34':'Video End Cap',
  '35':'Video Website',
  '36':'Website Call',
  '37':'Website Content',
  '38':'Website Directions',
  '39':'Website Menu',
  '40':'Website Mobile Download',
  '41':'Website Phone Call',
  '42':'Website Reservations',
  '43':'Website See Menu',
  '44':'Website Order',
  '45':'Website Clicks to Call',
  '46':'File Download',
  '47':'Mobile Clicks-to-Call',
  '48':'Maps: Directions',
  '49':'Maps: Save',
  '50':'Maps: Website',
  '51':'Maps: Call',
  '52':'Maps: Share Location',
  '53':'Maps: Other',
  '54':'Maps: Store Visits',
  '55':'Maps: Order',
  '56':'Maps: Book',
  '57':'Cross-network Clicks',         // LEAD_FORM_SUBMIT
  '58':'Image Interaction',            // LEAD_FORM_OPEN
  // ── String enum forms ─────────────────────────────────────────────────────
  UNSPECIFIED:'Unspecified',
  HEADLINE:'Lead Form Headline Interaction',
  CROSS_NETWORK:'Cross-network Clicks',
  BREADCRUMBS:'Breadcrumbs',
  BROCHURE_DOWNLOAD:'Brochure Download',
  CALL_TRACKING:'Call Tracking',
  CONTACTS:'Mobile Clicks-to-Call',
  CTA:'CTA',
  DIRECTIONS:'Driving Direction',
  PRICE:'Get Location Details / Asset Interaction',
  HOTEL_CENTER_PROPERTY_BOOKING:'Hotel Booking',
  HOTEL_PROPERTY:'Hotel Property',
  LOCATION_EXPANSION:'Maps Pin Clicks',
  LOCATION_FORMAT_CALL:'Location: Call',
  LOCATION_FORMAT_DIRECTIONS:'Location: Directions',
  LOCATION_FORMAT_IMAGE:'Image',
  LOCATION_FORMAT_MAP:'Location: Map',
  LOCATION_FORMAT_MESSAGE:'Location: Message',
  LOCATION_FORMAT_WEBSITE:'Location: Website',
  GET_LOCATION_DETAILS:'Get Location Details',
  MESSAGE:'Click to Message',
  MOBILE_CALL_TRACKING:'Mobile Clicks-to-Call',
  OFFER:'Sitelink / Promotion Asset',
  OTHER:'Other',
  PHONE_CALLS:'Manually Dialed Phone Calls',
  POST:'Headline',
  PRODUCT_EXTENSION:'Product Extension',
  PRODUCT_PLUSBOX:'Product Plus Box',
  SITELINK:'Sitelink',
  STORE_VISITS:'Store Visits',
  URL_CLICKS:'Website',
  VIDEO_APP_STORE_CLICKS:'Video App Store',
  VIDEO_CALL_TO_ACTION_CLICKS:'Video Call to Action',
  VIDEO_CARD_ACTION_HEADLINE_CLICKS:'Video Card Headline',
  VIDEO_END_CAP_CLICKS:'Video End Cap',
  VIDEO_WEBSITE_CLICKS:'Video Website',
  WEBSITE_CALL:'Website Call',
  WEBSITE_CONTENT:'Website Content',
  WEBSITE_DIRECTIONS:'Website Directions',
  WEBSITE_MENU:'Website Menu',
  WEBSITE_MOBILE_DOWNLOAD:'Website Mobile Download',
  WEBSITE_PHONE_CALL:'Website Phone Call',
  WEBSITE_RESERVATIONS:'Website Reservations',
  WEBSITE_SEE_MENU:'Website See Menu',
  WEBSITE_ORDER:'Website Order',
  WEBSITE_CLICKS_TO_CALL:'Website Clicks to Call',
  FILE_DOWNLOAD:'File Download',
  GOOGLE_MAPS_DRIVING_DIRECTIONS:'Maps: Directions',
  GOOGLE_MAPS_SAVE:'Maps: Save',
  GOOGLE_MAPS_WEBSITE:'Maps: Website',
  GOOGLE_MAPS_CALL:'Maps: Call',
  GOOGLE_MAPS_SHARE_LOCATION:'Maps: Share Location',
  GOOGLE_MAPS_OTHER_ENGAGEMENT:'Maps: Other',
  GOOGLE_MAPS_STORE_VISITS:'Maps: Store Visits',
  GOOGLE_MAPS_ORDER:'Maps: Order',
  GOOGLE_MAPS_BOOK:'Maps: Book',
  LEAD_FORM_SUBMIT:'Cross-network Clicks',
  LEAD_FORM_OPEN:'Image Interaction',
  UNKNOWN:'Unknown',
}
const STATUS_MAP    = {
  ENABLED:'Active', PAUSED:'Paused', REMOVED:'Removed', ENABLED_PAUSED:'Limited',
  // Integer proto values returned by some API versions
  '2':'Active', '3':'Paused', '4':'Removed',
}
const MATCH_TYPE_LBL = {
  BROAD:'Broad', PHRASE:'Phrase', EXACT:'Exact',
  BROAD_MATCH:'Broad', PHRASE_MATCH:'Phrase', EXACT_MATCH:'Exact',
  // KeywordMatchType proto: EXACT=2, PHRASE=3, BROAD=4
  '2':'Exact', '3':'Phrase', '4':'Broad',
}
const resolveMatchType = v => {
  const s = enumStr(v)
  return MATCH_TYPE_LBL[s] || MATCH_TYPE_LBL[s.toUpperCase()] || s || 'Broad'
}
const CHANNEL_LABELS = {
  // Integer proto values (AdvertisingChannelType enum)
  0:'Other', 1:'Unknown', 2:'Search', 3:'Display', 4:'Shopping',
  5:'Hotel', 6:'Video', 7:'PMax', 8:'Local', 9:'Smart',
  10:'PMax', 11:'Local Services', 12:'Demand Gen', 13:'Travel', 14:'Demand Gen',
  // String enum names
  SEARCH:'Search', DISPLAY:'Display', SHOPPING:'Shopping', VIDEO:'Video',
  MULTI_CHANNEL:'PMax', SMART:'Smart', LOCAL:'Local',
  DISCOVERY:'Demand Gen', PERFORMANCE_MAX:'PMax',
  DEMAND_GEN:'Demand Gen', HOTEL:'Hotel', LOCAL_SERVICES:'Local Services',
  TRAVEL:'Travel', UNKNOWN:'Unknown', UNSPECIFIED:'Other',
}

// ── Conversion breakdown helpers ─────────────────────────────────────────────

// Real Google Ads conversion-action type/category values that mean "this is
// a phone-call conversion" — checked via the actual structured field on the
// conversion_action resource. Previously this was guessed from the
// conversion action's own NAME (/phone|call/i) — which silently miscounted
// every account whose call conversion action was named something else (e.g.
// "Lead", "Contact Us", "Get Quote"): anything that didn't literally contain
// "phone" or "call" fell into the "form" bucket by default, even though
// Google itself correctly attributes it as a phone conversion. Confirmed
// live: a client account with 23 real phone-call conversions (per Google
// Ads) showed 0 phone / 23 form in this app because its call conversion
// action wasn't named with either keyword.
const PHONE_CONVERSION_TYPES = new Set([
  'AD_CALL', 'CLICK_TO_CALL', 'WEBSITE_CALL', 'UPLOAD_CALLS',
  'SMART_CAMPAIGN_AD_CLICKS_TO_CALL', 'SMART_CAMPAIGN_MAP_CLICKS_TO_CALL', 'SMART_CAMPAIGN_TRACKED_CALLS',
])
const PHONE_CONVERSION_CATEGORIES = new Set(['PHONE_CALL_LEAD'])

function isPhoneConversionAction(info) {
  return !!info && (PHONE_CONVERSION_TYPES.has(info.type) || PHONE_CONVERSION_CATEGORIES.has(info.category))
}

// One lightweight account-wide lookup — conversion action name -> {type,
// category} (the raw SCREAMING_SNAKE_CASE enum names, not humanized) — built
// once per report call and reused by every phone/form breakdown below,
// instead of guessing from the name string. Same conversion_action query
// shape already proven working in fetchAccountStructureData, minus the
// ENABLED-only filter (a since-paused/removed conversion action can still
// have historical conversions in the selected date range and must still be
// classified correctly).
async function fetchConversionActionCategoryMap(customer) {
  const rows = await customer.query(`
    SELECT conversion_action.name, conversion_action.type, conversion_action.category
    FROM conversion_action
  `).catch(() => [])
  const CONV_TYPE_BY_CODE = reverseEnumMap(enums.ConversionActionType)
  const CONV_CAT_BY_CODE  = reverseEnumMap(enums.ConversionActionCategory)
  const map = new Map()
  for (const r of rows) {
    const name = r.conversion_action?.name
    if (!name) continue
    map.set(name, {
      type:     CONV_TYPE_BY_CODE[enumStr(r.conversion_action?.type)]     || '',
      category: CONV_CAT_BY_CODE[enumStr(r.conversion_action?.category)] || '',
    })
  }
  return map
}

// Returns { [id]: { phoneConversions, formConversions, formBreakdown,
// phoneBreakdown } } for the given resource. convActionMapPromise is the
// (already-in-flight) result of fetchConversionActionCategoryMap, awaited
// alongside this function's own query so callers get full parallelism
// without needing to await the map separately first. formBreakdown/
// phoneBreakdown list each individual conversion action by name (e.g.
// "Contact Form", "Call from Ads Extension") with its own count — Google
// Ads doesn't expose actual submitted form field values or call recordings
// via the API, only which conversion action fired and how many times, so
// that action-level breakdown is the most detail available for a
// "Form/Call Conversions" drill-down.
async function buildConvBreakdownMap(customer, fromResource, idSelect, idExtract, dateClause, convActionMapPromise) {
  try {
    const [rows, convActionMap] = await Promise.all([
      customer.query(`
        SELECT ${idSelect}, segments.conversion_action_name, metrics.conversions, metrics.all_conversions
        FROM ${fromResource}
        WHERE ${dateClause} AND metrics.all_conversions > 0
      `).catch(() => []),
      convActionMapPromise,
    ])
    const map = {}
    for (const r of rows) {
      const id   = String(idExtract(r) ?? '')
      const name = r.segments?.conversion_action_name ?? r.segments?.conversionActionName ?? ''
      const info = convActionMap.get(name)
      // Phone-call conversion actions (calls from ads, website call
      // extensions) go through Google's call-duration verification before
      // metrics.conversions is finalized — for days/weeks the confirmed
      // count only shows up in metrics.all_conversions, which is what the
      // Google Ads UI's own Conversion actions summary reflects for these
      // action types. Form/other actions use metrics.conversions as before
      // since it already matches Google Ads exactly for those.
      const c = isPhoneConversionAction(info)
        ? n(r.metrics?.all_conversions ?? 0)
        : n(r.metrics?.conversions ?? 0)
      if (!id) continue
      if (!map[id]) map[id] = { phoneConversions: 0, formConversions: 0, formBreakdown: {}, phoneBreakdown: {} }
      const key = name || '(Unnamed conversion action)'
      if (isPhoneConversionAction(info)) {
        map[id].phoneConversions += c
        map[id].phoneBreakdown[key] = (map[id].phoneBreakdown[key] || 0) + c
      } else {
        map[id].formConversions += c
        map[id].formBreakdown[key] = (map[id].formBreakdown[key] || 0) + c
      }
    }
    for (const id of Object.keys(map)) {
      // Filter zero entries — the WHERE floor is metrics.all_conversions > 0
      // (to catch pending phone conversions), which also lets through
      // non-phone rows whose metrics.conversions (what forms are counted by)
      // is still 0, cluttering the breakdown with "0" rows.
      map[id].formBreakdown = Object.entries(map[id].formBreakdown)
        .filter(([, conversions]) => conversions > 0)
        .map(([name, conversions]) => ({ name, conversions }))
        .sort((a, b) => b.conversions - a.conversions)
      map[id].phoneBreakdown = Object.entries(map[id].phoneBreakdown)
        .filter(([, conversions]) => conversions > 0)
        .map(([name, conversions]) => ({ name, conversions }))
        .sort((a, b) => b.conversions - a.conversions)
    }
    return map
  } catch { return {} }
}

const CALL_STATUS_LBL = { '1':'Unknown', '2':'Missed', '3':'Received', UNKNOWN:'Unknown', MISSED:'Missed', RECEIVED:'Received', UNSPECIFIED:'Unknown' }

// Returns { [id]: [{name: callStatusLabel, conversions: count}] } grouped by
// whatever entity field is passed (campaign.id / ad_group.id) — the Call
// Leads drill-down data. metrics.phone_calls is just a total count; call_view
// (real per-call records) is the only source with any further detail Google
// Ads exposes, and it flatly rejects segments.date in ANY combination
// (confirmed live: PROHIBITED, even alone with no other call_view field or
// joined resource) — same class of issue already documented on
// fetchCallLeads below, so this filters on the call_view.start_call_date_time
// FIELD instead, exactly like that function does.
async function buildCallStatusBreakdownMap(customer, idField, idExtract, dateRange, timeZone) {
  try {
    const { startDate: cvStart, endDate: cvEnd } = dateRangeBounds(dateRange, timeZone)
    const rows = await customer.query(`
      SELECT ${idField}, call_view.call_status
      FROM call_view
      WHERE call_view.start_call_date_time >= '${cvStart} 00:00:00' AND call_view.start_call_date_time <= '${cvEnd} 23:59:59'
    `).catch(() => [])
    const counts = {}
    for (const r of rows) {
      const id = String(idExtract(r) ?? '')
      if (!id) continue
      const sts = CALL_STATUS_LBL[enumStr(r.call_view?.call_status)] || 'Unknown'
      if (!counts[id]) counts[id] = {}
      counts[id][sts] = (counts[id][sts] || 0) + 1
    }
    const map = {}
    for (const id of Object.keys(counts)) {
      map[id] = Object.entries(counts[id])
        .map(([name, conversions]) => ({ name, conversions }))
        .sort((a, b) => b.conversions - a.conversions)
    }
    return map
  } catch { return {} }
}

// ── List sub-accounts ─────────────────────────────────────────────────────────

async function listSubAccounts({ api, credentials }, mccCustomerId) {
  const cleanId = String(mccCustomerId).replace(/-/g, '')
  const manager = api.Customer({
    customer_id: cleanId, refresh_token: credentials.refreshToken, login_customer_id: cleanId,
  })
  let rows
  try {
    rows = await manager.query(`
      SELECT customer_client.id, customer_client.descriptive_name,
        customer_client.currency_code, customer_client.time_zone,
        customer_client.manager, customer_client.status
      FROM customer_client
      WHERE customer_client.manager = false AND customer_client.status = 'ENABLED'
      ORDER BY customer_client.descriptive_name
    `)
  } catch (e) {
    // Without this, a thrown Google Ads API error object (not a plain Error)
    // crosses the IPC boundary unparsed and Electron's renderer shows it as
    // the unhelpful literal string "[object Object]" instead of the actual
    // reason (e.g. a quota/rate-limit error, expired refresh token, etc.).
    throw new Error(parseGoogleAdsError(e))
  }
  return rows.map(r => ({
    id:           String(r.customer_client.id),
    name:         r.customer_client.descriptive_name || `Account ${r.customer_client.id}`,
    currencyCode: r.customer_client.currency_code || 'USD',
    timeZone:     r.customer_client.time_zone     || 'UTC',
  }))
}

// ── Dashboard data ────────────────────────────────────────────────────────────

async function fetchDashboardData({ api, credentials }, customerId, mccCustomerId, dateRange, timeZone, scope = {}) {
  const { campaignId, adGroupId } = scope || {}
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange, timeZone)
  const prevClause = getPreviousPeriodClause(dateRange, timeZone)
  // call_view rejects segments.date outright (confirmed live:
  // "Cannot select or filter on ... 'segments.date' ... incompatible with
  // ... CALL_VIEW") — the dateClause above can never be used against it.
  // Same fix already applied elsewhere (fetchCallLeads, buildCallStatusBreakdownMap).
  const { startDate: cvStart, endDate: cvEnd } = dateRangeBounds(dateRange, timeZone)
  const callViewDateClause = `call_view.start_call_date_time >= '${cvStart} 00:00:00' AND call_view.start_call_date_time <= '${cvEnd} 23:59:59'`

  // Reports Summary's campaign/ad group filter. When a specific campaign is
  // targeted, show it regardless of enabled/paused status — the user
  // explicitly asked to look at it, unlike the account-wide no-filter view
  // which still hides paused campaigns to match Google Ads UI's default.
  // Local Services stays excluded either way — its reporting shape doesn't
  // support most of this page's widgets, and the Summary picker never
  // offers an LSA campaign as a selectable option.
  const campaignStatusGate = campaignId ? `campaign.status != 'REMOVED'` : ENABLED_CAMPAIGNS_ONLY
  const campaignScope = campaignId ? ` AND campaign.id = ${campaignId}` : ''
  const adGroupScope  = adGroupId  ? ` AND ad_group.id = ${adGroupId}`  : ''
  // Resources that support ad_group.id filtering (ad_group, keyword_view,
  // call_view) use this; campaign.id alone otherwise. Combining both would
  // be redundant once an ad_group.id is known (ad group IDs are unique
  // account-wide), so adGroupId wins when both are set.
  const scopeClause = adGroupId ? adGroupScope : campaignScope
  // KPIs/trend/device/phone/conversion-breakdown need ad-group granularity
  // when an ad group is selected — the campaign resource can't filter by
  // ad_group.id at all, so the FROM itself has to switch.
  const metricsFrom = adGroupId ? 'ad_group' : 'campaign'

  // phone_calls/phone_impressions are only available when call tracking is enabled.
  // Keep them in a SEPARATE query so a missing-metric error cannot zero-out the
  // core KPI row for all accounts.
  const [kpiRows, prevRows, dailyRows, campaignRows, deviceRows, kwRows, budgetRows, wastedRows, phoneRows, callCountRows, convBreakdownRows, convActionMap] =
    await Promise.all([
      // Core KPIs — campaign-level (not customer-level) specifically so this
      // can be filtered to match the Google Ads UI's default view (see
      // ENABLED_CAMPAIGNS_ONLY / EXCLUDE_LOCAL_SERVICES above) — a
      // customer-resource query cannot be filtered by campaign attributes at all.
      customer.query(`
        SELECT metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.all_conversions_value
        FROM ${metricsFrom}
        WHERE ${campaignStatusGate} AND ${EXCLUDE_LOCAL_SERVICES} AND ${dateClause}${scopeClause}
      `).catch(() => []),

      // Previous period
      prevClause ? customer.query(`
        SELECT metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.all_conversions_value
        FROM ${metricsFrom}
        WHERE ${campaignStatusGate} AND ${EXCLUDE_LOCAL_SERVICES} AND ${prevClause}${scopeClause}
      `).catch(() => []) : Promise.resolve([]),

      customer.query(`
        SELECT segments.date, metrics.impressions, metrics.clicks,
          metrics.cost_micros, metrics.conversions
        FROM ${metricsFrom}
        WHERE ${campaignStatusGate} AND ${EXCLUDE_LOCAL_SERVICES} AND ${dateClause}${scopeClause}
        ORDER BY segments.date
      `).catch(() => []),

      // Campaign table / spend-by-type — always campaign-level (an ad-group
      // filter still shows its one parent campaign's row here, not a
      // drill-down; "Campaign Performance Breakdown" is campaign-level by
      // name, and campaign is the only resource campaign_budget-style
      // identity fields come from).
      customer.query(`
        SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.average_cpc
        FROM campaign
        WHERE ${campaignStatusGate} AND ${EXCLUDE_LOCAL_SERVICES} AND ${dateClause}${campaignScope}
        ORDER BY metrics.cost_micros DESC
      `).catch(() => []),

      customer.query(`
        SELECT segments.device, metrics.clicks, metrics.cost_micros
        FROM ${metricsFrom}
        WHERE ${campaignStatusGate} AND ${EXCLUDE_LOCAL_SERVICES} AND ${dateClause}${scopeClause}
      `).catch(() => []),

      customer.query(`
        SELECT ad_group_criterion.keyword.text,
          ad_group_criterion.quality_info.quality_score, metrics.clicks
        FROM keyword_view
        WHERE ${dateClause}
          AND ad_group_criterion.status != 'REMOVED'${scopeClause}
        ORDER BY metrics.clicks DESC LIMIT 10
      `).catch(() => []),

      // Budget — campaign-level only (Google Ads has no per-ad-group
      // budget); an ad-group filter still shows the parent campaign's budget.
      customer.query(`
        SELECT campaign.name, campaign.status,
          campaign_budget.amount_micros, metrics.cost_micros
        FROM campaign
        WHERE ${campaignStatusGate} AND ${EXCLUDE_LOCAL_SERVICES} AND ${dateClause}${campaignScope}
        ORDER BY campaign_budget.amount_micros DESC LIMIT 20
      `).catch(() => []),

      // Wasted spend: keywords with spend and 0 conversions
      customer.query(`
        SELECT metrics.cost_micros
        FROM keyword_view
        WHERE metrics.cost_micros > 1000000
          AND metrics.conversions < 1
          AND ${dateClause}${scopeClause}
      `).catch(() => []),

      // Phone metrics — campaign-level (customer-level often returns 0 for call tracking).
      // Local Services campaigns are excluded here too — LSA is inherently
      // call-driven, so leaving it in would keep inflating this number even
      // after the KPI totals above are fixed.
      customer.query(`
        SELECT campaign.id, metrics.phone_calls, metrics.phone_impressions
        FROM ${metricsFrom} WHERE metrics.phone_impressions > 0 AND ${campaignStatusGate} AND ${EXCLUDE_LOCAL_SERVICES} AND ${dateClause}${scopeClause}
      `).catch(() => []),

      // Call view count — also carries start_call_date_time so it can be
      // bucketed into a daily series (Reports Summary's Call Leads chart).
      customer.query(`
        SELECT call_view.call_status, call_view.call_duration_seconds, call_view.start_call_date_time
        FROM call_view
        WHERE ${callViewDateClause}${scopeClause}
      `).catch(err => { console.error('[dashboard call_view]', err.message); return [] }),

      // Conversion breakdown by action name (phone vs form)
      customer.query(`
        SELECT campaign.id, segments.conversion_action_name, metrics.conversions, metrics.all_conversions
        FROM ${metricsFrom}
        WHERE ${campaignStatusGate} AND ${EXCLUDE_LOCAL_SERVICES} AND ${dateClause} AND metrics.all_conversions > 0${scopeClause}
      `).catch(() => []),

      fetchConversionActionCategoryMap(customer),

    ])

  const kpis         = kpiRows.length  ? sumKpiRows(kpiRows)  : { ...ZERO_KPIS }
  const previousKpis = prevRows.length ? sumKpiRows(prevRows) : null

  // Merge call metrics — prefer call_view count (counts ALL calls, no duration threshold)
  // Fall back to summed campaign-level phone_calls if call_view fails
  const campaignPhoneCalls = phoneRows.reduce((s, r) => s + n(r.metrics?.phone_calls ?? 0), 0)
  if (callCountRows.length > 0) {
    kpis.phoneCalls = callCountRows.length
    kpis.connectedCalls = callCountRows.filter(r => {
      const s = enumStr(r.call_view?.call_status)
      return s === 'RECEIVED' || s === '3'
    }).length
  } else if (campaignPhoneCalls > 0) {
    kpis.phoneCalls     = campaignPhoneCalls
    kpis.connectedCalls = 0
  }

  // Daily call leads — bucketed from the same call_view rows above by the
  // date portion of start_call_date_time (e.g. "2026-09-13 09:44:01" -> "2026-09-13").
  // Only populated when call_view itself succeeded; the campaign-level
  // phone_calls fallback has no per-call timestamp to bucket by day.
  const dailyCallLeadsMap = {}
  for (const r of callCountRows) {
    const t = cvField(r, 'start_call_date_time', 'startCallDateTime') ?? ''
    const d = t.slice(0, 10)
    if (!d) continue
    dailyCallLeadsMap[d] = (dailyCallLeadsMap[d] || 0) + 1
  }
  const dailyCallLeads = Object.entries(dailyCallLeadsMap)
    .map(([date, calls]) => ({ date, calls }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Conversion breakdown by action name (phone vs form) — account totals.
  // Phone-call actions use metrics.all_conversions — Google's own
  // metrics.conversions for call-based actions lags behind by days while the
  // call-duration verification completes, so it silently under-reports (or
  // fully zeroes) phone conversions still pending confirmation even though
  // Google Ads' own Conversion actions summary already shows them.
  let phoneConversions = 0, formConversions = 0
  const phoneBreakdownObj = {}, formBreakdownObj = {}
  // Per-campaign phone+form totals — used to correct the Dashboard/Reports
  // Summary campaign table's Conv. column below, which otherwise reads raw
  // metrics.conversions straight from campaignRows and under-reports the
  // same way the account-wide total used to (see isPhoneConversionAction).
  const campConvTotals = {}
  for (const r of convBreakdownRows) {
    const name = r.segments?.conversion_action_name ?? r.segments?.conversionActionName ?? ''
    const info = convActionMap.get(name)
    const label = name || '(Unnamed conversion action)'
    const campId = String(r.campaign?.id ?? '')
    if (!campConvTotals[campId]) campConvTotals[campId] = 0
    if (isPhoneConversionAction(info)) {
      const c = n(r.metrics?.all_conversions ?? 0)
      phoneConversions += c
      campConvTotals[campId] += c
      if (c > 0) phoneBreakdownObj[label] = (phoneBreakdownObj[label] || 0) + c
    } else {
      // The WHERE floor is metrics.all_conversions > 0 (to catch pending
      // phone conversions), which also lets through non-phone rows whose
      // all_conversions is non-zero but metrics.conversions (what form
      // actions are counted by) is still 0 — skip those so the breakdown
      // dropdown doesn't list a pile of "0" entries.
      const c = n(r.metrics?.conversions ?? 0)
      formConversions += c
      campConvTotals[campId] += c
      if (c > 0) formBreakdownObj[label] = (formBreakdownObj[label] || 0) + c
    }
  }
  const toBreakdownList = obj => Object.entries(obj)
    .map(([name, conversions]) => ({ name, conversions }))
    .sort((a, b) => b.conversions - a.conversions)
  kpis.phoneConversions = phoneConversions
  kpis.formConversions  = formConversions
  kpis.phoneBreakdown   = toBreakdownList(phoneBreakdownObj)
  kpis.formBreakdown    = toBreakdownList(formBreakdownObj)
  // kpis.conversions (top-line KPI) comes from a separate, campaign-status-
  // unfiltered-by-conversion-name query above and can be lower than
  // phone+form here for the same pending-call-verification reason — never
  // show a total smaller than the breakdown sum it sits next to. convRate/cpa
  // are re-derived so they stay consistent with the corrected total.
  kpis.conversions = Math.max(kpis.conversions, phoneConversions + formConversions)
  kpis.convRate = kpis.clicks > 0 ? (kpis.conversions / kpis.clicks) * 100 : 0
  kpis.cpa      = kpis.conversions > 0 ? kpis.spend / kpis.conversions : 0

  // Wasted spend total
  const wastedSpend = wastedRows.reduce((s, r) => s + n(r.metrics?.cost_micros ?? 0) / 1e6, 0)

  const dailySeries = dailyRows.map(r => ({
    date: r.segments.date,
    impressions: n(r.metrics.impressions), clicks: n(r.metrics.clicks),
    spend: n(r.metrics.cost_micros) / 1_000_000, conversions: n(r.metrics.conversions),
  }))

  const CH_SPEND_MAP = {
    SEARCH:'search', DISPLAY:'display', SHOPPING:'shopping', VIDEO:'video',
    MULTI_CHANNEL:'pmax', PERFORMANCE_MAX:'pmax',
    DISCOVERY:'demandGen', DEMAND_GEN:'demandGen',
    '2':'search', '3':'display', '4':'shopping', '5':'video',
    '6':'pmax', '9':'pmax', '10':'pmax', '11':'demandGen', '13':'demandGen', '16':'demandGen',
  }
  const PMAX_NAME_RE = /\bpmax\b|performance\s*max/i
  const spendByType = { search:0, pmax:0, display:0, shopping:0, video:0, demandGen:0 }
  for (const r of campaignRows) {
    const rawType = r.campaign?.advertising_channel_type ?? r.campaign?.advertisingChannelType
    const typeStr = enumStr(rawType)
    const spend   = n(r.metrics?.cost_micros ?? 0) / 1e6
    const key     = CH_SPEND_MAP[typeStr] ?? (PMAX_NAME_RE.test(r.campaign?.name || '') ? 'pmax' : undefined)
    if (key) spendByType[key] += spend
  }
  const campaigns = campaignRows.slice(0, 20).map(r => ({
    name:        r.campaign.name,
    status:      STATUS_MAP[enumStr(r.campaign.status)] || enumStr(r.campaign.status),
    impressions: n(r.metrics.impressions), clicks: n(r.metrics.clicks),
    cpc: n(r.metrics.average_cpc) / 1_000_000,
    // Raw metrics.conversions under-reports while a phone conversion is
    // still pending Google's duration verification (see
    // isPhoneConversionAction) — never show less than the corrected
    // phone+form total computed above for this same campaign.
    conversions: Math.max(n(r.metrics.conversions), campConvTotals[String(r.campaign?.id ?? '')] || 0),
    cost: n(r.metrics.cost_micros) / 1_000_000,
  }))

  const DEVICE_LABEL = { MOBILE:'Mobile', DESKTOP:'Desktop', TABLET:'Tablet', OTHER:'Other' }
  const deviceTotals = {}; let deviceTotal = 0
  for (const r of deviceRows) {
    const d = enumStr(segVal(r, 'device'))
    deviceTotals[d] = (deviceTotals[d] || 0) + n(r.metrics.clicks)
    deviceTotal += n(r.metrics.clicks)
  }
  const deviceSplit = Object.entries(deviceTotals)
    .filter(([d]) => DEVICE_LABELS[d] && !['Unknown','Other'].includes(DEVICE_LABELS[d]))
    .map(([d, clicks]) => ({
      device: DEVICE_LABELS[d] || d, clicks,
      pct: deviceTotal > 0 ? Math.round((clicks / deviceTotal) * 100) : 0,
    })).sort((a, b) => b.clicks - a.clicks)

  const keywords = kwRows.map(r => ({
    text:         r.ad_group_criterion?.keyword?.text || '—',
    qualityScore: n(r.ad_group_criterion?.quality_info?.quality_score ?? 0),
    clicks:       n(r.metrics?.clicks ?? 0),
  }))

  const DASH_STATUS = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }
  const dashDays = (() => {
    if (!dateRange) return 30
    if (typeof dateRange === 'string') {
      const p = { TODAY:1, YESTERDAY:1, LAST_7_DAYS:7, LAST_14_DAYS:14, LAST_30_DAYS:30, LAST_90_DAYS:90, THIS_MONTH:30, LAST_MONTH:30 }
      return p[dateRange] || 30
    }
    if (dateRange?.startDate && dateRange?.endDate) {
      return Math.max(1, Math.round((new Date(dateRange.endDate) - new Date(dateRange.startDate)) / 86400000) + 1)
    }
    return 30
  })()

  const budgetMap = {}
  for (const r of budgetRows) {
    const name = r.campaign?.name || '—'
    if (!budgetMap[name]) {
      const rawStatus = enumStr(r.campaign?.status)
      budgetMap[name] = {
        name,
        status:       DASH_STATUS[rawStatus] || rawStatus,
        budgetAmount: n(r.campaign_budget?.amount_micros ?? 0) / 1e6,
        periodSpend:  0,
      }
    }
    budgetMap[name].periodSpend += n(r.metrics?.cost_micros ?? 0) / 1e6
  }

  const budget = Object.values(budgetMap).map(b => {
    const dailySpend  = dashDays > 1 ? b.periodSpend / dashDays : b.periodSpend
    const utilization = b.budgetAmount > 0 ? (dailySpend / b.budgetAmount) * 100 : 0
    let issue = null
    if (utilization > 120)                                          issue = 'Overpacing'
    else if (b.periodSpend === 0 && b.status === 'Enabled')        issue = 'No activity'
    else if (b.budgetAmount > 0 && utilization > 95)               issue = 'Limited by budget'
    return {
      name:         b.name,
      status:       b.status,
      budget:       b.budgetAmount,
      spend:        dailySpend,
      utilization,
      issue,
      pct: Math.min(Math.round(utilization), 100),
    }
  }).sort((a, b) => b.utilization - a.utilization)

  return {
    kpis: { ...kpis, wastedSpend },
    previousKpis,
    dailySeries, dailyCallLeads, campaigns, deviceSplit, keywords, budget, spendByType,
  }
}

// ── Phone call leads ──────────────────────────────────────────────────────────

// Safely read a call_view field — handles both snake_case and camelCase library responses
function cvField(row, snake, camel) {
  const obj = row.call_view ?? row.callView ?? {}
  return obj[snake] ?? obj[camel] ?? null
}

// Returns { startDate, endDate } as 'YYYY-MM-DD' strings
function dateRangeBounds(dateRange, timeZone) {
  if (dateRange && typeof dateRange === 'object' && dateRange.startDate) {
    return { startDate: dateRange.startDate, endDate: dateRange.endDate }
  }
  const today = tzToday(timeZone)
  const ago   = days => addDays(today, -days)
  const { start: lmStart, end: lmEnd } = prevMonthBounds(today)
  const map = {
    TODAY: { startDate: today, endDate: today },
    YESTERDAY: { startDate: ago(1), endDate: ago(1) },
    LAST_7_DAYS: { startDate: ago(7), endDate: today },
    LAST_14_DAYS: { startDate: ago(14), endDate: today },
    LAST_30_DAYS: { startDate: ago(30), endDate: today },
    LAST_90_DAYS: { startDate: ago(90), endDate: today },
    THIS_MONTH: { startDate: monthStartStr(today), endDate: today },
    LAST_MONTH: { startDate: lmStart, endDate: lmEnd },
  }
  return map[dateRange] ?? { startDate: ago(30), endDate: today }
}

async function fetchCallLeads({ api, credentials }, customerId, mccCustomerId, dateRange, timeZone) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange, timeZone)

  // call_view.call_tracking_display_location (AD vs LANDING_PAGE — i.e. "Ad"
  // vs "Website") is incompatible with segments.date in the same GAQL query
  // ("PROHIBITED_SEGMENT_IN_SELECT_OR_WHERE_CLAUSE", confirmed live) — so this
  // query filters on the call_view.start_call_date_time FIELD directly
  // instead of segments.date, which the same live testing confirmed works
  // fine alongside this field.
  const { startDate: cvStart, endDate: cvEnd } = dateRangeBounds(dateRange, timeZone)
  const callViewDateClause = `call_view.start_call_date_time >= '${cvStart} 00:00:00' AND call_view.start_call_date_time <= '${cvEnd} 23:59:59'`

  // Diagnostic object — returned with the response so the renderer can log it
  const _debug = {
    dateClause,
    filteredQueryRows:   null,
    filteredQueryError:  null,
    unfilteredQueryRows: null,
    unfilteredQueryError: null,
    afterJsFilterRows:   null,
    firstRowKeys:        null,
    firstRowSample:      null,
  }

  // call_view.call_type is NOT a valid field in the Google Ads API — including it
  // causes the entire query to fail with an opaque error object.
  const CALL_VIEW_SQL = `
    SELECT
      call_view.call_duration_seconds,
      call_view.start_call_date_time,
      call_view.end_call_date_time,
      call_view.caller_area_code,
      call_view.caller_country_code,
      call_view.call_status,
      call_view.call_tracking_display_location,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name
    FROM call_view`

  // Serialize a google-ads-api error object into a readable string
  const fmtErr = e => {
    if (!e) return null
    if (typeof e === 'string') return e
    if (e.message) return String(e.message)
    if (e.errors?.[0]?.message) return e.errors[0].message
    try { return JSON.stringify(e).slice(0, 400) } catch (_) { return 'unknown error' }
  }

  // Stage 1 — date-filtered query
  let rawCalls = []
  try {
    const rows = await customer.query(`${CALL_VIEW_SQL}\n    WHERE ${callViewDateClause}`)
    _debug.filteredQueryRows = rows.length
    if (rows.length > 0) {
      _debug.firstRowKeys   = Object.keys(rows[0])
      _debug.firstRowSample = JSON.stringify(rows[0]).slice(0, 500)
      rawCalls = rows
    }
  } catch (err) {
    _debug.filteredQueryError = fmtErr(err)
  }

  // Stage 2 — no date filter (diagnose whether date clause is the problem)
  if (rawCalls.length === 0) {
    try {
      const allRows = await customer.query(`${CALL_VIEW_SQL}`)
      _debug.unfilteredQueryRows = allRows.length
      if (allRows.length > 0) {
        if (!_debug.firstRowKeys) _debug.firstRowKeys   = Object.keys(allRows[0])
        if (!_debug.firstRowSample) _debug.firstRowSample = JSON.stringify(allRows[0]).slice(0, 500)
        const { startDate, endDate } = dateRangeBounds(dateRange, timeZone)
        rawCalls = allRows.filter(row => {
          const t = cvField(row, 'start_call_date_time', 'startCallDateTime') ?? ''
          const d = t.slice(0, 10)
          return !d || (d >= startDate && d <= endDate)
        })
        _debug.afterJsFilterRows = rawCalls.length
      }
    } catch (err) {
      _debug.unfilteredQueryError = fmtErr(err)
    }
  }

  // Phone metrics fallback — campaign-level sum (includes cost for cost-per-call)
  let phoneRows = []
  try {
    phoneRows = await customer.query(`
      SELECT campaign.id, campaign.name, metrics.phone_calls, metrics.cost_micros
      FROM campaign WHERE ${dateClause}
    `)
  } catch (_) { /* silent */ }

  // Capture raw call_view structure from the first row so the frontend can log it
  if (rawCalls.length > 0) {
    const r0     = rawCalls[0]
    const cv0    = r0.call_view ?? r0.callView ?? {}
    _debug.rawCallViewKeys     = Object.keys(cv0)
    _debug.rawCallSourceDirect = cv0['call_tracking_display_location'] ?? cv0['callTrackingDisplayLocation'] ?? 'NOT_FOUND'
    _debug.rawCallViewSample   = JSON.stringify(cv0).slice(0, 600)
  }

  const calls = rawCalls
    .map(row => {
      const dur = n(cvField(row, 'call_duration_seconds', 'callDurationSeconds') ?? 0)
      const cv  = row.call_view ?? row.callView ?? {}
      return {
        startTime:         cvField(row, 'start_call_date_time', 'startCallDateTime') ?? '',
        endTime:           cvField(row, 'end_call_date_time',   'endCallDateTime')   ?? '',
        durationSeconds:   dur,
        durationFmt:       dur >= 60 ? `${Math.floor(dur/60)}m ${dur%60}s` : `${dur}s`,
        callerCountryCode: cvField(row, 'caller_country_code',  'callerCountryCode') ?? '',
        callerAreaCode:    cvField(row, 'caller_area_code',     'callerAreaCode')    ?? '',
        callerPhoneNumber: (() => {
          const area = cvField(row, 'caller_area_code', 'callerAreaCode') ?? ''
          return area ? `(${area}) ***-****` : ''
        })(),
        callStatus: enumStr(cv['call_status'] ?? cv['callStatus'] ?? ''),
        callType:   '',
        // AD vs LANDING_PAGE — i.e. whether the call came from a click-to-call
        // ad element or from a forwarding number shown on the website itself.
        callSource: enumStr(cv['call_tracking_display_location'] ?? cv['callTrackingDisplayLocation'] ?? ''),
        campaignId:   String(row.campaign?.id ?? ''),
        campaignName: row.campaign?.name      ?? '—',
        adGroupId:    String(row.ad_group?.id ?? ''),
        adGroupName:  row.ad_group?.name      ?? '—',
      }
    })
    .sort((a, b) => (b.startTime > a.startTime ? 1 : b.startTime < a.startTime ? -1 : 0))

  const callViewTotal     = calls.length
  const phoneMetricsTotal = phoneRows.reduce((s, r) => s + n(r.metrics?.phone_calls ?? 0), 0)
  const totalCalls        = callViewTotal > 0 ? callViewTotal : phoneMetricsTotal

  const connectedCalls = calls.filter(c => {
    const s = String(c.callStatus).toUpperCase()
    return s === 'RECEIVED' || s === '3'
  }).length

  const totalDuration      = calls.reduce((s, c) => s + c.durationSeconds, 0)
  const avgDurationSeconds = calls.length > 0 ? Math.round(totalDuration / calls.length) : 0

  const totalCost  = phoneRows.reduce((s, r) => s + n(r.metrics?.cost_micros ?? 0), 0) / 1e6
  const costPerCall = totalCalls > 0 ? totalCost / totalCalls : 0

  return {
    calls,
    summary: { totalCalls, connectedCalls, avgDurationSeconds, totalCost, costPerCall },
    campaignMetrics: phoneRows.map(r => ({
      campaignId:   String(r.campaign?.id ?? ''),
      campaignName: r.campaign?.name      ?? '—',
      phoneCalls:   n(r.metrics?.phone_calls ?? 0),
    })),
    _debug,
  }
}

// ── Wasted spend keywords ─────────────────────────────────────────────────────

async function fetchWastedSpend({ api, credentials }, customerId, mccCustomerId, dateRange, thresholdMicros = 10000000, timeZone) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange, timeZone)

  const WASTED_STATUS_LBL = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }
  const resolveWastedStatus = raw => { const s = enumStr(raw); return WASTED_STATUS_LBL[s] || WASTED_STATUS_LBL[s.toUpperCase()] || s }

  const rows = await customer.query(`
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
      ad_group_criterion.quality_info.quality_score,
      ad_group_criterion.status, ad_group_criterion.resource_name,
      campaign.name, campaign.status, ad_group.name,
      metrics.cost_micros, metrics.conversions, metrics.clicks,
      metrics.impressions, metrics.average_cpc, metrics.ctr, metrics.phone_calls
    FROM keyword_view
    WHERE metrics.cost_micros > ${thresholdMicros}
      AND metrics.conversions < 1
      AND ${dateClause}
    ORDER BY metrics.cost_micros DESC LIMIT 100
  `).catch(() => [])

  return rows.map(r => {
    const cost = n(r.metrics?.cost_micros ?? 0) / 1e6
    return {
      resourceName:     r.ad_group_criterion?.resource_name || '',
      text:             r.ad_group_criterion?.keyword?.text || '—',
      matchType:        resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
      qualityScore:     n(r.ad_group_criterion?.quality_info?.quality_score ?? 0),
      status:           resolveWastedStatus(r.ad_group_criterion?.status),
      campaign:         r.campaign?.name || '—',
      campaignStatus:   resolveWastedStatus(r.campaign?.status),
      adGroup:          r.ad_group?.name || '—',
      cost,
      conversions:      0,
      clicks:           n(r.metrics?.clicks       ?? 0),
      impressions:      n(r.metrics?.impressions  ?? 0),
      ctr:              n(r.metrics?.ctr          ?? 0) * 100,
      cpc:              n(r.metrics?.average_cpc  ?? 0) / 1e6,
      phoneConversions: 0,
      formConversions:  0,
      phoneCalls:       n(r.metrics?.phone_calls  ?? 0),
      recommendedAction: cost > 50 ? 'Pause Immediately' : cost > 20 ? 'Review & Consider Pausing' : 'Monitor',
    }
  })
}

// Live lookup of one ad's actual current headlines/descriptions by ad id —
// used right before generating an AI recommendation for it (Reports → Ads
// Performance "Get AI Suggestion"), so the recommendation is always based on
// the ad's real current content, not whatever the Reports table last cached
// on page load. Without this, editing an ad elsewhere (e.g. the RSA
// Builder's Edit modal) and then asking for a new suggestion here would
// evaluate stale pre-edit text and could recommend "replacing" a headline
// that was already replaced.
async function fetchAdCurrentContent({ api, credentials }, customerId, mccCustomerId, adId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const rows = await customer.query(`
    SELECT ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      campaign.name, ad_group.name
    FROM ad_group_ad
    WHERE ad_group_ad.ad.id = ${Number(adId)}
    LIMIT 1
  `).catch(() => [])
  if (!rows.length) return null
  const rsa = rows[0].ad_group_ad?.ad?.responsive_search_ad
  return {
    headlines:    (rsa?.headlines    || []).map(h => (typeof h === 'string' ? h : h?.text || '')).filter(Boolean),
    descriptions: (rsa?.descriptions || []).map(d => (typeof d === 'string' ? d : d?.text || '')).filter(Boolean),
    campaign: rows[0].campaign?.name || '',
    adGroup:  rows[0].ad_group?.name || '',
  }
}

// ── Top converting ads ────────────────────────────────────────────────────────
// NOTE: despite the name, this is now the sole data source for the "Ads
// Performance → All Ads" report (see fetchReportData's 'adsPerformance' case)
// and must return EVERY ad, not just ones with traffic in the period — so it
// intentionally does NOT filter on metrics.impressions > 0. An ad that exists
// but served zero impressions in the selected date range should still appear
// with zero-valued metrics, not be silently dropped.

async function fetchTopConvertingAds({ api, credentials }, customerId, mccCustomerId, dateRange, timeZone) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange, timeZone)
  const convActionMapPromise = fetchConversionActionCategoryMap(customer)

  const [rows, convBD, adGroupCallRows, callBD] = await Promise.all([
    customer.query(`
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.type,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.final_urls, ad_group_ad.status,
        campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.conversions,
        metrics.conversions_from_interactions_rate, metrics.cost_micros,
        metrics.average_cpc, metrics.ctr, metrics.all_conversions_value
      FROM ad_group_ad
      WHERE ${dateClause}
      ORDER BY metrics.conversions DESC LIMIT 2000
    `).catch(() => []),
    buildConvBreakdownMap(customer, 'ad_group_ad', 'ad_group_ad.ad.id', r => r.ad_group_ad?.ad?.id, dateClause, convActionMapPromise),

    // metrics.phone_calls is NOT queryable on ad_group_ad (confirmed live —
    // Google Ads rejects that metric/resource combination), and Google
    // doesn't attribute a call to one specific ad within an ad group anyway
    // — so Call Leads is attributed at the AD GROUP level and shown
    // identically on every ad in that group, same approximation used by
    // most Google Ads reporting UIs.
    customer.query(`
      SELECT ad_group.id, metrics.phone_calls
      FROM ad_group WHERE ${dateClause}
    `).catch(() => []),
    buildCallStatusBreakdownMap(customer, 'ad_group.id', r => r.ad_group?.id, dateRange, timeZone),
  ])

  const adGroupCalls = {}
  for (const r of adGroupCallRows) {
    const id = String(r.ad_group?.id ?? '')
    if (id) adGroupCalls[id] = n(r.metrics?.phone_calls ?? 0)
  }

  return rows.map(r => {
    const cost      = n(r.metrics?.cost_micros ?? 0) / 1e6
    const allConvVal = n(r.metrics?.all_conversions_value ?? 0)
    const headlines  = (r.ad_group_ad?.ad?.responsive_search_ad?.headlines || [])
      .map(h => (typeof h === 'string' ? h : h?.text || '')).filter(Boolean).slice(0, 3)
    const descriptions = (r.ad_group_ad?.ad?.responsive_search_ad?.descriptions || [])
      .map(d => (typeof d === 'string' ? d : d?.text || '')).filter(Boolean).slice(0, 2)
    const convRate = n(r.metrics?.conversions_from_interactions_rate ?? 0) * 100
    const adId     = String(r.ad_group_ad?.ad?.id || '')
    const adGroupId = String(r.ad_group?.id || '')
    const bd       = convBD[adId] || {}

    return {
      id:               adId,
      type:             enumStr(r.ad_group_ad?.ad?.type) || 'UNKNOWN',
      headlines,
      descriptions,
      finalUrls:        r.ad_group_ad?.ad?.final_urls || [],
      status:           STATUS_MAP[enumStr(r.ad_group_ad?.status)] || enumStr(r.ad_group_ad?.status),
      campaignStatus:   ({ ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' })[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status) || '—',
      campaignId:       String(r.campaign?.id  || ''),
      campaign:         r.campaign?.name || '—',
      adGroupId,
      adGroup:          r.ad_group?.name || '—',
      impressions:      n(r.metrics?.impressions ?? 0),
      clicks:           n(r.metrics?.clicks      ?? 0),
      // metrics.conversions alone under-reports while a phone-call
      // conversion is still pending Google's duration verification (see
      // isPhoneConversionAction) — phoneConversions/formConversions already
      // account for that via all_conversions, so the total must be at least
      // their sum, not the possibly-stale raw metric.
      conversions:      Math.max(n(r.metrics?.conversions ?? 0), (bd.phoneConversions || 0) + (bd.formConversions || 0)),
      phoneConversions: bd.phoneConversions || 0,
      formConversions:  bd.formConversions  || 0,
      formBreakdown:    bd.formBreakdown    || [],
      phoneBreakdown:   bd.phoneBreakdown   || [],
      phoneCalls:       adGroupCalls[adGroupId] || 0,
      callBreakdown:    callBD[adGroupId] || [],
      convRate,
      cost,
      cpc:              n(r.metrics?.average_cpc ?? 0) / 1e6,
      ctr:              n(r.metrics?.ctr ?? 0) * 100,
    }
  })
}

// ── Top converting keywords (Feature 3) ──────────────────────────────────────

async function fetchTopConvertingKeywords({ api, credentials }, customerId, mccCustomerId, dateRange, timeZone) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange, timeZone)

  const rows = await customer.query(`
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
      campaign.name, ad_group.name,
      metrics.conversions, metrics.conversions_from_interactions_rate,
      metrics.cost_micros, metrics.average_cpc, metrics.clicks,
      metrics.impressions, metrics.ctr, metrics.cost_per_conversion
    FROM keyword_view
    WHERE metrics.conversions > 0
      AND ${dateClause}
    ORDER BY metrics.conversions DESC LIMIT 20
  `).catch(() => [])

  return rows.map(r => {
    const cost = n(r.metrics?.cost_micros ?? 0) / 1e6
    const convRate = n(r.metrics?.conversions_from_interactions_rate ?? 0) * 100
    return {
      text:      r.ad_group_criterion?.keyword?.text || '—',
      matchType: resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
      campaign:  r.campaign?.name || '—',
      adGroup:   r.ad_group?.name || '—',
      conversions: n(r.metrics?.conversions ?? 0),
      convRate,
      cost,
      cpc:     n(r.metrics?.average_cpc ?? 0) / 1e6,
      clicks:  n(r.metrics?.clicks      ?? 0),
      impressions: n(r.metrics?.impressions ?? 0),
      ctr:     n(r.metrics?.ctr ?? 0) * 100,
      costPerConv: n(r.metrics?.cost_per_conversion ?? 0) / 1e6,
      isTopConverter: convRate > 5,
    }
  })
}

// ── Negative keyword data ─────────────────────────────────────────────────────

// Pure data-fetching layer for the "Search Terms Recommended as Negative
// Keywords" feature — deliberately has NO opinion on which terms are
// irrelevant. That classification needs real semantic judgment (is "bobcat
// service" a core offering or noise? is this search municipal/employment/
// DIY/competitor intent?) which a fixed keyword blocklist and a bare
// `conversions === 0` check can't safely make — confirmed live: that old
// logic was flagging XS Trash's own core services (junk removal, demolition,
// debris removal, etc.) as negatives just because they hadn't converted yet.
// This function only gathers the raw facts; electron/main.js's
// `negatives:fetch` handler does the actual AI-assisted classification and
// applies the protection/threshold rules on top.
async function fetchNegativeData({ api, credentials }, customerId, mccCustomerId, dateRange, timeZone) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)

  // Fixed 90-day lookback for THIS evaluation specifically, independent of
  // whatever date range is selected elsewhere in the UI — judging a term
  // "underperforming" off a short window (e.g. Last 7 Days) risks flagging
  // something that simply hasn't had time to convert yet.
  const lookbackEnd   = tzToday(timeZone)
  const lookbackStart = addDays(lookbackEnd, -90)
  const lookbackClause = `segments.date BETWEEN '${lookbackStart}' AND '${lookbackEnd}'`

  const [searchTermRows, negativeRows, adGroupNegativeRows, sharedCriterionRows, campaignSharedSetRows, campaignCpaRows] = await Promise.all([
    customer.query(`
      SELECT search_term_view.search_term, search_term_view.status,
        campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr
      FROM search_term_view
      WHERE ${lookbackClause} AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC LIMIT 500
    `).catch(() => []),

    customer.query(`
      SELECT campaign_criterion.resource_name, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type,
        campaign_criterion.negative, campaign_criterion.status, campaign.name, campaign.status
      FROM campaign_criterion
      WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'
        AND campaign.status != 'REMOVED'
    `).catch(() => []),

    customer.query(`
      SELECT ad_group_criterion.resource_name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
        ad_group_criterion.negative, ad_group_criterion.status, campaign.name, campaign.status, ad_group.name
      FROM ad_group_criterion
      WHERE ad_group_criterion.negative = TRUE AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status != 'REMOVED' AND campaign.status != 'REMOVED'
    `).catch(() => []),

    // Negative keyword LIST members (shared sets) — these don't show up in
    // campaign_criterion/ad_group_criterion at all, so they need their own query.
    customer.query(`
      SELECT shared_criterion.resource_name, shared_criterion.keyword.text, shared_criterion.keyword.match_type, shared_criterion.shared_set
      FROM shared_criterion
      WHERE shared_criterion.type = 'KEYWORD'
    `).catch(() => []),

    // Which campaigns each shared set (negative keyword list) is attached to.
    customer.query(`
      SELECT campaign_shared_set.campaign, campaign_shared_set.shared_set, campaign.name, campaign.status
      FROM campaign_shared_set
      WHERE campaign_shared_set.status != 'REMOVED'
    `).catch(() => []),

    // Per-campaign CPA target (when bid strategy has one set) — used as the
    // "campaign's target CPA" benchmark for the underperformance check.
    customer.query(`
      SELECT campaign.id, campaign.maximize_conversions.target_cpa_micros, campaign.target_cpa.target_cpa_micros
      FROM campaign WHERE campaign.status != 'REMOVED'
    `).catch(() => []),
  ])

  const CAMP_STATUS_REC = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }

  // Per-campaign CPA benchmark: real target CPA if the bid strategy has one
  // set, else the campaign's OWN historical average CPA from its converting
  // terms in this same lookback window ("historical qualified-lead CPA") —
  // never a guess pulled from nowhere, and left undefined (no threshold
  // applied) if neither is available for that campaign.
  const campaignCpaMap = {}
  for (const r of campaignCpaRows) {
    const id = String(r.campaign?.id ?? '')
    const target = n(r.campaign?.maximize_conversions?.target_cpa_micros ?? 0) || n(r.campaign?.target_cpa?.target_cpa_micros ?? 0)
    if (target > 0) campaignCpaMap[id] = target / 1e6
  }
  const campConvCost = {}, campConvCount = {}
  for (const r of searchTermRows) {
    const conv = n(r.metrics?.conversions ?? 0)
    if (conv <= 0) continue
    const id = String(r.campaign?.id ?? '')
    campConvCost[id]  = (campConvCost[id]  || 0) + n(r.metrics?.cost_micros ?? 0) / 1e6
    campConvCount[id] = (campConvCount[id] || 0) + conv
  }
  for (const id of Object.keys(campConvCount)) {
    if (!campaignCpaMap[id] && campConvCount[id] > 0) campaignCpaMap[id] = campConvCost[id] / campConvCount[id]
  }

  // Candidate rows — a term with 0 clicks carries no real signal either way
  // (an impression alone can't show intent), so it's excluded from
  // consideration entirely rather than judged.
  const candidates = searchTermRows
    .map(r => {
      const campStatus = CAMP_STATUS_REC[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status)
      return {
        term:           r.search_term_view?.search_term || '—',
        status:         campStatus,
        campaignId:     String(r.campaign?.id ?? ''),
        campaign:       r.campaign?.name || '—',
        campaignStatus: campStatus,
        adGroupId:      String(r.ad_group?.id ?? ''),
        adGroup:        r.ad_group?.name || '—',
        impressions:    n(r.metrics?.impressions ?? 0),
        clicks:         n(r.metrics?.clicks ?? 0),
        cost:           n(r.metrics?.cost_micros ?? 0) / 1e6,
        conversions:    n(r.metrics?.conversions ?? 0),
        ctr:            n(r.metrics?.ctr ?? 0) * 100,
      }
    })
    .filter(c => c.clicks >= 1)

  const NEG_STATUS_LBL = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }
  const resolveNegStatus = raw => { const s = enumStr(raw); return NEG_STATUS_LBL[s] || NEG_STATUS_LBL[s.toUpperCase()] || s }

  // Map each shared set (negative keyword list) to the campaigns it's attached to
  const sharedSetCampaigns = {}
  for (const r of campaignSharedSetRows) {
    const ss = r.campaign_shared_set?.shared_set
    if (!ss) continue
    if (!sharedSetCampaigns[ss]) sharedSetCampaigns[ss] = []
    sharedSetCampaigns[ss].push({ name: r.campaign?.name || '—', status: r.campaign?.status })
  }

  // Expand each shared-list keyword into one entry per campaign the list is attached to
  const sharedListNegatives = []
  for (const r of sharedCriterionRows) {
    const ss   = r.shared_criterion?.shared_set
    const text = r.shared_criterion?.keyword?.text
    if (!ss || !text) continue
    for (const camp of (sharedSetCampaigns[ss] || [])) {
      sharedListNegatives.push({
        text,
        resourceName:   r.shared_criterion?.resource_name || '',
        matchType:      resolveMatchType(r.shared_criterion?.keyword?.match_type),
        status:         'Enabled',
        campaign:       camp.name,
        campaignStatus: resolveNegStatus(camp.status),
        adGroup:        '—',
        level:          'Campaign (List)',
      })
    }
  }

  const existingNegatives = [
    ...negativeRows.map(r => ({
      text:           r.campaign_criterion?.keyword?.text || '—',
      resourceName:   r.campaign_criterion?.resource_name || '',
      matchType:      resolveMatchType(r.campaign_criterion?.keyword?.match_type),
      status:         resolveNegStatus(r.campaign_criterion?.status),
      campaign:       r.campaign?.name || '—',
      campaignStatus: resolveNegStatus(r.campaign?.status),
      adGroup:        '—',
      level:          'Campaign',
    })),
    ...adGroupNegativeRows.map(r => ({
      text:           r.ad_group_criterion?.keyword?.text || '—',
      resourceName:   r.ad_group_criterion?.resource_name || '',
      matchType:      resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
      status:         resolveNegStatus(r.ad_group_criterion?.status),
      campaign:       r.campaign?.name  || '—',
      campaignStatus: resolveNegStatus(r.campaign?.status),
      adGroup:        r.ad_group?.name  || '—',
      level:          'Ad Group',
    })),
    ...sharedListNegatives,
  ]

  // A negative keyword already covering a search term shouldn't be
  // re-recommended — but per the new spec it also shouldn't just silently
  // vanish; it gets tagged `alreadyExcluded` here so the caller can label it
  // "Already Excluded" instead of dropping it. Campaign-level (direct or via
  // list) negatives exclude the term account-wide within that campaign;
  // ad-group-level negatives only exclude it for that specific ad group.
  // Maps (not Sets) so an already-excluded candidate can also surface WHICH
  // match type is already blocking it — otherwise "Already Excluded" rows
  // have no match type to show at all, which reads as missing data in the UI.
  const campaignLevelNegTerms = new Map()
  const adGroupLevelNegTerms  = new Map()
  for (const neg of existingNegatives) {
    const key = (neg.text || '').toLowerCase().trim()
    if (!key || neg.campaign === '—') continue
    if (neg.level === 'Ad Group') {
      adGroupLevelNegTerms.set(`${neg.campaign}::${neg.adGroup}::${key}`, neg.matchType)
    } else {
      campaignLevelNegTerms.set(`${neg.campaign}::${key}`, neg.matchType)
    }
  }
  candidates.forEach(c => {
    const key = (c.term || '').toLowerCase().trim()
    const campHit = campaignLevelNegTerms.get(`${c.campaign}::${key}`)
    const agHit   = adGroupLevelNegTerms.get(`${c.campaign}::${c.adGroup}::${key}`)
    c.alreadyExcluded   = campHit !== undefined || agHit !== undefined
    c.existingMatchType = campHit ?? agHit ?? null
    c.cpaBenchmark = campaignCpaMap[c.campaignId] ?? null
  })

  return { candidates, existingNegatives, lookbackStart, lookbackEnd }
}

// ── Keyword planner ideas ─────────────────────────────────────────────────────

async function fetchKeywordIdeas({ api, credentials }, customerId, mccCustomerId, seedKeywords) {
  const cleanId  = String(customerId).replace(/-/g, '')
  const cleanMcc = String(mccCustomerId || customerId).replace(/-/g, '')

  try {
    const customer = api.Customer({
      customer_id: cleanId, refresh_token: credentials.refreshToken, login_customer_id: cleanMcc,
    })
    // google-ads-api v23 exposes KeywordPlanIdeaService
    const service = customer.keywordPlanIdeaService
    if (!service?.generateKeywordIdeas) {
      return { ideas: [], error: 'KeywordPlanIdeaService not available in this API version' }
    }
    const results = await service.generateKeywordIdeas({
      customerId: cleanId,
      language: { resourceName: 'languageConstants/1000' },
      geoTargetConstants: [],
      keywordSeed: { keywords: seedKeywords },
      keywordPlanNetwork: 'GOOGLE_SEARCH_AND_PARTNERS',
    })
    return {
      ideas: (results || []).map(r => {
        const m = r.keyword_idea_metrics || r.keywordIdeaMetrics || {}
        const highBid = n(m.high_top_of_page_bid_micros ?? m.highTopOfPageBidMicros ?? 0) / 1e6
        return {
          keyword:           r.text || r.keyword || '—',
          avgMonthlySearches: n(m.avg_monthly_searches ?? m.avgMonthlySearches ?? 0),
          competitionLevel:  enumStr(m.competition ?? m.competitionLevel) || 'UNKNOWN',
          lowTopOfPageBid:   n(m.low_top_of_page_bid_micros ?? m.lowTopOfPageBidMicros ?? 0) / 1e6,
          highTopOfPageBid:  highBid,
          costFlag: highBid > 25 ? 'Very High Cost' : highBid > 10 ? 'High Cost' : 'Affordable',
        }
      }),
      error: null,
    }
  } catch (err) {
    return { ideas: [], error: err.message }
  }
}

// ── Account audit ─────────────────────────────────────────────────────────────

async function fetchAuditData({ api, credentials }, customerId, mccCustomerId, statusFilter = 'ENABLED', dateRange = 'LAST_30_DAYS', timeZone) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)

  const sf = statusFilter || 'ENABLED'
  const dateClauseAudit = buildDateClause(dateRange, timeZone)

  // Number of days in the selected range — used to convert period spend to daily average
  const daysInRange = (() => {
    if (!dateRange) return 30
    if (typeof dateRange === 'string') {
      const p = { TODAY:1, YESTERDAY:1, LAST_7_DAYS:7, LAST_14_DAYS:14, LAST_30_DAYS:30, LAST_90_DAYS:90, THIS_MONTH:30, LAST_MONTH:30 }
      return p[dateRange] || 30
    }
    if (dateRange.startDate && dateRange.endDate) {
      const diff = (new Date(dateRange.endDate) - new Date(dateRange.startDate)) / 86400000
      return Math.max(1, Math.round(diff) + 1)
    }
    return 30
  })()

  // Conditions for campaigns / ad groups / ads queries
  const campCond = sf === 'ALL'            ? "campaign.status != 'REMOVED'"
                 : sf === 'PAUSED'         ? "campaign.status = 'PAUSED'"
                 : sf === 'ENABLED_PAUSED' ? "campaign.status != 'REMOVED'"
                 :                           "campaign.status = 'ENABLED'"
  const agCond   = sf === 'ALL'            ? "ad_group.status != 'REMOVED'"
                 : sf === 'PAUSED'         ? "ad_group.status = 'PAUSED'"
                 : sf === 'ENABLED_PAUSED' ? "ad_group.status != 'REMOVED'"
                 :                           "ad_group.status = 'ENABLED'"
  const adCond   = sf === 'ALL'            ? "ad_group_ad.status != 'REMOVED'"
                 : sf === 'PAUSED'         ? "ad_group_ad.status = 'PAUSED'"
                 : sf === 'ENABLED_PAUSED' ? "ad_group_ad.status != 'REMOVED'"
                 :                           "ad_group_ad.status = 'ENABLED'"
  const agroupCond = sf === 'PAUSED'       ? "asset_group.status = 'PAUSED'"
                   :                         "asset_group.status != 'REMOVED'"

  // Keyword conflict query conditions (used for non-ALL scopes)
  const kwQueryCampCond = sf === 'ENABLED' ? "campaign.status = 'ENABLED'"
                        : sf === 'PAUSED'  ? "campaign.status = 'PAUSED'"
                        :                    "campaign.status != 'REMOVED'"
  const kwQueryAgCond   = sf === 'ENABLED' ? "ad_group.status = 'ENABLED'"
                        : sf === 'PAUSED'  ? "ad_group.status = 'PAUSED'"
                        :                    "ad_group.status != 'REMOVED'"
  const kwQueryKwCond   = sf === 'ENABLED' ? "ad_group_criterion.status = 'ENABLED'"
                        : sf === 'PAUSED'  ? "ad_group_criterion.status = 'PAUSED'"
                        :                    "ad_group_criterion.status != 'REMOVED'"

  // Helper: build WHERE clause from an array of optional conditions
  const where = (...parts) => {
    const clauses = parts.filter(Boolean)
    return clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
  }

  const [adRows, campaignRows, adGroupRows, assetGroupRows, keywordRows] = await Promise.all([
    customer.query(`
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.type,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.final_urls,
        ad_group_ad.policy_summary.approval_status, ad_group_ad.ad_strength,
        ad_group_ad.status,
        campaign.name, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.conversions
      FROM ad_group_ad
      ${where(dateClauseAudit, campCond, agCond, adCond)}
      LIMIT 200
    `).catch(() => []),

    customer.query(`
      SELECT campaign.name, campaign.status, campaign.advertising_channel_type,
        campaign_budget.amount_micros, campaign_budget.has_recommended_budget,
        campaign_budget.recommended_budget_amount_micros, metrics.cost_micros
      FROM campaign
      ${where(dateClauseAudit, campCond)}
      LIMIT 200
    `).catch(() => []),

    customer.query(`
      SELECT ad_group.name, ad_group.status, campaign.name,
        metrics.impressions, metrics.clicks, metrics.conversions
      FROM ad_group
      ${where(agCond, campCond)}
      LIMIT 500
    `).catch(() => []),

    customer.query(`
      SELECT asset_group.name, asset_group.ad_strength, asset_group.status, campaign.name
      FROM asset_group
      WHERE ${agroupCond}
      LIMIT 50
    `).catch(() => []),

    // For "All" scope fetch each status separately (1000 each) so no single
    // status dominates the limit and all three are represented in results.
    sf === 'ALL'
      ? Promise.all([
          customer.query(`
            SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
              campaign.name, campaign.status, ad_group.name, ad_group.status,
              ad_group_criterion.status
            FROM ad_group_criterion
            WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE
              AND ad_group_criterion.status = 'ENABLED'
            LIMIT 1000
          `).catch(() => []),
          customer.query(`
            SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
              campaign.name, campaign.status, ad_group.name, ad_group.status,
              ad_group_criterion.status
            FROM ad_group_criterion
            WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE
              AND ad_group_criterion.status = 'PAUSED'
            LIMIT 1000
          `).catch(() => []),
          customer.query(`
            SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
              campaign.name, campaign.status, ad_group.name, ad_group.status,
              ad_group_criterion.status
            FROM ad_group_criterion
            WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE
              AND ad_group_criterion.status = 'REMOVED'
            LIMIT 1000
          `).catch(() => []),
        ]).then(([e, p, r]) => [...e, ...p, ...r])
      : customer.query(`
          SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
            campaign.name, campaign.status, ad_group.name, ad_group.status,
            ad_group_criterion.status
          FROM ad_group_criterion
          ${where("ad_group_criterion.type = 'KEYWORD'", "ad_group_criterion.negative = FALSE", kwQueryKwCond, kwQueryCampCond, kwQueryAgCond)}
          LIMIT 2000
        `).catch(() => []),
  ])

  // Process ads
  const ads = adRows.map(r => ({
    id:             String(r.ad_group_ad?.ad?.id || ''),
    type:           enumStr(r.ad_group_ad?.ad?.type),
    headlines:      (r.ad_group_ad?.ad?.responsive_search_ad?.headlines || [])
                      .map(h => typeof h === 'string' ? h : h?.text || '').filter(Boolean).slice(0, 3),
    descriptions:   (r.ad_group_ad?.ad?.responsive_search_ad?.descriptions || [])
                      .map(d => typeof d === 'string' ? d : d?.text || '').filter(Boolean).slice(0, 2),
    finalUrls:      r.ad_group_ad?.ad?.final_urls || [],
    approvalStatus: enumStr(r.ad_group_ad?.policy_summary?.approval_status),
    adStrength:     enumStr(r.ad_group_ad?.ad_strength),
    status:         enumStr(r.ad_group_ad?.status),
    campaign:       r.campaign?.name  || '—',
    adGroup:        r.ad_group?.name  || '—',
    impressions:    n(r.metrics?.impressions ?? 0),
    clicks:         n(r.metrics?.clicks      ?? 0),
    conversions:    n(r.metrics?.conversions ?? 0),
  }))

  // Shared status label resolver for campaigns and ad groups
  const AUDIT_STATUS_LABEL = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }
  const resolveAuditStatus = raw => { const s = enumStr(raw); return AUDIT_STATUS_LABEL[s] || AUDIT_STATUS_LABEL[s.toUpperCase()] || s }

  // Process campaigns + budget issues
  // spend is the total for the selected period — divide by daysInRange to get daily average
  // then compare daily average against the daily budget for meaningful utilization
  const campaigns = campaignRows.map(r => {
    const budget         = n(r.campaign_budget?.amount_micros ?? 0) / 1e6
    const periodSpend    = n(r.metrics?.cost_micros ?? 0) / 1e6
    const dailyAvgSpend  = daysInRange > 1 ? periodSpend / daysInRange : periodSpend
    const utilization    = budget > 0 ? (dailyAvgSpend / budget) * 100 : 0
    const recommended    = n(r.campaign_budget?.recommended_budget_amount_micros ?? 0) / 1e6
    const rawStatus      = enumStr(r.campaign?.status)
    const status         = resolveAuditStatus(r.campaign?.status)
    const channelType    = enumStr(r.campaign?.advertising_channel_type)
    let issue = null
    if (utilization > 120)                                       issue = 'Overpacing'
    else if (periodSpend === 0 && ['ENABLED','2'].includes(rawStatus)) issue = 'No activity'
    else if (budget > 0 && utilization > 95)                    issue = 'Limited by budget'
    return {
      name: r.campaign?.name || '—',
      status, channelType, budget,
      spend: dailyAvgSpend,   // daily average for display
      utilization, recommended,
      hasRecommendedBudget: r.campaign_budget?.has_recommended_budget || false,
      issue,
    }
  })

  // Process ad groups
  const adGroups = adGroupRows.map(r => ({
    name:        r.ad_group?.name || '—',
    status:      resolveAuditStatus(r.ad_group?.status),
    campaign:    r.campaign?.name || '—',
    impressions: n(r.metrics?.impressions ?? 0),
    clicks:      n(r.metrics?.clicks      ?? 0),
    conversions: n(r.metrics?.conversions ?? 0),
  }))

  const assetGroups = assetGroupRows.map(r => ({
    name:       r.asset_group?.name        || '—',
    status:     enumStr(r.asset_group?.status),
    adStrength: enumStr(r.asset_group?.ad_strength),
    campaign:   r.campaign?.name || '—',
  }))

  // Keyword conflict detection
  const STATUS_LABEL_MAP = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed', enabled:'Enabled', paused:'Paused', removed:'Removed' }
  const resolveStatus = raw => {
    const s = enumStr(raw)
    return STATUS_LABEL_MAP[s] || STATUS_LABEL_MAP[s.toUpperCase()] || ''
  }
  const kwByText = {}
  for (const r of keywordRows) {
    const text = (r.ad_group_criterion?.keyword?.text || '').toLowerCase().trim()
    if (!text) continue

    const matchType      = enumStr(r.ad_group_criterion?.keyword?.match_type)

    const campaign       = r.campaign?.name || '—'
    const adGroup        = r.ad_group?.name || '—'
    const status         = resolveStatus(r.ad_group_criterion?.status)
    const campaignStatus = resolveStatus(r.campaign?.status)
    const adGroupStatus  = resolveStatus(r.ad_group?.status)

    if (!kwByText[text]) kwByText[text] = []
    kwByText[text].push({ text, matchType, campaign, adGroup, status, campaignStatus, adGroupStatus })
  }
  const MT_LABEL = { BROAD:'Broad', PHRASE:'Phrase', EXACT:'Exact', '2':'Broad', '3':'Phrase', '4':'Exact' }
  const fmtMT = mt => MT_LABEL[mt] || mt

  const conflicts = []
  for (const [text, entries] of Object.entries(kwByText)) {
    if (entries.length < 2) continue
    const byCampaign = {}
    for (const e of entries) {
      if (!byCampaign[e.campaign]) byCampaign[e.campaign] = []
      byCampaign[e.campaign].push(e)
    }
    for (const [campaign, ces] of Object.entries(byCampaign)) {
      // Group by ad group first so each entry carries its own match type(s)
      const byAdGroup = {}
      for (const e of ces) {
        if (!byAdGroup[e.adGroup]) byAdGroup[e.adGroup] = []
        byAdGroup[e.adGroup].push(e)
      }
      const adGroupEntries = Object.entries(byAdGroup).map(([ag, agEs]) => ({
        adGroup:   ag,
        matchType: [...new Set(agEs.map(e => fmtMT(e.matchType)))].join(' / '),
        status:    agEs[0]?.status || '',
      }))
      if (adGroupEntries.length < 2) continue

      const rawMatchTypes = ces.map(e => e.matchType)
      const hasExact  = rawMatchTypes.some(m => ['EXACT','4'].includes(m))
      const hasBroad  = rawMatchTypes.some(m => ['BROAD','2'].includes(m))
      const hasPhrase = rawMatchTypes.some(m => ['PHRASE','3'].includes(m))
      const issueBase = hasBroad && hasExact ? 'Cannibalizes Exact'
                      : hasBroad && hasPhrase ? 'Cannibalizes Phrase' : 'Duplicate'
      const issueType = `${issueBase} in ${campaign}`
      const uniqueStatuses   = [...new Set(adGroupEntries.map(e => e.status))]
      const uniqueCampStatus = [...new Set(ces.map(e => e.campaignStatus).filter(Boolean))]
      const uniqueAgStatus   = [...new Set(ces.map(e => e.adGroupStatus).filter(Boolean))]
      const status         = uniqueStatuses.length === 1   ? uniqueStatuses[0]   : 'Mixed'
      const campaignStatus = uniqueCampStatus.length === 1 ? uniqueCampStatus[0] : uniqueCampStatus.length > 1 ? 'Mixed' : ''
      const adGroupStatus  = uniqueAgStatus.length === 1   ? uniqueAgStatus[0]   : uniqueAgStatus.length > 1  ? 'Mixed' : ''
      const uniqueAGs = adGroupEntries.map(e => e.adGroup)
      conflicts.push({
        keyword: text,
        campaign,
        adGroupEntries,                       // [{adGroup, matchType, status}] — primary source
        adGroups:   uniqueAGs.join(', '),     // kept for filter/export compatibility
        matchTypes: adGroupEntries.map(e => e.matchType).join(', '),
        issueType,
        issueBase,
        status,
        campaignStatus,
        adGroupStatus,
        recommendation: issueBase === 'Duplicate'
          ? `Keep "${text}" in the best-performing ad group (${uniqueAGs[0]}), remove from others`
          : `Add "${text}" as a negative keyword in the broad-match ad group to prevent overlap`,
      })
    }
  }

  // Service crossover detection
  const channelTypes = campaigns.map(c => c.channelType)
  const hasPMax    = channelTypes.some(t => ['MULTI_CHANNEL','PERFORMANCE_MAX'].includes(t))
  const hasSearch  = channelTypes.some(t => t === 'SEARCH')
  const hasShopping = channelTypes.some(t => t === 'SHOPPING')
  const hasDSA     = channelTypes.some(t => ['DISPLAY','DYNAMIC_SEARCH_ADS'].includes(t))
  const crossovers = []
  if (hasPMax && hasSearch) crossovers.push({
    campaignA: campaigns.find(c => ['MULTI_CHANNEL','PERFORMANCE_MAX'].includes(c.channelType))?.name || 'PMax',
    campaignB: campaigns.find(c => c.channelType === 'SEARCH')?.name || 'Search Campaign',
    issueType: 'PMax vs Search',
    recommendation: 'Add Search campaign keywords as PMax URL exclusions to prevent budget cannibalisation',
  })
  if (hasPMax && hasShopping) crossovers.push({
    campaignA: campaigns.find(c => ['MULTI_CHANNEL','PERFORMANCE_MAX'].includes(c.channelType))?.name || 'PMax',
    campaignB: campaigns.find(c => c.channelType === 'SHOPPING')?.name || 'Shopping Campaign',
    issueType: 'PMax vs Shopping',
    recommendation: 'Pause Shopping campaign — PMax already covers product inventory',
  })
  if (hasSearch && hasDSA) crossovers.push({
    campaignA: campaigns.find(c => c.channelType === 'SEARCH')?.name || 'Search Campaign',
    campaignB: campaigns.find(c => ['DISPLAY','DYNAMIC_SEARCH_ADS'].includes(c.channelType))?.name || 'DSA Campaign',
    issueType: 'Search vs DSA',
    recommendation: 'Add Search campaign keywords as negatives in DSA campaign to prevent overlap',
  })

  return { ads, campaigns, adGroups, assetGroups, keywords: { conflicts }, crossovers }
}

// ── Reports fetch dispatcher ──────────────────────────────────────────────────

async function fetchReportData({ api, credentials }, customerId, mccCustomerId, dateRange, reportType, timeZone) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange, timeZone)

  switch (reportType) {

    case 'campaigns': {
      const convActionMapPromise = fetchConversionActionCategoryMap(customer)
      const [rows, convBD, callBD] = await Promise.all([
        customer.query(`
          SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
            metrics.all_conversions_value, metrics.ctr, metrics.average_cpc,
            metrics.conversions_from_interactions_rate, metrics.phone_calls
          FROM campaign
          WHERE campaign.status != 'REMOVED' AND ${dateClause}
          ORDER BY metrics.cost_micros DESC
        `).catch(() => []),
        buildConvBreakdownMap(customer, 'campaign', 'campaign.id', r => r.campaign?.id, dateClause, convActionMapPromise),
        buildCallStatusBreakdownMap(customer, 'campaign.id', r => r.campaign?.id, dateRange, timeZone),
      ])

      return rows.map(r => {
        const cost = n(r.metrics?.cost_micros ?? 0) / 1e6
        const id   = String(r.campaign?.id || '')
        const bd   = convBD[id] || {}
        // See fetchTopConvertingAds — raw metrics.conversions can under-report
        // while a phone conversion awaits Google's duration verification.
        const conversions = Math.max(n(r.metrics?.conversions ?? 0), (bd.phoneConversions || 0) + (bd.formConversions || 0))
        return {
          id,
          name:             r.campaign?.name || '—',
          status:           STATUS_MAP[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status),
          channelType:      CHANNEL_LABELS[enumStr(r.campaign?.advertising_channel_type)] || enumStr(r.campaign?.advertising_channel_type),
          impressions:      n(r.metrics?.impressions ?? 0), clicks: n(r.metrics?.clicks ?? 0), cost,
          conversions,
          phoneConversions: bd.phoneConversions || 0,
          formConversions:  bd.formConversions  || 0,
          formBreakdown:    bd.formBreakdown    || [],
          phoneBreakdown:   bd.phoneBreakdown   || [],
          phoneCalls:       n(r.metrics?.phone_calls ?? 0),
          callBreakdown:    callBD[id] || [],
          ctr:              n(r.metrics?.ctr ?? 0) * 100, cpc: n(r.metrics?.average_cpc ?? 0) / 1e6,
          convRate:         n(r.metrics?.conversions_from_interactions_rate ?? 0) * 100,
          // Computed from the corrected `conversions` above (not Google's own
          // metrics.cost_per_conversion, which is based on raw, uncorrected
          // conversions) so this stays consistent with the Conv. column.
          costPerConversion: conversions > 0 ? cost / conversions : 0,
        }
      })
    }

    case 'adGroups': {
      const convActionMapPromise = fetchConversionActionCategoryMap(customer)
      const [rows, convBD, callBD] = await Promise.all([
        customer.query(`
          SELECT ad_group.id, ad_group.name, ad_group.status,
            campaign.name, campaign.status,
            metrics.impressions, metrics.clicks, metrics.cost_micros,
            metrics.conversions, metrics.ctr, metrics.average_cpc, metrics.phone_calls,
            metrics.conversions_from_interactions_rate
          FROM ad_group WHERE ad_group.status != 'REMOVED' AND ${dateClause}
          ORDER BY metrics.cost_micros DESC
        `).catch(() => []),
        buildConvBreakdownMap(customer, 'ad_group', 'ad_group.id', r => r.ad_group?.id, dateClause, convActionMapPromise),
        buildCallStatusBreakdownMap(customer, 'ad_group.id', r => r.ad_group?.id, dateRange, timeZone),
      ])
      return rows.map(r => {
        const id   = String(r.ad_group?.id || '')
        const bd   = convBD[id] || {}
        const cost = n(r.metrics?.cost_micros ?? 0) / 1e6
        // See fetchTopConvertingAds — raw metrics.conversions can under-report
        // while a phone conversion awaits Google's duration verification.
        const conversions = Math.max(n(r.metrics?.conversions ?? 0), (bd.phoneConversions || 0) + (bd.formConversions || 0))
        return {
          id,
          name:             r.ad_group?.name  || '—',
          campaign:         r.campaign?.name  || '—',
          campaignStatus:   ({ ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' })[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status),
          status:           STATUS_MAP[enumStr(r.ad_group?.status)]  || enumStr(r.ad_group?.status),
          impressions:      n(r.metrics?.impressions ?? 0),
          clicks:           n(r.metrics?.clicks      ?? 0),
          cost,
          conversions,
          phoneConversions: bd.phoneConversions || 0,
          formConversions:  bd.formConversions  || 0,
          formBreakdown:    bd.formBreakdown    || [],
          phoneBreakdown:   bd.phoneBreakdown   || [],
          phoneCalls:       n(r.metrics?.phone_calls ?? 0),
          callBreakdown:    callBD[id] || [],
          ctr:              n(r.metrics?.ctr         ?? 0) * 100,
          cpc:              n(r.metrics?.average_cpc ?? 0) / 1e6,
          convRate:         n(r.metrics?.conversions_from_interactions_rate ?? 0) * 100,
          costPerConversion: conversions > 0 ? cost / conversions : 0,
        }
      })
    }

    case 'assetGroups': {
      const CAMP_STATUS_LBL = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }
      const convActionMapPromise = fetchConversionActionCategoryMap(customer)
      const [rows, convBD] = await Promise.all([
        customer.query(`
          SELECT asset_group.id, asset_group.name, asset_group.status,
            campaign.id, campaign.name, campaign.status,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
          FROM asset_group WHERE ${dateClause}
        `).catch(() => []),
        buildConvBreakdownMap(customer, 'campaign', 'campaign.id', r => r.campaign?.id, dateClause, convActionMapPromise),
      ])
      // Asset groups join through campaign — use campaign-level breakdown.
      // No Call Leads here — Google Ads doesn't support metrics.phone_calls
      // (or a call_view join) on the asset_group resource.
      return rows.map(r => {
        const campId = String(r.campaign?.id || '')
        const bd     = convBD[campId] || {}
        return {
          id:               String(r.asset_group?.id || ''),
          name:             r.asset_group?.name || '—',
          campaign:         r.campaign?.name    || '—',
          campaignStatus:   CAMP_STATUS_LBL[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status),
          status:           STATUS_MAP[enumStr(r.asset_group?.status)]    || enumStr(r.asset_group?.status),
          impressions:      n(r.metrics?.impressions ?? 0),
          clicks:           n(r.metrics?.clicks      ?? 0),
          cost:             n(r.metrics?.cost_micros ?? 0) / 1e6,
          // See fetchTopConvertingAds — raw metrics.conversions can under-report
          // while a phone conversion awaits Google's duration verification.
          conversions:      Math.max(n(r.metrics?.conversions ?? 0), (bd.phoneConversions || 0) + (bd.formConversions || 0)),
          phoneConversions: bd.phoneConversions || 0,
          formConversions:  bd.formConversions  || 0,
          formBreakdown:    bd.formBreakdown    || [],
          phoneBreakdown:   bd.phoneBreakdown   || [],
        }
      })
    }

    // Dedicated account-wide reports: every (campaign, ad group, conversion
    // action) combination that has at least one conversion, split into
    // form-type vs phone/call-type by the same action-name matching used for
    // the Form/Call Conv. drill-downs elsewhere — this is the flat, full-page
    // version of that same breakdown, one row per combination instead of
    // nested behind a chevron.
    case 'formConversions':
    case 'phoneCallConversions': {
      const wantPhone = reportType === 'phoneCallConversions'
      const AG_STATUS_LBL = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }
      const [rows, convActionMap] = await Promise.all([
        customer.query(`
          SELECT campaign.name, campaign.status, ad_group.name, ad_group.status,
            segments.conversion_action_name, metrics.conversions, metrics.all_conversions
          FROM ad_group
          WHERE ${dateClause} AND metrics.all_conversions > 0
        `).catch(() => []),
        fetchConversionActionCategoryMap(customer),
      ])

      const agg = {}
      for (const r of rows) {
        const name = r.segments?.conversion_action_name ?? r.segments?.conversionActionName ?? ''
        const info = convActionMap.get(name)
        const isPhone = isPhoneConversionAction(info)
        if (isPhone !== wantPhone) continue
        const label = name || '(Unnamed conversion action)'
        const campaign = r.campaign?.name || '—'
        const adGroup  = r.ad_group?.name || '—'
        const key = `${campaign}|${adGroup}|${label}`
        if (!agg[key]) {
          agg[key] = {
            campaign, adGroup, conversionAction: label,
            campaignStatus: AG_STATUS_LBL[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status),
            adGroupStatus:  AG_STATUS_LBL[enumStr(r.ad_group?.status)] || enumStr(r.ad_group?.status),
            conversions: 0,
          }
        }
        // Phone actions: metrics.conversions lags behind call-duration
        // verification, sometimes by days — all_conversions already reflects
        // Google's own Conversion actions summary count for these.
        agg[key].conversions += isPhone ? n(r.metrics?.all_conversions ?? 0) : n(r.metrics?.conversions ?? 0)
      }
      // The WHERE floor is metrics.all_conversions > 0 (to catch pending
      // phone conversions) — for the Form Conversions view that also lets
      // through rows whose metrics.conversions is still 0, so filter those.
      return Object.values(agg).filter(a => a.conversions > 0).sort((a, b) => b.conversions - a.conversions)
    }

    case 'networks': {
      // All networks shown in Google Ads UI — predefined so rows appear even when value is 0
      const NETWORK_ORDER = [
        'Google Search',
        'Search Partners',
        'Google Display Network',
        'Cross-network',
        'YouTube',
        'Google TV',
        'Google Owned Channels',
        'Google Mail',
      ]
      const zero = () => ({ impressions:0, clicks:0, cost:0, conversions:0, convValue:0 })
      const agg = {}
      for (const lbl of NETWORK_ORDER) agg[lbl] = { network:lbl, label:lbl, ...zero() }

      const rows = await customer.query(`
        SELECT
          campaign.name,
          segments.ad_network_type,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.average_cpc
        FROM keyword_view
        WHERE ${dateClause} AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
      `).catch(err => { console.error('[networks] query error:', err?.message || err); return [] })

      console.log(`[networks] rows returned: ${rows.length} | dateClause: ${dateClause}`)
      if (rows.length > 0) {
        const s = rows[0]
        const rawNet = s.segments?.ad_network_type ?? s.segments?.adNetworkType
        console.log('[networks] sample row — campaign:', s.campaign?.name,
          '| raw network:', rawNet,
          '| impressions:', s.metrics?.impressions,
          '| clicks:', s.metrics?.clicks,
          '| cost_micros:', s.metrics?.cost_micros)
      }

      for (const r of rows) {
        // Try both snake_case and camelCase variants the library may return
        const rawKey = r.segments?.ad_network_type ?? r.segments?.adNetworkType
        const key = enumStr(rawKey)
        const lbl = NETWORK_LABELS[key] || key || 'Unknown'
        if (!agg[lbl]) agg[lbl] = { network:lbl, label:lbl, ...zero() }
        agg[lbl].impressions  += n(r.metrics?.impressions       ?? 0)
        agg[lbl].clicks       += n(r.metrics?.clicks            ?? 0)
        agg[lbl].cost         += n(r.metrics?.cost_micros       ?? 0) / 1e6
        agg[lbl].conversions  += n(r.metrics?.conversions       ?? 0)
        agg[lbl].convValue    += n(r.metrics?.conversions_value ?? 0)
      }

      console.log('[networks] aggregated buckets:', Object.fromEntries(
        Object.entries(agg).filter(([,v]) => v.impressions > 0 || v.clicks > 0)
          .map(([k,v]) => [k, { impr: v.impressions, clicks: v.clicks, cost: v.cost.toFixed(2) }])
      ))

      // Return in Google Ads UI order; append any extra networks returned by the API
      const ordered = NETWORK_ORDER.map(lbl => agg[lbl])
      const extras  = Object.values(agg).filter(v => !NETWORK_ORDER.includes(v.label) && !['Unknown','Other'].includes(v.label))
      return [...ordered, ...extras].map(v => ({
        ...v,
        ctr:               v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
        cpc:               v.clicks > 0      ? v.cost / v.clicks                : 0,
        costPerConversion: v.conversions > 0  ? v.cost / v.conversions           : 0,
        roas:              v.cost > 0         ? v.convValue / v.cost             : 0,
      }))
    }

    case 'devices': {
      // All devices predefined so rows appear even when value is 0
      const DEVICE_ORDER = ['Mobile', 'Desktop', 'Tablet', 'TV Screen', 'Other']
      const dzero = () => ({ impressions:0, clicks:0, cost:0, conversions:0, convValue:0 })
      const dagg = {}
      for (const lbl of DEVICE_ORDER) dagg[lbl] = { device:lbl, label:lbl, ...dzero() }

      const rows = await customer.query(`
        SELECT
          campaign.name,
          segments.device,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.average_cpc,
          metrics.cost_micros,
          metrics.conversions,
          metrics.cost_per_conversion,
          metrics.conversions_value
        FROM campaign
        WHERE ${dateClause} AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
      `).catch(() => [])

      for (const r of rows) {
        const key = enumStr(segVal(r, 'device'))
        const lbl = DEVICE_LABELS[key] || key || 'Unknown'
        if (!dagg[lbl]) dagg[lbl] = { device:lbl, label:lbl, ...dzero() }
        dagg[lbl].impressions += n(r.metrics?.impressions       ?? 0)
        dagg[lbl].clicks      += n(r.metrics?.clicks            ?? 0)
        dagg[lbl].cost        += n(r.metrics?.cost_micros       ?? 0) / 1e6
        dagg[lbl].conversions += n(r.metrics?.conversions       ?? 0)
        dagg[lbl].convValue   += n(r.metrics?.conversions_value ?? 0)
      }

      const dOrdered = DEVICE_ORDER.map(lbl => dagg[lbl])
      const dExtras  = Object.values(dagg).filter(v => !DEVICE_ORDER.includes(v.label) && v.label !== 'Unknown')
      return [...dOrdered, ...dExtras].map(v => ({
        ...v,
        ctr:               v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
        cpc:               v.clicks > 0      ? v.cost / v.clicks                : 0,
        costPerConversion: v.conversions > 0  ? v.cost / v.conversions           : 0,
      }))
    }

    case 'clickTypes': {
      const rows = await customer.query(`
        SELECT
          campaign.id,
          campaign.name,
          segments.click_type,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.average_cpc,
          metrics.cost_micros,
          metrics.conversions,
          metrics.cost_per_conversion
        FROM campaign
        WHERE ${dateClause} AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
      `).catch(err => { console.error('[clickTypes] query error:', err?.message || err); return [] })

      if (rows.length > 0) {
        const sample = rows[0]
        const rawCT = sample.segments?.click_type ?? sample.segments?.clickType
        console.log('[clickTypes] rows:', rows.length, '| sample raw click_type:', JSON.stringify(rawCT), '| enumStr:', enumStr(rawCT))
      }

      const agg = {}
      for (const r of rows) {
        const rawCT = r.segments?.click_type ?? r.segments?.clickType
        const key = enumStr(rawCT)
        const lbl = CLICK_LABELS[key] || key || 'Unknown'
        if (!agg[lbl]) agg[lbl] = { clickType:lbl, label:lbl, impressions:0, clicks:0, cost:0, conversions:0 }
        agg[lbl].impressions += n(r.metrics?.impressions ?? 0)
        agg[lbl].clicks      += n(r.metrics?.clicks      ?? 0)
        agg[lbl].cost        += n(r.metrics?.cost_micros ?? 0) / 1e6
        agg[lbl].conversions += n(r.metrics?.conversions ?? 0)
      }
      return Object.values(agg).map(v => ({
        ...v,
        ctr:               v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
        cpc:               v.clicks > 0      ? v.cost / v.clicks                : 0,
        costPerConversion: v.conversions > 0  ? v.cost / v.conversions           : 0,
      })).filter(v => !['Unknown','Other'].includes(v.label)).sort((a,b) => b.cost - a.cost)
    }

    case 'adSlots': {
      const rows = await customer.query(`
        SELECT segments.slot, metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.ctr, metrics.average_cpc, metrics.conversions
        FROM campaign
        WHERE ${dateClause} AND campaign.status != 'REMOVED'
      `).catch(() => [])
      const agg = {}
      for (const r of rows) {
        const key = enumStr(segVal(r, 'slot'))
        const lbl = SLOT_LABELS[key] || key || 'Unknown'
        if (!agg[lbl]) agg[lbl] = { slot: lbl, label: lbl, impressions:0, clicks:0, cost:0, conversions:0 }
        agg[lbl].impressions += n(r.metrics?.impressions ?? 0)
        agg[lbl].clicks      += n(r.metrics?.clicks      ?? 0)
        agg[lbl].cost        += n(r.metrics?.cost_micros ?? 0) / 1e6
        agg[lbl].conversions += n(r.metrics?.conversions ?? 0)
      }
      return Object.values(agg).map(v => ({
        ...v, ctr: v.impressions > 0 ? (v.clicks/v.impressions)*100 : 0,
        cpc: v.clicks > 0 ? v.cost/v.clicks : 0,
      })).filter(v => !['Unknown','Other'].includes(v.label)).sort((a,b) => b.impressions - a.impressions)
    }

    case 'summary':
      return fetchDashboardData({ api, credentials }, customerId, mccCustomerId, dateRange)

    case 'keywords': {
      const STATUS_MAP_KW = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }
      const resolveKwStatusLabel = raw => { const s = enumStr(raw); return STATUS_MAP_KW[s] || STATUS_MAP_KW[s.toUpperCase()] || s }
      const kwDateClause = buildDateClause(dateRange, timeZone)

      const [rows, phoneRows, convActionMap] = await Promise.all([
        customer.query(`
          SELECT ad_group_criterion.resource_name,
            ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
            ad_group_criterion.quality_info.quality_score, ad_group_criterion.status,
            campaign.name, campaign.status, ad_group.name, ad_group.status,
            metrics.impressions, metrics.clicks, metrics.cost_micros,
            metrics.conversions, metrics.phone_calls
          FROM keyword_view
          WHERE ${kwDateClause}
            AND ad_group_criterion.negative = false
            AND ad_group_criterion.status != 'REMOVED'
            AND campaign.status != 'REMOVED'
            AND ad_group.status != 'REMOVED'
        `).catch(() => []),
        customer.query(`
          SELECT ad_group_criterion.resource_name,
            segments.conversion_action_name, metrics.conversions, metrics.all_conversions
          FROM keyword_view
          WHERE ${kwDateClause}
            AND ad_group_criterion.negative = false
            AND campaign.status != 'REMOVED'
            AND metrics.all_conversions > 0
        `).catch(() => []),
        fetchConversionActionCategoryMap(customer),
      ])

      // Build phone/form conversion lookup by resource_name using action name
      // matching, keeping the per-action-name breakdown for the Form/Call
      // Conv. drill-down. No per-keyword Call Leads breakdown is possible —
      // call_view has no keyword dimension in the Google Ads API. Phone
      // actions use metrics.all_conversions — metrics.conversions for calls
      // lags behind duration verification and can read 0 for days even
      // though Google Ads' own summary already shows the count.
      const convNameMap = {}
      for (const r of phoneRows) {
        const key  = r.ad_group_criterion?.resource_name || ''
        const name = r.segments?.conversion_action_name ?? r.segments?.conversionActionName ?? ''
        const isPhoneRow = isPhoneConversionAction(convActionMap.get(name))
        const c    = isPhoneRow ? n(r.metrics?.all_conversions ?? 0) : n(r.metrics?.conversions ?? 0)
        if (!key) continue
        if (!convNameMap[key]) convNameMap[key] = { phone: 0, form: 0, phoneBreakdown: {}, formBreakdown: {} }
        const label = name || '(Unnamed conversion action)'
        if (isPhoneRow) {
          convNameMap[key].phone += c
          convNameMap[key].phoneBreakdown[label] = (convNameMap[key].phoneBreakdown[label] || 0) + c
        } else {
          convNameMap[key].form += c
          convNameMap[key].formBreakdown[label] = (convNameMap[key].formBreakdown[label] || 0) + c
        }
      }
      const toBreakdownListKw = obj => Object.entries(obj)
        .filter(([, conversions]) => conversions > 0)
        .map(([name, conversions]) => ({ name, conversions }))
        .sort((a, b) => b.conversions - a.conversions)

      console.log('[keywords] raw rows from keyword_view:', rows.length)

      const kwMap = new Map()
      for (const r of rows) {
        const id = r.ad_group_criterion?.resource_name || ''
        if (!id) continue
        if (!kwMap.has(id)) {
          const cv = convNameMap[id] || { phone: 0, form: 0, phoneBreakdown: {}, formBreakdown: {} }
          kwMap.set(id, {
            resourceName:     id,
            text:             r.ad_group_criterion?.keyword?.text || '—',
            matchType:        resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
            qualityScore:     n(r.ad_group_criterion?.quality_info?.quality_score ?? 0),
            status:           resolveKwStatusLabel(r.ad_group_criterion?.status),
            campaign:         r.campaign?.name  || '—',
            campaignStatus:   resolveKwStatusLabel(r.campaign?.status),
            adGroup:          r.ad_group?.name  || '—',
            adGroupStatus:    resolveKwStatusLabel(r.ad_group?.status),
            impressions: 0, clicks: 0, cost: 0, conversions: 0, phoneCalls: 0,
            phoneConversions: cv.phone,
            formConversions:  cv.form,
            phoneBreakdown:   toBreakdownListKw(cv.phoneBreakdown),
            formBreakdown:    toBreakdownListKw(cv.formBreakdown),
          })
        }
        const kw = kwMap.get(id)
        kw.impressions += n(r.metrics?.impressions  ?? 0)
        kw.clicks      += n(r.metrics?.clicks       ?? 0)
        kw.cost        += n(r.metrics?.cost_micros  ?? 0) / 1e6
        kw.conversions += n(r.metrics?.conversions  ?? 0)
        kw.phoneCalls  += n(r.metrics?.phone_calls  ?? 0)
        const qs = n(r.ad_group_criterion?.quality_info?.quality_score ?? 0)
        if (qs > kw.qualityScore) kw.qualityScore = qs
      }

      console.log('[keywords] unique resource_names (kwMap size):', kwMap.size)
      return Array.from(kwMap.values())
        .map(kw => ({
          ...kw,
          // See fetchTopConvertingAds — raw metrics.conversions can under-report
          // while a phone conversion awaits Google's duration verification.
          conversions: Math.max(kw.conversions, kw.phoneConversions + kw.formConversions),
          cpc: kw.clicks > 0      ? kw.cost / kw.clicks             : 0,
          ctr: kw.impressions > 0 ? (kw.clicks / kw.impressions)*100 : 0,
        }))
        .sort((a, b) => b.impressions - a.impressions)
    }

    case 'adsPerformance':
      return fetchTopConvertingAds({ api, credentials }, customerId, mccCustomerId, dateRange)

    case 'negativeKeywords':
      return fetchNegativeData({ api, credentials }, customerId, mccCustomerId, dateRange)

    case 'callLeads':
      return fetchCallLeads({ api, credentials }, customerId, mccCustomerId, dateRange)

    default:
      throw new Error(`Unknown report type: ${reportType}`)
  }
}

// ── Keywords with call conversion counts ─────────────────────────────────────

async function fetchKeywordsWithCalls({ api, credentials }, customerId, mccCustomerId, dateRange, timeZone) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange, timeZone)

  const convActionMapPromise = fetchConversionActionCategoryMap(customer)

  const [keywordsResult, convNameResult] = await Promise.allSettled([
    // Query 1: Keywords with metrics
    customer.query(`
      SELECT
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.status,
        campaign.id, campaign.name,
        ad_group.id, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.all_conversions,
        metrics.average_cpc, metrics.ctr,
        metrics.phone_calls, metrics.phone_impressions,
        metrics.conversions_from_interactions_rate
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND ${dateClause}
      ORDER BY metrics.impressions DESC
      LIMIT 200
    `),

    // Query 2: All conversions by action name — classify phone vs form by name matching
    customer.query(`
      SELECT
        ad_group_criterion.keyword.text,
        campaign.id, ad_group.id,
        segments.conversion_action_name,
        metrics.conversions, metrics.all_conversions
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND ${dateClause}
        AND metrics.all_conversions > 0
    `),
  ])

  const keywordRows  = keywordsResult.status === 'fulfilled' ? keywordsResult.value : []
  const convRows     = convNameResult.status  === 'fulfilled' ? convNameResult.value : []
  const convActionMap = await convActionMapPromise

  // Build phone/form lookup by "campaignId|adGroupId|text" using action name
  // matching, keeping the per-action-name breakdown (not just the phone/form
  // sums) for the Form/Call Conv. drill-down. No per-keyword Call Leads
  // breakdown is possible — call_view has no keyword dimension in the Google
  // Ads API, so a call can't be attributed to the specific keyword that
  // triggered it, only to the campaign/ad group.
  const convByKw = {}
  for (const row of convRows) {
    const key  = `${row.campaign?.id}|${row.ad_group?.id}|${(row.ad_group_criterion?.keyword?.text || '')}`
    const name = row.segments?.conversion_action_name ?? row.segments?.conversionActionName ?? ''
    const isPhoneRow = isPhoneConversionAction(convActionMap.get(name))
    // Phone actions: metrics.conversions lags behind call-duration
    // verification, sometimes reading 0 for days — all_conversions already
    // reflects Google's own Conversion actions summary count.
    const c = isPhoneRow ? n(row.metrics?.all_conversions ?? 0) : n(row.metrics?.conversions ?? 0)
    if (!convByKw[key]) convByKw[key] = { phone: 0, form: 0, phoneBreakdown: {}, formBreakdown: {} }
    const label = name || '(Unnamed conversion action)'
    if (isPhoneRow) {
      convByKw[key].phone += c
      convByKw[key].phoneBreakdown[label] = (convByKw[key].phoneBreakdown[label] || 0) + c
    } else {
      convByKw[key].form += c
      convByKw[key].formBreakdown[label] = (convByKw[key].formBreakdown[label] || 0) + c
    }
  }
  const toBreakdownList = obj => Object.entries(obj)
    .filter(([, conversions]) => conversions > 0)
    .map(([name, conversions]) => ({ name, conversions }))
    .sort((a, b) => b.conversions - a.conversions)

  return keywordRows.map(row => {
    const text       = row.ad_group_criterion?.keyword?.text ?? ''
    const campaignId = String(row.campaign?.id ?? '')
    const adGroupId  = String(row.ad_group?.id ?? '')
    const lookupKey  = `${campaignId}|${adGroupId}|${text}`
    const cv         = convByKw[lookupKey] || { phone: 0, form: 0, phoneBreakdown: {}, formBreakdown: {} }

    return {
      text,
      matchType:        resolveMatchType(row.ad_group_criterion?.keyword?.match_type),
      qualityScore:     n(row.ad_group_criterion?.quality_info?.quality_score ?? 0),
      status:           STATUS_MAP[enumStr(row.ad_group_criterion?.status)] || enumStr(row.ad_group_criterion?.status),
      campaignId,
      campaign:         row.campaign?.name ?? '—',
      adGroupId,
      adGroup:          row.ad_group?.name ?? '—',
      impressions:      n(row.metrics?.impressions  ?? 0),
      clicks:           n(row.metrics?.clicks       ?? 0),
      cost:             n(row.metrics?.cost_micros  ?? 0) / 1e6,
      // See fetchTopConvertingAds — raw metrics.conversions can under-report
      // while a phone conversion awaits Google's duration verification.
      conversions:      Math.max(n(row.metrics?.conversions ?? 0), cv.phone + cv.form),
      cpc:              n(row.metrics?.average_cpc  ?? 0) / 1e6,
      ctr:              n(row.metrics?.ctr          ?? 0) * 100,
      convRate:         n(row.metrics?.conversions_from_interactions_rate ?? 0) * 100,
      phoneCalls:       n(row.metrics?.phone_calls  ?? 0),
      phoneConversions: cv.phone,
      formConversions:  cv.form,
      phoneBreakdown:   toBreakdownList(cv.phoneBreakdown),
      formBreakdown:    toBreakdownList(cv.formBreakdown),
    }
  })
}

// ── RSA Builder ───────────────────────────────────────────────────────────────

async function fetchRSACampaigns({ api, credentials }, customerId, mccCustomerId, hidePaused = false) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const rows = await customer.query(`
    SELECT campaign.id, campaign.name, campaign.status,
      campaign.advertising_channel_type, campaign.bidding_strategy_type,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    ${hidePaused ? "AND campaign.status = 'ENABLED'" : ''}
    ORDER BY campaign.name
  `).catch(() => [])
  return rows.map(r => ({
    id:              String(r.campaign?.id ?? ''),
    name:            r.campaign?.name ?? '',
    status:          STATUS_MAP[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status),
    channelType:     enumStr(r.campaign?.advertising_channel_type),
    biddingStrategy: enumStr(r.campaign?.bidding_strategy_type),
    budgetMicros:    n(r.campaign_budget?.amount_micros ?? 0),
  }))
}

async function fetchRSAAdGroups({ api, credentials }, customerId, mccCustomerId, campaignId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  // Includes Paused ad groups (only Removed is excluded) — these AI Builder
  // pages are workbenches for auditing/building assets on a specific ad
  // group, paused ones included, not a live-traffic-only report.
  const rows = await customer.query(`
    SELECT ad_group.id, ad_group.name, ad_group.status
    FROM ad_group
    WHERE campaign.id = ${campaignId}
      AND ad_group.status != 'REMOVED'
    ORDER BY ad_group.name
  `).catch(() => [])
  return rows.map(r => ({
    id:     String(r.ad_group?.id ?? ''),
    name:   r.ad_group?.name ?? '',
    status: STATUS_MAP[enumStr(r.ad_group?.status)] || enumStr(r.ad_group?.status),
  }))
}

const AD_STRENGTH_LBL = {
  EXCELLENT:'Excellent', GOOD:'Good', AVERAGE:'Average', POOR:'Poor',
  PENDING:'Pending', NO_ADS:'No Ads', UNKNOWN:'Unknown', UNSPECIFIED:'Unspecified',
  '0':'Unspecified', '1':'Unknown', '2':'Pending', '3':'No Ads',
  '4':'Poor', '5':'Average', '6':'Good', '7':'Excellent',
}
// QualityScoreBucket enum (confirmed against node_modules/google-ads-api's
// autogen enums.d.ts): UNSPECIFIED=0, UNKNOWN=1, BELOW_AVERAGE=2, AVERAGE=3,
// ABOVE_AVERAGE=4 — this client library returns these sub-fields as raw
// numbers (not decoded string names), so the numeric keys below are what
// actually get looked up. A previous version of this map was off by one
// (treated 3 as ABOVE_AVERAGE), which silently mislabeled every AVERAGE
// rating as Above Average and left real ABOVE_AVERAGE (4) unmapped —
// caught live via a Quality Score analysis feature that surfaces these
// labels directly to an AI prompt, where a wrong label would misdirect the
// whole analysis.
const QS_RATING_LBL = {
  ABOVE_AVERAGE:'Above Average', AVERAGE:'Average', BELOW_AVERAGE:'Below Average',
  UNKNOWN:'Unknown', UNSPECIFIED:'Unknown',
  '0':'Unknown', '1':'Unknown', '2':'Below Average', '3':'Average', '4':'Above Average',
}

async function fetchRSABuilderData({ api, credentials }, customerId, mccCustomerId, adGroupId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const today = new Date()
  const fmt   = d => d.toISOString().split('T')[0]
  const ago   = days => { const d = new Date(today); d.setDate(d.getDate() - days); return d }
  const date30 = `segments.date BETWEEN '${fmt(ago(30))}' AND '${fmt(today)}'`
  const date90 = `segments.date BETWEEN '${fmt(ago(90))}' AND '${fmt(today)}'`

  console.log(`[fetchRSABuilderData] adGroupId=${adGroupId}`)

  const [rsaRows, kwRows, stRows] = await Promise.all([
    customer.query(`
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1,
        ad_group_ad.ad.responsive_search_ad.path2,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad_strength,
        ad_group_ad.action_items,
        ad_group_ad.status,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.ctr
      FROM ad_group_ad
      WHERE ad_group.id = ${adGroupId}
        AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
        AND ad_group_ad.status != 'REMOVED'
        AND ${date30}
    `).catch(() => []),

    // keyword_view supports performance metrics + date filter + ad group filter
    // (ad_group_criterion alone cannot combine metrics with segments.date)
    customer.query(`
      SELECT
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.status, ad_group_criterion.resource_name,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.ctr
      FROM keyword_view
      WHERE ad_group.id = ${adGroupId}
        AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.negative = FALSE
        AND ad_group_criterion.status != 'REMOVED'
        AND ${date30}
      ORDER BY metrics.impressions DESC
      LIMIT 50
    `).catch(() => customer.query(`
      SELECT
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.status, ad_group_criterion.resource_name,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.ctr
      FROM keyword_view
      WHERE ad_group.id = ${adGroupId}
        AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.negative = FALSE
        AND ad_group_criterion.status != 'REMOVED'
        AND ${date90}
      ORDER BY metrics.impressions DESC
      LIMIT 50
    `).catch(e => { console.error('[fetchRSABuilderData] keyword query error:', e?.message || e); return [] })),

    customer.query(`
      SELECT
        search_term_view.search_term, search_term_view.status,
        segments.keyword.info.text,
        segments.keyword.info.match_type,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.ctr
      FROM search_term_view
      WHERE ad_group.id = ${adGroupId}
        AND ${date90}
        AND metrics.impressions > 0
      ORDER BY metrics.conversions DESC, metrics.cost_micros DESC
      LIMIT 300
    `).catch(() => []),
  ])

  console.log(`[fetchRSABuilderData] rsaRows=${rsaRows.length}, kwRows=${kwRows.length}, stRows=${stRows.length}`)
  if (kwRows.length > 0) {
    console.log(`[fetchRSABuilderData] first kwRow sample:`, JSON.stringify(kwRows[0]))
  } else {
    console.log(`[fetchRSABuilderData] keyword query returned 0 rows`)
  }

  const rsaAds = rsaRows.map(r => {
    const rsa = r.ad_group_ad?.ad?.responsive_search_ad
    const headlines    = (rsa?.headlines    || []).map(h => ({ text: h.text || '', pinned: h.pinned_field ? enumStr(h.pinned_field) : null }))
    const descriptions = (rsa?.descriptions || []).map(d => ({ text: d.text || '', pinned: d.pinned_field ? enumStr(d.pinned_field) : null }))
    const sRaw = enumStr(r.ad_group_ad?.ad_strength)
    return {
      adId:         String(r.ad_group_ad?.ad?.id ?? ''),
      status:       ({ ENABLED:'ENABLED', PAUSED:'PAUSED', REMOVED:'REMOVED', '2':'ENABLED', '3':'PAUSED', '4':'REMOVED' })[enumStr(r.ad_group_ad?.status)] || enumStr(r.ad_group_ad?.status),
      adStrength:   AD_STRENGTH_LBL[sRaw] || sRaw || 'Unknown',
      // Google's own plain-English reasons this ad isn't rated higher (e.g.
      // "Try including more keywords in your headlines.") — real diagnostic
      // output from Google's actual classifier, not this app's approximation
      // of it. Confirmed live to return human-readable strings directly,
      // not just the ADD_ASSET enum the client library's type defs suggest.
      actionItems:  r.ad_group_ad?.action_items || [],
      headlines,
      descriptions,
      path1:        rsa?.path1 || '',
      path2:        rsa?.path2 || '',
      finalUrls:    r.ad_group_ad?.ad?.final_urls || [],
      impressions:  n(r.metrics?.impressions ?? 0),
      clicks:       n(r.metrics?.clicks ?? 0),
      cost:         n(r.metrics?.cost_micros ?? 0) / 1e6,
      conversions:  n(r.metrics?.conversions ?? 0),
      ctr:          n(r.metrics?.ctr ?? 0) * 100,
    }
  })

  const keywords = kwRows.map(r => ({
    resourceName:   r.ad_group_criterion?.resource_name || '',
    text:           r.ad_group_criterion?.keyword?.text || '',
    matchType:      resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
    qualityScore:   n(r.ad_group_criterion?.quality_info?.quality_score ?? 0),
    expectedCtr:    QS_RATING_LBL[enumStr(r.ad_group_criterion?.quality_info?.search_predicted_ctr)] || 'Unknown',
    adRelevance:    QS_RATING_LBL[enumStr(r.ad_group_criterion?.quality_info?.creative_quality_score)] || 'Unknown',
    landingPageExp: QS_RATING_LBL[enumStr(r.ad_group_criterion?.quality_info?.post_click_quality_score)] || 'Unknown',
    status:         enumStr(r.ad_group_criterion?.status),
    impressions:    n(r.metrics?.impressions ?? 0),
    clicks:         n(r.metrics?.clicks ?? 0),
    cost:           n(r.metrics?.cost_micros ?? 0) / 1e6,
    conversions:    n(r.metrics?.conversions ?? 0),
    ctr:            n(r.metrics?.ctr ?? 0) * 100,
  }))

  const searchTerms = stRows.map(r => ({
    term:             r.search_term_view?.search_term || '',
    status:           enumStr(r.search_term_view?.status),
    triggeredKeyword: r.segments?.keyword?.info?.text || '',
    matchType:        resolveMatchType(r.segments?.keyword?.info?.match_type),
    impressions:      n(r.metrics?.impressions ?? 0),
    clicks:           n(r.metrics?.clicks ?? 0),
    cost:             n(r.metrics?.cost_micros ?? 0) / 1e6,
    conversions:      n(r.metrics?.conversions ?? 0),
    ctr:              n(r.metrics?.ctr ?? 0) * 100,
  }))

  return { rsaAds, keywords, searchTerms }
}

// Powers the RSA Reports tab — deliberately NOT built on fetchRSABuilderData
// above: that function's ad/keyword queries filter on a trailing 30/90-day
// traffic window, which silently drops a genuinely ENABLED ad or keyword
// that just hasn't had recent impressions (a new ad group, a seasonal one,
// etc.) — wrong for a "currently active" report. This queries status
// directly instead, and in ONE pair of queries scoped to the whole campaign
// (or a single ad group) rather than looping fetchRSABuilderData per ad
// group — important after burning through the account's API quota during a
// heavy testing day; an N-ad-group campaign would otherwise cost 2N calls.
async function fetchRSAReportData({ api, credentials }, customerId, mccCustomerId, { campaignId, adGroupId } = {}) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  if (!campaignId && !adGroupId) throw new Error('fetchRSAReportData requires campaignId or adGroupId')
  const scopeClause = adGroupId ? `AND ad_group.id = ${adGroupId}` : `AND campaign.id = ${campaignId}`

  const [adRows, kwRows] = await Promise.all([
    customer.query(`
      SELECT
        campaign.id, campaign.name, campaign.status,
        ad_group.id, ad_group.name, ad_group.status,
        ad_group_ad.ad.id,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1,
        ad_group_ad.ad.responsive_search_ad.path2,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad_strength,
        ad_group_ad.status
      FROM ad_group_ad
      WHERE ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
        AND ad_group_ad.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        ${scopeClause}
      ORDER BY ad_group.name
    `).catch(() => []),

    customer.query(`
      SELECT ad_group.id, ad_group_criterion.keyword.text
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.negative = FALSE
        AND ad_group_criterion.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        ${scopeClause}
    `).catch(() => []),
  ])

  const kwByAdGroup = {}
  for (const r of kwRows) {
    const agId = String(r.ad_group?.id ?? '')
    if (!kwByAdGroup[agId]) kwByAdGroup[agId] = []
    const text = r.ad_group_criterion?.keyword?.text
    if (text) kwByAdGroup[agId].push({ text })
  }

  let campaignName = '', campaignStatus = ''
  const adGroupsById = {}
  for (const r of adRows) {
    const agId = String(r.ad_group?.id ?? '')
    campaignName   = r.campaign?.name ?? campaignName
    campaignStatus = STATUS_MAP[enumStr(r.campaign?.status)] || campaignStatus
    if (!adGroupsById[agId]) {
      adGroupsById[agId] = {
        id:       agId,
        name:     r.ad_group?.name ?? '',
        status:   STATUS_MAP[enumStr(r.ad_group?.status)] || enumStr(r.ad_group?.status),
        keywords: kwByAdGroup[agId] || [],
        ads:      [],
      }
    }
    const rsa = r.ad_group_ad?.ad?.responsive_search_ad
    const sRaw = enumStr(r.ad_group_ad?.ad_strength)
    adGroupsById[agId].ads.push({
      adId:         String(r.ad_group_ad?.ad?.id ?? ''),
      status:       STATUS_MAP[enumStr(r.ad_group_ad?.status)] || enumStr(r.ad_group_ad?.status),
      adStrength:   AD_STRENGTH_LBL[sRaw] || sRaw || 'Unknown',
      headlines:    (rsa?.headlines    || []).map(h => ({ text: h.text || '', pinned: h.pinned_field ? enumStr(h.pinned_field) : null })),
      descriptions: (rsa?.descriptions || []).map(d => ({ text: d.text || '', pinned: d.pinned_field ? enumStr(d.pinned_field) : null })),
      path1:        rsa?.path1 || '',
      path2:        rsa?.path2 || '',
      finalUrls:    r.ad_group_ad?.ad?.final_urls || [],
    })
  }

  // An ad group can have zero ENABLED keywords but still have ENABLED ads
  // (e.g. all keywords paused) — adRows alone won't have produced an entry
  // for it in that case if it ALSO has zero ads, which is fine (nothing to
  // report), but if it has ads and just no matching kwRows entry, the
  // adRows loop above already created it with keywords: [].
  const adGroups = Object.values(adGroupsById).sort((a, b) => a.name.localeCompare(b.name))

  return { campaignName, campaignStatus, adGroups }
}

// ── Search Terms ──────────────────────────────────────────────────────────────

async function fetchSearchTerms({ api, credentials }, customerId, mccCustomerId, dateRange, timeZone) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange, timeZone)

  const ST_STATUS = {
    ADDED:'Added', EXCLUDED:'Excluded', ADDED_EXCLUDED:'Added Excluded',
    NEAR:'Near', UNKNOWN:'Unknown', UNSPECIFIED:'Unknown',
    '2':'Added', '3':'Excluded', '4':'Added Excluded', '5':'Near',
  }
  const CAMP_STS = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }

  const coreRows = await customer.query(`
    SELECT
      search_term_view.search_term,
      search_term_view.status,
      search_term_view.resource_name,
      campaign.id,
      campaign.name,
      campaign.status,
      ad_group.id,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.all_conversions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate,
      metrics.cost_per_conversion
    FROM search_term_view
    WHERE ${dateClause}
    ORDER BY metrics.cost_micros DESC
  `)
  console.log('[searchTerms] core rows:', coreRows.length)

  const kwRows = await customer.query(`
    SELECT
      search_term_view.resource_name,
      segments.keyword.info.text,
      segments.keyword.info.match_type
    FROM search_term_view
    WHERE ${dateClause}
  `).catch(err => {
    console.warn('[searchTerms] keyword segment query failed:', err?.message)
    return []
  })
  console.log('[searchTerms] keyword segment rows:', kwRows.length)

  const kwMap = new Map()
  for (const r of kwRows) {
    const rn = r.search_term_view?.resource_name
    if (!rn) continue
    const info = r.segments?.keyword?.info ?? {}
    const text = info.text ?? ''
    const mt   = info.match_type ?? info.matchType ?? ''
    if (text || mt) kwMap.set(rn, { text, matchType: mt })
  }

  return coreRows.map(row => {
    const stSts = enumStr(row.search_term_view?.status)
    const rn    = row.search_term_view?.resource_name ?? ''
    const kw    = kwMap.get(rn) ?? {}
    return {
      searchTerm:        row.search_term_view?.search_term ?? '',
      searchTermStatus:  ST_STATUS[stSts] ?? stSts ?? 'Unknown',
      triggeredKeyword:  kw.text || '—',
      matchType:         resolveMatchType(kw.matchType) || '—',
      campaignId:        String(row.campaign?.id ?? ''),
      campaignName:      row.campaign?.name ?? '',
      campaignStatus:    CAMP_STS[enumStr(row.campaign?.status)] ?? enumStr(row.campaign?.status),
      adGroupId:         String(row.ad_group?.id ?? ''),
      adGroupName:       row.ad_group?.name ?? '',
      impressions:       n(row.metrics?.impressions ?? 0),
      clicks:            n(row.metrics?.clicks ?? 0),
      cost:              n(row.metrics?.cost_micros ?? 0) / 1_000_000,
      conversions:       n(row.metrics?.conversions ?? 0),
      phoneCalls:        0,
      ctr:               n(row.metrics?.ctr ?? 0) * 100,
      avgCpc:            n(row.metrics?.average_cpc ?? 0) / 1_000_000,
      convRate:          n(row.metrics?.conversions_from_interactions_rate ?? 0) * 100,
      costPerConversion: n(row.metrics?.cost_per_conversion ?? 0) / 1_000_000,
    }
  })
}

// ── Account structure data for AI review ─────────────────────────────────────

async function fetchAccountStructureData({ api, credentials }, customerId, mccCustomerId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)

  const CH_TYPE = {
    SEARCH:'Search', DISPLAY:'Display', SHOPPING:'Shopping', VIDEO:'Video',
    MULTI_CHANNEL:'Performance Max', PERFORMANCE_MAX:'Performance Max',
    DISCOVERY:'Demand Gen', DEMAND_GEN:'Demand Gen', SMART:'Smart',
    '2':'Search', '3':'Display', '4':'Shopping', '5':'Video',
    '6':'Performance Max', '9':'Performance Max', '11':'Demand Gen', '13':'Demand Gen', '16':'Demand Gen',
  }
  const ST  = { ENABLED:'Enabled', PAUSED:'Paused', '2':'Enabled', '3':'Paused' }
  const BID = {
    TARGET_CPA:'Target CPA', TARGET_ROAS:'Target ROAS',
    MAXIMIZE_CONVERSIONS:'Max Conversions', MAXIMIZE_CONVERSION_VALUE:'Max Conv. Value',
    TARGET_IMPRESSION_SHARE:'Target IS', ENHANCED_CPC:'Enhanced CPC',
    MANUAL_CPC:'Manual CPC', MAXIMIZE_CLICKS:'Max Clicks', TARGET_CPM:'Target CPM',
    '2':'Manual CPC', '3':'Enhanced CPC', '4':'Target CPA', '5':'Target ROAS',
    '6':'Max Clicks', '7':'Target IS', '8':'Max Conversions', '9':'Max Conv. Value',
  }
  // conversion_action.type / .category come back as raw numeric codes from
  // this API version rather than string enum names — resolve them via the
  // library's own enums.* maps instead of guessing at hardcoded numbers.
  const CONV_TYPE_BY_CODE = reverseEnumMap(enums.ConversionActionType)
  const CONV_CAT_BY_CODE  = reverseEnumMap(enums.ConversionActionCategory)

  const [campRows, agRows, convRows, geoRows] = await Promise.all([
    customer.query(`
      SELECT campaign.id, campaign.name, campaign.status,
        campaign.advertising_channel_type, campaign.bidding_strategy_type
      FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.name ASC
    `),
    customer.query(`
      SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id, campaign.name
      FROM ad_group
      WHERE ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'
      ORDER BY campaign.name, ad_group.name ASC
    `).catch(() => []),
    customer.query(`
      SELECT conversion_action.name, conversion_action.type,
        conversion_action.category, conversion_action.include_in_conversions_metric
      FROM conversion_action WHERE conversion_action.status = 'ENABLED'
    `).catch(() => []),
    customer.query(`
      SELECT campaign.id, campaign.name,
        campaign_criterion.location.geo_target_constant, campaign_criterion.negative
      FROM campaign_criterion
      WHERE campaign_criterion.type = 'LOCATION' AND campaign.status != 'REMOVED'
    `).catch(() => []),
  ])

  const campaigns = campRows.map(r => ({
    id:          String(r.campaign?.id ?? ''),
    name:        r.campaign?.name ?? '',
    status:      ST[enumStr(r.campaign?.status)]   ?? enumStr(r.campaign?.status),
    type:        CH_TYPE[enumStr(r.campaign?.advertising_channel_type)] ?? enumStr(r.campaign?.advertising_channel_type),
    bidStrategy: BID[enumStr(r.campaign?.bidding_strategy_type)]        ?? enumStr(r.campaign?.bidding_strategy_type),
  }))

  const adGroups = agRows.map(r => ({
    id:           String(r.ad_group?.id ?? ''),
    name:         r.ad_group?.name ?? '',
    status:       ST[enumStr(r.ad_group?.status)] ?? enumStr(r.ad_group?.status),
    campaignId:   String(r.campaign?.id ?? ''),
    campaignName: r.campaign?.name ?? '',
  }))

  const conversionActions = convRows.map(r => {
    const typeCode = enumStr(r.conversion_action?.type)
    const catCode  = enumStr(r.conversion_action?.category)
    return {
      name:     r.conversion_action?.name ?? '',
      type:     humanizeEnumName(CONV_TYPE_BY_CODE[typeCode]) || typeCode,
      category: humanizeEnumName(CONV_CAT_BY_CODE[catCode]) || catCode,
      included: r.conversion_action?.include_in_conversions_metric !== false,
    }
  })

  // geo_target_constant can't be joined directly from campaign_criterion
  // (GAQL rejects the cross-resource select) — resolve display names with a
  // separate lookup by id, same pattern as campaignClient.js's targeting fetch.
  const geoIds = [...new Set(geoRows.map(r => r.campaign_criterion?.location?.geo_target_constant ?? r.campaign_criterion?.location?.geoTargetConstant).filter(Boolean).map(rn => String(rn).split('/').pop()))]
  const geoNames = {}
  if (geoIds.length > 0) {
    try {
      const nameRows = await customer.query(`SELECT geo_target_constant.id, geo_target_constant.canonical_name FROM geo_target_constant WHERE geo_target_constant.id IN (${geoIds.join(',')})`)
      nameRows.forEach(g => { geoNames[String(g.geo_target_constant?.id)] = g.geo_target_constant?.canonical_name })
    } catch { /* best effort — list falls back to raw id */ }
  }

  const geoMap = new Map()
  for (const r of geoRows) {
    const cid = String(r.campaign?.id ?? '')
    const geoRN = r.campaign_criterion?.location?.geo_target_constant ?? r.campaign_criterion?.location?.geoTargetConstant ?? ''
    const geoId = String(geoRN).split('/').pop()
    const isNeg = r.campaign_criterion?.negative === true
    if (!geoMap.has(cid)) geoMap.set(cid, { campaignId: cid, campaign: r.campaign?.name ?? '', count: 0, neg: 0, targeted: [], excluded: [] })
    const entry = geoMap.get(cid)
    const loc = { id: geoId, name: geoNames[geoId] || geoId }
    if (isNeg) { entry.neg++; entry.excluded.push(loc) }
    else { entry.count++; entry.targeted.push(loc) }
  }

  return { campaigns, adGroups, conversionActions, geoTargets: [...geoMap.values()] }
}

// ── Keyword Analysis for Summary tab ─────────────────────────────────────────

async function fetchKeywordAnalysisData({ api, credentials }, customerId, mccCustomerId, dateRange, timeZone, scope = {}) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange, timeZone)
  const { campaignId, adGroupId } = scope || {}
  const scopeClause = adGroupId ? ` AND ad_group.id = ${adGroupId}` : (campaignId ? ` AND campaign.id = ${campaignId}` : '')

  const [kwRows, wastedRows] = await Promise.all([
    customer.query(`
      SELECT ad_group_criterion.resource_name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
        ad_group_criterion.quality_info.quality_score, ad_group_criterion.status,
        campaign.id, campaign.name, ad_group.id, ad_group.name,
        metrics.clicks, metrics.impressions, metrics.cost_micros,
        metrics.conversions, metrics.ctr, metrics.average_cpc
      FROM keyword_view
      WHERE ${dateClause}
        AND ad_group_criterion.negative = false
        AND ad_group_criterion.status != 'REMOVED'
        AND campaign.status != 'REMOVED'
        AND ad_group.status != 'REMOVED'${scopeClause}
    `).catch(() => []),

    customer.query(`
      SELECT metrics.cost_micros, ad_group_criterion.keyword.match_type
      FROM keyword_view
      WHERE metrics.cost_micros > 1000000
        AND metrics.conversions < 1
        AND ${dateClause}${scopeClause}
    `).catch(() => []),
  ])

  const KW_STATUS_LBL = { ENABLED: 'Enabled', PAUSED: 'Paused', REMOVED: 'Removed', '2': 'Enabled', '3': 'Paused', '4': 'Removed' }
  const all = kwRows.map(r => ({
    resourceName: r.ad_group_criterion?.resource_name || '',
    text:         (r.ad_group_criterion?.keyword?.text || '').trim() || '—',
    matchType:    resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
    qualityScore: n(r.ad_group_criterion?.quality_info?.quality_score ?? 0),
    status:       KW_STATUS_LBL[enumStr(r.ad_group_criterion?.status)] || 'Enabled',
    campaignId:   String(r.campaign?.id ?? ''),
    campaign:     r.campaign?.name ?? '',
    adGroupId:    String(r.ad_group?.id ?? ''),
    adGroup:      r.ad_group?.name ?? '',
    clicks:       n(r.metrics?.clicks       ?? 0),
    impressions:  n(r.metrics?.impressions  ?? 0),
    cost:         n(r.metrics?.cost_micros  ?? 0) / 1e6,
    conversions:  n(r.metrics?.conversions  ?? 0),
    ctr:          n(r.metrics?.ctr          ?? 0) * 100,
    cpc:          n(r.metrics?.average_cpc  ?? 0) / 1e6,
  }))

  const wastedByMatchType = { Broad: 0, Phrase: 0, Exact: 0 }
  for (const r of wastedRows) {
    const mt   = resolveMatchType(r.ad_group_criterion?.keyword?.match_type)
    const cost = n(r.metrics?.cost_micros ?? 0) / 1e6
    if (mt in wastedByMatchType) wastedByMatchType[mt] += cost
    else wastedByMatchType.Broad += cost
  }

  const withConv = all.filter(k => k.conversions > 0)
  const withCpa  = withConv.filter(k => k.cost > 0).map(k => ({ ...k, cpa: k.cost / k.conversions }))
  const qsList   = all.filter(k => k.qualityScore > 0)
  const avgQs    = qsList.length ? qsList.reduce((s, k) => s + k.qualityScore, 0) / qsList.length : 0

  const highSpendNoConv = all.filter(k => k.cost > 10 && k.conversions === 0).sort((a, b) => b.cost - a.cost)

  const mtStats = {
    Broad:  { count:0, cost:0, conv:0, clicks:0, impr:0 },
    Phrase: { count:0, cost:0, conv:0, clicks:0, impr:0 },
    Exact:  { count:0, cost:0, conv:0, clicks:0, impr:0 },
  }
  for (const k of all) {
    const mt = mtStats[k.matchType]
    if (mt) { mt.count++; mt.cost += k.cost; mt.conv += k.conversions; mt.clicks += k.clicks; mt.impr += k.impressions }
  }

  return {
    totalKeywords:        all.length,
    withConvCount:        withConv.length,
    avgQs,
    highSpendNoConvCount: highSpendNoConv.length,
    topByConv:     [...withConv].sort((a, b) => b.conversions - a.conversions).slice(0, 5),
    topByLowCpa:   [...withCpa].sort((a, b) => a.cpa - b.cpa).slice(0, 5),
    topByCtr:      all.filter(k => k.clicks >= 10).sort((a, b) => b.ctr - a.ctr).slice(0, 5),
    topByConvRate: withConv.map(k => ({ ...k, cr: k.clicks > 0 ? (k.conversions / k.clicks) * 100 : 0 })).sort((a, b) => b.cr - a.cr).slice(0, 5),
    highSpendNoConv: highSpendNoConv.slice(0, 5),
    lowQsKws:      all.filter(k => k.qualityScore > 0 && k.qualityScore <= 5).sort((a, b) => b.cost - a.cost).slice(0, 5),
    expensiveCpc:  all.filter(k => k.clicks > 0).sort((a, b) => b.cpc - a.cpc).slice(0, 5),
    lowCtrKws:     all.filter(k => k.impressions >= 100 && k.ctr < 1).sort((a, b) => b.cost - a.cost).slice(0, 5),
    mtStats,
    wastedByMatchType,
  }
}

async function fetchSearchTermAnalysisData({ api, credentials }, customerId, mccCustomerId, dateRange, timeZone, scope = {}) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange, timeZone)
  const { campaignId, adGroupId } = scope || {}
  const scopeClause = adGroupId ? ` AND ad_group.id = ${adGroupId}` : (campaignId ? ` AND campaign.id = ${campaignId}` : '')

  const ST_STATUS = {
    ADDED:'Added', EXCLUDED:'Excluded', ADDED_EXCLUDED:'Added Excluded',
    NEAR:'Near', UNKNOWN:'Unknown', UNSPECIFIED:'Unknown',
    '2':'Added', '3':'Excluded', '4':'Added Excluded', '5':'Near',
  }

  const coreRows = await customer.query(`
    SELECT
      search_term_view.search_term,
      search_term_view.status,
      campaign.id, campaign.name, campaign.status,
      ad_group.id, ad_group.name, ad_group.status,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_per_conversion
    FROM search_term_view
    WHERE ${dateClause}${scopeClause}
    ORDER BY metrics.cost_micros DESC
  `)

  const ENTITY_STATUS_LBL = { ENABLED: 'Enabled', PAUSED: 'Paused', REMOVED: 'Removed', '2': 'Enabled', '3': 'Paused', '4': 'Removed' }
  const all = coreRows.map(r => {
    const stSts = enumStr(r.search_term_view?.status)
    return {
      term:            (r.search_term_view?.search_term ?? '').trim(),
      status:          ST_STATUS[stSts] ?? stSts ?? 'Unknown',
      campaignId:      String(r.campaign?.id ?? ''),
      campaign:        r.campaign?.name ?? '',
      campaignStatus:  ENTITY_STATUS_LBL[enumStr(r.campaign?.status)] || 'Enabled',
      adGroupId:       String(r.ad_group?.id ?? ''),
      adGroup:         r.ad_group?.name ?? '',
      adGroupStatus:   ENTITY_STATUS_LBL[enumStr(r.ad_group?.status)] || 'Enabled',
      impressions: n(r.metrics?.impressions         ?? 0),
      clicks:      n(r.metrics?.clicks              ?? 0),
      cost:        n(r.metrics?.cost_micros         ?? 0) / 1_000_000,
      conversions: n(r.metrics?.conversions         ?? 0),
      ctr:         n(r.metrics?.ctr                 ?? 0) * 100,
      cpc:         n(r.metrics?.average_cpc         ?? 0) / 1_000_000,
      cpa:         n(r.metrics?.cost_per_conversion ?? 0) / 1_000_000,
    }
  })

  const INFO_RE = /\b(how|what|why|where|when|who|which|guide|tutorial|tips?|meaning|definition|examples?|learn|learning|course|diy|free|ideas?|training|basics?|beginner|help|support|wiki|wikipedia|history|news|about|difference|between)\b/i
  const COMP_RE = /\b(vs\.?|versus|review|reviews?|alternative|alternatives?|compare|compared|competitor|competitors?|ranking|ranked)\b/i

  const withConv    = all.filter(t => t.conversions > 0)
  const noConvSpend = all.filter(t => t.conversions === 0 && t.cost > 0)

  const infoSet = new Set()
  const compSet = new Set()
  const lowSet  = new Set()

  const informational = noConvSpend.filter(t => {
    const m = INFO_RE.test(t.term)
    if (m) infoSet.add(t.term)
    return m
  })
  const competitorLeakage = noConvSpend.filter(t => {
    const m = COMP_RE.test(t.term) && !infoSet.has(t.term)
    if (m) compSet.add(t.term)
    return m
  })
  const lowIntentQueries = noConvSpend.filter(t => {
    const m = t.cost > 5 && t.ctr < 0.5 && !infoSet.has(t.term) && !compSet.has(t.term)
    if (m) lowSet.add(t.term)
    return m
  })
  const irrelevantTraffic = noConvSpend.filter(t =>
    t.cost > 10 && !infoSet.has(t.term) && !compSet.has(t.term) && !lowSet.has(t.term)
  )

  const drivingConversions = [...withConv].sort((a, b) => b.conversions - a.conversions).slice(0, 10)
  const newKwOpportunities = withConv
    .filter(t => t.status !== 'Added' && t.status !== 'Added Excluded')
    .sort((a, b) => b.conversions - a.conversions)
    .slice(0, 10)

  const negativeRecommendations = noConvSpend
    .filter(t => t.status !== 'Excluded' && t.status !== 'Added Excluded' && t.cost > 5)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 15)

  const exactMatchRecommendations = withConv
    .filter(t => t.status !== 'Added' && t.status !== 'Added Excluded')
    .sort((a, b) => b.conversions - a.conversions)
    .slice(0, 15)

  return {
    overview: {
      totalCount:       all.length,
      totalSpend:       all.reduce((s, t) => s + t.cost, 0),
      totalClicks:      all.reduce((s, t) => s + t.clicks, 0),
      totalConversions: all.reduce((s, t) => s + t.conversions, 0),
      convertingCount:  withConv.length,
      wastedCount:      noConvSpend.filter(t => t.cost > 5).length,
      totalWasted:      noConvSpend.reduce((s, t) => s + t.cost, 0),
    },
    highIntent: { drivingConversions, newKwOpportunities },
    wastedSpend: {
      informational:     informational.sort((a, b) => b.cost - a.cost).slice(0, 5),
      competitorLeakage: competitorLeakage.sort((a, b) => b.cost - a.cost).slice(0, 5),
      lowIntentQueries:  lowIntentQueries.sort((a, b) => b.cost - a.cost).slice(0, 5),
      irrelevantTraffic: irrelevantTraffic.sort((a, b) => b.cost - a.cost).slice(0, 5),
    },
    recommendations: {
      negatives:  negativeRecommendations,
      exactMatch: exactMatchRecommendations,
    },
  }
}

async function fetchAdPerformanceAnalysisData({ api, credentials }, customerId, mccCustomerId, dateRange, timeZone, scope = {}) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange, timeZone)
  const { campaignId, adGroupId } = scope || {}
  const scopeClause = adGroupId ? ` AND ad_group.id = ${adGroupId}` : (campaignId ? ` AND campaign.id = ${campaignId}` : '')

  // RESPONSIVE_SEARCH_AD = 15 (numeric) or 'RESPONSIVE_SEARCH_AD' (string)
  const isRSAType = t => t === 'RESPONSIVE_SEARCH_AD' || t === '15'

  // Match AD_STRENGTH_LBL used in RSA builder (API enum: 2=Pending,3=No Ads,4=Poor,5=Average,6=Good,7=Excellent)
  const AD_STR = {
    EXCELLENT:'Excellent', GOOD:'Good', AVERAGE:'Average', POOR:'Poor',
    PENDING:'Pending', NO_ADS:'No Ads', UNKNOWN:'Unknown', UNSPECIFIED:'Unknown',
    '0':'Unknown', '1':'Unknown', '2':'Pending', '3':'No Ads',
    '4':'Poor', '5':'Average', '6':'Good', '7':'Excellent',
  }
  const EXT_TYPE_MAP = {
    SITELINK:'Sitelinks', CALLOUT:'Callouts', CALL:'Calls',
    STRUCTURED_SNIPPET:'Structured Snippets', IMAGE:'Images', PROMOTION:'Promotions',
    '2':'Sitelinks', '12':'Callouts', '5':'Calls', '17':'Structured Snippets',
    '45':'Images', '22':'Promotions',
  }
  const CTA_RE = /\b(buy|call|get|contact|sign up|order|book|try|start|request|learn|save|shop|find|download|subscribe|register|apply|claim|schedule|compare|see|browse|quote)\b/i
  const KW_RE  = /\{keyword:/i

  const [adRows, extRows] = await Promise.all([
    // Identical base query to fetchTopConvertingAds + ad_strength + approval_status
    customer.query(`
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.type,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.final_urls,
        ad_group_ad.policy_summary.approval_status,
        ad_group_ad.ad_strength, ad_group_ad.status,
        campaign.name, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.conversions,
        metrics.conversions_from_interactions_rate, metrics.cost_micros,
        metrics.average_cpc, metrics.ctr, metrics.all_conversions_value
      FROM ad_group_ad
      WHERE ${dateClause} AND metrics.impressions > 0${scopeClause}
      ORDER BY metrics.conversions DESC LIMIT 500
    `).catch(() => []),

    // customer_extension_setting is account-level only — Google Ads has no
    // campaign/ad_group dimension on it, so this can't be scoped to a
    // selected campaign or ad group. Left unfiltered; the frontend shows a
    // note next to Extensions when a filter is active (extensionsUnscoped below).
    customer.query(`
      SELECT customer_extension_setting.extension_type
      FROM customer_extension_setting
    `).catch(() => []),
  ])

  const allAds = adRows.map(r => {
    const rawStr  = enumStr(r.ad_group_ad?.ad_strength)
    const rawType = enumStr(r.ad_group_ad?.ad?.type)
    const rawSts  = enumStr(r.ad_group_ad?.status)
    const rawHls  = r.ad_group_ad?.ad?.responsive_search_ad?.headlines  || []
    const rawDesc = r.ad_group_ad?.ad?.responsive_search_ad?.descriptions || []

    const headlines    = rawHls.map(h  => ({ text: typeof h === 'string' ? h : (h?.text || ''), pinned: h?.pinned_field ? enumStr(h.pinned_field) : null }))
    const descriptions = rawDesc.map(d => ({ text: typeof d === 'string' ? d : (d?.text || ''), pinned: d?.pinned_field ? enumStr(d.pinned_field) : null }))
    const allText      = [...headlines.map(h => h.text), ...descriptions.map(d => d.text)]
    const pinnedHls    = headlines.filter(h => h.pinned && !['UNSPECIFIED','NONE','null'].includes(String(h.pinned)))
    const adId         = String(r.ad_group_ad?.ad?.id || '')

    return {
      id:            adId,
      type:          rawType,
      isRSA:         isRSAType(rawType),
      adStrength:    AD_STR[rawStr] || rawStr || 'Unknown',
      status:        STATUS_MAP[rawSts] || rawSts,
      campaign:      r.campaign?.name || '—',
      adGroup:       r.ad_group?.name || '—',
      headline1:     headlines[0]?.text || '—',
      headlineCount: headlines.length,
      descCount:     descriptions.length,
      impressions:   n(r.metrics?.impressions  ?? 0),
      clicks:        n(r.metrics?.clicks       ?? 0),
      conversions:   n(r.metrics?.conversions  ?? 0),
      cost:          n(r.metrics?.cost_micros  ?? 0) / 1e6,
      ctr:           n(r.metrics?.ctr          ?? 0) * 100,
      cpc:           n(r.metrics?.average_cpc  ?? 0) / 1e6,
      convRate:      n(r.metrics?.conversions_from_interactions_rate ?? 0) * 100,
      hasCta:        allText.some(t => CTA_RE.test(t)),
      hasKwInsert:   allText.some(t => KW_RE.test(t)),
      isPinned:      pinnedHls.length > 0 && headlines.length > 0 && pinnedHls.length / headlines.length > 0.6,
    }
  })

  const ads = allAds

  const activeExtTypes = new Set(
    extRows.map(r => EXT_TYPE_MAP[enumStr(r.customer_extension_setting?.extension_type)]).filter(Boolean)
  )
  const ALL_EXT = ['Sitelinks', 'Callouts', 'Structured Snippets', 'Calls', 'Images', 'Promotions']
  const extensions = ALL_EXT.map(name => ({ name, active: activeExtTypes.has(name) }))

  const rsaAds = ads.filter(a => a.isRSA)

  const strengthDist = { Excellent:0, Good:0, Average:0, Poor:0, Other:0 }
  for (const a of rsaAds) {
    if (strengthDist[a.adStrength] !== undefined) strengthDist[a.adStrength]++
    else strengthDist.Other++
  }

  const adCol = a => ({ ...a, _headline: a.headline1.length > 45 ? a.headline1.slice(0, 45) + '…' : a.headline1 })

  return {
    overview: {
      totalAds:  ads.length,
      rsaCount:  rsaAds.length,
      strongAds: rsaAds.filter(a => ['Excellent','Good'].includes(a.adStrength)).length,
      weakAds:   rsaAds.filter(a => ['Poor','Average'].includes(a.adStrength)).length,
    },
    best: {
      byConversions: ads.slice(0, 3),
      byCtr:      ads.filter(a => a.impressions >= 100).sort((a,b) => b.ctr - a.ctr).slice(0,5).map(adCol),
      byConvRate: ads.filter(a => a.clicks >= 10).sort((a,b) => b.convRate - a.convRate).slice(0,5).map(adCol),
      byStrength: rsaAds.filter(a => ['Excellent','Good'].includes(a.adStrength)).sort((a,b) => b.impressions - a.impressions).slice(0,5).map(adCol),
    },
    weak: {
      byLowCtr:      ads.filter(a => a.impressions >= 100 && a.ctr < 1).sort((a,b) => b.cost - a.cost).slice(0,5).map(adCol),
      byLowConvRate: ads.filter(a => a.clicks >= 20 && a.convRate < 0.5).sort((a,b) => b.cost - a.cost).slice(0,5).map(adCol),
      byStrength:    rsaAds.filter(a => ['Poor','Average'].includes(a.adStrength)).sort((a,b) => b.impressions - a.impressions).slice(0,5).map(adCol),
    },
    rsaQuality: {
      strengthDist,
      noCta:        rsaAds.filter(a => !a.hasCta).length,
      withKwInsert: rsaAds.filter(a => a.hasKwInsert).length,
      pinningIssue: rsaAds.filter(a => a.isPinned).length,
      lowHeadlines: rsaAds.filter(a => a.headlineCount < 10).length,
      lowDescs:     rsaAds.filter(a => a.descCount < 4).length,
      topNoCta:     rsaAds.filter(a => !a.hasCta).sort((a,b) => b.impressions - a.impressions).slice(0,5).map(adCol),
      topPinned:    rsaAds.filter(a => a.isPinned).sort((a,b) => b.impressions - a.impressions).slice(0,5).map(adCol),
    },
    extensions,
    extensionsUnscoped: !!(campaignId || adGroupId),
  }
}

// ── Google Ads error parser ───────────────────────────────────────────────────

function parseGoogleAdsError(e) {
  try {
    const errors = e?.errors || e?.failure?.errors || []
    if (!errors.length) return e?.message || String(e)
    return errors.map(err => {
      // Extract PolicyViolationDetails when present
      const pvd = err?.details?.policy_violation_details || err?.details?.policyViolationDetails
      if (pvd) {
        const policyName = pvd.external_policy_name || pvd.externalPolicyName
                        || pvd.key?.policy_name    || pvd.key?.policyName    || 'Unknown policy'
        const violatingText = pvd.key?.violating_text || pvd.key?.violatingText || ''
        const isExemptible  = pvd.is_exemptible ?? pvd.isExemptible
        let detail = `Policy violation: ${policyName}`
        if (violatingText) detail += ` — violating text: "${violatingText}"`
        if (isExemptible === false) detail += '. This policy cannot be overridden.'
        return detail
      }
      const msg = err?.message || ''

      // Quota/rate-limit errors (error_code.quota_error) carry a retry delay
      // in raw seconds, which can be tens of thousands of seconds for a
      // developer token on a low access tier — converted to hours/minutes
      // so it's actually readable, and the rate_name is surfaced so it's
      // clear this is an API-side quota, not an app bug.
      if (err?.error_code?.quota_error != null || err?.errorCode?.quotaError != null) {
        const rateName = err?.details?.quota_error_details?.rate_name
                      || err?.details?.quotaErrorDetails?.rateName
                      || 'a Google Ads API quota'
        const secMatch = msg.match(/retry in (\d+) seconds?/i)
        let retryStr = ''
        if (secMatch) {
          const totalSec = Number(secMatch[1])
          const hrs = Math.floor(totalSec / 3600)
          const mins = Math.round((totalSec % 3600) / 60)
          retryStr = hrs > 0 ? ` Try again in about ${hrs}h ${mins}m.` : ` Try again in about ${mins} minute${mins === 1 ? '' : 's'}.`
        }
        return `Google Ads API rate limit reached (${rateName}).${retryStr} This is a temporary quota on the developer token's current access level, not an app error.`
      }

      if (msg.includes('PROHIBITED'))
        return 'Ad disapproved: one or more headlines or descriptions contain content that violates Google Ads policy (PROHIBITED). Review and regenerate your assets to remove restricted terms.'
      if (msg.includes('policy') || msg.includes('Policy'))
        return `Policy violation: ${msg}`
      if (msg.includes('limit on the number of allowed resources') || msg.includes('RESOURCE_COUNT_LIMIT_EXCEEDED'))
        return 'This ad group already has the maximum number of enabled ads Google Ads allows. Pause an existing ad in this ad group (use the checkboxes in this dialog, or pause one directly in the ad list) before publishing a new one.'

      // A given (ad group, keyword text, match type) is a PERMANENT identity
      // in Google Ads — once a keyword with that exact text+match type has
      // ever existed in an ad group, Google keeps its positive/negative
      // status locked forever, even after it's removed. Trying to recreate
      // the same text+match type as the opposite type (e.g. Switch K<->NK
      // staying in the same ad group) hits this exact "immutable negative
      // field" error on the CREATE call, which otherwise shows as a raw,
      // confusing Google error with no actionable guidance.
      {
        const pathEls0 = err?.location?.field_path_elements || err?.location?.fieldPathElements
        const touchesNegative = Array.isArray(pathEls0) && pathEls0.some(el => (el.field_name || el.fieldName) === 'negative')
        if (msg.toLowerCase().includes('immutable') && touchesNegative) {
          return 'This exact keyword text and match type already exist in this ad group as the opposite type (keyword vs. negative keyword) — Google Ads treats that combination as permanent, even after removal, so it can\'t be switched in place. Try a different match type, or target a different ad group (or, for a negative keyword, the campaign level instead).'
        }
      }

      // Surface which specific field/operation Google rejected — errors like
      // OPERATION_NOT_PERMITTED_FOR_CONTEXT give no useful detail in the
      // message alone (e.g. "The operation is not allowed for the given
      // context."); the field path is the only way to tell which of several
      // operations in a batched mutate (locations/languages/devices/ad
      // schedule, etc.) actually triggered it.
      const pathEls = err?.location?.field_path_elements || err?.location?.fieldPathElements
      if (Array.isArray(pathEls) && pathEls.length > 0) {
        const path = pathEls.map(el => {
          const name = el.field_name || el.fieldName
          const idx  = el.index
          return idx !== undefined && idx !== null ? `${name}[${idx}]` : name
        }).filter(Boolean).join(' > ')
        const errorCode = err?.error_code || err?.errorCode
        const codeStr = errorCode ? Object.entries(errorCode).map(([k, v]) => `${k}=${v}`).join(', ') : ''
        return `${msg || 'Unknown Google Ads API error'} (at: ${path}${codeStr ? `; code: ${codeStr}` : ''})`
      }

      return msg || 'Unknown Google Ads API error'
    }).join(' | ')
  } catch {
    return e?.message || String(e)
  }
}


// ── RSA Apply ─────────────────────────────────────────────────────────────────

// Resolve a possibly-relative URL to an absolute one using baseUrl as the domain
function makeAbsoluteUrl(url, baseUrl) {
  if (!url || !url.trim()) return ''
  const u = url.trim()
  if (/^https?:\/\//i.test(u)) return u
  try {
    const base = new URL(baseUrl)
    return `${base.protocol}//${base.host}${u.startsWith('/') ? u : '/' + u}`
  } catch { return '' }
}

// Display path segments (path1/path2) are plain URL-safe tokens, not real URL
// paths — Google Ads rejects most punctuation (confirmed live: even a single
// "/" triggers string_format_error=2 "disallowed characters"). Keep letters,
// numbers, and hyphens only.
function sanitizeDisplayPath(text) {
  return String(text || '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function applyRSAChanges({ api, credentials }, customerId, mccCustomerId, {
  adGroupId,
  newHeadlines,
  newDescriptions,
  finalUrl,
  displayPath1 = '',
  displayPath2 = '',
  sitelinks    = [],
  pauseAdIds   = [],
  applyLabel   = false,
  labelText    = 'AI Built RSA',
}) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const result   = { created: null, paused: [], labeled: [], sitelinksCreated: 0, errors: [] }

  // 1. Pause old RSAs FIRST — an ad group has a hard cap on enabled RSAs, so
  // if the caller is replacing one, the slot must be freed before the new ad
  // is created or Google Ads rejects the create with RESOURCE_COUNT_LIMIT_EXCEEDED
  // even though the net result (one ad swapped for another) would be valid.
  for (const adId of pauseAdIds) {
    try {
      await customer.adGroupAds.update([{
        resource_name: `customers/${customerId}/adGroupAds/${adGroupId}~${adId}`,
        status: 3, // PAUSED
      }])
      result.paused.push(adId)
    } catch (e) {
      result.errors.push(`Pause ad ${adId}: ${parseGoogleAdsError(e)}`)
    }
  }

  // 2. Create new RSA
  let createRes
  try {
    const rsaFields = {
      headlines:    newHeadlines.slice(0, 15).map(t => ({ text: String(t).slice(0, 30) })),
      descriptions: newDescriptions.slice(0, 4).map(t => ({ text: String(t).slice(0, 90) })),
    }
    const sp1 = sanitizeDisplayPath(displayPath1)
    const sp2 = sanitizeDisplayPath(displayPath2)
    if (sp1) rsaFields.path1 = sp1.slice(0, 15)
    if (sp2) rsaFields.path2 = sp2.slice(0, 15)

    createRes = await customer.adGroupAds.create([{
      ad_group: `customers/${customerId}/adGroups/${adGroupId}`,
      status:   2, // ENABLED
      ad: {
        final_urls: [finalUrl].filter(Boolean),
        responsive_search_ad: rsaFields,
      },
    }])
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
  const createdRN = createRes?.results?.[0]?.resource_name || null
  result.created  = { resourceName: createdRN, headlines: newHeadlines, descriptions: newDescriptions, finalUrl }

  // 3. Apply label "AI Built RSA" to the newly created ad
  if (applyLabel && createdRN) {
    try {
      const existing = await customer.query(
        `SELECT label.id FROM label WHERE label.name = '${labelText.replace(/'/g, "\\'")}' LIMIT 1`
      ).catch(() => [])
      let labelRN
      if (existing.length > 0) {
        labelRN = `customers/${customerId}/labels/${existing[0].label.id}`
      } else {
        const lr = await customer.labels.create([{ name: labelText, status: 2 }])
        labelRN  = lr?.results?.[0]?.resource_name
      }
      if (labelRN) {
        await customer.adGroupAdLabels.create([{ ad_group_ad: createdRN, label: labelRN }])
        result.labeled.push(labelText)
      }
    } catch (e) {
      result.errors.push(`Apply label: ${e.message}`)
    }
  }

  // 4. Create sitelinks as ad-group assets
  if (Array.isArray(sitelinks) && sitelinks.length > 0) {
    try {
      // Build validated asset objects — every field must be safe before sending
      const assetsToCreate = sitelinks
        .map(sl => {
          const headline = String(sl.headline || '').trim().slice(0, 25)
          const absUrl   = makeAbsoluteUrl(String(sl.url || '').trim(), finalUrl)
          const d1       = String(sl.description1 || sl.description || '').trim().slice(0, 35)
          const d2       = String(sl.description2 || '').trim().slice(0, 35)

          // Both headline and a valid absolute URL are mandatory
          if (!headline || !absUrl) return null

          const asset = {
            final_urls:     [absUrl],  // Required at Asset level — must be absolute
            sitelink_asset: { link_text: headline },
          }
          // Google Ads requires description1 AND description2 together or neither
          if (d1 && d2) {
            asset.sitelink_asset.description1 = d1
            asset.sitelink_asset.description2 = d2
          }
          return asset
        })
        .filter(Boolean)  // drop any that failed validation

      if (assetsToCreate.length > 0) {
        console.log(`[RSA Apply] Creating ${assetsToCreate.length} sitelink(s)`)
        console.log(JSON.stringify(assetsToCreate, null, 2))

        const assetsRes = await customer.assets.create(assetsToCreate)
        const assetRNs  = (assetsRes?.results || []).map(r => r.resource_name).filter(Boolean)

        if (assetRNs.length > 0) {
          await customer.adGroupAssets.create(assetRNs.map(rn => ({
            ad_group:   `customers/${customerId}/adGroups/${adGroupId}`,
            asset:      rn,
            field_type: 13, // AssetFieldType.SITELINK = 13
          })))
          result.sitelinksCreated = assetRNs.length
          console.log(`[RSA Apply] ${assetRNs.length} sitelink(s) linked to ad group`)
        }
      }
    } catch (e) {
      const msg = parseGoogleAdsError(e)
      console.error('[RSA Apply] Sitelinks error:', msg)
      result.errors.push(`Sitelinks: ${msg}`)
    }
  }

  return result
}

async function rollbackRSAChanges({ api, credentials }, customerId, mccCustomerId, {
  adGroupId,
  createdResourceName,
  pausedAdIds = [],
}) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const errors   = []

  // Pause the newly created RSA (safer than REMOVED — ad can be recovered)
  if (createdResourceName) {
    try {
      await customer.adGroupAds.update([{ resource_name: createdResourceName, status: 3 }])
    } catch (e) {
      errors.push(`Pause new RSA: ${e.message}`)
    }
  }

  // Re-enable the ads that were paused during apply
  for (const adId of pausedAdIds) {
    try {
      await customer.adGroupAds.update([{
        resource_name: `customers/${customerId}/adGroupAds/${adGroupId}~${adId}`,
        status: 2, // ENABLED
      }])
    } catch (e) {
      errors.push(`Re-enable ad ${adId}: ${e.message}`)
    }
  }

  return { success: errors.length === 0, errors }
}


async function updateRSAContents({ api, credentials }, customerId, mccCustomerId, {
  adGroupId, adId,
  newHeadlines, newDescriptions,
  newFinalUrl, newPath1, newPath2,
}) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)

  const rsaFields = {
    headlines:    newHeadlines.slice(0, 15).map(t => ({ text: String(t).slice(0, 30) })),
    descriptions: newDescriptions.slice(0, 4).map(t => ({ text: String(t).slice(0, 90) })),
  }
  const sp1 = sanitizeDisplayPath(newPath1)
  const sp2 = sanitizeDisplayPath(newPath2)
  if (sp1) rsaFields.path1 = sp1.slice(0, 15)
  if (sp2) rsaFields.path2 = sp2.slice(0, 15)

  try {
    await customer.adGroupAds.create([{
      ad_group: `customers/${customerId}/adGroups/${adGroupId}`,
      status:   2, // ENABLED
      ad: {
        final_urls: [newFinalUrl].filter(Boolean),
        responsive_search_ad: rsaFields,
      },
    }])
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }

  return { success: true }
}

// Genuinely edits an EXISTING, already-published RSA's content in place via
// AdService (customer.ads.update) — confirmed live: this works for headlines,
// descriptions, path1/path2, and final_urls, unlike updateRSAContents above
// (which despite its name actually creates a brand-new ad — Ad resources
// were long assumed immutable, but Google Ads API v23's AdService supports
// updating an existing ad's creative fields directly, keeping the same
// resource name and performance history). Preserves each headline/
// description's existing pin unless the caller explicitly changes it.
async function updateExistingAdContent({ api, credentials }, customerId, mccCustomerId, {
  adId, headlines, descriptions, finalUrl, path1, path2,
}) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  if (!adId) throw new Error('Ad ID is required.')

  const hlList = (headlines    || []).map(h => ({ text: String(h.text || '').trim().slice(0, 30), pinned: h.pinned || null })).filter(h => h.text)
  const dsList = (descriptions || []).map(d => ({ text: String(d.text || '').trim().slice(0, 90), pinned: d.pinned || null })).filter(d => d.text)
  if (hlList.length < 3)  throw new Error('At least 3 headlines are required.')
  if (hlList.length > 15) throw new Error('Maximum 15 headlines allowed.')
  if (dsList.length < 2)  throw new Error('At least 2 descriptions are required.')
  if (dsList.length > 4)  throw new Error('Maximum 4 descriptions allowed.')

  const toAssetField = a => {
    const obj = { text: a.text }
    if (a.pinned && enums.ServedAssetFieldType[a.pinned] !== undefined) obj.pinned_field = enums.ServedAssetFieldType[a.pinned]
    return obj
  }

  const responsive_search_ad = {
    headlines:    hlList.map(toAssetField),
    descriptions: dsList.map(toAssetField),
  }
  if (path1 !== undefined) responsive_search_ad.path1 = sanitizeDisplayPath(path1).slice(0, 15)
  if (path2 !== undefined) responsive_search_ad.path2 = sanitizeDisplayPath(path2).slice(0, 15)

  const updateObj = {
    resource_name: `customers/${customerId}/ads/${adId}`,
    responsive_search_ad,
  }
  if (finalUrl) updateObj.final_urls = [finalUrl]

  try {
    await customer.ads.update([updateObj])
    return { success: true }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

async function enableRSAById({ api, credentials }, customerId, mccCustomerId, { adGroupId, adId }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  try {
    await customer.adGroupAds.update([{
      resource_name: `customers/${customerId}/adGroupAds/${adGroupId}~${adId}`,
      status: 2, // ENABLED
    }])
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
  return { success: true }
}

async function pauseRSAById({ api, credentials }, customerId, mccCustomerId, { adGroupId, adId }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  try {
    await customer.adGroupAds.update([{
      resource_name: `customers/${customerId}/adGroupAds/${adGroupId}~${adId}`,
      status: 3, // PAUSED
    }])
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
  return { success: true }
}

async function removeRSAById({ api, credentials }, customerId, mccCustomerId, { adGroupId, adId }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  try {
    await customer.adGroupAds.remove([
      `customers/${customerId}/adGroupAds/${adGroupId}~${adId}`,
    ])
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
  return { success: true }
}

async function publishSingleSitelink({ api, credentials }, customerId, mccCustomerId, { adGroupId, headline, description1, description2, url, finalUrl }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const absUrl = makeAbsoluteUrl(String(url || '').trim(), finalUrl)
  if (!headline?.trim() || !absUrl) throw new Error('Sitelink requires a headline and a valid URL.')

  const d1 = String(description1 || '').trim().slice(0, 35)
  const d2 = String(description2 || '').trim().slice(0, 35)
  const asset = {
    final_urls:     [absUrl],
    sitelink_asset: { link_text: String(headline).trim().slice(0, 25) },
  }
  if (d1 && d2) { asset.sitelink_asset.description1 = d1; asset.sitelink_asset.description2 = d2 }

  const assetsRes = await customer.assets.create([asset])
  const assetRN   = assetsRes?.results?.[0]?.resource_name
  if (!assetRN) throw new Error('Asset created but no resource name returned.')

  await customer.adGroupAssets.create([{
    ad_group:   `customers/${customerId}/adGroups/${adGroupId}`,
    asset:      assetRN,
    field_type: 13, // AssetFieldType.SITELINK
  }])
  return { success: true, resourceName: assetRN }
}

// Edits an existing sitelink asset's content in place — level-agnostic (the
// asset itself carries no level, only its links do), so this works whether
// the sitelink is linked at account, campaign, or ad group level.
async function editSitelinkAsset({ api, credentials }, customerId, mccCustomerId, { resourceName, headline, description1, description2, url, finalUrl }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const absUrl = makeAbsoluteUrl(String(url || '').trim(), finalUrl || url)
  if (!resourceName) throw new Error('Asset resource name is required.')
  if (!headline?.trim() || !absUrl) throw new Error('Sitelink requires a headline and a valid URL.')

  const d1 = String(description1 || '').trim().slice(0, 35)
  const d2 = String(description2 || '').trim().slice(0, 35)
  const sitelinkAsset = { link_text: String(headline).trim().slice(0, 25) }
  if (d1 && d2) { sitelinkAsset.description1 = d1; sitelinkAsset.description2 = d2 }

  try {
    await customer.assets.update([{ resource_name: resourceName, final_urls: [absUrl], sitelink_asset: sitelinkAsset }])
    return { success: true }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

async function fetchAdGroupSitelinks({ api, credentials }, customerId, mccCustomerId, adGroupId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const rows = await customer.query(`
    SELECT
      ad_group_asset.status,
      ad_group_asset.resource_name,
      asset.sitelink_asset.link_text,
      asset.sitelink_asset.description1,
      asset.sitelink_asset.description2,
      asset.final_urls,
      asset.resource_name
    FROM ad_group_asset
    WHERE ad_group_asset.ad_group = 'customers/${customerId}/adGroups/${adGroupId}'
      AND ad_group_asset.field_type = 'SITELINK'
      AND ad_group_asset.status != 'REMOVED'
  `).catch(() => [])
  return rows.map(r => ({
    headline:     r.asset?.sitelink_asset?.link_text    || '',
    description1: r.asset?.sitelink_asset?.description1 || '',
    description2: r.asset?.sitelink_asset?.description2 || '',
    urls:         r.asset?.final_urls || [],
    status:       assetLinkStatusName(r.ad_group_asset?.status),
    linkResourceName: r.ad_group_asset?.resource_name || '',
    resourceName: r.asset?.resource_name  || '',
  }))
}

async function publishSitelinkToAccount({ api, credentials }, customerId, mccCustomerId, { headline, description1, description2, url }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const absUrl = makeAbsoluteUrl(String(url || '').trim(), url)
  if (!headline?.trim() || !absUrl) throw new Error('Sitelink requires a headline and a valid URL.')
  const d1 = String(description1 || '').trim().slice(0, 35)
  const d2 = String(description2 || '').trim().slice(0, 35)
  const asset = { final_urls: [absUrl], sitelink_asset: { link_text: String(headline).trim().slice(0, 25) } }
  if (d1 && d2) { asset.sitelink_asset.description1 = d1; asset.sitelink_asset.description2 = d2 }
  const assetsRes = await customer.assets.create([asset])
  const assetRN   = assetsRes?.results?.[0]?.resource_name
  if (!assetRN) throw new Error('Asset created but no resource name returned.')
  await customer.customerAssets.create([{ customer: `customers/${customerId}`, asset: assetRN, field_type: 13 }])
  return { success: true, resourceName: assetRN }
}

async function publishSitelinkToCampaign({ api, credentials }, customerId, mccCustomerId, { campaignId, headline, description1, description2, url }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const absUrl = makeAbsoluteUrl(String(url || '').trim(), url)
  if (!headline?.trim() || !absUrl) throw new Error('Sitelink requires a headline and a valid URL.')
  const d1 = String(description1 || '').trim().slice(0, 35)
  const d2 = String(description2 || '').trim().slice(0, 35)
  const asset = { final_urls: [absUrl], sitelink_asset: { link_text: String(headline).trim().slice(0, 25) } }
  if (d1 && d2) { asset.sitelink_asset.description1 = d1; asset.sitelink_asset.description2 = d2 }
  const assetsRes = await customer.assets.create([asset])
  const assetRN   = assetsRes?.results?.[0]?.resource_name
  if (!assetRN) throw new Error('Asset created but no resource name returned.')
  await customer.campaignAssets.create([{ campaign: `customers/${customerId}/campaigns/${campaignId}`, asset: assetRN, field_type: 13 }])
  return { success: true, resourceName: assetRN }
}

async function fetchAccountSitelinks({ api, credentials }, customerId, mccCustomerId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const rows = await customer.query(`
    SELECT customer_asset.status, customer_asset.resource_name, asset.sitelink_asset.link_text,
      asset.sitelink_asset.description1, asset.sitelink_asset.description2,
      asset.final_urls, asset.resource_name
    FROM customer_asset
    WHERE customer_asset.field_type = 'SITELINK' AND customer_asset.status != 'REMOVED'
  `).catch(() => [])
  return rows.map(r => ({
    headline: r.asset?.sitelink_asset?.link_text || '', description1: r.asset?.sitelink_asset?.description1 || '',
    description2: r.asset?.sitelink_asset?.description2 || '', urls: r.asset?.final_urls || [],
    status: assetLinkStatusName(r.customer_asset?.status), linkResourceName: r.customer_asset?.resource_name || '',
    resourceName: r.asset?.resource_name || '',
  }))
}

async function fetchCampaignSitelinks({ api, credentials }, customerId, mccCustomerId, campaignId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const rows = await customer.query(`
    SELECT campaign_asset.status, campaign_asset.resource_name, asset.sitelink_asset.link_text,
      asset.sitelink_asset.description1, asset.sitelink_asset.description2,
      asset.final_urls, asset.resource_name
    FROM campaign_asset
    WHERE campaign_asset.campaign = 'customers/${customerId}/campaigns/${campaignId}'
      AND campaign_asset.field_type = 'SITELINK' AND campaign_asset.status != 'REMOVED'
  `).catch(() => [])
  return rows.map(r => ({
    headline: r.asset?.sitelink_asset?.link_text || '', description1: r.asset?.sitelink_asset?.description1 || '',
    description2: r.asset?.sitelink_asset?.description2 || '', urls: r.asset?.final_urls || [],
    status: assetLinkStatusName(r.campaign_asset?.status), linkResourceName: r.campaign_asset?.resource_name || '',
    resourceName: r.asset?.resource_name || '',
  }))
}

// ── Shared level config for Account / Campaign / Ad Group scoped assets ──────
// Used by Callout and Structured Snippet (Headline/Description use Asset
// Groups instead — see below — since those only exist for Performance Max /
// Demand Gen campaigns, not as customer/campaign/ad-group scoped assets).
function assetLevelConfig(customerId, campaignId, adGroupId, level) {
  if (level === 'account') {
    return {
      resource: 'customer_asset', linkField: 'customer',
      linkValue: `customers/${customerId}`, whereClause: '', createMethod: 'customerAssets',
    }
  }
  if (level === 'campaign') {
    if (!campaignId) throw new Error('Campaign is required for campaign-level assets.')
    const ref = `customers/${customerId}/campaigns/${campaignId}`
    return {
      resource: 'campaign_asset', linkField: 'campaign', linkValue: ref,
      whereClause: `campaign_asset.campaign = '${ref}' AND `, createMethod: 'campaignAssets',
    }
  }
  if (!adGroupId) throw new Error('Ad Group is required for ad-group-level assets.')
  const ref = `customers/${customerId}/adGroups/${adGroupId}`
  return {
    resource: 'ad_group_asset', linkField: 'ad_group', linkValue: ref,
    whereClause: `ad_group_asset.ad_group = '${ref}' AND `, createMethod: 'adGroupAssets',
  }
}

const ASSET_LINK_STATUS_NAME = { '2': 'Enabled', '3': 'Removed', '4': 'Paused', ENABLED: 'Enabled', REMOVED: 'Removed', PAUSED: 'Paused' }
function assetLinkStatusName(raw) { return ASSET_LINK_STATUS_NAME[enumStr(raw)] || enumStr(raw) }

// Pauses/removes an asset LINK (not the underlying asset itself, which is
// generally immutable once created) — works across every asset type that
// uses the customer_asset/campaign_asset/ad_group_asset family (Sitelinks,
// Callouts, Structured Snippets, Call, Headline/Description). Confirmed live:
// Paused goes through a normal status UPDATE, but Removed is rejected by
// that same path ("Enum value 'REMOVED' cannot be used") and must go through
// a dedicated remove() mutate operation — same split already used for
// keywords elsewhere in this app.
async function updateAssetLinkStatus({ api, credentials }, customerId, mccCustomerId, { level, campaignId, adGroupId, linkResourceName, status }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const cfg = assetLevelConfig(customerId, campaignId, adGroupId, level)
  if (!linkResourceName) throw new Error('Asset link resource name is required.')
  try {
    if (status === 'Removed') {
      await customer[cfg.createMethod].remove([linkResourceName])
    } else if (status === 'Paused' || status === 'Enabled') {
      await customer[cfg.createMethod].update([{
        resource_name: linkResourceName,
        status: status === 'Paused' ? enums.AssetLinkStatus.PAUSED : enums.AssetLinkStatus.ENABLED,
      }])
    } else {
      throw new Error(`Invalid status: ${status}`)
    }
    return { success: true, status }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Callout Assets (Account / Campaign / Ad Group level) ─────────────────────

async function fetchCalloutAssets({ api, credentials }, customerId, mccCustomerId, { level, campaignId, adGroupId }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const cfg = assetLevelConfig(customerId, campaignId, adGroupId, level)
  const rows = await customer.query(`
    SELECT ${cfg.resource}.status, ${cfg.resource}.resource_name, asset.callout_asset.callout_text, asset.resource_name
    FROM ${cfg.resource}
    WHERE ${cfg.whereClause}${cfg.resource}.field_type = 'CALLOUT' AND ${cfg.resource}.status != 'REMOVED'
  `).catch(() => [])
  return rows.map(r => ({
    text:         r.asset?.callout_asset?.callout_text || '',
    status:       assetLinkStatusName(r[cfg.resource]?.status),
    linkResourceName: r[cfg.resource]?.resource_name || '',
    resourceName: r.asset?.resource_name || '',
  }))
}

async function publishCallout({ api, credentials }, customerId, mccCustomerId, { level, campaignId, adGroupId, text }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const cfg = assetLevelConfig(customerId, campaignId, adGroupId, level)
  const calloutText = String(text || '').trim().slice(0, 25)
  if (!calloutText) throw new Error('Callout text is required.')
  try {
    const assetsRes = await customer.assets.create([{ callout_asset: { callout_text: calloutText } }])
    const assetRN = assetsRes?.results?.[0]?.resource_name
    if (!assetRN) throw new Error('Asset created but no resource name returned.')
    await customer[cfg.createMethod].create([{ [cfg.linkField]: cfg.linkValue, asset: assetRN, field_type: 11 }])
    return { success: true, resourceName: assetRN }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// Edits the asset's own content in place — confirmed live that Google Ads
// allows this (assets aren't actually immutable, despite update() usually
// being described as create-only elsewhere). IMPORTANT: an asset can be
// linked at more than one level/place at once, and an edit changes the
// shared asset itself — every link to it reflects the new text everywhere,
// not just the level this edit was made from.
async function editCalloutAsset({ api, credentials }, customerId, mccCustomerId, { resourceName, text }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const calloutText = String(text || '').trim().slice(0, 25)
  if (!resourceName) throw new Error('Asset resource name is required.')
  if (!calloutText) throw new Error('Callout text is required.')
  try {
    await customer.assets.update([{ resource_name: resourceName, callout_asset: { callout_text: calloutText } }])
    return { success: true }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Call Assets (Account / Campaign / Ad Group level) ─────────────────────────
// Unlike Callout/Structured Snippet, a call asset has no "creative text" to
// AI-generate — just a phone number, the 2-letter country code it belongs to
// (Google Ads requires both together to validate/format the number), and
// optionally a conversion action to track call conversions against.

const CALL_CONVERSION_REPORTING_STATE_NUM = Object.fromEntries(
  Object.entries(enums.CallConversionReportingState).map(([name, num]) => [String(num), name])
)
function callConversionReportingStateName(raw) {
  const s = enumStr(raw)
  return CALL_CONVERSION_REPORTING_STATE_NUM[s] || s
}
// UI-facing key -> proto enum, and the reverse for reading existing assets back.
const CONVERSION_MODE_ENUM = {
  DISABLED: enums.CallConversionReportingState.DISABLED,
  ACCOUNT:  enums.CallConversionReportingState.USE_ACCOUNT_LEVEL_CALL_CONVERSION_ACTION,
  RESOURCE: enums.CallConversionReportingState.USE_RESOURCE_LEVEL_CALL_CONVERSION_ACTION,
}
const CONVERSION_MODE_FROM_STATE_NAME = {
  DISABLED: 'DISABLED',
  USE_ACCOUNT_LEVEL_CALL_CONVERSION_ACTION:  'ACCOUNT',
  USE_RESOURCE_LEVEL_CALL_CONVERSION_ACTION: 'RESOURCE',
}

// Lightweight list for the Call Asset form's "Conversion Action" dropdown —
// deliberately separate from fetchAccountStructureData's conversionActions
// (that one's bundled into a big multi-purpose audit fetch and omits
// resource_name, which is the one thing this dropdown actually needs).
//
// Only AD_CALL-type conversion actions are valid here — confirmed live:
// Google Ads rejects call_asset.call_conversion_action with AssetError (22)
// "the ConversionAction must be call conversion type" for any other type
// (Lead Form, Website Visit, etc., even though those are otherwise valid
// enabled conversion actions in the account).
async function fetchConversionActionsForDropdown({ api, credentials }, customerId, mccCustomerId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const rows = await customer.query(`
    SELECT conversion_action.resource_name, conversion_action.name
    FROM conversion_action
    WHERE conversion_action.status = 'ENABLED' AND conversion_action.type = 'AD_CALL'
    ORDER BY conversion_action.name
  `).catch(() => [])
  return rows.map(r => ({
    resourceName: r.conversion_action?.resource_name || '',
    name:         r.conversion_action?.name || '',
  })).filter(c => c.resourceName)
}

async function fetchCallAssets({ api, credentials }, customerId, mccCustomerId, { level, campaignId, adGroupId }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const cfg = assetLevelConfig(customerId, campaignId, adGroupId, level)
  const rows = await customer.query(`
    SELECT ${cfg.resource}.status, ${cfg.resource}.resource_name,
      asset.call_asset.phone_number, asset.call_asset.country_code,
      asset.call_asset.call_conversion_reporting_state, asset.call_asset.call_conversion_action,
      asset.resource_name
    FROM ${cfg.resource}
    WHERE ${cfg.whereClause}${cfg.resource}.field_type = 'CALL' AND ${cfg.resource}.status != 'REMOVED'
  `).catch(() => [])
  return rows.map(r => {
    const stateName = callConversionReportingStateName(r.asset?.call_asset?.call_conversion_reporting_state)
    return {
      phoneNumber:  r.asset?.call_asset?.phone_number || '',
      countryCode:  r.asset?.call_asset?.country_code || '',
      conversionMode:               CONVERSION_MODE_FROM_STATE_NAME[stateName] || 'ACCOUNT',
      conversionActionResourceName: r.asset?.call_asset?.call_conversion_action || '',
      status:       assetLinkStatusName(r[cfg.resource]?.status),
      linkResourceName: r[cfg.resource]?.resource_name || '',
      resourceName: r.asset?.resource_name || '',
    }
  })
}

async function publishCallAsset({ api, credentials }, customerId, mccCustomerId, {
  level, campaignId, adGroupId, phoneNumber, countryCode,
  conversionMode = 'ACCOUNT', conversionActionResourceName,
}) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const cfg = assetLevelConfig(customerId, campaignId, adGroupId, level)
  const cleanPhone   = String(phoneNumber || '').trim()
  const cleanCountry = String(countryCode || '').trim().toUpperCase()
  if (!cleanPhone) throw new Error('Phone number is required.')
  if (!/^[A-Z]{2}$/.test(cleanCountry)) throw new Error('Country code must be a 2-letter code (e.g. US).')
  const mode = CONVERSION_MODE_ENUM[conversionMode] ? conversionMode : 'ACCOUNT'
  if (mode === 'RESOURCE' && !conversionActionResourceName)
    throw new Error('Select a conversion action, or choose a different Conversion Action option.')
  try {
    const callAsset = {
      phone_number: cleanPhone, country_code: cleanCountry,
      call_conversion_reporting_state: CONVERSION_MODE_ENUM[mode],
    }
    if (mode === 'RESOURCE') callAsset.call_conversion_action = conversionActionResourceName
    const assetsRes = await customer.assets.create([{ call_asset: callAsset }])
    const assetRN = assetsRes?.results?.[0]?.resource_name
    if (!assetRN) throw new Error('Asset created but no resource name returned.')
    await customer[cfg.createMethod].create([{ [cfg.linkField]: cfg.linkValue, asset: assetRN, field_type: 16 }])
    return { success: true, resourceName: assetRN }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

async function editCallAsset({ api, credentials }, customerId, mccCustomerId, {
  resourceName, phoneNumber, countryCode, conversionMode = 'ACCOUNT', conversionActionResourceName,
}) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const cleanPhone   = String(phoneNumber || '').trim()
  const cleanCountry = String(countryCode || '').trim().toUpperCase()
  if (!resourceName) throw new Error('Asset resource name is required.')
  if (!cleanPhone) throw new Error('Phone number is required.')
  if (!/^[A-Z]{2}$/.test(cleanCountry)) throw new Error('Country code must be a 2-letter code (e.g. US).')
  const mode = CONVERSION_MODE_ENUM[conversionMode] ? conversionMode : 'ACCOUNT'
  if (mode === 'RESOURCE' && !conversionActionResourceName)
    throw new Error('Select a conversion action, or choose a different Conversion Action option.')
  try {
    const callAsset = {
      phone_number: cleanPhone, country_code: cleanCountry,
      call_conversion_reporting_state: CONVERSION_MODE_ENUM[mode],
    }
    if (mode === 'RESOURCE') callAsset.call_conversion_action = conversionActionResourceName
    await customer.assets.update([{ resource_name: resourceName, call_asset: callAsset }])
    return { success: true }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Structured Snippet Assets (Account / Campaign / Ad Group level) ──────────

async function fetchStructuredSnippetAssets({ api, credentials }, customerId, mccCustomerId, { level, campaignId, adGroupId }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const cfg = assetLevelConfig(customerId, campaignId, adGroupId, level)
  const rows = await customer.query(`
    SELECT ${cfg.resource}.status, ${cfg.resource}.resource_name, asset.structured_snippet_asset.header,
      asset.structured_snippet_asset.values, asset.resource_name
    FROM ${cfg.resource}
    WHERE ${cfg.whereClause}${cfg.resource}.field_type = 'STRUCTURED_SNIPPET' AND ${cfg.resource}.status != 'REMOVED'
  `).catch(() => [])
  return rows.map(r => ({
    header:       r.asset?.structured_snippet_asset?.header || '',
    values:       r.asset?.structured_snippet_asset?.values || [],
    status:       assetLinkStatusName(r[cfg.resource]?.status),
    linkResourceName: r[cfg.resource]?.resource_name || '',
    resourceName: r.asset?.resource_name || '',
  }))
}

async function publishStructuredSnippet({ api, credentials }, customerId, mccCustomerId, { level, campaignId, adGroupId, header, values }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const cfg = assetLevelConfig(customerId, campaignId, adGroupId, level)
  const cleanValues = (values || []).map(v => String(v || '').trim().slice(0, 25)).filter(Boolean)
  if (!header?.trim() || cleanValues.length < 3) throw new Error('Structured snippet requires a header and at least 3 values.')
  try {
    const assetsRes = await customer.assets.create([{
      structured_snippet_asset: { header: String(header).trim(), values: cleanValues },
    }])
    const assetRN = assetsRes?.results?.[0]?.resource_name
    if (!assetRN) throw new Error('Asset created but no resource name returned.')
    await customer[cfg.createMethod].create([{ [cfg.linkField]: cfg.linkValue, asset: assetRN, field_type: 12 }])
    return { success: true, resourceName: assetRN }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

async function editStructuredSnippetAsset({ api, credentials }, customerId, mccCustomerId, { resourceName, header, values }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const cleanValues = (values || []).map(v => String(v || '').trim().slice(0, 25)).filter(Boolean)
  if (!resourceName) throw new Error('Asset resource name is required.')
  if (!header?.trim() || cleanValues.length < 3) throw new Error('Structured snippet requires a header and at least 3 values.')
  try {
    await customer.assets.update([{
      resource_name: resourceName,
      structured_snippet_asset: { header: String(header).trim(), values: cleanValues },
    }])
    return { success: true }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Campaign-level Headline / Description text assets ────────────────────────
// Google Ads supports campaign-scoped Headline and Description text assets
// (applied across all RSAs in the campaign) via campaign_asset — the same
// family as Sitelink/Callout/Structured Snippet, NOT asset_group_asset.
// Platform limit: max 3 headlines / 2 descriptions per campaign.
// https://support.google.com/google-ads/answer/13548268

async function fetchCampaignTextAssets({ api, credentials }, customerId, mccCustomerId, { campaignId, fieldType }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  try {
    const rows = await customer.query(`
      SELECT campaign_asset.status, campaign_asset.resource_name, asset.text_asset.text, asset.resource_name
      FROM campaign_asset
      WHERE campaign_asset.campaign = 'customers/${customerId}/campaigns/${campaignId}'
        AND campaign_asset.field_type = '${fieldType}'
        AND campaign_asset.status != 'REMOVED'
    `)
    return rows.map(r => ({
      text:         r.asset?.text_asset?.text || '',
      status:       assetLinkStatusName(r.campaign_asset?.status),
      linkResourceName: r.campaign_asset?.resource_name || '',
      resourceName: r.asset?.resource_name || '',
    }))
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

async function addCampaignTextAsset({ api, credentials }, customerId, mccCustomerId, { campaignId, fieldType, text }) {
  const customer  = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const cleanText = String(text || '').trim()
  if (!cleanText) throw new Error('Text is required.')
  try {
    const assetsRes = await customer.assets.create([{ text_asset: { text: cleanText } }])
    const assetRN   = assetsRes?.results?.[0]?.resource_name
    if (!assetRN) throw new Error('Asset created but no resource name returned.')
    await customer.campaignAssets.create([{
      campaign:   `customers/${customerId}/campaigns/${campaignId}`,
      asset:      assetRN,
      field_type: fieldType === 'HEADLINE' ? 2 : 3,
    }])
    return { success: true, resourceName: assetRN }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

module.exports = {
  createClient, makeCustomer, parseGoogleAdsError, enumStr, n, buildDateClause,
  listSubAccounts, fetchDashboardData,
  fetchCallLeads, fetchWastedSpend, fetchTopConvertingAds, fetchAdCurrentContent,
  fetchTopConvertingKeywords, fetchNegativeData, fetchKeywordIdeas,
  fetchAuditData, fetchReportData, fetchKeywordsWithCalls,
  fetchRSACampaigns, fetchRSAAdGroups, fetchRSABuilderData, fetchRSAReportData,
  fetchSearchTerms, fetchAccountStructureData, fetchKeywordAnalysisData,
  fetchSearchTermAnalysisData, fetchAdPerformanceAnalysisData,
  applyRSAChanges, rollbackRSAChanges, sanitizeDisplayPath,
  updateRSAContents, updateExistingAdContent, enableRSAById, pauseRSAById, removeRSAById,
  publishKeywordToAdGroup,
  fetchAdGroupSitelinks, publishSingleSitelink, editSitelinkAsset,
  publishSitelinkToAccount, publishSitelinkToCampaign,
  fetchAccountSitelinks, fetchCampaignSitelinks,
  fetchCalloutAssets, publishCallout, editCalloutAsset,
  fetchCallAssets, publishCallAsset, editCallAsset, fetchConversionActionsForDropdown,
  updateAssetLinkStatus,
  fetchStructuredSnippetAssets, publishStructuredSnippet, editStructuredSnippetAsset,
  fetchCampaignTextAssets, addCampaignTextAsset,
  fetchNegativeKeywordLists, publishNegativeKeywordsToCampaign, publishNegativeKeywordsToAdGroup,
  fetchNegativeListsForCampaign, fetchCampaignLevelNegatives, fetchAdGroupLevelNegatives,
  removeCampaignLevelNegatives, removeAdGroupLevelNegatives, removeSharedListNegatives,
  fetchKeywordConflictData,
  updateNegativeKeywordStatus,
  isPhoneConversionAction, fetchConversionActionCategoryMap,
}

// Google Ads API proto: KeywordMatchType — EXACT=2, PHRASE=3, BROAD=4
function negMatchEnum(mt) {
  const s = String(mt || '').toLowerCase().trim()
  if (s.includes('exact'))  return 2
  if (s.includes('phrase')) return 3
  return 4 // BROAD is the default
}

// ── Negative Keyword Lists (shared sets) ──────────────────────────────────────
// Google Ads only supports shared NEGATIVE_KEYWORDS lists at the Campaign level
// (via campaign_shared_set) — there is no ad-group-level equivalent. Ad-group
// scoped negatives are added directly as ad_group_criterion below instead.
// https://developers.google.com/google-ads/api/docs/targeting/shared-sets

async function fetchNegativeKeywordLists({ api, credentials }, customerId, mccCustomerId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  try {
    const rows = await customer.query(`
      SELECT shared_set.id, shared_set.name, shared_set.status
      FROM shared_set
      WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status != 'REMOVED'
      ORDER BY shared_set.name
    `)
    return rows.map(r => ({ id: String(r.shared_set?.id || ''), name: r.shared_set?.name || '' }))
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Scoped negative-keyword queries for the split Negative Keywords tabs ──────
// (List / Campaign-level / Ad-group-level) — unlike fetchNegativeData's
// account-wide dump (used by the overview + search-term-recommendation
// flows), these are scoped to a single campaign (or ad group) the user
// selects, matching how the rest of the app scopes its per-campaign views.

const NEG_STATUS_LBL2 = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }
const resolveNegStatus2 = raw => { const s = enumStr(raw); return NEG_STATUS_LBL2[s] || NEG_STATUS_LBL2[s.toUpperCase()] || s }

// Negative keyword LISTS (shared sets) attached to the given campaign, each
// with its member keywords — for an accordion (list title collapsed, expand
// to see its keywords).
async function fetchNegativeListsForCampaign({ api, credentials }, customerId, mccCustomerId, campaignId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const campaignRN = `customers/${customerId}/campaigns/${campaignId}`
  try {
    const linkRows = await customer.query(`
      SELECT campaign_shared_set.shared_set
      FROM campaign_shared_set
      WHERE campaign_shared_set.campaign = '${campaignRN}' AND campaign_shared_set.status != 'REMOVED'
    `)
    const sharedSetRNs = linkRows.map(r => r.campaign_shared_set?.shared_set).filter(Boolean)
    if (sharedSetRNs.length === 0) return []

    const inClause = sharedSetRNs.map(rn => `'${rn}'`).join(',')
    const setRows = await customer.query(`
      SELECT shared_set.id, shared_set.resource_name, shared_set.name, shared_set.status
      FROM shared_set
      WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status != 'REMOVED'
        AND shared_set.resource_name IN (${inClause})
    `)
    const setsByRN = {}
    for (const r of setRows) {
      const rn = r.shared_set?.resource_name
      if (!rn) continue
      setsByRN[rn] = { id: String(r.shared_set?.id || ''), name: r.shared_set?.name || '', status: resolveNegStatus2(r.shared_set?.status), keywords: [] }
    }
    if (Object.keys(setsByRN).length === 0) return []

    const memberRows = await customer.query(`
      SELECT shared_criterion.resource_name, shared_criterion.keyword.text, shared_criterion.keyword.match_type, shared_criterion.shared_set
      FROM shared_criterion
      WHERE shared_criterion.type = 'KEYWORD' AND shared_criterion.shared_set IN (${inClause})
    `)
    for (const r of memberRows) {
      const ss = r.shared_criterion?.shared_set
      if (setsByRN[ss]) {
        setsByRN[ss].keywords.push({
          resourceName: r.shared_criterion?.resource_name || '',
          text: r.shared_criterion?.keyword?.text || '',
          matchType: resolveMatchType(r.shared_criterion?.keyword?.match_type),
        })
      }
    }
    return Object.values(setsByRN).sort((a, b) => a.name.localeCompare(b.name))
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// Negative keywords added directly to the campaign (campaign_criterion) —
// naturally excludes list-based negatives, since those live in
// shared_criterion instead, never in campaign_criterion.
async function fetchCampaignLevelNegatives({ api, credentials }, customerId, mccCustomerId, campaignId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  try {
    const rows = await customer.query(`
      SELECT campaign_criterion.resource_name, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign_criterion.status
      FROM campaign_criterion
      WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'
        AND campaign.id = ${campaignId} AND campaign.status != 'REMOVED'
    `)
    return rows.map(r => ({
      resourceName: r.campaign_criterion?.resource_name || '',
      text: r.campaign_criterion?.keyword?.text || '',
      matchType: resolveMatchType(r.campaign_criterion?.keyword?.match_type),
      status: resolveNegStatus2(r.campaign_criterion?.status),
    }))
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// Negative keywords added directly to the ad group (ad_group_criterion).
async function fetchAdGroupLevelNegatives({ api, credentials }, customerId, mccCustomerId, adGroupId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  try {
    const rows = await customer.query(`
      SELECT ad_group_criterion.resource_name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status
      FROM ad_group_criterion
      WHERE ad_group_criterion.negative = TRUE AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group.id = ${adGroupId} AND campaign.status != 'REMOVED'
    `)
    return rows.map(r => ({
      resourceName: r.ad_group_criterion?.resource_name || '',
      text: r.ad_group_criterion?.keyword?.text || '',
      matchType: resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
      status: resolveNegStatus2(r.ad_group_criterion?.status),
    }))
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Keyword Conflict detection (positive keyword vs negative keyword) ────────
// Account-wide scan: for every enabled positive keyword, check whether a
// campaign-level, ad-group-level, or attached-list negative in the SAME
// campaign/ad group could block it. This is the inverse of the existing
// Keyword Crossover check (positive vs positive) — never conflate the two.
function conflictWords(s) {
  return String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []
}
function negativeBlocksPositive(negText, negMatchType, posText) {
  const negWords = conflictWords(negText)
  const posWords = conflictWords(posText)
  if (negWords.length === 0 || posWords.length === 0) return false
  const negJoined = negWords.join(' ')
  const posJoined = posWords.join(' ')
  if (negMatchType === 'Exact') return negJoined === posJoined
  if (negJoined === posJoined) return true // identical text always conflicts regardless of match type
  if (negMatchType === 'Phrase') return posJoined.includes(negJoined)
  // Broad: every negative word must appear somewhere among the positive's words
  return negWords.every(w => posWords.includes(w))
}

async function fetchKeywordConflictData({ api, credentials }, customerId, mccCustomerId) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)

  const [posRows, campNegRows, agNegRows, listLinkRows] = await Promise.all([
    customer.query(`
      SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
        campaign.id, campaign.name, ad_group.id, ad_group.name
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE
        AND ad_group_criterion.status = 'ENABLED'
        AND campaign.status = 'ENABLED' AND ad_group.status = 'ENABLED'
      LIMIT 2000
    `).catch(() => []),
    customer.query(`
      SELECT campaign_criterion.resource_name, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign.id, campaign.name
      FROM campaign_criterion
      WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'
        AND campaign_criterion.status = 'ENABLED' AND campaign.status = 'ENABLED'
      LIMIT 1000
    `).catch(() => []),
    customer.query(`
      SELECT ad_group_criterion.resource_name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
        ad_group.id, ad_group.name, campaign.id, campaign.name
      FROM ad_group_criterion
      WHERE ad_group_criterion.negative = TRUE AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status = 'ENABLED' AND campaign.status = 'ENABLED'
      LIMIT 1000
    `).catch(() => []),
    customer.query(`
      SELECT campaign_shared_set.shared_set, campaign.id, campaign.name
      FROM campaign_shared_set
      WHERE campaign_shared_set.status != 'REMOVED' AND campaign.status = 'ENABLED'
    `).catch(() => []),
  ])

  const positives = posRows.map(r => ({
    text: r.ad_group_criterion?.keyword?.text || '',
    matchType: resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
    campaignId: String(r.campaign?.id || ''), campaign: r.campaign?.name || '—',
    adGroupId: String(r.ad_group?.id || ''), adGroup: r.ad_group?.name || '—',
  })).filter(k => k.text)

  const campNegatives = campNegRows.map(r => ({
    resourceName: r.campaign_criterion?.resource_name || '',
    text: r.campaign_criterion?.keyword?.text || '',
    matchType: resolveMatchType(r.campaign_criterion?.keyword?.match_type),
    campaignId: String(r.campaign?.id || ''), campaign: r.campaign?.name || '—',
  })).filter(k => k.text)

  const agNegatives = agNegRows.map(r => ({
    resourceName: r.ad_group_criterion?.resource_name || '',
    text: r.ad_group_criterion?.keyword?.text || '',
    matchType: resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
    adGroupId: String(r.ad_group?.id || ''), campaignId: String(r.campaign?.id || ''), campaign: r.campaign?.name || '—',
  })).filter(k => k.text)

  // List-level: which shared sets are attached to which campaigns, then pull each set's keyword members
  const setRNsByCampaign = {} // campaignId -> [sharedSetRN]
  const allSetRNs = new Set()
  for (const r of listLinkRows) {
    const rn = r.campaign_shared_set?.shared_set
    const cid = String(r.campaign?.id || '')
    if (!rn || !cid) continue
    allSetRNs.add(rn)
    if (!setRNsByCampaign[cid]) setRNsByCampaign[cid] = []
    setRNsByCampaign[cid].push(rn)
  }
  let listNegativesByCampaign = {} // campaignId -> [{text, matchType, listName}]
  if (allSetRNs.size > 0) {
    const inClause = [...allSetRNs].map(rn => `'${rn}'`).join(',')
    const [setRows, memberRows] = await Promise.all([
      customer.query(`
        SELECT shared_set.resource_name, shared_set.name FROM shared_set
        WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status != 'REMOVED'
          AND shared_set.resource_name IN (${inClause})
      `).catch(() => []),
      customer.query(`
        SELECT shared_criterion.resource_name, shared_criterion.keyword.text, shared_criterion.keyword.match_type, shared_criterion.shared_set
        FROM shared_criterion
        WHERE shared_criterion.type = 'KEYWORD' AND shared_criterion.shared_set IN (${inClause})
      `).catch(() => []),
    ])
    const nameByRN = Object.fromEntries(setRows.map(r => [r.shared_set?.resource_name, r.shared_set?.name || '']))
    const membersByRN = {}
    for (const r of memberRows) {
      const rn = r.shared_criterion?.shared_set
      if (!rn) continue
      if (!membersByRN[rn]) membersByRN[rn] = []
      membersByRN[rn].push({
        resourceName: r.shared_criterion?.resource_name || '',
        text: r.shared_criterion?.keyword?.text || '',
        matchType: resolveMatchType(r.shared_criterion?.keyword?.match_type),
        listName: nameByRN[rn] || '',
      })
    }
    for (const [cid, rns] of Object.entries(setRNsByCampaign)) {
      listNegativesByCampaign[cid] = rns.flatMap(rn => membersByRN[rn] || [])
    }
  }

  const SEVERITY = { self: 'Critical', broad: 'High', phrase: 'Medium' }
  const conflicts = []
  for (const pos of positives) {
    const candidates = [
      ...campNegatives.filter(n => n.campaignId === pos.campaignId).map(n => ({ ...n, level: 'CAMPAIGN' })),
      ...agNegatives.filter(n => n.adGroupId === pos.adGroupId).map(n => ({ ...n, level: 'AD_GROUP' })),
      ...(listNegativesByCampaign[pos.campaignId] || []).map(n => ({ ...n, level: 'LIST' })),
    ]
    for (const neg of candidates) {
      if (!negativeBlocksPositive(neg.text, neg.matchType, pos.text)) continue
      const isSelf = conflictWords(neg.text).join(' ') === conflictWords(pos.text).join(' ')
      const kind = isSelf ? 'self' : neg.matchType === 'Broad' ? 'broad' : 'phrase'
      conflicts.push({
        positiveKeyword: pos.text, positiveMatchType: pos.matchType,
        negativeKeyword: neg.text, negativeMatchType: neg.matchType, negativeLevel: neg.level,
        negativeResourceName: neg.resourceName || '',
        listName: neg.listName || '',
        campaign: pos.campaign, adGroup: pos.adGroup,
        conflictType: isSelf ? 'Self-Negation' : neg.matchType === 'Broad' ? 'Broad Negative Overlap' : 'Phrase Negative Overlap',
        severity: SEVERITY[kind],
        explanation: isSelf
          ? `The negative keyword "${neg.text}" (${neg.matchType}) exactly matches the positive keyword "${pos.text}", so this positive keyword can never show.`
          : `The ${neg.level.toLowerCase().replace('_',' ')} negative "${neg.text}" (${neg.matchType}) can block searches matching the positive keyword "${pos.text}".`,
        recommendation: isSelf
          ? `Remove the negative "${neg.text}" or remove the positive keyword "${pos.text}" — they cannot both work.`
          : `Review whether "${neg.text}" should stay ${neg.level === 'LIST' ? `in the list "${neg.listName}"` : `at the ${neg.level.toLowerCase().replace('_',' ')} level`}; consider narrowing its match type or excluding "${pos.text}" from its scope.`,
      })
    }
  }

  return { conflicts }
}

// Pauses (or re-enables) a campaign-level or ad-group-level negative keyword.
// List-level (shared_criterion) negatives don't support a PAUSED status in
// the Google Ads API — only ENABLED/REMOVED — so this only accepts
// level CAMPAIGN or AD_GROUP; callers should offer Remove instead for LIST.
async function updateNegativeKeywordStatus({ api, credentials }, customerId, mccCustomerId, { level, resourceName, newStatus, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  if (!resourceName) throw new Error('A negative keyword is required.')
  const statusEnum = newStatus === 'Paused' ? enums.CampaignCriterionStatus.PAUSED : enums.CampaignCriterionStatus.ENABLED
  const vOpt = validateOnly ? { validate_only: true } : undefined
  try {
    if (level === 'CAMPAIGN') {
      await customer.campaignCriteria.update([{ resource_name: resourceName, status: statusEnum }], vOpt)
    } else if (level === 'AD_GROUP') {
      await customer.adGroupCriteria.update([{ resource_name: resourceName, status: statusEnum }], vOpt)
    } else {
      throw new Error('List-level negative keywords cannot be paused — remove them instead.')
    }
    return { success: true, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// ── Remove negative keywords ───────────────────────────────────────────────
// Bulk remove by resource name — one call per level, matching the resource
// each was actually created on. Removing a shared-list member removes it
// from every campaign that list is attached to (not just the one the user
// was viewing when they removed it) — the frontend surfaces that clearly
// before confirming, same as it already does for a shared list's other risks.

async function removeCampaignLevelNegatives({ api, credentials }, customerId, mccCustomerId, { resourceNames, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const rns = (resourceNames || []).filter(Boolean)
  if (rns.length === 0) throw new Error('No negative keywords selected.')
  try {
    await customer.campaignCriteria.remove(rns, validateOnly ? { validate_only: true } : undefined)
    return { success: true, count: rns.length, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

async function removeAdGroupLevelNegatives({ api, credentials }, customerId, mccCustomerId, { resourceNames, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const rns = (resourceNames || []).filter(Boolean)
  if (rns.length === 0) throw new Error('No negative keywords selected.')
  try {
    await customer.adGroupCriteria.remove(rns, validateOnly ? { validate_only: true } : undefined)
    return { success: true, count: rns.length, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

async function removeSharedListNegatives({ api, credentials }, customerId, mccCustomerId, { resourceNames, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const rns = (resourceNames || []).filter(Boolean)
  if (rns.length === 0) throw new Error('No negative keywords selected.')
  try {
    await customer.sharedCriteria.remove(rns, validateOnly ? { validate_only: true } : undefined)
    return { success: true, count: rns.length, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// Resolves the REAL resource name Google Ads assigned to a mutateResources
// operation by position (same pattern as campaignClient.js's own
// resultResourceName — duplicated locally rather than imported, since
// campaignClient.js itself imports FROM this file and importing back would
// be circular).
function localResultResourceName(mutateResult, opIndex, fallback) {
  const r = mutateResult?.mutate_operation_responses?.[opIndex]
  if (!r) return fallback
  const key = Object.keys(r).find(k => k.endsWith('_result'))
  return (key && r[key]?.resource_name) || fallback
}

async function publishNegativeKeywordsToCampaign({ api, credentials }, customerId, mccCustomerId, { campaignId, listMode, listName, sharedSetId, keywords, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  if (!campaignId) throw new Error('Campaign is required.')
  const kws = (keywords || [])
    .map(k => ({ text: String(k.text || '').trim(), match_type: negMatchEnum(k.matchType) }))
    .filter(k => k.text)
  if (kws.length === 0) throw new Error('No valid keywords to publish.')
  const vOpt = validateOnly ? { validate_only: true } : undefined

  try {
    // Direct campaign-level negatives (no shared list)
    if (listMode === 'none') {
      const campaignRN = `customers/${customerId}/campaigns/${campaignId}`
      await customer.campaignCriteria.create(
        kws.map(keyword => ({ campaign: campaignRN, negative: true, keyword })), vOpt
      )
      return { success: true, count: kws.length, validateOnly: !!validateOnly }
    }

    // List mode (new or existing) — built as ONE atomic mutateResources call
    // (list create + keyword-criteria create + campaign-attach) instead of
    // three sequential single-resource .create() calls, for two reasons:
    // it's the only way validate_only can genuinely preview a brand-new
    // list (the temp resource-name cross-referencing this atomic API
    // supports doesn't work through the single-resource convenience
    // methods used elsewhere — confirmed live, referencing an invented
    // "-1" shared set id through .create() just 404s), and it removes the
    // partial-failure risk of the old sequential version (e.g. list
    // created with no keywords, or keywords added but never attached to
    // the campaign, if a later step failed).
    if (listMode === 'existing' && !sharedSetId) throw new Error('Select an existing negative keyword list.')
    if (listMode === 'new' && !String(listName || '').trim()) throw new Error('A name is required for the new negative keyword list.')

    const campaignRN = `customers/${customerId}/campaigns/${campaignId}`
    const mutateOps = []
    let sharedSetRN
    let sharedSetOpIdx = -1

    if (listMode === 'new') {
      sharedSetRN = ResourceNames.sharedSet(customerId, '-1')
      sharedSetOpIdx = mutateOps.length
      mutateOps.push({
        entity: 'shared_set', operation: 'create',
        resource: { resource_name: sharedSetRN, name: String(listName).trim(), type: enums.SharedSetType.NEGATIVE_KEYWORDS, status: enums.SharedSetStatus.ENABLED },
      })
    } else {
      sharedSetRN = ResourceNames.sharedSet(customerId, sharedSetId)
    }

    kws.forEach(keyword => {
      mutateOps.push({ entity: 'shared_criterion', operation: 'create', resource: { shared_set: sharedSetRN, keyword } })
    })

    // Skip the attach op when previewing a brand-new list (there's no real
    // list yet to check attachment against) or when already attached.
    let alreadyAttached = false
    if (listMode === 'existing') {
      const existingLinks = await customer.query(`
        SELECT campaign_shared_set.shared_set
        FROM campaign_shared_set
        WHERE campaign_shared_set.campaign = '${campaignRN}'
          AND campaign_shared_set.status != 'REMOVED'
      `).catch(() => [])
      alreadyAttached = existingLinks.some(r => r.campaign_shared_set?.shared_set === sharedSetRN)
    }
    if (!alreadyAttached) {
      mutateOps.push({ entity: 'campaign_shared_set', operation: 'create', resource: { campaign: campaignRN, shared_set: sharedSetRN } })
    }

    const result = await customer.mutateResources(mutateOps, vOpt)
    if (validateOnly) return { success: true, count: kws.length, validateOnly: true }

    const realSharedSetRN = listMode === 'new' ? localResultResourceName(result, sharedSetOpIdx, sharedSetRN) : sharedSetRN
    return { success: true, count: kws.length, sharedSetResourceName: realSharedSetRN }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

async function publishNegativeKeywordsToAdGroup({ api, credentials }, customerId, mccCustomerId, { adGroupId, keywords, validateOnly }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  if (!adGroupId) throw new Error('Ad Group is required.')
  const items = (keywords || [])
    .map(k => ({ text: String(k.text || '').trim(), matchType: negMatchEnum(k.matchType) }))
    .filter(k => k.text)
  if (items.length === 0) throw new Error('No valid keywords to publish.')

  try {
    // See findAdGroupCriterionMatch below — same identity-collision check,
    // applied per keyword in this batch. Google only locks (ad group, text,
    // match type) + negative while a conflicting criterion is still LIVE
    // (ENABLED/PAUSED) — confirmed live that a REMOVED one imposes no
    // restriction at all, a fresh create succeeds regardless of its old
    // negative value. So: REMOVED match -> always create fresh (ignore its
    // old type); live match with the SAME type -> reactivate instead of a
    // duplicate create; live match with the OPPOSITE type -> genuinely
    // blocked, fails the whole batch up front rather than silently
    // publishing the rest and hiding the one that can never work.
    const toCreate     = []
    const toReactivate = []
    const blocked      = []
    for (const item of items) {
      const existing = await findAdGroupCriterionMatch(customer, adGroupId, item.text, item.matchType)
      if (!existing || existing.status === 'REMOVED') toCreate.push(item)
      else if (existing.negative) { if (existing.status !== 'ENABLED') toReactivate.push(existing.resourceName) }
      else blocked.push(item.text)
    }
    if (blocked.length > 0) {
      throw blocked.length === 1
        ? adGroupCriterionCollisionError(blocked[0], true)
        : new Error(`Can't add these as negative keywords in this ad group — they're currently active there as keywords, and Google Ads won't let the two coexist: ${blocked.join(', ')}. Pause or remove the existing keywords first, use a different match type, or target a different ad group or the campaign level instead.`)
    }

    const vOpt = validateOnly ? { validate_only: true } : undefined
    if (toReactivate.length) await customer.adGroupCriteria.update(toReactivate.map(rn => ({ resource_name: rn, status: 2 })), vOpt)
    if (toCreate.length) {
      await customer.adGroupCriteria.create(toCreate.map(item => ({
        ad_group: `customers/${customerId}/adGroups/${adGroupId}`,
        status:   2, // ENABLED
        negative: true,
        keyword:  { text: item.text, match_type: item.matchType },
      })), vOpt)
    }
    return { success: true, count: items.length, reactivated: toReactivate.length, validateOnly: !!validateOnly }
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
}

// A given (ad group, keyword text, match type) only locks its
// positive/negative type while a conflicting criterion is still LIVE
// (ENABLED or PAUSED) — confirmed live both ways: creating or updating the
// opposite type against a LIVE criterion fails with IMMUTABLE_FIELD, but
// once that criterion is REMOVED, Google imposes no restriction at all —
// a fresh create succeeds for EITHER type, ignoring the removed one's old
// value entirely (this is exactly what the Switch K<->NK flow relies on,
// since it always removes the old criterion before creating the new one).
// Before creating a new ad_group_criterion keyword, look up whether that
// exact identity already exists:
//   - no match, or match is REMOVED -> proceed with a normal create.
//   - live match (ENABLED/PAUSED), same type -> reactivate it instead of
//     creating a duplicate, which Google would otherwise reject.
//   - live match, opposite type -> genuinely blocked right now; fail fast
//     with a clear message instead of a doomed create call.
async function findAdGroupCriterionMatch(customer, adGroupId, text, matchTypeEnumValue) {
  const rows = await customer.query(`
    SELECT ad_group_criterion.resource_name, ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type, ad_group_criterion.negative, ad_group_criterion.status
    FROM ad_group_criterion
    WHERE ad_group.id = ${adGroupId} AND ad_group_criterion.type = 'KEYWORD'
  `).catch(() => [])
  const norm = s => String(s || '').trim().toLowerCase()
  const targetText = norm(text)
  // This field comes back as a raw numeric code in this API version (same
  // as conversion_action.type/.category elsewhere in this file) — normalize
  // to the readable label so callers can compare against 'REMOVED'/'ENABLED'
  // instead of guessing whether it's "4" or "REMOVED" this time.
  const STATUS_LBL = { ENABLED: 'ENABLED', PAUSED: 'PAUSED', REMOVED: 'REMOVED', '2': 'ENABLED', '3': 'PAUSED', '4': 'REMOVED' }
  for (const r of rows) {
    const c = r.ad_group_criterion
    if (norm(c?.keyword?.text) === targetText && enumStr(c?.keyword?.match_type) === enumStr(matchTypeEnumValue)) {
      const statusRaw = enumStr(c?.status)
      return { resourceName: c.resource_name, negative: !!c.negative, status: STATUS_LBL[statusRaw] || statusRaw }
    }
  }
  return null
}

function adGroupCriterionCollisionError(text, wantNegative) {
  const wanted  = wantNegative ? 'negative keyword' : 'keyword'
  const existing = wantNegative ? 'keyword' : 'negative keyword'
  return new Error(`Can't add "${text}" as a ${wanted} in this ad group — it's currently active there as a ${existing}, and Google Ads won't let the two coexist. Pause or remove the existing ${existing} first, use a different match type, or target a different ad group${wantNegative ? ' (or the campaign level)' : ''} instead.`)
}

async function publishKeywordToAdGroup({ api, credentials }, customerId, mccCustomerId, { adGroupId, keywordText, matchType }) {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  function toMatchEnum(mt) {
    const s = String(mt || '').toLowerCase().trim()
    if (s.includes('exact'))  return 2
    if (s.includes('phrase')) return 3
    return 4
  }
  const text = String(keywordText).trim()
  const matchEnum = toMatchEnum(matchType)
  try {
    const existing = await findAdGroupCriterionMatch(customer, adGroupId, text, matchEnum)
    // A REMOVED match imposes no restriction at all (confirmed live) — only
    // a LIVE (ENABLED/PAUSED) match with the opposite type is genuinely
    // blocked. A REMOVED criterion is also NOT addressable by an explicit
    // UPDATE (Google rejects that with RESOURCE_NOT_FOUND, confirmed live) —
    // the only way to bring a REMOVED one back is a plain CREATE with the
    // same identity, which Google silently restores instead of erroring. A
    // PAUSED criterion, being a live resource, updates normally.
    if (existing && existing.status !== 'REMOVED') {
      if (existing.negative) throw adGroupCriterionCollisionError(text, false)
      if (existing.status === 'ENABLED') return { success: true }
      await customer.adGroupCriteria.update([{ resource_name: existing.resourceName, status: 2 }])
      return { success: true, reactivated: true }
    }
    // No match, or the match is REMOVED — either way a plain create is safe
    // (and restores the removed one, if that's what this is).
    await customer.adGroupCriteria.create([{
      ad_group: `customers/${customerId}/adGroups/${adGroupId}`,
      status:   2, // ENABLED
      keyword:  { text, match_type: matchEnum },
    }])
  } catch (e) {
    throw new Error(parseGoogleAdsError(e))
  }
  return { success: true }
}
