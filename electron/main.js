'use strict'

const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs   = require('fs')

const store = require('./store')
const {
  createClient, listSubAccounts, fetchDashboardData,
  fetchCallLeads, fetchWastedSpend, fetchTopConvertingAds,
  fetchNegativeData, fetchAuditData, fetchReportData, fetchKeywordsWithCalls,
} = require('./googleAdsClient')

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

// ── Settings ─────────────────────────────────────────────────────────────────

ipcMain.handle('settings:get', async () => store.getSettings())
ipcMain.handle('settings:save', async (_e, data) => { await store.saveSettings(data); return { success: true } })

// ── Preferences ───────────────────────────────────────────────────────────────

ipcMain.handle('prefs:get', async () => store.getPrefs())
ipcMain.handle('prefs:set', async (_e, data) => { await store.savePrefs(data); return { success: true } })

// ── Accounts ─────────────────────────────────────────────────────────────────

ipcMain.handle('accounts:fetch', async () => {
  const { client, settings } = await getClient()
  return listSubAccounts(client, settings.mccCustomerId)
})

// ── Dashboard ─────────────────────────────────────────────────────────────────

ipcMain.handle('dashboard:fetch', async (_e, { customerId, dateRange }) => {
  const { client, settings } = await getClient()
  const data = await fetchDashboardData(client, customerId, settings.mccCustomerId, dateRange)
  await store.saveLastAccount(customerId)
  return data
})

ipcMain.handle('data:refresh', async (_e, { customerId, dateRange }) => {
  const { client, settings } = await getClient()
  return fetchDashboardData(client, customerId, settings.mccCustomerId, dateRange)
})

// ── Reports ───────────────────────────────────────────────────────────────────

ipcMain.handle('reports:fetch', async (_e, { customerId, dateRange, reportType }) => {
  const { client, settings } = await getClient()
  return fetchReportData(client, customerId, settings.mccCustomerId, dateRange, reportType)
})

// ── Call leads ────────────────────────────────────────────────────────────────

