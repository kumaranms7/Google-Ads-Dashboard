// Phase 2 — builds the structured Claude prompt for RSA generation.
// Preprocesses all data locally before sending to Claude.
// NOT used in Phase 1 (MVP).

/**
 * Build a structured payload for Claude RSA generation.
 * All data must be pre-processed — never send raw API dumps.
 */
export function buildRSAPrompt({
  businessName,
  campaignName,
  adGroupName,
  landingPage,
  existingAssets,
  topKeywords,
  convertingTerms,
  intentWarnings,
  assetAudit,
  customPrompt,
}) {
  const lpSummary = landingPage && !landingPage.error ? {
    title:       landingPage.title,
    h1:          landingPage.h1,
    h2s:         (landingPage.h2s || []).slice(0, 5),
    ctas:        (landingPage.ctas || []).slice(0, 5),
    trustSignals: landingPage.trustSignals || [],
    services:    landingPage.services || [],
  } : null

  const assetsToReplace = [
    ...(assetAudit?.headlines    || []).filter(h => h.label !== 'Keep').map(h => ({ type: 'headline',    text: h.text, issue: h.label })),
    ...(assetAudit?.descriptions || []).filter(d => d.label !== 'Keep').map(d => ({ type: 'description', text: d.text, issue: d.label })),
  ]

  const payload = {
    business:    businessName || campaignName,
    campaign:    campaignName,
    adGroup:     adGroupName,
    landingPage: lpSummary,
    existingHeadlines:    (existingAssets?.headlines    || []).map(h => h.text),
    existingDescriptions: (existingAssets?.descriptions || []).map(d => d.text),
    assetsToReplace,
    topKeywords:      (topKeywords || []).slice(0, 15).map(k => k.text || k),
    convertingTerms:  (convertingTerms || []).slice(0, 20).map(t => t.term || t),
    intentWarnings:   (intentWarnings || []).map(w => w.message),
    customInstruction: customPrompt || null,
  }

  const systemPrompt = `You are a senior Google Ads strategist specializing in Responsive Search Ads.

Generate RSA assets optimized for:
- Excellent Ad Strength
- High-intent conversions
- Landing page relevance
- Keyword alignment
- Conversion-focused traffic

Do not generate:
- Generic fluff ("Best Service", "Call Us Today", "We Are #1")
- Unrelated services
- Low intent wording (free, cheap, DIY, dump near me, city pickup, jobs)
- Broad mixed-service messaging
- Anything over character limits

Return STRICT JSON only — no markdown, no explanation outside JSON.`

  const userPrompt = customPrompt
    ? `${customPrompt}\n\nContext data:\n${JSON.stringify(payload, null, 2)}`
    : `Generate RSA assets for the following ad group.\n\n${JSON.stringify(payload, null, 2)}\n\nReturn EXACTLY this JSON structure:\n{"headlines":[],"descriptions":[],"warnings":[],"replacement_table":[],"sitelinks":[],"callouts":[],"match_score":0}`

  return { systemPrompt, userPrompt, payload }
}
