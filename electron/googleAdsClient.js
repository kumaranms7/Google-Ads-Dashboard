'use strict'

const dayjs = require('dayjs')

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

// Returns a full "segments.date ..." clause — avoids DURING keyword which
// is not supported by some resources (e.g. call_view in certain API versions).
function buildDateClause(dateRange) {
  if (dateRange && typeof dateRange === 'object' && dateRange.startDate) {
    return `segments.date BETWEEN '${dateRange.startDate}' AND '${dateRange.endDate}'`
  }
  const today = new Date()
  const fmt   = d => d.toISOString().split('T')[0]
  const ago   = days => { const d = new Date(today); d.setDate(d.getDate() - days); return d }
  const presets = {
    TODAY:        `segments.date = '${fmt(today)}'`,
    YESTERDAY:    `segments.date = '${fmt(ago(1))}'`,
    LAST_7_DAYS:  `segments.date BETWEEN '${fmt(ago(7))}' AND '${fmt(today)}'`,
    LAST_14_DAYS: `segments.date BETWEEN '${fmt(ago(14))}' AND '${fmt(today)}'`,
    LAST_30_DAYS: `segments.date BETWEEN '${fmt(ago(30))}' AND '${fmt(today)}'`,
    LAST_90_DAYS: `segments.date BETWEEN '${fmt(ago(90))}' AND '${fmt(today)}'`,
    THIS_MONTH:   `segments.date BETWEEN '${fmt(new Date(today.getFullYear(), today.getMonth(), 1))}' AND '${fmt(today)}'`,
    LAST_MONTH:   `segments.date BETWEEN '${fmt(new Date(today.getFullYear(), today.getMonth()-1, 1))}' AND '${fmt(new Date(today.getFullYear(), today.getMonth(), 0))}'`,
  }
  return presets[dateRange] ?? `segments.date BETWEEN '${fmt(ago(30))}' AND '${fmt(today)}'`
}

