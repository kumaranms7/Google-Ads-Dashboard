// Unified "Estimated Ad Strength" scoring engine — the ONLY scoring function
// in this app. Previously there were two (scoreRSA + estimateAdStrength)
// disagreeing with each other on different rubrics, which is how a
// Google-rated "Average" ad ended up showing a local "100" with no
// explanation. There is now exactly one score, one grade, and one set of
// component weights, all defined in ./rsaScoring/scoringConfig.js.
//
// This is this platform's own approximation of Google Ads Ad Strength —
// Google does not publish its real formula, weights, or thresholds, so
// nobody outside Google can reproduce it exactly. Always label this
// "Estimated Ad Strength" in the UI, never as Google's own rating.

import { getEffectiveLength, endsIncomplete, HEADLINE_MAX, DESCRIPTION_MAX } from '../utils/rsaValidation.js'
import { computeSimilarity, similarityMatrix, openingPhrase, tokenize } from './rsaScoring/textSimilarity.js'
import { classifyAsset, countMessageCategories } from './rsaScoring/messageCategories.js'
import { topKeywordThemes } from './rsaScoring/keywordWeighting.js'
import {
  ABSOLUTE_MIN_HEADLINES, ABSOLUTE_MIN_DESCRIPTIONS,
  IDEAL_HEADLINE_COUNT, IDEAL_DESCRIPTION_COUNT,
  WEIGHTS, ASSET_QUANTITY_SUBWEIGHTS,
  HEADLINE_SIMILARITY_THRESHOLDS, HEADLINE_PENALTIES,
  DESCRIPTION_SIMILARITY_THRESHOLD, DESCRIPTION_PENALTIES,
  KEYWORD_RELEVANCE_POINTS, PRIMARY_KEYWORD_MIN_HEADLINES,
  MESSAGE_VARIETY_POINTS,
  PINNING_SCORE,
  SITELINK_MODIFIER,
  RATING_THRESHOLDS,
  EXCELLENT_READY,
} from './rsaScoring/scoringConfig.js'

function textOf(asset) { return (asset && asset.text != null) ? asset.text : (asset || '') }
function isPinned(asset) { return !!(asset && typeof asset === 'object' && asset.pinned) }

// A single incidental word match (e.g. "water" alone "covering" the keyword
// "water heater repair" in a headline about something else entirely) is how
// this score could read much higher than Google's own, stricter rating —
// requiring the full phrase, or a real majority of its significant words,
// keeps "keyword relevance" tied to the ad actually being about that topic.
function containsTerm(text, term) {
  const t = String(text || '').toLowerCase()
  const kw = String(term || '').toLowerCase().trim()
  if (!kw) return false
  if (t.includes(kw)) return true
  const words = kw.split(/\s+/).filter(w => w.length > 3)
  if (words.length === 0) return false
  if (words.length === 1) return t.includes(words[0])
  const hits = words.filter(w => t.includes(w)).length
  return hits >= Math.ceil(words.length * 0.6)
}

// Exported directly for unit testing the rating-threshold boundaries in
// isolation, without needing to reverse-engineer an input that produces an
// exact end-to-end score.
export function gradeFor(score) {
  for (const { min, grade } of RATING_THRESHOLDS) if (score >= min) return grade
  return 'Poor'
}

// ── 1. Asset Quantity (max 20) ────────────────────────────────────────────
function scoreAssetQuantity(hlCount, dsCount) {
  const headlinePoints    = Math.min(hlCount / IDEAL_HEADLINE_COUNT, 1) * ASSET_QUANTITY_SUBWEIGHTS.headline
  const descriptionPoints = Math.min(dsCount / IDEAL_DESCRIPTION_COUNT, 1) * ASSET_QUANTITY_SUBWEIGHTS.description
  return Math.round((headlinePoints + descriptionPoints) * 10) / 10
}

