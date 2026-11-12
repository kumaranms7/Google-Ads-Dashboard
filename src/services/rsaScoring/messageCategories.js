// Classifies RSA asset text into Google's documented "message diversity"
// categories (keyword/service, benefit, differentiator, trust, offer, CTA,
// location, price/convenience, problem/solution) via pattern matching.
//
// This is a best-effort approximation, not true intent understanding —
// real copy often blends categories (e.g. "Licensed and Insured Crew" reads
// as both a differentiator and a trust signal), so an asset may legitimately
// match more than one category. Message-variety scoring only cares about the
// SET of distinct categories touched across all assets, not per-asset purity.

export const MESSAGE_CATEGORY_PATTERNS = {
  benefit:          [/\b(save|faster|easier|effortless|hassle[\s-]?free|stress[\s-]?free|convenient|reclaim|improve|protect|peace of mind)\b/i],
  differentiator:   [/\b(licensed|insured|certified|bonded|guarantee(d)?|warrant(y|ied)|only|exclusive|award)\b/i],
  trust:            [/\b(since\s+\d{4}|\d+\+?\s*years?|family[\s-]?owned|trusted|rated|reviews?|serving|reputation)\b/i],
  offer:            [/\b(free\s+(estimate|quote|consultation|inspection)|discount|%\s*off|save\s*\$|no\s+obligation|flat\s+rate)\b/i],
  cta:              [/^(call|book|schedule|get|request|contact|hire|claim|start|order|sign\s*up)\b/i],
  location:         [/\b(near\s*me|local|[a-z]+\s*(county|area)|serving\s+[a-z])\b/i],
  priceConvenience: [/\b(upfront|flat[\s-]?rate|no\s+hidden\s+fees|affordable|convenient\s+scheduling|easy\s+scheduling|transparent\s+pricing)\b/i],
  problemSolution:  [/\b(remove|clear|clean\s*up|clutter|without\s+the|solve|fix|eliminate)\b/i],
}

/**
 * Categories an asset's text touches. `keywordTokens` (a Set of stemmed
 * tokens from the account's own keyword themes) drives the keywordService
 * category — it's the one category that can't be a fixed pattern list since
 * it depends entirely on this account's actual services.
 */
export function classifyAsset(text, { keywordTokens, tokenize } = {}) {
  const categories = []
  const t = String(text || '')

  if (keywordTokens && keywordTokens.size > 0 && typeof tokenize === 'function') {
    const assetTokens = tokenize(t)
    if (assetTokens.some(tok => keywordTokens.has(tok))) categories.push('keywordService')
  }

  for (const [category, patterns] of Object.entries(MESSAGE_CATEGORY_PATTERNS)) {
    if (patterns.some(p => p.test(t))) categories.push(category)
  }

  return categories
}

/** Distinct message categories touched across a list of asset texts. Returns a Set of category keys. */
export function countMessageCategories(texts, ctx) {
  const covered = new Set()
  for (const t of texts) {
    for (const c of classifyAsset(t, ctx)) covered.add(c)
  }
  return covered
}