function getPreviousPeriodClause(dateRange) {
  if (typeof dateRange !== 'string') {
    if (!dateRange?.startDate || !dateRange?.endDate) return null
    const start = dayjs(dateRange.startDate)
    const end   = dayjs(dateRange.endDate)
    const days  = end.diff(start, 'day') + 1
    const prevEnd   = start.subtract(1, 'day')
    const prevStart = prevEnd.subtract(days - 1, 'day')
    return `segments.date BETWEEN '${prevStart.format('YYYY-MM-DD')}' AND '${prevEnd.format('YYYY-MM-DD')}'`
  }
  const yesterday = dayjs().subtract(1, 'day')
  const map = {
    TODAY: { days:1, end: dayjs() }, YESTERDAY: { days:1, end:yesterday },
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

function parseKpiRow(row) {
  const m = row.metrics
  const spend = n(m.cost_micros) / 1_000_000
  const allConvVal = n(m.all_conversions_value ?? 0)
  return {
    impressions: n(m.impressions),
    clicks:      n(m.clicks),
    spend,
    conversions: n(m.conversions),
    ctr:         n(m.ctr) * 100,
    avgCpc:      n(m.average_cpc) / 1_000_000,
    convRate:    n(m.conversions_from_interactions_rate) * 100,
    roas:        spend > 0 ? allConvVal / spend : 0,
    phoneCalls:  n(m.phone_calls ?? 0),
    phoneImpressions: n(m.phone_impressions ?? 0),
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
  5:'Hotel', 6:'Video', 7:'Performance Max', 8:'Local', 9:'Smart',
  10:'Performance Max', 11:'Local Services', 12:'Demand Gen', 13:'Travel', 14:'Demand Gen',
  // String enum names
  SEARCH:'Search', DISPLAY:'Display', SHOPPING:'Shopping', VIDEO:'Video',
  MULTI_CHANNEL:'Performance Max', SMART:'Smart', LOCAL:'Local',
  DISCOVERY:'Demand Gen', PERFORMANCE_MAX:'Performance Max',
  DEMAND_GEN:'Demand Gen', HOTEL:'Hotel', LOCAL_SERVICES:'Local Services',
  TRAVEL:'Travel', UNKNOWN:'Unknown', UNSPECIFIED:'Other',
}

// ── List sub-accounts ─────────────────────────────────────────────────────────

async function listSubAccounts({ api, credentials }, mccCustomerId) {
  const cleanId = String(mccCustomerId).replace(/-/g, '')
  const manager = api.Customer({
    customer_id: cleanId, refresh_token: credentials.refreshToken, login_customer_id: cleanId,
  })
  const rows = await manager.query(`
    SELECT customer_client.id, customer_client.descriptive_name,
      customer_client.currency_code, customer_client.time_zone,
      customer_client.manager, customer_client.status
    FROM customer_client
    WHERE customer_client.manager = false AND customer_client.status = 'ENABLED'
    ORDER BY customer_client.descriptive_name
  `)
  return rows.map(r => ({
    id:           String(r.customer_client.id),
    name:         r.customer_client.descriptive_name || `Account ${r.customer_client.id}`,
    currencyCode: r.customer_client.currency_code || 'USD',
    timeZone:     r.customer_client.time_zone     || 'UTC',
  }))
}

// ── Dashboard data ────────────────────────────────────────────────────────────

async function fetchDashboardData({ api, credentials }, customerId, mccCustomerId, dateRange) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange)
  const prevClause = getPreviousPeriodClause(dateRange)

  // phone_calls/phone_impressions are only available when call tracking is enabled.
  // Keep them in a SEPARATE query so a missing-metric error cannot zero-out the
  // core KPI row for all accounts.
  const [kpiRows, prevRows, dailyRows, campaignRows, deviceRows, kwRows, budgetRows, wastedRows, phoneRows, callCountRows] =
    await Promise.all([
      // Core KPIs — always available
      customer.query(`
        SELECT metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.all_conversions_value, metrics.ctr,
          metrics.average_cpc, metrics.conversions_from_interactions_rate
        FROM customer WHERE ${dateClause}
      `).catch(() => []),

      // Previous period
      prevClause ? customer.query(`
        SELECT metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.all_conversions_value, metrics.ctr,
          metrics.average_cpc, metrics.conversions_from_interactions_rate
        FROM customer WHERE ${prevClause}
      `).catch(() => []) : Promise.resolve([]),

      customer.query(`
        SELECT segments.date, metrics.impressions, metrics.clicks,
          metrics.cost_micros, metrics.conversions
        FROM customer WHERE ${dateClause} ORDER BY segments.date
      `).catch(() => []),

      customer.query(`
        SELECT campaign.name, campaign.status,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.average_cpc
        FROM campaign
        WHERE campaign.status != 'REMOVED' AND ${dateClause}
        ORDER BY metrics.cost_micros DESC LIMIT 20
      `).catch(() => []),

      customer.query(`
        SELECT segments.device, metrics.clicks, metrics.cost_micros
        FROM customer WHERE ${dateClause}
      `).catch(() => []),

      customer.query(`
        SELECT ad_group_criterion.keyword.text,
          ad_group_criterion.quality_info.quality_score, metrics.clicks
        FROM keyword_view
        WHERE ${dateClause}
          AND ad_group_criterion.status != 'REMOVED'
        ORDER BY metrics.clicks DESC LIMIT 10
      `).catch(() => []),

      customer.query(`
        SELECT campaign.name, campaign.status,
          campaign_budget.amount_micros, metrics.cost_micros
        FROM campaign
        WHERE campaign.status != 'REMOVED' AND ${dateClause}
        ORDER BY campaign_budget.amount_micros DESC LIMIT 20
      `).catch(() => []),

      // Wasted spend: keywords with spend and 0 conversions
      customer.query(`
        SELECT metrics.cost_micros
        FROM keyword_view
        WHERE metrics.cost_micros > 1000000
          AND metrics.conversions < 1
          AND ${dateClause}
      `).catch(() => []),

      // Phone metrics — campaign-level (customer-level often returns 0 for call tracking)
      customer.query(`
        SELECT campaign.id, metrics.phone_calls, metrics.phone_impressions
        FROM campaign WHERE metrics.phone_impressions > 0 AND ${dateClause}
      `).catch(() => []),

      // Call view count — try with date filter; catch all errors silently
      customer.query(`
        SELECT call_view.call_status, call_view.call_duration_seconds
        FROM call_view
        WHERE ${dateClause}
      `).catch(err => { console.error('[dashboard call_view]', err.message); return [] }),
    ])

  const kpis         = kpiRows.length  ? parseKpiRow(kpiRows[0])  : { ...ZERO_KPIS }
  const previousKpis = prevRows.length ? parseKpiRow(prevRows[0]) : null

  // Merge call metrics — prefer call_view count (counts ALL calls, no duration threshold)
  // Fall back to summed campaign-level phone_calls if call_view fails
  const campaignPhoneCalls = phoneRows.reduce((s, r) => s + n(r.metrics?.phone_calls ?? 0), 0)
  if (callCountRows.length > 0) {
    kpis.phoneCalls = callCountRows.length
    kpis.connectedCalls = callCountRows.filter(r => {
      const s = enumStr(r.call_view?.call_status)
      return s === 'RECEIVED' || s === '2'
    }).length
  } else if (campaignPhoneCalls > 0) {
    kpis.phoneCalls     = campaignPhoneCalls
    kpis.connectedCalls = 0
  }

  // Wasted spend total
  const wastedSpend = wastedRows.reduce((s, r) => s + n(r.metrics?.cost_micros ?? 0) / 1e6, 0)

  const dailySeries = dailyRows.map(r => ({
    date: r.segments.date,
    impressions: n(r.metrics.impressions), clicks: n(r.metrics.clicks),
    spend: n(r.metrics.cost_micros) / 1_000_000, conversions: n(r.metrics.conversions),
  }))

  const campaigns = campaignRows.map(r => ({
    name:        r.campaign.name,
    status:      STATUS_MAP[enumStr(r.campaign.status)] || enumStr(r.campaign.status),
    impressions: n(r.metrics.impressions), clicks: n(r.metrics.clicks),
    cpc: n(r.metrics.average_cpc) / 1_000_000, conversions: n(r.metrics.conversions),
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
    text: r.ad_group_criterion?.keyword?.text || '—',
    qualityScore: n(r.ad_group_criterion?.quality_info?.quality_score ?? 0),
    clicks: n(r.metrics.clicks),
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
    dailySeries, campaigns, deviceSplit, keywords, budget,
  }
}

// ── Phone call leads ──────────────────────────────────────────────────────────

// Safely read a call_view field — handles both snake_case and camelCase library responses
function cvField(row, snake, camel) {
  const obj = row.call_view ?? row.callView ?? {}
  return obj[snake] ?? obj[camel] ?? null
}

// Returns { startDate, endDate } as 'YYYY-MM-DD' strings
function dateRangeBounds(dateRange) {
  const today = new Date()
  const fmt   = d => d.toISOString().split('T')[0]
  const ago   = days => { const d = new Date(today); d.setDate(d.getDate() - days); return d }
  if (dateRange && typeof dateRange === 'object' && dateRange.startDate) {
    return { startDate: dateRange.startDate, endDate: dateRange.endDate }
  }
  const map = {
    TODAY: { startDate: fmt(today), endDate: fmt(today) },
    YESTERDAY: { startDate: fmt(ago(1)), endDate: fmt(ago(1)) },
    LAST_7_DAYS: { startDate: fmt(ago(7)), endDate: fmt(today) },
    LAST_14_DAYS: { startDate: fmt(ago(14)), endDate: fmt(today) },
    LAST_30_DAYS: { startDate: fmt(ago(30)), endDate: fmt(today) },
    LAST_90_DAYS: { startDate: fmt(ago(90)), endDate: fmt(today) },
    THIS_MONTH: { startDate: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), endDate: fmt(today) },
    LAST_MONTH: { startDate: fmt(new Date(today.getFullYear(), today.getMonth()-1, 1)), endDate: fmt(new Date(today.getFullYear(), today.getMonth(), 0)) },
  }
  return map[dateRange] ?? { startDate: fmt(ago(30)), endDate: fmt(today) }
}

async function fetchCallLeads({ api, credentials }, customerId, mccCustomerId, dateRange) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange)

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
      campaign.id,
      campaign.name
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
    const rows = await customer.query(`${CALL_VIEW_SQL}\n    WHERE ${dateClause}`)
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
        const { startDate, endDate } = dateRangeBounds(dateRange)
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

  // Phone metrics fallback — campaign-level sum
  let phoneRows = []
  try {
    phoneRows = await customer.query(`
      SELECT campaign.id, campaign.name, metrics.phone_calls
      FROM campaign WHERE ${dateClause}
    `)
  } catch (_) { /* silent */ }

  // Capture raw call_view structure from the first row so the frontend can log it
  if (rawCalls.length > 0) {
    const r0     = rawCalls[0]
    const cv0    = r0.call_view ?? r0.callView ?? {}
    _debug.rawCallViewKeys     = Object.keys(cv0)
    _debug.rawCallSourceDirect = cv0['call_tracking_display_condition'] ?? cv0['callTrackingDisplayCondition'] ?? 'NOT_FOUND'
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
        callerPhoneNumber: '',
        callStatus: enumStr(cv['call_status'] ?? cv['callStatus'] ?? ''),
        callType:   '',
        callSource: '',
        campaignId:   String(row.campaign?.id ?? ''),
        campaignName: row.campaign?.name      ?? '—',
      }
    })
    .sort((a, b) => (b.startTime > a.startTime ? 1 : b.startTime < a.startTime ? -1 : 0))

  const callViewTotal     = calls.length
  const phoneMetricsTotal = phoneRows.reduce((s, r) => s + n(r.metrics?.phone_calls ?? 0), 0)
  const totalCalls        = callViewTotal > 0 ? callViewTotal : phoneMetricsTotal

  const connectedCalls = calls.filter(c => {
    const s = String(c.callStatus).toUpperCase()
    return s === 'RECEIVED' || s === '2'
  }).length

  const totalDuration      = calls.reduce((s, c) => s + c.durationSeconds, 0)
  const avgDurationSeconds = calls.length > 0 ? Math.round(totalDuration / calls.length) : 0

  return {
    calls,
    summary: { totalCalls, connectedCalls, avgDurationSeconds, totalCost: 0, costPerCall: 0 },
    campaignMetrics: phoneRows.map(r => ({
      campaignId:   String(r.campaign?.id ?? ''),
      campaignName: r.campaign?.name      ?? '—',
      phoneCalls:   n(r.metrics?.phone_calls ?? 0),
    })),
    _debug,
  }
}

