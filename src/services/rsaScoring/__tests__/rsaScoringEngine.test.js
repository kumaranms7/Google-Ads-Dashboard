import { describe, it, expect } from 'vitest'
import { estimateAdStrength, gradeFor } from '../../rsaScoringEngine.js'
import { RATING_THRESHOLDS } from '../scoringConfig.js'

// 15 genuinely distinct headlines spanning multiple message categories —
// used as the "well-formed" baseline several tests start from and then
// mutate one thing at a time.
const GOOD_HEADLINES = [
  'Junk Removal Experts',
  'Fast Junk Removal Today',
  'Property Cleanout Pros',
  'Debris Removal Service',
  'Clear Your Space Fast',
  'Reclaim Your Property',
  'Same Day Cleanout Help',
  'Licensed and Insured',
  'Trusted Since 2009',
  'Serving South Florida',
  'Free Estimate Offer',
  'Upfront Pricing Always',
  'Call For Junk Removal',
  'Book Your Cleanup Today',
  'Schedule Service Now',
].map(text => ({ text, pinned: null }))

const GOOD_DESCRIPTIONS = [
  'We handle property cleanouts, junk removal, and debris hauling every day.',
  'Clear unwanted clutter fast and reclaim your usable space without hassle.',
  'Licensed, insured, and trusted across South Florida since 2009.',
  'Book your junk removal today and request a free estimate now.',
].map(text => ({ text, pinned: null }))

const GOOD_KEYWORDS = [
  { text: 'junk removal',     impressions: 500, clicks: 50, conversions: 10 },
  { text: 'property cleanout', impressions: 200, clicks: 20, conversions: 3 },
  { text: 'debris removal',   impressions: 150, clicks: 15, conversions: 2 },
]

function baseline(overrides = {}) {
  return estimateAdStrength({
    headlines: GOOD_HEADLINES,
    descriptions: GOOD_DESCRIPTIONS,
    keywords: GOOD_KEYWORDS,
    ...overrides,
  })
}

describe('rating thresholds', () => {
  it('is internally ordered from highest to lowest minimum', () => {
    for (let i = 1; i < RATING_THRESHOLDS.length; i++) {
      expect(RATING_THRESHOLDS[i - 1].min).toBeGreaterThan(RATING_THRESHOLDS[i].min)
    }
  })

  it.each([
    [100, 'Excellent'], [85, 'Excellent'],
    [84, 'Good'], [70, 'Good'],
    [69, 'Average'], [50, 'Average'],
    [49, 'Poor'], [0, 'Poor'],
  ])('grades a score of %i as %s', (score, expected) => {
    expect(gradeFor(score)).toBe(expected)
  })
})

describe('duplicate / uniqueness detection', () => {
  it('scores full headline uniqueness for 15 genuinely distinct headlines', () => {
    const result = baseline()
    expect(result.breakdown.headlineUniqueness.score).toBeGreaterThan(result.breakdown.headlineUniqueness.max * 0.7)
    expect(result.issues.some(i => /duplicate/i.test(i))).toBe(false)
  })

  it('penalizes exact duplicate headlines', () => {
    const withDupes = [...GOOD_HEADLINES.slice(0, 13), { text: GOOD_HEADLINES[0].text, pinned: null }, { text: GOOD_HEADLINES[0].text, pinned: null }]
    const clean  = baseline()
    const dirty  = baseline({ headlines: withDupes })
    expect(dirty.breakdown.headlineUniqueness.score).toBeLessThan(clean.breakdown.headlineUniqueness.score)
    expect(dirty.issues.some(i => /exact duplicate headline/i.test(i))).toBe(true)
  })

  it('penalizes near-duplicate headlines that reword the same idea', () => {
    const nearDupes = [
      { text: 'Junk Removal Services', pinned: null },
      { text: 'Local Junk Removal', pinned: null },
      { text: 'Affordable Junk Removal', pinned: null },
      { text: 'Professional Junk Removal', pinned: null },
      ...GOOD_HEADLINES.slice(0, 11),
    ]
    const dirty = baseline({ headlines: nearDupes })
    const clean = baseline()
    expect(dirty.breakdown.headlineUniqueness.score).toBeLessThan(clean.breakdown.headlineUniqueness.score)
  })

  it('penalizes exact duplicate descriptions', () => {
    const withDupes = [GOOD_DESCRIPTIONS[0], GOOD_DESCRIPTIONS[0], GOOD_DESCRIPTIONS[1], GOOD_DESCRIPTIONS[2]]
    const dirty = baseline({ descriptions: withDupes })
    const clean = baseline()
    expect(dirty.breakdown.descriptionUniqueness.score).toBeLessThan(clean.breakdown.descriptionUniqueness.score)
    expect(dirty.issues.some(i => /exact duplicate description/i.test(i))).toBe(true)
  })

  it('gives full marks when fewer than 2 assets exist to compare (nothing to be a duplicate of)', () => {
    const result = baseline({ headlines: [GOOD_HEADLINES[0]], descriptions: GOOD_DESCRIPTIONS })
    expect(result.breakdown.headlineUniqueness.score).toBe(result.breakdown.headlineUniqueness.max)
  })
})

