// RSA Builder orchestration — asset audit + search term categorization.
// Claude generation is Phase 2; this file handles all local preprocessing.

import { CTA_PATTERNS, GENERIC_PATTERNS, FORBIDDEN_PATTERNS } from '../utils/rsaValidation.js'
import { classifySearchTerms, groupByCategory, buildIntentWarnings } from './intentClassifier.js'
import { tokenize } from './rsaScoring/textSimilarity.js'

// ── Asset label constants ─────────────────────────────────────────────────────

export const ASSET_LABELS = {
  KEEP:          'Keep',
  REPLACE:       'Replace',
  REMOVE:        'Remove',
  RISKY:         'Risky',
  TOO_GENERIC:   'Too Generic',
  WRONG_SERVICE: 'Wrong Service',
  LOW_INTENT:    'Low Intent',
  MISSING_CTA:   'Missing CTA',
}

export const LABEL_COLORS = {
  Keep:          '#2e7d32',
  Replace:       '#e65100',
  Remove:        '#c0392b',
  Risky:         '#a56700',
  'Too Generic': '#555',
  'Wrong Service':'#880e4f',
  'Low Intent':  '#1565c0',
  'Missing CTA': '#6a1b9a',
}

// ── Asset audit ───────────────────────────────────────────────────────────────

// Types: Keyword | CTA | Trust | Urgency | Benefit | Location | Problem-Solution
export function classifyHeadlineType(text, keywords = [], serviceArea = '') {
  const t = text.toLowerCase().trim()
  const kwTexts = keywords.map(k => (k.text || k).toLowerCase())

  // 1. Keyword — contains an ad group keyword
  if (kwTexts.some(kw => kw.length > 3 && (
    t.includes(kw) ||
    kw.split(/\s+/).filter(w => w.length > 4).some(w => t.includes(w))
  ))) return 'Keyword'

  // 2. Problem-Solution — pain point question or problem-addressing phrase
  if (/\?/.test(text)) return 'Problem-Solution'
  if (/\b(too\s+much|too\s+many|tired\s+of|sick\s+of|need\s+(help|someone\s+to)|struggling|piled?\s+up|overflowing|dealing\s+with|get\s+rid\s+of|no\s+more\b|stop\s+the|clearing?\s+out|cluttered)\b/i.test(text)) return 'Problem-Solution'

  // 3. Urgency — time-critical or immediate-availability commitments
  if (/\b(same[\s-]?day|next[\s-]?day|24\/7|24[\s-]?hour|emergency|immediate|urgent|asap|available\s*now|right\s*now|on[\s-]?demand|after[\s-]?hours?|weekend\s+service|tonight)\b/i.test(text)) return 'Urgency'
  if (/\b(call|book|schedule|request|get|reach).{0,20}\btoday\b/i.test(text)) return 'Urgency'
  if (/\b(service|pickup|removal|response|appointment)\s+today\b/i.test(text)) return 'Urgency'

  // 4. Location — geo-targeted headlines
  if (serviceArea && t.includes(serviceArea.toLowerCase().trim())) return 'Location'
  if (/\b(serving\b|near\s+me\b|nearby\b|metro\b|county[\s-]?wide|city[\s-]?wide|greater\s+\w+|throughout\s+|across\s+\w+|in\s+the\s+(area|region|city|valley)|local\s+area)\b/i.test(text)) return 'Location'
  // Two capitalized proper-noun words at the start that don't match other type openers
  if (/^[A-Z][a-z]+\s+[A-Z][a-z]/.test(text) && !/^(Licensed|Insured|Trusted|Professional|Certified|Award|Satisfaction|Family|Veteran|Background|Locally|Same|Next|Free|No\s|Flat|Get|Call|Book|Schedule|Request|Contact|Hire|Fast|Quick|Easy|Top|Best|Affordable|Special|Emergency|Available|Immediate|Commercial|Industrial|Residential|Heavy|Complete|Quality|Premium|Reliable|Efficient)\b/i.test(text)) return 'Location'

  // 5. Trust — credentials, experience, ratings, certifications, social proof
  if (/\b(\d+\+?\s*years?|licensed|insured|bonded|certified|accredited|bbb\b|award[\s-]?win|top[\s-]?rated|5[\s-]?star|five[\s-]?star|best[\s-]?rated|highest[\s-]?rated|satisfaction\s+guaranteed|money[\s-]?back|guarantee\b|family[\s-]?owned|locally[\s-]?owned|veteran[\s-]?owned|background[\s-]?check|trusted|professional\b|expert\b|specialists?\b|experienced\b|qualified|authorized|reliable\b|reputable)\b/i.test(text)) return 'Trust'

  // 6. Offer — free, deals, pricing, discounts
  if (/\bfree\b/i.test(text)) return 'Offer'
  if (/\b(no\s+(charge|cost|hidden\s*fee|obligation)|flat\s+rate|price\s+match|\d+\s*%\s*off|save\s+\$?\d|\$\d+\s*off|discount|promo(tion)?\b|special\s+offer|coupon|deal\b|affordable|low[\s-]?cost|low[\s-]?price|best\s+price|competitive\s+pric|upfront\s+pric)\b/i.test(text)) return 'Offer'

  // 7. CTA — starts with or centers on an imperative action verb
  if (/^(call|book|schedule|request|contact|hire|order|reserve|try|start|claim|speak|sign\s*up|register|get\s+(a|an|your|free)|choose|compare|see\s+(our|how)|reach\s+out)\b/i.test(text)) return 'CTA'
  if (/\b(call\s+(us|now|for)|book\s+(now|online|your)|schedule\s+(a|your|an)\s|request\s+(a|an|your)\s|contact\s+(us|our)|hire\s+(us|our)|speak\s+(to|with)\s+\w+\s*(expert|pro|team))\b/i.test(text)) return 'CTA'

  // 8. Benefit — quality of service, speed, ease, positive outcomes
  if (/\b(fast\b|quick\b|easy\b|hassle[\s-]?free|stress[\s-]?free|worry[\s-]?free|convenient|efficient|effortless|simple\b|smooth\b|no\s+mess|no\s+stress|no\s+hassle|save\s+time|clutter[\s-]?free|tidy|neat|done\s+(right|fast)|in\s+one\s+trip|heavy\s+lifting|we\s+do\s+the|clean\s+(up|out|property)|waste\s+gone|junk\s+gone|hauled\s+away)\b/i.test(text)) return 'Benefit'

  // Default — descriptive service headlines
  return 'Benefit'
}

