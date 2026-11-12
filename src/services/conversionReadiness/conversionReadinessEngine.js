// "Conversion Readiness Score" — a second, separate estimate from Estimated
// Ad Strength. Ad Strength (see ../rsaScoringEngine.js) measures copy
// diversity and structure, the same dimensions Google's own rating covers.
// It says nothing about whether the ad is actually likely to convert once
// clicked — that depends on offer strength, trust signals, message match to
// the landing page, and lead qualification, none of which Ad Strength
// evaluates. This engine estimates that instead, as a distinct score shown
// alongside (never merged into) Ad Strength.
//
// This is a heuristic, pattern-based approximation, not a Google metric of
// any kind. Always label it "Conversion Readiness Score" in the UI, kept
// visually and numerically separate from "Estimated Ad Strength."

import { tokenize } from '../rsaScoring/textSimilarity.js'
import { classifyAsset } from '../rsaScoring/messageCategories.js'
import { topKeywordThemes } from '../rsaScoring/keywordWeighting.js'
import {
  CONVERSION_READINESS_WEIGHTS, SEARCH_INTENT_POINTS, SEARCH_INTENT_MIN_HEADLINES,
  TIERED_BY_HITS, OFFER_SOURCE_PATTERNS, RESTRICTION_SOURCE_PATTERNS, QUALIFICATION_COPY_PATTERNS,
  CTA_URGENCY_PATTERNS, CONVERSION_RATING_THRESHOLDS,
} from './scoringConfig.js'

function textOf(asset) { return (asset && asset.text != null) ? asset.text : (asset || '') }

// Kept in sync with the identical function in ../rsaScoringEngine.js — see
// its comment. A single incidental word match let "search-intent match"
// pass for copy that wasn't really about the keyword at all.
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

export function gradeFor(score) {
  for (const { min, grade } of CONVERSION_RATING_THRESHOLDS) if (score >= min) return grade
  return 'Poor'
}

// Indices (within headlines / descriptions separately) whose text matches a
// message category — the basis for "which exact assets earned these points."
function indicesWithCategory(hlTexts, dsTexts, category) {
  const headlines    = hlTexts.flatMap((t, i) => classifyAsset(t, {}).includes(category) ? [i] : [])
  const descriptions = dsTexts.flatMap((t, i) => classifyAsset(t, {}).includes(category) ? [i] : [])
  return { headlines, descriptions }
}
function indicesMatchingPatterns(hlTexts, dsTexts, patterns) {
  const test = t => patterns.some(re => re.test(t))
  return { headlines: hlTexts.flatMap((t, i) => test(t) ? [i] : []), descriptions: dsTexts.flatMap((t, i) => test(t) ? [i] : []) }
}

// ── Search-Intent Match (max 25) — uses the same conversion-value keyword
// ranking as headline generation (rankKeywordsByWeight), so "primary" here
// means the theme most likely to convert, not just the most-searched one.
function scoreSearchIntent(hlTexts, dsTexts, keywords) {
  const issues = []
  const { primary } = topKeywordThemes(keywords)
  const max = SEARCH_INTENT_POINTS.primaryHeadlineCoverage + SEARCH_INTENT_POINTS.primaryDescription
  const emptyAssets = { headlines: [], descriptions: [] }
  if (!primary) return { score: Math.round(max / 2), issues: ['No keyword data available to score search-intent match'], assets: emptyAssets }

  const hlIdx = hlTexts.flatMap((h, i) => containsTerm(h, primary.text) ? [i] : [])
  const dsIdx = dsTexts.flatMap((d, i) => containsTerm(d, primary.text) ? [i] : [])
  const headlineScore = hlIdx.length >= SEARCH_INTENT_MIN_HEADLINES ? SEARCH_INTENT_POINTS.primaryHeadlineCoverage
    : hlIdx.length === 1 ? SEARCH_INTENT_POINTS.primaryHeadlineCoverage / 2 : 0
  if (hlIdx.length < SEARCH_INTENT_MIN_HEADLINES) issues.push(`Highest-converting keyword theme "${primary.text}" appears in only ${hlIdx.length} headline(s)`)

  const descScore = dsIdx.length > 0 ? SEARCH_INTENT_POINTS.primaryDescription : 0
  if (dsIdx.length === 0) issues.push(`Highest-converting keyword theme "${primary.text}" does not appear in any description`)

  return { score: headlineScore + descScore, issues, primary, assets: { headlines: hlIdx, descriptions: dsIdx } }
}

// ── Benefits/Outcomes and Trust/Proof (max varies) — tiered by distinct hit
// count rather than binary presence, since one benefit line is weaker
// evidence than two.
function scoreTieredCategory(hlTexts, dsTexts, category, max, label) {
  const assets = indicesWithCategory(hlTexts, dsTexts, category)
  const hits = assets.headlines.length + assets.descriptions.length
  const tier = TIERED_BY_HITS(max).find(t => hits >= t.minHits)
  const issues = hits === 0 ? [`No ${label} messaging detected across headlines/descriptions`] : []
  return { score: tier.points, hits, issues, assets }
}

