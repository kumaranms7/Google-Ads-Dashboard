// Classifies search terms and keywords by intent type.
// Returns category + warning flag for each term.

export const INTENT_CATEGORIES = {
  HIGH_INTENT:   'High Intent',
  LOW_INTENT:    'Low Intent',
  FREE:          'Free Seeker',
  CHEAP:         'Price Shopper',
  PRICING:       'Pricing Research',
  DIY:           'DIY',
  DUMP_NEAR_ME:  'Dump/Municipal',
  CITY_PICKUP:   'City Pickup',
  JOBS:          'Job Seeker',
  COMPETITOR:    'Competitor',
  WRONG_SERVICE: 'Wrong Service',
}

// Categories that should NOT receive ads (or generate warnings)
export const NEGATIVE_INTENT_CATS = new Set([
  'Free Seeker', 'DIY', 'Dump/Municipal', 'City Pickup', 'Job Seeker',
])

const RULES = [
  // Jobs / Hiring — highest priority check
  { cat: INTENT_CATEGORIES.JOBS,         patterns: [/\bjob\b/i, /\bjobs\b/i, /\bhiring\b/i, /\bcareer\b/i, /\bemployment\b/i, /\bwork\s+for\b/i, /\bapply\b/i, /\bsalary\b/i, /\bwage\b/i] },

  // Free intent
  { cat: INTENT_CATEGORIES.FREE,         patterns: [/\bfree\b/i, /\bno\s*charge\b/i, /\bno\s*cost\b/i, /\bgratis\b/i, /\bwithout\s+paying\b/i, /\bdon'?t\s+pay\b/i] },

  // DIY
  { cat: INTENT_CATEGORIES.DIY,          patterns: [/\bdiy\b/i, /\bdo.?it.?yourself\b/i, /\bhow\s+to\b/i, /\brent\s+a?\s*truck\b/i, /\brent\s+a?\s*trailer\b/i, /\bhow\s+do\s+i\b/i, /\brent\s+a?\s*dumpster\b/i] },

  // City / municipal pickup
  { cat: INTENT_CATEGORIES.CITY_PICKUP,  patterns: [/\bcity\s+(?:bulk\s+)?pickup\b/i, /\bcurbside\s+pickup\b/i, /\bbulk\s+pickup\b/i, /\bmunicipal\s+pickup\b/i, /\bcounty\s+pickup\b/i, /\bsanitation\b/i, /\bgarbage\s+(?:day|pickup)\b/i, /\brecycling\s+(?:center|pickup)\b/i] },

  // Dump / landfill / waste site
  { cat: INTENT_CATEGORIES.DUMP_NEAR_ME, patterns: [/\bdump\s+near\s+me\b/i, /\bwaste\s+site\b/i, /\blandfill\b/i, /\btransfer\s+station\b/i, /\bdump\s+site\b/i, /\bwaste\s+facility\b/i, /\bdisposal\s+site\b/i] },

  // Cheap / price-only
  { cat: INTENT_CATEGORIES.CHEAP,        patterns: [/\bcheap\b/i, /\baffordable\b/i, /\blow.?cost\b/i, /\bbudget\b/i, /\bdiscount\b/i, /\binexpensive\b/i, /\bsave\s+money\b/i] },

  // Pricing research (still useful, just lower conversion intent)
  { cat: INTENT_CATEGORIES.PRICING,      patterns: [/\bhow\s+much\b/i, /\bprice\b/i, /\bcost\b/i, /\brate\b/i, /\bfee\b/i, /\bquote\b/i, /\bestimate\b/i, /\bpricing\b/i] },
]

// High-intent signals — checked after negatives
const HIGH_INTENT_SIGNALS = [
  /\bnear\s+me\b/i,
  /\bsame\s+day\b/i,
  /\bnext\s+day\b/i,
  /\bemergency\b/i,
  /\basap\b/i,
  /\btoday\b/i,
  /\bimmediately\b/i,
  /\bhire\b/i,
  /\bservice\b/i,
  /\bremoval\b/i,
  /\bpickup\b/i,
  /\bcollection\b/i,
  /\bdisposal\b/i,
  /\bcleanout\b/i,
  /\bclean\s*out\b/i,
  /\bhaul\b/i,
  /\bhauling\b/i,
]

/**
 * Classify a single search term string.
 * Returns { category, isWarning }
 */
export function classifyTerm(term) {
  const t = term.toLowerCase().trim()

  for (const { cat, patterns } of RULES) {
    if (patterns.some(p => p.test(t))) {
      return { category: cat, isWarning: NEGATIVE_INTENT_CATS.has(cat) }
    }
  }

  // Check high-intent signals
  if (HIGH_INTENT_SIGNALS.some(p => p.test(t))) {
    return { category: INTENT_CATEGORIES.HIGH_INTENT, isWarning: false }
  }

  return { category: INTENT_CATEGORIES.LOW_INTENT, isWarning: false }
}

/**
 * Classify an array of search term objects { term, ... }.
 * Returns array with { ...original, category, isWarning }
 */
export function classifySearchTerms(searchTerms) {
  return searchTerms.map(st => {
    const { category, isWarning } = classifyTerm(st.term || '')
    return { ...st, category, isWarning }
  })
}

/**
 * Group classified terms by category and compute aggregates.
 * Returns { [category]: { terms, totalCost, totalConversions, totalClicks } }
 */
export function groupByCategory(classifiedTerms) {
  const groups = {}
  for (const term of classifiedTerms) {
    if (!groups[term.category]) {
      groups[term.category] = { terms: [], totalCost: 0, totalConversions: 0, totalClicks: 0 }
    }
    groups[term.category].terms.push(term)
    groups[term.category].totalCost        += term.cost        || 0
    groups[term.category].totalConversions += term.conversions || 0
    groups[term.category].totalClicks      += term.clicks      || 0
  }
  return groups
}

/**
 * Build warning messages from classified search terms.
 * Returns array of warning strings.
 */
export function buildIntentWarnings(classifiedTerms, totalCost) {
  const warnings = []
  const groups = groupByCategory(classifiedTerms)

  const WARN_CATS = [
    { cat: INTENT_CATEGORIES.FREE,         msg: (g) => `${g.terms.length} "free" intent terms triggered your ads — $${g.totalCost.toFixed(2)} wasted spend with 0 purchase intent.` },
    { cat: INTENT_CATEGORIES.DIY,          msg: (g) => `${g.terms.length} DIY intent terms found — people searching to do it themselves won't convert. Add as negatives.` },
    { cat: INTENT_CATEGORIES.CITY_PICKUP,  msg: (g) => `${g.terms.length} city/curbside pickup terms — these users want free municipal service, not a paid company.` },
    { cat: INTENT_CATEGORIES.DUMP_NEAR_ME, msg: (g) => `${g.terms.length} dump/landfill terms — users looking for waste sites, not your service.` },
    { cat: INTENT_CATEGORIES.JOBS,         msg: (g) => `${g.terms.length} job-seeking terms — applicants, not customers. Wasted $${g.totalCost.toFixed(2)}.` },
    { cat: INTENT_CATEGORIES.CHEAP,        msg: (g) => `${g.terms.length} "cheap/affordable" terms found — lower conversion intent. Consider negative matching.` },
  ]

  for (const { cat, msg } of WARN_CATS) {
    if (groups[cat]) warnings.push({ type: cat, message: msg(groups[cat]), cost: groups[cat].totalCost, count: groups[cat].terms.length })
  }

  return warnings
}