// ── 2 & 3. Uniqueness (headlines max 20 / descriptions max 10) ────────────
// Shared shape: 1 - average pairwise similarity, scaled to `max`, then
// penalties for exact duplicates / high-similarity pairs / repeats — the
// baseline already reflects similarity, and the penalties are an
// intentionally harsher, explicit signal on top of it (matches the spec).
function scoreUniqueness(texts, { max, threshold, penalties, isDescription }) {
  const issues = []
  if (texts.length < 2) return { score: max, issues }

  const pairs = similarityMatrix(texts)
  const avgSim = pairs.reduce((s, p) => s + p.similarity, 0) / pairs.length
  let score = (1 - avgSim) * max

  // Exact duplicates
  const seen = new Map()
  let exactDupes = 0
  texts.forEach(t => {
    const key = String(t).toLowerCase().trim()
    if (seen.has(key)) exactDupes++
    seen.set(key, true)
  })
  if (exactDupes > 0) {
    const penalty = isDescription ? penalties.exactDuplicate : penalties.exactDuplicate
    score -= exactDupes * penalty
    issues.push(`${exactDupes} exact duplicate ${isDescription ? 'description' : 'headline'}(s)`)
  }

  // Similarity-tier penalties (skip pairs already counted as exact dupes)
  const highThreshold = isDescription ? threshold : HEADLINE_SIMILARITY_THRESHOLDS.high
  let highCount = 0, moderateCount = 0
  for (const p of pairs) {
    if (p.similarity >= 0.999) continue // exact duplicate, already penalized above
    if (p.similarity >= highThreshold) highCount++
    else if (!isDescription && p.similarity >= HEADLINE_SIMILARITY_THRESHOLDS.moderate) moderateCount++
  }
  if (highCount > 0) {
    score -= highCount * penalties.highSimilarity
    issues.push(`${highCount} near-duplicate ${isDescription ? 'description' : 'headline'} pair(s) (highly similar)`)
  }
  if (moderateCount > 0) {
    score -= moderateCount * penalties.moderateSimilarity
    issues.push(`${moderateCount} ${isDescription ? 'description' : 'headline'} pair(s) with moderate overlap`)
  }

  if (!isDescription) {
    // Repeated opening phrase
    const openings = {}
    texts.forEach(t => { const p = openingPhrase(t); if (p) openings[p] = (openings[p] || 0) + 1 })
    const repeatedOpenings = Object.values(openings).reduce((s, c) => s + Math.max(0, c - 1), 0)
    if (repeatedOpenings > 0) {
      score -= repeatedOpenings * penalties.repeatedOpeningPhrase
      issues.push(`${repeatedOpenings} headline(s) repeat the same opening word/phrase`)
    }
  } else {
    // Repeated CTA / repeated selling-point (approximated via message category)
    const ctaCount = texts.filter(t => classifyAsset(t, { keywordTokens: null }).includes('cta')).length
    if (ctaCount > 1) {
      score -= (ctaCount - 1) * penalties.repeatedCta
      issues.push(`${ctaCount} descriptions share the same call-to-action`)
    }
    const categoryFirstMatch = {}
    texts.forEach(t => {
      const cats = classifyAsset(t, { keywordTokens: null })
      const primary = cats.find(c => c !== 'cta')
      if (primary) categoryFirstMatch[primary] = (categoryFirstMatch[primary] || 0) + 1
    })
    const repeatedSellingPoints = Object.values(categoryFirstMatch).reduce((s, c) => s + Math.max(0, c - 1), 0)
    if (repeatedSellingPoints > 0) {
      score -= repeatedSellingPoints * penalties.repeatedSellingPoint
      issues.push(`${repeatedSellingPoints} description(s) repeat the same selling point`)
    }
  }

  return { score: Math.max(0, Math.min(max, Math.round(score * 10) / 10)), issues }
}

