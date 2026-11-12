import { describe, it, expect } from 'vitest'
import { detectLandingPageMismatch } from '../rsaBuilderService.js'

const KEYWORDS = [
  { text: 'hydro jetting near me' },
  { text: 'clogged drain cleaning' },
  { text: 'blocked sewer line' },
  { text: 'sewer pipe cleaning' },
]

const LANDING_PAGE = {
  title: "John's Plumbing - Drain & Sewer Experts",
  h1: 'Get Your Drains & Sewer Line Cleared',
  h2s: [
    'Drain & Sewer Services We Provide',
    'Drain Cleaning',
    'Main Sewer Line Cleaning',
    'Sewer Camera Inspection',
    "Why Choose John's Plumbing?",
    'Service Areas We Proudly Serve',
  ],
  metaDescription: 'Professional drain and sewer cleaning services.',
  bodySnippet: 'We provide expert drain cleaning and sewer line services. Trenchless sewer repair with no digging required. We serve the greater metro area.',
}

describe('detectLandingPageMismatch', () => {
  it('returns Unknown/no-score when the landing page failed to fetch', () => {
    const result = detectLandingPageMismatch('Drain Cleaning', KEYWORDS, { error: 'timeout' })
    expect(result.score).toBeNull()
    expect(result.grade).toBe('Unknown')
  })

  it('still returns matched/unmatched/score for backward compatibility with existing callers', () => {
    const result = detectLandingPageMismatch('Drain & Sewer Cleaning', KEYWORDS, LANDING_PAGE)
    expect(typeof result.score).toBe('number')
    expect(['Good', 'Average', 'Poor']).toContain(result.grade)
    expect(Array.isArray(result.matched)).toBe(true)
    expect(Array.isArray(result.unmatched)).toBe(true)
  })

  it('matches a stemmed -ing variant even when the page uses the base form (and vice versa)', () => {
    // Page says "repair," keyword says "repairing" — old substring-only
    // matching would miss this ("repairing".includes is not what runs, but
    // the reverse direction — checking whether "repairing" is a substring of
    // the page text — would fail); stemmed matching should not.
    const result = detectLandingPageMismatch('Drain', [{ text: 'drain repairing service' }], {
      h1: 'Drain Repair', h2s: [], bodySnippet: 'We offer professional drain repair.',
    })
    expect(result.unmatched).not.toContain('repairing')
  })

  it('does not report "hydro" and "jetting" as two separate opportunities once the phrase "hydro jetting" is already reported', () => {
    const result = detectLandingPageMismatch('Drain & Sewer Cleaning', KEYWORDS, LANDING_PAGE)
    const allTexts = [...result.prioritized.high, ...result.prioritized.medium, ...result.prioritized.low].map(o => o.text)
    expect(allTexts).toContain('hydro jetting')
    expect(allTexts).not.toContain('hydro')
    expect(allTexts).not.toContain('jetting')
  })

  it('classifies a missing multi-word service phrase as HIGH priority', () => {
    const result = detectLandingPageMismatch('Drain & Sewer Cleaning', KEYWORDS, LANDING_PAGE)
    expect(result.prioritized.high.some(o => o.text === 'hydro jetting')).toBe(true)
  })

  it('classifies a missing problem/intent word (e.g. "clogged") as HIGH priority even standing alone', () => {
    const kw = [{ text: 'clogged toilet repair' }]
    const lp = { h1: 'Toilet Repair Services', h2s: ['Toilet Repair'], bodySnippet: 'We repair toilets fast.' }
    const result = detectLandingPageMismatch('Toilet Repair', kw, lp)
    const high = result.prioritized.high.map(o => o.text)
    expect(high.some(t => t.includes('clogged'))).toBe(true)
  })

  it('classifies query modifiers (near, cheap) as LOW priority, never HIGH or MEDIUM', () => {
    const result = detectLandingPageMismatch('Drain & Sewer Cleaning', [...KEYWORDS, { text: 'cheap drain cleaning' }], LANDING_PAGE)
    const low = result.prioritized.low.map(o => o.text)
    expect(low).toContain('cheap')
    expect(result.prioritized.high.map(o => o.text)).not.toContain('cheap')
    expect(result.prioritized.medium.map(o => o.text)).not.toContain('cheap')
  })

  it('classifies a bare supporting object word (e.g. "pipe") as MEDIUM when it has no adjacent word to combine into a phrase', () => {
    // A single-word keyword can't form a 2-word phrase, so "pipe" here stays
    // an orphan word candidate rather than merging into a HIGH-priority phrase.
    const kw = [{ text: 'pipe' }, { text: 'plumbing repair' }]
    const lp = { h1: 'Plumbing Repair', h2s: ['General Repairs'], bodySnippet: 'We fix plumbing issues fast.' }
    const result = detectLandingPageMismatch('Plumbing Repair', kw, lp)
    const medium = result.prioritized.medium.map(o => o.text)
    expect(medium).toContain('pipe')
  })

  it('folds an orphan word into its adjacent phrase instead of double-reporting both (e.g. "pipe" inside "pipe repair")', () => {
    const kw = [{ text: 'pipe repair service' }]
    const lp = { h1: 'Plumbing Repair', h2s: ['General Repairs'], bodySnippet: 'We fix plumbing issues fast.' }
    const result = detectLandingPageMismatch('Plumbing Repair', kw, lp)
    const allTexts = [...result.prioritized.high, ...result.prioritized.medium, ...result.prioritized.low].map(o => o.text)
    expect(allTexts).toContain('pipe repair')
    expect(allTexts).not.toContain('pipe')
  })

  it('does not flag a phrase as an opportunity once its concept is already present on the page in any word order/form', () => {
    const kw = [{ text: 'sewer line cleaning' }]
    const lp = { h1: 'Main Sewer Line Cleaning', h2s: [], bodySnippet: 'We specialize in cleaning main sewer lines for homes and businesses.' }
    const result = detectLandingPageMismatch('Sewer Line', kw, lp)
    const allUnmatched = [...result.prioritized.high, ...result.prioritized.medium, ...result.prioritized.low].map(o => o.text)
    expect(allUnmatched).not.toContain('sewer line cleaning')
  })
})
