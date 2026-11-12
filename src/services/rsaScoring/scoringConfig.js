// Single source of truth for the "Estimated Ad Strength" scoring model —
// component weights, ideal asset counts, similarity thresholds/penalties,
// the sitelink modifier table, and rating thresholds. Change values here,
// not inside the engine, so the whole model stays auditable in one place.
//
// These thresholds are this platform's own approximation of Ad Strength —
// Google does not publish its real formula, weights, or rating cutoffs.

export const ABSOLUTE_MIN_HEADLINES    = 3   // Google's hard minimum to serve an RSA at all
export const ABSOLUTE_MIN_DESCRIPTIONS = 2

export const IDEAL_HEADLINE_COUNT    = 15
export const IDEAL_DESCRIPTION_COUNT = 4
export const TOP_KEYWORD_LIMIT       = 10

// Component weights — must sum to 100.
export const WEIGHTS = {
  assetQuantity:          20,
  headlineUniqueness:     20,
  descriptionUniqueness:  10,
  keywordRelevance:       25,
  messageVariety:         15,
  combinationFlexibility: 10,
}

// Asset Quantity sub-weights (headline 12 + description 8 = 20)
export const ASSET_QUANTITY_SUBWEIGHTS = { headline: 12, description: 8 }

// Headline uniqueness — similarity blend (token/Jaccard + local semantic
// approximation — see textSimilarity.js) and per-issue penalties.
export const HEADLINE_SIMILARITY_BLEND = { token: 0.40, semantic: 0.60 }
export const HEADLINE_SIMILARITY_THRESHOLDS = { high: 0.85, moderate: 0.70 }
export const HEADLINE_PENALTIES = {
  exactDuplicate:        4,    // each
  highSimilarity:        3,    // each pair >= high threshold
  moderateSimilarity:    1.5,  // each pair in [moderate, high)
  repeatedOpeningPhrase: 1,    // each repeat occurrence beyond the first
}

// Description uniqueness — same similarity engine, own threshold/penalties.
export const DESCRIPTION_SIMILARITY_THRESHOLD = 0.80
export const DESCRIPTION_PENALTIES = {
  exactDuplicate:       5,
  highSimilarity:       3,   // each pair >= threshold
  repeatedCta:          1,   // each repeat beyond the first
  repeatedSellingPoint: 1,   // each repeat beyond the first
}

// Keyword relevance sub-scores (sum = 25)
export const KEYWORD_RELEVANCE_POINTS = {
  primaryHeadlineCoverage: 10,  // primary keyword/theme in >= 2 headlines
  secondaryThemeCoverage:  5,   // secondary themes covered by headlines
  descriptionCoverage:     4,   // primary keyword appears in a description
  landingPageRelevance:    4,   // final URL / landing page topic matches theme
  naturalUsage:            2,   // keyword usage doesn't read as stuffed
}
export const PRIMARY_KEYWORD_MIN_HEADLINES = 2

// Keyword weight formula — ranks keyword themes by conversion value, not by
// raw visibility. Search volume (impressions) is deliberately weighted last:
// a keyword that gets seen a lot but never converts should not outrank one
// that reliably produces leads. All components are normalized 0..1 before
// blending. Weights must sum to 1.0.
export const KEYWORD_WEIGHT_FORMULA = {
  conversionRate:   0.30,  // conversions / clicks — does this keyword actually convert?
  costEfficiency:   0.20,  // inverse of cost-per-conversion — cheaper conversions rank higher
  conversions:      0.20,  // raw conversion volume — still matters, far less than before
  commercialIntent: 0.15,  // heuristic: does the keyword text itself signal buying intent?
  clicks:           0.10,  // engagement signal, kept as a tiebreaker
  impressions:      0.05,  // demand/visibility — lowest priority, per direct-response goal
}

// Heuristic commercial-intent signals — no intent-classification data source
// exists in this codebase yet, so this is a deliberately simple text-pattern
// proxy (2+ matches = max score) rather than an AI classification call.
export const COMMERCIAL_INTENT_PATTERNS = [
  /\bnear me\b/i, /\bcost\b/i, /\bprice\b|\bpricing\b/i, /\bcheap\b|\baffordable\b/i,
  /\bhire\b/i, /\bemergency\b/i, /\bquote\b|\bestimate\b/i, /\bbook\b|\bschedule\b/i,
  /\bsame[- ]day\b/i, /\b24\/7\b|\b24[- ]hour\b/i, /\brepair\b|\bfix\b/i, /\binstall(ation)?\b/i,
  /\bbuy\b|\bpurchase\b/i, /\bservice[s]?\b/i, /\bcompany|companies\b/i,
]

// Message variety — category-count -> points (max 15). Evaluated in
// descending minCategories order, first match wins.
export const MESSAGE_VARIETY_POINTS = [
  { minCategories: 6, points: 15 },
  { minCategories: 5, points: 12 },
  { minCategories: 4, points: 9  },
  { minCategories: 2, points: 5  },
  { minCategories: 0, points: 0  },
]
export const EXCELLENT_MIN_MESSAGE_CATEGORIES = 6

// Combination flexibility (pinning) — starts at 10, first matching rule wins
// (checked in this order).
export const PINNING_SCORE = {
  none:                     10,
  onePinned:                8,
  twoUniquePinned:          6,
  threeOrMorePinned:        3,
  onlyOneAssetForPosition:  1,
  duplicatesPinnedTogether: 0,
}

// Sitelink modifier — applied AFTER the 0-100 component score. Always <= 0,
// so it can only hold the score steady or pull it down, never push it over
// 100. sitelinkCount === null means "unknown / not wired for this caller
// yet" — the modifier is skipped entirely in that case rather than assumed
// to be the worst bucket.
export const SITELINK_MODIFIER = [
  { min: 6, penalty:  0 },
  { min: 4, penalty: -2 },
  { min: 2, penalty: -4 },
  { min: 0, penalty: -6 },
]
export const EXCELLENT_MIN_SITELINKS = 6

// Rating thresholds — this platform's approximation, not Google's official
// ones (Google has never published them).
export const RATING_THRESHOLDS = [
  { min: 85, grade: 'Excellent' },
  { min: 70, grade: 'Good'      },
  { min: 50, grade: 'Average'   },
  { min: 0,  grade: 'Poor'      },
]

// excellentReady — the minimum conditions before the UI is allowed to claim
// "Excellent," independent of whether the numeric score alone crosses the
// Excellent threshold above. A high score built on a technicality (e.g.
// pinned assets, or 14/15 headlines with the missing slot never checked)
// should not be able to claim Excellent.
export const EXCELLENT_READY = {
  minHeadlines:              IDEAL_HEADLINE_COUNT,
  minDescriptions:           IDEAL_DESCRIPTION_COUNT,
  minUniqueHeadlineRatio:    0.90,
  minUniqueDescriptionRatio: 0.90,
  minPrimaryKeywordHeadlines: PRIMARY_KEYWORD_MIN_HEADLINES,
  minMessageCategories:      EXCELLENT_MIN_MESSAGE_CATEGORIES,
  maxPinnedAssets:           0,
  minRelevantSitelinks:      EXCELLENT_MIN_SITELINKS,
}
