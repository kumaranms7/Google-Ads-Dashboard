import { describe, it, expect, afterEach } from 'vitest'
import { computeSimilarity, setSemanticSimilarityProvider } from '../textSimilarity.js'

describe('computeSimilarity', () => {
  afterEach(() => setSemanticSimilarityProvider(null)) // restore default after provider-swap tests

  it('returns 1 for identical text (exact duplicate)', () => {
    expect(computeSimilarity('Junk Removal Services', 'Junk Removal Services')).toBeCloseTo(1, 5)
  })

  it('returns a high score for near-duplicate phrasing of the same idea', () => {
    const sim = computeSimilarity('Professional Junk Removal', 'Local Junk Removal')
    expect(sim).toBeGreaterThan(0.5)
  })

  it('returns a low score for genuinely different messages', () => {
    const sim = computeSimilarity('Licensed and Insured Crew', 'Book Your Cleanout Today')
    expect(sim).toBeLessThan(0.3)
  })

  it('is symmetric', () => {
    const a = computeSimilarity('Free Estimate Today', 'Get a Free Quote')
    const b = computeSimilarity('Get a Free Quote', 'Free Estimate Today')
    expect(a).toBeCloseTo(b, 10)
  })

  it('handles empty strings without throwing', () => {
    expect(computeSimilarity('', '')).toBe(0)
    expect(computeSimilarity('Something', '')).toBeGreaterThanOrEqual(0)
  })

  it('supports swapping in a custom semantic similarity provider', () => {
    setSemanticSimilarityProvider(() => 1) // pretend everything is semantically identical
    const sim = computeSimilarity('Completely Different', 'Totally Unrelated Text')
    // With semantic forced to 1 and blend weight 0.60 on semantic, result should be pulled well above the token-only similarity.
    expect(sim).toBeGreaterThanOrEqual(0.6)
  })
})