// ── Offer / Value Proposition (max 20) — only scored at all when the
// business genuinely has an offer, per the landing page / declared active
// promotion (sourceHasOffer) — never for an offer the ad copy merely claims
// for itself. A description-level offer counts more than a headline-only
// mention, since offers typically need room to state a concrete term.
function scoreOffer(hlTexts, dsTexts, sourceHasOffer) {
  const max = CONVERSION_READINESS_WEIGHTS.offerValueProposition
  if (!sourceHasOffer) return { score: 0, applicable: false, issues: [], assets: { headlines: [], descriptions: [] } }
  const assets = indicesMatchingPatterns(hlTexts, dsTexts, OFFER_SOURCE_PATTERNS)
  const hits = assets.headlines.length + assets.descriptions.length
  const score = hits === 0 ? 0 : (assets.descriptions.length > 0 ? max : Math.round(max * 0.7))
  const issues = hits === 0 ? ['This business has an offer on file, but none of the generated copy actually states it'] : []
  return { score, applicable: true, issues, assets }
}

// ── Strong CTA (max 10) — a CTA verb alone is worth partial credit; pairing
// it with urgency language ("today," "now," "same-day") earns full credit.
function scoreCta(hlTexts, dsTexts) {
  const max = CONVERSION_READINESS_WEIGHTS.strongCta
  const assets = indicesWithCategory(hlTexts, dsTexts, 'cta')
  if (assets.headlines.length + assets.descriptions.length === 0) return { score: 0, issues: ['No clear call-to-action detected'], assets }
  const allCta = [...assets.headlines.map(i => hlTexts[i]), ...assets.descriptions.map(i => dsTexts[i])]
  const hasUrgency = allCta.some(t => CTA_URGENCY_PATTERNS.some(re => re.test(t)))
  const score = hasUrgency ? max : Math.round(max * 0.6)
  const issues = hasUrgency ? [] : ['Call-to-action is present but not urgency-driven — consider adding "today," "now," or "same-day"']
  return { score, issues, assets }
}

// ── Landing-Page Message Match (max 10) — same token-overlap approximation
// used by Ad Strength's keyword-relevance component, reused here since it's
// the same underlying question (does the ad's language match the page it
// sends traffic to), just weighted for conversion readiness instead. This
// is a whole-ad blend rather than a per-asset signal, so it has no discrete
// "assets" attribution.
function scoreLandingPageMatch(hlTexts, dsTexts, landingPage) {
  const max = CONVERSION_READINESS_WEIGHTS.landingPageMatch
  const emptyAssets = { headlines: [], descriptions: [] }
  if (!landingPage || landingPage.error) return { score: Math.round(max / 2), issues: ['No landing page data available to verify message match'], assets: emptyAssets }
  const lpWords = [landingPage.h1, ...(landingPage.h2s || []), landingPage.title].filter(Boolean).join(' ')
  const lpTokens = new Set(tokenize(lpWords))
  const adTokens = tokenize([...hlTexts, ...dsTexts].join(' '))
  const overlap = adTokens.filter(w => lpTokens.has(w)).length
  const ratio = adTokens.length > 0 ? overlap / adTokens.length : 0
  const score = Math.min(max, Math.round(ratio * max * 3))
  const issues = score < max / 2 ? ['Ad copy doesn\'t closely reflect the landing page\'s own messaging — a mismatch here often costs conversions even on a high-scoring ad'] : []
  return { score, issues, assets: emptyAssets }
}

// ── Lead Qualification (max 5) — only scored at all when the business has a
// genuine eligibility restriction (commercial-only, homeowners-only, a
// minimum project size, an explicit "only" scope) declared in its USPs or
// landing page (sourceHasRestriction) — never for the ad copy merely
// claiming "see if you qualify" with nothing real behind it, which used to
// earn full credit here and is exactly the false signal this guards against.
function scoreLeadQualification(hlTexts, dsTexts, sourceHasRestriction) {
  const max = CONVERSION_READINESS_WEIGHTS.leadQualification
  if (!sourceHasRestriction) return { score: 0, applicable: false, issues: [], assets: { headlines: [], descriptions: [] } }
  const assets = indicesMatchingPatterns(hlTexts, dsTexts, QUALIFICATION_COPY_PATTERNS)
  const hit = assets.headlines.length + assets.descriptions.length > 0
  const issues = hit ? [] : ['This business has a real eligibility restriction on file, but none of the generated copy reflects it']
  return { score: hit ? max : 0, applicable: true, issues, assets }
}