/**
 * Audit all headlines and descriptions in an RSA ad.
 * Returns { headlines: [{text, label, reasons, index, type}], descriptions: [...] }
 */
export function analyzeCurrentRSAAssets(rsaAd, keywords = []) {
  const kwTexts = keywords.map(k => (k.text || k).toLowerCase())

  const hlTexts = (rsaAd.headlines    || []).map(h => h.text || '')
  const dTexts  = (rsaAd.descriptions || []).map(d => d.text || '')

  // Collect duplicate texts up-front
  const hlDupes = buildDupeSet(hlTexts)
  const dDupes  = buildDupeSet(dTexts)

  const headlines = (rsaAd.headlines || []).map((h, i) => {
    const result = auditAsset(h.text || '', 'headline', i, hlDupes, kwTexts)
    result.type  = classifyHeadlineType(h.text || '', keywords)
    return result
  })
  const descriptions = (rsaAd.descriptions || []).map((d, i) => auditAsset(d.text || '', 'description', i, dDupes, kwTexts))

  return { headlines, descriptions }
}

function buildDupeSet(texts) {
  const seen = new Map()
  const dupes = new Set()
  texts.forEach(t => {
    const key = t.toLowerCase().trim()
    if (seen.has(key)) dupes.add(key)
    else seen.set(key, true)
  })
  return dupes
}

function auditAsset(text, type, index, dupeSet, kwTexts) {
  const t = text.trim()
  const reasons = []
  let label = ASSET_LABELS.KEEP

  if (!t) {
    return { text, label: ASSET_LABELS.REMOVE, reasons: ['Empty asset'], index }
  }

  // Duplicate
  if (dupeSet.has(t.toLowerCase())) {
    label = ASSET_LABELS.REMOVE
    reasons.push('Duplicate — exact match found elsewhere in this ad')
    return { text, label, reasons, index }
  }

  // Forbidden / low-intent wording (risky)
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.test(t)) {
      label = ASSET_LABELS.RISKY
      reasons.push('Contains forbidden wording (free/cheap/DIY/jobs/city pickup)')
      break
    }
  }

  // Too generic
  if (label === ASSET_LABELS.KEEP) {
    for (const p of GENERIC_PATTERNS) {
      if (p.test(t)) {
        label = ASSET_LABELS.TOO_GENERIC
        reasons.push('Generic filler phrase — adds no specific value')
        break
      }
    }
  }

  // Very short asset
  if (t.length < 6) {
    label = ASSET_LABELS.TOO_GENERIC
    reasons.push('Too short to be meaningful')
  }

  // No CTA (headline only — descriptions are expected to be more informational)
  if (type === 'headline' && label === ASSET_LABELS.KEEP) {
    const hasCta = CTA_PATTERNS.some(p => p.test(t))
    const hasKw  = kwTexts.some(kw => t.toLowerCase().includes(kw) || kw.split(' ').filter(w => w.length > 3).some(w => t.toLowerCase().includes(w)))
    if (!hasCta && !hasKw) {
      reasons.push('No CTA and no keyword match — consider replacing')
    }
  }

  // If still Keep but we have reasons, downgrade to Replace
  if (label === ASSET_LABELS.KEEP && reasons.length > 0) {
    label = ASSET_LABELS.REPLACE
  }

  // Clean Keep — everything looks good
  if (label === ASSET_LABELS.KEEP && reasons.length === 0) {
    reasons.push('Meets all quality checks')
  }

  return { text, label, reasons, index }
}