describe('keyword coverage', () => {
  it('rewards a primary keyword theme appearing in 2+ headlines and a description', () => {
    const result = baseline()
    expect(result.breakdown.keywordRelevance.score).toBeGreaterThan(result.breakdown.keywordRelevance.max * 0.6)
  })

  it('scores lower keyword relevance when the primary keyword is absent from headlines', () => {
    const noKeywordHeadlines = [
      'Clear Your Space Fast', 'Reclaim Your Property', 'Same Day Cleanout Help',
      'Licensed and Insured', 'Trusted Since 2009', 'Serving South Florida',
      'Free Estimate Offer', 'Upfront Pricing Always', 'Book Your Cleanup Today',
      'Schedule Service Now', 'Great Local Team', 'Ready To Help Today',
      'Friendly Local Crew', 'Call Us Anytime', 'Available This Week',
    ].map(text => ({ text, pinned: null }))
    const withKw    = baseline()
    const withoutKw = baseline({ headlines: noKeywordHeadlines })
    expect(withoutKw.breakdown.keywordRelevance.score).toBeLessThan(withKw.breakdown.keywordRelevance.score)
    expect(withoutKw.excellentChecks.find(c => c.key === 'primaryKeywordHeadlines').pass).toBe(false)
  })

  it('gives neutral partial credit when no keyword data is available at all', () => {
    const result = baseline({ keywords: [] })
    expect(result.breakdown.keywordRelevance.score).toBeGreaterThan(0)
    expect(result.breakdown.keywordRelevance.score).toBeLessThan(result.breakdown.keywordRelevance.max)
    expect(result.issues.some(i => /no keyword data/i.test(i))).toBe(true)
  })
})

describe('combination flexibility (pinning)', () => {
  function withPinned(headlinePins) {
    const headlines = GOOD_HEADLINES.map((h, i) => ({ ...h, pinned: headlinePins.includes(i) ? `HEADLINE_${i + 1}` : null }))
    return baseline({ headlines })
  }

  it('scores full marks with no pinned assets', () => {
    const result = baseline()
    expect(result.breakdown.combinationFlexibility.score).toBe(10)
  })

  it('reduces the score progressively as more assets are pinned', () => {
    const one   = withPinned([0])
    const two   = withPinned([0, 1])
    const three = withPinned([0, 1, 2])
    expect(one.breakdown.combinationFlexibility.score).toBeLessThan(10)
    expect(two.breakdown.combinationFlexibility.score).toBeLessThanOrEqual(one.breakdown.combinationFlexibility.score)
    expect(three.breakdown.combinationFlexibility.score).toBeLessThanOrEqual(two.breakdown.combinationFlexibility.score)
  })

  it('scores zero when similar/duplicate headlines are pinned together', () => {
    const headlines = GOOD_HEADLINES.map((h, i) => ({ ...h, pinned: null }))
    headlines[0] = { text: 'Junk Removal Experts', pinned: 'HEADLINE_1' }
    headlines[1] = { text: 'Junk Removal Expert',  pinned: 'HEADLINE_2' } // near-identical, pinned alongside
    const result = baseline({ headlines })
    expect(result.breakdown.combinationFlexibility.score).toBe(0)
  })

  it('fails the excellentReady pinning gate as soon as anything is pinned', () => {
    const result = withPinned([0])
    expect(result.excellentChecks.find(c => c.key === 'pinning').pass).toBe(false)
    expect(result.excellentReady).toBe(false)
  })

  it('never displays the grade "Excellent" when excellentReady is false, even if the numeric score alone would cross the threshold', () => {
    const clean  = baseline()
    const pinned = withPinned([0]) // same otherwise-strong fixture, just one pin added
    if (clean.grade === 'Excellent') {
      expect(pinned.excellentReady).toBe(false)
      expect(pinned.grade).not.toBe('Excellent')
    }
  })
})