// ── Wasted spend keywords ─────────────────────────────────────────────────────

async function fetchWastedSpend({ api, credentials }, customerId, mccCustomerId, dateRange, thresholdMicros = 10000000) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange)

  const WASTED_STATUS_LBL = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }
  const resolveWastedStatus = raw => { const s = enumStr(raw); return WASTED_STATUS_LBL[s] || WASTED_STATUS_LBL[s.toUpperCase()] || s }

  const rows = await customer.query(`
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
      ad_group_criterion.status, campaign.name, campaign.status, ad_group.name,
      metrics.cost_micros, metrics.conversions, metrics.clicks,
      metrics.impressions, metrics.average_cpc, metrics.phone_calls
    FROM keyword_view
    WHERE metrics.cost_micros > ${thresholdMicros}
      AND metrics.conversions < 1
      AND ${dateClause}
    ORDER BY metrics.cost_micros DESC LIMIT 100
  `).catch(() => [])

  return rows.map(r => {
    const cost = n(r.metrics?.cost_micros ?? 0) / 1e6
    return {
      text:           r.ad_group_criterion?.keyword?.text || '—',
      matchType:      resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
      status:         resolveWastedStatus(r.ad_group_criterion?.status),
      campaign:       r.campaign?.name || '—',
      campaignStatus: resolveWastedStatus(r.campaign?.status),
      adGroup:        r.ad_group?.name || '—',
      cost,
      conversions: 0,
      clicks:      n(r.metrics?.clicks       ?? 0),
      impressions: n(r.metrics?.impressions  ?? 0),
      cpc:         n(r.metrics?.average_cpc  ?? 0) / 1e6,
      phoneCalls:  n(r.metrics?.phone_calls  ?? 0),
      recommendedAction: cost > 50 ? 'Pause Immediately' : cost > 20 ? 'Review & Consider Pausing' : 'Monitor',
    }
  })
}