// ── Search term categorization ────────────────────────────────────────────────

/**
 * Full analysis of search terms: classify, group, build warnings.
 */
export function analyzeSearchTerms(searchTerms) {
  const classified = classifySearchTerms(searchTerms)
  const groups     = groupByCategory(classified)
  const totalCost  = searchTerms.reduce((s, t) => s + (t.cost || 0), 0)
  const warnings   = buildIntentWarnings(classified, totalCost)

  return { classified, groups, warnings, totalCost }
}

// ── Landing page mismatch detection ──────────────────────────────────────────
// Two layers, deliberately kept separate:
//  1. Raw Theme Coverage — the original word-level % (kept as a secondary
//     diagnostic per spec; its matching was upgraded from plain substring to
//     stemmed/word-boundary matching so "clog" now correctly credits "clogged",
//     but the metric itself is still "what fraction of individual theme words
//     appear on the page," same as before).
//  2. Prioritized opportunities — phrase-first, priority-classified gaps,
//     which is what should actually drive any H2/content recommendation
//     rather than raw word coverage (a missing "near" or "cheap" is not the
//     same kind of gap as a missing "hydro jetting").

// Query modifiers (spec category D) — generic PPC search modifiers that add
// little topical signal on their own. Missing one of these should rarely, if
// ever, justify an H2 edit by itself.
const QUERY_MODIFIER_WORDS = new Set([
  'near', 'nearby', 'cheap', 'cheapest', 'affordable', 'best', 'top', 'local',
  'company', 'companies', 'service', 'services', 'quality', 'professional',
  'trusted', 'fast', 'quick', 'easy', 'good', 'great', 'reliable', 'you', 'your',
])

// Problem/search-intent words (spec category B) — describe WHY the customer
// needs the service. These carry real intent even standing alone, so they
// stay high priority even when they don't form part of a longer phrase.
const PROBLEM_INTENT_WORDS = new Set([
  'clog', 'clogged', 'clogging', 'clogs', 'block', 'blocked', 'blocking', 'blockage',
  'backup', 'backed', 'broken', 'leak', 'leaking', 'leaky', 'leaks', 'emergency',
  'overflow', 'overflowing', 'damaged', 'burst', 'slow', 'draining', 'stuck',
])

// Small connector words to strip when building phrases — separate from the
// query-modifier list since these aren't "low-value search modifiers," they
// just don't belong inside an extracted phrase (the/a/an/for/and/me/etc.).
const PHRASE_STOPWORDS = new Set(['me', 'you', 'your', 'the', 'a', 'an', 'for', 'and', 'or', 'my', 'our'])

function normalizeWords(text) {
  return String(text || '').toLowerCase().split(/\W+/).filter(Boolean)
}

// A "concept" (single word or multi-word phrase) counts as present if every
// one of its stemmed, stopword-filtered tokens appears SOMEWHERE in the page
// — forgiving of word order and grammatical form (tokenize() already stems
// "clogged"/"cleaning"/"blockage" down to a comparable root), rather than
// requiring an exact adjacent substring match.
function conceptMatches(text, pageTokenSet) {
  const tokens = tokenize(text)
  return tokens.length > 0 && tokens.every(t => pageTokenSet.has(t))
}

// Extracts meaningful 2-3 word phrases from one keyword string: strips query
// modifiers/connectors, then emits the remaining contiguous run plus its
// adjacent bigrams — "hydro jetting near me" → "hydro jetting";
// "clogged drain cleaning" → "clogged drain", "drain cleaning".
function extractPhrases(keywordText) {
  const words = normalizeWords(keywordText).filter(w =>
    w.length > 2 && !QUERY_MODIFIER_WORDS.has(w) && !PHRASE_STOPWORDS.has(w)
  )
  const phrases = new Set()
  if (words.length >= 2) phrases.add(words.join(' '))
  for (let i = 0; i < words.length - 1; i++) phrases.add(`${words[i]} ${words[i + 1]}`)
  return [...phrases]
}