// ── 4. Keyword Relevance (max 25) ─────────────────────────────────────────
function scoreKeywordRelevance(hlTexts, dsTexts, keywords, landingPage) {
  const issues = []
  const { primary, secondary } = topKeywordThemes(keywords)

  if (!primary) {
    // No keyword data to judge against — neutral partial credit, same
    // philosophy the old engine used ("no keywords to judge").
    return { score: Math.round(Object.values(KEYWORD_RELEVANCE_POINTS).reduce((s, v) => s + v, 0) / 2), issues: ['No keyword data available to score relevance'] }
  }

  // Primary headline coverage (max 10) — graduated rather than strictly
  // binary at the spec's ">= 2 headlines" cutoff, so 1 headline still earns
  // partial credit instead of a cliff to zero.
  const primaryHlCount = hlTexts.filter(h => containsTerm(h, primary.text)).length
  const primaryHeadlineCoverage =
    primaryHlCount >= PRIMARY_KEYWORD_MIN_HEADLINES ? KEYWORD_RELEVANCE_POINTS.primaryHeadlineCoverage :
    primaryHlCount === 1 ? KEYWORD_RELEVANCE_POINTS.primaryHeadlineCoverage / 2 : 0
  if (primaryHlCount < PRIMARY_KEYWORD_MIN_HEADLINES) issues.push(`Primary keyword theme "${primary.text}" appears in only ${primaryHlCount} headline(s) — aim for ${PRIMARY_KEYWORD_MIN_HEADLINES}+`)

  // Secondary theme coverage (max 5)
  const secondaryCovered = secondary.filter(kw => hlTexts.some(h => containsTerm(h, kw.text)))
  const secondaryThemeCoverage = secondary.length > 0
    ? Math.round((secondaryCovered.length / secondary.length) * KEYWORD_RELEVANCE_POINTS.secondaryThemeCoverage * 10) / 10
    : KEYWORD_RELEVANCE_POINTS.secondaryThemeCoverage
  if (secondary.length > 0 && secondaryCovered.length / secondary.length < 0.5) issues.push('Secondary keyword themes are under-covered in headlines')

  // Description coverage (max 4)
  const descriptionCoverage = dsTexts.some(d => containsTerm(d, primary.text)) ? KEYWORD_RELEVANCE_POINTS.descriptionCoverage : 0
  if (descriptionCoverage === 0) issues.push('Primary keyword theme does not appear in any description')

  // Landing page relevance (max 4)
  let landingPageRelevance = KEYWORD_RELEVANCE_POINTS.landingPageRelevance / 2 // neutral when no LP data
  if (landingPage && !landingPage.error) {
    const lpWords = [landingPage.h1, ...(landingPage.h2s || []), landingPage.title].filter(Boolean).join(' ')
    const lpTokens = new Set(tokenize(lpWords))
    const adTokens = tokenize([...hlTexts, ...dsTexts].join(' '))
    const overlap = adTokens.filter(w => lpTokens.has(w)).length
    const ratio = adTokens.length > 0 ? overlap / adTokens.length : 0
    landingPageRelevance = Math.min(KEYWORD_RELEVANCE_POINTS.landingPageRelevance, Math.round(ratio * KEYWORD_RELEVANCE_POINTS.landingPageRelevance * 3 * 10) / 10)
    if (landingPageRelevance < KEYWORD_RELEVANCE_POINTS.landingPageRelevance / 2) issues.push('Ad copy doesn\'t closely reflect the landing page content')
  }

  // Natural usage (max 2) — penalize a headline that's just the raw keyword
  // repeated with nothing else (reads as stuffed rather than natural).
  const stuffedCount = hlTexts.filter(h => h.trim().toLowerCase() === primary.text.trim().toLowerCase()).length
  const naturalUsage = stuffedCount > 1 ? 0 : KEYWORD_RELEVANCE_POINTS.naturalUsage
  if (stuffedCount > 1) issues.push('The same keyword phrase is repeated verbatim across multiple headlines')

  const score = primaryHeadlineCoverage + secondaryThemeCoverage + descriptionCoverage + landingPageRelevance + naturalUsage
  return { score: Math.round(score * 10) / 10, issues, primary, secondary }
}

// ── 5. Message Variety (max 15) ───────────────────────────────────────────
function scoreMessageVariety(hlTexts, dsTexts, keywordTokenSet) {
  const covered = countMessageCategories([...hlTexts, ...dsTexts], { keywordTokens: keywordTokenSet, tokenize })
  const tier = MESSAGE_VARIETY_POINTS.find(t => covered.size >= t.minCategories) || MESSAGE_VARIETY_POINTS[MESSAGE_VARIETY_POINTS.length - 1]
  const issues = covered.size < MESSAGE_VARIETY_POINTS[0].minCategories
    ? [`Only ${covered.size} distinct message type(s) used — vary across keyword, benefit, trust, offer, CTA, and location angles`]
    : []
  return { score: tier.points, categories: covered, issues }
}

