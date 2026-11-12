import { describe, it, expect } from 'vitest'
import { estimateConversionReadiness, gradeFor } from '../conversionReadinessEngine.js'

const KEYWORDS = [
  { text: 'same day junk removal', impressions: 200, clicks: 30, conversions: 10, cost: 90 },
  { text: 'junk removal', impressions: 1000, clicks: 80, conversions: 2, cost: 300 },
]

// A genuine offer (free estimate) and a genuine restriction (commercial only)
// declared on the business — the only things that should ever unlock those
// two components. Without these, offer/leadQualification must stay N/A no
// matter what the ad copy itself claims.
const USPS_WITH_OFFER_AND_RESTRICTION = ['Free no-obligation estimates', 'Commercial customers only']

const STRONG_HEADLINES = [
  'Same Day Junk Removal',
  'Licensed and Insured Crew',
  'Free No-Obligation Estimate',
  'Call Now for Same-Day Service',
  'Rated 5 Stars by Local Customers',
]
const STRONG_DESCRIPTIONS = [
  'Same day junk removal with a free, no-obligation estimate. Licensed and insured crew serving your area.',
  'Call now to book same-day service for commercial customers only. Trusted since 2005.',
]

describe('gradeFor', () => {
  it('maps thresholds to the documented labels', () => {
    expect(gradeFor(85)).toBe('Strong')
    expect(gradeFor(65)).toBe('Moderate')
    expect(gradeFor(40)).toBe('Weak')
    expect(gradeFor(10)).toBe('Poor')
  })
})