ipcMain.handle('calls:fetch', async (_e, { customerId, dateRange }) => {
  try {
    const { client, settings } = await getClient()
    console.log('[calls:fetch] customerId:', customerId)
    console.log('[calls:fetch] dateRange:', JSON.stringify(dateRange))
    const result = await fetchCallLeads(client, customerId, settings.mccCustomerId, dateRange)
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
  return fetchWastedSpend(client, customerId, settings.mccCustomerId, dateRange, thresholdMicros)
})

// ── Top converting ads ────────────────────────────────────────────────────────

ipcMain.handle('ads:fetch', async (_e, { customerId, dateRange }) => {
  const { client, settings } = await getClient()
  return fetchTopConvertingAds(client, customerId, settings.mccCustomerId, dateRange)
})

// ── Negative keywords ─────────────────────────────────────────────────────────

ipcMain.handle('negatives:fetch', async (_e, { customerId, dateRange }) => {
  const { client, settings } = await getClient()
  return fetchNegativeData(client, customerId, settings.mccCustomerId, dateRange)
})

// ── Keywords with call counts ─────────────────────────────────────────────────

ipcMain.handle('keywords:fetch', async (_e, { customerId, dateRange }) => {
  try {
    const { client, settings } = await getClient()
    return fetchKeywordsWithCalls(client, customerId, settings.mccCustomerId, dateRange)
  } catch (err) {
    console.error('[keywords:fetch] ERROR:', err.message)
    return []
  }
})

// ── AI Keyword Planner — powered by Claude AI ────────────────────────────────

ipcMain.handle('keywords:ideas', async (_e, { seedKeywords, customPrompt, existingCampaigns, existingAdGroups }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) {
    throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const anthropic = new Anthropic({ apiKey: settings.claudeApiKey })
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
    `4. Generate 5–8 high-converting keyword ideas\n` +
    `5. Avoid informational or low-converting keywords\n` +
    `6. Avoid job-seeker intent keywords\n` +
    `7. Avoid DIY intent keywords\n` +
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
    `- informational keywords\n` +
    `- "what is", "how to", "DIY", "free", "jobs", "salary"\n` +
    `- broad irrelevant keywords\n\n` +
    `Focus ONLY on:\n` +
    `- transactional intent\n` +
    `- commercial intent\n` +
    `- service-booking intent\n` +
    `- lead-generation intent\n\n` +
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
    `      "keyword": "emergency plumber near me",\n` +
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
    `      "why_it_converts": "Urgent need with local qualifier drives immediate phone calls and same-day bookings."\n` +
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
        ((existingCampaigns || []).length > 0
          ? `STEP 1 — READ THESE EXISTING ACCOUNT CAMPAIGNS CAREFULLY.\nFor EVERY recommended keyword, set "recommended_campaign" to EXACTLY one of these names (copy-paste exactly, do not invent):\n${existingCampaigns.map(c => `  • ${c}`).join('\n')}\n\n`
          : `STEP 1 — No existing campaigns provided. Use the most logical campaign name based on the keyword.\n\n`) +
        ((existingAdGroups || []).length > 0
          ? `STEP 2 — READ THESE EXISTING ACCOUNT AD GROUPS CAREFULLY.\nFor EVERY recommended keyword, set "recommended_ad_group" to EXACTLY one of these names (copy-paste exactly, do not invent):\n${existingAdGroups.map(a => `  • ${a}`).join('\n')}\n\n`
          : `STEP 2 — No existing ad groups provided. Use the most logical ad group name based on the keyword.\n\n`) +
        (customPrompt
          ? `CUSTOM RESEARCH OBJECTIVE:\n${customPrompt}\n\n`
          : '') +
        `STEP 3 — Generate strategic keyword ideas for these seed keywords:\nSEED KEYWORDS: ${seedList}\n\n` +
        `CRITICAL REQUIREMENTS:\n` +
        `- Return ONLY a valid JSON array — start with [ and end with ]\n` +
        `- One object per seed keyword\n` +
        `- Every recommended keyword MUST include ALL fields: keyword, match_type, search_intent, buyer_stage, estimated_monthly_searches, competition, estimated_cpc, estimated_cpc_savings, conversion_probability_score, traffic_potential, recommended_campaign, recommended_ad_group, landing_page_intent, negative_keywords, why_it_converts\n` +
        `- recommended_campaign: MUST be an exact copy of one name from the STEP 1 list above\n` +
        `- recommended_ad_group: MUST be an exact copy of one name from the STEP 2 list above\n` +
        `- No empty strings, no null values, no invented names\n` +
        `- No markdown, no code fences, no explanation text`,
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

      return parsed.flatMap(item => {
        const recs = fArr(item, 'recommended_keywords', 'recommendedKeywords', 'keywords', 'ideas')
        console.log('[keywords:ideas] seed:', f(item,'seed_keyword','seedKeyword'), '| recs:', recs.length)
        return recs.map(kw => ({
          seedKeyword:       f(item, 'seed_keyword', 'seedKeyword'),
          keyword:           f(kw, 'keyword', 'keyword_phrase', 'term'),
          matchType:         f(kw, 'match_type', 'matchType', 'match'),
          searchIntent:      f(kw, 'search_intent', 'searchIntent', 'intent'),
          buyerStage:        f(kw, 'buyer_stage', 'buyerStage', 'stage'),
          monthlySearches:   f(kw, 'estimated_monthly_searches', 'monthlySearches', 'monthly_searches', 'search_volume'),
          competition:       f(kw, 'competition', 'competition_level', 'competitionLevel'),
          estimatedCpc:      f(kw, 'estimated_cpc', 'estimatedCpc', 'cpc', 'avg_cpc'),
          estimatedSavings:  f(kw, 'estimated_cpc_savings', 'estimatedCpcSavings', 'cpc_savings', 'savings'),
          conversionScore:   kw.conversion_probability_score ?? kw.conversionScore ?? kw.conversion_score ?? '',
          trafficPotential:  f(kw, 'traffic_potential', 'trafficPotential', 'traffic'),
          recommendedCampaign: f(kw, 'recommended_campaign', 'recommendedCampaign'),
          adGroup:             f(kw, 'recommended_ad_group', 'recommendedAdGroup', 'ad_group', 'adGroup'),
          negativeKeywords:  fArr(kw, 'negative_keywords', 'negativeKeywords', 'negatives'),
          whyItConverts:     f(kw, 'why_it_converts', 'whyItConverts', 'why_converts', 'recommendation', 'reason'),
          analysis:          item.analysis || null,
          campaignStructure: item.campaign_structure || item.campaignStructure || null,
        }))
      })
    } catch (e) {
      console.warn('[keywords:ideas] parse attempt failed:', e.message)
    }
  }

  return []
})