// ── Top converting ads ────────────────────────────────────────────────────────

async function fetchTopConvertingAds({ api, credentials }, customerId, mccCustomerId, dateRange) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange)

  const rows = await customer.query(`
    SELECT ad_group_ad.ad.id, ad_group_ad.ad.type,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.final_urls, ad_group_ad.status,
      campaign.name, ad_group.name,
      metrics.impressions, metrics.clicks, metrics.conversions,
      metrics.conversions_from_interactions_rate, metrics.cost_micros,
      metrics.average_cpc, metrics.ctr, metrics.all_conversions_value
    FROM ad_group_ad
    WHERE ${dateClause} AND metrics.impressions > 0
    ORDER BY metrics.conversions DESC LIMIT 50
  `).catch(() => [])

  return rows.map(r => {
    const cost      = n(r.metrics?.cost_micros ?? 0) / 1e6
    const allConvVal = n(r.metrics?.all_conversions_value ?? 0)
    const headlines  = (r.ad_group_ad?.ad?.responsive_search_ad?.headlines || [])
      .map(h => (typeof h === 'string' ? h : h?.text || '')).filter(Boolean).slice(0, 3)
    const descriptions = (r.ad_group_ad?.ad?.responsive_search_ad?.descriptions || [])
      .map(d => (typeof d === 'string' ? d : d?.text || '')).filter(Boolean).slice(0, 2)
    const convRate = n(r.metrics?.conversions_from_interactions_rate ?? 0) * 100

    return {
      id:           String(r.ad_group_ad?.ad?.id || ''),
      type:         enumStr(r.ad_group_ad?.ad?.type) || 'UNKNOWN',
      headlines,
      descriptions,
      finalUrls:    r.ad_group_ad?.ad?.final_urls || [],
      status:       STATUS_MAP[enumStr(r.ad_group_ad?.status)] || enumStr(r.ad_group_ad?.status),
      campaign:     r.campaign?.name || '—',
      adGroup:      r.ad_group?.name || '—',
      impressions:  n(r.metrics?.impressions ?? 0),
      clicks:       n(r.metrics?.clicks      ?? 0),
      conversions:  n(r.metrics?.conversions ?? 0),
      convRate,
      cost,
      cpc:          n(r.metrics?.average_cpc ?? 0) / 1e6,
      ctr:          n(r.metrics?.ctr ?? 0) * 100,
      roas:         cost > 0 ? allConvVal / cost : 0,
    }
  })
}

