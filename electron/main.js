'use strict'

const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs   = require('fs')

const store = require('./store')
const { readChangelog, appendChangelog, patchChangelogEntry, makeChangelogId } = require('./changelog')
const {
  createClient, listSubAccounts, fetchDashboardData,
  fetchCallLeads, fetchWastedSpend, fetchTopConvertingAds, fetchAdCurrentContent,
  fetchNegativeData, fetchAuditData, fetchReportData, fetchKeywordsWithCalls,
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
  fetchKeywordConflictData, updateNegativeKeywordStatus,
} = require('./googleAdsClient')
const { analyzeLandingPage, checkUrlLive, fetchSitemapUrls } = require('./landingPageFetcher')
const {
  listCampaigns, getCampaign,
  createSearchCampaign, createDisplayCampaign, createPerformanceMaxCampaign, createShoppingCampaign, createVideoCampaign,
  updateCampaignName, updateCampaignStatus, updateCampaignBudget, updateCampaignBidding, updateCampaignTargeting, updateCampaignEndDate,
  rollbackCampaignCreate, rollbackCampaignUpdate,
  searchGeoTargets, listLanguages,
} = require('./campaignClient')
const {
  listAdGroups, createAdGroup,
  listAdGroupKeywords, updateAdGroupKeywords,
  updateAdGroupName, updateAdGroupStatus, updateAdGroupBid,
  rollbackAdGroupCreate, rollbackAdGroupUpdate,
} = require('./adGroupClient')
const {
  listKeywords: listManagedKeywords, listSearchTerms: listAdGroupSearchTerms,
  updateKeyword, bulkUpdateKeywords, addKeywords, computeRecommendation,
} = require('./keywordManagerClient')
const {
  listAssetGroups, getAssetGroupDetail, updateAssetGroupName, updateAssetGroupStatus, updateAssetGroupContent,
  createAssetGroup, rollbackAssetGroupCreate, rollbackAssetGroupUpdate,
} = require('./assetGroupClient')

const APP_TITLE = 'GAds Dashboard - Top Ten Website Marketing'

// ── Window ──────────────────────────────────────────────────────────────────

function createWindow() {
  const isDev = !app.isPackaged || process.env.NODE_ENV === 'development'
  const iconPath = path.join(app.getAppPath(), 'assets', 'icon.ico')

  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 680,
    title: APP_TITLE, icon: iconPath,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// ── Helper to get a fully-initialised API client from stored settings ────────

async function getClient() {
  const settings = await store.getSettings()
  if (!settings.developerToken || !settings.refreshToken) throw new Error('No credentials saved.')
  return { client: createClient(settings), settings }
}

// ── Shared Anthropic client factory ───────────────────────────────────────────
// Every AI-generation handler in this file gets its Claude client through
// here so a single rule can apply to every prompt at once, rather than being
// copy-pasted into 30+ individual system/user prompts (and inevitably
// drifting out of sync as new handlers are added). Applied via the `system`
// param regardless of whether the caller already sets one — Claude honors
// `system` independently of `messages` content, so this is safe to add even
// for handlers that build their whole prompt as a plain user message.
const GLOBAL_AI_STYLE_RULES = 'Never use em dashes (—) in any generated content. Use periods, commas, or colons instead.'

async function getAnthropicClient(apiKey) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const rawCreate = client.messages.create.bind(client.messages)
  client.messages.create = (params) => rawCreate({
    ...params,
    system: params?.system ? `${params.system}\n\n${GLOBAL_AI_STYLE_RULES}` : GLOBAL_AI_STYLE_RULES,
  })
  return client
}

// ── Settings ─────────────────────────────────────────────────────────────────

ipcMain.handle('settings:get', async () => store.getSettings())
ipcMain.handle('settings:save', async (_e, data) => { await store.saveSettings(data); return { success: true } })

// ── Preferences ───────────────────────────────────────────────────────────────

ipcMain.handle('prefs:get', async () => store.getPrefs())
ipcMain.handle('prefs:set', async (_e, data) => { await store.savePrefs(data); return { success: true } })

// ── Accounts ─────────────────────────────────────────────────────────────────

// Populated whenever accounts:fetch runs, so every date-ranged report handler
// below can resolve each account's own configured timezone (customer_client.
// time_zone) without an extra API round-trip — Google Ads records segments.date
// in the ACCOUNT's timezone, not the machine running this app, so "Last 30
// Days" etc. need to be computed against that, not local/UTC.
const accountTimeZones = new Map() // customerId (string) -> IANA timezone string

function resolveTimeZone(customerId) {
  return accountTimeZones.get(String(customerId)) || 'UTC'
}

ipcMain.handle('accounts:fetch', async () => {
  const { client, settings } = await getClient()
  const accounts = await listSubAccounts(client, settings.mccCustomerId)
  accounts.forEach(a => accountTimeZones.set(String(a.id), a.timeZone || 'UTC'))
  return accounts
})

// ── Account Business Profile ────────────────────────────────────────────────
// Per-account (client) advertiser context — separate from app-level Settings —
// used to ground every AI asset-generation prompt (see buildAdvertiserContextBlock).

ipcMain.handle('account:getProfile', async (_e, { customerId }) => {
  return store.getAccountWebsites(customerId)
})

ipcMain.handle('account:saveProfile', async (_e, { customerId, id, websiteUrl, advertiser, whatWeSell }) => {
  return store.saveAccountWebsite(customerId, { id, websiteUrl, advertiser, whatWeSell })
})

ipcMain.handle('account:deleteProfile', async (_e, { customerId, id }) => {
  return store.deleteAccountWebsite(customerId, id)
})

// Pages unlikely to describe the advertiser's own services — skip crawling these.
// Word-boundary (not path-segment) matching so "contact-us.html" and
// "our-services/x.html" are still caught by "contact" / "services" respectively.
const PROFILE_EXCLUDE_PATH = /\b(blog|news|wp-content|wp-admin|wp-json|feed|tag|category|author|login|cart|checkout|privacy|terms|cookie|careers?|jobs|404|search|testimonials?|reviews?|faq|about|contact)\b/i
// Pages likely to enumerate services/products — crawl these first.
const PROFILE_PRIORITY_PATH = /\b(service|services|solution|solutions|product|products|what-we-do|offerings?|industr\w*|features?)\b/i
// Hard cap on how many sub-pages get crawled per site — generous because a
// site with a very granular service catalog (one page per specific job type)
// needs far more than a handful of pages to cover its real offering list.
const PROFILE_MAX_PAGES = 40

function profilePageBlock(scraped, label, { includeBody = false } = {}) {
  if (!scraped || scraped.error) return ''
  return [
    `PAGE: ${label}`,
    scraped.title            && `  Title: ${scraped.title}`,
    scraped.h1               && `  H1: ${scraped.h1}`,
    scraped.h2s?.length > 0  && `  H2s: ${scraped.h2s.slice(0, 8).join(' | ')}`,
    scraped.h3s?.length > 0  && `  H3s: ${scraped.h3s.slice(0, 8).join(' | ')}`,
    scraped.metaDescription  && `  Meta: ${scraped.metaDescription}`,
    // Nav menus reliably enumerate every top-level service and often surface
    // items that never became their own dedicated page/heading — worth the
    // extra text on the homepage even though it's noisy (phone numbers, etc).
    includeBody && scraped.bodySnippet && `  Body/Nav text: ${scraped.bodySnippet.slice(0, 1000)}`,
  ].filter(Boolean).join('\n')
}

ipcMain.handle('account:detectProfile', async (_e, { customerId, id, websiteUrl }) => {
  if (!websiteUrl) throw new Error('Website URL is required.')
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')

  const homepage = await analyzeLandingPage(websiteUrl, { bustCache: true })
  if (homepage?.error) throw new Error(`Could not fetch website: ${homepage.error}`)

  // Crawl beyond the homepage so "what we sell" reflects the full service
  // catalog, not just whatever happens to be mentioned on the front page —
  // reuses the same sitemap discovery already used for sitelink generation.
  const sitemapUrls = await fetchSitemapUrls(websiteUrl).catch(() => [])
  const candidates  = sitemapUrls.filter(u => u !== websiteUrl && !PROFILE_EXCLUDE_PATH.test(u))
  const priority    = candidates.filter(u => PROFILE_PRIORITY_PATH.test(u))
  const rest        = candidates.filter(u => !PROFILE_PRIORITY_PATH.test(u))
  const pagesToFetch = [...priority, ...rest].slice(0, PROFILE_MAX_PAGES)

  const otherScraped = await Promise.all(pagesToFetch.map(u => analyzeLandingPage(u).catch(() => null)))

  const pageBlocks = [
    profilePageBlock(homepage, websiteUrl, { includeBody: true }),
    ...otherScraped.map((s, i) => profilePageBlock(s, pagesToFetch[i])),
  ].filter(Boolean)
  const lpLines = pageBlocks.join('\n\n')
  if (!lpLines) throw new Error('Could not extract enough content from that site to detect a business profile.')

  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const prompt =
    `Based on this scraped content from ${pageBlocks.length} page(s) of a business's website, identify the ADVERTISER ` +
    `(business name) and write a "whatWeSell" summary describing what they actually sell/offer (their own products/services, ` +
    `not who they sell to or what their customers sell).\n\n` +
    `${lpLines}\n\n` +
    `Structure "whatWeSell" as TWO parts, in this order:\n` +
    `PART 1 — a short company overview paragraph (2-4 sentences): what kind of business this is, who they typically serve (residential/commercial, industries, geography), and any notable differentiators mentioned on the site (years in business, certifications, service area, etc). Do not invent anything not evidenced on the site.\n` +
    `PART 2 — "Services offered: " followed by a comma-separated list of EVERY distinct service/product identified across all pages above — do not stop at 1-2 examples, list all of them.\n` +
    `Separate the two parts with a blank line (\\n\\n) inside the whatWeSell string.\n\n` +
    `Rules for the services list (Part 2):\n` +
    `1. The "Body/Nav text" line on the homepage (if present) usually contains the site's own navigation menu — treat it as an authoritative list of top-level services and make sure every menu item that names a service appears in your output, even if that item never got its own page or heading elsewhere in the scraped content.\n` +
    `2. Be specific — use the actual service names from the site (e.g. "live video monitoring", "remote guarding", "license plate recognition"), not vague categories like "various services".\n` +
    `3. No duplicates, no invented services not evidenced on the site.\n\n` +
    `Return ONLY valid JSON: {"advertiser":"Business Name","whatWeSell":"<overview paragraph>\\n\\nServices offered: <comma-separated list>"}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  let parsed = {}
  try { parsed = JSON.parse(match?.[0] || '{}') } catch { /* fall through with empty parsed */ }
  if (!parsed.advertiser && !parsed.whatWeSell) throw new Error('Could not detect a business profile from that website — try editing it manually.')

  return store.saveAccountWebsite(customerId, {
    id, websiteUrl,
    advertiser: parsed.advertiser || '',
    whatWeSell: parsed.whatWeSell || '',
  })
})

// ── Dashboard ─────────────────────────────────────────────────────────────────

ipcMain.handle('dashboard:fetch', async (_e, { customerId, dateRange, campaignId, adGroupId }) => {
  const { client, settings } = await getClient()
  const data = await fetchDashboardData(client, customerId, settings.mccCustomerId, dateRange, resolveTimeZone(customerId), { campaignId, adGroupId })
  await store.saveLastAccount(customerId)
  return data
})

ipcMain.handle('data:refresh', async (_e, { customerId, dateRange, campaignId, adGroupId }) => {
  const { client, settings } = await getClient()
  return fetchDashboardData(client, customerId, settings.mccCustomerId, dateRange, resolveTimeZone(customerId), { campaignId, adGroupId })
})

// ── Reports ───────────────────────────────────────────────────────────────────

ipcMain.handle('reports:fetch', async (_e, { customerId, dateRange, reportType }) => {
  const { client, settings } = await getClient()
  return fetchReportData(client, customerId, settings.mccCustomerId, dateRange, reportType, resolveTimeZone(customerId))
})

// ── Call leads ────────────────────────────────────────────────────────────────

ipcMain.handle('calls:fetch', async (_e, { customerId, dateRange }) => {
  try {
    const { client, settings } = await getClient()
    console.log('[calls:fetch] customerId:', customerId)
    console.log('[calls:fetch] dateRange:', JSON.stringify(dateRange))
    const result = await fetchCallLeads(client, customerId, settings.mccCustomerId, dateRange, resolveTimeZone(customerId))
    console.log('[calls:fetch] totalCalls:', result.summary.totalCalls)
    console.log('[calls:fetch] callViewRows:', result.calls.length)
    return result
  } catch (err) {
    console.error('[calls:fetch] ERROR:', err.message)
    console.error(err.stack)
    return {
      calls: [],
      summary: { totalCalls:0, connectedCalls:0, avgDurationSeconds:0, totalCost:0, costPerCall:0 },
      campaignMetrics: [],
    }
  }
})

// ── Wasted spend ──────────────────────────────────────────────────────────────

ipcMain.handle('wasted:fetch', async (_e, { customerId, dateRange, thresholdMicros }) => {
  const { client, settings } = await getClient()
  return fetchWastedSpend(client, customerId, settings.mccCustomerId, dateRange, thresholdMicros, resolveTimeZone(customerId))
})

// ── Top converting ads ────────────────────────────────────────────────────────

ipcMain.handle('ads:fetch', async (_e, { customerId, dateRange }) => {
  const { client, settings } = await getClient()
  return fetchTopConvertingAds(client, customerId, settings.mccCustomerId, dateRange, resolveTimeZone(customerId))
})

ipcMain.handle('ads:underPerformerRec', async (_e, {
  customerId, adId, campaign, adGroup,
  impressions, clicks, cost, ctr, cpc,
}) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')

  // Always look up this ad's LIVE current headlines/descriptions right
  // before generating a recommendation — the Reports table's row data is
  // fetched once per page load and can go stale the moment the ad is edited
  // anywhere else (e.g. the RSA Builder's Edit modal). Evaluating stale text
  // is exactly what caused this to keep "recommending" a headline the user
  // had already replaced.
  const { client, settings: liveSettings } = await getClient()
  const current = await fetchAdCurrentContent(client, customerId, liveSettings.mccCustomerId, adId)
  if (!current) throw new Error("Could not load this ad's current content — it may have been removed.")
  const { headlines, descriptions } = current

  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const hlList = headlines.map((h, i) => `  ${i + 1}. "${h}" (${h.length} chars)`).join('\n') || '  (none)'
  const dsList = descriptions.map((d, i) => `  ${i + 1}. "${d}" (${d.length} chars)`).join('\n') || '  (none)'
  const fmtUsd = v => '$' + Number(v || 0).toFixed(2)
  const fmtPct = v => Number(v || 0).toFixed(2) + '%'

  const prompt =
    `You are a senior Google Ads optimization specialist. The ad below has spent money with poor results — it is an Under Performer.\n\n` +
    `Campaign: ${campaign}\nAd Group: ${adGroup}\n\n` +
    `CURRENT HEADLINES (numbered, exactly as they run today):\n${hlList}\n\n` +
    `CURRENT DESCRIPTIONS (numbered, exactly as they run today):\n${dsList}\n\n` +
    `Metrics: ${fmtUsd(cost)} spent · ${Number(impressions).toLocaleString()} impr. · ${Number(clicks).toLocaleString()} clicks · ${fmtPct(ctr)} CTR · ${fmtUsd(cpc)} avg CPC\n\n` +
    `Give exactly 3 specific, actionable recommendations to fix this ad and start generating conversions. ` +
    `Prioritize: headline relevance to search intent, CTA strength, landing page alignment, audience or keyword mismatch.\n\n` +
    `For each recommendation, if the fix is a specific headline or description replacement, include the EXACT replacement text in "suggestedText" ` +
    `and which numbered item above it replaces in "replaceIndex" (matching the numbering above) and "replaceType" ("headline" or "description"). ` +
    `HARD LIMIT: a headline replacement MUST be 30 characters or fewer — count every character. A description replacement MUST be 90 characters or fewer. ` +
    `Never suggest replacement text identical or near-identical to the current text it replaces — the point is a genuinely different, better version. ` +
    `If the recommendation is NOT a direct text replacement (e.g. landing page or targeting advice), set suggestedText, replaceIndex, and replaceType to null.\n\n` +
    `Return ONLY valid JSON, no markdown:\n` +
    `{"recs":[{"issue":"1-2 sentence diagnosis referencing the actual metrics","replaceType":"headline","replaceIndex":2,"suggestedText":"Book Same-Day Repair Now"},{"issue":"...","replaceType":null,"replaceIndex":null,"suggestedText":null}]}`

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 700,
    messages:   [{ role: 'user', content: prompt }],
  })

  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  let parsed
  try {
    parsed = JSON.parse(match?.[0] || '{}')
  } catch {
    return { recs: [] }
  }

  const recs = (parsed.recs || []).slice(0, 3).map(r => {
    const replaceType = r.replaceType === 'headline' || r.replaceType === 'description' ? r.replaceType : null
    let suggestedText = replaceType && r.suggestedText ? String(r.suggestedText).trim() : null
    if (suggestedText) suggestedText = replaceType === 'headline' ? sanitizeHeadline(suggestedText) : sanitizeDescription(suggestedText)

    const sourceList  = replaceType === 'headline' ? headlines : replaceType === 'description' ? descriptions : []
    const replaceIndex = Number.isInteger(r.replaceIndex) && r.replaceIndex >= 1 && r.replaceIndex <= sourceList.length ? r.replaceIndex : null
    const currentText  = replaceIndex ? sourceList[replaceIndex - 1] : null

    // Drop the suggestion if the AI just echoed back the current text, or
    // the index didn't resolve to a real current item.
    if (!replaceIndex || !currentText) return { issue: r.issue || '', replaceType: null, replaceIndex: null, suggestedText: null, currentText: null }
    if (suggestedText && suggestedText.trim().toLowerCase() === currentText.trim().toLowerCase()) suggestedText = null

    return { issue: r.issue || '', replaceType, replaceIndex, suggestedText, currentText }
  })

  return { recs }
})

// ── Negative keywords ─────────────────────────────────────────────────────────

// Sends the account's un-excluded search-term candidates to Claude for
// semantic relevance classification against the advertiser's OWN saved
// Business Profile (never a hardcoded word list — the earlier heuristic was
// flagging XS Trash's own core services, like "junk removal" and "demolition",
// as negatives just because they hadn't converted yet). A term is judged
// relevant/irrelevant by what it MEANS relative to the business, never by
// whether it converted — conversion performance only matters afterward, to
// decide whether a genuinely relevant term needs a "Performance Review" flag.
const NEG_CLASSIFY_SYSTEM_PROMPT = (brand, coreServices, adGroupNames) =>
  `You are a Senior Google Ads PPC Strategist classifying SEARCH TERMS (actual queries users typed) to decide which, if any, deserve to become negative keywords.\n\n` +
  `ADVERTISER BRAND NAME(S): ${brand || '(unspecified)'}\n` +
  `ADVERTISER CORE SERVICES/OFFERINGS (what this business actually sells — protect all of these plus close variations, synonyms, and service-area/location-qualified searches for them):\n${coreServices || '(unspecified — be conservative; treat any plausible attempt to find this business or its services as relevant)'}\n\n` +
  `AD GROUP NAMES THAT EXIST IN THIS ACCOUNT (use only to judge whether a term looks like it landed under the WRONG ad group, never to judge overall relevance):\n${adGroupNames.join(', ') || '(none)'}\n\n` +
  `RULES — READ CAREFULLY:\n` +
  `1. NEVER mark a term irrelevant merely because it has zero conversions or poor performance. Relevance is a semantic judgment about what the term MEANS, completely independent of how it performed.\n` +
  `2. The advertiser's own brand name, and close misspellings/variants of it, are ALWAYS relevant.\n` +
  `3. A term matching or clearly implying one of the advertiser's core services — including a service-area/location qualifier (a city, county, or region name) attached to a service search — is RELEVANT even if worded very differently from the exact service name.\n` +
  `4. Mark a term IRRELEVANT only when it reflects an intent this business does not serve AT ALL. Pick the single best-fit category: municipal (government/city services), employment (job/career/salary seeking), donation (giving items away for free/charity), competitor (a specific named competitor business), diy (how-to/do-it-yourself intent to avoid hiring anyone), equipment-purchase (buying tools/equipment outright, not hiring a service), cleaning (generic cleaning unrelated to the core service), other-non-service (any other clearly non-service intent).\n` +
  `5. A term can be fully relevant to the business overall but appear to have triggered under the WRONG ad group (e.g. a demolition search triggering inside an ad group built only for junk-hauling keywords). Flag this with wrongAdGroup:true — it must NEVER also be marked irrelevant, and it is never a candidate for a negative keyword.\n` +
  `6. When genuinely unsure, default to relevant:true — overblocking a real customer search is worse than leaving one questionable term unflagged.\n\n` +
  `Return ONLY valid JSON, one entry per numbered term, in order, no omissions. Keep "r" (reason) to 4 words max — this is a compact machine format, not prose:\n` +
  `{"c":[{"i":1,"rel":true,"cat":null,"wag":false,"r":"short reason"}]}\n` +
  `"rel"=relevant (bool). "cat"=category from rule 4, null when rel is true. "wag"=wrongAdGroup (bool). "r"=reason, <=4 words.`

function extractTopLevelJSON(text) {
  let depth = 0, start = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') { if (start === -1) start = i; depth++ }
    else if (ch === '}') { depth--; if (depth === 0 && start !== -1) return text.slice(start, i + 1) }
  }
  return null
}

// One Claude call for a bounded slice of terms — sending hundreds of terms in
// a single call risks the JSON response getting cut off mid-object at the
// max_tokens ceiling (confirmed live: 400 terms in one call truncated before
// the closing brace and failed to parse), so this is always called through
// classifySearchTermCandidates below in small chunks, never directly on a
// large candidate list.
async function classifySearchTermBatch(batch, { brand, coreServices, adGroupNames }, anthropic) {
  const lines = batch.map((c, i) =>
    `${i + 1}. "${c.term}" | ${c.campaign} > ${c.adGroup} | Clicks:${c.clicks} Cost:$${c.cost.toFixed(2)} Conv:${c.conversions}`
  ).join('\n')

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 4000,
    system:     NEG_CLASSIFY_SYSTEM_PROMPT(brand, coreServices, adGroupNames),
    messages: [{
      role: 'user',
      content: `SEARCH TERMS TO CLASSIFY:\n${lines}\n\nReturn ONLY the raw JSON object. Start with { and end with }.`,
    }],
  })

  const raw = (message.content[0]?.text || '').trim()
  let parsed = null
  for (const candidate of [raw, raw.replace(/```json\s*/g, '').replace(/```/g, '').trim(), extractTopLevelJSON(raw)]) {
    if (!candidate) continue
    try { const p = JSON.parse(candidate); if (p && typeof p === 'object') { parsed = p; break } } catch {}
  }
  if (!parsed) console.error('[negatives:classify] failed to parse AI response for a batch. stop_reason:', message.stop_reason, '| raw:\n', raw)

  const byIndex = {}
  for (const c of (parsed?.c || [])) byIndex[c.i] = c

  return batch.map((c, idx) => {
    const cls = byIndex[idx + 1]
    // Parse failure or a missing entry defaults to relevant (see rule 6 above).
    return {
      ...c,
      _relevant:     cls ? cls.rel !== false : true,
      _category:     cls?.cat || null,
      _wrongAdGroup: !!cls?.wag,
      _reasonShort:  cls?.r || (cls ? '' : 'AI classification unavailable — defaulted to relevant'),
    }
  })
}

async function classifySearchTermCandidates(candidates, { brand, coreServices, adGroupNames }, settings) {
  if (!candidates.length) return []
  if (!settings.claudeApiKey) {
    // No AI configured — default every term to "relevant" so nothing gets
    // wrongly recommended as a negative without real judgment behind it.
    return candidates.map(c => ({ ...c, _relevant: true, _category: null, _wrongAdGroup: false, _reasonShort: 'AI not configured — defaulted to relevant' }))
  }
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const CHUNK_SIZE = 60
  const chunks = []
  for (let i = 0; i < candidates.length; i += CHUNK_SIZE) chunks.push(candidates.slice(i, i + CHUNK_SIZE))

  // Chunks are fully independent (each is its own Claude call with no shared
  // state) — classify them concurrently instead of one at a time. This was
  // the actual bottleneck behind this page's slow load: up to ~9 sequential
  // chunk calls for a 500-candidate account, each a full Claude round-trip,
  // stacking to 30-90+ seconds before the page could render anything.
  // Promise.all preserves chunk order, so the results still line up with
  // the original candidate order once flattened.
  const results = await Promise.all(chunks.map(chunk => classifySearchTermBatch(chunk, { brand, coreServices, adGroupNames }, anthropic)))
  return results.flat()
}

// Assembles the final "recommended as negative" list per the account's own
// Business Profile: already-negatived terms are labeled (not discarded),
// AI-irrelevant terms are recommended by intent category, relevant-but-poor
// performers are flagged for manual review rather than auto-negatived, and
// relevant terms that look mis-routed are flagged for ad-group review.
async function buildNegativeKeywordRecommendations(client, customerId, mcc, dateRange, tz, settings) {
  const { candidates, existingNegatives } = await fetchNegativeData(client, customerId, mcc, dateRange, tz)

  const websites      = await store.getAccountWebsites(customerId)
  const brand         = websites.map(w => w.advertiser).filter(Boolean).join(' / ')
  const coreServices  = websites.map(w => w.whatWeSell).filter(Boolean).join('\n')
  const adGroupNames  = [...new Set(candidates.map(c => c.adGroup).filter(Boolean))]

  const results     = []
  const toClassify  = []
  for (const c of candidates) {
    if (c.alreadyExcluded) {
      // Surface the match type of the negative that's ALREADY blocking this
      // term (not a new recommendation — nothing left to recommend here).
      results.push({ ...c, reason: 'Already Excluded', recommendedMatchType: c.existingMatchType || null, actionable: false })
    } else {
      toClassify.push(c)
    }
  }

  const classified = await classifySearchTermCandidates(toClassify, { brand, coreServices, adGroupNames }, settings)

  for (const c of classified) {
    if (c._relevant) {
      if (c._wrongAdGroup) {
        results.push({ ...c, reason: 'Valid Search — Campaign Routing Review', recommendedMatchType: null, actionable: false, reasonDetail: c._reasonShort })
        continue
      }
      // Underperformance gate (req #5): ~10+ clicks, cost has reached the
      // campaign's own target/historical CPA benchmark, zero conversions,
      // all within the fixed 60-90-day lookback already baked into fetchNegativeData.
      const meetsPerfGate = c.clicks >= 10 && c.conversions === 0 && c.cpaBenchmark != null && c.cost >= c.cpaBenchmark
      if (meetsPerfGate) {
        results.push({ ...c, reason: 'Performance Review — Do Not Negative', recommendedMatchType: null, actionable: false, reasonDetail: c._reasonShort })
      }
      // Otherwise: relevant and not (yet) underperforming enough to review — not surfaced at all.
      continue
    }
    const categoryLabel = (c._category || 'other-non-service').replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
    results.push({
      ...c,
      reason:               `Irrelevant — ${categoryLabel}`,
      recommendedMatchType: 'Phrase',
      actionable:           true,
      reasonDetail:         c._reasonShort,
    })
  }

  // Req #9: potential savings counts ONLY approved irrelevant searches, not
  // every zero-conversion term.
  const potentialSavings = results
    .filter(r => r.actionable && r.reason.startsWith('Irrelevant'))
    .reduce((s, r) => s + r.cost, 0)

  const recommendations = results.map(({ _relevant, _category, _wrongAdGroup, _reasonShort, cpaBenchmark, existingMatchType, ...rest }) => rest)

  return { recommendations, existingNegatives, potentialSavings }
}

ipcMain.handle('negatives:fetch', async (_e, { customerId, dateRange }) => {
  const { client, settings } = await getClient()
  return buildNegativeKeywordRecommendations(client, customerId, settings.mccCustomerId, dateRange, resolveTimeZone(customerId), settings)
})

// Lightweight sibling of negatives:fetch for callers that only need the
// account's EXISTING negative keywords (duplicate/conflict checks on the Add
// New Keywords and AI Keyword Planner tabs) — negatives:fetch now runs a full
// AI classification pass over every search-term candidate (chunked Claude
// calls, one per ~60 terms) to build the negative-keyword RECOMMENDATIONS
// list, which made it far too slow for callers that never look at
// `recommendations` at all. This calls the same underlying data fetch
// (fetchNegativeData) directly, skipping the AI step entirely, so it stays
// fast for those callers.
ipcMain.handle('negatives:fetchExisting', async (_e, { customerId, dateRange }) => {
  const { client, settings } = await getClient()
  const { existingNegatives } = await fetchNegativeData(client, customerId, settings.mccCustomerId, dateRange, resolveTimeZone(customerId))
  return { existingNegatives }
})

// ── Keywords with call counts ─────────────────────────────────────────────────

ipcMain.handle('keywords:fetch', async (_e, { customerId, dateRange }) => {
  try {
    const { client, settings } = await getClient()
    return fetchKeywordsWithCalls(client, customerId, settings.mccCustomerId, dateRange, resolveTimeZone(customerId))
  } catch (err) {
    console.error('[keywords:fetch] ERROR:', err.message)
    return []
  }
})

// ── Policy compliance filter for AI-generated keywords ───────────────────────

const KEYWORD_POLICY_PATTERNS = [
  /\bnear\s+me\b/i,
  /\b(porn|xxx|escorts?\b|stripper|adult\s+(?:film|content|entertainment|service))\b/i,
  /\b(online\s+casino|sports?\s+bett?ing|gambling\s+site|poker\s+(?:site|online)|slot\s+machine|lottery\s+ticket)\b/i,
  /\b(cocaine|heroin|methamphetamine|crystal\s+meth|crack\s+cocaine|fentanyl)\b/i,
  /\b(counterfeit|fake\s+(?:id|passport|document|currency))\b/i,
  /\b(buy\s+(?:guns?|firearms?|pistols?|rifles?)\s+online|unregistered\s+(?:gun|firearm))\b/i,
  /\b(payday\s+loans?|binary\s+option|crypto\s+scam|pyramid\s+scheme|ponzi)\b/i,
  /\b(guaranteed\s+cure|miracle\s+treatment|instant\s+weight\s+loss|#1\s+in\s+the\s+world)\b/i,
]

function isKeywordPolicyViolating(keyword) {
  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) return true
  return KEYWORD_POLICY_PATTERNS.some(p => p.test(keyword))
}

// ── Deterministic campaign/ad-group matching ─────────────────────────────────
// The AI's free-form campaign routing can pick a plausible-sounding but wrong
// campaign (e.g. "junk removal" -> "Property Cleanouts"). Before trusting the
// AI's pick, check for a literal word match against real account campaign/ad
// group names first — a real text match beats AI guesswork every time.
const ROUTING_STOPWORDS = new Set(['a','an','the','of','in','on','at','for','and','or','to','your','our','with','near','me'])

function routingTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !ROUTING_STOPWORDS.has(w))
}

// pairs: [{ campaign, adGroup }] — every real, enabled campaign/ad-group
// combination in the account. Returns the pair whose ad group (weighted
// higher, since ad groups are more narrowly themed) and campaign name share
// the most words with the keyword, or null if nothing shares any word at all
// (in which case the AI's own semantic judgment is left as the fallback).
function findBestCampaignMatch(keywordText, pairs) {
  const kwWords = routingTokens(keywordText)
  if (!kwWords.length || !Array.isArray(pairs) || !pairs.length) return null
  const sharesWord = (kwWord, otherWords) => otherWords.some(w => w === kwWord || w.includes(kwWord) || kwWord.includes(w))
  let best = null, bestScore = 0
  for (const pair of pairs) {
    if (!pair?.campaign || !pair?.adGroup) continue
    const campWords = routingTokens(pair.campaign)
    const agWords    = routingTokens(pair.adGroup)
    const agScore   = kwWords.filter(w => sharesWord(w, agWords)).length
    const campScore = kwWords.filter(w => sharesWord(w, campWords)).length
    const score = agScore * 2 + campScore
    if (score > bestScore) { bestScore = score; best = pair }
  }
  return bestScore > 0 ? best : null
}

// ── AI Keyword Planner — powered by Claude AI ────────────────────────────────

ipcMain.handle('keywords:ideas', async (_e, { seedKeywords, customPrompt, existingCampaigns, existingAdGroups, selectedCampaign, selectedAdGroup, campaignAdGroupPairs }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) {
    throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  }
  const anthropic = await getAnthropicClient(settings.claudeApiKey)
  const seedList  = (seedKeywords || []).slice(0, 10).join(', ')

  const systemPrompt =
    `You are a Senior Google Ads Strategist and PPC Keyword Research Expert.\n\n` +
    `Your task is to generate HIGH-INTENT, strategically targeted keyword ideas from seed topics for Google Ads campaigns.\n\n` +
    `The goal is NOT to generate generic keyword lists.\n\n` +
    `The goal is to:\n` +
    `- Find keywords most likely to generate leads and conversions\n` +
    `- Prioritize commercial and transactional intent\n` +
    `- Identify local buying intent keywords\n` +
    `- Recommend proper match types and ad group structure\n` +
    `- Estimate realistic CPCs and traffic potential\n` +
    `- Improve campaign structure and Quality Score\n\n` +
    `You must think like an elite Google Ads campaign manager specializing in local service businesses and lead generation.\n\n` +
    `--------------------------------------------------\n` +
    `YOUR TASK\n` +
    `--------------------------------------------------\n\n` +
    `For EACH seed keyword:\n\n` +
    `1. Analyze the market opportunity and buyer intent landscape\n` +
    `2. Determine the dominant search intent\n` +
    `3. Identify the primary buyer stage\n` +
    `4. Generate 15–20 high-converting keyword ideas\n` +
    `5. ONLY recommend keywords with a minimum estimated monthly search volume of 1,000+ searches. Do NOT recommend keywords with low search volume — Google Ads will decline them as "Low Search Volume" and they will not serve.\n` +
    `6. Avoid informational or low-converting keywords\n` +
    `7. Avoid job-seeker intent keywords\n` +
    `8. Avoid DIY intent keywords\n` +
    `8. Prioritize:\n` +
    `   - local intent\n` +
    `   - commercial intent\n` +
    `   - emergency intent\n` +
    `   - service intent\n` +
    `   - long-tail intent\n` +
    `   - geo intent\n` +
    `   - price-qualified intent\n\n` +
    `--------------------------------------------------\n` +
    `IMPORTANT RULES\n` +
    `--------------------------------------------------\n\n` +
    `DO NOT generate:\n` +
    `- "near me" keywords under any circumstances — use location-specific phrases instead (e.g. "garage door repair Dallas" not "garage door repair near me")\n` +
    `- informational keywords ("what is", "how to", "DIY", "free", "jobs", "salary")\n` +
    `- broad or irrelevant keywords\n` +
    `- duplicate keywords — every keyword in the output must be unique across all seed keyword results\n` +
    `- ANY keyword with estimated monthly searches below 1,000 — Google Ads will mark these as "Low Search Volume" and they will NEVER serve ads\n\n` +
    `ALWAYS:\n` +
    `- Use natural search phrases that customers would realistically type into Google\n` +
    `- Prefer location-specific keywords when a city, region, or service area can be inferred from context (e.g. "AC repair Houston" over "AC repair near me")\n` +
    `- Focus on transactional, commercial, service-booking, and lead-generation intent\n\n` +
    `--------------------------------------------------\n` +
    `GOOGLE ADS POLICY COMPLIANCE — MANDATORY\n` +
    `--------------------------------------------------\n\n` +
    `Every keyword MUST be publishable to Google Ads without triggering a policy violation. Violations cause the keyword to be rejected at publish time.\n\n` +
    `NEVER generate keywords that:\n` +
    `- Contain trademarked brand or competitor names — use generic descriptors instead (e.g. "drain cleaning service" not "Roto-Rooter drain cleaning"). Only use a brand name if the user explicitly provides it.\n` +
    `- Belong to restricted industries or services (healthcare, pharmaceuticals, financial products, gambling, adult content, weapons, alcohol, counterfeit goods, dangerous products) unless the user explicitly requests them\n` +
    `- Contain prescription drug names, medical treatment claims, or health outcomes that imply guaranteed results\n` +
    `- Contain gambling, casino, lottery, or betting terms\n` +
    `- Contain adult, explicit, or sexual content\n` +
    `- Contain weapons, firearms, or dangerous product references\n` +
    `- Contain financial products requiring regulatory approval (payday loans, cryptocurrency, binary options)\n` +
    `- Make misleading, exaggerated, or unsupported claims (e.g. "#1 in the world", "cure guaranteed", "100% free")\n` +
    `- Relate to illegal activities or services\n` +
    `- Violate Google's misrepresentation or deceptive practices policy\n\n` +
    `ALWAYS use:\n` +
    `- Generic service descriptors ("HVAC repair", "emergency electrician", "roof replacement")\n` +
    `- Location + service combinations ("plumber Austin TX", "Chicago roofing company")\n` +
    `- Intent + service combinations ("affordable AC repair", "same day locksmith")\n` +
    `- Industry-standard terminology that describes the service without naming a brand\n\n` +
    `--------------------------------------------------\n` +
    `NEGATIVE KEYWORD GENERATION\n` +
    `--------------------------------------------------\n\n` +
    `For each seed keyword generate smart negative keywords that reduce wasted spend.\n\n` +
    `--------------------------------------------------\n` +
    `AD GROUP RECOMMENDATIONS\n` +
    `--------------------------------------------------\n\n` +
    `Automatically recommend proper ad group segmentation for the campaign.\n\n` +
    `--------------------------------------------------\n` +
    `OPTIMIZATION PRIORITIES\n` +
    `--------------------------------------------------\n\n` +
    `Priority order:\n` +
    `1. Conversion intent\n` +
    `2. Search relevance\n` +
    `3. Local buyer intent\n` +
    `4. Lower competition\n` +
    `5. Monthly traffic potential\n\n` +
    `--------------------------------------------------\n` +
    `OUTPUT FORMAT — FOLLOW THIS EXACT EXAMPLE\n` +
    `--------------------------------------------------\n\n` +
    `Return ONLY a valid JSON array (one object per seed keyword), no markdown, no extra text.\n\n` +
    `EXAMPLE (for seed "plumber"):\n` +
    `[{\n` +
    `  "seed_keyword": "plumber",\n` +
    `  "analysis": {\n` +
    `    "intent": "Transactional",\n` +
    `    "buyer_stage": "Ready To Buy",\n` +
    `    "market_opportunity": "High-intent local service searches with strong lead generation potential and emergency-driven urgency.",\n` +
    `    "estimated_cpc_range": "$8–$22"\n` +
    `  },\n` +
    `  "recommended_keywords": [\n` +
    `    {\n` +
    `      "keyword": "emergency plumber Houston",\n` +
    `      "match_type": "Exact",\n` +
    `      "search_intent": "Emergency",\n` +
    `      "buyer_stage": "Urgent Need",\n` +
    `      "estimated_monthly_searches": "10,000–100,000",\n` +
    `      "competition": "High",\n` +
    `      "estimated_cpc": "$14–$22",\n` +
    `      "estimated_cpc_savings": "20–35% vs avg",\n` +
    `      "conversion_probability_score": 91,\n` +
    `      "traffic_potential": "High Conversion",\n` +
    `      "recommended_campaign": "← EXACT name from EXISTING ACCOUNT CAMPAIGNS list",\n` +
    `      "recommended_ad_group": "← EXACT name from EXISTING ACCOUNT AD GROUPS list",\n` +
    `      "landing_page_intent": "Emergency call-to-action with click-to-call and same-day availability",\n` +
    `      "negative_keywords": ["free", "DIY", "jobs", "salary", "training"],\n` +
    `      "why_it_converts": "City + emergency intent drives immediate phone calls and same-day bookings."\n` +
    `    },\n` +
    `    {\n` +
    `      "keyword": "local plumber same day service",\n` +
    `      "match_type": "Phrase",\n` +
    `      "search_intent": "Local Service",\n` +
    `      "buyer_stage": "Ready To Buy",\n` +
    `      "estimated_monthly_searches": "1,000–10,000",\n` +
    `      "competition": "Medium",\n` +
    `      "estimated_cpc": "$9–$15",\n` +
    `      "estimated_cpc_savings": "30–45% vs avg",\n` +
    `      "conversion_probability_score": 84,\n` +
    `      "traffic_potential": "Balanced",\n` +
    `      "recommended_campaign": "← EXACT name from EXISTING ACCOUNT CAMPAIGNS list",\n` +
    `      "recommended_ad_group": "← EXACT name from EXISTING ACCOUNT AD GROUPS list",\n` +
    `      "landing_page_intent": "Same-day availability with service area map and reviews",\n` +
    `      "negative_keywords": ["free", "DIY", "rental", "jobs"],\n` +
    `      "why_it_converts": "Combines local and urgency signals with lower competition than head terms."\n` +
    `    }\n` +
    `  ],\n` +
    `  "campaign_structure": {\n` +
    `    "campaign_name": "Plumbing Services",\n` +
    `    "ad_groups": ["Emergency Plumbing", "Same Day Plumbing", "Drain Cleaning", "Water Heater Repair"]\n` +
    `  }\n` +
    `}]\n\n` +
    `Now generate the same structure for the actual seed keywords provided. Every recommended keyword MUST have ALL fields filled in with real values — never leave a field empty or as a placeholder.`

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 8192,
    system:     systemPrompt,
    messages: [{
      role: 'user',
      content:
        (selectedCampaign
          ? `STEP 1 — TARGET CAMPAIGN.\nThe user has chosen to generate keywords specifically for this campaign: "${selectedCampaign}"\nFor EVERY recommended keyword you return, set "recommended_campaign" to exactly: "${selectedCampaign}" (copy character-for-character, do not alter).\nTailor all keyword ideas, match types, and ad group suggestions to fit the intent and theme of this campaign.\n\n`
          : (existingCampaigns || []).length > 0
            ? `STEP 1 — READ THESE EXISTING ACCOUNT CAMPAIGNS CAREFULLY.\nFor EVERY recommended keyword, set "recommended_campaign" to EXACTLY one of these names (copy-paste exactly, do not invent):\n${existingCampaigns.map(c => `  • ${c}`).join('\n')}\nSEMANTIC MATCH REQUIRED: pick the campaign whose name/service theme most closely matches THIS SPECIFIC keyword's actual service — not just any valid name from the list. Example: a keyword about "junk removal" belongs in a junk/waste-removal campaign, NOT a loosely-related one like "Property Cleanouts" unless that campaign is genuinely about the same service. If none of the campaigns are a strong topical match for a given keyword, pick the closest one — never force a keyword into an unrelated campaign just because it exists.\n\n`
            : `STEP 1 — No existing campaigns provided. Use the most logical campaign name based on the keyword.\n\n`) +
        (selectedAdGroup
          ? `STEP 2 — TARGET AD GROUP.\nThe user has chosen to generate keywords specifically for this ad group: "${selectedAdGroup}"\nFor EVERY recommended keyword you return, set "recommended_ad_group" to exactly: "${selectedAdGroup}" (copy character-for-character, do not alter).\nAll generated keywords must be tightly relevant to the theme and intent of this ad group.\n\n`
          : (existingAdGroups || []).length > 0
            ? `STEP 2 — READ THESE EXISTING ACCOUNT AD GROUPS CAREFULLY.\nFor EVERY recommended keyword, set "recommended_ad_group" to EXACTLY one of these names (copy-paste exactly, do not invent):\n${existingAdGroups.map(a => `  • ${a}`).join('\n')}\nSEMANTIC MATCH REQUIRED: ad groups are more narrowly themed than campaigns, so precision matters even more here — pick the ad group whose name most tightly matches this specific keyword's service, not merely a plausible one within the right campaign.\n\n`
            : `STEP 2 — No existing ad groups provided. Use the most logical ad group name based on the keyword.\n\n`) +
        (customPrompt
          ? `CUSTOM RESEARCH OBJECTIVE:\n${customPrompt}\n\n`
          : '') +
        `STEP 3 — Generate strategic keyword ideas for these seed keywords:\nSEED KEYWORDS: ${seedList}\n\n` +
        `CRITICAL REQUIREMENTS:\n` +
        `- Return ONLY a valid JSON array — start with [ and end with ]. No markdown, no code fences, no explanation text.\n` +
        `- One object per seed keyword\n` +
        `- MINIMUM SEARCH VOLUME: Every keyword MUST have at least 1,000 estimated monthly searches. Do NOT include low-volume keywords — Google Ads marks them "Low Search Volume" and they will never serve.\n` +
        `- NO "near me" keywords — use location-specific phrases (city, region, state) instead.\n` +
        `- NO trademarked brand names, restricted content, misleading claims, or policy-violating terms.\n` +
        `- NO duplicate keywords — every keyword must be unique across the entire output.\n` +
        `- Use natural search phrases that customers would realistically type.\n` +
        `- Every recommended keyword MUST include ALL fields: keyword, match_type, search_intent, buyer_stage, estimated_monthly_searches, competition, estimated_cpc, estimated_cpc_savings, conversion_probability_score, traffic_potential, recommended_campaign, recommended_ad_group, landing_page_intent, negative_keywords, why_it_converts\n` +
        `- recommended_campaign: MUST be an exact copy of one name from the STEP 1 list above, AND must be the closest topical/service match to that specific keyword — never pick an unrelated campaign just because it's a valid name\n` +
        `- recommended_ad_group: MUST be an exact copy of one name from the STEP 2 list above, AND must be the closest topical/service match to that specific keyword\n` +
        `- No empty strings, no null values, no invented names`,
    }],
  })

  const raw = (message.content[0]?.text || '').trim()

  function extractTopLevelJSON(text) {
    let depth = 0, start = -1
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '[' && start === -1) { start = i; depth++ }
      else if (text[i] === '[') depth++
      else if (text[i] === ']') { depth--; if (depth === 0 && start !== -1) return text.slice(start, i + 1) }
    }
    return null
  }

  const candidates = [
    raw,
    raw.replace(/```json\s*/g, '').replace(/```/g, '').trim(),
    extractTopLevelJSON(raw),
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate)
      if (!Array.isArray(parsed)) continue
      console.log('[keywords:ideas] parsed items:', parsed.length, '| first item keys:', Object.keys(parsed[0] || {}))

      // Flexible field getter — tries snake_case then camelCase variants
      const f = (obj, ...keys) => {
        for (const k of keys) {
          const v = obj[k]
          if (v != null && v !== '') return v
        }
        return ''
      }
      const fArr = (obj, ...keys) => {
        for (const k of keys) { if (Array.isArray(obj[k])) return obj[k] }
        return []
      }

      const seen = new Set()
      return parsed.flatMap(item => {
        const recs = fArr(item, 'recommended_keywords', 'recommendedKeywords', 'keywords', 'ideas')
        console.log('[keywords:ideas] seed:', f(item,'seed_keyword','seedKeyword'), '| recs:', recs.length)
        return recs.map(kw => {
          const keywordText = f(kw, 'keyword', 'keyword_phrase', 'term')
          let recommendedCampaign = f(kw, 'recommended_campaign', 'recommendedCampaign')
          let adGroup             = f(kw, 'recommended_ad_group', 'recommendedAdGroup', 'ad_group', 'adGroup')
          // Deterministic override — only when the user didn't already lock a
          // target campaign/ad group (that always wins as-is).
          if (!selectedCampaign) {
            const match = findBestCampaignMatch(keywordText, campaignAdGroupPairs)
            if (match) {
              recommendedCampaign = match.campaign
              if (!selectedAdGroup) adGroup = match.adGroup
            }
          }
          return {
            seedKeyword:       f(item, 'seed_keyword', 'seedKeyword'),
            keyword:           keywordText,
            matchType:         f(kw, 'match_type', 'matchType', 'match'),
            searchIntent:      f(kw, 'search_intent', 'searchIntent', 'intent'),
            buyerStage:        f(kw, 'buyer_stage', 'buyerStage', 'stage'),
            monthlySearches:   f(kw, 'estimated_monthly_searches', 'monthlySearches', 'monthly_searches', 'search_volume'),
            competition:       f(kw, 'competition', 'competition_level', 'competitionLevel'),
            estimatedCpc:      f(kw, 'estimated_cpc', 'estimatedCpc', 'cpc', 'avg_cpc'),
            estimatedSavings:  f(kw, 'estimated_cpc_savings', 'estimatedCpcSavings', 'cpc_savings', 'savings'),
            conversionScore:   kw.conversion_probability_score ?? kw.conversionScore ?? kw.conversion_score ?? '',
            trafficPotential:  f(kw, 'traffic_potential', 'trafficPotential', 'traffic'),
            recommendedCampaign,
            adGroup,
            negativeKeywords:  fArr(kw, 'negative_keywords', 'negativeKeywords', 'negatives'),
            whyItConverts:     f(kw, 'why_it_converts', 'whyItConverts', 'why_converts', 'recommendation', 'reason'),
            analysis:          item.analysis || null,
            campaignStructure: item.campaign_structure || item.campaignStructure || null,
          }
        })
      }).filter(kw => {
        const text = kw.keyword
        if (isKeywordPolicyViolating(text)) {
          console.log('[keywords:ideas] filtered (policy):', text)
          return false
        }
        const norm = text.toLowerCase().trim()
        if (seen.has(norm)) {
          console.log('[keywords:ideas] filtered (duplicate):', text)
          return false
        }
        seen.add(norm)
        return true
      })
    } catch (e) {
      console.warn('[keywords:ideas] parse attempt failed:', e.message)
    }
  }

  return []
})

// ── CPC keyword optimizer — powered by Claude AI ─────────────────────────────

ipcMain.handle('keywords:cpcOptimize', async (_e, { keywords, customPrompt, selectedCampaign, selectedAdGroup, existingCampaigns, campaignAdGroupPairs }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) {
    throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  }
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const kwLines = (keywords || [])
    .slice(0, 20)
    .map(k => `- ${k.keyword}${k.cpc ? ` (CPC: $${k.cpc})` : ''}`)
    .join('\n')

  const systemPrompt =
    `You are a Senior Google Ads Strategist, PPC Optimization Expert, and Lead Generation Performance Auditor.\n\n` +
    `You specialize in local service businesses, high-intent lead generation campaigns, Search campaigns, Performance Max campaigns, landing page alignment, conversion tracking, account structure, keyword quality, negative keyword control, and conversion-focused ad copy.\n\n` +
    `Your job is to analyze Google Ads account data and produce practical, account-safe recommendations that improve qualified lead volume, reduce wasted spend, improve lead quality, and protect campaign structure.\n\n` +
    `You are not a generic keyword idea generator.\n\n` +
    `You must think like an elite Google Ads manager responsible for real client performance, not just Google Ads dashboard scores.\n\n` +
    `--------------------------------------------------\n` +
    `CORE OBJECTIVE\n` +
    `--------------------------------------------------\n\n` +
    `Your goal is to improve:\n` +
    `- Qualified lead volume\n` +
    `- Conversion quality\n` +
    `- Cost per qualified lead\n` +
    `- Search term relevance\n` +
    `- Campaign and ad group structure\n` +
    `- Ad relevance\n` +
    `- Landing page alignment\n` +
    `- Budget efficiency\n` +
    `- Conversion tracking quality\n` +
    `- Long-term account stability\n\n` +
    `Your goal is not to chase cheap clicks, broad traffic, vanity metrics, or platform recommendations that may reduce lead quality.\n\n` +
    `A cheaper click is not an improvement unless it preserves or improves lead quality.\n\n` +
    `--------------------------------------------------\n` +
    `DECISION PRIORITIES\n` +
    `--------------------------------------------------\n\n` +
    `Prioritize in this order:\n\n` +
    `1. Lead quality\n` +
    `2. Conversion intent\n` +
    `3. Revenue potential\n` +
    `4. Campaign structure accuracy\n` +
    `5. Landing page alignment\n` +
    `6. Search term relevance\n` +
    `7. Cost per qualified conversion\n` +
    `8. CPC reduction\n` +
    `9. CTR improvement\n` +
    `10. Google Ads score improvement\n\n` +
    `Never recommend changes only to improve Google Ads scores. Prioritize real lead quality, qualified conversion volume, revenue potential, and account safety over platform recommendations.\n\n` +
    `--------------------------------------------------\n` +
    `DATA RULES\n` +
    `--------------------------------------------------\n\n` +
    `When account data is available, use real performance data before making recommendations.\n\n` +
    `Evaluate:\n` +
    `- Campaign\n` +
    `- Ad group\n` +
    `- Keyword\n` +
    `- Search term\n` +
    `- Match type\n` +
    `- Cost\n` +
    `- Clicks\n` +
    `- Impressions\n` +
    `- CTR\n` +
    `- Average CPC\n` +
    `- Conversions\n` +
    `- Conversion rate\n` +
    `- Cost per conversion\n` +
    `- Conversion value if available\n` +
    `- Search impression share\n` +
    `- Search lost IS budget\n` +
    `- Search lost IS rank\n` +
    `- Quality Score components when available\n` +
    `- Expected CTR\n` +
    `- Ad relevance\n` +
    `- Landing page experience\n` +
    `- Device\n` +
    `- Location\n` +
    `- Time of day\n` +
    `- Conversion action type\n` +
    `- Lead quality notes if available\n\n` +
    `Do not recommend pausing, lowering bids, or excluding terms based only on high CPC. A high-CPC keyword may be valuable if it produces qualified leads at an acceptable cost.\n\n` +
    `Do not recommend increasing budget only because a campaign is limited by budget. Check lead quality, CPA, conversion rate, search term quality, impression share, and landing page alignment first.\n\n` +
    `Do not recommend broad expansion unless conversion tracking, negatives, landing page alignment, and account structure are strong enough to support it.\n\n` +
    `--------------------------------------------------\n` +
    `KEYWORD RULES\n` +
    `--------------------------------------------------\n\n` +
    `For expensive keywords, analyze:\n` +
    `- Why CPC is likely high\n` +
    `- Search intent\n` +
    `- Buyer stage\n` +
    `- Current campaign fit\n` +
    `- Current ad group fit\n` +
    `- Landing page alignment\n` +
    `- Match type risk\n` +
    `- Lower-CPC alternatives with equal or stronger booking intent\n\n` +
    `Do not recommend a lower-CPC keyword unless it preserves strong booking intent. If a lower-CPC alternative may reduce lead quality, label it Medium Risk or High Risk.\n\n` +
    `Do not generate:\n` +
    `- Informational keywords\n` +
    `- Blog keywords\n` +
    `- "What is" keywords\n` +
    `- "How to" keywords\n` +
    `- DIY keywords\n` +
    `- Free intent\n` +
    `- Job seeker intent\n` +
    `- Salary intent\n` +
    `- Training intent\n` +
    `- School intent\n` +
    `- Shopping intent\n` +
    `- Parts intent\n` +
    `- Used equipment intent\n` +
    `- Marketplace intent\n` +
    `- Municipal or public service intent\n` +
    `- Broad irrelevant keywords\n` +
    `- ANY keyword with estimated monthly searches below 1,000 — Google Ads marks these as "Low Search Volume" and they will NEVER serve ads. Only recommend keywords with 1,000+ monthly searches.\n\n` +
    `Focus only on:\n` +
    `- Transactional intent\n` +
    `- Commercial intent\n` +
    `- Service-booking intent\n` +
    `- Local buyer intent\n` +
    `- Emergency intent\n` +
    `- High-value service intent\n` +
    `- Long-tail service intent\n` +
    `- Geo-modified intent\n` +
    `- Price-qualified intent when appropriate\n\n` +
    `--------------------------------------------------\n` +
    `GOOGLE ADS POLICY COMPLIANCE — MANDATORY\n` +
    `--------------------------------------------------\n\n` +
    `Every alternative keyword you recommend MUST be publishable to Google Ads without triggering a policy violation. Violations cause the keyword to be rejected at publish time.\n\n` +
    `NEVER recommend keywords that contain:\n` +
    `- Trademarked brand names (competitors, software, platforms, retailers, franchise names) — use generic descriptors instead. Example: use "drain cleaning service" not "Roto-Rooter drain cleaning"\n` +
    `- Prescription drug names, pharmaceutical brands, or medical treatment claims\n` +
    `- Gambling, casino, lottery, or betting terms\n` +
    `- Adult, explicit, or sexual content\n` +
    `- Weapons, firearms, ammunition, or dangerous products\n` +
    `- Alcohol brands or heavily regulated alcohol terms\n` +
    `- Financial products requiring regulatory approval (payday loans, cryptocurrency, binary options)\n` +
    `- Health claims implying a guaranteed cure or miraculous outcome\n` +
    `- Terms violating Google's misrepresentation or deceptive practices policy\n\n` +
    `ALWAYS use:\n` +
    `- Generic service descriptors ("HVAC repair", "emergency electrician", "roof replacement")\n` +
    `- Location + service combinations ("plumber Austin TX", "Chicago roofing company")\n` +
    `- Intent + service combinations ("affordable AC repair", "same day locksmith")\n` +
    `- Industry-standard terminology that describes the service without naming a brand\n\n` +
    `--------------------------------------------------\n` +
    `MATCH TYPE RULES\n` +
    `--------------------------------------------------\n\n` +
    `For each recommended keyword, provide a recommended match type: Exact, Phrase, or Broad.\n\n` +
    `Default to Exact and Phrase for local service lead generation campaigns.\n\n` +
    `Only recommend Broad when:\n` +
    `- Conversion tracking is accurate\n` +
    `- Negative keyword coverage is strong\n` +
    `- The campaign has enough conversion data\n` +
    `- The landing page is tightly aligned\n` +
    `- The account can tolerate broader query matching\n\n` +
    `Flag Broad match as higher risk unless the account data strongly supports it.\n\n` +
    `--------------------------------------------------\n` +
    `SEARCH TERM RULES\n` +
    `--------------------------------------------------\n\n` +
    `For search terms, classify intent as:\n` +
    `High Intent | Medium Intent | Low Intent | Bad Intent | Wrong Campaign | Wrong Ad Group | Research Intent | DIY Intent | Job Seeker Intent | Shopping Intent | Municipal or Free Service Intent | Competitor Intent | Brand Intent\n\n` +
    `For each search term, recommend one of these actions:\n` +
    `Keep | Add as keyword | Move to another campaign | Add negative | Monitor | Reduce bid | Improve ad copy | Improve landing page | Pause only if justified by data\n\n` +
    `Do not exclude a search term only because it has no conversions unless spend is meaningful enough to justify action.\n\n` +
    `--------------------------------------------------\n` +
    `CAMPAIGN ROUTING RULES\n` +
    `--------------------------------------------------\n\n` +
    `Before recommending new keywords or negatives, determine whether the keyword or search term belongs in the current campaign and ad group.\n\n` +
    `If a search term is triggering the wrong campaign or ad group, do not simply pause or block the traffic. Recommend: Add the keyword to the correct campaign or ad group, add a negative keyword firewall to the wrong campaign or ad group, improve ad copy alignment, improve landing page alignment.\n\n` +
    `Classify routing as:\n` +
    `Correct | Weak | Wrong Campaign | Wrong Ad Group | Needs Split | Needs Dedicated Landing Page\n\n` +
    `--------------------------------------------------\n` +
    `NEGATIVE KEYWORD RULES\n` +
    `--------------------------------------------------\n\n` +
    `For each negative keyword recommendation, specify:\n` +
    `- Negative keyword\n` +
    `- Match type: Exact or Phrase\n` +
    `- Level: Account, Campaign, or Ad Group\n` +
    `- Reason\n` +
    `- Conflict risk\n` +
    `- Safer alternative if needed\n\n` +
    `Never recommend a phrase-match negative if it could block valuable service intent. Use exact match when the term is only bad by itself. Use account-level negatives only when the intent is universally bad for the entire account. Use campaign-level negatives for campaign separation and service firewalls. Use ad group-level negatives for tighter routing and internal segmentation. Do not recommend broad negative keywords.\n\n` +
    `--------------------------------------------------\n` +
    `RISK AND APPROVAL RULES\n` +
    `--------------------------------------------------\n\n` +
    `For every recommendation, assign a risk level:\n` +
    `- Low Risk\n` +
    `- Medium Risk\n` +
    `- High Risk\n\n` +
    `--------------------------------------------------\n` +
    `OUTPUT FORMAT\n` +
    `--------------------------------------------------\n\n` +
    `Return ONLY a valid JSON array (one object per seed keyword), no markdown, no extra text.\n\n` +
    `Each object must follow this exact structure:\n` +
    `{\n` +
    `  "seed_keyword": "",\n` +
    `  "analysis": {\n` +
    `    "intent": "",\n` +
    `    "buyer_stage": "",\n` +
    `    "why_cpc_is_high": "",\n` +
    `    "estimated_cpc_reduction": ""\n` +
    `  },\n` +
    `  "recommended_keywords": [\n` +
    `    {\n` +
    `      "keyword": "",\n` +
    `      "match_type": "Exact|Phrase|Broad",\n` +
    `      "search_intent": "Transactional|Commercial|Local Service|Emergency|Price Comparison",\n` +
    `      "buyer_stage": "Ready To Buy|Comparing Options|Urgent Need",\n` +
    `      "estimated_monthly_searches": "",\n` +
    `      "competition": "Low|Medium|High",\n` +
    `      "estimated_cpc": "$0–$0 (e.g. $4–$7)",\n` +
    `      "estimated_cpc_savings": "0–0% (e.g. 35–45%)",\n` +
    `      "conversion_probability_score": 0,\n` +
    `      "traffic_potential": "High Traffic|Balanced|High Conversion",\n` +
    `      "recommended_ad_group": "",\n` +
    `      "landing_page_intent": "",\n` +
    `      "negative_keywords": [],\n` +
    `      "risk_level": "Low Risk|Medium Risk|High Risk",\n` +
    `      "why_it_converts": ""\n` +
    `    }\n` +
    `  ],\n` +
    `  "campaign_structure": {\n` +
    `    "campaign_name": "",\n` +
    `    "ad_groups": []\n` +
    `  }\n` +
    `}`

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 8192,
    system:     systemPrompt,
    messages: [{
      role: 'user',
      content:
        (customPrompt
          ? `CUSTOM OPTIMIZATION OBJECTIVE FROM THE USER:\n${customPrompt}\n\nApply your Senior Google Ads expertise to this objective.\n\n`
          : `Analyze these expensive Google Ads keywords and return strategic lower-CPC alternatives.\n\n`) +
        (selectedCampaign
          ? `TARGET CAMPAIGN: The user wants alternatives specifically for this campaign: "${selectedCampaign}". For every recommended keyword, set "recommended_ad_group" to fit within this campaign's structure.\n` +
            (selectedAdGroup ? `TARGET AD GROUP: "${selectedAdGroup}". All alternatives must be tightly relevant to this ad group.\n\n` : '\n')
          : (existingCampaigns || []).length > 0
            ? `EXISTING ACCOUNT CAMPAIGNS (for campaign routing context):\n${existingCampaigns.map(c => `- ${c}`).join('\n')}\nSEMANTIC MATCH REQUIRED: when setting "campaign_structure.campaign_name" for a seed keyword's group, choose the EXISTING campaign whose service/theme most closely matches that expensive keyword's actual service — not just any valid name from the list. Example: a keyword about "junk removal" belongs in a junk/waste-removal campaign, not a loosely-related one like "Property Cleanouts" unless it's genuinely the same service. If none of the campaigns are a close topical match, use the most logical NEW campaign name based on the keyword instead of forcing a mismatch.\n\n`
            : '') +
        `KEYWORDS TO ANALYZE:\n${kwLines}\n\n` +
        `Return ONLY a valid JSON array — one object per keyword above. No markdown, no extra text.`,
    }],
  })

  const raw = message.content[0]?.text || '[]'
  try {
    const parsed = JSON.parse(raw.replace(/```json\n?|```\n?/g, '').trim())
    const seenCpc = new Set()
    // Flatten the rich structure into the flat array format the UI expects.
    // Deterministic campaign/ad-group override (only when no target was
    // explicitly chosen) — same rationale as keywords:ideas above.
    return (Array.isArray(parsed) ? parsed : []).flatMap(item => {
      const groupMatch = !selectedCampaign ? findBestCampaignMatch(item.seed_keyword || '', campaignAdGroupPairs) : null
      const campaignStructure = groupMatch
        ? { ...(item.campaign_structure || {}), campaign_name: groupMatch.campaign }
        : (item.campaign_structure || null)
      return (item.recommended_keywords || []).map(kw => {
        let adGroup = kw.recommended_ad_group || ''
        if (!selectedCampaign && !selectedAdGroup) {
          const altMatch = findBestCampaignMatch(kw.keyword || '', campaignAdGroupPairs)
          if (altMatch) adGroup = altMatch.adGroup
        }
        return {
          expensiveKeyword:  item.seed_keyword || '',
          alternative:       kw.keyword || '',
          matchType:         kw.match_type || '',
          competition:       kw.competition || '',
          estimatedCpc:      kw.estimated_cpc || '',
          estimatedSavings:  kw.estimated_cpc_savings || '',
          whyItWorks:        kw.why_it_converts || '',
          searchIntent:      kw.search_intent || '',
          buyerStage:        kw.buyer_stage || '',
          conversionScore:   kw.conversion_probability_score ?? '',
          trafficPotential:  kw.traffic_potential || '',
          adGroup,
          negativeKeywords:  kw.negative_keywords || [],
          monthlySearches:   kw.estimated_monthly_searches || '',
          analysis:          item.analysis || null,
          campaignStructure,
        }
      })
    }).filter(kw => {
      const text = kw.alternative
      if (isKeywordPolicyViolating(text)) {
        console.log('[keywords:cpcOptimize] filtered (policy):', text)
        return false
      }
      const norm = text.toLowerCase().trim()
      if (seenCpc.has(norm)) {
        console.log('[keywords:cpcOptimize] filtered (duplicate):', text)
        return false
      }
      seenCpc.add(norm)
      return true
    })
  } catch {
    return []
  }
})

// ── Negative Keywords Optimizer — powered by Claude AI ───────────────────────

ipcMain.handle('keywords:negativeOptimize', async (_e, { keywords, negatives, customPrompt }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) {
    throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  }
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const kwLines = (keywords || []).slice(0, 60).map(k =>
    `- "${k.keyword}" | ${k.matchType} | ${k.campaign} > ${k.adGroup} | Clicks:${k.clicks} Impr:${k.impressions} Cost:$${k.cost} Conv:${k.conversions} CPC:$${k.cpc} CTR:${k.ctr}% ConvRate:${k.convRate}%`
  ).join('\n')

  const negLines = (negatives || []).length
    ? (negatives).slice(0, 50).map(n =>
        `- "${n.keyword}" | ${n.matchType} | ${n.level} | ${n.campaign}${n.adGroup ? ' > ' + n.adGroup : ''}`
      ).join('\n')
    : 'None provided.'

  const systemPrompt =
    `You are a Senior Google Ads PPC Strategist and Negative Keyword Optimization Expert.\n\n` +
    `Your task is to deeply analyze keyword performance data and existing negative keywords to produce an agency-grade negative keyword optimization report.\n\n` +
    `CORE GOALS:\n` +
    `- Reduce wasted ad spend\n` +
    `- Improve lead quality\n` +
    `- Reduce irrelevant clicks\n` +
    `- Improve conversion efficiency\n` +
    `- Lower CPC\n` +
    `- Improve ROAS\n` +
    `- Maintain a clean, efficient negative keyword structure\n\n` +
    `--------------------------------------------------\n` +
    `STEP 1 — SEARCH INTENT ANALYSIS\n` +
    `--------------------------------------------------\n` +
    `Classify each keyword or pattern into ONE of these intent categories:\n` +
    `Transactional Intent | Commercial Intent | Informational Intent | DIY Intent |\n` +
    `Employment Intent | Educational Intent | Research Intent | Freebie Intent |\n` +
    `Competitor Research | Low Commercial Intent | Geographic Mismatch\n\n` +
    `STEP 2 — WASTED SPEND DETECTION\n` +
    `Identify keywords with: high spend + zero or near-zero conversions, high CPC with no commercial return, repeated poor-performing patterns, low-intent searches.\n\n` +
    `STEP 3 — NEGATIVE KEYWORD RECOMMENDATIONS\n` +
    `For EACH recommendation provide: negative keyword, match type, intent type, priority, confidence score (0-100), waste severity, blocking safety, estimated monthly savings, placement logic, reason, related terms, a brief explanation (2 sentences max), and a concrete actionable recommendation.\n\n` +
    `For ai_explanation: 2 sentences max — state the intent signal and the spend/performance evidence.\n` +
    `For ai_recommendation: write a specific, actionable next step a PPC manager can execute today in Google Ads 2026. Reference exact Google Ads features where relevant (e.g. Negative Keyword Lists, Campaign-level negatives, Smart Bidding signals, Broad Match + audience layering, Performance Max exclusions, Search Term Insight reports).\n\n` +
    `MATCH TYPE RULES:\n` +
    `- Exact Match: very specific queries where broader blocking would hurt conversions\n` +
    `- Phrase Match: when an intent pattern is consistently poor (e.g. [free *], [* jobs])\n` +
    `- Broad Match: ONLY when intent is universally irrelevant (never block local or service terms broadly)\n\n` +
    `PLACEMENT RULES:\n` +
    `- Campaign Level: universally irrelevant traffic across all ad groups in the campaign\n` +
    `- Ad Group Level: traffic that conflicts between specific ad groups only\n` +
    `- Shared Negative List: account-wide irrelevant intent (jobs, free, DIY, training, salary)\n\n` +
    `OVERBLOCKING PROTECTION — NEVER recommend negatives that could block:\n` +
    `- high-converting queries, strong commercial intent, local buyer intent, transactional searches,\n` +
    `- terms like "near me", "best", "affordable", "local", "same day", "emergency"\n\n` +
    `STEP 4 — DUPLICATE & CONFLICT DETECTION\n` +
    `Analyze existing negatives for: duplicates, redundant entries, conflicting negatives, overblocking risks, obsolete negatives, dangerous broad negatives.\n\n` +
    `STEP 5 — PATTERN ANALYSIS\n` +
    `Group recurring low-quality search patterns and recommend scalable negative strategies.\n` +
    `Common patterns to detect: "free *", "* jobs", "* salary", "* tutorial", "* DIY", "how to *", "* training", "* used", "* cheap parts"\n\n` +
    `--------------------------------------------------\n` +
    `SCORING SYSTEM\n` +
    `--------------------------------------------------\n` +
    `Priority: Critical | High | Medium | Low\n` +
    `Waste Severity: Critical Waste | Moderate Waste | Low Waste\n` +
    `Blocking Safety: Safe | Review | Risky\n` +
    `Confidence: 0–100\n\n` +
    `--------------------------------------------------\n` +
    `OUTPUT FORMAT\n` +
    `--------------------------------------------------\n` +
    `Return ONLY valid JSON, no markdown, no extra text.\n\n` +
    `{\n` +
    `  "summary": {\n` +
    `    "estimated_monthly_wasted_spend": "$0",\n` +
    `    "total_recommendations": 0,\n` +
    `    "critical_issues": 0,\n` +
    `    "duplicates_found": 0,\n` +
    `    "overblocking_risks": 0,\n` +
    `    "estimated_monthly_savings": "$0"\n` +
    `  },\n` +
    `  "recommendations": [\n` +
    `    {\n` +
    `      "negative_keyword": "",\n` +
    `      "match_type": "Exact|Phrase|Broad",\n` +
    `      "intent_type": "",\n` +
    `      "priority": "Critical|High|Medium|Low",\n` +
    `      "confidence_score": 0,\n` +
    `      "waste_severity": "Critical Waste|Moderate Waste|Low Waste",\n` +
    `      "blocking_safety": "Safe|Review|Risky",\n` +
    `      "estimated_savings": "$0/mo",\n` +
    `      "placement": "Campaign Level|Ad Group Level|Shared Negative List",\n` +
    `      "reason": "",\n` +
    `      "related_search_terms": [],\n` +
    `      "ai_explanation": "(2 sentences max: state the intent signal and the performance evidence)",\n` +
    `      "ai_recommendation": "(specific actionable next step using Google Ads 2026 features)"\n` +
    `    }\n` +
    `  ],\n` +
    `  "conflicts": [\n` +
    `    {\n` +
    `      "issue_type": "Duplicate|Conflict|Overblocking|Redundant",\n` +
    `      "keyword": "",\n` +
    `      "locations": [],\n` +
    `      "severity": "Critical|High|Medium|Low",\n` +
    `      "impact": "",\n` +
    `      "recommendation": ""\n` +
    `    }\n` +
    `  ],\n` +
    `  "patterns": [\n` +
    `    {\n` +
    `      "pattern": "",\n` +
    `      "intent_category": "",\n` +
    `      "affected_terms": [],\n` +
    `      "recommended_negative": "",\n` +
    `      "match_type": "Exact|Phrase|Broad"\n` +
    `    }\n` +
    `  ]\n` +
    `}`

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 16000,
    system:     systemPrompt,
    messages: [{
      role: 'user',
      content:
        (customPrompt
          ? `CUSTOM OPTIMIZATION OBJECTIVE FROM THE USER:\n${customPrompt}\n\nApply your Senior Google Ads expertise to this objective.\n\n`
          : `Analyze this Google Ads account data and return a complete negative keyword optimization report.\n\n`) +
        `KEYWORD PERFORMANCE DATA (sorted by cost):\n${kwLines}\n\n` +
        `EXISTING NEGATIVE KEYWORDS:\n${negLines}\n\n` +
        `CRITICAL: Return ONLY a raw JSON object. No markdown, no code fences, no explanation. Start your response with { and end with }`,
    }],
  })

  const raw = (message.content[0]?.text || '').trim()
  console.log('[negativeOptimize] stop_reason:', message.stop_reason, '| response length:', raw.length)
  console.log('[negativeOptimize] first 300 chars:', raw.slice(0, 300))

  // Bracket-balanced extraction — finds the first complete {...} block regardless of surrounding text
  function extractTopLevelJSON(text) {
    let depth = 0, start = -1
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '{') { if (start === -1) start = i; depth++ }
      else if (ch === '}') { depth--; if (depth === 0 && start !== -1) return text.slice(start, i + 1) }
    }
    return null
  }

  const candidates = [
    raw,
    raw.replace(/```json\s*/g, '').replace(/```/g, '').trim(),
    extractTopLevelJSON(raw),
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object') {
        console.log('[negativeOptimize] parsed OK — recommendations:', (parsed.recommendations||[]).length)
        return parsed
      }
    } catch (e) {
      console.warn('[negativeOptimize] parse attempt failed:', e.message)
    }
  }

  console.error('[negativeOptimize] all attempts failed. Full raw:\n', raw)
  throw new Error('AI returned an unexpected response format. Please try again.')
})

// ── Negative Keywords Optimizer — single-row recommendation retry ─────────────

ipcMain.handle('keywords:negativeRowRecommend', async (_e, { row }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content:
        `You are a Senior Google Ads PPC Strategist. Write a single, specific, actionable recommendation for a PPC manager to implement in Google Ads (2026 features).\n\n` +
        `Negative keyword to add: "${row.negative_keyword}"\n` +
        `Match type: ${row.match_type}\n` +
        `Intent type: ${row.intent_type}\n` +
        `Priority: ${row.priority}\n` +
        `Waste severity: ${row.waste_severity}\n` +
        `Estimated savings: ${row.estimated_savings}\n` +
        `Placement: ${row.placement}\n` +
        `Reason: ${row.reason}\n` +
        `Related terms: ${(row.related_search_terms || []).join(', ') || 'none'}\n\n` +
        `Write 2-3 sentences maximum. Be specific — reference exact Google Ads 2026 features where relevant (Negative Keyword Lists, Performance Max URL exclusions, campaign-level negatives, Search Term Insight reports, Smart Bidding signals, Broad Match + audience layering). ` +
        `Tell the manager exactly what to click, where to go, and why this action will improve performance. No preamble, no bullet points — just the recommendation.`,
    }],
  })

  return (message.content[0]?.text || '').trim()
})

// ── Account audit ─────────────────────────────────────────────────────────────

// In-memory cache for AI audit recommendations (cleared on app restart)
const auditAiCache = new Map()

function auditHash(sections) {
  const s = JSON.stringify(sections)
  let h = 0
  for (let i = 0; i < s.length; i++) { h = Math.imul(31, h) + s.charCodeAt(i) | 0 }
  return h
}

ipcMain.handle('audit:ai-recommend', async (_e, { customerId, sections, forceRefresh }) => {
  const cacheKey = `${customerId}_${auditHash(sections)}`
  if (!forceRefresh && auditAiCache.has(cacheKey)) {
    console.log('[audit:ai-recommend] cache hit for', customerId)
    return auditAiCache.get(cacheKey)
  }
  if (forceRefresh) auditAiCache.delete(cacheKey)
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  // Build section blocks only for sections that have data
  const active = Object.entries(sections).filter(([, items]) => items.length > 0)

  // Section-specific expert guidance injected into the prompt
  const SECTION_CONTEXT = {
    adStrength: `
AD STRENGTH — each row is an ad with POOR, AVERAGE, or GOOD strength that needs improvement.
For each: recommend concrete, actionable headline/description improvements to push the ad toward EXCELLENT.
- POOR/AVERAGE: focus on adding unique headlines, including primary keywords in headlines 1–3, improving description relevance
- GOOD: focus on incremental improvements — more specific CTAs, stronger value propositions, better keyword coverage, landing page alignment
- Reference specific counts (e.g. "Add 2 more unique headlines to reach the recommended 15")
- Keep recommendations direct and specific to the ad's campaign and ad group context`,

    budgetIssues: `
BUDGET ISSUES — evaluate each campaign's spend vs. daily budget carefully.
RULES YOU MUST FOLLOW:
- NEVER recommend increasing budget to match actual spend directly
- If utilization is 100–130%: recommend monitoring or a 10–20% increase only if ROAS/CPL is healthy
- If utilization is >200%: audit campaign settings FIRST (search terms, geo, match types, tracking validity) before any budget change
- For Performance Max: recommend segmentation, audience overlap check, conversion signal validation
- Suggest controlled test budgets ($X–$Y/day range), not blind increases
- Be conservative. Sound like a senior PPC manager protecting client profitability`,

    conflicts: `
KEYWORD CONFLICTS — each row is a keyword that appears in more than one ad group, meaning your own ads are bidding against each other and wasting budget.
Write in plain English that a business owner (not a PPC expert) can understand and act on immediately.
For each recommendation:
1. Open with a one-sentence plain-English explanation of the problem: e.g. "The keyword [X] exists in both [Ad Group A] and [Ad Group B], so your ads are competing with themselves and driving up your own costs."
2. Then give a clear step-by-step fix using the exact campaign and ad group names from the data.
- Duplicate: "Remove [keyword] from [weaker ad group] — keep it only in [stronger/more relevant ad group]."
- Match-type conflict (broad stealing from exact/phrase): "Add [keyword] as a negative keyword inside [broad-match ad group] so it stops triggering there and the more targeted ad group takes over."
- Never use the word 'cannibalisation'. Say 'competing with itself' or 'bidding against itself' instead.
- Always name the exact keyword, campaign, and ad group(s) from the data.`,

    crossovers: `
SERVICE CROSSOVER ISSUES — two campaigns that target the same searches or audiences, causing them to compete with each other and inflate costs.
Write in plain English that a business owner (not a PPC expert) can understand and act on today.
For each recommendation:
1. Open with a one-sentence plain-English explanation: e.g. "Both [Campaign A] and [Campaign B] are chasing the same searches, so they are bidding against each other and pushing your costs up."
2. Then give a clear, numbered action plan using the actual campaign names from the data.
- Performance Max vs Search: "In [Search Campaign], add the landing-page URLs that [PMax Campaign] covers as URL exclusions, so the two campaigns no longer overlap." Explain what a URL exclusion does: "(A URL exclusion tells that campaign to stop showing ads for pages another campaign is already handling.)"
- Competing Search campaigns: "Pause [broader/less focused campaign] or tighten its keyword list so it no longer targets the same terms as [more specific campaign]."
- Use everyday language. If you must use a technical term (e.g. negative keyword, URL exclusion), explain it in plain words in brackets immediately after.
- Always name both campaign names from the data.`,

    agIssues: `
AD GROUP HEALTH — inactive ad groups with zero impressions despite being Enabled.
For each: diagnose the likely cause and recommend a fix.
- Check for keyword bid below first-page CPC
- Review ad group bids vs. campaign budget
- Flag possible audience or targeting restriction
- Recommend pausing if no activity in 30+ days as a cleanup action`,

    policyIssues: `
POLICY & APPROVAL ISSUES — disapproved or under-review ads.
For each: recommend the most likely fix based on the campaign/ad group context.
- Reference Google Ads policy categories most likely violated (circumventing systems, misleading content, etc.)
- Suggest reviewing ad copy for policy-triggering phrases
- Recommend submitting for re-review after edits
- For Under Review: note typical review timelines`,

    kwIssues: `
KEYWORD PERFORMANCE ISSUES — each row is a keyword flagged for one specific problem (issue field): "High Spend, Zero Conversions", "Poor Quality Score", "Low CTR", or "High CPC".
The person reading this does not know PPC — explain what's wrong in plain English and exactly what to do next.
For each recommendation:
1. Open with a one-sentence plain-English explanation naming the exact keyword and the number(s) that make it a problem (cost, CTR, quality score, CPC — whichever applies).
2. Then give one concrete next step: for "High Spend, Zero Conversions" — pause it or change match type to reduce reach; for "Poor Quality Score" — improve ad relevance/landing page alignment for that term; for "Low CTR" — rewrite ad copy to better match this keyword's intent; for "High CPC" — consider a tighter match type or a bid adjustment.
- Always name the exact keyword and match type from the data.`,

    kwOpportunities: `
HIGH-CONVERTING KEYWORDS — each row is a keyword that is already converting well.
For each: recommend a specific way to get MORE value from it — raise its bid, expand to a broader match type to catch more volume, use it as a seed for new closely-related keywords, or feature it more prominently in ad copy.
- Always name the exact keyword, its match type, and its conversion count/cost from the data to justify the recommendation.
- Keep it to 1-2 sentences, concrete and specific — no generic "monitor performance" filler.`,

    keywordConflicts: `
KEYWORD CONFLICT — a negative keyword that is blocking, or could block, one of the account's own positive keywords (conflictType: "Self-Negation" means it's a guaranteed block; "Broad Negative Overlap" / "Phrase Negative Overlap" mean it's a likely/possible block).
For each: explain in plain English which negative is blocking which positive keyword and why, then give the exact fix.
- Self-Negation: this is unambiguous — recommend removing either the negative or the positive keyword (they cannot both work), and say which is more likely the mistake based on the negative's level (a broad account-wide list negative is more likely the mistake than a narrowly-placed one).
- Broad/Phrase Negative Overlap: recommend either narrowing the negative's match type, excluding this specific positive keyword's ad group from the negative's scope, or confirming the overlap is intentional if the negative is meant to filter irrelevant traffic.
- Always name the exact positive keyword, negative keyword, and campaign/ad group from the data.`,

    conversionActions: `
CONVERSION TRACKING — each row is an enabled conversion action (countedInConversions: whether it feeds the account's "Conversions" column; isDuplicateName: same name as another action).
For each: give one concrete, specific recommendation based on its actual configuration — do not invent data you weren't given (no last-activity date or primary/secondary flag exists in this data).
- countedInConversions=false: explain that this action's results are invisible to Smart Bidding and reporting, and recommend either including it (if it's a meaningful action) or leaving it excluded with a one-line reason why that's correct (e.g. it's a soft/micro-conversion being tracked separately).
- isDuplicateName=true: recommend reviewing both actions with this name for redundant tracking (double-counting) and consolidating or renaming one to clarify what each measures.
- Otherwise: a short note on whether this action's type/category (e.g. "Submit Lead Form", "Get Directions") is the kind of action worth being a primary conversion goal for a lead-gen or e-commerce account, and why.
- Always name the exact conversion action from the data.`,

    performanceOffenders: `
PERFORMANCE AUDIT — a cross-cutting rollup of the worst-performing entities across the account (type: Keyword, Ad, or Campaign; issue names the specific metric problem).
For each: one concrete, specific action tailored to the entity type.
- Keyword (High Spend, Zero Conversions): recommend pausing it, tightening its match type, or adding negatives to narrow the traffic it's catching.
- Ad (Low CTR / Low Conversion Rate): recommend rewriting headlines/descriptions for stronger relevance, or checking landing page alignment if CTR is fine but conversion rate is the problem.
- Campaign (Overpacing / Limited by budget / No activity): same rules as Budget & Bidding elsewhere — never recommend blindly increasing budget to match spend; audit targeting first if overpacing badly.
- Always name the exact entity (keyword text, ad headline, or campaign name) and its value from the data.`,
  }

  const sectionBlocks = active.map(([section, items]) => {
    const context = SECTION_CONTEXT[section] || ''
    const lines   = items.map(item => `  ${item.index}: ${JSON.stringify(item)}`).join('\n')
    return `[${section}]${context}\nDATA:\n${lines}`
  }).join('\n\n---\n\n')

  const prompt = `You are a senior Google Ads PPC manager. Give practical, direct recommendations that a client can act on today.

Rules:
- ALWAYS name the exact campaign/ad group/keyword from the data
- ALWAYS include specific numbers (budgets, percentages, counts) from the data
- Budget: NEVER say "increase budget to match spend". If utilization >150%: audit targeting first. If 100-130% and ROAS healthy: suggest a 15-20% increase with a specific dollar range.
- For conflicts and crossovers sections: write in plain English a business owner can understand — explain the problem simply, then give numbered action steps. Up to 4 sentences is fine for these sections.
- For all other sections: keep each recommendation to 2-3 sentences max
- No filler phrases ("consider", "it may be worth", "you might want to")

${sectionBlocks}

---
CRITICAL: You MUST output exactly one JSON entry for EVERY index number listed in the DATA above. Count the rows — if a section shows 8 rows (indices 0-7), your response must contain 8 entries for that key. Do NOT skip any index. Do NOT merge rows. Every single index gets its own recommendation.

Reply with ONLY a valid JSON object. No markdown, no extra text, no explanation outside JSON.
Keys must match EXACTLY what appeared in brackets above (e.g. adStrength, budgetIssues, conflicts, agIssues, crossovers, policyIssues).
Each key maps to an array of: { "index": <integer>, "recommendation": "<2-3 sentence direct action>" }
Only include keys that have data above.

Example:
{"budgetIssues":[{"index":0,"recommendation":"[Campaign Name] is spending $93/day against a $50 budget (187% utilization). Before touching the budget, review search term report for irrelevant queries and tighten geo targeting. If ROAS stays healthy after 7 days, test a $65-70/day budget."},{"index":1,"recommendation":"..."}]}`

  const msg = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    messages:   [{ role: 'user', content: prompt }],
  })
  const raw = msg.content[0]?.text || '{}'
  console.log('[audit:ai-recommend] raw response length:', raw.length, '— stop_reason:', msg.stop_reason)
  let result
  try {
    result = JSON.parse(raw.replace(/```json\n?|```\n?/g, '').trim())
  } catch (parseErr) {
    console.error('[audit:ai-recommend] JSON parse failed:', parseErr.message)
    console.error('[audit:ai-recommend] raw (first 800):', raw.slice(0, 800))
    throw new Error('AI response could not be parsed — please try again.')
  }
  auditAiCache.set(cacheKey, result)
  console.log('[audit:ai-recommend] cached for', customerId, '— sections:', Object.keys(result))
  return result
})

ipcMain.handle('audit:fetch', async (_e, { customerId, statusFilter, dateRange }) => {
  const { client, settings } = await getClient()
  return fetchAuditData(client, customerId, settings.mccCustomerId, statusFilter, dateRange, resolveTimeZone(customerId))
})

ipcMain.handle('audit:accountStructure', async (_e, { customerId }) => {
  const { client, settings } = await getClient()
  return fetchAccountStructureData(client, customerId, settings.mccCustomerId)
})

ipcMain.handle('audit:keywordConflicts', async (_e, { customerId }) => {
  const { client, settings } = await getClient()
  return fetchKeywordConflictData(client, customerId, settings.mccCustomerId)
})

ipcMain.handle('audit:updateNegativeKeywordStatus', async (_e, { customerId, level, resourceName, newStatus, validateOnly }) => {
  const { client, settings } = await getClient()
  return updateNegativeKeywordStatus(client, customerId, settings.mccCustomerId, { level, resourceName, newStatus, validateOnly })
})

// Account-wide asset coverage — reuses the existing account-level sitelink/
// callout/structured-snippet fetchers (built for ai-sitelinks-builder) rather
// than adding new queries; Asset Audit only needs presence/duplicate counts.
ipcMain.handle('audit:assetAudit', async (_e, { customerId }) => {
  const { client, settings } = await getClient()
  const [sitelinks, callouts, snippets] = await Promise.all([
    fetchAccountSitelinks(client, customerId, settings.mccCustomerId).catch(() => []),
    fetchCalloutAssets(client, customerId, settings.mccCustomerId, { level: 'account' }).catch(() => []),
    fetchStructuredSnippetAssets(client, customerId, settings.mccCustomerId, { level: 'account' }).catch(() => []),
  ])
  const dupe = (arr, keyFn) => {
    const seen = new Map()
    for (const item of arr) {
      const k = keyFn(item)
      seen.set(k, (seen.get(k) || 0) + 1)
    }
    return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key)
  }
  return {
    sitelinks, callouts, snippets,
    duplicateSitelinks: dupe(sitelinks, s => s.headline.toLowerCase().trim()),
    duplicateCallouts:  dupe(callouts, c => c.text.toLowerCase().trim()),
  }
})

// ── Search Terms ─────────────────────────────────────────────────────────────

ipcMain.handle('searchterms:fetch', async (_e, { customerId, dateRange }) => {
  try {
    const { client, settings } = await getClient()
    console.log('[searchterms:fetch] customerId:', customerId, 'dateRange:', JSON.stringify(dateRange))
    const result = await fetchSearchTerms(client, customerId, settings.mccCustomerId, dateRange, resolveTimeZone(customerId))
    console.log('[searchterms:fetch] rows returned:', result.length)
    return { data: result, error: null }
  } catch (err) {
    console.error('[searchterms:fetch] ERROR:', err.message, err.stack)
    return { data: [], error: err.message }
  }
})

// ── Summary Keyword Analysis ──────────────────────────────────────────────────

ipcMain.handle('summary:keywordAnalysis', async (_e, { customerId, dateRange, campaignId, adGroupId }) => {
  const { client, settings } = await getClient()
  return fetchKeywordAnalysisData(client, customerId, settings.mccCustomerId, dateRange, resolveTimeZone(customerId), { campaignId, adGroupId })
})

// ── Summary Search Term Analysis ──────────────────────────────────────────────

ipcMain.handle('summary:searchTermAnalysis', async (_e, { customerId, dateRange, campaignId, adGroupId }) => {
  const { client, settings } = await getClient()
  return fetchSearchTermAnalysisData(client, customerId, settings.mccCustomerId, dateRange, resolveTimeZone(customerId), { campaignId, adGroupId })
})

// ── Summary Ad Performance Analysis ──────────────────────────────────────────

ipcMain.handle('summary:adPerformanceAnalysis', async (_e, { customerId, dateRange, campaignId, adGroupId }) => {
  const { client, settings } = await getClient()
  return fetchAdPerformanceAnalysisData(client, customerId, settings.mccCustomerId, dateRange, resolveTimeZone(customerId), { campaignId, adGroupId })
})

// ── Summary AI Account Review ─────────────────────────────────────────────────

const summaryAiCache = new Map()

ipcMain.handle('summary:aiReview', async (_e, { customerId, dashboardData, dateRange }) => {
  const cacheKey = `${customerId}_${JSON.stringify(dateRange || 'LAST_30_DAYS')}`
  if (summaryAiCache.has(cacheKey)) return summaryAiCache.get(cacheKey)

  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('NO_API_KEY')

  const { client } = await getClient()
  const structure = await fetchAccountStructureData(client, customerId, settings.mccCustomerId)

  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const kpis       = dashboardData?.kpis       || {}
  const deviceSplit = dashboardData?.deviceSplit || []

  const typeCounts = {}
  for (const c of structure.campaigns) typeCounts[c.type] = (typeCounts[c.type] || 0) + 1
  const typesSummary = Object.entries(typeCounts).map(([t, n]) => `${t}: ${n}`).join(', ')
  const campActive  = structure.campaigns.filter(c => c.status === 'Enabled').length
  const campPaused  = structure.campaigns.filter(c => c.status === 'Paused').length

  const agByCamp = {}
  for (const ag of structure.adGroups) {
    if (!agByCamp[ag.campaignId]) agByCamp[ag.campaignId] = []
    agByCamp[ag.campaignId].push(ag.name)
  }

  const campLines = structure.campaigns.map(c => {
    const ags = agByCamp[c.id] || []
    const agPreview = ags.length > 0 ? ` — ${ags.length} ad groups (${ags.slice(0, 3).join(', ')}${ags.length > 3 ? '…' : ''})` : ' — 0 ad groups'
    return `  ${c.status === 'Enabled' ? '▶' : '⏸'} [${c.type}] ${c.name} | Bid: ${c.bidStrategy}${agPreview}`
  }).join('\n')

  const convLines = structure.conversionActions.length > 0
    ? structure.conversionActions.map(c => `  - ${c.name} (${c.category} | type: ${c.type} | counted: ${c.included})`).join('\n')
    : '  (none found)'

  const geoLines = structure.geoTargets.length > 0
    ? structure.geoTargets.slice(0, 20).map(g => `  - ${g.campaign}: ${g.count} locations targeted, ${g.neg} excluded`).join('\n')
    : '  (no explicit location targeting or data unavailable)'

  const deviceLines = deviceSplit.map(d => `  - ${d.device}: ${d.pct}% of clicks`).join('\n') || '  (no data)'

  const prompt = `You are a senior Google Ads account strategist. Perform a detailed account review for Customer ID ${customerId} based on the data below.

=== ACCOUNT STRUCTURE ===
Total Campaigns: ${structure.campaigns.length} (${campActive} active, ${campPaused} paused)
Campaign Types: ${typesSummary || '(none)'}
Total Ad Groups: ${structure.adGroups.length}

=== CAMPAIGN & AD GROUP DETAIL ===
${campLines || '  (no campaigns)'}

=== CONVERSION TRACKING ===
${convLines}

=== GEOGRAPHIC TARGETING ===
${geoLines}

=== DEVICE PERFORMANCE ===
${deviceLines}

=== PERFORMANCE METRICS ===
Impressions: ${(kpis.impressions || 0).toLocaleString()}  |  Clicks: ${(kpis.clicks || 0).toLocaleString()}  |  Spend: $${(kpis.spend || 0).toFixed(2)}
CTR: ${(kpis.ctr || 0).toFixed(2)}%  |  Avg CPC: $${(kpis.avgCpc || 0).toFixed(2)}  |  Conv. Rate: ${(kpis.convRate || 0).toFixed(2)}%
Conversions: ${(kpis.conversions || 0)}  |  CPA: $${(kpis.cpa || 0).toFixed(2)}  |  Phone Conv: ${kpis.phoneConversions || 0}  |  Form Conv: ${kpis.formConversions || 0}

=== INSTRUCTIONS ===
Write a detailed account review covering ALL sections below. Reference actual campaign names. Be specific and direct.

## 1. Account Organization
Explain how the account is structured — hierarchy, segmentation approach, and overall architecture.

## 2. Campaign Inventory
- Breakdown by type: Search, Performance Max, Display, Shopping, Video, Demand Gen
- Naming convention quality — consistent? descriptive? follow a clear pattern?
- Duplicate or overlapping campaigns — flag any with similar names or likely overlapping targeting
- Campaign segmentation quality — logically separated by goal, product, or market?

## 3. Ad Group Structure
- Ad group count per campaign — appropriate depth?
- Naming convention consistency
- Any structural concerns (single ad groups, over-consolidation, excessive nesting)

## 4. Geographic & Device Targeting
- What locations are targeted and how granularly
- Device strategy — modifiers, exclusions, or default bidding

## 5. Conversion Tracking Setup
- Conversion actions tracked and their categories
- Coverage assessment — phone calls, form submits, purchases covered?
- Note: Linked accounts (GA4, Search Console, Merchant Center, Call Tracking, CRM) cannot be verified via API — flag as required manual check.

## 6. Issues & Concerns
- Naming convention problems
- Duplicate or redundant campaigns
- Overlapping targeting risks
- Campaign segmentation gaps

## 7. Top Recommendations
List 5 specific, actionable improvements the account manager should make immediately.

Use ## for section headers and - for bullets. Be direct. No filler. Reference actual campaign names.`

  const msg = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 4096,
    messages:   [{ role: 'user', content: prompt }],
  })

  const review = (msg.content[0]?.text || '').trim()
  summaryAiCache.set(cacheKey, review)
  console.log('[summary:aiReview] generated for', customerId, '— chars:', review.length)
  return review
})

// ── AI Chat Assistant ─────────────────────────────────────────────────────────
// Tool-use based: Claude only sees real account data by calling one of the tools
// below, each of which wraps an existing, already-battle-tested fetch function.
// Conversation history is kept as plain text (no raw tool_use/tool_result blocks
// round-tripped to the renderer) so every new question re-fetches live data
// instead of trusting possibly-stale results from earlier in the chat.

const DATE_RANGE_LABELS = {
  TODAY: 'Today', YESTERDAY: 'Yesterday', LAST_7_DAYS: 'Last 7 Days',
  LAST_14_DAYS: 'Last 14 Days', LAST_30_DAYS: 'Last 30 Days', LAST_90_DAYS: 'Last 90 Days',
  THIS_MONTH: 'This Month', LAST_MONTH: 'Last Month',
}
function describeDateRange(dateRange) {
  if (!dateRange) return 'Last 30 Days'
  if (typeof dateRange === 'string') return DATE_RANGE_LABELS[dateRange] || dateRange
  return `${dateRange.startDate} to ${dateRange.endDate}`
}

const CHAT_TOOLS = [
  {
    name: 'get_account_overview',
    description: 'Overall account performance: impressions, clicks, cost, conversions, CTR, avg CPC, and conversion rate for the period, compared against the previous period; top campaigns by spend; device split; and budget pacing issues (overpacing / no activity / limited by budget). Use first for any general "how is my account doing" or summary question.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_campaign_structure',
    description: 'Campaign and ad group inventory: campaign names, channel types (Search/Performance Max/Display/etc), status, ad group counts per campaign, conversion actions being tracked, and geographic targeting. Use for questions about account structure, organization, or "what campaigns/ad groups do I have".',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_ads_performance',
    description: 'Responsive Search Ad quality and performance: best and weakest ads by CTR / conversion rate / ad strength, ad strength distribution, and which ad extensions (sitelinks, callouts, structured snippets, etc.) are active account-wide. Use for questions about ad copy quality, ad strength, or which specific ads are over/underperforming.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_keywords_performance',
    description: 'Keyword-level performance: top converting keywords, lowest-CPA keywords, low quality-score keywords, keywords with high spend and zero conversions, most expensive CPC keywords, and stats broken down by match type (Broad/Phrase/Exact). Use for questions about keyword performance or quality score.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_search_terms',
    description: 'Actual search queries that triggered ads: terms driving conversions, new keyword opportunities, wasted spend broken down by category (informational queries, competitor-name leakage, low-intent queries, other irrelevant traffic), and recommended negative-keyword / exact-match additions. Use for questions about search terms, irrelevant traffic, or negative keyword opportunities.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_negative_keywords',
    description: 'Negative keywords already applied to the account (count + sample) plus currently recommended negative keywords with estimated wasted-spend savings if added. Use when asked specifically about negative keyword coverage or savings opportunity.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_wasted_spend_keywords',
    description: 'Keywords with meaningful spend ($10+) and zero conversions in the period, sorted by cost descending, each with a recommended action (Pause Immediately / Review & Consider Pausing / Monitor). Use for "where is my budget being wasted" questions.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_call_leads',
    description: 'Phone call conversion data: total calls, connected calls, average call duration, total call cost, cost per call, and phone calls broken down by campaign. Use for questions about call tracking or phone leads.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_account_audit',
    description: 'Account health audit: campaigns with budget pacing issues (overpacing / no activity / limited by budget), ad group and asset group counts, and keyword conflicts / ad-group intent crossovers. Use for "what issues does my account have" or health-check questions.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
]

async function executeChatTool(name, { client, settings, customerId, dateRange }) {
  const mcc = settings.mccCustomerId
  const tz  = resolveTimeZone(customerId)
  switch (name) {
    case 'get_account_overview': {
      const d = await fetchDashboardData(client, customerId, mcc, dateRange, tz)
      return {
        kpis: d.kpis, previousKpis: d.previousKpis,
        topCampaigns: (d.campaigns || []).slice(0, 15),
        deviceSplit: d.deviceSplit,
        budgetIssues: (d.budget || []).filter(b => b.issue).slice(0, 15),
        spendByType: d.spendByType,
      }
    }
    case 'get_campaign_structure': {
      const s = await fetchAccountStructureData(client, customerId, mcc)
      return {
        campaigns: (s.campaigns || []).slice(0, 40),
        adGroupCount: (s.adGroups || []).length,
        conversionActions: s.conversionActions,
        geoTargets: (s.geoTargets || []).slice(0, 20),
      }
    }
    case 'get_ads_performance':
      return await fetchAdPerformanceAnalysisData(client, customerId, mcc, dateRange, tz)
    case 'get_keywords_performance':
      return await fetchKeywordAnalysisData(client, customerId, mcc, dateRange, tz)
    case 'get_search_terms':
      return await fetchSearchTermAnalysisData(client, customerId, mcc, dateRange, tz)
    case 'get_negative_keywords': {
      const d = await buildNegativeKeywordRecommendations(client, customerId, mcc, dateRange, tz, settings)
      return {
        existingNegativeCount:  (d.existingNegatives || []).length,
        existingNegativeSample: (d.existingNegatives || []).slice(0, 10),
        recommendations: (d.recommendations || []).filter(r => r.actionable).sort((a, b) => (b.cost || 0) - (a.cost || 0)).slice(0, 20),
        potentialSavings: d.potentialSavings,
      }
    }
    case 'get_wasted_spend_keywords': {
      const rows = await fetchWastedSpend(client, customerId, mcc, dateRange, undefined, tz)
      return rows.slice(0, 20)
    }
    case 'get_call_leads':
      return await fetchCallLeads(client, customerId, mcc, dateRange, tz)
    case 'get_account_audit': {
      const d = await fetchAuditData(client, customerId, mcc, 'ENABLED', dateRange, tz)
      return {
        campaignsWithIssues: (d.campaigns   || []).filter(c => c.issue).slice(0, 20),
        adGroupCount:        (d.adGroups    || []).length,
        assetGroupCount:     (d.assetGroups || []).length,
        keywordConflicts:    (d.keywords?.conflicts || []).slice(0, 15),
        crossovers:          (d.crossovers || []).slice(0, 15),
      }
    }
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

ipcMain.handle('chat:ask', async (_e, { customerId, dateRange, accountName, messages }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('NO_API_KEY')
  if (!customerId) throw new Error('No account selected.')

  const { client } = await getClient()
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const systemPrompt = `You are Top Ten AdPilot, an expert Google Ads analyst assistant embedded in a reporting dashboard. You are helping the user analyze the Google Ads account "${accountName || customerId}" (Customer ID ${customerId}) for the period: ${describeDateRange(dateRange)}.

Rules:
- Before answering ANY question about account performance, ALWAYS call the relevant tool(s) first to fetch real, current data. Never guess, estimate, or make up numbers.
- Call only the tools relevant to the question. Call multiple tools if the question spans several areas (e.g. comparing ads and keywords).
- Ground every claim in the actual data returned by the tools — cite specific numbers, campaign names, ad group names, or keyword/ad/search-term text.
- If the user asks for a recommendation, give specific, actionable next steps tied directly to the data you fetched (not generic advice).
- If a tool returns no data, say so plainly rather than inventing numbers.
- Be concise and professional. Use short paragraphs and "- " bullet points for lists. Use "## " headers only if the answer genuinely has multiple distinct sections.
- Never dump raw tool output back at the user — synthesize it into a clear, direct answer to what they actually asked.`

  const convo = (messages || [])
    .filter(m => m && m.content && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({ role: m.role, content: m.content }))

  if (convo.length === 0 || convo[convo.length - 1].role !== 'user') {
    throw new Error('No question to answer.')
  }

  let finalText = ''
  const toolsUsed = new Set()
  const MAX_TURNS = 6

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     systemPrompt,
      tools:      CHAT_TOOLS,
      messages:   convo,
    })

    const toolUses = resp.content.filter(b => b.type === 'tool_use')
    if (toolUses.length === 0) {
      finalText = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      break
    }

    convo.push({ role: 'assistant', content: resp.content })

    const toolResults = []
    for (const tu of toolUses) {
      toolsUsed.add(tu.name)
      let result
      try {
        result = await executeChatTool(tu.name, { client, settings, customerId, dateRange })
      } catch (err) {
        result = { error: err.message || 'Failed to fetch data for this tool.' }
      }
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) })
    }
    convo.push({ role: 'user', content: toolResults })

    if (turn === MAX_TURNS - 1) {
      // Final attempt: ask the model to answer with whatever it has gathered so far.
      const wrapUp = await anthropic.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 2048,
        system:     systemPrompt + '\n\nYou have gathered enough data — answer the user\'s question now using only text, no more tool calls.',
        messages:   convo,
      })
      finalText = wrapUp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
    }
  }

  if (!finalText) finalText = "I wasn't able to pull a clear answer together — could you rephrase your question?"

  return { text: finalText, toolsUsed: [...toolsUsed] }
})

// ── RSA Builder ───────────────────────────────────────────────────────────────

ipcMain.handle('rsa:fetchCampaigns', async (_e, { customerId, hidePaused }) => {
  const { client, settings } = await getClient()
  return fetchRSACampaigns(client, customerId, settings.mccCustomerId, hidePaused)
})

ipcMain.handle('rsa:fetchAdGroups', async (_e, { customerId, campaignId }) => {
  const { client, settings } = await getClient()
  return fetchRSAAdGroups(client, customerId, settings.mccCustomerId, campaignId)
})

ipcMain.handle('rsa:fetchBuilderData', async (_e, { customerId, adGroupId }) => {
  const { client, settings } = await getClient()
  return fetchRSABuilderData(client, customerId, settings.mccCustomerId, adGroupId)
})

ipcMain.handle('rsa:fetchReportData', async (_e, { customerId, campaignId, adGroupId }) => {
  const { client, settings } = await getClient()
  return fetchRSAReportData(client, customerId, settings.mccCustomerId, { campaignId, adGroupId })
})

ipcMain.handle('rsa:analyzeLandingPage', async (_e, { url, bustCache }) => {
  try {
    return await analyzeLandingPage(url, { bustCache })
  } catch (err) {
    return { error: err.message, url }
  }
})

// ── Ad Group Intent Lock — prevents service intent crossover between ad groups ──
// Fully dynamic: works for any account/niche. Instead of a hardcoded intent
// table, this pulls the REAL sibling ad group names from the same campaign
// (passed in by the renderer) and asks the model to infer each one's likely
// service intent from its own name, then write copy that stays clearly
// differentiated from them — no static keyword list to maintain.

// Returns a prompt block enforcing intent lock, or '' when the toggle is off.
function buildIntentLockBlock(adGroupName, siblingAdGroupNames, preventCrossover) {
  if (!preventCrossover) return ''
  const siblings = (siblingAdGroupNames || []).map(n => (n || '').trim()).filter(Boolean)

  if (siblings.length > 0) {
    return (
      `\nAD GROUP INTENT LOCK (STRICT — DO NOT VIOLATE):\n` +
      `This ad group is: "${adGroupName || 'Unknown'}"\n\n` +
      `Other ad groups in the SAME campaign (siblings — do not blend their intent into this one):\n` +
      siblings.map(n => `  - ${n}`).join('\n') + `\n\n` +
      `Step 1: Infer THIS ad group's specific service intent strictly from its own name "${adGroupName}" (and its keywords above).\n` +
      `Step 2: Infer each sibling ad group's likely service intent from its name above.\n` +
      `Step 3: Write every headline and description so it is specific to THIS ad group's intent only — ` +
      `do not use language, scenarios, or customer situations that more naturally belong to one of the sibling ad groups instead.\n`
    )
  }

  return (
    `\nAD GROUP INTENT LOCK (STRICT — DO NOT VIOLATE):\n` +
    `Ad Group: "${adGroupName || 'Unknown'}"\n` +
    `Stay strictly within the service intent implied by this ad group's own name and keywords. ` +
    `Do not blend in language, scenarios, or customer situations that would more naturally belong to a ` +
    `different, more specific ad group within the same campaign.\n`
  )
}

// An account can run more than one website/brand through it (some clients
// advertise several sites from one Google Ads account), so the Business
// Profile is a LIST of website profiles, not one per account. This picks the
// right one for a given generation call: with exactly one saved website
// there's no ambiguity so it's used regardless of URL; with several, match by
// the ad group's own landing page/final URL domain against each saved
// website's domain, since that's the one signal the app already has that's
// specific to a particular ad group rather than the whole account.
function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase() } catch { return '' }
}

async function resolveWebsiteProfile(customerId, urlHint) {
  if (!customerId) return null
  const websites = await store.getAccountWebsites(customerId)
  if (!websites.length) return null
  if (websites.length === 1) return websites[0]
  const targetDomain = domainOf(urlHint)
  if (!targetDomain) return null
  return websites.find(w => domainOf(w.websiteUrl) === targetDomain) || null
}

// Injected into every AI generation prompt (independent of preventCrossover) so the
// model never confuses the advertiser with the industry/customer segment the
// campaign or ad group name targets — e.g. a security company running a
// "Dealership" campaign is not a car dealership. accountProfile is the single
// resolved website profile from resolveWebsiteProfile above.
function buildAdvertiserContextBlock(accountProfile, campaignName, adGroupName) {
  if (!accountProfile || (!accountProfile.advertiser && !accountProfile.whatWeSell)) return ''
  const nameHint = [campaignName, adGroupName].filter(Boolean).join(' / ')
  return (
    `\nADVERTISER CONTEXT (STRICT — DO NOT VIOLATE):\n` +
    `You are generating assets for the ADVERTISER below — never for the advertiser's target customer or industry.\n` +
    `Advertiser: ${accountProfile.advertiser || '(unspecified)'}\n` +
    `Advertiser offers: ${accountProfile.whatWeSell || '(unspecified)'}\n` +
    (nameHint
      ? `The campaign/ad group name ("${nameHint}") indicates the TARGET INDUSTRY or customer segment being advertised to — it does NOT describe what the advertiser's own business is. Never generate the target industry's own products or services.\n`
      : '') +
    `Do not invent numbers, guarantees, pricing, licensing, insurance, awards, customer counts, or years of experience unless they are explicitly present in the context given to you.\n`
  )
}

// Shared Google Ads policy restrictions injected into every RSA generation prompt
const RSA_POLICY_RULES =
  `CRITICAL GOOGLE ADS POLICY RESTRICTIONS — VIOLATIONS WILL CAUSE AD DISAPPROVAL:\n` +
  `1. NO Superlative/Unverifiable Claims: Do not use "The Best", "Highest Quality", "#1 Rated", "Top-Rated", "World's Best", "Guaranteed Results", or "Unbeatable". These are prohibited without certified third-party proof.\n` +
  `2. NO Exclamation Marks (!): Exclamation marks are PROHIBITED in headlines. They are also restricted in descriptions — do not use them at all to be safe.\n` +
  `3. NO Excessive Capitalization: Do not use ALL CAPS words (e.g. "FREE SERVICE", "BUY NOW"). Title case or sentence case only.\n` +
  `4. NO Gimmicky Punctuation: No ">>>", "***", "==", spaced-out letters ("S A L E"), or repeated symbols.\n` +
  `5. NO Aggressive Urgency: Avoid "Buy immediately or lose out", "Last chance ever", "Act now before it's too late".\n` +
  `6. NO Medical/Financial Miracle Claims: Do not use "Cure", "Instant Profit", "Get Rich", "Overnight Repair", or prescription drug names.\n` +
  `7. NO Clickbait: Headlines must accurately reflect what is on the landing page.\n` +
  `8. NO Phone Numbers: Do not include any phone numbers (e.g. (786) 234-5678, 800-555-1234) in headlines or descriptions. Google Ads prohibits phone numbers in ad text.\n`

// Sitelink-specific policy/editorial block (rsa:generateSitelinksAI only) —
// a more detailed superset of RSA_POLICY_RULES tailored to sitelink assets
// (destination-accuracy and editorial-quality rules that don't apply to
// headlines/descriptions). Kept separate rather than folding into the shared
// constant so it doesn't change wording for every other asset-generation prompt.
const SITELINK_POLICY_RULES =
  `GOOGLE ADS POLICY AND EDITORIAL COMPLIANCE\n\n` +
  `Generate professional, accurate advertising assets that comply with applicable Google Ads policies and the current sitelink asset specifications.\n\n` +
  `1. Claims and substantiation:\n` +
  `   - Do not invent or exaggerate claims about quality, rankings, outcomes, credentials, or experience.\n` +
  `   - Avoid unsupported superlatives such as "The Best", "#1 Rated", or "Highest Quality".\n` +
  `   - Do not promise guaranteed outcomes unless the claim is permitted and substantiated.\n` +
  `   - Do not misrepresent the advertiser or its offerings.\n\n` +
  `2. Punctuation and capitalization:\n` +
  `   - Use clear, professional punctuation and conventional capitalization.\n` +
  `   - Avoid excessive capitalization, repeated punctuation, decorative symbols, and gimmicky formatting.\n` +
  `   - Avoid exclamation marks by default.\n` +
  `   - Do not use unusual spacing or symbols to attract attention.\n\n` +
  `3. Urgency and promotional language:\n` +
  `   - Avoid misleading scarcity, fabricated deadlines, and aggressive pressure tactics.\n` +
  `   - Do not invent limited-time offers, discounts, or promotions.\n\n` +
  `4. Sensitive and restricted claims:\n` +
  `   - Do not generate misleading medical, financial, or other high-impact outcome claims.\n` +
  `   - Respect all applicable category-specific advertising restrictions.\n\n` +
  `5. Destination accuracy:\n` +
  `   - Each headline and description must accurately represent the destination.\n` +
  `   - Never imply that a page contains an offer, service, feature, or benefit that is not supported by the available evidence.\n\n` +
  `6. Phone numbers:\n` +
  `   - Do not place phone numbers in sitelink headlines or descriptions.\n` +
  `   - Use a separate, appropriate call asset when phone-call advertising is needed.\n\n` +
  `7. Editorial quality:\n` +
  `   - Avoid keyword stuffing, repetitive copy, generic filler, and unnatural phrasing.\n` +
  `   - Ensure that each sitelink gives users a clear reason to visit its destination.\n\n` +
  `8. Specification accuracy:\n` +
  `   - Follow the applicable character limits and asset requirements for the sitelink format being generated.\n` +
  `   - Do not assume that every editorial convention is a universal Google Ads policy prohibition.\n` +
  `   - Do not guarantee approval. Final eligibility and approval depend on Google's current policies, account context, and asset review.\n`

// Sitelink-specific advertiser-context block — a more detailed superset of
// buildAdvertiserContextBlock() tailored to sitelink destination selection.
// Kept separate from the shared function for the same reason as above.
function buildSitelinkAdvertiserBlock(accountProfile) {
  if (!accountProfile || (!accountProfile.advertiser && !accountProfile.whatWeSell)) return ''
  return (
    `\nADVERTISER CONTEXT — STRICT\n\n` +
    `Advertiser: ${accountProfile.advertiser || '(unspecified)'}\n` +
    `Advertiser offers: ${accountProfile.whatWeSell || '(unspecified)'}\n\n` +
    `The advertiser's identity and actual offerings take precedence over assumptions derived from the campaign or ad group name.\n\n` +
    `The campaign or ad group may describe the TARGET INDUSTRY, audience, or customer segment being advertised. It does not necessarily describe the advertiser's own business.\n\n` +
    `Rules:\n` +
    `1. Generate sitelinks only for products, services, and destinations relevant to the actual advertiser.\n` +
    `2. Never assume the advertiser provides the services associated with the target industry.\n` +
    `3. If the advertiser context conflicts with assumptions based on the campaign name, follow the advertiser context.\n` +
    `4. Do not invent pricing, discounts, guarantees, credentials, licenses, insurance, awards, customer counts, years of experience, or other factual claims.\n` +
    `5. Use only facts explicitly supported by the provided context or confirmed page content.\n` +
    `6. If the advertiser's actual offerings cannot be established reliably, do not guess. Prefer confirmed, relevant informational destinations or return fewer sitelinks.\n`
  )
}

// Sitelink-specific ad group intent lock — a more detailed superset of
// buildIntentLockBlock() tailored to sitelink destination selection. Only
// rendered at Ad Group Level (adGroupLevel=true) — Campaign/Account Level
// generation spans multiple ad groups by design, so locking to one would be
// wrong there (see SitelinksTab.jsx's siblingAdGroupNames comment).
function buildSitelinkIntentLockBlock(adGroupName, siblingAdGroupNames, preventCrossover, adGroupLevel) {
  if (!preventCrossover || !adGroupLevel) return ''
  const siblings = (siblingAdGroupNames || []).map(n => (n || '').trim()).filter(Boolean)
  return (
    `\nAD GROUP INTENT LOCK — STRICT\n\n` +
    `Ad Group: "${adGroupName || 'Unknown'}"\n\n` +
    (siblings.length > 0
      ? `Other ad groups in the same campaign:\n${siblings.map(n => `  - ${n}`).join('\n')}\n\n`
      : '') +
    `Rules:\n` +
    `1. Determine this ad group's specific service intent using its name, target keywords, and available landing page context.\n` +
    `2. Determine sibling ad groups' likely intents from their names.\n` +
    `3. Keep every sitelink relevant to the current ad group's intent.\n` +
    `4. Do not borrow services, scenarios, or customer needs that belong primarily to sibling ad groups.\n` +
    `5. Do not generate a generic service sitelink merely because it is present on the website if it is irrelevant to this ad group's intent.\n` +
    `6. General navigation may be included when permitted by the selected sitelink strategy and when it remains useful to this ad group's audience.\n` +
    `7. If the ad group's intent is ambiguous, prefer broadly relevant confirmed destinations over unsupported assumptions.\n`
  )
}

// Google Ads Dynamic Keyword Insertion — {KeyWord:Default Text} (the tag's
// capitalization controls the substituted keyword's case: {keyword:...},
// {Keyword:...}, {KeyWord:...} etc.). The braces and "keyword:" tag are never
// displayed and don't count toward the character limit — only the
// default-text fallback does, since that's what actually renders whenever
// Google can't fit the matched search term. Duplicated in
// src/utils/rsaValidation.js (frontend can't import this CommonJS file) —
// keep both in sync.
const DKI_PATTERN = /\{keyword:([^}]+)\}/gi
const DKI_DETECT  = /\{keyword:[^}]+\}/i // non-global sibling for .test() — DKI_PATTERN's /g flag makes repeated .test() calls stateful

function getEffectiveText(text) {
  return String(text || '').replace(DKI_PATTERN, '$1')
}
function getEffectiveLength(text) {
  return getEffectiveText(text).length
}

// Truncate to last full word within limit — used by both RSA handlers.
// DKI-aware: {KeyWord:Default Text} is measured by its default text only, and
// when it needs shortening the default text is trimmed in place rather than
// the raw string being blindly cut (which would otherwise mangle the syntax,
// e.g. leaving a dangling "{KeyWord:" with no closing brace).
function rsaHardLimit(text, max) {
  if (!text) return ''
  const t = text.trim()
  if (getEffectiveLength(t) <= max) return t
  if (DKI_DETECT.test(t)) {
    return t.replace(DKI_PATTERN, (_match, inner) => {
      const trimmedInner = inner.trim()
      if (trimmedInner.length <= max) return `{KeyWord:${trimmedInner}}`
      const cut = trimmedInner.lastIndexOf(' ', max - 1)
      const shortened = (cut > 0 ? trimmedInner.slice(0, cut) : trimmedInner.slice(0, max)).trim()
      return `{KeyWord:${shortened}}`
    })
  }
  const cut = t.lastIndexOf(' ', max - 1)
  return (cut > 0 ? t.slice(0, cut) : t.slice(0, max)).trim()
}

// Post-generation sanitiser — removes content that reliably triggers PROHIBITED
// policy. Never mechanically cuts text to fit the 30-char limit — a
// word-boundary truncation can orphan a real content word that isn't a
// dangling connector at all (e.g. "Available Today in South Florida" ->
// "Available Today in South") and no stopword list can catch that. Instead
// this just flags hardTruncated=true and returns the full cleaned text
// unchanged, so every caller either rejects it outright or routes it through
// a proper AI rewrite (see reviseWeakHeadlines) — nothing ships a cut fragment.
function sanitizeHeadlineEx(text) {
  if (!text) return { text: '', hardTruncated: false }
  const cleaned = text
    .replace(/!/g, '')                         // ! banned in headlines
    .replace(/\b(guaranteed results?)\b/gi, 'Proven Results')
    .replace(/\b(the\s+best|world'?s?\s+best)\b/gi, 'Trusted')
    .replace(/\b#1\s+rated\b/gi, 'Highly Rated')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const hardTruncated = getEffectiveLength(cleaned) > 30
  return { text: hardTruncated ? cleaned : trimDangling(cleaned), hardTruncated }
}

function sanitizeHeadline(text) {
  return sanitizeHeadlineEx(text).text
}

// Words that indicate the text was cut mid-thought — connectors, articles,
// and subordinators that grammatically demand something after them. "since"
// and "because" added: both open a subordinate clause, so a description
// ending on either is always a fragment.
const DANGLING_WORD = /\b(for|and|the|a|an|to|of|in|on|at|by|or|nor|with|from|into|about|over|after|before|as|since|because|although|though|is|are|was|were|has|had|will|would|could|should|can|may|might|must|shall|do|does|did|your|our|their|its|this|that|these|those|we|you|they)\s*$/i

// Repeatedly strips a trailing dangling connector (not just once) — a single
// pass can leave a NEW dangling word exposed once the old one is removed
// (e.g. "...serving clients with" -> strip "with" -> "...serving clients" is
// fine, but "...ready to help you and" needs two passes: "and" then nothing
// further). Falls back to the nearest sentence/comma boundary when available.
function trimDangling(s) {
  let out = String(s || '').trim()
  for (let i = 0; i < 4 && DANGLING_WORD.test(out); i++) {
    const noConnector = out.replace(DANGLING_WORD, '').trim()
    const p = noConnector.lastIndexOf('. ')
    if (p > 20) { out = noConnector.slice(0, p + 1).trim(); break }
    const c = noConnector.lastIndexOf(', ')
    if (c > 20) { out = noConnector.slice(0, c).trim(); break }
    out = noConnector
  }
  return out
}

// Detects a sentence fragment — ends on a dangling connector, or ends on a
// comma with nothing after it. Used to gate generation output (reject/retry)
// and to score Ad Strength — a set can look strong on keyword coverage and
// variety while still reading as unfinished sentences, which this catches.
function endsIncomplete(text) {
  const t = getEffectiveText(text).trim()
  if (!t) return true
  if (t.endsWith(',')) return true
  return DANGLING_WORD.test(t)
}

// Full version — also reports whether the text is over the 90-char limit.
// Never mechanically cuts it to fit — even a "safe" sentence-boundary cut
// drops real content the business wrote, and a comma/word-boundary cut can
// strand a real content word that isn't a connector at all (e.g. cutting
// "...in South Florida" down to "...in South"). Callers either reject a
// hardTruncated result outright or route it through a proper AI rewrite
// (see reviseWeakDescriptions) — nothing ships a cut fragment.
// sanitizeDescription is the plain string version for callers that don't
// need the flag.
function sanitizeDescriptionEx(text) {
  if (!text) return { text: '', hardTruncated: false }
  let t = text
    .replace(/!+/g, '')
    .replace(/\b(guaranteed results?)\b/gi, 'proven results')
    .replace(/\b(the\s+best|world'?s?\s+best)\b/gi, 'trusted')
    // Remove phone numbers — not allowed in Google Ads description text
    .replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}/g, '')
    .replace(/\b\d{10}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  const hardTruncated = getEffectiveLength(t) > 90
  // Within limit — still fix dangling connectors caused by phone/term removal
  return { text: hardTruncated ? t : trimDangling(t), hardTruncated }
}

function sanitizeDescription(text) {
  return sanitizeDescriptionEx(text).text
}

// Corrective rewrite pass shared by every description-generation path — finds
// descriptions that are too short, too long, or end mid-thought (the
// mechanical truncation in sanitizeDescription can still land on a fragment
// when there's no clean sentence boundary to cut at) and asks Claude to
// properly REWRITE just those, rather than silently shipping a fragment or a
// padded-out sentence. Runs up to 2 passes — a single rewrite attempt can
// itself come back still-too-long/short/incomplete and get rejected by the
// same validation it's trying to pass; without a retry, that left the
// ORIGINAL broken fragment shipping to the user (confirmed live). Each pass
// re-scans the current state, so only whatever is STILL weak gets retried.
// Generic, policy-safe, always-complete descriptions used ONLY if a
// description is still invalid after every rewrite pass below — the
// alternative to shipping a cut/trimmed fragment (which we never do) is a
// guaranteed-compliant line. Built from base+tail combinations rather than
// hand-counted literals so the 70–90 char window is verified at runtime,
// never assumed.
const DESCRIPTION_FALLBACK_BASES = ['Contact our team today', 'Reach out to us today', 'Get in touch with us now', 'Call our office today']
const DESCRIPTION_FALLBACK_TAILS = [
  'to learn more and get started.',
  'to discuss your needs today.',
  'to discuss your needs and schedule a visit.',
  'for friendly, professional help with your project.',
  'and our team will be glad to assist you right away.',
  'so we can help you find the right solution for your needs.',
]
function buildDescriptionFallback(excludeTexts = []) {
  for (const base of DESCRIPTION_FALLBACK_BASES) {
    for (const tail of DESCRIPTION_FALLBACK_TAILS) {
      const candidate = `${base} ${tail}`
      const len = getEffectiveLength(candidate)
      if (len >= 70 && len <= 90 && !endsIncomplete(candidate) && !excludeTexts.includes(candidate)) return candidate
    }
  }
  return DESCRIPTION_FALLBACK_BASES[0] + ' ' + DESCRIPTION_FALLBACK_TAILS[0] // unreachable in practice
}

async function reviseWeakDescriptions(anthropic, { adGroupName, kwHint, descriptions, hardTruncated = [] }) {
  const current = [...descriptions]
  const currentHardTruncated = [...hardTruncated]

  for (let pass = 0; pass < 3; pass++) {
    const weak = current
      .map((d, i) => ({
        d, i,
        reason: getEffectiveLength(d) < 70 ? 'too short'
          : getEffectiveLength(d) > 90 ? 'too long'
          : endsIncomplete(d) ? 'ends mid-sentence'
          // Passed the word-list check but was still a comma or blind
          // word-boundary cut (no clean sentence break to cut at) — it may
          // have orphaned a real content word or an unfinished list/clause
          // that no stopword list can catch, since the leftover word isn't a
          // connector at all. Reroute through a proper rewrite either way.
          : currentHardTruncated[i] ? 'was force-cut to fit the character limit and may be missing a word'
          : null,
      }))
      .filter(x => x.reason)
    if (weak.length === 0) break

    try {
      const prompt =
        `Rewrite these Google Ads RSA descriptions so EVERY one is a complete sentence between 70 and 90 characters. ` +
        `Some are too short, too long, or cut off mid-thought — rewrite each from scratch rather than just trimming or padding. ` +
        `Write for BUYERS ready to hire/book now — lead with decision-tipping specifics and a clear next action.\n\n` +
        `Ad Group: ${adGroupName || ''}\nKeywords: ${kwHint || ''}\n\n` +
        `Descriptions to fix:\n${weak.map(x => `  ${x.i + 1}. "${x.d}" (${x.d.length} chars — ${x.reason})`).join('\n')}\n\n` +
        RSA_POLICY_RULES + '\n' +
        `Return ONLY valid JSON: {"fixed":["...","..."]} with exactly ${weak.length} entries, same order as listed above, each 70–90 characters, each ending as a complete thought (never on: for/and/with/since/because/or/a/an/the/to/of/in/on/at/by, a modal verb like can/may/might/must, or any other word that clearly needs more after it).`
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw   = message.content[0]?.text || '{}'
      const match = raw.match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(match?.[0] || '{}')
      const fixed  = (parsed.fixed || []).map(d => sanitizeDescriptionEx(d))
      weak.forEach((x, idx) => {
        const f = fixed[idx]
        if (f && getEffectiveLength(f.text) >= 70 && getEffectiveLength(f.text) <= 90 && !f.hardTruncated && !endsIncomplete(f.text)) {
          current[x.i] = f.text
          currentHardTruncated[x.i] = false
        }
        // else: leave current[x.i] as-is — next pass re-detects it as weak
        // (same reason) and retries.
      })
    } catch {
      break // network/parse error — stop retrying, fall through to the fallback below
    }
  }

  // Never ship a description that's still too short/long, cut mid-thought, or
  // was ever mechanically trimmed — substitute a guaranteed-compliant generic
  // line instead. In practice the 3 passes above resolve nearly everything;
  // this only fires on a genuine repeated AI/parse failure. usedFallbacks
  // tracks picks made earlier in this same batch so two weak slots never get
  // assigned the identical fallback line.
  const usedFallbacks = []
  return current.map((d, i) => {
    const stillWeak = getEffectiveLength(d) < 70 || getEffectiveLength(d) > 90 || endsIncomplete(d) || currentHardTruncated[i]
    if (!stillWeak) return d
    const fallback = buildDescriptionFallback([...current, ...usedFallbacks])
    usedFallbacks.push(fallback)
    return fallback
  })
}

// Headline counterpart to reviseWeakDescriptions — headlines never had ANY
// completeness check anywhere in the codebase (only descriptions did), so a
// headline over 30 chars that got word-boundary-cut by sanitizeHeadlineEx
// (e.g. "Available Today in South Florida" -> "Available Today in South")
// shipped as-is with no rewrite. endsIncomplete alone can't catch this class
// of fragment — "South" isn't a dangling connector — so hardTruncated is the
// real signal here, same as it is for descriptions.
// Generic, policy-safe, always-complete headlines used ONLY if a headline is
// still invalid after every rewrite pass below — see
// buildDescriptionFallback's comment for why a guaranteed-compliant generic
// line is preferred over ever shipping a cut/trimmed fragment.
const HEADLINE_FALLBACKS = ['Contact Us Today', 'Get a Free Quote', 'Call Us Now', 'Request a Callback', 'Speak With an Expert', 'Schedule Your Service', 'Get Started Today', 'Learn More Today']
function buildHeadlineFallback(excludeTexts = []) {
  return HEADLINE_FALLBACKS.find(h => getEffectiveLength(h) <= 30 && !endsIncomplete(h) && !excludeTexts.includes(h)) || HEADLINE_FALLBACKS[0]
}

async function reviseWeakHeadlines(anthropic, { adGroupName, kwHint, headlines, hardTruncated = [] }) {
  const current = [...headlines]
  const currentHardTruncated = [...hardTruncated]

  for (let pass = 0; pass < 3; pass++) {
    const weak = current
      .map((h, i) => ({
        h, i,
        reason: endsIncomplete(h) ? 'ends mid-phrase'
          : getEffectiveLength(h) > 30 ? 'over the character limit'
          : currentHardTruncated[i] ? 'was force-cut to fit the character limit and may be missing a word'
          : null,
      }))
      .filter(x => x.reason)
    if (weak.length === 0) break

    try {
      const prompt =
        `Rewrite these Google Ads RSA headlines so EVERY one reads as a complete, natural phrase of 30 characters or fewer. ` +
        `Some were cut off mid-thought to fit the character limit — rewrite each from scratch (don't just trim further) so it finishes cleanly within 30 characters.\n\n` +
        `Ad Group: ${adGroupName || ''}\nKeywords: ${kwHint || ''}\n\n` +
        `Headlines to fix:\n${weak.map(x => `  ${x.i + 1}. "${x.h}" (${x.h.length} chars — ${x.reason})`).join('\n')}\n\n` +
        RSA_POLICY_RULES + '\n' +
        `Return ONLY valid JSON: {"fixed":["...","..."]} with exactly ${weak.length} entries, same order as listed above, each ≤30 characters, each reading as a finished phrase (never ending on: for/and/with/since/because/or/a/an/the/to/of/in/on/at/by, or any other word that clearly needs more after it — including a bare direction/qualifier like "Near" or "South" that's obviously missing what comes next).`
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw   = message.content[0]?.text || '{}'
      const match = raw.match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(match?.[0] || '{}')
      const fixed  = (parsed.fixed || []).map(h => sanitizeHeadlineEx(h))
      weak.forEach((x, idx) => {
        const f = fixed[idx]
        if (f && f.text.length > 0 && getEffectiveLength(f.text) <= 30 && !f.hardTruncated && !endsIncomplete(f.text)) {
          current[x.i] = f.text
          currentHardTruncated[x.i] = false
        }
      })
    } catch {
      break // network/parse error — stop retrying, fall through to the fallback below
    }
  }

  // Never ship a headline that's still over the limit, ends mid-phrase, or
  // was ever mechanically trimmed — substitute a guaranteed-compliant generic
  // line instead. In practice the 3 passes above resolve nearly everything;
  // this only fires on a genuine repeated AI/parse failure. usedFallbacks
  // tracks picks made earlier in this same batch so two weak slots never get
  // assigned the identical fallback line.
  const usedFallbacks = []
  return current.map((h, i) => {
    const stillWeak = getEffectiveLength(h) > 30 || endsIncomplete(h) || currentHardTruncated[i]
    if (!stillWeak) return h
    const fallback = buildHeadlineFallback([...current, ...usedFallbacks])
    usedFallbacks.push(fallback)
    return fallback
  })
}

ipcMain.handle('rsa:generateHeadlineRecs', async (_e, { customerId, headlines, keepHeadlines, adGroupName, keywords, scoreBreakdown, targetScore, preventCrossover, siblingAdGroupNames, landingPageUrl }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const accountProfile = await resolveWebsiteProfile(customerId, landingPageUrl)
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const kwList = (keywords || [])
    .slice().sort((a, b) => (Number(b.impressions) || 0) - (Number(a.impressions) || 0))
    .slice(0, 20).map(k => k.text || k).join(', ')
  const target = targetScore || 90

  // Score gap analysis — rank dimensions by gap size to tell Claude what to prioritise
  let gapLines = ''
  let keepCoverage = ''
  if (scoreBreakdown) {
    const gaps = Object.values(scoreBreakdown)
      .map(d => ({ label: d.label, gap: d.max - d.score, score: d.score, max: d.max }))
      .sort((a, b) => b.gap - a.gap)
    gapLines =
      `Score breakdown (target ${target}+):\n` +
      gaps.map(d => `  ${d.label}: ${d.score}/${d.max} — gap ${d.gap > 0 ? `+${d.gap} needed` : 'OK'}`).join('\n') + '\n\n' +
      `Priority gaps to fix with replacement headlines (largest first):\n` +
      gaps.filter(d => d.gap > 0).map((d, i) => {
        const hint =
          d.label === 'CTA Diversity'         ? 'Add headlines starting with: Call, Book, Schedule, Request, Get, Contact, Hire' :
          d.label === 'Trust Signals'         ? 'Add headlines with: Licensed, Insured, Bonded, Certified, X Years Exp, Guaranteed, Rated, Family-Owned' :
          d.label === 'Keyword Relevance'     ? 'Add headlines containing core service keywords from the ad group' :
          d.label === 'Conversion Focus'      ? 'Add urgency/time-critical headlines: Same-Day, 24/7, Today, Emergency, Available Now' :
          d.label === 'Landing Page Alignment'? 'Use words and phrases from the ad group theme and service name' :
          d.label === 'Uniqueness'            ? 'Ensure each headline uses different root words — no word repeated across more than 2 headlines' :
          ''
        return `  ${i + 1}. ${d.label} (+${d.gap} pts needed)${hint ? ' — ' + hint : ''}`
      }).join('\n') + '\n'
  }

  // Show what the kept headlines already cover so Claude fills actual gaps
  if ((keepHeadlines || []).length > 0) {
    const byType = {}
    keepHeadlines.forEach(h => {
      if (!byType[h.type]) byType[h.type] = []
      byType[h.type].push(`"${h.text}"`)
    })
    keepCoverage =
      `\nHeadlines already KEPT in the ad (do not duplicate these types/words):\n` +
      Object.entries(byType).map(([t, hs]) => `  ${t}: ${hs.join(', ')}`).join('\n') + '\n'
  }

  // Map each headline-to-replace to the specific score gap it should fix
  const GAP_HINTS = {
    'CTA Diversity':          'Write a CTA headline starting with: Call, Book, Schedule, Request, Get, Contact, or Hire',
    'Trust Signals':          'Write a Trust headline with: Licensed, Insured, Certified, X Years, Rated, or Guaranteed',
    'Keyword Relevance':      'Write a Keyword headline that contains a core keyword from the ad group',
    'Conversion Focus':       'Write an Urgency headline with: Same-Day, 24/7, Emergency, Today, or Available Now',
    'Landing Page Alignment': 'Write a headline using the main service name and theme from the ad group',
    'Uniqueness':             'Write a completely fresh headline — different angle, different root words',
  }
  const gapDims = scoreBreakdown
    ? Object.values(scoreBreakdown)
        .map(d => ({ label: d.label, gap: d.max - d.score }))
        .filter(d => d.gap > 0)
        .sort((a, b) => b.gap - a.gap)
    : []

  const headlineList = (headlines || []).map((h, pos) => {
    const dim    = gapDims.length > 0 ? gapDims[pos % gapDims.length] : null
    const action = dim
      ? `→ REPLACE to fix: ${dim.label} (+${dim.gap} pts) — ${GAP_HINTS[dim.label] || 'improve quality'}`
      : `→ REPLACE to improve quality score`
    return `  index ${h.index}: "${h.text}"  ${action}`
  }).join('\n')

  // Keywords the kept headlines don't already cover — replacements should
  // prioritise these first, so keyword coverage climbs instead of the same
  // handful of keywords getting reused across kept + replaced headlines.
  const keptText = (keepHeadlines || []).map(h => (h.text || '').toLowerCase()).join(' | ')
  const uncoveredKw = (keywords || [])
    .slice().sort((a, b) => (Number(b.impressions) || 0) - (Number(a.impressions) || 0))
    .slice(0, 10)
    .map(k => k.text || k)
    .filter(kw => !keptText.includes(kw.toLowerCase()))
  const uncoveredLine = uncoveredKw.length > 0
    ? `\nKeywords NOT YET covered by any kept headline — prioritise working these into the replacements, one keyword per headline: ${uncoveredKw.map(k => `"${k}"`).join(', ')}\n`
    : ''

  const prompt =
    `You are an expert Google Ads RSA copywriter. Replace the weak headlines below to push the Ad Strength to ${target}+ (Excellent).\n\n` +
    `Ad Group: ${adGroupName}\n` +
    `Keywords: ${kwList}\n\n` +
    gapLines +
    keepCoverage +
    uncoveredLine +
    `\nHeadlines to replace — each assigned to a specific Ad Strength gap:\n${headlineList}\n\n` +
    `AD STRENGTH TARGET — ${target}+ (Excellent), not just "Good". The score is based on:\n` +
    `  • KEYWORD COVERAGE: as many replacement headlines as possible must each contain a DIFFERENT keyword phrase from the ad group — cover the uncovered keywords above before reusing any keyword a kept headline already has\n` +
    `  • MESSAGE DIVERSITY (hard rule): no two headlines in the FINAL set (kept + replaced) may share more than one significant word (4+ letters) — each replacement must cover a genuinely different topic/angle, in different wording, not a rephrase of another headline\n` +
    `  • CHARACTER LENGTH: use 22–30 characters per headline — short headlines hurt Ad Strength\n` +
    `  • CTA PRESENCE: at least one headline must start with Call/Book/Schedule/Get/Request/Contact/Hire\n` +
    `  • TRUST SIGNALS: at least one headline should include Licensed/Insured/Certified/Years/Rated\n\n` +
    `CRITICAL: The original headline's type is IRRELEVANT. Write the type that best fills the assigned gap.\n` +
    `Do NOT preserve the original type. Do NOT write headlines similar to each other or to any kept headline.\n\n` +
    RSA_POLICY_RULES + `\n` +
    buildAdvertiserContextBlock(accountProfile, null, adGroupName) +
    buildIntentLockBlock(adGroupName, siblingAdGroupNames, preventCrossover) +
    `\nRULES:\n` +
    `- *** HARD LIMIT: every headline MUST be 30 characters or fewer. Count every character. 31+ = REJECTED. ***\n` +
    `- AIM FOR 22–30 characters — short headlines lower Ad Strength. Example of 30 chars: "Call for a Free Estimate Today"\n` +
    `- Each replacement must be unique in wording AND angle from all other headlines\n` +
    `- No two headlines in the FINAL set (replacements + kept) may start with the same first word — vary the opening word of every replacement from every kept headline and from each other.\n` +
    `- Do NOT copy or rephrase the original headline\n` +
    `- Do NOT use ALL CAPS\n\n` +
    `Return ONLY valid JSON, no markdown:\n` +
    `{"recs":[{"index":0,"text":"Replacement Headline"}]}`

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1200,
    messages:   [{ role: 'user', content: prompt }],
  })

  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    const parsed = JSON.parse(match?.[0] || '{}')
    const hlExp = (parsed.recs || []).map(r => sanitizeHeadlineEx(r.text))
    const fixedTexts = await reviseWeakHeadlines(anthropic, {
      adGroupName, kwHint: kwList,
      headlines: hlExp.map(x => x.text), hardTruncated: hlExp.map(x => x.hardTruncated),
    })
    const recs = (parsed.recs || []).map((r, i) => ({ ...r, text: fixedTexts[i] }))
    return { recs }
  } catch {
    return { recs: [] }
  }
})

ipcMain.handle('rsa:generateRSAAssets', async (_e, {
  customerId, businessName, serviceArea, yearsInBusiness, usps, promotion, tone,
  adGroupName, campaignName, keywords, searchTerms, landingPage, scoreBreakdown, issues,
  preventCrossover, siblingAdGroupNames, count, existingSets, realActionItems,
}) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const accountProfile = await resolveWebsiteProfile(customerId, landingPage?.url)
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  // Same conversion-value ranking (conversion rate, cost-efficiency,
  // conversion volume, commercial intent, then clicks/impressions last) the
  // Phase 1 scoring engine judges keyword relevance by — dynamically
  // imported (this file is CommonJS, that module is ESM) so generation
  // targets exactly what scoring rewards, not a different, possibly
  // disagreeing ordering.
  const { rankKeywordsByWeight } = await import('../src/services/rsaScoring/keywordWeighting.js')
  const rankedKw = rankKeywordsByWeight(keywords || [])
  const kwByText = new Map((keywords || []).map(k => [(k.text || k), k]))
  const sortedKw = rankedKw.slice(0, 20).map(rk => ({ ...(kwByText.get(rk.text) || {}), text: rk.text, weight: rk.weight }))

  console.log(`[rsa:generateRSAAssets] keywords received: ${(keywords || []).length}`)
  if ((keywords || []).length > 0) {
    console.log(`[rsa:generateRSAAssets] first keyword sample:`, JSON.stringify((keywords || [])[0]))
  }

  // Log keyword order so we can verify conversion-value ranking is working correctly
  console.log('\n[rsa:generateRSAAssets] ── Top Keywords by Conversion Value (conv. rate/cost-efficiency/volume/intent, not impressions) ──')
  console.log('  #  | Keyword                        | Weight | Impressions | QS  | Match')
  console.log('  ───┼────────────────────────────────┼────────┼─────────────┼─────┼──────')
  sortedKw.forEach((k, i) => {
    const num  = String(i + 1).padStart(3)
    const kw   = (k.text || '').padEnd(30).slice(0, 30)
    const wt   = (k.weight ?? 0).toFixed(2).padStart(6)
    const impr = String((k.impressions || 0).toLocaleString()).padStart(11)
    const qs   = String(k.qualityScore || '—').padStart(4)
    const mt   = k.matchType || 'Broad'
    console.log(`  ${num}| ${kw} | ${wt} | ${impr} | ${qs} | ${mt}`)
  })
  console.log('  ──────────────────────────────────────────────────────────────────\n')

  // Primary theme (highest weight) gets 2 dedicated headlines; secondary
  // themes (next 2 by weight) get 1 headline each — matches the 7-category
  // headline quota below and Phase 1's excellentReady gate, which only
  // requires the PRIMARY theme in 2+ headlines (not every keyword crammed
  // into a headline each, which starves message-variety scoring instead).
  const primaryKw   = sortedKw[0] || null
  const secondaryKw = sortedKw.slice(1, 3)
  const fitsHeadline = k => k && k.text.length <= 30
  const primaryLine = primaryKw
    ? `PRIMARY KEYWORD THEME (highest weighted — impressions/clicks/conversions): "${primaryKw.text}"${fitsHeadline(primaryKw) ? '' : ' [too long to fit whole in a 30-char headline — use its core terms instead]'}\n`
    : ''
  const secondaryLine = secondaryKw.length > 0
    ? `SECONDARY KEYWORD THEMES: ${secondaryKw.map(k => `"${k.text}"${fitsHeadline(k) ? '' : ' [too long — core terms only]'}`).join(', ')}\n`
    : ''
  const kwTop = sortedKw.map((k, i) => `  ${i + 1}. "${k.text}" — ${k.matchType || 'Broad'} match, weight:${(k.weight ?? 0).toFixed(2)}, QS:${k.qualityScore || '?'}, ${(k.impressions || 0).toLocaleString()} impressions${k.text.length > 30 ? ` [${k.text.length} chars — too long to fit whole in a headline]` : ''}`).join('\n')

  const bizLines = [
    businessName                         && `Business: ${businessName}`,
    serviceArea                          && `Service Area: ${serviceArea}`,
    yearsInBusiness                      && (() => {
      const since = parseInt(yearsInBusiness, 10)
      if (since > 1900 && since <= new Date().getFullYear()) {
        const yrs = new Date().getFullYear() - since
        return `In Business Since: ${since} (${yrs} year${yrs !== 1 ? 's' : ''} in business)`
      }
      return `Years in Business: ${yearsInBusiness}`
    })(),
    usps?.filter(Boolean).length > 0     && `USPs: ${usps.filter(Boolean).join('; ')}`,
    promotion                            && `Active Promotion: ${promotion}`,
  ].filter(Boolean).join('\n')

  const lpLines = landingPage && !landingPage.error ? [
    landingPage.title                        && `Title: ${landingPage.title}`,
    landingPage.h1                           && `H1: ${landingPage.h1}`,
    landingPage.h2s?.length > 0             && `H2s: ${landingPage.h2s.slice(0, 4).join(' | ')}`,
    landingPage.ctas?.length > 0            && `CTAs on page: ${landingPage.ctas.join(', ')}`,
    landingPage.trustSignals?.length > 0    && `Trust signals: ${landingPage.trustSignals.join(', ')}`,
    landingPage.metaDescription             && `Meta: ${landingPage.metaDescription}`,
  ].filter(Boolean).join('\n') : 'No landing page data available'

  // scoreBreakdown/issues (this app's own Estimated Ad Strength score for the
  // ad being regenerated) are deliberately NOT fed into the prompt below —
  // doing so told the model to write toward closing specific gaps in OUR
  // heuristic rubric (e.g. "Message Variety: 9/15 (gap +6)"), which a model
  // can satisfy by touching more regex categories without the copy actually
  // getting more relevant or persuasive. The numbered instructions below
  // already describe what genuinely strong copy needs; let the model aim at
  // that instead of our scoring internals.

  // Real offer / real eligibility-restriction detection — this is this app's
  // current lightweight stand-in for a full "verified claim registry" (no
  // structured, ID-based claim store exists yet — this scans the actual
  // business-provided data instead). Reused by both the generation prompt
  // (so it never fabricates either) and fixConversionGaps' scoring (via
  // estimateConversionReadiness, which runs this same check). Sourced ONLY
  // from business-provided data (USPs, active promotion, landing page) —
  // never from the ad copy itself, so an ad can't validate its own invented
  // claim.
  const { OFFER_SOURCE_PATTERNS, RESTRICTION_SOURCE_PATTERNS } = await import('../src/services/conversionReadiness/scoringConfig.js')
  const sourceFactText = [...(usps || []).filter(Boolean), promotion, landingPage?.title, landingPage?.bodySnippet, (landingPage?.ctas || []).join(' ')]
    .filter(Boolean).join(' ')
  const hasRealOffer       = !!promotion || OFFER_SOURCE_PATTERNS.some(re => re.test(sourceFactText))
  const hasRealRestriction = RESTRICTION_SOURCE_PATTERNS.some(re => re.test(sourceFactText))

  // Pulls the actual matching sentence/USP so the model is given the real
  // approved wording to use, not just a yes/no flag.
  function extractMatchingFact(patterns) {
    if (promotion && patterns.some(re => re.test(promotion))) return promotion
    for (const usp of (usps || [])) { if (usp && patterns.some(re => re.test(usp))) return usp }
    if (landingPage?.bodySnippet) {
      const sentence = landingPage.bodySnippet.split(/(?<=[.!?])\s+/).find(s => patterns.some(re => re.test(s)))
      if (sentence) return sentence.trim()
    }
    return null
  }
  const approvedOfferText       = hasRealOffer       ? (extractMatchingFact(OFFER_SOURCE_PATTERNS) || promotion) : null
  const approvedRestrictionText = hasRealRestriction ? extractMatchingFact(RESTRICTION_SOURCE_PATTERNS)          : null

  const offerLine = hasRealOffer
    ? `This business DOES have a real offer/promotion on file: "${approvedOfferText}" — you may reference it once, in its own real terms (do not embellish or round it up), in Description 4.\n`
    : `This business has NO offer or promotion on file. Do NOT invent one — no "free estimate," "% off," "flat rate," or "no obligation" claim anywhere in this ad. Description 4's CTA stands on its own without an offer.\n`
  const restrictionLine = hasRealRestriction
    ? `This business DOES have a real eligibility restriction on file: "${approvedRestrictionText}" — reflect that ACTUAL restriction, in its own real terms, in Description 4 or the closing CTA headline. Do not use a vague placeholder phrase for it.\n`
    : `This business has NO stated eligibility restriction. Do NOT invent one — never write "see if you qualify," "call to qualify," "if you qualify," or similar hollow qualifying language anywhere in this ad; it earns nothing without a real restriction behind it and reads as filler. Every CTA should be a plain, direct call to action instead.\n`

  // Data-confidence heuristic — how much this ad group's own performance
  // data should be trusted vs. treated as a testing hypothesis. Derived
  // from the same keyword stats already fetched, no new query needed.
  const totalKwImpressions = sortedKw.reduce((s, k) => s + (Number(k.impressions) || 0), 0)
  const totalKwConversions = sortedKw.reduce((s, k) => s + (Number(k.conversions) || 0), 0)
  const dataConfidence = totalKwConversions >= 10 ? 'high' : totalKwConversions >= 3 ? 'medium' : totalKwImpressions > 0 ? 'low' : 'no_performance_data'

  // Search-term-level evidence — real converting and wasted-spend search
  // terms (not just keyword-level aggregates), when the caller has them
  // available (the RSA Builder already fetches these for its own Search
  // Terms tab). A true "qualified lead" vs. "primary conversion" split needs
  // conversion-action-level segmentation this app doesn't fetch yet, so both
  // are folded into one "converting search terms" list using each term's
  // aggregate conversion count rather than fabricating a distinction the
  // data can't actually support.
  const stList = (searchTerms || []).filter(t => t?.term)
  const convertingSearchTerms = stList.filter(t => Number(t.conversions) > 0)
    .sort((a, b) => Number(b.conversions) - Number(a.conversions)).slice(0, 10)
  const wastedSpendSearchTerms = stList.filter(t => Number(t.conversions) === 0 && Number(t.cost) >= 20)
    .sort((a, b) => Number(b.cost) - Number(a.cost)).slice(0, 10)
  const searchTermEvidenceLines = [
    convertingSearchTerms.length > 0
      ? `Top converting search terms (real queries that produced conversions):\n${convertingSearchTerms.map(t => `  - "${t.term}" — ${t.conversions} conv, ${t.clicks} clicks, $${Number(t.cost).toFixed(2)}`).join('\n')}`
      : '',
    wastedSpendSearchTerms.length > 0
      ? `High-spend search terms with ZERO conversions (avoid centering copy on these, even if they look like exact-match keyword text):\n${wastedSpendSearchTerms.map(t => `  - "${t.term}" — $${Number(t.cost).toFixed(2)} spent, 0 conversions`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n')

  const numSets = Math.min(3, Math.max(1, Number(count) || 1))
  const SET_ANGLES = [
    'Trust & Credentials — lead with licensing, certifications, experience, and reliability.',
    'Urgency & Convenience — lead with speed, availability (same-day/24-7), and ease of booking.',
    'Value & Outcomes — lead with pricing transparency, guarantees, and the end result/benefit for the customer.',
  ]

  function buildSetPrompt(setIndex, usedHeadlines, usedDescriptions) {
    const usedBlock = (usedHeadlines.length > 0 || usedDescriptions.length > 0)
      ? `\nALREADY USED in other RSA set(s) for this ad group — this set MUST NOT repeat or closely rephrase ANY of these (different wording AND different angle for every one):\n` +
        `Headlines already used:\n${usedHeadlines.map(h => `  - "${h}"`).join('\n')}\n` +
        `Descriptions already used:\n${usedDescriptions.map(d => `  - "${d}"`).join('\n')}\n\n`
      : ''
    const isBatch  = numSets > 1 || (existingSets || []).length > 0
    const angleLine = isBatch
      ? `\nTHIS RSA'S STRATEGIC ANGLE: ${SET_ANGLES[setIndex % SET_ANGLES.length]} Every other RSA in this batch targets a different angle — this one must feel like a genuinely different ad, not a reworded copy.\n`
      : ''

    return (
      `You are a direct-response Google Ads copywriter creating responsive search ad assets for a professional advertiser.\n\n` +

      `PRIMARY OBJECTIVE: create accurate, persuasive RSA assets that match this ad group's specific search intent and attract qualified conversions at an efficient cost.\n\n` +

      `SECONDARY OBJECTIVE: Google's real Ad Strength rating rewards genuinely relevant, specific, diverse ad copy — write for that outcome directly, not toward any particular score or checklist. Never sacrifice factual accuracy, business fit, natural wording, or conversion quality for the sake of a number.\n\n` +

      `IMPORTANT LIMITATION: you cannot predict conversion performance from ad copy alone. Use the performance evidence below to choose messaging priorities, but do not claim or imply that any asset will guarantee conversions, lower cost-per-conversion, or improve revenue.\n\n` +

      `BUSINESS:\n${bizLines}\nTone: ${tone || 'Professional'}\n\n` +

      `AD GROUP: ${adGroupName}\nCAMPAIGN: ${campaignName || ''}\n` +
      `ALLOWED SERVICE INTENT for this ad group: only what's implied by its own name and the keywords below. Stay strictly within it — do not introduce a neighboring service, different customer type, or a sibling ad group's intent (see the intent lock block below, if enabled).\n\n` +
      `TOP KEYWORDS (ranked by CONVERSION VALUE — conversion rate, cost-efficiency, conversion volume, and commercial intent, weighted well above raw impressions/search volume — highest first):\n${kwTop}\n\n` +
      primaryLine + secondaryLine + '\n' +
      (searchTermEvidenceLines ? `SEARCH-TERM EVIDENCE (the actual queries behind these keywords — prioritize messaging that reflects what's really converting over what merely ranks highest):\n${searchTermEvidenceLines}\n\n` : '') +
      `DATA CONFIDENCE for this ad group: ${dataConfidence.replace(/_/g, ' ')}. ${dataConfidence === 'high' ? 'The keyword/search-term evidence above is well-established — weight it heavily.' : dataConfidence === 'no_performance_data' ? 'No performance history exists yet — treat every messaging choice below as a testing hypothesis, not a proven winner.' : 'Limited sample — lean more on the explicit business facts and landing-page alignment below than on the performance numbers alone.'}\n\n` +

      `LANDING PAGE:\n${lpLines}\n` +
      `The ad must accurately represent what the visitor will find at this page. If the landing page data above looks unavailable or unrelated to this ad group's service, favor the keyword/business-fact evidence over it rather than forcing alignment that isn't really there.\n\n` +

      usedBlock +
      angleLine +

      `\nGOOGLE ADS AD STRENGTH GUIDANCE (write genuinely strong copy that happens to satisfy these — never pad, keyword-stuff, or game them):\n` +
      `Google Ads evaluates Ad Strength on the relevance, quantity, quality, and diversity of your assets — not on cramming every keyword into as many headlines as possible. Google explicitly recommends putting a keyword in at least 2 headlines while including at least 3 other headlines that contain NO keyword at all.\n\n` +

      `1. GENERATE EXACTLY 15 HEADLINES, each 30 characters or fewer (count every character, including spaces and punctuation). Rather than a rigid per-slot formula, cover these roles across the full set of 15 — using real, flexible judgment about how many of each this ad group actually supports, not a forced count:\n` +
      `   - The exact service/search intent (the primary keyword theme above), worked in naturally — word-for-word if it fits in 30 chars, otherwise its core terms.\n` +
      `   - Secondary keyword themes, only when they represent the SAME approved intent (not a separate service tacked on for variety).\n` +
      `   - The customer's problem or urgency — what's going wrong right now, or why this needs handling soon — not a generic service label.\n` +
      `   - The desired outcome or a verified benefit — what changes once this is solved.\n` +
      `   - Verified differentiators (licensed, insured, certified, guarantees, years in business) — specific to this business, not a generic claim.\n` +
      `   - Trust/proof (ratings, reviews, reputation${serviceArea ? `; this is also the natural place to work in the service area ("${serviceArea}") if it doesn't fit elsewhere` : ''}).\n` +
      `   - A strong CTA (Call, Book, Schedule, Get, Request, Contact, Hire, Discuss, Ask). ${hasRealRestriction ? 'Since this business has a real eligibility restriction (see below), let one CTA naturally reflect it.' : 'Do NOT add a qualifying cue to any CTA — see the restriction note below.'}\n` +
      `   At least 3 of the 15 headlines must contain NO keyword and NO location term at all — pure benefit/trust/offer/CTA copy. Use full character space (aim for 20-30 characters) — short headlines hurt Ad Strength, but a concise, complete headline still beats a padded one.\n\n` +

      `2. COMBINATION SAFETY: every headline must make sense on its own AND when Google combines it with others in a different order. Avoid dependent fragments like "When You Need It" that require another headline to explain the subject. The first 3 headlines especially should be complementary if shown together — normally one service/intent message, one verified value message, one next step — not three near-identical keyword restatements.\n\n` +

      `3. EVERY HEADLINE IS A GENUINELY DIFFERENT MESSAGE. Do not write adjective-only near-rephrases of the same idea — e.g. "Junk Removal Services", "Local Junk Removal", "Affordable Junk Removal", and "Professional Junk Removal" all say the same thing with a different adjective bolted on; that is exactly what NOT to do. Necessary repeats of the exact service, business name, approved location, or a verified offer are fine when the surrounding message is genuinely different — don't force different vocabulary just to appear varied. NO TWO HEADLINES MAY START WITH THE SAME FIRST WORD — vary the opening word of every headline across the full set of 15, even when their underlying message is otherwise different.\n\n` +

      `4. AVOID VAGUE, UNVERIFIABLE FILLER PHRASES anywhere in headlines or descriptions — e.g. "Quality Service", "Best Solutions", "Learn More", "We Can Help". Every claim must be concrete and specific to this business — a phrase that could be copy-pasted onto any competitor's ad in this industry is not acceptable. Do not name or reference any competitor. Do not repeat the business name more than once or twice across the whole set.\n\n` +

      `5. STAY WITHIN THIS EXACT AD GROUP'S SERVICE SCOPE. Only reference the service(s), job type(s), or product(s) that actually appear in the TOP KEYWORDS list or the ad group name above. Do not introduce a related-but-different service variant that isn't one of those keywords — e.g. if this ad group's keywords are about a faucet UPGRADE/install, do not write headlines about faucet REPAIR or a "leaking faucet" unless "repair" or "leaking" literally appears in the keyword list. When in doubt, a headline should describe something a customer searching one of the exact keywords above would recognize as the same job they searched for, not a plausible-sounding neighboring service.\n\n` +

      `6. GENERATE EXACTLY 4 DESCRIPTIONS, each 90 characters or fewer. Give them meaningfully different primary jobs rather than letting any two blur together — use this as flexible coverage guidance, not a forced formula. If a category below lacks verified evidence to support it, use another useful, factual message instead of inventing a credential, offer, promise, or urgency:\n` +
      `   • Description 1 — Match the customer's need and state the service plainly: name the core service(s) this ad group covers, in language that mirrors how the customer searched.\n` +
      `   • Description 2 — The single strongest verified benefit or differentiator: the one outcome or credential most likely to tip a ready buyer toward this business over another.\n` +
      `   • Description 3 — Trust, proof, process, or risk-reduction: licensing/insurance, experience, guarantee, or what removes the customer's hesitation to commit.\n` +
      `   • Description 4 — A specific, appropriate next step. ${offerLine}${restrictionLine}\n` +
      `   No two descriptions may share more than 2 significant words (4+ letters), and no two may open with the same first word. The primary keyword theme should appear naturally in at least one description (Description 1 is the natural place for it) — do not force it into all four. Write naturally for the detected decision stage — do not assume every searcher is an emergency buyer ready to purchase this second.\n` +
      `   HARD MINIMUM 70 characters — NEVER go below 70. TARGET 75–85 characters — do NOT write toward the 90 edge, real output consistently runs a few characters longer than planned. HARD MAX 90 characters — going over is INVALID, not a rounding error.\n` +
      `   SENTENCE COMPLETENESS (HARD RULE): every description MUST be a complete, grammatically finished sentence or clause. NEVER end on a word that clearly needs something after it — for, and, with, since, because, or, a, an, the, to, of, in, on, at, by, or any other connector/article. AVOID comma-separated lists of 3+ items (e.g. "X, Y, and Z across...") — they are the most common way a description quietly runs long; prefer one or two concrete items over an enumerated list. Before finalizing each description, count its exact character length and check its last word: if it's over 85 characters or the sentence would obviously continue past that last word, rewrite it shorter from scratch so it actually finishes within the limit instead of getting cut off mid-thought.\n` +
      `   Write for BUYERS, not shoppers: address someone ready to hire/book NOW, not someone still researching or comparing options. Lead with concrete, decision-tipping specifics (credentials, guarantees, availability, outcome) and a clear next action — avoid vague browsing-stage language like "learn more", "explore options", or "find out about".\n` +
      `   Example showing correct length AND a complete ending (88 chars): "Licensed and insured roofing experts serving South Florida. Book a free estimate."\n` +
      `   Example of what NOT to do (fragment, do not output anything like this): "Protecting your business with 24/7 monitoring and advanced camera" — this cuts off mid-thought instead of finishing the sentence.\n\n` +

      `7. PINNING: do not assign or imply pin positions — leave every asset free to combine by default. Pinning restricts how many ad combinations Google can test. (If the supplied context says specific wording must always appear for legal, compliance, or offer-integrity reasons, note that as a comment rather than silently pinning — but don't claim pinning is universally prohibited either.)\n\n` +

      RSA_POLICY_RULES + `\n` +
      `Additional house rules: do not use coercive or manufactured urgency (e.g. "Last chance ever," "Act now before it's too late"); do not use "Guaranteed Results."\n\n` +
      buildAdvertiserContextBlock(accountProfile, campaignName, adGroupName) +
      buildIntentLockBlock(adGroupName, siblingAdGroupNames, preventCrossover) +
      `\nCHARACTER LIMITS (HARD):\n` +
      `- Exactly 15 headlines — each MUST be ≤30 characters. Count every character. 31+ = INVALID.\n` +
      `- Exactly 4 descriptions — each MUST be between 70 and 90 characters (inclusive). Under 70 = INVALID. Over 90 = INVALID.\n` +
      `- Headline example (exactly 30 chars): "Call for a Free Estimate Today"\n` +
      `- Do NOT use ALL CAPS.\n` +
      `- Descriptions must end with a complete thought — never end on a preposition, conjunction, or article.\n\n` +
      `APPROVED CLAIMS ONLY: every specific claim — free estimates, flat-rate pricing, same-day or 24/7 availability, a guarantee or warranty, "verified reviews" or a star rating, a confirmed installation/appointment date, a license/certification, years in business, or any price/discount — may ONLY appear if it is explicitly present in the BUSINESS, LANDING PAGE, or ADVERTISER CONTEXT sections above. If none of those support a given claim type, omit it entirely rather than writing a generic or invented version of it — an omitted category is always better than a fabricated one.\n\n` +

      `FINAL SELF-CHECK before responding — verify all of these silently:\n` +
      `1. Every specific factual claim traces back to BUSINESS, LANDING PAGE, or ADVERTISER CONTEXT above — nothing invented.\n` +
      `2. No excluded or sibling ad-group intent appears anywhere.\n` +
      `3. Every headline is 30 characters or fewer; every description is 70-90 characters and ends on a complete thought.\n` +
      `4. The first three headlines are complementary, not repetitive.\n` +
      `5. Every asset makes sense independently and in likely combinations with the others.\n` +
      `6. The set has meaningful message diversity without unnatural, robotic, or template-sounding wording.\n` +
      `7. The ad accurately matches the landing page (where one is available).\n` +
      `8. No prohibited or house-rule wording appears (superlatives, exclamation marks, phone numbers, competitor names, manufactured urgency).\n\n` +
      `Output the JSON object as your entire response — no planning notes, no character-by-character counting written out, no explanation before it. Verify lengths silently; only the final JSON goes in your response:\n` +
      `{\n` +
      `  "headlines": ["h1","h2","h3","h4","h5","h6","h7","h8","h9","h10","h11","h12","h13","h14","h15"],\n` +
      `  "headlineTypes": ["Keyword","Keyword","Keyword","Secondary","Secondary","Problem","Problem","Benefit","Benefit","Benefit","Differentiator","Differentiator","Trust","CTA","CTA"],\n` +
      `  "descriptions": ["d1","d2","d3","d4"]\n` +
      `}\n` +
      `Valid headlineTypes: Keyword | Secondary | Problem | Benefit | Differentiator | Trust | CTA\n` +
      `headlineTypes MUST have exactly 15 entries in the same order as headlines, one type per headline reflecting the role it actually plays — no fixed count is required per type, just real judgment about what this ad group's evidence supports.`
    )
  }

  // max_tokens has headroom above what 15 headlines + 4 descriptions of JSON
  // actually needs — the model sometimes narrates character-counting checks
  // before the JSON (despite being told not to), and a tight budget can let
  // that narration eat the whole response before the JSON ever appears,
  // truncating it mid-stream with nothing parseable returned.
  async function generateOneSet(setIndex, usedHeadlines, usedDescriptions) {
    const message = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      messages:   [{ role: 'user', content: buildSetPrompt(setIndex, usedHeadlines, usedDescriptions) }],
    })
    const raw   = message.content[0]?.text || ''
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) {
      throw new Error(`No JSON object in response (stop_reason=${message.stop_reason}, length=${raw.length})`)
    }
    const parsed  = JSON.parse(match[0])
    const descExp = (parsed.descriptions || []).slice(0, 4).map(d => sanitizeDescriptionEx(d))
    const hlExp   = (parsed.headlines    || []).slice(0, 15).map(h => sanitizeHeadlineEx(h))
    return {
      headlines:         hlExp.map(x => x.text),
      headlineHardTruncated: hlExp.map(x => x.hardTruncated),
      headlineTypes:     (parsed.headlineTypes || []).slice(0, 15),
      descriptions:      descExp.map(x => x.text),
      descHardTruncated: descExp.map(x => x.hardTruncated),
    }
  }

  // Corrective pass — fixes descriptions/headlines that came back too short,
  // too long, ending mid-thought, or were word-cut to fit the character limit
  // (which can orphan a real word even when it doesn't match the
  // dangling-word check) — shared with rsa:refreshAllDescriptions below.
  async function fixDescriptions(set) {
    const descriptions = await reviseWeakDescriptions(anthropic, {
      adGroupName, kwHint: sortedKw.slice(0, 5).map(k => k.text).join(', '),
      descriptions: set.descriptions, hardTruncated: set.descHardTruncated || [],
    })
    return { ...set, descriptions }
  }

  async function fixHeadlines(set) {
    const headlines = await reviseWeakHeadlines(anthropic, {
      adGroupName, kwHint: sortedKw.slice(0, 5).map(k => k.text).join(', '),
      headlines: set.headlines, hardTruncated: set.headlineHardTruncated || [],
    })
    return { ...set, headlines }
  }

  // Validate → check keyword coverage → check semantic duplication → check
  // message-category variety → replace only the failing assets → revalidate.
  // Reuses the EXACT same excellentReady logic Phase 1's scoring engine
  // judges by (dynamically imported — this file is CommonJS, that module is
  // ESM) so generation is validated against the identical bar the UI later
  // scores it on, rather than a second, possibly-disagreeing checklist.
  // One extra pass only, same bounded-retry philosophy as
  // reviseWeakHeadlines/reviseWeakDescriptions above — ships the best
  // attempt after that rather than looping indefinitely.
  async function fixExcellenceGaps(set) {
    const { estimateAdStrength } = await import('../src/services/rsaScoringEngine.js')
    const { similarityMatrix } = await import('../src/services/rsaScoring/textSimilarity.js')
    const { HEADLINE_SIMILARITY_THRESHOLDS, DESCRIPTION_SIMILARITY_THRESHOLD } = await import('../src/services/rsaScoring/scoringConfig.js')

    const evaluate = (headlines, descriptions) => estimateAdStrength({
      headlines: headlines.map(text => ({ text })),
      descriptions: descriptions.map(text => ({ text })),
      keywords: sortedKw, landingPage,
    })

    let { headlines, descriptions } = set
    let result = evaluate(headlines, descriptions)
    const failing = result.excellentChecks.filter(c => !c.pass).map(c => c.key)
    // Only these are fixable by rewriting text — pinning/sitelinks/asset
    // counts aren't something a content regeneration pass can address here.
    const fixableFailed = failing.filter(k => ['headlineUniqueness', 'descriptionUniqueness', 'primaryKeywordHeadlines', 'primaryKeywordDescription', 'messageCategories'].includes(k))

    // Google's own real diagnostic reasons for the EXISTING, already-
    // published ad being regenerated (if any) — a second, independent
    // signal alongside our own excellentChecks above. This is the actual
    // reason this app's "Estimated Ad Strength" can disagree with Google's
    // real rating: our heuristic can consider something fine while Google's
    // real classifier doesn't. Mapped to concrete directives rather than
    // passed through verbatim, since Google's strings describe the symptom
    // ("add more keywords"), not which specific asset to touch — only the
    // messages we can confidently act on are mapped; "add more
    // headlines/descriptions" isn't actionable here since generation
    // already produces exactly 15/4.
    const realDirectives = []
    let realWantsHeadlines = false, realWantsDescriptions = false
    for (const item of (realActionItems || [])) {
      if (/more keywords in your headlines/i.test(item)) {
        realDirectives.push(`Google Ads' real evaluation of the current live ad flagged: "${item}" — make sure at least 4-6 of the 15 headlines contain an exact or close variant of a top keyword below, worked in naturally, not stuffed.`)
        realWantsHeadlines = true
      } else if (/more keywords in your descriptions/i.test(item)) {
        realDirectives.push(`Google Ads' real evaluation of the current live ad flagged: "${item}" — make sure at least 2 of the 4 descriptions contain an exact or close variant of a top keyword below.`)
        realWantsDescriptions = true
      } else if (/headlines? more unique/i.test(item)) {
        realDirectives.push(`Google Ads' real evaluation of the current live ad flagged: "${item}" — the headlines read too similar to each other; make sure each one covers a genuinely different angle, not just a different adjective on the same idea.`)
        realWantsHeadlines = true
      }
    }

    if (fixableFailed.length === 0 && realDirectives.length === 0) return { ...set, headlines, descriptions }

    // Identify specific problem headlines: any headline involved in a
    // near-duplicate pair.
    const dupeHlIdx = new Set()
    similarityMatrix(headlines).forEach(p => { if (p.similarity >= HEADLINE_SIMILARITY_THRESHOLDS.moderate) { dupeHlIdx.add(p.i); dupeHlIdx.add(p.j) } })
    const dupeDsIdx = new Set()
    similarityMatrix(descriptions).forEach(p => { if (p.similarity >= DESCRIPTION_SIMILARITY_THRESHOLD) { dupeDsIdx.add(p.i); dupeDsIdx.add(p.j) } })

    // Weak-message-variety / low-keyword-coverage headlines: reuse the
    // generic/benefit-only headlines (skip the ones already carrying the
    // CTA/keyword load) as the replacement candidates.
    const wantsMoreHeadlineCoverage = failing.includes('messageCategories') || failing.includes('primaryKeywordHeadlines') || realWantsHeadlines
    const genericHlIdx = new Set()
    if (wantsMoreHeadlineCoverage) {
      headlines.forEach((h, i) => {
        if (dupeHlIdx.has(i)) return
        if (/^(call|book|schedule|get|request|contact|hire)/i.test(h)) return // keep CTAs as-is
        genericHlIdx.add(i)
      })
    }

    const targetHlIdx = new Set([...dupeHlIdx, ...(wantsMoreHeadlineCoverage ? [...genericHlIdx].slice(0, 3) : [])])
    const targetDsIdx = new Set([...dupeDsIdx, ...(realWantsDescriptions ? [0, 1].filter(i => i < descriptions.length) : [])])

    if (targetHlIdx.size === 0 && targetDsIdx.size === 0) return { ...set, headlines, descriptions }

    try {
      const failureNotes = [
        ...result.excellentChecks.filter(c => fixableFailed.includes(c.key)).map(c => `- ${c.message}`),
        ...realDirectives,
      ].join('\n')
      const prompt =
        `Rewrite ONLY the specific headlines/descriptions listed below from this Google Ads RSA — the rest of the ad stays as-is. ` +
        `Fix these specific problems: \n${failureNotes}\n\n` +
        `Ad Group: ${adGroupName || ''}\n` +
        `Primary keyword theme: ${primaryKw ? primaryKw.text : '(none)'}\n\n` +
        (targetHlIdx.size > 0 ? `Headlines to replace (each MUST be ≤30 characters, a genuinely different message from every other headline in the ad, and from each other, and must not start with the same first word as any other headline already in the ad or any other replacement):\n${[...targetHlIdx].map(i => `  ${i + 1}. "${headlines[i]}"`).join('\n')}\n\n` : '') +
        (targetDsIdx.size > 0 ? `Descriptions to replace (each MUST be 70–90 characters, a complete sentence, genuinely different from the others):\n${[...targetDsIdx].map(i => `  ${i + 1}. "${descriptions[i]}"`).join('\n')}\n\n` : '') +
        RSA_POLICY_RULES + '\n' +
        `Return ONLY valid JSON: {"headlines":{"<index>":"new text",...},"descriptions":{"<index>":"new text",...}} using the same 1-based index numbers listed above as keys.`
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = message.content[0]?.text || '{}'
      const match = raw.match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(match?.[0] || '{}')

      const nextHeadlines = [...headlines]
      for (const [idxStr, text] of Object.entries(parsed.headlines || {})) {
        const idx = Number(idxStr) - 1
        const exp = sanitizeHeadlineEx(text)
        if (idx >= 0 && idx < nextHeadlines.length && exp.text && getEffectiveLength(exp.text) <= 30 && !exp.hardTruncated && !endsIncomplete(exp.text)) {
          nextHeadlines[idx] = exp.text
        }
      }
      const nextDescriptions = [...descriptions]
      for (const [idxStr, text] of Object.entries(parsed.descriptions || {})) {
        const idx = Number(idxStr) - 1
        const exp = sanitizeDescriptionEx(text)
        if (idx >= 0 && idx < nextDescriptions.length && exp.text && getEffectiveLength(exp.text) >= 70 && getEffectiveLength(exp.text) <= 90 && !exp.hardTruncated && !endsIncomplete(exp.text)) {
          nextDescriptions[idx] = exp.text
        }
      }

      // Only keep the rewrite if it actually improved things — never ship a
      // "fix" that made excellentReady coverage worse, and never replace
      // original copy for a sideways change with zero measurable gain
      // (strict > , not >=) — an unverified rewrite is pure downside risk
      // (tone, naturalness, factual drift) when it didn't even move the
      // metric it was rewritten to fix. Exception: when this rewrite was
      // triggered ONLY by Google's real action items (our own
      // excellentChecks found nothing to fix), requiring our heuristic to
      // show improvement would be self-defeating — that's exactly the case
      // where our heuristic already disagrees with Google, so it may not
      // move even for a change Google's real classifier would reward. Just
      // require no regression by our own measure instead.
      const before = result.excellentChecks.filter(c => c.pass).length
      const after  = evaluate(nextHeadlines, nextDescriptions).excellentChecks.filter(c => c.pass).length
      const requireStrictGain = fixableFailed.length > 0
      if (requireStrictGain ? (after > before) : (after >= before)) { headlines = nextHeadlines; descriptions = nextDescriptions }
    } catch (err) {
      console.error(`[rsa:generateRSAAssets] excellence-gap fix pass failed: ${err.message}`)
    }

    return { ...set, headlines, descriptions }
  }

  // Corrective pass #2 — targets Conversion Readiness specifically (a
  // different rubric from Ad Strength: offer strength, trust/proof, benefit
  // language, CTA urgency, lead qualification, search-intent match). The
  // base prompt already asks for all of these, but nothing previously
  // verified the output actually delivered them, so a set could land
  // Excellent on Ad Strength while still scoring weakly on Conversion
  // Readiness (e.g. no real offer, no urgency in the CTA, no qualifying
  // language). Runs after fixExcellenceGaps so it never fights that pass —
  // it targets specific headline TYPES (via headlineTypes, already known
  // from generation) and specific description roles, the same
  // "replace only what's failing, verify no regression" approach.
  const CONVERSION_READY_TARGET = 75
  // Bounded at 2 attempts — same philosophy as generateOneSet's retry and
  // reviewWeakHeadlines/reviewWeakDescriptions above, not an unlimited loop.
  // One attempt was often not enough specifically when a business has BOTH
  // a real offer AND a real eligibility restriction on file: both map to
  // the same single description slot (on top of that slot's own "next
  // step" job), which is a lot to land correctly in 70-90 characters in one
  // try — a second, freshly-targeted attempt (at whatever is STILL weak
  // after the first) meaningfully raises the odds of actually clearing the
  // bar instead of silently shipping the still-weak original.
  const CONVERSION_FIX_MAX_ATTEMPTS = 2
  async function fixConversionGaps(set) {
    const { estimateConversionReadiness } = await import('../src/services/conversionReadiness/conversionReadinessEngine.js')
    const { estimateAdStrength } = await import('../src/services/rsaScoringEngine.js')

    const evaluateConv = (headlines, descriptions) => estimateConversionReadiness({
      headlines: headlines.map(text => ({ text })),
      descriptions: descriptions.map(text => ({ text })),
      keywords: sortedKw, landingPage, usps, promotion,
    })
    const evaluateAd = (headlines, descriptions) => estimateAdStrength({
      headlines: headlines.map(text => ({ text })),
      descriptions: descriptions.map(text => ({ text })),
      keywords: sortedKw, landingPage,
    })

    let { headlines, descriptions, headlineTypes } = set

    for (let attempt = 1; attempt <= CONVERSION_FIX_MAX_ATTEMPTS; attempt++) {
      const result = evaluateConv(headlines, descriptions)
      if (result.score >= CONVERSION_READY_TARGET) break

      // Weak = under 60% of that component's max — landingPageMatch is left
      // out here since it isn't something a targeted asset rewrite can fix in
      // isolation (it depends on the whole ad's language vs. the page, already
      // surfaced as a UI recommendation instead). Not-applicable components
      // (offer/leadQualification with no real business fact behind them) are
      // also excluded — there is nothing to "fix," rewriting them in would
      // mean fabricating the exact claim this pass must not fabricate.
      const weak = Object.entries(result.breakdown)
        .filter(([key, dim]) => key !== 'landingPageMatch' && dim.applicable !== false && dim.score < dim.max * 0.6)
        .map(([key]) => key)
      if (weak.length === 0) break

      const lastIdxOfType = t => { const idxs = (headlineTypes || []).flatMap((x, i) => x === t ? [i] : []); return idxs.length ? idxs[idxs.length - 1] : -1 }
      const firstIdxOfType = t => (headlineTypes || []).findIndex(x => x === t)

      const targetHlIdx = new Set()
      const targetDsIdx = new Set()
      // Description roles from the generation prompt: 0=service coverage,
      // 1=benefit/differentiator, 2=trust/proof/risk-reduction, 3=CTA+offer+qualify.
      if (weak.includes('benefitsOutcomes'))  { const i = firstIdxOfType('Benefit');        if (i >= 0) targetHlIdx.add(i); targetDsIdx.add(1) }
      if (weak.includes('trustProof'))        { const i = firstIdxOfType('Trust');          if (i >= 0) targetHlIdx.add(i); targetDsIdx.add(2) }
      if (weak.includes('offerValueProposition')) { targetDsIdx.add(3) }
      if (weak.includes('strongCta'))         { const i = lastIdxOfType('CTA');             if (i >= 0) targetHlIdx.add(i); targetDsIdx.add(3) }
      if (weak.includes('leadQualification')) { const i = lastIdxOfType('CTA');             if (i >= 0) targetHlIdx.add(i); targetDsIdx.add(3) }
      if (weak.includes('searchIntentMatch')) { const i = firstIdxOfType('Keyword');         if (i >= 0) targetHlIdx.add(i); targetDsIdx.add(0) }

      if (targetHlIdx.size === 0 && targetDsIdx.size === 0) break

      try {
        const failureNotes = result.issues.map(iss => `- ${iss}`).join('\n')
        // When BOTH offer and restriction are weak, they're competing for
        // the same description slot — on attempt 2, say so explicitly
        // rather than leaving the model to guess how to fit both plus a
        // next-step CTA into one 70-90 char sentence.
        const bothOfferAndRestriction = weak.includes('offerValueProposition') && weak.includes('leadQualification')
        const craminNote = (attempt > 1 && bothOfferAndRestriction)
          ? `This single description must land BOTH the offer and the eligibility restriction, plus still read as a clear next step — prioritize fitting both real facts in over extra flourish; keep it tight and literal rather than dropping one of them.\n\n`
          : ''
        const prompt =
          `Rewrite ONLY the specific headlines/descriptions listed below from this Google Ads RSA — the rest of the ad stays as-is. ` +
          `This ad currently scores weak on CONVERSION READINESS (likelihood to convert, not Ad Strength). Fix these specific gaps:\n${failureNotes}\n\n` +
          `Ad Group: ${adGroupName || ''}\n` +
          `Primary keyword theme: ${primaryKw ? primaryKw.text : '(none)'}\n\n` +
          (targetHlIdx.size > 0 ? `Headlines to replace (each MUST be ≤30 characters, a genuinely different message from every other headline in the ad, and must not start with the same first word as any other headline already in the ad or any other replacement):\n${[...targetHlIdx].map(i => `  ${i + 1}. "${headlines[i]}"`).join('\n')}\n\n` : '') +
          (targetDsIdx.size > 0 ? `Descriptions to replace (each MUST be 70–90 characters, a complete sentence, genuinely different from the others):\n${[...targetDsIdx].map(i => `  ${i + 1}. "${descriptions[i]}"`).join('\n')}\n\n` : '') +
          craminNote +
          `Address the gaps concretely: a specific verified benefit or differentiator, trust/proof language, and/or a clearer, more direct CTA — whichever of these this ad is missing per the gaps above. Only add urgency language ("today," "now," "same-day") if it's already true of this business per the context below — never add it just to sound more urgent; manufactured urgency is a house-rule violation, not a fix. Do not invent unsupported claims. ${offerLine}${restrictionLine}\n\n` +
          RSA_POLICY_RULES + '\n' +
          `Return ONLY valid JSON: {"headlines":{"<index>":"new text",...},"descriptions":{"<index>":"new text",...}} using the same 1-based index numbers listed above as keys.`
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-6', max_tokens: 800,
          messages: [{ role: 'user', content: prompt }],
        })
        const raw = message.content[0]?.text || '{}'
        const match = raw.match(/\{[\s\S]*\}/)
        const parsed = JSON.parse(match?.[0] || '{}')

        const nextHeadlines = [...headlines]
        for (const [idxStr, text] of Object.entries(parsed.headlines || {})) {
          const idx = Number(idxStr) - 1
          const exp = sanitizeHeadlineEx(text)
          if (idx >= 0 && idx < nextHeadlines.length && exp.text && getEffectiveLength(exp.text) <= 30 && !exp.hardTruncated && !endsIncomplete(exp.text)) {
            nextHeadlines[idx] = exp.text
          }
        }
        const nextDescriptions = [...descriptions]
        for (const [idxStr, text] of Object.entries(parsed.descriptions || {})) {
          const idx = Number(idxStr) - 1
          const exp = sanitizeDescriptionEx(text)
          if (idx >= 0 && idx < nextDescriptions.length && exp.text && getEffectiveLength(exp.text) >= 70 && getEffectiveLength(exp.text) <= 90 && !exp.hardTruncated && !endsIncomplete(exp.text)) {
            nextDescriptions[idx] = exp.text
          }
        }

        // Only keep the rewrite if Conversion Readiness actually improved
        // (strict >, matching the comment's original intent — a sideways
        // rewrite with zero gain is pure risk, not a fix) AND Ad Strength's
        // excellentReady coverage didn't regress — this pass must not trade
        // one score for the other. A rejected attempt just means the loop's
        // next iteration (if any) tries again from the same starting point.
        const convBefore  = result.score
        const convAfter   = evaluateConv(nextHeadlines, nextDescriptions).score
        const adBefore    = evaluateAd(headlines, descriptions).excellentChecks.filter(c => c.pass).length
        const adAfter     = evaluateAd(nextHeadlines, nextDescriptions).excellentChecks.filter(c => c.pass).length
        if (convAfter > convBefore && adAfter >= adBefore) {
          headlines = nextHeadlines; descriptions = nextDescriptions
        } else {
          break // this attempt made no verified progress — another try from the same spot won't either
        }
      } catch (err) {
        console.error(`[rsa:generateRSAAssets] conversion-readiness fix pass failed (attempt ${attempt}): ${err.message}`)
        break
      }
    }

    return { ...set, headlines, descriptions }
  }

  // Corrective pass #3 — a final naturalness/quality-control read of the
  // finished copy. The rules above (character limits, quotas, approved
  // claims) can all pass while a specific phrase still reads as awkward,
  // robotic, or like nobody would actually say it out loud (e.g. "ADA
  // Compliant Upgrade Here", "Toilet Swap", a bare "Call Now to See If You
  // Qualify" with no real qualifying context behind it). This asks a fresh
  // pass of the model to read the finished set as a human would and flag
  // only what genuinely sounds off, rather than re-deriving the same rules
  // it just followed — same bounded, "keep only if it doesn't regress
  // anything" approach as the passes above.
  async function fixUnnaturalPhrasing(set) {
    let { headlines, descriptions } = set
    try {
      const prompt =
        `Read this Google Ads RSA copy the way a real customer would — not as a checklist, as actual sentences someone would see and read. ` +
        `Flag ONLY the headlines/descriptions that sound awkward, robotic, or unnatural — a template-sounding noun mash-up (e.g. "Toilet Swap", "ADA Compliant Upgrade Here"), a phrase no real business would say out loud, or a CTA that leans on a hollow qualifying phrase like "Call Now to See If You Qualify" with nothing real behind it. Do not flag something just because it's plain or direct — plain, concrete, benefit-led language is fine and often better; only flag what genuinely reads badly.\n\n` +
        `Ad Group: ${adGroupName || ''}\n\n` +
        `Headlines:\n${headlines.map((h, i) => `  ${i + 1}. "${h}"`).join('\n')}\n\n` +
        `Descriptions:\n${descriptions.map((d, i) => `  ${i + 1}. "${d}"`).join('\n')}\n\n` +
        `For each flagged item, rewrite it into something a real business would naturally say — same message/category and same character-limit rules (headlines ≤30 chars, descriptions 70–90 chars, a complete sentence). Do not rewrite anything that already reads naturally.\n\n` +
        RSA_POLICY_RULES + '\n' +
        `Return ONLY valid JSON: {"headlines":{"<index>":"rewritten text",...},"descriptions":{"<index>":"rewritten text",...}} using 1-based indexes, including ONLY the entries you're rewriting. If nothing needs rewriting, return {"headlines":{},"descriptions":{}}.`
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = message.content[0]?.text || '{}'
      const match = raw.match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(match?.[0] || '{}')
      if (Object.keys(parsed.headlines || {}).length === 0 && Object.keys(parsed.descriptions || {}).length === 0) {
        return { ...set, headlines, descriptions }
      }

      const nextHeadlines = [...headlines]
      for (const [idxStr, text] of Object.entries(parsed.headlines || {})) {
        const idx = Number(idxStr) - 1
        const exp = sanitizeHeadlineEx(text)
        if (idx >= 0 && idx < nextHeadlines.length && exp.text && getEffectiveLength(exp.text) <= 30 && !exp.hardTruncated && !endsIncomplete(exp.text)) {
          nextHeadlines[idx] = exp.text
        }
      }
      const nextDescriptions = [...descriptions]
      for (const [idxStr, text] of Object.entries(parsed.descriptions || {})) {
        const idx = Number(idxStr) - 1
        const exp = sanitizeDescriptionEx(text)
        if (idx >= 0 && idx < nextDescriptions.length && exp.text && getEffectiveLength(exp.text) >= 70 && getEffectiveLength(exp.text) <= 90 && !exp.hardTruncated && !endsIncomplete(exp.text)) {
          nextDescriptions[idx] = exp.text
        }
      }

      // A rewrite must not accidentally create a new near-duplicate pair —
      // reuse the same similarity check the excellence-gap pass relies on.
      const { similarityMatrix } = await import('../src/services/rsaScoring/textSimilarity.js')
      const { HEADLINE_SIMILARITY_THRESHOLDS, DESCRIPTION_SIMILARITY_THRESHOLD } = await import('../src/services/rsaScoring/scoringConfig.js')
      const countDupes = (texts, threshold) => similarityMatrix(texts).filter(p => p.similarity >= threshold).length
      const hlDupesBefore = countDupes(headlines, HEADLINE_SIMILARITY_THRESHOLDS.moderate)
      const hlDupesAfter  = countDupes(nextHeadlines, HEADLINE_SIMILARITY_THRESHOLDS.moderate)
      const dsDupesBefore = countDupes(descriptions, DESCRIPTION_SIMILARITY_THRESHOLD)
      const dsDupesAfter  = countDupes(nextDescriptions, DESCRIPTION_SIMILARITY_THRESHOLD)
      if (hlDupesAfter <= hlDupesBefore && dsDupesAfter <= dsDupesBefore) { headlines = nextHeadlines; descriptions = nextDescriptions }
    } catch (err) {
      console.error(`[rsa:generateRSAAssets] naturalness fix pass failed: ${err.message}`)
    }
    return { ...set, headlines, descriptions }
  }

  // Corrective pass #4 — runs ONCE after all sets in this batch are built,
  // comparing each set against every EARLIER set's finished copy (not just
  // the "already used" list each set's own generation prompt saw, which is
  // an instruction the model can still drift from). Catches literal
  // cross-RSA repeats — the same CTA, the same "same-day"/"free quote"
  // framing reused verbatim — and regenerates only the specific overlapping
  // assets in the LATER set, since the earlier set was already accepted.
  async function fixCrossSetDuplication(allSets) {
    if (allSets.length < 2) return allSets
    const { computeSimilarity } = await import('../src/services/rsaScoring/textSimilarity.js')
    const { HEADLINE_SIMILARITY_THRESHOLDS, DESCRIPTION_SIMILARITY_THRESHOLD } = await import('../src/services/rsaScoring/scoringConfig.js')

    const result = [...allSets]
    for (let i = 1; i < result.length; i++) {
      const earlierHeadlines    = result.slice(0, i).flatMap(s => s.headlines)
      const earlierDescriptions = result.slice(0, i).flatMap(s => s.descriptions)
      const set = result[i]
      if (!set.headlines?.length || !set.descriptions?.length) continue

      const dupeHlIdx = new Set()
      set.headlines.forEach((h, idx) => {
        if (earlierHeadlines.some(eh => computeSimilarity(h, eh) >= HEADLINE_SIMILARITY_THRESHOLDS.moderate)) dupeHlIdx.add(idx)
      })
      const dupeDsIdx = new Set()
      set.descriptions.forEach((d, idx) => {
        if (earlierDescriptions.some(ed => computeSimilarity(d, ed) >= DESCRIPTION_SIMILARITY_THRESHOLD)) dupeDsIdx.add(idx)
      })
      if (dupeHlIdx.size === 0 && dupeDsIdx.size === 0) continue

      try {
        const prompt =
          `Rewrite ONLY the specific headlines/descriptions listed below from RSA #${i + 1} of a ${result.length}-RSA Google Ads batch — the rest of this RSA stays as-is. ` +
          `Each one is too close to something already used in an EARLIER RSA in this same batch — different wording AND a different angle is required, not a rephrase of the same idea (e.g. don't just swap "today" for "now," or "free quote" for "free estimate" — use a genuinely different message, urgency word, or offer framing than the earlier RSA used).\n\n` +
          `Ad Group: ${adGroupName || ''}\n` +
          `Primary keyword theme: ${primaryKw ? primaryKw.text : '(none)'}\n\n` +
          (dupeHlIdx.size > 0 ? `Headlines to replace (each MUST be ≤30 characters, and must not start with the same first word as any other headline in THIS set):\n${[...dupeHlIdx].map(idx => `  ${idx + 1}. "${set.headlines[idx]}"`).join('\n')}\n\nAlready used in earlier RSA(s) — do not repeat or closely rephrase:\n${earlierHeadlines.map(h => `  - "${h}"`).join('\n')}\n\n` : '') +
          (dupeDsIdx.size > 0 ? `Descriptions to replace (each MUST be 70–90 characters, a complete sentence):\n${[...dupeDsIdx].map(idx => `  ${idx + 1}. "${set.descriptions[idx]}"`).join('\n')}\n\nAlready used in earlier RSA(s) — do not repeat or closely rephrase:\n${earlierDescriptions.map(d => `  - "${d}"`).join('\n')}\n\n` : '') +
          `${offerLine}${restrictionLine}\n` +
          RSA_POLICY_RULES + '\n' +
          `Return ONLY valid JSON: {"headlines":{"<index>":"new text",...},"descriptions":{"<index>":"new text",...}} using the same 1-based index numbers listed above as keys.`
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-6', max_tokens: 800,
          messages: [{ role: 'user', content: prompt }],
        })
        const raw = message.content[0]?.text || '{}'
        const match = raw.match(/\{[\s\S]*\}/)
        const parsed = JSON.parse(match?.[0] || '{}')

        const nextHeadlines = [...set.headlines]
        for (const [idxStr, text] of Object.entries(parsed.headlines || {})) {
          const idx = Number(idxStr) - 1
          const exp = sanitizeHeadlineEx(text)
          if (idx >= 0 && idx < nextHeadlines.length && exp.text && getEffectiveLength(exp.text) <= 30 && !exp.hardTruncated && !endsIncomplete(exp.text)
            && !earlierHeadlines.some(eh => computeSimilarity(exp.text, eh) >= HEADLINE_SIMILARITY_THRESHOLDS.moderate)) {
            nextHeadlines[idx] = exp.text
          }
        }
        const nextDescriptions = [...set.descriptions]
        for (const [idxStr, text] of Object.entries(parsed.descriptions || {})) {
          const idx = Number(idxStr) - 1
          const exp = sanitizeDescriptionEx(text)
          if (idx >= 0 && idx < nextDescriptions.length && exp.text && getEffectiveLength(exp.text) >= 70 && getEffectiveLength(exp.text) <= 90 && !exp.hardTruncated && !endsIncomplete(exp.text)
            && !earlierDescriptions.some(ed => computeSimilarity(exp.text, ed) >= DESCRIPTION_SIMILARITY_THRESHOLD)) {
            nextDescriptions[idx] = exp.text
          }
        }
        result[i] = { ...set, headlines: nextHeadlines, descriptions: nextDescriptions }
      } catch (err) {
        console.error(`[rsa:generateRSAAssets] cross-set duplication fix pass failed for set ${i}: ${err.message}`)
      }
    }
    return result
  }

  const seedHeadlines    = (existingSets || []).flatMap(s => s.headlines    || [])
  const seedDescriptions = (existingSets || []).flatMap(s => s.descriptions || [])
  const sets = []

  for (let i = 0; i < numSets; i++) {
    const usedHeadlines    = [...seedHeadlines,    ...sets.flatMap(s => s.headlines)]
    const usedDescriptions = [...seedDescriptions, ...sets.flatMap(s => s.descriptions)]
    const angleIdx = (existingSets || []).length + i // position across the WHOLE batch, not just this call
    let set
    try {
      set = await generateOneSet(angleIdx, usedHeadlines, usedDescriptions)
    } catch (err) {
      console.error(`[rsa:generateRSAAssets] set ${i} attempt 1 failed: ${err.message} — retrying once`)
      try {
        set = await generateOneSet(angleIdx, usedHeadlines, usedDescriptions)
      } catch (err2) {
        console.error(`[rsa:generateRSAAssets] set ${i} attempt 2 failed: ${err2.message} — giving up on this set`)
        set = { headlines: [], headlineTypes: [], descriptions: [] }
      }
    }
    if (set.descriptions.length > 0) set = await fixDescriptions(set)
    if (set.headlines.length > 0) set = await fixHeadlines(set)
    if (set.headlines.length > 0 && set.descriptions.length > 0) set = await fixExcellenceGaps(set)
    if (set.headlines.length > 0 && set.descriptions.length > 0) set = await fixConversionGaps(set)
    if (set.headlines.length > 0 && set.descriptions.length > 0) set = await fixUnnaturalPhrasing(set)
    const { descHardTruncated, headlineHardTruncated, ...cleanSet } = set
    sets.push(cleanSet)
  }

  const finalSets = await fixCrossSetDuplication(sets)

  return { sets: finalSets }
})

// ── Classify headline types for existing RSA ads ─────────────────────────────

ipcMain.handle('rsa:classifyHeadlineTypes', async (_e, { headlines, keywords, adGroupName }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const kwList = (keywords || [])
    .slice().sort((a, b) => (Number(b.impressions) || 0) - (Number(a.impressions) || 0))
    .slice(0, 20).map(k => k.text || k).join(', ')
  const hlList = (headlines || []).map((h, i) => `${i + 1}. "${h}"`).join('\n')

  const prompt =
    `Classify each Google Ads RSA headline into exactly one type. Return only JSON.\n\n` +
    `Ad Group: ${adGroupName || ''}\n` +
    `Keywords: ${kwList}\n\n` +
    `Headlines:\n${hlList}\n\n` +
    `Types (choose exactly one per headline):\n` +
    `- Keyword       : directly contains a keyword from the ad group\n` +
    `- CTA           : leads with an action verb — Call, Book, Schedule, Get, Request, Contact, Hire, Order, Try, Start, Find\n` +
    `- Trust         : credentials or proof — Licensed, Insured, Certified, Years Exp, Rated, Guaranteed, Family-Owned\n` +
    `- Urgency       : time-critical — Same-Day, 24/7, Emergency, Today, Available Now, Fast, Quick\n` +
    `- Benefit       : outcome or quality — Easy, Hassle-Free, Efficient, Simple, Professional, Reliable\n` +
    `- Location      : geo-targeted — city name, Near Me, Serving [area]\n` +
    `- Problem-Solution : addresses a pain point or poses a question\n\n` +
    `Return ONLY: {"types":["Type1","Type2",...]} with exactly ${headlines.length} entries in order.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw   = (message.content[0]?.text || '').trim()
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    const parsed = JSON.parse(match?.[0] || '{}')
    return { types: (parsed.types || []).slice(0, headlines.length) }
  } catch {
    return { types: [] }
  }
})

// ── Regenerate a single RSA headline or description ──────────────────────────

ipcMain.handle('rsa:regenerateSingleAsset', async (_e, {
  customerId,
  assetType,       // 'headline' | 'description'
  currentText,     // text being replaced
  index,           // position in the array (for context)
  adGroupName, businessName, tone,
  keywords, allHeadlines, allDescriptions, crossSetTexts, preventCrossover, siblingAdGroupNames,
  landingPageUrl,
}) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured.')
  const accountProfile = await resolveWebsiteProfile(customerId, landingPageUrl)
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const kwList   = (keywords || []).map(k => k.text || k).slice(0, 12).join(', ')
  const isHl     = assetType === 'headline'

  const othersHl    = (allHeadlines  || []).filter((_, i) => i !== index).map((t, i) => `  ${i+1}. "${t}"`).join('\n')
  const othersDs     = (allDescriptions || []).filter((_, i) => i !== index).map((t, i) => `  ${i+1}. "${t}"`).join('\n')
  const crossSetBlock = (crossSetTexts || []).length > 0
    ? `\nAlso already used in OTHER RSA sets for this ad group — avoid duplicating or closely rephrasing these too:\n${(crossSetTexts || []).map(t => `  - "${t}"`).join('\n')}\n`
    : ''

  function buildPrompt(retrying) {
    return (
      `You are a Google Ads RSA copywriter. Regenerate ONE ${isHl ? 'headline' : 'description'} that was flagged for a policy issue or needs improvement.\n\n` +
      `Ad Group: ${adGroupName || ''}\nBusiness: ${businessName || ''}\nTone: ${tone || 'Professional'}\nKeywords: ${kwList}\n\n` +
      `Current ${isHl ? 'headline' : 'description'} to REPLACE: "${currentText}"\n\n` +
      `CRITICAL HARD REQUIREMENT: The replacement MUST be substantively different from the current text above — different wording AND a different angle or message. Returning the same text, a trivial reword, or a near-duplicate is INVALID and will be rejected.\n\n` +
      (isHl
        ? `Other headlines already in the ad (avoid repeating their core words, and do NOT start the replacement with the same first word as any of these):\n${othersHl || '  (none)'}\n\n`
        : `Other descriptions already in the ad (this replacement must cover a clearly different angle/concept than every one of these — not just different wording of the same idea):\n${othersDs || '  (none)'}\n\n`) +
      crossSetBlock +
      RSA_POLICY_RULES + '\n' +
      buildAdvertiserContextBlock(accountProfile, null, adGroupName) +
      buildIntentLockBlock(adGroupName, siblingAdGroupNames, preventCrossover) +
      (isHl
        ? `HARD LIMIT: replacement headline MUST be 30 characters or fewer. Count every character including spaces. Must read as a finished phrase — never end on a connector like for/and/with/since/because/or/a/an/the/to/of/in/on/at/by, and never end on a bare qualifier that's obviously missing what comes next (e.g. "Available Today in South" or "Junk Removal Near" — both read as cut off mid-phrase).\n`
        : `HARD MINIMUM 70 characters — NEVER go below 70. TARGET 75–85 characters — do NOT write toward the 90 edge, real output consistently runs a few characters longer than planned. HARD MAX: 90 characters — going over is INVALID. Avoid comma-separated lists of 3+ items — they're the most common way a description quietly runs long; prefer one or two concrete items. Write a COMPLETE sentence that ends naturally. Never end on a word that clearly needs more after it — for, and, with, since, because, or, a, an, the, to, of, in, on, at, by. BAD: "...across South Florida for" GOOD: "Licensed and insured, we've proudly served South Florida businesses for over 15 years." Write for a BUYER ready to hire/book now, not a shopper still researching — lead with decision-tipping specifics and a clear next action, not vague browsing-stage language like "learn more" or "explore options".\n`) +
      (retrying ? `\nYour previous attempt was rejected for being too similar to the original or another existing asset, ending mid-sentence, too short, or otherwise invalid. Use a COMPLETELY different angle this time, and make sure it ends as a finished thought.\n` : '') +
      `\nDo not show your work — no explanation, no markdown code fences. Output ONLY the raw JSON object and nothing else.\n\n` +
      `Return ONLY valid JSON: {"text":"replacement text"}`
    )
  }

  function isSameText(a, b) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    return norm(a) === norm(b)
  }

  // Word-overlap similarity against sibling assets already in the ad — the
  // per-item regenerate prompt above already ASKS for a different angle, but
  // nothing enforced it, so a "regenerated" description could still land
  // very close to one of the other 3. Treat >55% shared significant-word
  // overlap with any sibling as too similar and retry, same as an exact dupe.
  function significantWords(s) {
    return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3))
  }
  function similarityRatio(a, b) {
    const wa = significantWords(a), wb = significantWords(b)
    if (wa.size === 0 || wb.size === 0) return 0
    const shared = [...wa].filter(w => wb.has(w)).length
    return shared / Math.min(wa.size, wb.size)
  }
  // Keyword-derived words are excluded from a SECOND, narrower check used
  // only for headlines — the generation prompt deliberately puts the primary
  // keyword theme in multiple headlines (2-3 of them, by design), so two
  // headlines legitimately sharing just a keyword phrase (e.g. "Junk
  // Removal") while making otherwise different points were hitting the
  // ratio above on keyword overlap alone, exhausting all retries and
  // surfacing as "AI kept returning a near-duplicate" even when the AI's
  // replacement was fine. Requiring the overlap to also include at least one
  // NON-keyword word keeps real near-duplicates ("Affordable Junk Removal
  // Service" vs "Professional Junk Removal Service" — same keyword AND same
  // trailing word) caught, while clearing keyword-only overlap.
  const keywordTokens = new Set(
    (keywords || []).flatMap(k => String(k?.text || k || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3))
  )
  function hasNonKeywordOverlap(a, b) {
    const nonKw = s => [...significantWords(s)].filter(w => !keywordTokens.has(w))
    const wb = new Set(nonKw(b))
    return nonKw(a).some(w => wb.has(w))
  }
  const siblings = isHl ? (allHeadlines || []) : (allDescriptions || [])
  function tooSimilarToSibling(text) {
    return siblings.some((t, i) => {
      if (i === index || !t) return false
      if (similarityRatio(text, t) <= 0.55) return false
      return isHl ? hasNonKeywordOverlap(text, t) : true
    })
  }
  // Headlines only — the prompt asks for a varied opening word, but nothing
  // enforced it, so a "regenerated" headline could still open with the same
  // first word as a sibling already in the ad even while making a genuinely
  // different point. Catch that mechanically rather than trusting the prompt alone.
  function firstWord(s) {
    return String(s || '').trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || ''
  }
  function sameFirstWordAsSibling(text) {
    if (!isHl) return false
    const fw = firstWord(text)
    if (!fw) return false
    return siblings.some((t, i) => i !== index && t && firstWord(t) === fw)
  }

  let lastText = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 350,
        messages: [{ role: 'user', content: buildPrompt(attempt > 0) }],
      })
      const raw   = message.content[0]?.text || '{}'
      const match = raw.match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(match?.[0] || '{}')
      const ex      = isHl ? sanitizeHeadlineEx(parsed.text || '') : sanitizeDescriptionEx(parsed.text || '')
      const text    = ex.text
      const tooShort      = !isHl && getEffectiveLength(text) < 70
      const incomplete    = endsIncomplete(text)
      const wasHardCut    = ex.hardTruncated
      const tooSimilar    = tooSimilarToSibling(text)
      const dupeFirstWord = sameFirstWordAsSibling(text)
      if (text && !tooShort && !incomplete && !wasHardCut && !tooSimilar && !dupeFirstWord && !isSameText(text, currentText)) return { text }
      lastText = text
    } catch { /* retry */ }
  }

  throw new Error(lastText
    ? 'AI kept returning a near-duplicate of another asset or an incomplete sentence after 4 attempts. Please try again.'
    : 'AI did not return a valid replacement after 4 attempts. Please try again.')
})

// ── Refresh all 4 descriptions as a coordinated set ───────────────────────────
// Unlike rsa:regenerateSingleAsset (one description in isolation), this looks
// at all headlines, keywords, landing page, and the current descriptions
// together, then writes a fresh set of 4 where each has a distinct assigned
// purpose (service/keyword relevance, benefits, trust/advantage, CTA) instead
// of independently-regenerated items that might overlap in angle.
ipcMain.handle('rsa:refreshAllDescriptions', async (_e, {
  customerId, adGroupName, businessName, tone, keywords, headlines, landingPage,
  existingDescriptions, crossSetTexts, preventCrossover, siblingAdGroupNames,
}) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const accountProfile = await resolveWebsiteProfile(customerId, landingPage?.url)
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const sortedKw = (keywords || []).slice().sort((a, b) => (Number(b.impressions) || 0) - (Number(a.impressions) || 0)).slice(0, 12)
  const kwList   = sortedKw.map(k => k.text || k).join(', ')
  const hlList   = (headlines || []).map((h, i) => `  ${i + 1}. "${h}"`).join('\n')

  const lpLines = landingPage && !landingPage.error ? [
    landingPage.title                    && `Title: ${landingPage.title}`,
    landingPage.h1                       && `H1: ${landingPage.h1}`,
    landingPage.h2s?.length > 0          && `H2s: ${landingPage.h2s.slice(0, 4).join(' | ')}`,
    landingPage.ctas?.length > 0         && `CTAs on page: ${landingPage.ctas.join(', ')}`,
    landingPage.trustSignals?.length > 0 && `Trust signals: ${landingPage.trustSignals.join(', ')}`,
  ].filter(Boolean).join('\n') : 'No landing page data'

  const existingBlock = (existingDescriptions || []).length > 0
    ? `\nCURRENT descriptions being replaced (reference only — write a fresh, better-coordinated set, don't just edit these):\n${existingDescriptions.map((d, i) => `  ${i + 1}. "${d}"`).join('\n')}\n`
    : ''
  const crossSetBlock = (crossSetTexts || []).length > 0
    ? `\nAlready used in OTHER RSA sets for this ad group — do not repeat or closely rephrase any of these:\n${crossSetTexts.map(t => `  - "${t}"`).join('\n')}\n`
    : ''

  const prompt =
    `You are a world-class Google Ads RSA copywriter. Analyze the headlines, keywords, and landing page below TOGETHER, then write a fully coordinated set of 4 descriptions — each a complete, natural sentence.\n\n` +
    `Ad Group: ${adGroupName || ''}\nBusiness: ${businessName || ''}\nTone: ${tone || 'Professional'}\n\n` +
    `HEADLINES ALREADY IN THIS AD (source of the primary service/location/target keyword terms — pull naturally from these, don't invent unrelated terms):\n${hlList || '  (none)'}\n\n` +
    `KEYWORDS: ${kwList}\n\n` +
    `LANDING PAGE:\n${lpLines}\n` +
    existingBlock + crossSetBlock +
    `\nWrite exactly 4 descriptions, each with a DIFFERENT assigned purpose:\n` +
    `  1. SERVICE & KEYWORD RELEVANCE — works in the primary service/location/target keyword terms drawn from the headlines above.\n` +
    `  2. CUSTOMER BENEFITS — what the customer gets or gains, in outcome-focused language.\n` +
    `  3. TRUST OR COMPETITIVE ADVANTAGE — credentials, guarantees, experience, or what sets this business apart.\n` +
    `  4. STRONG CALL TO ACTION — a clear, direct next step (book, call, request, schedule).\n\n` +
    `KEYWORD DISTRIBUTION — NOT FORCED INTO EVERY DESCRIPTION: only description #1 needs to explicitly carry a keyword/service/location term. The other 3 stay focused on their own purpose (benefit, trust, CTA) without straining to also fit in a keyword — forcing a keyword into every description produces repetitive, unnatural copy. Natural overlap elsewhere is fine, just don't force it.\n\n` +
    `UNIQUENESS: no two descriptions may share more than 2 significant words (4+ letters), and no two may open with the same first word or phrase — they must read like 4 genuinely different ads, not 4 rewordings of the same sentence.\n\n` +
    `LENGTH: HARD MINIMUM 70 characters, HARD MAX 90 characters — going over is INVALID. TARGET 75–85 characters, do NOT write toward the 90 edge since real output consistently runs a few characters longer than planned.\n\n` +
    `SENTENCE COMPLETENESS (HARD RULE): every description MUST be a complete, grammatically finished sentence or clause. NEVER end on a word that clearly needs more after it — for, and, with, since, because, or, a, an, the, to, of, in, on, at, by, or any other connector/article. Avoid comma-separated lists of 3+ items — they're the most common way a description quietly runs long; prefer one or two concrete items. Before finalizing each one, count its exact character length and check its last word — if it's over 85 characters or the sentence would obviously continue past that word, rewrite it shorter from scratch so it actually finishes within the limit instead of getting cut off mid-thought.\n\n` +
    `Write for BUYERS ready to hire/book NOW, not shoppers still researching — lead with concrete, decision-tipping specifics and a clear next action. Avoid vague browsing-stage language like "learn more" or "explore options".\n\n` +
    RSA_POLICY_RULES + '\n' +
    buildAdvertiserContextBlock(accountProfile, null, adGroupName) +
    buildIntentLockBlock(adGroupName, siblingAdGroupNames, preventCrossover) +
    `\nReturn ONLY valid JSON, no markdown:\n` +
    `{"descriptions":["d1 — service & keyword relevance","d2 — customer benefits","d3 — trust or competitive advantage","d4 — strong call to action"]}`

  async function generate() {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw   = message.content[0]?.text || ''
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error(`No JSON object in response (stop_reason=${message.stop_reason})`)
    const parsed = JSON.parse(match[0])
    return (parsed.descriptions || []).slice(0, 4).map(d => sanitizeDescriptionEx(d))
  }

  let descExp
  try {
    descExp = await generate()
  } catch (err) {
    console.error('[rsa:refreshAllDescriptions] attempt 1 failed:', err.message, '— retrying once')
    descExp = await generate()
  }
  if (descExp.length < 4) throw new Error('AI did not return 4 descriptions. Please try again.')

  const descriptions = await reviseWeakDescriptions(anthropic, {
    adGroupName, kwHint: sortedKw.slice(0, 5).map(k => k.text || k).join(', '),
    descriptions: descExp.map(x => x.text), hardTruncated: descExp.map(x => x.hardTruncated),
  })

  return { descriptions }
})

// ── RSA Keyword Suggestions ────────────────────────────────────────────────────

ipcMain.handle('rsa:suggestKeywords', async (_e, { adGroupName, campaignName, keywords, landingPage }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const existingKwList = (keywords || [])
    .slice().sort((a, b) => (Number(b.impressions) || 0) - (Number(a.impressions) || 0))
    .slice(0, 20).map(k => `  • ${k.text || k} [${k.matchType || 'Broad'}]`).join('\n') || '  (none)'

  const lpLines = landingPage && !landingPage.error ? [
    landingPage.title           && `Title: ${landingPage.title}`,
    landingPage.h1              && `H1: ${landingPage.h1}`,
    landingPage.h2s?.length > 0 && `H2s: ${landingPage.h2s.slice(0, 5).join(' | ')}`,
    landingPage.ctas?.length > 0 && `CTAs: ${landingPage.ctas.join(', ')}`,
    landingPage.metaDescription && `Meta: ${landingPage.metaDescription}`,
  ].filter(Boolean).join('\n') : 'No landing page data'

  const prompt =
    `You are a senior Google Ads keyword research specialist. Generate 12–15 NEW keyword suggestions for the RSA ad group below.\n\n` +
    `AD GROUP: ${adGroupName || ''}\n` +
    `CAMPAIGN: ${campaignName || ''}\n\n` +
    `EXISTING KEYWORDS (do NOT duplicate these):\n${existingKwList}\n\n` +
    `LANDING PAGE:\n${lpLines}\n\n` +
    `REQUIREMENTS:\n` +
    `- Generate keywords that complement the existing ones — no duplicates or near-duplicates\n` +
    `- MINIMUM 1,000 estimated monthly searches per keyword (Google Ads declines low-search-volume keywords)\n` +
    `- Focus ONLY on transactional, commercial, local, and emergency intent\n` +
    `- Mix of Exact and Phrase match types (avoid Broad unless high-confidence)\n` +
    `- Each keyword must be closely themed to the ad group — no off-topic suggestions\n` +
    `- Use keywords that align with the landing page content\n` +
    `- Do NOT include: informational, DIY, free, jobs, salary, how-to keywords\n\n` +
    `Return ONLY a raw JSON array (no markdown, no code fences, no explanation). Start your response with [ and end with ].\n\n` +
    `Example of ONE item:\n` +
    `{"keyword":"roof repair near me","matchType":"Exact","searchIntent":"Local Service","buyerStage":"Ready To Buy","estimatedMonthlySearches":"1,000–10,000","competition":"Medium","estimatedCpc":"$12–$18","estimatedSavings":"15–25% vs avg","conversionScore":82,"trafficPotential":"High Conversion","recommendedCampaign":"${campaignName || 'Main Campaign'}","adGroup":"${adGroupName || 'Main Ad Group'}","whyItConverts":"High local intent drives immediate service calls."}\n\n` +
    `Generate 12–15 keywords in this exact format. Output ONLY the JSON array.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = (message.content[0]?.text || '').trim()
  console.log('[rsa:suggestKeywords] raw response length:', raw.length)
  console.log('[rsa:suggestKeywords] raw preview:', raw.slice(0, 300))

  // Try to extract a JSON array — handles markdown fences and nested objects
  let parsed = []
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    // Try direct parse first
    try {
      const direct = JSON.parse(cleaned)
      parsed = Array.isArray(direct) ? direct : (direct.keywords || direct.suggestions || [])
    } catch {
      // Fall back to regex extraction
      const match = cleaned.match(/\[[\s\S]*\]/)
      if (match) parsed = JSON.parse(match[0])
    }
  } catch (e) {
    console.error('[rsa:suggestKeywords] parse error:', e.message)
    console.error('[rsa:suggestKeywords] raw was:', raw)
    return []
  }

  console.log('[rsa:suggestKeywords] parsed count:', parsed.length)

  return parsed.map(k => ({
    keyword:          k.keyword            || '',
    matchType:        k.matchType          || k.match_type || 'Broad',
    searchIntent:     k.searchIntent       || k.search_intent || '',
    buyerStage:       k.buyerStage         || k.buyer_stage || '',
    monthlySearches:  k.estimatedMonthlySearches || k.monthlySearches || k.monthly_searches || '',
    competition:      k.competition        || '',
    estimatedCpc:     k.estimatedCpc       || k.estimated_cpc || '',
    estimatedSavings: k.estimatedSavings   || k.estimated_savings || '',
    conversionScore:  k.conversionScore    ?? k.conversion_score ?? '',
    trafficPotential: k.trafficPotential   || k.traffic_potential || '',
    recommendedCampaign: k.recommendedCampaign || k.recommended_campaign || campaignName || '',
    adGroup:          k.adGroup            || k.recommended_ad_group || adGroupName || '',
    whyItConverts:    k.whyItConverts      || k.why_it_converts || '',
  }))
})

// ── RSA URL asset recommendations (Display Path + Sitelinks) ─────────────────

ipcMain.handle('rsa:recommendUrlAssets', async (_e, { url, landingPage, keywords, adGroupName }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const kwList = (keywords || [])
    .slice().sort((a, b) => (Number(b.impressions) || 0) - (Number(a.impressions) || 0))
    .slice(0, 20).map(k => k.text || k).join(', ')
  const lpLines = landingPage && !landingPage.error ? [
    landingPage.title            && `Title: ${landingPage.title}`,
    landingPage.h1               && `H1: ${landingPage.h1}`,
    landingPage.h2s?.length > 0  && `H2s: ${landingPage.h2s.slice(0, 6).join(' | ')}`,
    landingPage.ctas?.length > 0 && `CTAs: ${landingPage.ctas.join(', ')}`,
    landingPage.trustSignals?.length > 0 && `Trust: ${landingPage.trustSignals.join(', ')}`,
    landingPage.metaDescription  && `Meta: ${landingPage.metaDescription}`,
  ].filter(Boolean).join('\n') : 'No landing page data'

  // Extract base domain from the URL for constructing sitelink URLs
  let baseDomain = url
  try { const u = new URL(url); baseDomain = `${u.protocol}//${u.host}` } catch {}

  const prompt =
    `You are a Google Ads expert. Based on the landing page and ad group, generate URL asset recommendations.\n\n` +
    `Final URL: ${url}\n` +
    `Base domain: ${baseDomain}\n` +
    `Ad Group: ${adGroupName || ''}\n` +
    `Keywords: ${kwList}\n\n` +
    `Landing Page Content:\n${lpLines}\n\n` +
    `Generate:\n` +
    `1. Display URL paths — path1 and path2 shown after the domain (e.g. domain.com/path1/path2)\n` +
    `   - Each path MUST be 15 characters or fewer\n` +
    `   - Use keywords or service terms — title case, no spaces (use hyphens if needed)\n` +
    `   - path2 can be a location, service variant, or qualifier\n\n` +
    `2. 4–6 sitelink extensions that match the service and landing page\n` +
    `   CRITICAL RULES FOR SITELINKS:\n` +
    `   - headline: max 25 characters — a SHORT, specific page or service name\n` +
    `   - description1: max 35 characters — a COMPLETE short phrase. NEVER end on a preposition, verb, or article (e.g. NEVER end with "starts", "to", "for", "and", "the", "of"). BAD: "Easy online order form — starts". GOOD: "Easy online ordering available."\n` +
    `   - description2: max 35 characters — a second COMPLETE short phrase. Same rule — never end on a dangling word. REQUIRED — must not be blank.\n` +
    `   - url: EVERY sitelink MUST have a DIFFERENT absolute URL — each pointing to a different specific page on the site. Format: ${baseDomain}/page-name. NEVER use the same URL for two sitelinks. Use logical sub-pages like /services, /pricing, /about, /contact, /quote, /gallery, /faq, /order. If the site has specific service pages visible in the landing page content, use those paths.\n` +
    `   - Count characters before writing. If description1 or description2 is over 35 characters, shorten it.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"displayPath1":"string","displayPath2":"string","sitelinks":[{"headline":"string","description1":"string","description2":"string","url":"string"}]}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    const parsed = JSON.parse(match?.[0] || '{}')
    return {
      displayPath1: sanitizeDisplayPath(rsaHardLimit(parsed.displayPath1 || '', 15)),
      displayPath2: sanitizeDisplayPath(rsaHardLimit(parsed.displayPath2 || '', 15)),
      sitelinks: (parsed.sitelinks || []).slice(0, 6).map(s => ({
        headline:     rsaHardLimit(s.headline     || '', 25),
        description1: trimDangling(rsaHardLimit(s.description1 || s.description || '', 35)),
        description2: trimDangling(rsaHardLimit(s.description2 || '', 35)),
        url:          s.url || '',
      })),
    }
  } catch {
    return { displayPath1: '', displayPath2: '', sitelinks: [] }
  }
})

// Combines two things that need the same inputs — a weighted landing-page
// relevance score and section-aware H2 edit recommendations — into one AI
// call. Both depend on judgment a deterministic word-match can't honestly
// provide (does this section's actual content support this concept, is this
// edit natural English, would it read as keyword-stuffed) so both are
// delegated to the model rather than faked with brittle heuristics; the
// PRIORITY classification of missing concepts (HIGH/MEDIUM/LOW) is still
// computed deterministically on the frontend (detectLandingPageMismatch in
// rsaBuilderService.js — phrase-first, query-modifiers demoted) and handed
// in here as a pre-classified signal, not left for the model to re-derive.
ipcMain.handle('rsa:analyzeLandingPageRelevance', async (_e, { url, currentH2s, h2Sections, prioritized, alreadyEditedHeadings, adGroupName, campaignName, businessName }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const h2s = (currentH2s || []).filter(Boolean)
  if (h2s.length === 0) throw new Error('No existing H2s found on this page to analyze.')

  const sections = (h2Sections || []).filter(s => s?.heading)
  const sectionByHeading = new Map(sections.map(s => [s.heading, s.content || '']))
  const sectionList = h2s.map((h, i) => `${i + 1}. "${h}"\n   Content: "${(sectionByHeading.get(h) || '(no section content captured)').slice(0, 500)}"`).join('\n')

  const high   = (prioritized?.high   || []).map(o => o.text)
  const medium = (prioritized?.medium || []).map(o => o.text)
  const low    = (prioritized?.low    || []).map(o => o.text)
  if (high.length === 0 && medium.length === 0 && low.length === 0) throw new Error('No missing concepts to analyze — this page already covers the ad group theme well.')

  // On a re-run within the same session (before the user has re-fetched the
  // live page to confirm their edit landed), the H2 list handed in here is
  // otherwise identical to last time — nothing tells the model a heading was
  // already addressed, so it naturally proposes the same or a further edit
  // to the same "best fit" heading again instead of spreading remaining
  // concepts across the others. This list breaks that loop explicitly.
  const editedList = (alreadyEditedHeadings || []).filter(Boolean)
  const alreadyEditedBlock = editedList.length > 0
    ? `\nALREADY ADDRESSED IN A PREVIOUS PASS (assume the user has applied or is applying these) — do NOT recommend a further change to any of these same headings unless a clearly different, still-unaddressed concept specifically requires that exact section and no other section fits it at all:\n${editedList.map(h => `  - "${h}"`).join('\n')}\n`
    : ''

  const prompt =
    `You are an SEO/PPC content strategist helping a Google Ads advertiser improve landing-page relevance WITHOUT keyword stuffing.\n\n` +
    `Business: ${businessName || ''}\n` +
    `Ad Group: ${adGroupName || ''}\n` +
    `Campaign: ${campaignName || ''}\n` +
    `Page URL: ${url || ''}\n\n` +
    `PAGE SECTIONS (each existing H2 heading and the actual text beneath it, in order):\n${sectionList}\n` +
    alreadyEditedBlock + `\n` +
    `MISSING CONCEPTS BY PRIORITY (already classified — do not re-derive priority yourself):\n` +
    `HIGH PRIORITY (core service phrases or problem/search-intent terms — e.g. "hydro jetting", "clogged drain"):\n${high.length ? high.map(t => `  - ${t}`).join('\n') : '  (none)'}\n` +
    `MEDIUM PRIORITY (supporting service-object words — e.g. "pipe", "cleanout" — helpful for topical relevance but should not automatically trigger a heading change):\n${medium.length ? medium.map(t => `  - ${t}`).join('\n') : '  (none)'}\n` +
    `LOW PRIORITY (generic query modifiers — e.g. "near", "cheap", "best" — should almost never trigger a heading change on their own):\n${low.length ? low.map(t => `  - ${t}`).join('\n') : '  (none)'}\n\n` +
    `PART 1 — H2 RECOMMENDATIONS. There are ${h2s.length} sections listed above, numbered 1-${h2s.length}. GO THROUGH EVERY SINGLE ONE OF THEM, in order, and individually decide whether a light edit to its heading would genuinely improve relevance — do not evaluate only the 1-2 most obvious candidates and stop; check all ${h2s.length}. For each section, decide against the FULL list of HIGH and MEDIUM priority concepts above, following ALL of these rules:\n` +
    `1. Only recommend a change when a HIGH or MEDIUM priority missing concept is something that section's OWN CONTENT above already discusses or provides — never add a concept to a section that doesn't actually support it.\n` +
    `2. Never edit an unrelated section just to place a word somewhere (e.g. do not add "hydro" to "Why Choose Us" if that section never discusses hydro jetting) — find the section that's genuinely about it, or make no change at all.\n` +
    `3. Prefer a complete phrase over isolated fragments (e.g. add "Hydro Jetting" as one unit, don't scatter "hydro" into one heading and "jetting" into another).\n` +
    `4. Never invent or imply a claim the section/business info doesn't already establish — no price, guarantee, "24/7", "same-day", "cheap", "affordable", license, or similar unless it's already there.\n` +
    `5. LOW-priority query modifiers should almost never trigger a change by themselves — only flag one if the underlying concept is COMPLETELY absent from the whole page (e.g. recommend location language only if there is no service-area/location content anywhere on the page at all).\n` +
    `6. HARD LIMIT: each heading edit may address AT MOST 2 missing concepts — never 3 or more, even when they seem thematically related. "Professional Construction, Yard, and Jobsite Debris Removal" is a VIOLATION of this rule (3 concepts stacked into one heading) — pick at most the 2 most important ones for that heading and let the rest go to a DIFFERENT section instead (see rule 7), not a content opportunity, if another section also genuinely fits. Keep edits light: add or swap a word or short phrase, don't rewrite the whole heading.\n` +
    `7. COVERAGE IS THE GOAL, NOT MINIMALISM. There is no target number of changes and no preference for fewer edits — recommend a natural, well-supported edit for EVERY section that has one, even if that ends up being most or all of the ${h2s.length} sections. The only reasons to skip a section are: (a) none of the remaining uncovered concepts genuinely relate to what that section actually discusses, or (b) it's in the ALREADY ADDRESSED list above with nothing left over that specifically requires it. When multiple sections could each genuinely take a different concept, give each section its own edit rather than stacking multiple concepts onto whichever section seems most obviously related.\n` +
    `8. The result must read as natural English a real business would write — never keyword-stuffed.\n` +
    `9. If a HIGH-priority concept genuinely doesn't fit any existing section at all (or its only plausible section already hit the 2-concept limit and no other section fits either), don't force an edit — report it as a content opportunity instead (Part 1b).\n\n` +
    `Assign each recommendation one state: "CHANGE" (natural, well-supported, meaningfully improves relevance) or "CONSIDER" (plausible but lower-confidence). Only include headings where the state is CHANGE or CONSIDER — omit only the sections you'd genuinely leave as-is per rule 7's exceptions above.\n\n` +
    `PART 1b — CONTENT OPPORTUNITIES. List any HIGH-priority concept that doesn't fit naturally into any existing section, with a one-sentence reason (this means the page doesn't currently establish that service/concept at all, not just a wording gap).\n\n` +
    `PART 2 — LANDING PAGE RELEVANCE SCORE. Score this page's overall relevance to the ad group out of 100, using this rubric. Base each sub-score on the actual section content above and real semantic relevance — not on raw keyword counting:\n` +
    `- coreKeywordPhrase (0-30): do the page's core service phrases genuinely match the ad group's core service?\n` +
    `- searchIntentServiceCoverage (0-25): does the page clearly offer/discuss the specific services and problems this ad group targets?\n` +
    `- titleH1Relevance (0-15)\n` +
    `- h2Relevance (0-10)\n` +
    `- bodySemanticRelevance (0-10): does the body content, not just headings, genuinely discuss the ad group's topic?\n` +
    `- locationModifierRelevance (0-5): geographic/local relevance, if applicable to this ad group\n` +
    `- ctaOfferAlignment (0-5): does the page have a clear, relevant next step?\n\n` +
    `Return ONLY valid JSON, no markdown fences, no explanation before or after it:\n` +
    `{\n` +
    `  "relevance": {"total": 0-100, "grade": "Excellent|Good|Average|Poor", "breakdown": {\n` +
    `    "coreKeywordPhrase": {"score": N, "max": 30}, "searchIntentServiceCoverage": {"score": N, "max": 25},\n` +
    `    "titleH1Relevance": {"score": N, "max": 15}, "h2Relevance": {"score": N, "max": 10},\n` +
    `    "bodySemanticRelevance": {"score": N, "max": 10}, "locationModifierRelevance": {"score": N, "max": 5},\n` +
    `    "ctaOfferAlignment": {"score": N, "max": 5}\n` +
    `  }},\n` +
    `  "h2Updates": [{"current": "exact original heading text", "recommended": "edited heading text", "covers": ["concept1"], "priority": "HIGH|MEDIUM|LOW", "state": "CHANGE|CONSIDER", "reason": "one sentence"}],\n` +
    `  "contentOpportunities": [{"concept": "hydro jetting", "reason": "one sentence"}]\n` +
    `}\n` +
    `"current" must match one of the existing H2s above verbatim.`

  const message = await anthropic.messages.create({
    // Raised from 2500 — evaluating every section (not just the 1-2 most
    // obvious ones) can return a recommendation for most/all of a page's
    // headings plus their reasons, which needs more headroom than a
    // deliberately small 1-3-change response did.
    model: 'claude-sonnet-4-6', max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw   = message.content[0]?.text || ''
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No analysis returned — try again.')
  let parsed
  try { parsed = JSON.parse(match[0]) } catch { throw new Error('Could not parse analysis — try again.') }

  const h2Updates = (parsed.h2Updates || [])
    .filter(u => u?.current && u?.recommended && ['CHANGE', 'CONSIDER'].includes(u.state))
    .map(u => ({
      current:     String(u.current).trim(),
      recommended: String(u.recommended).trim(),
      covers:      Array.isArray(u.covers) ? u.covers.filter(Boolean).map(String) : [],
      priority:    ['HIGH', 'MEDIUM', 'LOW'].includes(u.priority) ? u.priority : 'MEDIUM',
      state:       u.state,
      reason:      String(u.reason || '').trim(),
    }))
    .filter(u => u.current !== u.recommended)

  const contentOpportunities = (parsed.contentOpportunities || [])
    .filter(c => c?.concept)
    .map(c => ({ concept: String(c.concept).trim(), reason: String(c.reason || '').trim() }))

  const rel = parsed.relevance || {}
  const relevance = {
    total: Number.isFinite(rel.total) ? Math.max(0, Math.min(100, Math.round(rel.total))) : null,
    grade: rel.grade || null,
    breakdown: rel.breakdown || null,
  }

  return { relevance, h2Updates, contentOpportunities }
})

// ── RSA Apply / Changelog / Rollback ─────────────────────────────────────────
// readChangelog/appendChangelog/patchChangelogEntry now live in ./changelog —
// shared with the Campaign Manager's campaign:* write handlers so both feature
// areas write into one "recent changes" timeline.

ipcMain.handle('rsa:apply', async (_e, {
  customerId, adGroupId, campaignId, adGroupName, campaignName,
  newHeadlines, newDescriptions, finalUrl,
  displayPath1, displayPath2, sitelinks,
  beforeAds, pauseAdIds,
}) => {
  const { client, settings } = await getClient()
  const applyResult = await applyRSAChanges(client, customerId, settings.mccCustomerId, {
    adGroupId, newHeadlines, newDescriptions, finalUrl,
    displayPath1: displayPath1 || '',
    displayPath2: displayPath2 || '',
    sitelinks:    Array.isArray(sitelinks) ? sitelinks : [],
    pauseAdIds:   Array.isArray(pauseAdIds) ? pauseAdIds : [],
  })
  const entry = {
    id:         makeChangelogId(),
    timestamp:  new Date().toISOString(),
    type:       'rsa',
    action:     'apply',
    customerId, campaignId, adGroupId, adGroupName, campaignName,
    before:     beforeAds || [],
    after:      applyResult.created,
    paused:     applyResult.paused,
    labeled:    applyResult.labeled,
    errors:     applyResult.errors,
    rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...applyResult, entryId: entry.id }
})

ipcMain.handle('rsa:getChangelog', async () => readChangelog())

ipcMain.handle('rsa:updateContents', async (_e, { customerId, adGroupId, adId, newHeadlines, newDescriptions, newFinalUrl, newPath1, newPath2 }) => {
  const { client, settings } = await getClient()
  return updateRSAContents(client, customerId, settings.mccCustomerId, { adGroupId, adId, newHeadlines, newDescriptions, newFinalUrl, newPath1, newPath2 })
})

// Genuinely edits an existing, already-published RSA's content in place
// (see updateExistingAdContent) — distinct from rsa:updateContents above,
// which (despite its name) creates a brand-new ad. Logs a changelog entry
// with a before/after snapshot so it shows in the RSA Change Log and can be
// rolled back via rsa:rollbackEditAd below.
ipcMain.handle('rsa:updateExistingAd', async (_e, {
  customerId, adGroupId, adId, campaignName, adGroupName,
  headlines, descriptions, finalUrl, path1, path2, before,
}) => {
  const { client, settings } = await getClient()
  const result = await updateExistingAdContent(client, customerId, settings.mccCustomerId, {
    adId, headlines, descriptions, finalUrl, path1, path2,
  })
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'rsaEdit', action: 'editAdContent',
    customerId, adGroupId, adGroupName, campaignName, adId,
    before, after: { headlines, descriptions, finalUrl, path1, path2 },
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('rsa:rollbackEditAd', async (_e, { entryId, customerId }) => {
  const entries = await readChangelog()
  const entry   = entries.find(e => e.id === entryId)
  if (!entry)           throw new Error('Change log entry not found')
  if (entry.type !== 'rsaEdit') throw new Error('This change log entry is not an RSA content edit.')
  if (entry.rolledBack) throw new Error('Already rolled back')

  const { client, settings } = await getClient()
  const result = await updateExistingAdContent(client, customerId, settings.mccCustomerId, {
    adId:         entry.adId,
    headlines:    entry.before?.headlines    || [],
    descriptions: entry.before?.descriptions || [],
    finalUrl:     entry.before?.finalUrl,
    path1:        entry.before?.path1,
    path2:        entry.before?.path2,
  })
  await patchChangelogEntry(entryId, { rolledBack: true, rollbackAt: new Date().toISOString(), rollbackErrors: [] })
  return result
})

ipcMain.handle('rsa:getAdGroupSitelinks', async (_e, { customerId, adGroupId }) => {
  const { client, settings } = await getClient()
  return fetchAdGroupSitelinks(client, customerId, settings.mccCustomerId, adGroupId)
})

ipcMain.handle('rsa:publishSingleSitelink', async (_e, { customerId, adGroupId, headline, description1, description2, url, finalUrl }) => {
  const { client, settings } = await getClient()
  return publishSingleSitelink(client, customerId, settings.mccCustomerId, { adGroupId, headline, description1, description2, url, finalUrl })
})

ipcMain.handle('rsa:editSitelinkAsset', async (_e, { customerId, resourceName, headline, description1, description2, url, finalUrl }) => {
  const { client, settings } = await getClient()
  return editSitelinkAsset(client, customerId, settings.mccCustomerId, { resourceName, headline, description1, description2, url, finalUrl })
})

ipcMain.handle('rsa:publishSitelinkToAccount', async (_e, { customerId, headline, description1, description2, url }) => {
  const { client, settings } = await getClient()
  return publishSitelinkToAccount(client, customerId, settings.mccCustomerId, { headline, description1, description2, url })
})

ipcMain.handle('rsa:publishSitelinkToCampaign', async (_e, { customerId, campaignId, headline, description1, description2, url }) => {
  const { client, settings } = await getClient()
  return publishSitelinkToCampaign(client, customerId, settings.mccCustomerId, { campaignId, headline, description1, description2, url })
})

ipcMain.handle('rsa:getAccountSitelinks', async (_e, { customerId }) => {
  const { client, settings } = await getClient()
  return fetchAccountSitelinks(client, customerId, settings.mccCustomerId)
})

ipcMain.handle('rsa:getCampaignSitelinks', async (_e, { customerId, campaignId }) => {
  const { client, settings } = await getClient()
  return fetchCampaignSitelinks(client, customerId, settings.mccCustomerId, campaignId)
})

// ── AI Sitelinks Builder — advanced generation with count + type + nav crawl ──

// Claude sometimes infers a plausible-looking path (e.g. /services) that
// doesn't actually exist on the site. Verify every generated URL resolves;
// swap any dead one for a page we already know is live — either one of the
// crawled nav pages or the main Final URL itself.
async function fixSitelinkUrls(sitelinks, { mainUrl, navPagesData, extraKnownUrls }) {
  const knownGood = [
    mainUrl,
    ...(navPagesData || []).filter(p => p && !p.error && p.url).map(p => p.url),
    ...(extraKnownUrls || []),
  ].filter(Boolean)

  let allowedHost = ''
  try { allowedHost = new URL(mainUrl).hostname } catch {}

  const liveChecks = await Promise.all(sitelinks.map(sl => checkUrlLive(sl.url, allowedHost)))

  const used = new Set(sitelinks.filter((_, i) => liveChecks[i]).map(sl => sl.url))
  const pool = knownGood.filter(u => !used.has(u))

  return sitelinks.map((sl, i) => {
    if (liveChecks[i]) return sl
    const replacement = pool.length > 0 ? pool.shift() : mainUrl
    used.add(replacement)
    return { ...sl, url: replacement }
  })
}

ipcMain.handle('rsa:generateSitelinksAI', async (_e, { customerId, url, keywords, adGroupName, campaignName, count, sitelinkType, preventCrossover, siblingAdGroupNames, existingLive, adGroupLevel }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const accountProfile = await resolveWebsiteProfile(customerId, url)
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  let baseDomain = url
  try { const u = new URL(url); baseDomain = `${u.protocol}//${u.host}` } catch {}

  // Crawl the main page + discover every real page via sitemap.xml (far more
  // reliable than guessing common paths like /about or /services) AND the
  // page's own nav/header menu — the menu is often a better signal of what
  // the business actually wants highlighted (curated by the site owner),
  // and on single-page/parallax sites it's the ONLY source of distinct
  // "pages" at all, since sitemap.xml there typically lists just the one
  // root URL. Nav #hash links to a different section of this SAME page
  // (isSameSection) can't appear in a sitemap by definition.
  const mainPageData = await analyzeLandingPage(url).catch(() => null)
  const sitemapUrls   = await fetchSitemapUrls(url).catch(() => [])
  const navLinks       = mainPageData?.navLinks || []
  const sameSectionLinks = navLinks.filter(l => l.isSameSection)
  const navPageUrls      = [...new Set(navLinks.filter(l => !l.isSameSection).map(l => l.url))]
  const navTextByUrl     = new Map(navLinks.map(l => [l.url, l.text]))

  // Nav-menu pages are curated by the site owner — crawl those first, then
  // fill remaining slots from the sitemap.
  const sitemapOnlyUrls = sitemapUrls.filter(u => u !== url && !navPageUrls.includes(u))
  const navCandidates    = [...navPageUrls.filter(u => u !== url), ...sitemapOnlyUrls].slice(0, 15)
  const navPagesData     = (await Promise.all(
    navCandidates.map(u => analyzeLandingPage(u).catch(() => null))
  )).filter(p => p && !p.error && p.title)

  const kwList = (keywords || [])
    .slice().sort((a, b) => (Number(b.impressions) || 0) - (Number(a.impressions) || 0))
    .slice(0, 20).map(k => k.text || k).join(', ')

  const mainLines = mainPageData && !mainPageData.error ? [
    mainPageData.title           && `Title: ${mainPageData.title}`,
    mainPageData.h1              && `H1: ${mainPageData.h1}`,
    mainPageData.h2s?.length > 0 && `H2s: ${mainPageData.h2s.slice(0, 8).join(' | ')}`,
    mainPageData.ctas?.length > 0 && `CTAs: ${mainPageData.ctas.join(', ')}`,
    mainPageData.trustSignals?.length > 0 && `Trust Signals: ${mainPageData.trustSignals.join(', ')}`,
    mainPageData.metaDescription && `Meta: ${mainPageData.metaDescription}`,
  ].filter(Boolean).join('\n') : 'No main page data available'

  // PRIORITIZED — distinct sections of the Final URL's own page, surfaced by
  // its own nav menu via a #hash link. These make excellent, highly relevant
  // sitelinks (especially for single-page sites) and can never come from a
  // sitemap, so they're listed ahead of everything else.
  const sameSectionLines = sameSectionLinks.length
    ? `\nPRIORITY — distinct sections of this same page, found in its own nav menu (use these first when relevant to the sitelink type):\n${sameSectionLinks.map(l => `  - ${l.url}: "${l.text}"`).join('\n')}\n`
    : ''

  const navLines = navPagesData.slice(0, 15).map(p =>
    `  - ${p.url}: "${p.title || ''}" — ${p.h1 || ''}${navTextByUrl.has(p.url) ? ` (nav menu label: "${navTextByUrl.get(p.url)}")` : ''}`
  ).join('\n')

  // Any sitemap/nav URL we didn't crawl for context is still a real page —
  // offer it as an additional pick list so the AI isn't limited to 15 pages.
  const extraSitemapUrls = [...new Set([...navPageUrls, ...sitemapUrls])].filter(u => u !== url && !navPagesData.some(p => p.url === u)).slice(0, 25)
  const extraLines = extraSitemapUrls.length ? `\nAdditional real pages from the nav menu / sitemap.xml (no preview, but confirmed to exist):\n${extraSitemapUrls.map(u => `  - ${u}${navTextByUrl.has(u) ? ` (nav menu label: "${navTextByUrl.get(u)}")` : ''}`).join('\n')}\n` : ''

  const existingLiveLines = (existingLive || []).filter(s => s?.headline).map(s => `  - "${s.headline}"${s.url ? ` → ${s.url}` : ''}`).join('\n')

  const typeGuides = {
    'Mixed':
      `Generate a balanced mix of service-specific destinations and useful general navigation, where available. Aim for approximately half service-specific sitelinks and half useful navigation such as About, Contact, Reviews, Financing, or FAQs. Do not force this ratio if the website does not support it.`,
    'Service Based':
      `Generate sitelinks focused exclusively on distinct, relevant services, procedures, or products actually offered by the advertiser. Prefer dedicated service pages. Do not use generic navigation unless no suitable service destinations exist and a useful fallback is explicitly justified.`,
    'Conversion Focused':
      `Prioritize relevant conversion destinations and action-oriented messaging, such as requesting an estimate, scheduling an appointment, booking a consultation, or contacting the business. Only use offers and actions supported by the available context and actual destination.`,
    'Informational':
      `Prioritize destinations that help users evaluate the advertiser or understand its offerings, such as reviews, the team, FAQs, how it works, financing, service details, or why to choose the business. Use informational descriptions with appropriate action language rather than forcing aggressive sales CTAs.`,
  }

  const prompt =
    `You are a Google Ads specialist focused on generating relevant, high-quality sitelink assets for agencies managing multiple advertisers and local service businesses.\n\n` +
    `Your objective is to generate up to ${count} distinct, useful, accurate sitelink assets that match the campaign, ad group intent, advertiser's actual offerings, and confirmed website destinations.\n\n` +
    `Prioritize relevance, destination accuracy, variety, conversion value, and compliance over quantity. Generate fewer than ${count} sitelinks whenever there are insufficient distinct, genuinely useful destinations. Never invent content or destinations to reach the requested count.\n\n` +
    `CAMPAIGN CONTEXT\n\n` +
    `Campaign: ${campaignName || 'Not specified'}\n` +
    `Ad Group: ${adGroupName || 'Not specified'}\n` +
    `Final URL: ${url}\n` +
    `Base Domain: ${baseDomain}\n` +
    `Target Keywords: ${kwList || 'Not provided'}\n\n` +
    `LANDING PAGE CONTENT\n\n` +
    `${mainLines}\n\n` +
    (sameSectionLinks.length
      ? `PRIORITY 1 — CONFIRMED SAME-PAGE SECTION DESTINATIONS\n\n` +
        `Use distinct, meaningful sections discovered in the navigation menu of the current landing page when they are relevant to the sitelink type. Prefer these over generic destinations when both serve the user's intent equally well.\n\n` +
        `${sameSectionLinks.map(l => `  - ${l.url}: "${l.text}"`).join('\n')}\n\n` +
        `Rules:\n` +
        `- Use only the exact section URLs provided.\n` +
        `- Do not invent hash fragments or assume that an anchor exists.\n` +
        `- Treat different confirmed, meaningful section fragments as distinct destinations.\n` +
        `- Do not generate multiple sitelinks to the same exact URL.\n\n`
      : '') +
    (navLines
      ? `PRIORITY 2 — DISCOVERED WEBSITE PAGES\n\n` +
        `Discovered Site Pages (from the navigation menu and sitemap.xml):\n\n` +
        `${navLines}\n\n` +
        `Up to 15 pages are included, with navigation-menu pages crawled first and sitemap pages filling the remaining slots.\n\n`
      : '') +
    (extraLines
      ? `PRIORITY 3 — ADDITIONAL CONFIRMED WEBSITE PAGES\n\n` +
        `Additional real pages from the navigation menu or sitemap.xml (confirmed to exist, but not crawled):\n\n` +
        `${extraSitemapUrls.map(u => `  - ${u}${navTextByUrl.has(u) ? ` (nav menu label: "${navTextByUrl.get(u)}")` : ''}`).join('\n')}\n\n` +
        `Up to 25 additional URLs may be included.\n\n`
      : '') +
    ((navLines || extraLines)
      ? `Rules:\n` +
        `- Prefer crawled pages with verified titles and content over uncrawled pages.\n` +
        `- Uncrawled pages may be used when their URL and existence are confirmed and the page is relevant based on its URL or navigation label.\n` +
        `- Do not invent page titles, services, features, offers, or content for uncrawled pages.\n` +
        `- Never claim that an uncrawled page contains a particular offer or feature unless that information is explicitly available.\n\n`
      : '') +
    `SITELINK TYPE\n\n${sitelinkType || 'Mixed'}\n\n` +
    `STRATEGY\n\n${typeGuides[sitelinkType] || typeGuides['Mixed']}\n\n` +
    (existingLiveLines
      ? `EXISTING GOOGLE ADS SITELINKS\n\n` +
        `Sitelinks that already exist and may show with these ads, including applicable account-level, campaign-level, and ad-group-level assets:\n\n` +
        `${existingLiveLines}\n\n` +
        `Rules:\n` +
        `- Do not duplicate an existing sitelink's headline or exact destination URL.\n` +
        `- Do not generate superficial variations of existing sitelinks.\n` +
        `- Avoid close conceptual duplicates, including different headlines that communicate essentially the same destination and purpose.\n` +
        `- Existing sitelinks are excluded from the output, not counted toward the requested number of newly generated sitelinks.\n\n`
      : '') +
    buildSitelinkAdvertiserBlock(accountProfile) +
    buildSitelinkIntentLockBlock(adGroupName, siblingAdGroupNames, preventCrossover, adGroupLevel) +
    '\n' + SITELINK_POLICY_RULES + '\n' +
    `CANDIDATE SELECTION AND PRIORITIZATION\n\n` +
    `Before producing the final JSON, internally identify and rank suitable candidate destinations.\n\n` +
    `Prioritize candidates in this order:\n\n` +
    `1. Strong match to the current ad group's intent and target keywords.\n` +
    `2. Accurate match between the sitelink message and the destination.\n` +
    `3. High user value, such as a relevant service page, booking page, contact page, or useful information.\n` +
    `4. Complementarity with existing sitelinks and other selected candidates.\n` +
    `5. Diversity of destination purpose and messaging.\n` +
    `6. Conversion usefulness appropriate to the selected sitelink strategy.\n\n` +
    `Do not include a candidate solely to reach the requested count.\n\n` +
    `Avoid selecting multiple destinations that provide substantially the same information when more useful alternatives exist.\n\n` +
    `STRICT OUTPUT RULES\n\n` +
    `1. NUMBER OF SITELINKS\n` +
    `   Generate up to ${count} sitelinks.\n` +
    `   Return fewer only when there are insufficient distinct, genuinely relevant, confirmed destinations.\n` +
    `   Never fabricate pages or pad the output with weak candidates.\n\n` +
    `2. HEADLINE\n` +
    `   - Maximum 25 characters.\n` +
    `   - Use a concise, descriptive label.\n` +
    `   - Count every character, including spaces and punctuation.\n` +
    `   - Do not use a headline that misrepresents the destination.\n\n` +
    `3. DESCRIPTION 1\n` +
    `   - Maximum 35 characters.\n` +
    `   - Describe the actual destination, service, or information clearly.\n` +
    `   - Use a complete, natural phrase.\n` +
    `   - Avoid dangling endings such as "for", "and", "the", "to", "of", "a", "an", "with", "your", or "our".\n\n` +
    `4. DESCRIPTION 2\n` +
    `   - Maximum 35 characters.\n` +
    `   - Provide a relevant next step or action-oriented phrase.\n` +
    `   - Match the action to the destination and selected strategy.\n` +
    `   - Examples include "Request an Estimate", "Explore Our Services", "Read Customer Reviews", "Learn About Our Team", and "Book a Consultation".\n` +
    `   - Do not force a sales-oriented CTA on informational destinations.\n` +
    `   - Never imply that a booking, free consultation, quote, discount, or other offer exists unless supported by the available context.\n` +
    `   - Avoid dangling endings.\n\n` +
    `5. URL VALIDITY\n` +
    `   - Use only URLs provided in the PRIORITY, DISCOVERED WEBSITE PAGES, or ADDITIONAL CONFIRMED WEBSITE PAGES sections.\n` +
    `   - Use the exact confirmed absolute URL. Do not invent, rewrite, or guess paths, query parameters, or hash fragments.\n` +
    `   - Prefer a meaningful, confirmed same-page section URL over a generic page when both meet the user's needs equally well.\n` +
    `   - Every output sitelink must have a distinct exact URL.\n` +
    `   - Different paths may represent different destinations.\n` +
    `   - Different hash fragments may represent distinct destinations only when those fragments were explicitly discovered and identify meaningful sections.\n` +
    `   - Never generate two sitelinks with the same exact destination URL.\n` +
    `   - Never reuse the same destination under different headlines.\n` +
    `   - Do not assume two different URLs are genuinely different destinations when they are merely tracking variants or equivalent aliases, if that equivalence is known.\n\n` +
    `6. UNIQUENESS\n` +
    `   - No duplicate headlines.\n` +
    `   - No duplicate exact URLs.\n` +
    `   - No duplicate concepts or superficial headline variations.\n` +
    `   - Avoid repetitive CTAs and descriptions.\n` +
    `   - Each sitelink must provide distinct value to the user.\n\n` +
    `7. EXISTING ASSET DEDUPLICATION\n` +
    `   When existing sitelinks are supplied:\n` +
    `   - Do not duplicate their headlines or exact URLs.\n` +
    `   - Avoid close semantic variations.\n` +
    `   - Prioritize destinations that add genuinely new value.\n` +
    `   - Do not claim that an asset is absent from Google Ads beyond the supplied existing-asset data.\n\n` +
    `8. DESTINATION RELEVANCE\n` +
    `   - Match each sitelink to a confirmed page or section that supports its purpose.\n` +
    `   - Prefer crawled, content-verified destinations over uncrawled destinations.\n` +
    `   - Never infer detailed page content from a URL alone.\n` +
    `   - Use uncrawled pages conservatively when their navigation label or URL provides sufficient evidence of relevance.\n` +
    `   - Omit uncertain or unsupported candidates.\n\n` +
    `9. CHARACTER LIMITS\n` +
    `   - Headline: 25 characters maximum.\n` +
    `   - Description 1: 35 characters maximum.\n` +
    `   - Description 2: 35 characters maximum.\n` +
    `   - Count characters accurately.\n` +
    `   - Never intentionally exceed these limits.\n` +
    `   - Application-side validation should be treated as the final authority for character counts.\n\n` +
    `10. SHORTFALL REASON\n` +
    `   If fewer than ${count} sitelinks are returned, include "shortfallReason" with a brief, specific explanation.\n` +
    `   Example: "Only 5 distinct, relevant confirmed destinations were available."\n` +
    `   Omit "shortfallReason" entirely when all ${count} sitelinks are generated.\n\n` +
    `FINAL INTERNAL VALIDATION\n\n` +
    `Before returning the response, verify that:\n` +
    `- Every sitelink is relevant to the advertiser and current ad group.\n` +
    `- All URLs originate from the supplied confirmed destination lists.\n` +
    `- No existing sitelink is duplicated.\n` +
    `- Headlines and descriptions are within their character limits.\n` +
    `- Descriptions are natural, accurate, and appropriate to the selected strategy.\n` +
    `- No unsupported claims, offers, or features are introduced.\n` +
    `- URLs and concepts are sufficiently distinct.\n` +
    `- The number of sitelinks and shortfall reason are consistent.\n` +
    `- The output is valid JSON with the required fields and no additional properties.\n\n` +
    `If a candidate fails validation, correct it or exclude it. Do not invent missing facts to repair a candidate.\n\n` +
    `OUTPUT FORMAT\n\n` +
    `Return ONLY valid JSON. Do not include Markdown, explanations, comments, or code fences.\n\n` +
    `When all ${count} sitelinks are generated:\n\n` +
    `{"sitelinks":[{"headline":"string","description1":"string","description2":"string","url":"string"}]}\n\n` +
    `When fewer than ${count} sitelinks are generated:\n\n` +
    `{"sitelinks":[{"headline":"string","description1":"string","description2":"string","url":"string"}],"shortfallReason":"Specific explanation"}\n\n` +
    `Return the JSON object only. Ensure all strings are properly escaped and the response can be parsed directly by a standard JSON parser.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 2400,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    const parsed = JSON.parse(match?.[0] || '{}')
    const rawSitelinks = (parsed.sitelinks || []).slice(0, count).map(s => ({
      headline:     rsaHardLimit(s.headline     || '', 25),
      description1: trimDangling(rsaHardLimit(s.description1 || '', 35)),
      description2: trimDangling(rsaHardLimit(s.description2 || '', 35)),
      url:          s.url || '',
    }))
    const sitelinks = await fixSitelinkUrls(rawSitelinks, { mainUrl: url, navPagesData, extraKnownUrls: [...sameSectionLinks.map(l => l.url), ...sitemapUrls, ...navPageUrls] })
    const shortfallReason = sitelinks.length < count ? (parsed.shortfallReason || `Only ${sitelinks.length} distinct, relevant confirmed destinations were available.`) : null
    return { sitelinks, shortfallReason }
  } catch {
    return { sitelinks: [] }
  }
})

ipcMain.handle('rsa:regenerateSingleSitelink', async (_e, { customerId, url, baseDomain, adGroupName, campaignName, keywords, existingSitelinks, index, sitelinkType, preventCrossover, siblingAdGroupNames, existingLive }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured.')
  const accountProfile = await resolveWebsiteProfile(customerId, url)
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const usedUrls = new Set([
    ...(existingSitelinks || []).filter((_, i) => i !== index).map(sl => sl.url),
    ...(existingLive || []).map(sl => sl.url).filter(Boolean),
  ])
  const [sitemapUrls, mainPageData] = await Promise.all([
    fetchSitemapUrls(url).catch(() => []),
    analyzeLandingPage(url).catch(() => null),
  ])
  // Same-page nav #hash links first (can't come from a sitemap, and are
  // curated by the site's own menu — see extractNavLinks in
  // landingPageFetcher.js), then other nav-menu pages, then the sitemap.
  const navLinks         = mainPageData?.navLinks || []
  const sameSectionUrls  = navLinks.filter(l => l.isSameSection).map(l => l.url)
  const navPageUrls      = navLinks.filter(l => !l.isSameSection).map(l => l.url)
  const candidateUrls = [...new Set([url, ...sameSectionUrls, ...navPageUrls, ...sitemapUrls])].filter(u => u && !usedUrls.has(u))

  const existing = [
    ...(existingSitelinks || []).filter((_, i) => i !== index).map(sl => `  - "${sl.headline}" → ${sl.url}`),
    ...(existingLive || []).filter(sl => sl?.headline).map(sl => `  - "${sl.headline}"${sl.url ? ` → ${sl.url}` : ''} (already live in Google Ads)`),
  ].join('\n')
  const kwList = (keywords || []).slice(0, 10).map(k => k.text || k).join(', ')

  const typeGuides = {
    'Mixed':              'Generate a relevant sitelink for either a specific service or a useful generic navigation page.',
    'Service Based':      'Generate a sitelink focused on a specific service, procedure, or product.',
    'Conversion Focused': 'Generate a sitelink with a strong CTA (e.g. Free Consultation, Book Now, Get a Quote).',
    'Informational':      'Generate a sitelink for educational or trust-building content.',
  }

  const prompt =
    `Regenerate ONE sitelink extension. Make it unique from the existing set.\n\n` +
    `Campaign: ${campaignName || ''} | Ad Group: ${adGroupName || ''}\n` +
    `Final URL: ${url} | Base Domain: ${baseDomain}\n` +
    `Keywords: ${kwList}\n` +
    `Type: ${sitelinkType || 'Mixed'} — ${typeGuides[sitelinkType] || typeGuides['Mixed']}\n\n` +
    `Existing sitelinks to AVOID duplicating (headline or URL):\n${existing || '  None'}\n\n` +
    (candidateUrls.length
      ? `Real pages available on this site (pick ONE, do not invent any other URL):\n${candidateUrls.slice(0, 30).map(u => `  - ${u}`).join('\n')}\n\n`
      : '') +
    buildAdvertiserContextBlock(accountProfile, campaignName, adGroupName) +
    buildIntentLockBlock(adGroupName, siblingAdGroupNames, preventCrossover) +
    `\nRules: headline ≤25 chars, description1 ≤35 chars (descriptive complete phrase), description2 ≤35 chars (MUST be a CTA — e.g. "Call Us Today", "Book a Free Consult", "Get a Free Quote", "Schedule Online Now"), url must be one of the real pages listed above (or the Final URL) and must differ from all existing sitelinks.\n\n` +
    `Do not show your work — no explanation, no markdown code fences. Output ONLY the raw JSON object and nothing else.\n\n` +
    `Return ONLY valid JSON: {"headline":"string","description1":"string","description2":"string","url":"string"}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[^}]+\}/)
  try {
    const parsed = JSON.parse(match?.[0] || '{}')
    let fixedUrl = parsed.url || ''
    let allowedHost = ''
    try { allowedHost = new URL(baseDomain || url).hostname } catch {}
    if (!(await checkUrlLive(fixedUrl, allowedHost))) {
      const pool = candidateUrls.filter(u => u !== fixedUrl)
      fixedUrl = pool.length > 0 ? pool[0] : (url || baseDomain || '')
    }
    return {
      headline:     rsaHardLimit(parsed.headline     || '', 25),
      description1: trimDangling(rsaHardLimit(parsed.description1 || '', 35)),
      description2: trimDangling(rsaHardLimit(parsed.description2 || '', 35)),
      url:          fixedUrl,
    }
  } catch { return null }
})

// ── Campaign-level Headline / Description Assets ──────────────────────────────

ipcMain.handle('rsa:fetchHeadlineAssets', async (_e, { customerId, campaignId }) => {
  const { client, settings } = await getClient()
  return fetchCampaignTextAssets(client, customerId, settings.mccCustomerId, { campaignId, fieldType: 'HEADLINE' })
})

ipcMain.handle('rsa:fetchDescriptionAssets', async (_e, { customerId, campaignId }) => {
  const { client, settings } = await getClient()
  return fetchCampaignTextAssets(client, customerId, settings.mccCustomerId, { campaignId, fieldType: 'DESCRIPTION' })
})

ipcMain.handle('rsa:addHeadlineAsset', async (_e, { customerId, campaignId, text }) => {
  const { client, settings } = await getClient()
  return addCampaignTextAsset(client, customerId, settings.mccCustomerId, { campaignId, fieldType: 'HEADLINE', text })
})

ipcMain.handle('rsa:addDescriptionAsset', async (_e, { customerId, campaignId, text }) => {
  const { client, settings } = await getClient()
  return addCampaignTextAsset(client, customerId, settings.mccCustomerId, { campaignId, fieldType: 'DESCRIPTION', text })
})

ipcMain.handle('rsa:generateHeadlinesAI', async (_e, { campaignName, businessName, existingHeadlines, count }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const existing = (existingHeadlines || []).map(h => `  - "${h}"`).join('\n')

  const prompt =
    `You are a Google Ads copywriter. Generate ${count} unique campaign headline assets.\n\n` +
    `Campaign: ${campaignName || ''}\nBusiness: ${businessName || ''}\n\n` +
    (existing ? `Already-added headlines (do NOT duplicate or write near-duplicates):\n${existing}\n\n` : '') +
    RSA_POLICY_RULES + '\n' +
    `HARD RULES:\n` +
    `1. Maximum 30 characters per headline. Count every character.\n` +
    `2. No excessive capitalization (e.g. "BEST HVAC SERVICE"). Title case or sentence case only.\n` +
    `3. No misleading claims, clickbait, or unsupported superlatives.\n` +
    `4. No phone numbers in headline text.\n` +
    `5. Must comply with Google Ads editorial and trademark policies — no competitor brand names.\n` +
    `6. Each headline must be unique in wording and angle from the others and from the existing list.\n\n` +
    `Return ONLY valid JSON: {"headlines":["h1","h2",...]} with exactly ${count} entries.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    const parsed = JSON.parse(match?.[0] || '{}')
    return { headlines: (parsed.headlines || []).slice(0, count).map(h => sanitizeHeadline(h)) }
  } catch { return { headlines: [] } }
})

ipcMain.handle('rsa:generateDescriptionsAI', async (_e, { campaignName, businessName, existingDescriptions, count }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const existing = (existingDescriptions || []).map(d => `  - "${d}"`).join('\n')

  const prompt =
    `You are a Google Ads copywriter. Generate ${count} unique campaign description assets.\n\n` +
    `Campaign: ${campaignName || ''}\nBusiness: ${businessName || ''}\n\n` +
    (existing ? `Already-added descriptions (do NOT duplicate or write near-duplicates):\n${existing}\n\n` : '') +
    RSA_POLICY_RULES + '\n' +
    `HARD RULES:\n` +
    `1. Maximum 90 characters per description. Count every character.\n` +
    `2. No excessive punctuation (e.g. "!!!").\n` +
    `3. No misleading, deceptive, or unverifiable claims.\n` +
    `4. Must be grammatically correct, a complete sentence, and relevant to the business.\n` +
    `5. Must comply with Google Ads policies.\n` +
    `6. Each description must cover a different angle from the others and from the existing list.\n\n` +
    `Return ONLY valid JSON: {"descriptions":["d1","d2",...]} with exactly ${count} entries.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    const parsed = JSON.parse(match?.[0] || '{}')
    return { descriptions: (parsed.descriptions || []).slice(0, count).map(d => sanitizeDescription(d)) }
  } catch { return { descriptions: [] } }
})

// Long headline is a Display/PMax-only asset type (no equivalent in Search
// RSAs) — a single, complete headline-style sentence up to 90 characters,
// distinct from a description (which supports/elaborates) and from a
// regular 30-char headline (which is a short fragment). Kept as its own
// generator rather than reusing rsaGenerateHeadlinesAI/DescriptionsAI
// because the length limit and voice are both different from either.
ipcMain.handle('rsa:generateLongHeadlinesAI', async (_e, { campaignName, businessName, existingLongHeadlines, count }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const existing = (existingLongHeadlines || []).map(h => `  - "${h}"`).join('\n')

  const prompt =
    `You are a Google Ads copywriter. Generate ${count} unique "long headline" assets for a Performance Max / Display asset group.\n\n` +
    `Campaign: ${campaignName || ''}\nBusiness: ${businessName || ''}\n\n` +
    (existing ? `Already-added long headlines (do NOT duplicate or write near-duplicates):\n${existing}\n\n` : '') +
    RSA_POLICY_RULES + '\n' +
    `A long headline is a single, complete headline-style sentence — longer and richer than a normal 30-character headline, but still a headline (a bold statement or value proposition), NOT a supporting description.\n\n` +
    `HARD RULES:\n` +
    `1. Maximum 90 characters. Count every character.\n` +
    `2. Must be a complete, grammatically correct sentence or strong headline phrase — never cut off mid-thought.\n` +
    `3. No excessive punctuation or capitalization.\n` +
    `4. No misleading claims, clickbait, or unsupported superlatives.\n` +
    `5. No phone numbers.\n` +
    `6. Must comply with Google Ads editorial and trademark policies — no competitor brand names.\n` +
    `7. Each long headline must be unique in wording and angle from the others and from the existing list.\n\n` +
    `Return ONLY valid JSON: {"longHeadlines":["lh1","lh2",...]} with exactly ${count} entries.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    const parsed = JSON.parse(match?.[0] || '{}')
    return { longHeadlines: (parsed.longHeadlines || []).slice(0, count).map(h => sanitizeDescription(h)) }
  } catch { return { longHeadlines: [] } }
})

// ── Callout Assets ────────────────────────────────────────────────────────────

ipcMain.handle('rsa:fetchCalloutAssets', async (_e, { customerId, level, campaignId, adGroupId }) => {
  const { client, settings } = await getClient()
  return fetchCalloutAssets(client, customerId, settings.mccCustomerId, { level, campaignId, adGroupId })
})

ipcMain.handle('rsa:publishCallout', async (_e, { customerId, level, campaignId, adGroupId, text }) => {
  const { client, settings } = await getClient()
  return publishCallout(client, customerId, settings.mccCustomerId, { level, campaignId, adGroupId, text })
})

ipcMain.handle('rsa:editCalloutAsset', async (_e, { customerId, resourceName, text }) => {
  const { client, settings } = await getClient()
  return editCalloutAsset(client, customerId, settings.mccCustomerId, { resourceName, text })
})

// ── Call Assets ────────────────────────────────────────────────────────────────

ipcMain.handle('rsa:fetchCallAssets', async (_e, { customerId, level, campaignId, adGroupId }) => {
  const { client, settings } = await getClient()
  return fetchCallAssets(client, customerId, settings.mccCustomerId, { level, campaignId, adGroupId })
})

ipcMain.handle('rsa:publishCallAsset', async (_e, { customerId, level, campaignId, adGroupId, phoneNumber, countryCode, conversionMode, conversionActionResourceName }) => {
  const { client, settings } = await getClient()
  return publishCallAsset(client, customerId, settings.mccCustomerId, { level, campaignId, adGroupId, phoneNumber, countryCode, conversionMode, conversionActionResourceName })
})

ipcMain.handle('rsa:editCallAsset', async (_e, { customerId, resourceName, phoneNumber, countryCode, conversionMode, conversionActionResourceName }) => {
  const { client, settings } = await getClient()
  return editCallAsset(client, customerId, settings.mccCustomerId, { resourceName, phoneNumber, countryCode, conversionMode, conversionActionResourceName })
})

ipcMain.handle('rsa:fetchConversionActions', async (_e, { customerId }) => {
  const { client, settings } = await getClient()
  return fetchConversionActionsForDropdown(client, customerId, settings.mccCustomerId)
})

// ── Asset Link management (Pause/Remove) — shared across every asset type ────

ipcMain.handle('rsa:updateAssetLinkStatus', async (_e, { customerId, level, campaignId, adGroupId, linkResourceName, status }) => {
  const { client, settings } = await getClient()
  return updateAssetLinkStatus(client, customerId, settings.mccCustomerId, { level, campaignId, adGroupId, linkResourceName, status })
})

ipcMain.handle('rsa:generateCalloutsAI', async (_e, { customerId, campaignName, adGroupName, keywords, count, existingCallouts, preventCrossover, siblingAdGroupNames, landingPageUrl }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured.')
  const accountProfile = await resolveWebsiteProfile(customerId, landingPageUrl)
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const kwList   = (keywords || []).slice(0, 15).map(k => k.text || k).join(', ')
  const existing = (existingCallouts || []).map(c => `  - "${c}"`).join('\n')

  const prompt =
    `You are a senior Google Ads copywriter specializing in callout extensions for local service businesses.\n\n` +
    `Generate ${count} unique, HIGH-IMPACT callout assets.\n\n` +
    `Campaign: ${campaignName || ''}\nAd Group: ${adGroupName || ''}\nKeywords: ${kwList}\n\n` +
    (existing ? `Already-added callouts (do NOT duplicate):\n${existing}\n\n` : '') +
    buildAdvertiserContextBlock(accountProfile, campaignName, adGroupName) +
    buildIntentLockBlock(adGroupName, siblingAdGroupNames, preventCrossover) +
    `\nCALLOUT STRATEGY — spread across these proven categories (no more than 2 per category):\n` +
    `   • Credentials & Trust   — Licensed, Insured, Bonded, Certified, BBB Accredited\n` +
    `   • Speed & Availability  — Same-Day Service, 24/7 Availability, Fast Response, Open Weekends\n` +
    `   • Guarantees & Value    — Free Estimates, No Hidden Fees, Satisfaction Guaranteed, Flat-Rate Pricing\n` +
    `   • Service Specifics     — a CONCRETE service pulled from the keywords above (never generic "Quality Service")\n` +
    `   • Local Authority       — Locally Owned, Family-Owned & Operated, Serving [Area] Since [Year]\n` +
    `   • Experience & Scale    — X+ Years Experience, 1,000+ Jobs Completed, Top-Rated Service\n\n` +
    `HARD RULES:\n` +
    `1. Maximum 25 characters per callout. Count every character.\n` +
    `2. USE THE FULL CHARACTER SPACE — aim for 20–25 characters. A 9-character callout like "Top Work" wastes the format.\n` +
    `3. BE SPECIFIC AND CONCRETE. NEVER write vague filler — "Great Service", "Quality Work", "Best in Town", and "Customer Satisfaction" are explicitly BANNED because they carry no real information.\n` +
    `4. Non-clickable plain text only — no links, no call-to-action phrasing like "Call Now" or "Click Here".\n` +
    `5. No promotional pricing, phone numbers, or URLs.\n` +
    `6. No duplicate callouts, and no two callouts saying the same thing in different words.\n` +
    `7. Do not repeat any headline-style phrase exactly — write standalone benefit statements.\n\n` +
    `Do not show your work — no character-count verification, no candidate list, no markdown code fences, no explanation. Output ONLY the raw JSON object below and nothing else.\n\n` +
    `Return ONLY valid JSON: {"callouts":["c1","c2",...]} with exactly ${count} entries.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    const parsed = JSON.parse(match?.[0] || '{}')
    return { callouts: (parsed.callouts || []).slice(0, count).map(c => rsaHardLimit(c || '', 25)) }
  } catch { return { callouts: [] } }
})

ipcMain.handle('rsa:regenerateSingleCallout', async (_e, { customerId, campaignName, adGroupName, keywords, existingCallouts, index, preventCrossover, siblingAdGroupNames, landingPageUrl }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured.')
  const accountProfile = await resolveWebsiteProfile(customerId, landingPageUrl)
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const kwList   = (keywords || []).slice(0, 10).map(k => k.text || k).join(', ')
  const existing = (existingCallouts || []).filter((_, i) => i !== index).map(c => `  - "${c}"`).join('\n')

  const prompt =
    `You are a senior Google Ads copywriter. Regenerate ONE high-impact callout asset. Make it unique from the existing set.\n\n` +
    `Campaign: ${campaignName || ''} | Ad Group: ${adGroupName || ''}\nKeywords: ${kwList}\n\n` +
    `Existing callouts to AVOID duplicating or overlapping in meaning with:\n${existing || '  None'}\n\n` +
    buildAdvertiserContextBlock(accountProfile, campaignName, adGroupName) +
    buildIntentLockBlock(adGroupName, siblingAdGroupNames, preventCrossover) +
    `\nPick ONE strong category not already well-covered above: Credentials & Trust (Licensed, Insured, Certified), ` +
    `Speed & Availability (Same-Day, 24/7, Fast Response), Guarantees & Value (Free Estimates, No Hidden Fees), ` +
    `a CONCRETE Service Specific from the keywords, Local Authority (Locally/Family-Owned, Serving [Area] Since [Year]), ` +
    `or Experience & Scale (X+ Years Experience, 1,000+ Jobs Completed).\n\n` +
    `Rules: max 25 chars (use the full 20–25 range), non-clickable plain text, no pricing/phone/URL, no CTA phrasing (no "Call Now"/"Click Here"). ` +
    `Be SPECIFIC and concrete — vague filler like "Great Service", "Quality Work", or "Best in Town" is BANNED.\n\n` +
    `Do not show your work — no explanation, no markdown code fences. Output ONLY the raw JSON object and nothing else.\n\n` +
    `Return ONLY valid JSON: {"text":"replacement callout"}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*?\}/)
  try {
    const parsed = JSON.parse(match?.[0] || '{}')
    return { text: rsaHardLimit(parsed.text || '', 25) }
  } catch { return { text: '' } }
})

// ── Structured Snippet Assets ─────────────────────────────────────────────────

const STRUCTURED_SNIPPET_HEADERS = [
  'Amenities', 'Brands', 'Courses', 'Degree programs', 'Destinations',
  'Featured hotels', 'Insurance coverage', 'Models', 'Neighborhoods',
  'Service catalog', 'Shows', 'Styles', 'Types',
]

ipcMain.handle('rsa:fetchStructuredSnippetAssets', async (_e, { customerId, level, campaignId, adGroupId }) => {
  const { client, settings } = await getClient()
  return fetchStructuredSnippetAssets(client, customerId, settings.mccCustomerId, { level, campaignId, adGroupId })
})

ipcMain.handle('rsa:publishStructuredSnippet', async (_e, { customerId, level, campaignId, adGroupId, header, values }) => {
  const { client, settings } = await getClient()
  return publishStructuredSnippet(client, customerId, settings.mccCustomerId, { level, campaignId, adGroupId, header, values })
})

ipcMain.handle('rsa:editStructuredSnippetAsset', async (_e, { customerId, resourceName, header, values }) => {
  const { client, settings } = await getClient()
  return editStructuredSnippetAsset(client, customerId, settings.mccCustomerId, { resourceName, header, values })
})

ipcMain.handle('rsa:generateStructuredSnippetAI', async (_e, { customerId, campaignName, adGroupName, header, count, keywords, preventCrossover, siblingAdGroupNames, landingPageUrl }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured.')
  if (!STRUCTURED_SNIPPET_HEADERS.includes(header)) throw new Error(`Invalid structured snippet header: ${header}`)
  const accountProfile = await resolveWebsiteProfile(customerId, landingPageUrl)
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const kwList = (keywords || []).slice(0, 15).map(k => k.text || k).join(', ')

  const prompt =
    `You are a Google Ads copywriter. Generate ${count} values for a Structured Snippet asset.\n\n` +
    `Campaign: ${campaignName || ''}\nAd Group: ${adGroupName || ''}\nKeywords: ${kwList}\n\n` +
    `Header: "${header}"\n\n` +
    buildAdvertiserContextBlock(accountProfile, campaignName, adGroupName) +
    buildIntentLockBlock(adGroupName, siblingAdGroupNames, preventCrossover) +
    `\nHARD RULES:\n` +
    `1. Generate exactly ${count} values, all under the SAME header "${header}".\n` +
    `2. Every value must strictly match the meaning of the header "${header}" (e.g. if header is "Brands", every value must be an actual brand name relevant to this business).\n` +
    (header === 'Service catalog'
      ? `2b. "Service catalog" means services/solutions the ADVERTISER sells — never the target industry's own products or services. If the campaign targets dealerships, do NOT list vehicle sales, financing, or repairs; list the advertiser's own offerings instead.\n`
      : '') +
    `3. Each value should be short — 25 characters or fewer.\n` +
    `4. Avoid promotional text — no "Free", "Best", "Call Now", pricing, or other CTA/superlative language.\n` +
    `5. No duplicate values.\n\n` +
    `Do not show your work — no character-count verification, no candidate list, no markdown code fences, no explanation. Output ONLY the raw JSON object below and nothing else.\n\n` +
    `Return ONLY valid JSON: {"values":["v1","v2",...]} with exactly ${count} entries.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    const parsed = JSON.parse(match?.[0] || '{}')
    return { values: (parsed.values || []).slice(0, count).map(v => rsaHardLimit(v || '', 25)) }
  } catch { return { values: [] } }
})

ipcMain.handle('rsa:regenerateSingleSnippetValue', async (_e, { customerId, campaignName, adGroupName, header, keywords, existingValues, index, preventCrossover, siblingAdGroupNames, landingPageUrl }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured.')
  const accountProfile = await resolveWebsiteProfile(customerId, landingPageUrl)
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const kwList   = (keywords || []).slice(0, 10).map(k => k.text || k).join(', ')
  const existing = (existingValues || []).filter((_, i) => i !== index).map(v => `  - "${v}"`).join('\n')

  const prompt =
    `Regenerate ONE structured snippet value under header "${header}". Make it unique from the existing set.\n\n` +
    `Campaign: ${campaignName || ''} | Ad Group: ${adGroupName || ''}\nKeywords: ${kwList}\n\n` +
    `Existing values to AVOID duplicating:\n${existing || '  None'}\n\n` +
    buildAdvertiserContextBlock(accountProfile, campaignName, adGroupName) +
    buildIntentLockBlock(adGroupName, siblingAdGroupNames, preventCrossover) +
    (header === 'Service catalog'
      ? `"Service catalog" means services/solutions the ADVERTISER sells — never the target industry's own products or services.\n`
      : '') +
    `\nRules: value must strictly match the meaning of header "${header}", max 25 chars, no promotional text.\n\n` +
    `Do not show your work — no explanation, no markdown code fences. Output ONLY the raw JSON object and nothing else.\n\n` +
    `Return ONLY valid JSON: {"text":"replacement value"}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*?\}/)
  try {
    const parsed = JSON.parse(match?.[0] || '{}')
    return { text: rsaHardLimit(parsed.text || '', 25) }
  } catch { return { text: '' } }
})

ipcMain.handle('rsa:enableAd', async (_e, { customerId, adGroupId, adId }) => {
  const { client, settings } = await getClient()
  return enableRSAById(client, customerId, settings.mccCustomerId, { adGroupId, adId })
})

ipcMain.handle('rsa:pauseAd', async (_e, { customerId, adGroupId, adId }) => {
  const { client, settings } = await getClient()
  return pauseRSAById(client, customerId, settings.mccCustomerId, { adGroupId, adId })
})

ipcMain.handle('rsa:removeAd', async (_e, { customerId, adGroupId, adId }) => {
  const { client, settings } = await getClient()
  return removeRSAById(client, customerId, settings.mccCustomerId, { adGroupId, adId })
})

ipcMain.handle('keywords:publish', async (_e, { customerId, adGroupId, keywordText, matchType }) => {
  const { client, settings } = await getClient()
  return publishKeywordToAdGroup(client, customerId, settings.mccCustomerId, { adGroupId, keywordText, matchType })
})

// ── Negative Keyword publishing ───────────────────────────────────────────────

ipcMain.handle('negatives:fetchLists', async (_e, { customerId }) => {
  const { client, settings } = await getClient()
  return fetchNegativeKeywordLists(client, customerId, settings.mccCustomerId)
})

ipcMain.handle('negatives:publishToCampaign', async (_e, { customerId, campaignId, listMode, listName, sharedSetId, keywords, validateOnly }) => {
  const { client, settings } = await getClient()
  return publishNegativeKeywordsToCampaign(client, customerId, settings.mccCustomerId, { campaignId, listMode, listName, sharedSetId, keywords, validateOnly })
})

ipcMain.handle('negatives:publishToAdGroup', async (_e, { customerId, adGroupId, keywords, validateOnly }) => {
  const { client, settings } = await getClient()
  return publishNegativeKeywordsToAdGroup(client, customerId, settings.mccCustomerId, { adGroupId, keywords, validateOnly })
})

ipcMain.handle('negatives:fetchListsForCampaign', async (_e, { customerId, campaignId }) => {
  const { client, settings } = await getClient()
  return fetchNegativeListsForCampaign(client, customerId, settings.mccCustomerId, campaignId)
})

ipcMain.handle('negatives:fetchCampaignLevel', async (_e, { customerId, campaignId }) => {
  const { client, settings } = await getClient()
  return fetchCampaignLevelNegatives(client, customerId, settings.mccCustomerId, campaignId)
})

ipcMain.handle('negatives:fetchAdGroupLevel', async (_e, { customerId, adGroupId }) => {
  const { client, settings } = await getClient()
  return fetchAdGroupLevelNegatives(client, customerId, settings.mccCustomerId, adGroupId)
})

ipcMain.handle('negatives:removeCampaignLevel', async (_e, { customerId, resourceNames, validateOnly }) => {
  const { client, settings } = await getClient()
  return removeCampaignLevelNegatives(client, customerId, settings.mccCustomerId, { resourceNames, validateOnly })
})

ipcMain.handle('negatives:removeAdGroupLevel', async (_e, { customerId, resourceNames, validateOnly }) => {
  const { client, settings } = await getClient()
  return removeAdGroupLevelNegatives(client, customerId, settings.mccCustomerId, { resourceNames, validateOnly })
})

ipcMain.handle('negatives:removeSharedList', async (_e, { customerId, resourceNames, validateOnly }) => {
  const { client, settings } = await getClient()
  return removeSharedListNegatives(client, customerId, settings.mccCustomerId, { resourceNames, validateOnly })
})

ipcMain.handle('rsa:rollback', async (_e, { entryId, customerId, adGroupId }) => {
  const { client, settings } = await getClient()
  const entries = await readChangelog()
  const entry   = entries.find(e => e.id === entryId)
  if (!entry)          throw new Error('Change log entry not found')
  if (entry.type && entry.type !== 'rsa') throw new Error('This change log entry is not an RSA change.')
  if (entry.rolledBack) throw new Error('Already rolled back')

  const res = await rollbackRSAChanges(client, customerId, settings.mccCustomerId, {
    adGroupId,
    createdResourceName: entry.after?.resourceName,
    pausedAdIds:         entry.paused || [],
  })
  await patchChangelogEntry(entryId, {
    rolledBack:     true,
    rollbackAt:     new Date().toISOString(),
    rollbackErrors: res.errors,
  })
  return res
})

// ── PDF export ────────────────────────────────────────────────────────────────

// ── Campaign Manager ──────────────────────────────────────────────────────────

ipcMain.handle('campaign:list', async (_e, { customerId, hidePaused }) => {
  const { client, settings } = await getClient()
  return listCampaigns(client, customerId, settings.mccCustomerId, { hidePaused })
})

ipcMain.handle('campaign:get', async (_e, { customerId, campaignId }) => {
  const { client, settings } = await getClient()
  return getCampaign(client, customerId, settings.mccCustomerId, campaignId)
})

ipcMain.handle('campaign:getChangelog', async (_e, { customerId } = {}) => {
  const entries = await readChangelog()
  return entries.filter(e => e.type === 'campaign' && (!customerId || String(e.customerId) === String(customerId)))
})

ipcMain.handle('campaign:createSearch', async (_e, { customerId, campaignName, ...args }) => {
  const { client, settings } = await getClient()
  const result = await createSearchCampaign(client, customerId, settings.mccCustomerId, args)
  if (args.validateOnly) return result

  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'campaign', action: 'create',
    customerId, campaignName: args.name,
    before: null, after: result,
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('campaign:createDisplay', async (_e, { customerId, campaignName, ...args }) => {
  const { client, settings } = await getClient()
  const result = await createDisplayCampaign(client, customerId, settings.mccCustomerId, args)
  if (args.validateOnly) return result

  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'campaign', action: 'create',
    customerId, campaignName: args.name,
    before: null, after: result,
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('campaign:createPerformanceMax', async (_e, { customerId, campaignName, ...args }) => {
  const { client, settings } = await getClient()
  const result = await createPerformanceMaxCampaign(client, customerId, settings.mccCustomerId, args)
  if (args.validateOnly) return result

  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'campaign', action: 'create',
    customerId, campaignName: args.name,
    before: null, after: result,
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('campaign:createShopping', async (_e, { customerId, campaignName, ...args }) => {
  const { client, settings } = await getClient()
  const result = await createShoppingCampaign(client, customerId, settings.mccCustomerId, args)
  if (args.validateOnly) return result

  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'campaign', action: 'create',
    customerId, campaignName: args.name,
    before: null, after: result,
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('campaign:createVideo', async (_e, { customerId, campaignName, ...args }) => {
  const { client, settings } = await getClient()
  const result = await createVideoCampaign(client, customerId, settings.mccCustomerId, args)
  if (args.validateOnly) return result

  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'campaign', action: 'create',
    customerId, campaignName: args.name,
    before: null, after: result,
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('campaign:updateName', async (_e, { customerId, campaignId, name, before, validateOnly }) => {
  const { client, settings } = await getClient()
  const result = await updateCampaignName(client, customerId, settings.mccCustomerId, { campaignId, name, validateOnly })
  if (validateOnly) return result
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'campaign', action: 'updateName',
    customerId, campaignId, campaignName: name,
    before, after: { name },
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('campaign:updateStatus', async (_e, { customerId, campaignId, campaignName, status, before, validateOnly }) => {
  const { client, settings } = await getClient()
  const result = await updateCampaignStatus(client, customerId, settings.mccCustomerId, { campaignId, status, validateOnly })
  if (validateOnly) return result
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'campaign', action: 'updateStatus',
    customerId, campaignId, campaignName,
    before, after: { status },
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('campaign:updateBudget', async (_e, { customerId, campaignId, campaignName, budgetId, dailyBudget, before, validateOnly }) => {
  const { client, settings } = await getClient()
  const result = await updateCampaignBudget(client, customerId, settings.mccCustomerId, { budgetId, dailyBudget, validateOnly })
  if (validateOnly) return result
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'campaign', action: 'updateBudget',
    customerId, campaignId, campaignName, budgetId,
    before, after: { dailyBudget },
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('campaign:updateBidding', async (_e, { customerId, campaignId, campaignName, biddingStrategy, targetValue, before, validateOnly }) => {
  const { client, settings } = await getClient()
  const result = await updateCampaignBidding(client, customerId, settings.mccCustomerId, { campaignId, biddingStrategy, targetValue, validateOnly })
  if (validateOnly) return result
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'campaign', action: 'updateBidding',
    customerId, campaignId, campaignName,
    before, after: { biddingStrategy, targetValue },
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('campaign:updateTargeting', async (_e, { customerId, campaignId, campaignName, locations, excludedLocations, languages, devices, adSchedules, before, validateOnly }) => {
  const { client, settings } = await getClient()
  const result = await updateCampaignTargeting(client, customerId, settings.mccCustomerId, { campaignId, locations, excludedLocations, languages, devices, adSchedules, validateOnly })
  if (validateOnly) return result
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'campaign', action: 'updateTargeting',
    customerId, campaignId, campaignName,
    before, after: { locations, excludedLocations, languages, devices, adSchedules },
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('campaign:updateEndDate', async (_e, { customerId, campaignId, campaignName, endDate, before, validateOnly }) => {
  const { client, settings } = await getClient()
  const result = await updateCampaignEndDate(client, customerId, settings.mccCustomerId, { campaignId, endDate, validateOnly })
  if (validateOnly) return result
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'campaign', action: 'updateEndDate',
    customerId, campaignId, campaignName,
    before, after: { endDate },
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('campaign:aiRecommend', async (_e, { campaign }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const p = campaign.performance || {}
  const noActivity = !p.impressions && !p.clicks && !p.costMicros

  const prompt =
    `You are a senior Google Ads strategist reviewing one live campaign to recommend concrete adjustments. Be specific and reference the actual numbers below — do not give generic advice.\n\n` +
    `CAMPAIGN\n` +
    `Name: ${campaign.name}\n` +
    `Channel Type: ${campaign.channelType}\n` +
    `Current Status: ${campaign.status}\n` +
    `Current Daily Budget: $${Number(campaign.dailyBudget || 0).toFixed(2)}\n` +
    `Current Bidding Strategy: ${campaign.biddingStrategy}\n` +
    `Current Locations: ${campaign.locations || 'None (broad targeting)'}\n` +
    (campaign.excludedLocations ? `Excluded Locations (already carved out — do NOT recommend excluding these again): ${campaign.excludedLocations}\n` : '') +
    `Current Languages: ${campaign.languages || 'None'}\n\n` +
    `LAST 30 DAYS PERFORMANCE${noActivity ? ' — NO ACTIVITY (zero impressions)' : ''}\n` +
    `Impressions: ${Number(p.impressions || 0).toLocaleString()}\n` +
    `Clicks: ${Number(p.clicks || 0).toLocaleString()}\n` +
    `Cost: $${(Number(p.costMicros || 0) / 1_000_000).toFixed(2)}\n` +
    `Conversions: ${Number(p.conversions || 0)}\n` +
    `CTR: ${(Number(p.ctr || 0) * 100).toFixed(2)}%\n` +
    `Avg CPC: $${(Number(p.avgCpcMicros || 0) / 1_000_000).toFixed(2)}\n` +
    `Conversion Rate: ${(Number(p.conversionRate || 0) * 100).toFixed(2)}%\n\n` +
    `For each of the 5 dimensions below, give exactly ONE concrete recommendation (a short action label under 40 characters, e.g. "Increase to $75/day", "Keep Active", "Switch to Target CPA") and a 1-2 sentence reasoning grounded in the metrics above.\n` +
    (noActivity ? `This campaign has zero activity in the last 30 days — base recommendations on structure (status/budget/targeting completeness) rather than performance trends, and say so explicitly in the reasoning.\n` : '') +
    `\nReturn ONLY valid JSON, no markdown:\n` +
    `{\n` +
    `  "status": {"recommendation":"","reasoning":""},\n` +
    `  "budget": {"recommendation":"","reasoning":""},\n` +
    `  "biddingStrategy": {"recommendation":"","reasoning":""},\n` +
    `  "targeting": {"recommendation":"","reasoning":""},\n` +
    `  "language": {"recommendation":"","reasoning":""}\n` +
    `}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 900,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    return JSON.parse(match?.[0] || '{}')
  } catch {
    throw new Error('AI did not return a valid recommendation. Please try again.')
  }
})

// Shared by the Create Campaign wizard's Ad Groups step (brand-new campaign,
// no existing ad groups yet) and Ad Group Manager's "New Ad Group" panel
// (an existing campaign that may already have ad groups — existingAdGroupNames
// lets the prompt avoid suggesting something that duplicates/overlaps one of
// them, since Ad Group Manager only adds ONE new ad group at a time here).
ipcMain.handle('campaign:aiRecommendAdGroups', async (_e, { name, locations, languages, existingAdGroupNames }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const locText  = (locations  || []).length ? locations.join(', ')  : 'not specified (broad/national)'
  const langText = (languages || []).length ? languages.join(', ') : 'English'
  const existing  = (existingAdGroupNames || []).filter(Boolean)

  const prompt =
    (existing.length > 0
      ? `You are a senior Google Ads strategist recommending a new ad group to add to an existing Search campaign.\n\n` +
        `CAMPAIGN\nName: ${name || '(untitled)'}\n\n` +
        `EXISTING AD GROUPS IN THIS CAMPAIGN\n${existing.join(', ')}\n\n` +
        `Based on the campaign name, suggest 2-4 NEW ad group ideas that fit this campaign without duplicating or closely overlapping the theme of any existing ad group listed above.\n\n`
      : `You are a senior Google Ads strategist helping structure a brand-new Search campaign before it's published.\n\n` +
        `CAMPAIGN\nName: ${name || '(untitled)'}\nTarget Locations: ${locText}\nTarget Languages: ${langText}\n\n` +
        `Based only on the campaign name and targeting above, infer the business or service being advertised and propose a tightly-themed ad group structure.\n\n` +
        `Suggest 2-4 ad groups.\n\n`
    ) +
    `For each ad group:\n` +
    `- A short, specific ad group name (a single service/theme, not the whole business)\n` +
    `- 5-8 high-intent keywords with a recommended match type (BROAD, PHRASE, or EXACT)\n\n` +
    `RULES\n` +
    `- Prioritize transactional/commercial search intent — keywords a ready-to-buy customer would type\n` +
    `- Only suggest keywords with a realistic estimated monthly search volume of 1,000+ — avoid ultra-niche long-tail terms Google Ads would flag as "Low Search Volume" and refuse to serve\n` +
    `- Favor a favorable balance of search volume and cost: prefer moderately competitive, well-qualified terms with strong buying intent over ultra-competitive, expensive head terms when a lower-CPC alternative captures similar intent\n` +
    `- Use location-specific phrasing when a location is given (e.g. "roof repair Miami" not "roof repair near me") — never use "near me"\n` +
    `- Avoid informational, DIY, job-seeker, or free/cheap intent keywords\n` +
    `- Avoid competitor or trademarked brand names\n` +
    `- Each ad group's keywords must share one clear theme — do not mix unrelated services in one ad group\n` +
    `- Recommend Exact/Phrase match for high-value, unambiguous terms; Broad match only for well-qualified, service-specific phrases\n\n` +
    `Return ONLY valid JSON, no markdown:\n` +
    `{"adGroups":[{"name":"","keywords":[{"text":"","matchType":"BROAD|PHRASE|EXACT"}]}]}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  let parsed
  try {
    parsed = JSON.parse(match?.[0] || '{}')
  } catch {
    throw new Error('AI did not return valid ad group suggestions. Please try again.')
  }
  const validMatchTypes = ['BROAD', 'PHRASE', 'EXACT']
  const adGroups = (parsed.adGroups || []).slice(0, 6).map(ag => ({
    name: ag.name || 'Ad Group',
    keywords: (ag.keywords || []).slice(0, 10)
      .map(k => ({ text: String(k.text || '').trim(), matchType: validMatchTypes.includes(String(k.matchType || '').toUpperCase()) ? String(k.matchType).toUpperCase() : 'BROAD' }))
      .filter(k => k.text),
  })).filter(ag => ag.keywords.length > 0)
  return { adGroups }
})

ipcMain.handle('campaign:searchGeoTargets', async (_e, { customerId, query }) => {
  const { client, settings } = await getClient()
  return searchGeoTargets(client, customerId, settings.mccCustomerId, query)
})

ipcMain.handle('campaign:listLanguages', async (_e, { customerId }) => {
  const { client, settings } = await getClient()
  return listLanguages(client, customerId, settings.mccCustomerId)
})

ipcMain.handle('campaign:rollback', async (_e, { entryId, customerId }) => {
  const { client, settings } = await getClient()
  const entries = await readChangelog()
  const entry   = entries.find(e => e.id === entryId)
  if (!entry)          throw new Error('Change log entry not found')
  if (entry.type !== 'campaign') throw new Error('This change log entry is not a Campaign Manager change.')
  if (entry.rolledBack) throw new Error('Already rolled back')

  let res
  if (entry.action === 'create') {
    res = await rollbackCampaignCreate(client, customerId, settings.mccCustomerId, {
      campaignResourceName: entry.after?.campaignResourceName,
    })
  } else {
    res = await rollbackCampaignUpdate(client, customerId, settings.mccCustomerId, {
      action: entry.action, campaignId: entry.campaignId, budgetId: entry.budgetId, before: entry.before,
    })
  }
  await patchChangelogEntry(entryId, {
    rolledBack: true, rollbackAt: new Date().toISOString(), rollbackErrors: res.errors || [],
  })
  return res
})

// ── Ad Group Manager ──────────────────────────────────────────────────────────

ipcMain.handle('adGroup:list', async (_e, { customerId, campaignId, hidePaused }) => {
  const { client, settings } = await getClient()
  return await listAdGroups(client, customerId, settings.mccCustomerId, campaignId, { hidePaused })
})

ipcMain.handle('adGroup:create', async (_e, { customerId, campaignId, campaignName, ...args }) => {
  const { client, settings } = await getClient()
  const result = await createAdGroup(client, customerId, settings.mccCustomerId, { campaignId, ...args })
  if (args.validateOnly) return result

  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'adGroup', action: 'create',
    customerId, campaignId, adGroupName: args.name,
    before: null, after: result,
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('adGroup:updateName', async (_e, { customerId, adGroupId, adGroupName, name, before, validateOnly }) => {
  const { client, settings } = await getClient()
  const result = await updateAdGroupName(client, customerId, settings.mccCustomerId, { adGroupId, name, validateOnly })
  if (validateOnly) return result
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'adGroup', action: 'updateName',
    customerId, adGroupId, adGroupName: name,
    before, after: { name },
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('adGroup:updateStatus', async (_e, { customerId, adGroupId, adGroupName, status, before, validateOnly }) => {
  const { client, settings } = await getClient()
  const result = await updateAdGroupStatus(client, customerId, settings.mccCustomerId, { adGroupId, status, validateOnly })
  if (validateOnly) return result
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'adGroup', action: 'updateStatus',
    customerId, adGroupId, adGroupName,
    before, after: { status },
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('adGroup:updateBid', async (_e, { customerId, adGroupId, adGroupName, cpcBid, before, validateOnly }) => {
  const { client, settings } = await getClient()
  const result = await updateAdGroupBid(client, customerId, settings.mccCustomerId, { adGroupId, cpcBid, validateOnly })
  if (validateOnly) return result
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'adGroup', action: 'updateBid',
    customerId, adGroupId, adGroupName,
    before, after: { cpcBid },
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('adGroup:aiRecommendKeywords', async (_e, { campaignName, adGroupName, existingKeywords, siblingAdGroupNames }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const existing = (existingKeywords || []).filter(Boolean).slice(0, 60)

  const prompt =
    `You are a senior Google Ads strategist recommending additional keywords for an existing ad group in a Search campaign.\n\n` +
    `CAMPAIGN\nName: ${campaignName || '(untitled)'}\n\n` +
    `AD GROUP\nName: ${adGroupName || '(untitled)'}\n\n` +
    `EXISTING KEYWORDS IN THIS AD GROUP\n${existing.length ? existing.join(', ') : 'none yet'}\n\n` +
    // Always on — unlike the RSA/Assets builders, keyword-to-ad-group
    // assignment has no legitimate case for letting the same term compete
    // across two ad groups in one campaign, so this isn't a user toggle here.
    buildIntentLockBlock(adGroupName, siblingAdGroupNames, true) +
    `\nBased on the campaign name and ad group name, suggest 6-10 NEW high-intent keywords with a recommended match type (BROAD, PHRASE, or EXACT) that would strengthen this ad group WITHOUT duplicating or closely paraphrasing any keyword already listed above.\n\n` +
    `RULES\n` +
    `- Prioritize transactional/commercial search intent — keywords a ready-to-buy customer would type\n` +
    `- Only suggest keywords with a realistic estimated monthly search volume of 1,000+ — avoid ultra-niche long-tail terms Google Ads would flag as "Low Search Volume" and refuse to serve\n` +
    `- Favor a favorable balance of search volume and cost: prefer moderately competitive, well-qualified terms with strong buying intent over ultra-competitive, expensive head terms when a lower-CPC alternative captures similar intent\n` +
    `- Do not repeat or closely paraphrase any existing keyword listed above\n` +
    `- Keep every keyword tightly on-theme with the ad group name\n` +
    `- Avoid informational, DIY, job-seeker, or free/cheap intent keywords\n` +
    `- Avoid competitor or trademarked brand names, and never use "near me"\n` +
    `- Recommend Exact/Phrase match for high-value, unambiguous terms; Broad match only for well-qualified, service-specific phrases\n\n` +
    `Return ONLY valid JSON, no markdown:\n` +
    `{"keywords":[{"text":"","matchType":"BROAD|PHRASE|EXACT"}]}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  let parsed
  try {
    parsed = JSON.parse(match?.[0] || '{}')
  } catch {
    throw new Error('AI did not return valid keyword suggestions. Please try again.')
  }
  const validMatchTypes = ['BROAD', 'PHRASE', 'EXACT']
  const existingLower = new Set(existing.map(k => k.toLowerCase().trim()))
  const keywords = (parsed.keywords || []).slice(0, 12)
    .map(k => ({ text: String(k.text || '').trim(), matchType: validMatchTypes.includes(String(k.matchType || '').toUpperCase()) ? String(k.matchType).toUpperCase() : 'BROAD' }))
    .filter(k => k.text && !existingLower.has(k.text.toLowerCase()))
  return { keywords }
})

ipcMain.handle('adGroup:listKeywords', async (_e, { customerId, adGroupId }) => {
  const { client, settings } = await getClient()
  return await listAdGroupKeywords(client, customerId, settings.mccCustomerId, adGroupId)
})

ipcMain.handle('adGroup:updateKeywords', async (_e, { customerId, adGroupId, adGroupName, keywords, before, validateOnly }) => {
  const { client, settings } = await getClient()
  const result = await updateAdGroupKeywords(client, customerId, settings.mccCustomerId, { adGroupId, keywords, validateOnly })
  if (validateOnly) return result
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'adGroup', action: 'updateKeywords',
    customerId, adGroupId, adGroupName,
    before, after: { keywords },
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('adGroup:getChangelog', async (_e, { customerId } = {}) => {
  const entries = await readChangelog()
  return entries.filter(e => e.type === 'adGroup' && (!customerId || String(e.customerId) === String(customerId)))
})

ipcMain.handle('adGroup:rollback', async (_e, { entryId, customerId }) => {
  const { client, settings } = await getClient()
  const entries = await readChangelog()
  const entry   = entries.find(e => e.id === entryId)
  if (!entry)          throw new Error('Change log entry not found')
  if (entry.type !== 'adGroup') throw new Error('This change log entry is not an Ad Group Manager change.')
  if (entry.rolledBack) throw new Error('Already rolled back')

  let res
  if (entry.action === 'create') {
    res = await rollbackAdGroupCreate(client, customerId, settings.mccCustomerId, {
      adGroupResourceName: entry.after?.adGroupResourceName,
    })
  } else {
    res = await rollbackAdGroupUpdate(client, customerId, settings.mccCustomerId, {
      action: entry.action, adGroupId: entry.adGroupId, before: entry.before,
    })
  }
  await patchChangelogEntry(entryId, {
    rolledBack: true, rollbackAt: new Date().toISOString(), rollbackErrors: res.errors || [],
  })
  return res
})

// ── Keywords Manager ──────────────────────────────────────────────────────────

ipcMain.handle('keywordManager:list', async (_e, { customerId, adGroupId, dateRange }) => {
  const { client, settings } = await getClient()
  return await listManagedKeywords(client, customerId, settings.mccCustomerId, { adGroupId, dateRange })
})

ipcMain.handle('keywordManager:listSearchTerms', async (_e, { customerId, adGroupId, dateRange }) => {
  const { client, settings } = await getClient()
  return await listAdGroupSearchTerms(client, customerId, settings.mccCustomerId, { adGroupId, dateRange })
})

ipcMain.handle('keywordManager:updateKeyword', async (_e, { customerId, ...args }) => {
  const { client, settings } = await getClient()
  return await updateKeyword(client, customerId, settings.mccCustomerId, args)
})

ipcMain.handle('keywordManager:bulkUpdateKeywords', async (_e, { customerId, ...args }) => {
  const { client, settings } = await getClient()
  return await bulkUpdateKeywords(client, customerId, settings.mccCustomerId, args)
})

ipcMain.handle('keywordManager:addKeywords', async (_e, { customerId, adGroupId, keywords, validateOnly }) => {
  const { client, settings } = await getClient()
  return await addKeywords(client, customerId, settings.mccCustomerId, { adGroupId, keywords, validateOnly })
})

// Per-keyword deep-dive — the Manage popup's AI panel. Rule-based
// Keep/Optimize/Pause/Monitor already lives in keywordManagerClient.js for
// the table column (needs to be instant for 100+ rows); this is the
// on-demand, data-grounded written version for one specific keyword.
ipcMain.handle('keywordManager:aiRecommendForKeyword', async (_e, { keyword }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const k = keyword || {}
  const noActivity = !k.impressions && !k.clicks && !k.cost
  // The Manage Keywords table already stamped this keyword with a fast,
  // rule-based verdict (computeRecommendation, keywordManagerClient.js) —
  // ground this deeper review in it so the two don't silently contradict
  // each other (previously reported: table said Monitor, this said Pause,
  // with no acknowledgment either existed).
  const quickCheck = computeRecommendation(k)

  const prompt =
    `You are a senior Google Ads strategist reviewing one specific keyword's performance to recommend an action. Be specific and reference the actual numbers below — do not give generic advice.\n\n` +
    `CAMPAIGN: ${k.campaignName || ''}\n` +
    `AD GROUP: ${k.adGroupName || ''}\n` +
    `KEYWORD: "${k.text || ''}" (${k.matchType || ''} match)\n` +
    `Status: ${k.status || ''}\n` +
    `Quality Score: ${k.qualityScore || 0}/10\n\n` +
    `LAST 30 DAYS PERFORMANCE${noActivity ? ' — NO ACTIVITY (zero impressions)' : ''}\n` +
    `Impressions: ${Number(k.impressions || 0).toLocaleString()}\n` +
    `Clicks: ${Number(k.clicks || 0).toLocaleString()}\n` +
    `CTR: ${Number(k.ctr || 0).toFixed(2)}%\n` +
    `Cost: $${Number(k.cost || 0).toFixed(2)}\n` +
    `CPC: $${Number(k.cpc || 0).toFixed(2)}\n` +
    `Conversions: ${Number(k.conversions || 0)}\n` +
    `Phone Conversions: ${Number(k.phoneConversions || 0)}\n` +
    `Form Conversions: ${Number(k.formConversions || 0)}\n\n` +
    `A quick automated check already classified this keyword as: ${quickCheck}. Treat that as your starting point — agree with it unless the numbers above clearly support a different call. If you land on a different recommendation, explicitly say in your reasoning why the quick check doesn't fit this case.\n\n` +
    `Give ONE clear recommendation — Keep, Optimize, Pause, or Monitor (use Monitor only if there's genuinely too little data to judge, e.g. very low impressions) — and 2-3 sentences of reasoning grounded in the numbers above. If "Optimize", say specifically what to change (match type, bid, ad copy alignment, landing page relevance, etc).\n` +
    (noActivity ? `This keyword has zero activity — base the recommendation on structure (quality score, match type breadth) rather than performance trends, and say so explicitly.\n` : '') +
    `\nReturn ONLY valid JSON, no markdown:\n` +
    `{"recommendation":"Keep|Optimize|Pause|Monitor","reasoning":""}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    return JSON.parse(match?.[0] || '{}')
  } catch {
    throw new Error('AI did not return a valid recommendation. Please try again.')
  }
})

// ── Quality Score AI analysis (robot icon on Manage Keywords) ────────────────
// Deliberately does NOT compute its own replacement Quality Score — Google's
// three published component ratings (Expected CTR / Ad relevance / Landing
// page experience) are the source of truth here, and the AI is only asked to
// explain the weakest one and recommend concrete, keyword-specific fixes
// grounded in the keyword's actual search terms, current RSA copy, and real
// landing page content (not invented content).
ipcMain.handle('keywordManager:aiAnalyzeQualityScore', async (_e, { customerId, keyword }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const k = keyword || {}
  if (!k.adGroupId) throw new Error('Keyword is missing its ad group.')

  const { client } = await getClient()
  const { rsaAds, keywords: adGroupKeywords, searchTerms } = await fetchRSABuilderData(client, customerId, settings.mccCustomerId, k.adGroupId)

  // Match by resource name first (exact — same field the row came from),
  // falling back to text+match type in case the two queries ever disagree on
  // resource-name formatting.
  const kwDetail = adGroupKeywords.find(a => a.resourceName === k.resourceName)
    || adGroupKeywords.find(a => a.text.toLowerCase() === String(k.text || '').toLowerCase() && a.matchType === k.matchType)
    || {}

  // search_term_view's segments.keyword.info reflects the triggering
  // criterion's own text — case-insensitive compare since Google Ads doesn't
  // guarantee identical casing between the two queries.
  const myTerms = searchTerms
    .filter(t => t.triggeredKeyword.toLowerCase() === String(k.text || '').toLowerCase())
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 20)

  // The ad group may run more than one RSA — analyze the currently-serving
  // one (falls back to the first available if none are ENABLED).
  const primaryAd = rsaAds.find(a => a.status === 'ENABLED') || rsaAds[0] || null
  const finalUrl  = primaryAd?.finalUrls?.[0] || ''

  const landingPage = finalUrl ? await analyzeLandingPage(finalUrl).catch(() => null) : null
  const accountProfile = await resolveWebsiteProfile(customerId, finalUrl)

  const conversions   = Number(k.conversions || 0)
  const clicks        = Number(k.clicks || 0)
  const cost          = Number(k.cost || 0)
  const convRate      = clicks > 0 ? (conversions / clicks) * 100 : 0
  const costPerConv   = conversions > 0 ? cost / conversions : null
  const qualityScore  = Number(k.qualityScore || kwDetail.qualityScore || 0)

  const hasQs = qualityScore > 0
  const componentsBlock = hasQs
    ? `Expected CTR: ${kwDetail.expectedCtr || 'Unknown'}\n` +
      `Ad relevance: ${kwDetail.adRelevance || 'Unknown'}\n` +
      `Landing page experience: ${kwDetail.landingPageExp || 'Unknown'}\n`
    : `Google has not returned component ratings for this keyword — quality_score is 0/absent.\n`

  const termsBlock = myTerms.length
    ? myTerms.map(t => `- "${t.term}" | Clicks:${t.clicks} Cost:$${t.cost.toFixed(2)} Conv:${t.conversions}`).join('\n')
    : '(No search terms recorded for this exact keyword in the lookback window.)'

  const headlinesBlock = primaryAd?.headlines?.length
    ? primaryAd.headlines.map((h, i) => `${i + 1}. "${h.text}"${h.pinned ? ` [pinned: ${h.pinned}]` : ''}`).join('\n')
    : '(No active RSA found in this ad group.)'
  const descriptionsBlock = primaryAd?.descriptions?.length
    ? primaryAd.descriptions.map((d, i) => `${i + 1}. "${d.text}"${d.pinned ? ` [pinned: ${d.pinned}]` : ''}`).join('\n')
    : '(No active RSA found in this ad group.)'

  const lpBlock = landingPage && !landingPage.error
    ? `URL: ${landingPage.url}\n` +
      `Title: ${landingPage.title || ''}\n` +
      `Meta description: ${landingPage.metaDescription || ''}\n` +
      `H1: ${landingPage.h1 || ''}\n` +
      `H2s: ${(landingPage.h2s || []).join(' | ')}\n` +
      `CTAs found: ${(landingPage.ctas || []).join(' | ')}\n` +
      `Trust signals: ${(landingPage.trustSignals || []).join(' | ')}\n` +
      `Services mentioned: ${(landingPage.services || []).join(' | ')}\n` +
      `Body excerpt: ${(landingPage.bodySnippet || '').slice(0, 800)}\n`
    : finalUrl
      ? `Could not extract landing page content for ${finalUrl} (${landingPage?.error || 'fetch failed'}).\n`
      : '(No final URL found on the active ad to check.)\n'

  const businessContext = buildAdvertiserContextBlock(accountProfile, k.campaignName, k.adGroupName)

  const systemPrompt =
    `Act as a Google Ads optimization specialist.\n\n` +
    `Analyze the provided keyword using Google's three Quality Score components:\n` +
    `1. Expected CTR\n2. Ad relevance\n3. Landing-page experience\n\n` +
    `Use the Google-provided component ratings as the source of truth. Also analyze the keyword, match type, performance metrics, search terms, RSA content, landing-page content and business context.\n\n` +
    `Requirements:\n` +
    `- Identify the weakest Quality Score component.\n` +
    `- Give a maximum of five prioritized, keyword-specific recommendations.\n` +
    `- Explain why each recommendation may improve that component.\n` +
    `- Provide revised headlines or descriptions when ad relevance or expected CTR needs improvement.\n` +
    `- When a recommendation's "action" is a headline or description change, "suggestion" MUST be exactly ONE ready-to-use piece of ad copy — a single headline of 30 characters or less, or a single description of 90 characters or less — never a paragraph, never multiple alternatives bundled together, and never prefixed with "Replace X with Y" framing. If several copy changes are warranted, split them into separate recommendation entries, each with its own one-line suggestion.\n` +
    `- For a recommendation that is NOT a specific piece of ad copy (e.g. ad-group restructuring, negative keywords, landing-page changes, bidding/monitoring advice), "suggestion" should be a short actionable phrase (not full ad copy) or left empty — put the full detail in "reason" instead.\n` +
    `- Recommend ad-group restructuring only when search intents are mixed.\n` +
    `- Recommend landing-page changes only after checking the actual content.\n` +
    `- Do not guarantee that Quality Score will increase.\n` +
    `- Do not invent an exact future Quality Score.\n` +
    `- Do not recommend adding a keyword unnaturally or repeatedly.\n` +
    `- Consider conversion rate and cost per conversion before recommending that a keyword be paused.\n` +
    `- Return valid JSON.\n\n` +
    `RECOMMENDATION LOGIC — map the weakest component to the right kind of fix:\n` +
    `Expected CTR weak -> Improve offer, CTA and headline variety; add negatives; review irrelevant search terms.\n` +
    `Ad relevance weak -> Add keyword intent naturally to RSA copy; separate mixed-intent keywords into tighter ad groups.\n` +
    `Landing-page experience weak -> Improve H1/content relevance, intent match, CTA, mobile usability and page performance.\n` +
    `All components strong -> Focus on conversion rate, CPA and search-term quality.\n` +
    `No Quality Score -> Explain that Google has insufficient exact-search data.\n\n` +
    `IMPORTANT SAFEGUARD: Do not recommend pausing a keyword only because its Quality Score is low. A keyword with a low Quality Score but real conversions at a profitable cost per conversion may still be valuable — "priority" must weigh Quality Score weakness together with traffic volume, conversion performance, and cost impact, not Quality Score alone.\n\n` +
    `Return ONLY valid JSON, no markdown, matching this exact shape (these are the required keys — fill them with real analysis for THIS keyword, not the example text):\n` +
    `{\n` +
    `  "keyword": "",\n` +
    `  "qualityScore": 0,\n` +
    `  "priority": "High|Medium|Low",\n` +
    `  "weakestComponent": "Expected CTR|Ad relevance|Landing-page experience|None|Insufficient data",\n` +
    `  "summary": "",\n` +
    `  "recommendations": [\n` +
    `    { "action": "", "suggestion": "", "reason": "" }\n` +
    `  ],\n` +
    `  "expectedImpact": ""\n` +
    `}`

  const userPrompt =
    `KEYWORD: "${k.text || ''}" (${k.matchType || ''} match)\n` +
    `Campaign: ${k.campaignName || ''}\n` +
    `Ad Group: ${k.adGroupName || ''}\n` +
    `Quality Score: ${qualityScore || 0}/10${hasQs ? '' : ' (no data)'}\n` +
    `QUALITY SCORE COMPONENTS:\n${componentsBlock}\n` +
    `PERFORMANCE:\n` +
    `Impressions: ${Number(k.impressions || 0).toLocaleString()}\n` +
    `Clicks: ${clicks.toLocaleString()}\n` +
    `CTR: ${Number(k.ctr || 0).toFixed(2)}%\n` +
    `Conversions: ${conversions}\n` +
    `Conversion rate: ${convRate.toFixed(2)}%\n` +
    `Cost: $${cost.toFixed(2)}\n` +
    `Cost per conversion: ${costPerConv != null ? '$' + costPerConv.toFixed(2) : 'N/A (no conversions)'}\n\n` +
    `SEARCH TERMS THAT TRIGGERED THIS KEYWORD (up to 20, by cost):\n${termsBlock}\n\n` +
    `CURRENT RSA HEADLINES:\n${headlinesBlock}\n\n` +
    `CURRENT RSA DESCRIPTIONS:\n${descriptionsBlock}\n\n` +
    `FINAL LANDING PAGE URL: ${finalUrl || '(none found)'}\n` +
    `LANDING PAGE CONTENT:\n${lpBlock}` +
    businessContext +
    `\n\nCRITICAL: Return ONLY a raw JSON object. No markdown, no code fences. Start with { and end with }.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const raw2 = (message.content[0]?.text || '').trim()
  function extractTopLevelJSON(text) {
    let depth = 0, start = -1
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '{') { if (start === -1) start = i; depth++ }
      else if (ch === '}') { depth--; if (depth === 0 && start !== -1) return text.slice(start, i + 1) }
    }
    return null
  }
  let analysis = null
  for (const candidate of [raw2, raw2.replace(/```json\s*/g, '').replace(/```/g, '').trim(), extractTopLevelJSON(raw2)]) {
    if (!candidate) continue
    try { const p = JSON.parse(candidate); if (p && typeof p === 'object') { analysis = p; break } } catch {}
  }
  if (!analysis) {
    console.error('[keywordManager:aiAnalyzeQualityScore] failed to parse AI response:\n', raw2)
    throw new Error('AI did not return a valid analysis. Please try again.')
  }

  // Returned alongside the analysis so "Apply Suggested RSA Content" can act
  // on the exact ad/current-content the analysis was based on, without a
  // second round trip that could race against a concurrent edit.
  return {
    analysis,
    context: primaryAd ? {
      adId:         primaryAd.adId,
      headlines:    primaryAd.headlines,
      descriptions: primaryAd.descriptions,
      path1:        primaryAd.path1,
      path2:        primaryAd.path2,
      finalUrl,
    } : null,
  }
})

// New-keyword suggestions for the Add New Keywords tab — mines this ad
// group's ACTUAL performance data (existing keyword performance, search
// terms that triggered its ads) rather than guessing blind from just the
// ad group name, and is told about existing negatives so it doesn't
// recommend something Google Ads would reject as a conflict anyway.
ipcMain.handle('keywordManager:aiRecommendNewKeywords', async (_e, { campaignName, adGroupName, existingKeywords, searchTerms, negativeKeywordTexts }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const kwLines = (existingKeywords || []).slice(0, 40).map(k => {
    const convRate = k.clicks > 0 ? (Number(k.conversions||0) / k.clicks * 100).toFixed(1) : '0.0'
    const costPerConv = k.conversions > 0 ? (Number(k.cost||0) / k.conversions).toFixed(2) : '—'
    return `  - "${k.text}" · ${k.matchType} · ${k.status || 'Active'} · ${k.impressions||0} impr · ${k.clicks||0} clicks · ${Number(k.ctr||0).toFixed(1)}% CTR · $${Number(k.cpc||0).toFixed(2)} avg CPC · $${Number(k.cost||0).toFixed(2)} cost · ${k.conversions||0} conv (${convRate}% conv rate) · ${k.formConversions||0} form conv · ${k.phoneConversions||0} phone conv · $${costPerConv} cost/conv · QS ${k.qualityScore||0}`
  }).join('\n') || '  (none yet)'

  const termLines = (searchTerms || [])
    .slice().sort((a, b) => (b.cost||0) - (a.cost||0)).slice(0, 40)
    .map(t => `  - "${t.term}" · ${t.impressions||0} impr · ${t.clicks||0} clicks · ${t.conversions||0} conv · $${Number(t.cost||0).toFixed(2)} cost`)
    .join('\n') || '  (none yet)'

  const negLines = (negativeKeywordTexts || []).slice(0, 60).map(t => `  - "${t}"`).join('\n') || '  (none)'

  const prompt =
    `You are an expert Google Ads keyword strategist focused on generating high-intent, highly converting keywords for lead-generation campaigns.\n\n` +
    `Your task is to analyze the selected Ad Group and recommend NEW keywords that have strong potential to generate qualified leads FROM BUYERS — people actively ready to hire, purchase, request a quote, or book a consultation right now, not people still researching or comparing options.\n\n` +
    `Analyze all of the following inputs:\n\n` +
    `1. EXISTING KEYWORDS (text · match type · status · impressions · clicks · CTR · avg CPC · cost · conversions (conv rate) · form conversions · phone call conversions · cost per conversion · quality score):\n${kwLines}\n\n` +
    `2. REAL SEARCH TERMS that actually triggered this ad group's ads (term · impressions · clicks · conversions · cost), sorted by cost. Prioritize terms showing high commercial intent, strong relevance, high CTR, conversions, form conversions, phone call conversions, low cost per conversion, and strong lead potential. A term with clicks or conversions that isn't already an exact-match keyword above is a strong, proven candidate:\n${termLines}\n\n` +
    `3. EXISTING NEGATIVE KEYWORDS that apply here — do not recommend keywords that match or duplicate these, conflict with their intent, are likely to generate the type of irrelevant traffic already excluded, or are clearly informational, educational, employment-related, free-tool-related, or otherwise irrelevant when this negative keyword strategy indicates they should be excluded:\n${negLines}\n\n` +
    `4. AD GROUP CONTEXT — consider the campaign name, ad group name, ad group theme, existing landing page/service, and existing keyword intent:\n` +
    `   CAMPAIGN: ${campaignName || '(untitled)'}\n   AD GROUP: ${adGroupName || '(untitled)'}\n\n` +
    `OBJECTIVE\n` +
    `Generate NEW keyword opportunities that are highly relevant to this specific Ad Group and reflect BUYER intent — the strongest possible potential to generate qualified leads, not general interest or research-stage traffic.\n\n` +
    `IMPORTANT RULES\n` +
    `- Focus exclusively on BUYER-intent keywords: someone ready to hire, purchase, request a quote, get pricing, or book a consultation. Reject anything that reads as research, comparison-shopping, "how to," or general informational intent.\n` +
    `- Do NOT simply generate generic keyword variations.\n` +
    `- Do NOT recommend a keyword that already exists in the selected Ad Group above (same or near-identical text) — this is a hard rule, not a preference. Check every candidate against the existing keyword list before including it.\n` +
    `- Do NOT recommend keywords that are already covered by an existing keyword unless there is a clear strategic reason.\n` +
    `- Prioritize keywords discovered from real converting search terms.\n` +
    `- Identify patterns among search terms that generated conversions, phone calls, or form submissions.\n` +
    `- Expand successful search-term patterns into closely related keyword opportunities.\n` +
    `- Prioritize commercial and transactional intent over informational intent.\n` +
    `- Avoid broad, vague, low-intent keywords.\n` +
    `- Respect the existing negative keyword strategy.\n` +
    `- Keep every recommendation tightly aligned with the selected Ad Group.\n` +
    `- Do not recommend keywords that belong to another service or Ad Group.\n` +
    `- Prefer keywords that indicate a user is looking for a service, provider, solution, quote, consultation, or purchase.\n` +
    `- Consider both exact high-intent phrases and closely related variations.\n` +
    `- Recommend the most appropriate match type for each keyword.\n` +
    `- Do not recommend Broad Match unless there is sufficient evidence that broad targeting is likely to be beneficial.\n\n` +
    `WHEN THIS AD GROUP HAS LITTLE OR NO PERFORMANCE DATA (existing keywords show near-zero impressions/clicks/conversions and there are few or no real search terms to analyze) — do NOT default to returning nothing. A lack of history is not the same as a lack of opportunity: fall back to your expert knowledge of what buyer-intent keywords reliably convert for this type of business, inferred from the campaign name, ad group name, ad group theme, and the wording/pattern of whatever existing keywords ARE there (even with zero data, an existing keyword's TEXT still tells you the service and market). Recommend the strongest, most universally-proven high-intent keyword patterns for that specific service — the kind of urgency, hire, quote, cost, and "near me"-style buyer phrasing that reliably converts across this industry — rather than declining. In this fallback mode, base leadPotentialScore and confidence on how well-established and strong the buyer-intent signal is for that keyword pattern in this industry, not on this ad group's own historical data (which doesn't exist yet to judge by). Only fall back to declining (empty array + noRecommendationsReason) if the ad group's theme/service itself is too unclear or ambiguous to confidently infer what a buyer-intent keyword would even look like — not merely because performance data is missing.\n\n` +
    `Whichever mode applies, ONLY include a keyword if you are highly confident it will perform — every keyword you return must score ABOVE 90 on the 0-100 leadPotentialScore scale and be HIGH confidence. Do not include anything you'd rate lower than that, even if it's the best of a weak batch — leave it out instead.\n\n` +
    `RANKING\nRank recommendations based primarily on:\n` +
    `1. Historical conversion performance (when available)\n2. Phone call/form lead performance (when available)\n3. Commercial/buyer intent strength\n4. Relevance to the Ad Group\n5. Cost efficiency (when available)\n6. CTR (when available)\n7. Search-term evidence (when available)\n8. Search volume/potential traffic\n\n` +
    `For each recommended keyword, provide: text (the keyword), matchType (BROAD/PHRASE/EXACT), leadPotentialScore (an integer above 90), confidence (must be "High"), and expectedBenefit — 1-2 sentences that both justify the recommendation (cite the specific data point when real performance data exists, or explain why it's a well-established high-converting buyer-intent pattern for this type of service when it doesn't) AND state the concrete upside. Wrap the single most important phrase or data point in expectedBenefit in **double asterisks** to highlight it (e.g. "**Generated 9 conversions at a 22% conversion rate** as a search term not yet targeted as an exact match." or "A **proven top-converting pattern** for this service, filling a gap the existing keywords leave open."). Highlight only one short phrase per keyword — not the whole sentence.\n\n` +
    `Return only the strongest and most actionable buyer-intent keyword opportunities — the goal is NOT to maximize the number of keywords, it is to identify a small set of NEW keywords with the highest probability of generating qualified leads while minimizing irrelevant traffic and wasted spend. It is completely acceptable — expected, even — to return very few keywords or none at all if nothing clears the score-90/High-confidence bar, but "no performance data yet" by itself is NOT a valid reason to return an empty list — use the fallback mode above instead. If there are truly no strong new keyword opportunities, return an empty keywords array and explain why in noRecommendationsReason.\n\n` +
    `Return ONLY valid JSON, no markdown:\n` +
    `{"keywords":[{"text":"","matchType":"BROAD|PHRASE|EXACT","leadPotentialScore":0,"confidence":"High","expectedBenefit":""}],"noRecommendationsReason":""}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  let parsed
  try {
    parsed = JSON.parse(match?.[0] || '{}')
  } catch {
    throw new Error('AI did not return valid keyword suggestions. Please try again.')
  }
  const validMatchTypes = ['BROAD', 'PHRASE', 'EXACT']
  const existingLower = new Set((existingKeywords || []).map(k => `${(k.text||'').toLowerCase().trim()}|${(k.matchType||'').toUpperCase()}`))
  const keywords = (parsed.keywords || []).slice(0, 15)
    .map(k => ({
      text: String(k.text || '').trim(),
      matchType: validMatchTypes.includes(String(k.matchType || '').toUpperCase()) ? String(k.matchType).toUpperCase() : 'BROAD',
      leadPotentialScore: Math.max(0, Math.min(100, Math.round(Number(k.leadPotentialScore) || 0))),
      confidence: 'High',
      expectedBenefit: String(k.expectedBenefit || '').trim(),
    }))
    // Score-above-90/High-confidence is a hard bar per the prompt — enforced
    // here too rather than trusting the model's compliance, same defensive
    // pattern used everywhere else this app sanitizes AI output.
    .filter(k => k.text && k.leadPotentialScore > 90 && !existingLower.has(`${k.text.toLowerCase()}|${k.matchType}`))
  return { keywords, noRecommendationsReason: keywords.length === 0 ? String(parsed.noRecommendationsReason || '').trim() : '' }
})

ipcMain.handle('keywordManager:aiRecommendNegativeKeywords', async (_e, {
  campaignName, adGroupName, existingKeywords, searchTerms,
  campaignLevelNegatives, adGroupLevelNegatives, negativeLists, userContext,
}) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  const anthropic = await getAnthropicClient(settings.claudeApiKey)

  const kwLines = (existingKeywords || []).slice(0, 60).map(k => {
    const convRate = k.clicks > 0 ? (Number(k.conversions||0) / k.clicks * 100).toFixed(1) : '0.0'
    return `  - "${k.text}" · ${k.matchType} · ${k.status || 'Active'} · ${k.impressions||0} impr · ${k.clicks||0} clicks · ${Number(k.ctr||0).toFixed(1)}% CTR · $${Number(k.cpc||0).toFixed(2)} avg CPC · $${Number(k.cost||0).toFixed(2)} cost · ${k.conversions||0} conv (${convRate}% conv rate) · ${k.formConversions||0} form conv · ${k.phoneConversions||0} phone conv`
  }).join('\n') || '  (none yet)'

  const termLines = (searchTerms || [])
    .slice().sort((a, b) => (b.cost||0) - (a.cost||0)).slice(0, 80)
    .map(t => `  - "${t.term}" · ${t.impressions||0} impr · ${t.clicks||0} clicks · ${t.conversions||0} conv · $${Number(t.cost||0).toFixed(2)} cost`)
    .join('\n') || '  (none — this ad group has no recorded search-term history yet)'

  const campNegLines = (campaignLevelNegatives || []).slice(0, 100).map(n => `  - "${n.text}" (${n.matchType})`).join('\n') || '  (none)'
  const agNegLines   = (adGroupLevelNegatives || []).slice(0, 100).map(n => `  - "${n.text}" (${n.matchType})`).join('\n') || '  (none)'
  const listLines = (negativeLists || []).slice(0, 20).map(l =>
    `  - LIST "${l.name}":\n${(l.keywords || []).slice(0, 100).map(k => `      - "${k.text}" (${k.matchType})`).join('\n') || '      (empty)'}`
  ).join('\n') || '  (none)'

  const hasHistory = (existingKeywords || []).some(k => (k.impressions||0) > 0 || (k.clicks||0) > 0) || (searchTerms || []).length > 0
  const scenarioNote = hasHistory
    ? `DATA AVAILABILITY: This ad group has real performance history — apply SCENARIO 1 (existing account).`
    : `DATA AVAILABILITY: This ad group has NO recorded impressions, clicks, or search-term history — apply SCENARIO 2 (new account / pre-launch strategy). Base recommendations on business/campaign/ad-group context, not on absent performance data.`

  const contextLines = String(userContext || '').trim()

  const prompt =
`You are an expert Google Ads Negative Keyword Strategist specializing in lead-generation campaigns.

Your objective is to generate a strong, relevant, and safe negative keyword strategy that reduces wasted ad spend while protecting high-intent searches that can generate qualified leads.

You must support TWO scenarios:

SCENARIO 1 — EXISTING ACCOUNT
Historical data is available, including:
- Search terms
- Existing keywords
- Keyword match types
- Impressions
- Clicks
- CTR
- CPC
- Cost
- Conversions
- Form conversions
- Phone conversions
- Campaigns
- Ad groups
- Existing campaign-level negative keywords
- Existing ad-group-level negative keywords
- Negative keyword lists

Use the historical data to identify:
- Irrelevant search terms
- Search terms with clearly unwanted intent
- High-spend searches with no conversions when the intent is also irrelevant
- Recurring irrelevant search patterns
- Search-term clusters that can be blocked using a common negative keyword
- Wrong service/product intent
- Wrong location intent
- Employment/job intent
- Education/training intent
- Free/DIY intent
- Research/informational intent when clearly unsuitable for the business
- Other patterns that consistently waste spend

Prioritize actual search-term evidence over assumptions.

SCENARIO 2 — NEW ACCOUNT
There is no historical search-term data and no keyword performance data.

In this case, generate a PRE-LAUNCH negative keyword strategy based on:
- Business/service offered
- Campaign type
- Campaign name
- Ad group name
- Existing keywords
- Keyword themes
- Landing page/service
- Target location
- Business model
- Customer intent
- Industry
- User-provided exclusions

For a new account, focus on high-confidence, universally irrelevant intent categories rather than aggressively blocking potentially valuable searches.

Examples of potential categories to evaluate:
- Jobs
- Careers
- Employment
- Salary
- Internship
- Resume
- Course
- Training
- Certification
- Tutorial
- Free
- Download
- Template
- DIY
- Software
- Tool
- Definition
- Meaning
- Wikipedia
- Research
- School
- College
- Academic
- Used
- Wholesale
- Supplier
- Other clearly irrelevant intents

IMPORTANT:
Do NOT automatically add all of these categories. Determine whether each category is actually irrelevant to the selected business, campaign, and ad group.

NEGATIVE KEYWORD DECISION RULES:

1. Protect high-commercial-intent searches.
2. Never recommend a negative keyword simply because it has low search volume.
3. Never recommend a negative keyword simply because it has zero conversions.
4. Distinguish between:
   - Poor-performing but relevant traffic
   - Clearly irrelevant traffic
5. If historical data exists, give greater weight to actual search-term behavior.
6. If historical data does not exist, use conservative industry/business-intent analysis.
7. Check existing negative keywords and negative keyword lists to avoid duplicates.
8. Do not recommend a negative keyword that could block valuable commercial searches.
9. Identify recurring patterns and prefer a single safe negative keyword when it can eliminate multiple irrelevant searches.
10. Be especially careful with broad negative keywords.
11. Recommend the appropriate negative match type:
   - Exact
   - Phrase
   - Broad, only when clearly safe and supported
12. If confidence is low, recommend REVIEW instead of automatically recommending the negative keyword.

CAMPAIGN-LEVEL VS AD-GROUP-LEVEL:

Determine whether each recommendation should be:
- Campaign-level negative
- Ad-group-level negative
- Negative keyword list candidate

Use Campaign-level when the intent should be excluded across the entire campaign.

Use Ad-group-level when the search may be relevant to another ad group but is irrelevant to the selected ad group.

Use Negative Keyword List when the same exclusion is appropriate across multiple campaigns.

FOR EACH RECOMMENDATION RETURN:

- Negative Keyword
- Recommended Match Type
- Recommended Level
- Intent Category
- Negative Potential Score (0-100)
- Confidence (High / Medium / Low)
- Reason
- Expected Impact
- Supporting Search Terms, if historical data exists
- Historical Impressions, if available
- Historical Clicks, if available
- Historical Cost, if available
- Historical Conversions, if available
- Existing Negative Conflict: Yes / No
- Recommendation: Add / Review / Do Not Add

SCORING:

Calculate Negative Potential Score based on:

For EXISTING ACCOUNTS:
- Irrelevance of intent
- Historical wasted spend
- Number of irrelevant searches
- Click volume
- Cost
- Conversion performance
- Recurring pattern
- Safety of excluding the keyword

For NEW ACCOUNTS:
- Irrelevance of intent
- Business/service mismatch
- Campaign/ad-group mismatch
- Likelihood of generating unqualified traffic
- Safety of excluding the keyword
- Strength of the exclusion pattern

OUTPUT CATEGORIES:

🔴 HIGH PRIORITY
Clearly irrelevant and safe to exclude.

🟠 REVIEW
Potentially irrelevant but could block valuable traffic.

🟢 DO NOT ADD
Relevant or potentially valuable search intent.

For an EXISTING ACCOUNT, prioritize recommendations backed by real search-term data.

For a NEW ACCOUNT, prioritize a small set of high-confidence pre-launch negatives and avoid creating an unnecessarily large negative list.

The final goal is:

MAXIMIZE RELEVANT LEAD TRAFFIC
while
MINIMIZING IRRELEVANT CLICKS AND WASTED SPEND.

Do not generate negative keywords merely to make the list longer. Quality, relevance, safety, and evidence are more important than quantity.

── ACCOUNT DATA ──

${scenarioNote}

CAMPAIGN: ${campaignName || '(untitled)'}
AD GROUP: ${adGroupName || '(untitled)'}

EXISTING KEYWORDS IN THIS AD GROUP (text · match type · status · impressions · clicks · CTR · avg CPC · cost · conversions (conv rate) · form conversions · phone conversions):
${kwLines}

REAL SEARCH TERMS that triggered this ad group's ads (term · impressions · clicks · conversions · cost), sorted by cost:
${termLines}

EXISTING CAMPAIGN-LEVEL NEGATIVE KEYWORDS (direct, not via a list) for this campaign:
${campNegLines}

EXISTING AD-GROUP-LEVEL NEGATIVE KEYWORDS for this ad group:
${agNegLines}

EXISTING NEGATIVE KEYWORD LISTS attached to this campaign, with their member keywords:
${listLines}

${contextLines ? `USER-PROVIDED BUSINESS CONTEXT / EXCLUSIONS:\n${contextLines}\n` : ''}
Return recommendations across all three output categories (HIGH PRIORITY / REVIEW / DO NOT ADD) so the reasoning is transparent, but keep the total list focused — quality over quantity, per the rules above. Return AT MOST 25 recommendations total across all three categories, and keep "reason" and "expectedImpact" each to one concise sentence.

For each item's "level" field use exactly one of: CAMPAIGN, AD_GROUP, LIST.
For "matchType" use exactly one of: EXACT, PHRASE, BROAD.
For "recommendation" use exactly one of: Add, Review, DoNotAdd.
Set "existingNegativeConflict" to true only if the keyword text already matches (or is already covered by) one of the existing negative keywords or list entries shown above.

Return ONLY valid JSON, no markdown:
{"scenario":"EXISTING|NEW","recommendations":[{"text":"","matchType":"EXACT|PHRASE|BROAD","level":"CAMPAIGN|AD_GROUP|LIST","intentCategory":"","negativePotentialScore":0,"confidence":"High|Medium|Low","reason":"","expectedImpact":"","supportingSearchTerms":[""],"historicalImpressions":0,"historicalClicks":0,"historicalCost":0,"historicalConversions":0,"existingNegativeConflict":false,"recommendation":"Add|Review|DoNotAdd"}]}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = message.content[0]?.text || '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  let parsed
  try {
    parsed = JSON.parse(match?.[0] || '{}')
  } catch {
    throw new Error('AI did not return valid negative keyword suggestions. Please try again.')
  }

  const validMatchTypes  = ['EXACT', 'PHRASE', 'BROAD']
  const validLevels      = ['CAMPAIGN', 'AD_GROUP', 'LIST']
  const validConfidence  = ['High', 'Medium', 'Low']
  const validRecs        = ['Add', 'Review', 'DoNotAdd']

  const recommendations = (parsed.recommendations || []).slice(0, 60)
    .map(r => ({
      text: String(r.text || '').trim(),
      matchType: validMatchTypes.includes(String(r.matchType || '').toUpperCase()) ? String(r.matchType).toUpperCase() : 'EXACT',
      level: validLevels.includes(String(r.level || '').toUpperCase()) ? String(r.level).toUpperCase() : 'AD_GROUP',
      intentCategory: String(r.intentCategory || '').trim(),
      negativePotentialScore: Math.max(0, Math.min(100, Math.round(Number(r.negativePotentialScore) || 0))),
      confidence: validConfidence.includes(r.confidence) ? r.confidence : 'Medium',
      reason: String(r.reason || '').trim(),
      expectedImpact: String(r.expectedImpact || '').trim(),
      supportingSearchTerms: Array.isArray(r.supportingSearchTerms) ? r.supportingSearchTerms.map(t => String(t || '').trim()).filter(Boolean).slice(0, 10) : [],
      historicalImpressions: Math.max(0, Math.round(Number(r.historicalImpressions) || 0)),
      historicalClicks:      Math.max(0, Math.round(Number(r.historicalClicks) || 0)),
      historicalCost:        Math.max(0, Number(r.historicalCost) || 0),
      historicalConversions: Math.max(0, Number(r.historicalConversions) || 0),
      existingNegativeConflict: !!r.existingNegativeConflict,
      recommendation: validRecs.includes(r.recommendation) ? r.recommendation : 'Review',
    }))
    .filter(r => r.text)

  const scenario = parsed.scenario === 'NEW' || parsed.scenario === 'EXISTING' ? parsed.scenario : (hasHistory ? 'EXISTING' : 'NEW')
  return { recommendations, scenario }
})

ipcMain.handle('assetGroup:list', async (_e, { customerId, campaignId, hidePaused }) => {
  const { client, settings } = await getClient()
  return await listAssetGroups(client, customerId, settings.mccCustomerId, campaignId, { hidePaused })
})

ipcMain.handle('assetGroup:getDetail', async (_e, { customerId, assetGroupId }) => {
  const { client, settings } = await getClient()
  return await getAssetGroupDetail(client, customerId, settings.mccCustomerId, assetGroupId)
})

ipcMain.handle('assetGroup:updateContent', async (_e, { customerId, assetGroupId, assetGroupName, before, ...args }) => {
  const { client, settings } = await getClient()
  const result = await updateAssetGroupContent(client, customerId, settings.mccCustomerId, { assetGroupId, ...args })
  if (args.validateOnly || result.noChanges) return result

  const after = await getAssetGroupDetail(client, customerId, settings.mccCustomerId, assetGroupId)
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'assetGroup', action: 'updateContent',
    customerId, assetGroupId, assetGroupName: assetGroupName || after.name,
    before, after,
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('assetGroup:create', async (_e, { customerId, campaignId, campaignName, ...args }) => {
  const { client, settings } = await getClient()
  const result = await createAssetGroup(client, customerId, settings.mccCustomerId, { campaignId, ...args })
  if (args.validateOnly) return result

  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'assetGroup', action: 'create',
    customerId, campaignId, assetGroupName: args.name,
    before: null, after: result,
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('assetGroup:updateName', async (_e, { customerId, assetGroupId, name, before, validateOnly }) => {
  const { client, settings } = await getClient()
  const result = await updateAssetGroupName(client, customerId, settings.mccCustomerId, { assetGroupId, name, validateOnly })
  if (validateOnly) return result
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'assetGroup', action: 'updateName',
    customerId, assetGroupId, assetGroupName: name,
    before, after: { name },
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('assetGroup:updateStatus', async (_e, { customerId, assetGroupId, assetGroupName, status, before, validateOnly }) => {
  const { client, settings } = await getClient()
  const result = await updateAssetGroupStatus(client, customerId, settings.mccCustomerId, { assetGroupId, status, validateOnly })
  if (validateOnly) return result
  const entry = {
    id: makeChangelogId(), timestamp: new Date().toISOString(),
    type: 'assetGroup', action: 'updateStatus',
    customerId, assetGroupId, assetGroupName,
    before, after: { status },
    errors: [], rolledBack: false,
  }
  await appendChangelog(entry)
  return { ...result, entryId: entry.id }
})

ipcMain.handle('assetGroup:getChangelog', async (_e, { customerId } = {}) => {
  const entries = await readChangelog()
  return entries.filter(e => e.type === 'assetGroup' && (!customerId || String(e.customerId) === String(customerId)))
})

ipcMain.handle('assetGroup:rollback', async (_e, { entryId, customerId }) => {
  const { client, settings } = await getClient()
  const entries = await readChangelog()
  const entry   = entries.find(e => e.id === entryId)
  if (!entry)          throw new Error('Change log entry not found')
  if (entry.type !== 'assetGroup') throw new Error('This change log entry is not an Asset Group change.')
  if (entry.rolledBack) throw new Error('Already rolled back')

  let res
  if (entry.action === 'create') {
    res = await rollbackAssetGroupCreate(client, customerId, settings.mccCustomerId, {
      assetGroupResourceName: entry.after?.assetGroupResourceName,
    })
  } else {
    res = await rollbackAssetGroupUpdate(client, customerId, settings.mccCustomerId, {
      action: entry.action, assetGroupId: entry.assetGroupId, before: entry.before, after: entry.after,
    })
  }
  await patchChangelogEntry(entryId, {
    rolledBack: true, rollbackAt: new Date().toISOString(), rollbackErrors: res.errors || [],
  })
  return res
})

ipcMain.handle('pdf:export', async (_e, opts = {}) => {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) throw new Error('No active window')
  const stamp   = new Date().toISOString().slice(0, 10)
  const name    = opts.accountName ? `${opts.accountName.replace(/[/\\?%*:|"<>]/g, '-')}-` : ''
  const section = opts.section    ? `${opts.section}-` : ''
  const defName = `GAds-${section}${name}${stamp}.pdf`
  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    title: 'Export as PDF', defaultPath: defName,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return { canceled: true }

  // Expand all containers and remove nav chrome not useful in print
  await win.webContents.executeJavaScript(`document.documentElement.classList.add('pdf-printing'); true`)
  await new Promise(r => setTimeout(r, 800))

  let pdfBuffer
  try {
    // Cap content width at 1800px so PDF font size is consistent across monitor sizes
    await win.webContents.executeJavaScript(
      `(function(){ var el = document.querySelector('.app-main'); if (el) el.style.maxWidth = '1800px'; })(); true`
    )
    await new Promise(r => setTimeout(r, 200))

    // Measure the capped content width (sidebar already hidden by pdf-printing CSS).
    // A wide table (many columns — e.g. Keywords' "All Keywords" with Form
    // Conv./Phone Conv. etc.) can render WIDER than .app-main's own box even
    // though overflow is forced to 'visible' for print — that fix stops the
    // extra columns from being clipped by a scrollbar, but the zoom below
    // still needs to know the table's true rendered width to shrink enough
    // to fit every column on the page, not just the container's width.
    const contentW = await win.webContents.executeJavaScript(
      `(function(){
        var el = document.querySelector('.app-main');
        var widest = el ? el.clientWidth : Math.min(window.innerWidth, 1800);
        document.querySelectorAll('table').forEach(function(t){ if (t.scrollWidth > widest) widest = t.scrollWidth; });
        if (document.body.scrollWidth > widest) widest = document.body.scrollWidth;
        return widest;
      })()`
    )

    // A4 portrait at 96 dpi = 794 px wide.
    // Subtract ~52 px for Chromium's default ~7 mm margins on each side.
    // zoom < 1 scales content down to fit; never scale up (min 1).
    const a4UsablePx = 742
    const zoom = Math.min(1, a4UsablePx / Math.max(contentW, 100))

    // Apply zoom so content fills A4 width exactly, then wait for reflow
    await win.webContents.executeJavaScript(
      `document.body.style.zoom = '${zoom.toFixed(6)}'; true`
    )
    await new Promise(r => setTimeout(r, 300))

    pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize:        'A4',
      landscape:       false,
    })
  } finally {
    await win.webContents.executeJavaScript(
      `document.documentElement.classList.remove('pdf-printing'); document.body.style.zoom = ''; (function(){ var el = document.querySelector('.app-main'); if (el) el.style.maxWidth = ''; })(); true`
    )
  }

  await fs.promises.writeFile(filePath, pdfBuffer)
  return { success: true }
})

// Exports the SAME live-rendered DOM the PDF export captures, but as a
// standalone HTML file instead of rasterizing to PDF — this guarantees a
// pixel-for-pixel match with the app's own UI (same markup, same CSS rules,
// same rendered Recharts SVGs) rather than a separately-built template.
// Lowercase, hyphen-separated, filesystem-safe slug — strips accents and any
// character that isn't a-z/0-9, collapses repeats, trims leading/trailing hyphens.
function slugify(str) {
  return String(str || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

ipcMain.handle('html:export', async (_e, opts = {}) => {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) throw new Error('No active window')
  const stamp   = new Date().toISOString().slice(0, 10)
  const defName = ['gads', opts.section, opts.accountName, stamp]
    .map(slugify).filter(Boolean).join('-') + '.html'
  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    title: 'Export as HTML', defaultPath: defName,
    filters: [{ name: 'HTML Files', extensions: ['html'] }],
  })
  if (canceled || !filePath) return { canceled: true }

  // Same chrome-hiding / full-height expansion already proven for PDF export
  await win.webContents.executeJavaScript(`document.documentElement.classList.add('pdf-printing'); true`)
  await new Promise(r => setTimeout(r, 800))

  let payload
  try {
    const raw = await win.webContents.executeJavaScript(`
      (function() {
        var styles = '';
        for (var i = 0; i < document.styleSheets.length; i++) {
          try {
            var sheet = document.styleSheets[i];
            var rules = sheet.cssRules || sheet.rules;
            if (!rules) continue;
            for (var j = 0; j < rules.length; j++) { styles += rules[j].cssText + '\\n'; }
          } catch (e) { /* cross-origin stylesheet rules inaccessible — its @import line is still captured from the parent sheet */ }
        }
        var root = document.querySelector('.app-main');
        return JSON.stringify({ styles: styles, content: root ? root.outerHTML : document.body.outerHTML, title: document.title });
      })()
    `)
    payload = JSON.parse(raw)
  } finally {
    await win.webContents.executeJavaScript(`document.documentElement.classList.remove('pdf-printing'); true`)
  }

  const pageTitle = `${opts.section || 'Report'}${opts.accountName ? ' — ' + opts.accountName : ''}`
  const fullHtml =
`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pageTitle}</title>
<style>
${payload.styles}
html, body { margin: 0; padding: 0; }
body { background: #f4f6f9; padding: 20px; overflow: auto; }
.export-container { max-width: 1500px; margin: 0 auto; }
.no-print, .no-html-export { display: none !important; }
</style>
</head>
<body>
<div class="export-container">
${payload.content}
</div>
</body>
</html>`

  await fs.promises.writeFile(filePath, fullHtml, 'utf8')
  return { success: true }
})