/**
 * Score a set of RSA assets for "Conversion Readiness" — a distinct
 * estimate from Estimated Ad Strength, focused on likelihood to convert
 * rather than copy diversity/structure.
 *
 * Offer and Lead-Qualification are only scored when the business genuinely
 * has one (per usps/promotion/landingPage) — otherwise they're marked
 * not-applicable and their weight is redistributed across the remaining
 * components, so a business with no real offer or restriction can still
 * reach 100 rather than being capped for something it was never supposed
 * to have. This mirrors "it's better to omit than invent."
 *
 * @param {object} params
 * @param {Array}  params.headlines    — [{text}] or [string]
 * @param {Array}  params.descriptions — [{text}] or [string]
 * @param {Array}  params.keywords     — [{text, impressions?, clicks?, conversions?, cost?}] or [string]
 * @param {object} [params.landingPage] — result from analyzeLandingPage, or null
 * @param {Array}  [params.usps]        — declared USP strings (source of truth for offer/restriction claims)
 * @param {string} [params.promotion]   — declared active promotion text, if any
 * @returns {{score, maxScore, grade, breakdown, issues}}
 */
export function estimateConversionReadiness({ headlines = [], descriptions = [], keywords = [], landingPage = null, usps = [], promotion = '' }) {
  const hlTexts = headlines.map(textOf).filter(t => t.trim())
  const dsTexts = descriptions.map(textOf).filter(t => t.trim())
  const allTexts = [...hlTexts, ...dsTexts]

  const sourceText = [...(usps || []), promotion, landingPage?.title, landingPage?.bodySnippet, (landingPage?.ctas || []).join(' ')]
    .filter(Boolean).join(' ')
  const hasOfferSource       = !!promotion || OFFER_SOURCE_PATTERNS.some(re => re.test(sourceText))
  const hasRestrictionSource = RESTRICTION_SOURCE_PATTERNS.some(re => re.test(sourceText))

  const searchIntent      = scoreSearchIntent(hlTexts, dsTexts, keywords)
  const offer             = scoreOffer(hlTexts, dsTexts, hasOfferSource)
  const benefits          = scoreTieredCategory(hlTexts, dsTexts, 'benefit', CONVERSION_READINESS_WEIGHTS.benefitsOutcomes, 'benefit/outcome')
  const trust             = scoreTieredCategory(hlTexts, dsTexts, 'trust', CONVERSION_READINESS_WEIGHTS.trustProof, 'trust/proof')
  const landingPageMatch  = scoreLandingPageMatch(hlTexts, dsTexts, landingPage)
  const cta               = scoreCta(hlTexts, dsTexts)
  const leadQualification = scoreLeadQualification(hlTexts, dsTexts, hasRestrictionSource)

  const breakdown = {
    searchIntentMatch:      { score: searchIntent.score,      max: CONVERSION_READINESS_WEIGHTS.searchIntentMatch,      label: 'Search-Intent Match',        applicable: true,                    assets: searchIntent.assets },
    offerValueProposition:  { score: offer.score,             max: CONVERSION_READINESS_WEIGHTS.offerValueProposition,  label: 'Offer / Value Proposition',  applicable: offer.applicable,         assets: offer.assets },
    benefitsOutcomes:       { score: benefits.score,          max: CONVERSION_READINESS_WEIGHTS.benefitsOutcomes,       label: 'Benefits / Outcomes',         applicable: true,                    assets: benefits.assets },
    trustProof:             { score: trust.score,             max: CONVERSION_READINESS_WEIGHTS.trustProof,             label: 'Trust / Proof',               applicable: true,                    assets: trust.assets },
    landingPageMatch:       { score: landingPageMatch.score,  max: CONVERSION_READINESS_WEIGHTS.landingPageMatch,       label: 'Landing-Page Message Match',  applicable: true,                    assets: landingPageMatch.assets },
    strongCta:              { score: cta.score,               max: CONVERSION_READINESS_WEIGHTS.strongCta,              label: 'Strong CTA',                  applicable: true,                    assets: cta.assets },
    leadQualification:      { score: leadQualification.score, max: CONVERSION_READINESS_WEIGHTS.leadQualification,      label: 'Lead Qualification',          applicable: leadQualification.applicable, assets: leadQualification.assets },
  }

  const applicableComponents = Object.values(breakdown).filter(c => c.applicable)
  const maxTotal = applicableComponents.reduce((s, c) => s + c.max, 0)
  const rawTotal = applicableComponents.reduce((s, c) => s + c.score, 0)
  const score = maxTotal > 0 ? Math.round((rawTotal / maxTotal) * 100) : 0
  const grade = gradeFor(score)

  const issues = [
    ...searchIntent.issues, ...offer.issues, ...benefits.issues, ...trust.issues,
    ...landingPageMatch.issues, ...cta.issues, ...leadQualification.issues,
  ]

  return { score, maxScore: 100, grade, breakdown, issues }
}
