import { describe, it, expect } from 'vitest'
import { rankKeywordsByWeight, topKeywordThemes } from '../keywordWeighting.js'

describe('rankKeywordsByWeight', () => {
  it('falls back to input order with equal weight when no performance data exists', () => {
    const ranked = rankKeywordsByWeight(['junk removal', 'trash hauling', 'debris removal'])
    expect(ranked.map(r => r.text)).toEqual(['junk removal', 'trash hauling', 'debris removal'])
    expect(ranked.every(r => r.weight === 1)).toBe(true)
  })

  it('ranks a low-impression, high-conversion-rate keyword above a high-impression, zero-conversion keyword', () => {
    const ranked = rankKeywordsByWeight([
      { text: 'general junk info', impressions: 5000, clicks: 400, conversions: 0, cost: 800 },
      { text: 'same day junk removal quote', impressions: 100, clicks: 20, conversions: 8, cost: 60 },
    ])
    expect(ranked[0].text).toBe('same day junk removal quote')
  })

  it('rewards cheaper cost-per-conversion over more expensive cost-per-conversion at equal conversion counts', () => {
    const ranked = rankKeywordsByWeight([
      { text: 'expensive lead keyword', impressions: 500, clicks: 50, conversions: 5, cost: 500 },
      { text: 'cheap lead keyword', impressions: 500, clicks: 50, conversions: 5, cost: 50 },
    ])
    expect(ranked[0].text).toBe('cheap lead keyword')
  })

  it('gives commercial-intent phrasing a boost over generic informational phrasing at equal performance', () => {
    const ranked = rankKeywordsByWeight([
      { text: 'what is junk removal', impressions: 200, clicks: 20, conversions: 2, cost: 40 },
      { text: 'emergency junk removal near me quote', impressions: 200, clicks: 20, conversions: 2, cost: 40 },
    ])
    expect(ranked[0].text).toBe('emergency junk removal near me quote')
  })

  it('treats keywords with no conversions yet as having no cost-efficiency evidence (does not crash on cost/0)', () => {
    const ranked = rankKeywordsByWeight([
      { text: 'no conversions yet', impressions: 100, clicks: 10, conversions: 0, cost: 30 },
    ])
    expect(ranked[0].weight).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(ranked[0].weight)).toBe(true)
  })

  it('accepts plain string keywords mixed with performance objects', () => {
    const ranked = rankKeywordsByWeight(['plain keyword', { text: 'perf keyword', impressions: 10, clicks: 5, conversions: 1 }])
    expect(ranked.length).toBe(2)
  })
})

describe('topKeywordThemes', () => {
  it('splits into primary (top) and secondary (rest)', () => {
    const { primary, secondary, all } = topKeywordThemes([
      { text: 'top keyword', impressions: 100, clicks: 20, conversions: 10, cost: 20 },
      { text: 'second keyword', impressions: 100, clicks: 10, conversions: 2, cost: 40 },
      { text: 'third keyword', impressions: 100, clicks: 5, conversions: 0, cost: 10 },
    ])
    expect(primary.text).toBe('top keyword')
    expect(secondary.length).toBe(2)
    expect(all.length).toBe(3)
  })

  it('returns null primary for an empty keyword list', () => {
    const { primary, secondary, all } = topKeywordThemes([])
    expect(primary).toBeNull()
    expect(secondary).toEqual([])
    expect(all).toEqual([])
  })
})
