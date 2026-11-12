// Ranks an account's keywords into "themes" by conversion value rather than
// raw visibility, so headline generation and scoring prioritize keywords
// that actually produce leads over ones that merely get seen or clicked.

import { KEYWORD_WEIGHT_FORMULA, COMMERCIAL_INTENT_PATTERNS, TOP_KEYWORD_LIMIT } from './scoringConfig.js'

function normalizeColumn(values) {
  const max = Math.max(0, ...values)
  return max > 0 ? values.map(v => v / max) : values.map(() => 0)
}

/** 0..1 — 2+ matched intent signals (e.g. "near me", "emergency", "quote") = max score. */
function commercialIntentScore(text) {
  if (!text) return 0
  const matches = COMMERCIAL_INTENT_PATTERNS.filter(re => re.test(text)).length
  return Math.min(1, matches / 2)
}

/**
 * @param {Array} keywords — [{text, impressions?, clicks?, conversions?, cost?}] or [string]
 * @returns {Array<{text, weight}>} sorted descending by weight, longest list first
 *          (untrimmed — callers slice to TOP_KEYWORD_LIMIT or fewer as needed)
 */
export function rankKeywordsByWeight(keywords = []) {
  const normalized = (keywords || []).map(k => (typeof k === 'string' ? { text: k } : k)).filter(k => k?.text)
  if (normalized.length === 0) return []

  const hasPerf = normalized.some(k => k.impressions || k.clicks || k.conversions)
  if (!hasPerf) {
    // No performance data available — fall back to input order (assumed to
    // already reflect search volume / Google's own keyword ordering, per
    // the spec's fallback instruction) with equal weight.
    return normalized.map(k => ({ text: k.text, weight: 1 }))
  }

  const impr = normalizeColumn(normalized.map(k => Number(k.impressions) || 0))
  const clk  = normalizeColumn(normalized.map(k => Number(k.clicks) || 0))
  const conv = normalizeColumn(normalized.map(k => Number(k.conversions) || 0))

  const convRate = normalized.map(k => {
    const clicks = Number(k.clicks) || 0
    const conversions = Number(k.conversions) || 0
    return clicks > 0 ? Math.min(1, conversions / clicks) : 0
  })

  // Cost-per-conversion, inverted so cheaper conversions score higher.
  // null = no conversions yet, so there's no efficiency evidence either way.
  const costPerConv = normalized.map(k => {
    const conversions = Number(k.conversions) || 0
    const cost = Number(k.cost) || 0
    return conversions > 0 ? cost / conversions : null
  })
  const validCosts = costPerConv.filter(c => c != null)
  const maxCost = validCosts.length ? Math.max(...validCosts) : 0
  const costEfficiency = costPerConv.map(c => (c == null || maxCost === 0) ? 0 : 1 - (c / maxCost))

  const intent = normalized.map(k => commercialIntentScore(k.text))

  return normalized
    .map((k, i) => ({
      text: k.text,
      weight:
        convRate[i]       * KEYWORD_WEIGHT_FORMULA.conversionRate +
        costEfficiency[i] * KEYWORD_WEIGHT_FORMULA.costEfficiency +
        conv[i]           * KEYWORD_WEIGHT_FORMULA.conversions +
        intent[i]         * KEYWORD_WEIGHT_FORMULA.commercialIntent +
        clk[i]            * KEYWORD_WEIGHT_FORMULA.clicks +
        impr[i]           * KEYWORD_WEIGHT_FORMULA.impressions,
    }))
    .sort((a, b) => b.weight - a.weight)
}

/** Top keyword themes (default: primary = [0], secondary = the rest up to TOP_KEYWORD_LIMIT). */
export function topKeywordThemes(keywords = [], limit = TOP_KEYWORD_LIMIT) {
  const ranked = rankKeywordsByWeight(keywords)
  return {
    primary:   ranked[0] || null,
    secondary: ranked.slice(1, limit),
    all:       ranked.slice(0, limit),
  }
}