/**
 * Compare ad group name/keywords against landing page content.
 * Returns { score: 0-100, grade, mismatches: [string], matched, unmatched,
 *           prioritized: { high, medium, low } } — prioritized opportunities
 * are phrase-first and classified by importance (see module comment above),
 * meant to replace a flat "missing words" list as the basis for any
 * recommendation; matched/unmatched/score are kept for backward
 * compatibility with existing callers/UI (the plain "Raw Theme Coverage" %).
 */
export function detectLandingPageMismatch(adGroupName, keywords, landingPage) {
  if (!landingPage || landingPage.error) {
    return { score: null, grade: 'Unknown', mismatches: ['Could not fetch landing page'] }
  }

  const lpContent = [
    landingPage.title,
    landingPage.h1,
    ...(landingPage.h2s || []),
    landingPage.metaDescription,
    landingPage.bodySnippet || '',
  ].join(' ')
  const pageTokenSet = new Set(tokenize(lpContent))

  // ── Raw Theme Coverage — unchanged concept, upgraded (stemmed) matching ──
  const agWords = normalizeWords(adGroupName).filter(w => w.length > 3)
  const kwWords = (keywords || [])
    .map(k => k.text || k)
    .flatMap(k => normalizeWords(k))
    .filter(w => w.length > 3)
  const allThemeWords = [...new Set([...agWords, ...kwWords])]

  const matched   = allThemeWords.filter(w => conceptMatches(w, pageTokenSet))
  const unmatched = allThemeWords.filter(w => !conceptMatches(w, pageTokenSet))
  const score     = allThemeWords.length > 0
    ? Math.round((matched.length / allThemeWords.length) * 100)
    : 50

  // ── Prioritized opportunities — phrase-first, then orphan words ──
  const keywordTexts = (keywords || []).map(k => k.text || k)
  const allPhrases = [...new Set(keywordTexts.flatMap(extractPhrases))]
  const phraseWordsUsed = new Set(allPhrases.flatMap(p => p.split(' ')))

  const phraseOpportunities = allPhrases.map(text => ({
    text, matched: conceptMatches(text, pageTokenSet), priority: 'HIGH', type: 'phrase',
  }))

  // Orphan single words: theme words not already absorbed into an extracted
  // phrase above — "hydro"/"jetting" don't get reported separately once
  // "hydro jetting" is already covering that concept.
  const orphanWords = allThemeWords.filter(w => !phraseWordsUsed.has(w))
  const wordOpportunities = orphanWords
    .filter(w => !QUERY_MODIFIER_WORDS.has(w))
    .map(text => ({
      text, matched: conceptMatches(text, pageTokenSet),
      priority: PROBLEM_INTENT_WORDS.has(text) ? 'HIGH' : 'MEDIUM', type: 'word',
    }))
  const modifierOpportunities = orphanWords
    .filter(w => QUERY_MODIFIER_WORDS.has(w))
    .map(text => ({ text, matched: conceptMatches(text, pageTokenSet), priority: 'LOW', type: 'modifier' }))

  const unmatchedOpportunities = [...phraseOpportunities, ...wordOpportunities, ...modifierOpportunities]
    .filter(o => !o.matched)
  const prioritized = {
    high:   unmatchedOpportunities.filter(o => o.priority === 'HIGH'),
    medium: unmatchedOpportunities.filter(o => o.priority === 'MEDIUM'),
    low:    unmatchedOpportunities.filter(o => o.priority === 'LOW'),
  }

  const mismatches = []
  if (prioritized.high.length > 0) {
    mismatches.push(`High-priority service/intent concepts missing from landing page: ${prioritized.high.slice(0, 5).map(o => o.text).join(', ')}`)
  }
  if (landingPage.h1 && !agWords.some(w => conceptMatches(w, new Set(tokenize(landingPage.h1))))) {
    mismatches.push(`Landing page H1 ("${landingPage.h1.slice(0,60)}") doesn't align with ad group theme`)
  }
  if (score < 40) {
    mismatches.push('Low overall content match — landing page may serve a different service than this ad group')
  }

  const grade =
    score >= 75 ? 'Good'    :
    score >= 50 ? 'Average' : 'Poor'

  return { score, grade, mismatches, matched, unmatched, prioritized }
}