// ── 6. Combination Flexibility / pinning (max 10) ─────────────────────────
function scorePinning(headlines, descriptions) {
  const issues = []
  const pinnedHl = headlines.filter(isPinned)
  const pinnedDs = descriptions.filter(isPinned)
  const totalPinned = pinnedHl.length + pinnedDs.length

  // Duplicate/near-duplicate assets pinned together is the worst case,
  // regardless of count — Google specifically flags this as restricting
  // combinations the most.
  const pinnedHlTexts = pinnedHl.map(textOf)
  const pinnedDsTexts = pinnedDs.map(textOf)
  const hasDupePinned = (texts, threshold) => {
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        if (computeSimilarity(texts[i], texts[j]) >= threshold) return true
      }
    }
    return false
  }
  if (hasDupePinned(pinnedHlTexts, HEADLINE_SIMILARITY_THRESHOLDS.high) || hasDupePinned(pinnedDsTexts, DESCRIPTION_SIMILARITY_THRESHOLD)) {
    issues.push('Similar assets are pinned to the same position — this restricts Google\'s ability to combine assets')
    return { score: PINNING_SCORE.duplicatesPinnedTogether, issues, pinnedCount: totalPinned }
  }

  if (totalPinned >= 1 && headlines.length <= ABSOLUTE_MIN_HEADLINES + 1) {
    issues.push('Very few unpinned headlines are available to combine with the pinned position(s)')
    return { score: PINNING_SCORE.onlyOneAssetForPosition, issues, pinnedCount: totalPinned }
  }
  if (totalPinned >= 3) {
    issues.push('3+ assets are pinned — this significantly limits ad combinations')
    return { score: PINNING_SCORE.threeOrMorePinned, issues, pinnedCount: totalPinned }
  }
  if (totalPinned === 2) {
    issues.push('2 assets are pinned — consider unpinning for more combination flexibility')
    return { score: PINNING_SCORE.twoUniquePinned, issues, pinnedCount: totalPinned }
  }
  if (totalPinned === 1) {
    return { score: PINNING_SCORE.onePinned, issues, pinnedCount: totalPinned }
  }
  return { score: PINNING_SCORE.none, issues, pinnedCount: 0 }
}

// ── Sitelink modifier ──────────────────────────────────────────────────────
function sitelinkModifierFor(sitelinkCount) {
  if (sitelinkCount == null) return null
  const tier = SITELINK_MODIFIER.find(t => sitelinkCount >= t.min) || SITELINK_MODIFIER[SITELINK_MODIFIER.length - 1]
  return tier.penalty
}

/**
 * Score a set of RSA assets and return this platform's "Estimated Ad
 * Strength" — the single scoring function used everywhere in this app.
 *
 * @param {object} params
 * @param {Array}  params.headlines     — [{text, pinned?}] or [string]
 * @param {Array}  params.descriptions  — [{text, pinned?}] or [string]
 * @param {Array}  params.keywords      — [{text, impressions?, clicks?, conversions?}] or [string]
 * @param {object} [params.landingPage] — result from analyzeLandingPage, or null
 * @param {number} [params.sitelinkCount] — relevant sitelink count across account/campaign/ad group; null/undefined = not evaluated (modifier skipped, and the excellentReady sitelink check is treated as not-blocking)
 * @param {boolean} [params.hasFinalUrl=true]
 * @param {boolean} [params.hasAdGroup=true]
 * @returns {{score, baseScore, maxScore, grade, isComplete, breakdown, sitelinkModifier, issues, excellentReady, excellentChecks}}
 */