describe('estimateConversionReadiness', () => {
  it('returns a breakdown whose seven components sum to max 100, and score equals the sum of scores when every component is applicable', () => {
    const result = estimateConversionReadiness({
      headlines: STRONG_HEADLINES, descriptions: STRONG_DESCRIPTIONS, keywords: KEYWORDS,
      usps: USPS_WITH_OFFER_AND_RESTRICTION,
    })
    const keys = ['searchIntentMatch', 'offerValueProposition', 'benefitsOutcomes', 'trustProof', 'landingPageMatch', 'strongCta', 'leadQualification']
    expect(Object.keys(result.breakdown).sort()).toEqual(keys.sort())
    const maxSum = Object.values(result.breakdown).reduce((s, c) => s + c.max, 0)
    expect(maxSum).toBe(100)
    expect(Object.values(result.breakdown).every(c => c.applicable)).toBe(true)
    // Individual component scores can be fractional (e.g. "1 of 2 target
    // headlines" earns exactly half credit) while the overall score is
    // rounded for display — compare with rounding instead of exact equality.
    const scoreSum = Object.values(result.breakdown).reduce((s, c) => s + c.score, 0)
    expect(Math.round(scoreSum)).toBe(result.score)
  })

  it('scores strong, offer/trust/CTA-rich, qualified copy meaningfully higher than generic copy', () => {
    const strong = estimateConversionReadiness({
      headlines: STRONG_HEADLINES, descriptions: STRONG_DESCRIPTIONS, keywords: KEYWORDS,
      usps: USPS_WITH_OFFER_AND_RESTRICTION,
    })
    const weak = estimateConversionReadiness({
      headlines: ['Junk Removal', 'Great Service', 'We Can Help', 'Learn More', 'Quality Service'],
      descriptions: ['We offer junk removal services.', 'Contact us for more information about our company.'],
      keywords: KEYWORDS,
      usps: USPS_WITH_OFFER_AND_RESTRICTION,
    })
    expect(strong.score).toBeGreaterThan(weak.score)
  })

  it('flags a declared offer that never shows up in the copy as an issue, scoring 0 for that component', () => {
    const result = estimateConversionReadiness({
      headlines: ['Junk Removal Services', 'We Remove Junk', 'Reliable Removal', 'Local Removal Team', 'Removal Experts'],
      descriptions: ['We remove junk from your property.', 'Contact our team for junk removal.'],
      keywords: KEYWORDS,
      usps: ['Free no-obligation estimates'],
    })
    expect(result.breakdown.offerValueProposition.applicable).toBe(true)
    expect(result.breakdown.offerValueProposition.score).toBe(0)
    expect(result.issues.some(i => /offer/i.test(i))).toBe(true)
  })

  it('marks Offer / Value Proposition not-applicable (never a hard 0) when the business has no offer at all', () => {
    const result = estimateConversionReadiness({
      headlines: STRONG_HEADLINES, descriptions: STRONG_DESCRIPTIONS, keywords: KEYWORDS,
      // no usps, no promotion, no landingPage — nothing establishes a real offer
    })
    expect(result.breakdown.offerValueProposition.applicable).toBe(false)
    expect(result.breakdown.offerValueProposition.score).toBe(0)
    // Not applicable means its 20-point weight is excluded from the denominator,
    // not just zeroed out — so a business with no offer can still reach 100.
    // (leadQualification is also N/A here since no usps/restriction were
    // declared either, so the applicable total is 100 - 20 - 5 = 75.)
    const applicableMax = Object.values(result.breakdown).filter(c => c.applicable).reduce((s, c) => s + c.max, 0)
    expect(applicableMax).toBe(75)
  })

  it('gives full lead-qualification credit only when a real restriction is declared AND the copy reflects it', () => {
    const withQualification = estimateConversionReadiness({
      headlines: STRONG_HEADLINES,
      descriptions: ['Call now to book same-day service for commercial customers only.'],
      keywords: KEYWORDS,
      usps: ['Commercial customers only'],
    })
    const declaredButNotReflected = estimateConversionReadiness({
      headlines: STRONG_HEADLINES,
      descriptions: ['Call now for same-day junk removal service.'],
      keywords: KEYWORDS,
      usps: ['Commercial customers only'],
    })
    expect(withQualification.breakdown.leadQualification.score).toBe(5)
    expect(declaredButNotReflected.breakdown.leadQualification.applicable).toBe(true)
    expect(declaredButNotReflected.breakdown.leadQualification.score).toBe(0)
  })

  it('never awards lead-qualification credit for hollow "see if you qualify" copy when no real restriction is declared — the exact false-positive this component exists to prevent', () => {
    const result = estimateConversionReadiness({
      headlines: STRONG_HEADLINES,
      descriptions: ['Call now to see if you qualify for our same-day service program.'],
      keywords: KEYWORDS,
      // no usps declaring any real restriction
    })
    expect(result.breakdown.leadQualification.applicable).toBe(false)
    expect(result.breakdown.leadQualification.score).toBe(0)
  })

  it('does not crash and returns a neutral partial score when there is no keyword data', () => {
    const result = estimateConversionReadiness({ headlines: STRONG_HEADLINES, descriptions: STRONG_DESCRIPTIONS, keywords: [], usps: USPS_WITH_OFFER_AND_RESTRICTION })
    expect(Number.isFinite(result.score)).toBe(true)
    expect(result.issues.some(i => /no keyword data/i.test(i))).toBe(true)
  })

  it('does not crash on empty headlines/descriptions (offer/leadQualification are N/A, landingPageMatch gets neutral credit, redistributed over the applicable 75 points)', () => {
    const result = estimateConversionReadiness({ headlines: [], descriptions: [], keywords: KEYWORDS })
    expect(Number.isFinite(result.score)).toBe(true)
    expect(result.breakdown.offerValueProposition.applicable).toBe(false)
    expect(result.breakdown.leadQualification.applicable).toBe(false)
    // landingPageMatch neutral credit (5 of its 10) is the only points earned,
    // out of 75 applicable points (100 minus offer's 20 and leadQualification's 5) → round(5/75*100) = 7
    expect(result.score).toBe(7)
  })

  it('reports which specific headline/description indices earned each component\'s points', () => {
    const result = estimateConversionReadiness({
      headlines: STRONG_HEADLINES, descriptions: STRONG_DESCRIPTIONS, keywords: KEYWORDS,
      usps: USPS_WITH_OFFER_AND_RESTRICTION,
    })
    expect(result.breakdown.strongCta.assets.headlines.length + result.breakdown.strongCta.assets.descriptions.length).toBeGreaterThan(0)
    expect(result.breakdown.trustProof.assets.headlines.length + result.breakdown.trustProof.assets.descriptions.length).toBeGreaterThan(0)
  })

  it('rewards a landing page whose language overlaps the ad copy over one with no overlap', () => {
    const matching = estimateConversionReadiness({
      headlines: STRONG_HEADLINES, descriptions: STRONG_DESCRIPTIONS, keywords: KEYWORDS,
      landingPage: { title: 'Same Day Junk Removal', h1: 'Licensed and Insured Junk Removal Crew', h2s: ['Free No-Obligation Estimate'] },
    })
    const mismatched = estimateConversionReadiness({
      headlines: STRONG_HEADLINES, descriptions: STRONG_DESCRIPTIONS, keywords: KEYWORDS,
      landingPage: { title: 'Wholesale Industrial Equipment Supplier', h1: 'Bulk Machinery Parts', h2s: ['Contact Sales'] },
    })
    expect(matching.breakdown.landingPageMatch.score).toBeGreaterThan(mismatched.breakdown.landingPageMatch.score)
  })
})