// ── Top converting keywords (Feature 3) ──────────────────────────────────────

async function fetchTopConvertingKeywords({ api, credentials }, customerId, mccCustomerId, dateRange) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange)

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

const IRRELEVANT_WORDS = ['free','cheap','diy','jobs','career','salary','how to','tutorial','review','reddit','forum','wikipedia']

async function fetchNegativeData({ api, credentials }, customerId, mccCustomerId, dateRange) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange)

  const [searchTermRows, negativeRows, adGroupNegativeRows] = await Promise.all([
    customer.query(`
      SELECT search_term_view.search_term, search_term_view.status,
        campaign.name, campaign.status, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr
      FROM search_term_view
      WHERE ${dateClause} AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC LIMIT 500
    `).catch(() => []),

    customer.query(`
      SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type,
        campaign_criterion.negative, campaign_criterion.status, campaign.name, campaign.status
      FROM campaign_criterion
      WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'
        AND campaign.status != 'REMOVED'
    `).catch(() => []),

    customer.query(`
      SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
        ad_group_criterion.negative, ad_group_criterion.status, campaign.name, campaign.status, ad_group.name
      FROM ad_group_criterion
      WHERE ad_group_criterion.negative = TRUE AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status != 'REMOVED' AND campaign.status != 'REMOVED'
    `).catch(() => []),
  ])

  // Auto-flag recommendations
  const recommendations = searchTermRows
    .filter(r => {
      const cost  = n(r.metrics?.cost_micros ?? 0) / 1e6
      const impr  = n(r.metrics?.impressions ?? 0)
      const ctr   = n(r.metrics?.ctr ?? 0) * 100
      const conv  = n(r.metrics?.conversions ?? 0)
      const term  = (r.search_term_view?.search_term || '').toLowerCase()
      const isIrrelevant = IRRELEVANT_WORDS.some(w => term.includes(w))
      return (cost > 5 && conv === 0) || (impr > 100 && ctr < 0.5) || isIrrelevant
    })
    .map(r => {
      const cost  = n(r.metrics?.cost_micros ?? 0) / 1e6
      const impr  = n(r.metrics?.impressions ?? 0)
      const ctr   = n(r.metrics?.ctr ?? 0) * 100
      const conv  = n(r.metrics?.conversions ?? 0)
      const term  = (r.search_term_view?.search_term || '').toLowerCase()
      const isIrrelevant = IRRELEVANT_WORDS.some(w => term.includes(w))
      const reason = isIrrelevant ? 'Irrelevant intent' : (cost > 5 && conv === 0) ? 'Wasted spend' : 'Low relevance'
      const CAMP_STATUS_REC = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }
      const campStatus = CAMP_STATUS_REC[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status)
      return {
        term:           r.search_term_view?.search_term || '—',
        status:         campStatus,
        campaign:       r.campaign?.name || '—',
        campaignStatus: campStatus,
        adGroup:        r.ad_group?.name || '—',
        impressions:  impr,
        clicks:       n(r.metrics?.clicks ?? 0),
        cost,
        conversions:  conv,
        ctr,
        reason,
        recommendedMatchType: reason === 'Irrelevant intent' ? 'Broad' : 'Exact',
      }
    })

  const NEG_STATUS_LBL = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }
  const resolveNegStatus = raw => { const s = enumStr(raw); return NEG_STATUS_LBL[s] || NEG_STATUS_LBL[s.toUpperCase()] || s }

  const existingNegatives = [
    ...negativeRows.map(r => ({
      text:           r.campaign_criterion?.keyword?.text || '—',
      matchType:      resolveMatchType(r.campaign_criterion?.keyword?.match_type),
      status:         resolveNegStatus(r.campaign_criterion?.status),
      campaign:       r.campaign?.name || '—',
      campaignStatus: resolveNegStatus(r.campaign?.status),
      adGroup:        '—',
      level:          'Campaign',
    })),
    ...adGroupNegativeRows.map(r => ({
      text:           r.ad_group_criterion?.keyword?.text || '—',
      matchType:      resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
      status:         resolveNegStatus(r.ad_group_criterion?.status),
      campaign:       r.campaign?.name  || '—',
      campaignStatus: resolveNegStatus(r.campaign?.status),
      adGroup:        r.ad_group?.name  || '—',
      level:          'Ad Group',
    })),
  ]

  const potentialSavings = recommendations
    .filter(r => r.reason === 'Wasted spend')
    .reduce((s, r) => s + r.cost, 0)

  return { recommendations, existingNegatives, potentialSavings }
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