export function estimateAdStrength({
  headlines = [], descriptions = [], keywords = [],
  landingPage = null, sitelinkCount = null,
  hasFinalUrl = true, hasAdGroup = true,
}) {
  const hlAssets = headlines.filter(h => textOf(h).trim())
  const dsAssets = descriptions.filter(d => textOf(d).trim())
  const hlTexts  = hlAssets.map(textOf)
  const dsTexts  = dsAssets.map(textOf)

  const isComplete = !!hasFinalUrl && !!hasAdGroup && keywords.length > 0
    && hlTexts.length >= ABSOLUTE_MIN_HEADLINES && dsTexts.length >= ABSOLUTE_MIN_DESCRIPTIONS

  const issues = []
  if (!hasFinalUrl)  issues.push('No final URL set on this ad')
  if (!hasAdGroup)   issues.push('This ad is not assigned to an ad group')
  if (keywords.length === 0) issues.push('No ad-group keywords available to judge relevance against')
  if (hlTexts.length < ABSOLUTE_MIN_HEADLINES) issues.push(`Need at least ${ABSOLUTE_MIN_HEADLINES} headlines (Google's minimum), have ${hlTexts.length}`)
  if (dsTexts.length < ABSOLUTE_MIN_DESCRIPTIONS) issues.push(`Need at least ${ABSOLUTE_MIN_DESCRIPTIONS} descriptions (Google's minimum), have ${dsTexts.length}`)

  const assetQuantityScore = scoreAssetQuantity(hlTexts.length, dsTexts.length)
  if (hlTexts.length < IDEAL_HEADLINE_COUNT) issues.push(`Add more headlines — ${IDEAL_HEADLINE_COUNT} is ideal (have ${hlTexts.length})`)
  if (dsTexts.length < IDEAL_DESCRIPTION_COUNT) issues.push(`Add more descriptions — ${IDEAL_DESCRIPTION_COUNT} is ideal (have ${dsTexts.length})`)

  const hlUnique = scoreUniqueness(hlTexts, { max: WEIGHTS.headlineUniqueness, threshold: HEADLINE_SIMILARITY_THRESHOLDS.high, penalties: HEADLINE_PENALTIES, isDescription: false })
  const dsUnique = scoreUniqueness(dsTexts, { max: WEIGHTS.descriptionUniqueness, threshold: DESCRIPTION_SIMILARITY_THRESHOLD, penalties: DESCRIPTION_PENALTIES, isDescription: true })

  const kwRel = scoreKeywordRelevance(hlTexts, dsTexts, keywords, landingPage)

  const keywordTokenSet = new Set([kwRel.primary, ...(kwRel.secondary || [])].filter(Boolean).flatMap(k => tokenize(k.text)))
  const msgVariety = scoreMessageVariety(hlTexts, dsTexts, keywordTokenSet)

  const pinning = scorePinning(hlAssets, dsAssets)

  issues.push(...hlUnique.issues, ...dsUnique.issues, ...kwRel.issues, ...msgVariety.issues, ...pinning.issues)
  // Sentence-completeness is not one of the 6 weighted components (per the
  // new spec), but a fragment is still worth surfacing as an issue — it's
  // caught here as a warning rather than a score deduction.
  hlTexts.forEach((h, i) => { if (endsIncomplete(h)) issues.push(`Headline ${i + 1} ends mid-sentence`) })
  dsTexts.forEach((d, i) => { if (endsIncomplete(d)) issues.push(`Description ${i + 1} ends mid-sentence`) })

  const baseScore = Math.max(0, Math.min(100,
    assetQuantityScore + hlUnique.score + dsUnique.score + kwRel.score + msgVariety.score + pinning.score
  ))

  const modifier = sitelinkModifierFor(sitelinkCount)
  // The modifier is always <= 0, so this can only hold steady or reduce the
  // score — it can never push the total above 100.
  const score = Math.round(Math.max(0, Math.min(100, baseScore + (modifier || 0))) * 10) / 10

  // ── excellentReady gate ──────────────────────────────────────────────────
  const allCharacterLimitsValid =
    hlTexts.every(h => getEffectiveLength(h) <= HEADLINE_MAX) &&
    dsTexts.every(d => getEffectiveLength(d) <= DESCRIPTION_MAX)

  const highSimHlCount = new Set()
  similarityMatrix(hlTexts).forEach((p, idx) => {
    if (p.similarity >= HEADLINE_SIMILARITY_THRESHOLDS.high) { highSimHlCount.add(p.i); highSimHlCount.add(p.j) }
  })
  const uniqueHeadlineRatio = hlTexts.length > 0 ? 1 - highSimHlCount.size / hlTexts.length : 1

  const highSimDsCount = new Set()
  similarityMatrix(dsTexts).forEach(p => {
    if (p.similarity >= DESCRIPTION_SIMILARITY_THRESHOLD) { highSimDsCount.add(p.i); highSimDsCount.add(p.j) }
  })
  const uniqueDescriptionRatio = dsTexts.length > 0 ? 1 - highSimDsCount.size / dsTexts.length : 1

  const primaryKeywordHeadlineCount = kwRel.primary ? hlTexts.filter(h => containsTerm(h, kwRel.primary.text)).length : 0
  const primaryKeywordInDescription = kwRel.primary ? dsTexts.some(d => containsTerm(d, kwRel.primary.text)) : false

  const excellentChecks = [
    { key: 'headlineCount',       label: `${EXCELLENT_READY.minHeadlines} headlines`,               pass: hlTexts.length >= EXCELLENT_READY.minHeadlines,
      message: `Add ${Math.max(0, EXCELLENT_READY.minHeadlines - hlTexts.length)} more headline(s) to reach ${EXCELLENT_READY.minHeadlines}` },
    { key: 'descriptionCount',    label: `${EXCELLENT_READY.minDescriptions} descriptions`,          pass: dsTexts.length >= EXCELLENT_READY.minDescriptions,
      message: `Add ${Math.max(0, EXCELLENT_READY.minDescriptions - dsTexts.length)} more description(s) to reach ${EXCELLENT_READY.minDescriptions}` },
    { key: 'headlineUniqueness',  label: 'Headlines are distinct',                                    pass: uniqueHeadlineRatio >= EXCELLENT_READY.minUniqueHeadlineRatio,
      message: 'Rewrite the most similar headlines so each carries a genuinely different message' },
    { key: 'descriptionUniqueness', label: 'Descriptions are distinct',                                pass: uniqueDescriptionRatio >= EXCELLENT_READY.minUniqueDescriptionRatio,
      message: 'Rewrite the most similar descriptions so each carries a genuinely different message' },
    { key: 'primaryKeywordHeadlines', label: `Primary keyword in ${EXCELLENT_READY.minPrimaryKeywordHeadlines}+ headlines`, pass: primaryKeywordHeadlineCount >= EXCELLENT_READY.minPrimaryKeywordHeadlines,
      message: kwRel.primary ? `Include "${kwRel.primary.text}" in at least ${EXCELLENT_READY.minPrimaryKeywordHeadlines} headlines` : 'Add keyword data to evaluate this' },
    { key: 'primaryKeywordDescription', label: 'Primary keyword in a description',                     pass: primaryKeywordInDescription,
      message: kwRel.primary ? `Mention "${kwRel.primary.text}" (or a close variant) in at least one description` : 'Add keyword data to evaluate this' },
    { key: 'messageCategories',   label: `${EXCELLENT_READY.minMessageCategories}+ message categories`, pass: msgVariety.categories.size >= EXCELLENT_READY.minMessageCategories,
      message: `Cover at least ${EXCELLENT_READY.minMessageCategories} distinct message angles (keyword, benefit, trust, offer, CTA, location, etc.) — currently ${msgVariety.categories.size}` },
    { key: 'pinning',             label: 'No pinned assets',                                          pass: pinning.pinnedCount <= EXCELLENT_READY.maxPinnedAssets,
      message: 'Unpin all headlines and descriptions for the best chance at Excellent' },
    { key: 'sitelinks',           label: `${EXCELLENT_READY.minRelevantSitelinks}+ relevant sitelinks`, pass: sitelinkCount == null || sitelinkCount >= EXCELLENT_READY.minRelevantSitelinks,
      message: `Add sitelinks across the account, campaign, and ad group until you have ${EXCELLENT_READY.minRelevantSitelinks}+` },
    { key: 'characterLimits',     label: 'All assets within character limits',                        pass: allCharacterLimitsValid,
      message: 'Shorten any headline over 30 characters or description over 90 characters' },
  ]
  const excellentReady = isComplete && excellentChecks.every(c => c.pass)

  // The numeric threshold alone can cross into "Excellent" on a technicality
  // (e.g. one pinned headline, or a sitelink count nobody's confirmed) —
  // excellentReady is the actual, stricter gate for that label. A score that
  // would otherwise read "Excellent" without passing it is shown as "Good"
  // instead, never silently as Excellent.
  const rawGrade = isComplete ? gradeFor(score) : 'Incomplete'
  const grade = (rawGrade === 'Excellent' && !excellentReady) ? 'Good' : rawGrade

  return {
    score, baseScore, maxScore: 100, grade, isComplete,
    breakdown: {
      assetQuantity:          { score: assetQuantityScore, max: WEIGHTS.assetQuantity,          label: 'Asset Quantity' },
      headlineUniqueness:     { score: hlUnique.score,      max: WEIGHTS.headlineUniqueness,     label: 'Headline Uniqueness' },
      descriptionUniqueness:  { score: dsUnique.score,      max: WEIGHTS.descriptionUniqueness,  label: 'Description Uniqueness' },
      keywordRelevance:       { score: kwRel.score,         max: WEIGHTS.keywordRelevance,       label: 'Keyword Relevance' },
      messageVariety:         { score: msgVariety.score,    max: WEIGHTS.messageVariety,         label: 'Message Variety' },
      combinationFlexibility: { score: pinning.score,       max: WEIGHTS.combinationFlexibility, label: 'Combination Flexibility' },
    },
    sitelinkModifier: modifier,
    issues,
    excellentReady,
    excellentChecks,
  }
}