describe('missing assets / INCOMPLETE gate', () => {
  it('is complete and gradeable when everything required is present', () => {
    const result = baseline()
    expect(result.isComplete).toBe(true)
    expect(result.grade).not.toBe('Incomplete')
  })

  it('is INCOMPLETE with no final URL', () => {
    const result = baseline({ hasFinalUrl: false })
    expect(result.isComplete).toBe(false)
    expect(result.grade).toBe('Incomplete')
    expect(result.excellentReady).toBe(false)
  })

  it('is INCOMPLETE with no ad group', () => {
    const result = baseline({ hasAdGroup: false })
    expect(result.grade).toBe('Incomplete')
  })

  it('is INCOMPLETE with no keywords available', () => {
    const result = baseline({ keywords: [] })
    expect(result.grade).toBe('Incomplete')
  })

  it('is INCOMPLETE below Google\'s minimum headline/description counts', () => {
    const result = baseline({ headlines: GOOD_HEADLINES.slice(0, 2) }) // below ABSOLUTE_MIN_HEADLINES (3)
    expect(result.grade).toBe('Incomplete')
    expect(result.issues.some(i => /at least 3 headlines/i.test(i))).toBe(true)
  })

  it('never claims excellentReady while incomplete, even with an otherwise perfect asset set', () => {
    const result = baseline({ hasFinalUrl: false })
    expect(result.excellentReady).toBe(false)
  })
})

describe('sitelink modifier', () => {
  it('is not applied when sitelinkCount is not provided', () => {
    const result = baseline()
    expect(result.sitelinkModifier).toBeNull()
    expect(result.score).toBe(result.baseScore)
  })

  it('applies increasing penalties as sitelink count drops', () => {
    const six  = baseline({ sitelinkCount: 6 })
    const four = baseline({ sitelinkCount: 4 })
    const two  = baseline({ sitelinkCount: 2 })
    const zero = baseline({ sitelinkCount: 0 })
    expect(six.sitelinkModifier).toBe(0)
    expect(four.sitelinkModifier).toBe(-2)
    expect(two.sitelinkModifier).toBe(-4)
    expect(zero.sitelinkModifier).toBe(-6)
    expect(zero.score).toBeLessThanOrEqual(four.score)
    expect(four.score).toBeLessThanOrEqual(six.score)
  })

  it('never lets the sitelink modifier push the score above 100', () => {
    const result = baseline({ sitelinkCount: 6 })
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('treats an unevaluated sitelink count as non-blocking for excellentReady', () => {
    const result = baseline() // sitelinkCount omitted entirely
    expect(result.excellentChecks.find(c => c.key === 'sitelinks').pass).toBe(true)
  })

  it('fails the excellentReady sitelink gate below the minimum when a count is actually provided', () => {
    const result = baseline({ sitelinkCount: 2 })
    expect(result.excellentChecks.find(c => c.key === 'sitelinks').pass).toBe(false)
  })
})

describe('breakdown shape', () => {
  it('always returns all six weighted components with score/max/label', () => {
    const result = baseline()
    const keys = ['assetQuantity', 'headlineUniqueness', 'descriptionUniqueness', 'keywordRelevance', 'messageVariety', 'combinationFlexibility']
    for (const key of keys) {
      expect(result.breakdown[key]).toBeDefined()
      expect(typeof result.breakdown[key].score).toBe('number')
      expect(typeof result.breakdown[key].max).toBe('number')
      expect(typeof result.breakdown[key].label).toBe('string')
    }
    const maxSum = keys.reduce((s, k) => s + result.breakdown[k].max, 0)
    expect(maxSum).toBe(100)
  })

  it('caps the total score at 100 even for a maxed-out fixture', () => {
    const result = baseline({ sitelinkCount: 6 })
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.baseScore).toBeLessThanOrEqual(100)
  })
})