// ── CPC keyword optimizer — powered by Claude AI ─────────────────────────────

ipcMain.handle('keywords:cpcOptimize', async (_e, { keywords, customPrompt }) => {
  const settings = await store.getSettings()
  if (!settings.claudeApiKey) {
    throw new Error('Claude API key not configured. Add it in Settings → AI Features.')
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const anthropic = new Anthropic({ apiKey: settings.claudeApiKey })

  const kwLines = (keywords || [])
    .slice(0, 20)
    .map(k => `- ${k.keyword}${k.cpc ? ` (CPC: $${k.cpc})` : ''}`)
    .join('\n')

  const systemPrompt =
    `You are a Senior Google Ads Strategist and PPC Optimization Expert.\n\n` +
    `Your task is to analyze expensive Google Ads keywords and generate HIGH-INTENT, LOWER-CPC alternatives that are more likely to convert while reducing wasted spend.\n\n` +
    `The goal is NOT to generate generic keyword ideas.\n\n` +
    `The goal is to:\n` +
    `- Preserve or improve conversion intent\n` +
    `- Reduce CPC\n` +
    `- Reduce competition\n` +
    `- Improve lead quality\n` +
    `- Improve ad relevance\n` +
    `- Improve campaign structure\n` +
    `- Increase qualified traffic\n\n` +
    `You must think like an elite Google Ads campaign manager specializing in local service businesses and lead generation campaigns.\n\n` +
    `--------------------------------------------------\n` +
    `YOUR TASK\n` +
    `--------------------------------------------------\n\n` +
    `For EACH expensive keyword:\n\n` +
    `1. Analyze WHY the keyword CPC is expensive\n` +
    `2. Determine the search intent\n` +
    `3. Determine the buyer stage\n` +
    `4. Generate lower-CPC alternatives with similar or stronger purchase intent\n` +
    `5. Avoid informational or low-converting keywords\n` +
    `6. Avoid job-seeker intent keywords\n` +
    `7. Avoid DIY intent keywords\n` +
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
    `- informational keywords\n` +
    `- blog intent keywords\n` +
    `- "what is"\n` +
    `- "how to"\n` +
    `- "DIY"\n` +
    `- "free"\n` +
    `- "jobs"\n` +
    `- "salary"\n` +
    `- broad irrelevant keywords\n\n` +
    `Focus ONLY on:\n` +
    `- transactional intent\n` +
    `- commercial intent\n` +
    `- service-booking intent\n` +
    `- lead-generation intent\n\n` +
    `--------------------------------------------------\n` +
    `NEGATIVE KEYWORD GENERATION\n` +
    `--------------------------------------------------\n\n` +
    `For each seed keyword generate smart negative keywords that reduce wasted spend.\n\n` +
    `Examples: free, jobs, salary, training, DIY, craigslist, cheap parts, used\n\n` +
    `--------------------------------------------------\n` +
    `AD GROUP RECOMMENDATIONS\n` +
    `--------------------------------------------------\n\n` +
    `Automatically recommend proper ad group segmentation.\n\n` +
    `--------------------------------------------------\n` +
    `OPTIMIZATION PRIORITIES\n` +
    `--------------------------------------------------\n\n` +
    `Priority order:\n` +
    `1. Conversion intent\n` +
    `2. CPC reduction\n` +
    `3. Search relevance\n` +
    `4. Local buyer intent\n` +
    `5. Lower competition\n` +
    `6. Monthly traffic potential\n\n` +
    `--------------------------------------------------\n` +
    `IMPORTANT STRATEGIC THINKING\n` +
    `--------------------------------------------------\n\n` +
    `Think about auction competition, buyer psychology, local lead generation, search intent quality, Quality Score improvement, reducing wasted spend, and improving conversion rate.\n\n` +
    `Do not return shallow keyword variations. Generate strategic recommendations.\n\n` +
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
        `KEYWORDS TO ANALYZE:\n${kwLines}\n\n` +
        `Return ONLY a valid JSON array — one object per keyword above. No markdown, no extra text.`,
    }],
  })

  const raw = message.content[0]?.text || '[]'
  try {
    const parsed = JSON.parse(raw.replace(/```json\n?|```\n?/g, '').trim())
    // Flatten the rich structure into the flat array format the UI expects
    return (Array.isArray(parsed) ? parsed : []).flatMap(item =>
      (item.recommended_keywords || []).map(kw => ({
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
        adGroup:           kw.recommended_ad_group || '',
        negativeKeywords:  kw.negative_keywords || [],
        monthlySearches:   kw.estimated_monthly_searches || '',
        analysis:          item.analysis || null,
        campaignStructure: item.campaign_structure || null,
      }))
    )
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
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const anthropic = new Anthropic({ apiKey: settings.claudeApiKey })

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
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const anthropic = new Anthropic({ apiKey: settings.claudeApiKey })

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
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const anthropic = new Anthropic({ apiKey: settings.claudeApiKey })

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
KEYWORD CONFLICTS — each row is a keyword appearing in multiple ad groups causing internal cannibalisation.
For each: give a precise structural fix.
- For Duplicates: specify which ad group to keep and which to remove, referencing the ad group names given
- For Cannibalises Exact/Phrase: recommend adding the keyword as a negative in the broad-match ad group
- Reference the actual keyword and campaign name in the recommendation`,

    crossovers: `
SERVICE CROSSOVER ISSUES — competing campaigns targeting overlapping audiences/queries.
For each pair: recommend a structural fix.
- PMax vs Search: recommend URL exclusions or campaign priority settings
- PMax vs Shopping: recommend pausing the overlap campaign
- Search vs DSA: recommend adding Search keywords as DSA negatives
- Be specific about which campaign to modify`,

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
- Keep each recommendation to 2-3 sentences max
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
  return fetchAuditData(client, customerId, settings.mccCustomerId, statusFilter, dateRange)
})

// ── PDF export ────────────────────────────────────────────────────────────────

ipcMain.handle('pdf:export', async (_e, opts = {}) => {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) throw new Error('No active window')
  const stamp   = new Date().toISOString().slice(0, 10)
  const name    = opts.accountName ? `${opts.accountName}-` : ''
  const defName = `GAds-Dashboard-${name}${stamp}.pdf`
  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    title: 'Export as PDF', defaultPath: defName,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return { canceled: true }
  await win.webContents.executeJavaScript(`document.documentElement.classList.add('pdf-printing'); true`)
  await new Promise(r => setTimeout(r, 800))
  let pdfBuffer
  try {
    pdfBuffer = await win.webContents.printToPDF({ landscape: true, printBackground: true, pageSize: 'A4' })
  } finally {
    await win.webContents.executeJavaScript(`document.documentElement.classList.remove('pdf-printing'); true`)
  }
  await fs.promises.writeFile(filePath, pdfBuffer)
  return { success: true }
})
