// Single source of truth for the "Conversion Readiness Score" model — a
// second, separate score from Estimated Ad Strength. Ad Strength measures
// copy diversity/structure the way Google's own rating does; it says
// nothing about whether the ad is actually likely to convert (landing page
// quality, offer strength, trust signals, lead qualification). This model
// exists to estimate that instead. Component weights sum to 100.
//
// This is this platform's own heuristic approximation, not a Google metric
// of any kind — always label it "Conversion Readiness Score (beta estimate)"
// in the UI, distinct from "Estimated Ad Strength."

export const CONVERSION_READINESS_WEIGHTS = {
  searchIntentMatch:      25,
  offerValueProposition:  20,
  benefitsOutcomes:       15,
  trustProof:             15,
  landingPageMatch:       10,
  strongCta:              10,
  leadQualification:       5,
}

// Search-intent match (25) — split like Ad Strength's keyword-relevance
// component: presence across headlines carries more weight than a single
// description mention.
export const SEARCH_INTENT_POINTS = {
  primaryHeadlineCoverage: 15,  // primary (conversion-ranked) keyword theme in 2+ headlines
  primaryDescription:      10,  // primary keyword theme appears in a description
}
export const SEARCH_INTENT_MIN_HEADLINES = 2

// Benefits/outcomes and trust/proof (15 each) — tiered by distinct
// message-category hits, same "diminishing returns per category" shape
// used elsewhere in this app's scoring.
export const TIERED_BY_HITS = (max) => [
  { minHits: 2, points: max },
  { minHits: 1, points: Math.round(max * 0.55) },
  { minHits: 0, points: 0 },
]

// ── Offer & Lead-Qualification "source of truth" detection ─────────────────
// Both components must never be scored (or required in generation) unless
// the underlying business genuinely has one — inventing an offer or a
// qualifying restriction just to earn points is exactly the failure mode
// this is meant to prevent. These patterns run against SOURCE data (the
// landing page, USPs, and the declared active promotion) rather than the ad
// copy itself, so an ad can't validate its own invented claim. When the
// source shows nothing, the component is marked not-applicable and its
// weight is redistributed across the applicable components instead of
// silently scoring 0 — see conversionReadinessEngine.js's applicability
// handling.
export const OFFER_SOURCE_PATTERNS = [
  /\bfree\s+(estimate|quote|consultation|inspection)/i,
  /\bno[\s-]?obligation\b/i,
  /\bflat[\s-]?rate\b/i,
  /\bdiscount\b/i,
  /%\s*off\b/i,
  /\$\d+\s*off\b/i,
  /\bpromo(tion)?\b/i,
  /\bcoupon\b/i,
  /\bspecial\s+offer\b/i,
]

// A genuine ELIGIBILITY restriction — narrower than general business info
// like a service area (serving a city is basic targeting, not a qualifying
// filter). Only phrasing that actually excludes some prospects counts:
// customer-type, minimum-size, or an explicit "only" scope.
export const RESTRICTION_SOURCE_PATTERNS = [
  /\bcommercial\s+(only|customers?|clients?|properties)\b/i,
  /\bresidential\s+(only|customers?|clients?|properties)\b/i,
  /\bhomeowners?\s+only\b/i,
  /\bbusiness(es)?\s+only\b/i,
  /\bminimum\s+(project|order|job|purchase|square\s*foot|sq\.?\s*ft\.?|\$)/i,
  /\bonly\s+(serving|serves|available|for)\b/i,
  /\bappointment[\s-]?only\b/i,
  /\bmust\s+(be|have|own)\b/i,
]

// Loose check that the ad copy actually surfaces the offer/restriction the
// source confirmed exists — deliberately broader than the source patterns
// since ad copy paraphrases (e.g. "No Obligation Quote" vs. source's "free
// consultation").
export const OFFER_COPY_PATTERNS = [...OFFER_SOURCE_PATTERNS]
export const QUALIFICATION_COPY_PATTERNS = [
  ...RESTRICTION_SOURCE_PATTERNS,
  /\bif\s+you\s+(qualify|meet)\b/i,
  /\beligib(le|ility)\b/i,
]

export const CTA_URGENCY_PATTERNS = [/\btoday\b/i, /\bnow\b/i, /\bsame[- ]day\b/i, /\blimited\b/i]

export const CONVERSION_RATING_THRESHOLDS = [
  { min: 80, grade: 'Strong'   },
  { min: 60, grade: 'Moderate' },
  { min: 35, grade: 'Weak'     },
  { min: 0,  grade: 'Poor'     },
]