async function fetchAuditData({ api, credentials }, customerId, mccCustomerId, statusFilter = 'ENABLED', dateRange = 'LAST_30_DAYS') {
  const customer = makeCustomer({ api, credentials }, customerId, mccCustomerId)

  const sf = statusFilter || 'ENABLED'
  const dateClauseAudit = buildDateClause(dateRange)

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
  const campCond = sf === 'ALL'            ? null
                 : sf === 'PAUSED'         ? "campaign.status = 'PAUSED'"
                 : sf === 'ENABLED_PAUSED' ? "campaign.status != 'REMOVED'"
                 :                           "campaign.status = 'ENABLED'"
  const agCond   = sf === 'ALL'            ? null
                 : sf === 'PAUSED'         ? "ad_group.status = 'PAUSED'"
                 : sf === 'ENABLED_PAUSED' ? "ad_group.status != 'REMOVED'"
                 :                           "ad_group.status = 'ENABLED'"

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
      ${where(dateClauseAudit, campCond, agCond)}
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
      FROM asset_group LIMIT 50
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
    campaignA: campaigns.find(c => ['MULTI_CHANNEL','PERFORMANCE_MAX'].includes(c.channelType))?.name || 'Performance Max',
    campaignB: campaigns.find(c => c.channelType === 'SEARCH')?.name || 'Search Campaign',
    issueType: 'PMax vs Search',
    recommendation: 'Add Search campaign keywords as PMax URL exclusions to prevent budget cannibalisation',
  })
  if (hasPMax && hasShopping) crossovers.push({
    campaignA: campaigns.find(c => ['MULTI_CHANNEL','PERFORMANCE_MAX'].includes(c.channelType))?.name || 'Performance Max',
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

async function fetchReportData({ api, credentials }, customerId, mccCustomerId, dateRange, reportType) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange)

  switch (reportType) {

    case 'campaigns': {
      const rows = await customer.query(`
        SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
          metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
          metrics.all_conversions_value, metrics.ctr, metrics.average_cpc,
          metrics.conversions_from_interactions_rate
        FROM campaign
        WHERE campaign.status != 'REMOVED' AND ${dateClause}
        ORDER BY metrics.cost_micros DESC
      `).catch(() => [])
      return rows.map(r => {
        const cost = n(r.metrics?.cost_micros ?? 0) / 1e6
        return {
          id:          String(r.campaign?.id || ''),
          name:        r.campaign?.name || '—',
          status:      STATUS_MAP[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status),
          channelType: CHANNEL_LABELS[enumStr(r.campaign?.advertising_channel_type)] || enumStr(r.campaign?.advertising_channel_type),
          impressions: n(r.metrics?.impressions ?? 0), clicks: n(r.metrics?.clicks ?? 0), cost,
          conversions: n(r.metrics?.conversions ?? 0),
          ctr: n(r.metrics?.ctr ?? 0) * 100, cpc: n(r.metrics?.average_cpc ?? 0) / 1e6,
          convRate: n(r.metrics?.conversions_from_interactions_rate ?? 0) * 100,
          roas: cost > 0 ? n(r.metrics?.all_conversions_value ?? 0) / cost : 0,
        }
      })
    }

    case 'adGroups': {
      const rows = await customer.query(`
        SELECT ad_group.id, ad_group.name, ad_group.status,
          campaign.name, campaign.status,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.ctr, metrics.average_cpc
        FROM ad_group WHERE ad_group.status != 'REMOVED' AND ${dateClause}
        ORDER BY metrics.cost_micros DESC
      `).catch(() => [])
      return rows.map(r => ({
        id:             String(r.ad_group?.id || ''),
        name:           r.ad_group?.name  || '—',
        campaign:       r.campaign?.name  || '—',
        campaignStatus: ({ ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' })[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status),
        status:         STATUS_MAP[enumStr(r.ad_group?.status)]  || enumStr(r.ad_group?.status),
        impressions:    n(r.metrics?.impressions ?? 0),
        clicks:         n(r.metrics?.clicks      ?? 0),
        cost:           n(r.metrics?.cost_micros ?? 0) / 1e6,
        conversions:    n(r.metrics?.conversions ?? 0),
        ctr:            n(r.metrics?.ctr         ?? 0) * 100,
        cpc:            n(r.metrics?.average_cpc ?? 0) / 1e6,
      }))
    }

    case 'assetGroups': {
      const CAMP_STATUS_LBL = { ENABLED:'Enabled', PAUSED:'Paused', REMOVED:'Removed', '2':'Enabled', '3':'Paused', '4':'Removed' }
      const rows = await customer.query(`
        SELECT asset_group.id, asset_group.name, asset_group.status,
          campaign.name, campaign.status,
          metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM asset_group WHERE ${dateClause}
      `).catch(() => [])
      return rows.map(r => ({
        id:             String(r.asset_group?.id || ''),
        name:           r.asset_group?.name || '—',
        campaign:       r.campaign?.name    || '—',
        campaignStatus: CAMP_STATUS_LBL[enumStr(r.campaign?.status)] || enumStr(r.campaign?.status),
        status:         STATUS_MAP[enumStr(r.asset_group?.status)]    || enumStr(r.asset_group?.status),
        impressions:    n(r.metrics?.impressions ?? 0),
        clicks:         n(r.metrics?.clicks      ?? 0),
        cost:           n(r.metrics?.cost_micros ?? 0) / 1e6,
        conversions:    n(r.metrics?.conversions ?? 0),
      }))
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

      // Use resource_name as the unique key — it is globally unique across the account
      // (format: customers/X/adGroupCriteria/adGroupId~criterionId).
      // criterion_id alone is only unique within an ad group, causing collisions.
      const rows = await customer.query(`
        SELECT ad_group_criterion.resource_name,
          ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
          ad_group_criterion.quality_info.quality_score, ad_group_criterion.status,
          campaign.name, campaign.status, ad_group.name, ad_group.status,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.phone_calls
        FROM keyword_view
        WHERE ${buildDateClause(dateRange)}
          AND ad_group_criterion.negative = false
          AND ad_group_criterion.status != 'REMOVED'
          AND campaign.status != 'REMOVED'
          AND ad_group.status != 'REMOVED'
      `).catch(() => [])

      console.log('[keywords] raw rows from keyword_view:', rows.length)

      const kwMap = new Map()
      for (const r of rows) {
        const id = r.ad_group_criterion?.resource_name || ''
        if (!id) continue
        if (!kwMap.has(id)) {
          kwMap.set(id, {
            text:           r.ad_group_criterion?.keyword?.text || '—',
            matchType:      resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
            qualityScore:   n(r.ad_group_criterion?.quality_info?.quality_score ?? 0),
            status:         resolveKwStatusLabel(r.ad_group_criterion?.status),
            campaign:       r.campaign?.name  || '—',
            campaignStatus: resolveKwStatusLabel(r.campaign?.status),
            adGroup:        r.ad_group?.name  || '—',
            adGroupStatus:  resolveKwStatusLabel(r.ad_group?.status),
            impressions: 0, clicks: 0, cost: 0, conversions: 0, phoneCalls: 0,
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

async function fetchKeywordsWithCalls({ api, credentials }, customerId, mccCustomerId, dateRange) {
  const customer   = makeCustomer({ api, credentials }, customerId, mccCustomerId)
  const dateClause = buildDateClause(dateRange)

  const [keywordsResult, callsResult] = await Promise.allSettled([
    // Query 1: Keywords via ad_group_criterion — supports phone_calls metric reliably
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

    // Query 2: Segmented call conversion counts per keyword
    customer.query(`
      SELECT
        ad_group_criterion.keyword.text,
        campaign.id, ad_group.id,
        metrics.all_conversions,
        segments.conversion_action_category
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND segments.conversion_action_category IN ('PHONE_CALL_LEAD','IMPORTED_LEAD')
        AND ${dateClause}
    `),
  ])

  const keywordRows = keywordsResult.status === 'fulfilled' ? keywordsResult.value : []
  const callRows    = callsResult.status    === 'fulfilled' ? callsResult.value    : []

  // Build call count lookup: "campaignId|adGroupId|keywordText" → total calls
  const callCountMap = {}
  for (const row of callRows) {
    const key = `${row.campaign?.id}|${row.ad_group?.id}|${(row.ad_group_criterion?.keyword?.text || '')}`
    callCountMap[key] = (callCountMap[key] ?? 0) + n(row.metrics?.all_conversions ?? 0)
  }

  return keywordRows.map(row => {
    const text       = row.ad_group_criterion?.keyword?.text ?? ''
    const campaignId = String(row.campaign?.id ?? '')
    const adGroupId  = String(row.ad_group?.id ?? '')
    const lookupKey  = `${campaignId}|${adGroupId}|${text}`

    const directCalls    = n(row.metrics?.phone_calls ?? 0)
    const segmentedCalls = callCountMap[lookupKey] ?? 0
    const phoneCalls     = Math.max(directCalls, segmentedCalls)

    return {
      text,
      matchType:    resolveMatchType(row.ad_group_criterion?.keyword?.match_type),
      qualityScore: n(row.ad_group_criterion?.quality_info?.quality_score ?? 0),
      status:       STATUS_MAP[enumStr(row.ad_group_criterion?.status)] || enumStr(row.ad_group_criterion?.status),
      campaignId,
      campaign:     row.campaign?.name ?? '—',
      adGroupId,
      adGroup:      row.ad_group?.name ?? '—',
      impressions:  n(row.metrics?.impressions  ?? 0),
      clicks:       n(row.metrics?.clicks       ?? 0),
      cost:         n(row.metrics?.cost_micros  ?? 0) / 1e6,
      conversions:  n(row.metrics?.conversions  ?? 0),
      cpc:          n(row.metrics?.average_cpc  ?? 0) / 1e6,
      ctr:          n(row.metrics?.ctr          ?? 0) * 100,
      convRate:     n(row.metrics?.conversions_from_interactions_rate ?? 0) * 100,
      phoneCalls,
    }
  })
}

module.exports = {
  createClient, listSubAccounts, fetchDashboardData,
  fetchCallLeads, fetchWastedSpend, fetchTopConvertingAds,
  fetchTopConvertingKeywords, fetchNegativeData, fetchKeywordIdeas,
  fetchAuditData, fetchReportData, fetchKeywordsWithCalls,
}
