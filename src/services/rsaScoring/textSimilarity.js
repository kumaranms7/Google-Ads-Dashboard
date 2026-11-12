// Text-similarity engine used for headline/description uniqueness scoring.
//
// Deliberately kept behind a swappable interface: today it's a local
// token/stem approximation with no network calls — the score recalculates on
// nearly every keystroke in the RSA editor, so a live embeddings call per
// pairwise comparison would add unacceptable latency and cost. A real
// embeddings-based implementation can replace the "semantic" half later via
// setSemanticSimilarityProvider() without the scoring engine (or anything
// that imports computeSimilarity/similarityMatrix) needing to change at all,
// as long as the replacement keeps the same (textA, textB) -> number in
// [0, 1] contract.

import { HEADLINE_SIMILARITY_BLEND } from './scoringConfig.js'

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'nor', 'but', 'for', 'so', 'yet',
  'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'about',
  'over', 'after', 'before', 'as', 'is', 'are', 'was', 'were', 'be',
  'your', 'our', 'their', 'you', 'we', 'it', 'this', 'that',
])

// Crude suffix-stripping stemmer — not linguistically rigorous, but enough
// to fold "removal"/"removing"/"removed" or "cleanout"/"cleanouts" together
// for a same-idea check, which is the only thing this needs to do.
function stem(word) {
  return word
    .replace(/(ing|edly|ed|ies|ied)$/i, m => (m === 'ies' || m === 'ied' ? 'y' : ''))
    .replace(/(ations?|ization)$/i, '')
    .replace(/(es|s)$/i, m => (word.length - m.length >= 3 ? '' : m))
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Tokenize + stem + drop stop words. Exported for reuse by keyword/message-category logic that wants the same normalization. */
export function tokenize(text) {
  return normalize(text)
    .split(' ')
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .map(stem)
    .filter(Boolean)
}

function jaccardSimilarity(tokensA, tokensB) {
  const a = new Set(tokensA), b = new Set(tokensB)
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}

// Bag-of-words cosine similarity over term frequency vectors — a local
// stand-in for real semantic/embedding similarity. It captures repeated-word
// emphasis that plain set-based Jaccard misses (e.g. "junk junk removal"
// vs "junk removal junk" would be identical under Jaccard but this still
// treats them as very similar too, which is correct — the point is it's a
// DIFFERENT signal than Jaccard, not that it understands meaning).
function defaultSemanticSimilarity(_textA, _textB, tokensA, tokensB) {
  if (tokensA.length === 0 && tokensB.length === 0) return 0
  const freqA = {}, freqB = {}
  tokensA.forEach(t => { freqA[t] = (freqA[t] || 0) + 1 })
  tokensB.forEach(t => { freqB[t] = (freqB[t] || 0) + 1 })
  const vocab = new Set([...Object.keys(freqA), ...Object.keys(freqB)])
  let dot = 0, magA = 0, magB = 0
  for (const term of vocab) {
    const a = freqA[term] || 0, b = freqB[term] || 0
    dot += a * b; magA += a * a; magB += b * b
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom > 0 ? dot / denom : 0
}

// The swap seam — replace this to plug in a real embeddings provider later.
let semanticSimilarityImpl = defaultSemanticSimilarity

/**
 * Replace the "semantic" half of computeSimilarity — e.g. with a real
 * embeddings-based cosine similarity. Signature: (textA, textB, tokensA,
 * tokensB) => number in [0, 1]. Pass null to restore the local default.
 */
export function setSemanticSimilarityProvider(fn) {
  semanticSimilarityImpl = fn || defaultSemanticSimilarity
}

/** Similarity of two strings in [0, 1] — token (Jaccard) blended with the current semantic provider. */
export function computeSimilarity(textA, textB) {
  const tokensA = tokenize(textA)
  const tokensB = tokenize(textB)
  const token    = jaccardSimilarity(tokensA, tokensB)
  const semantic = semanticSimilarityImpl(textA, textB, tokensA, tokensB)
  return token * HEADLINE_SIMILARITY_BLEND.token + semantic * HEADLINE_SIMILARITY_BLEND.semantic
}

/** All pairwise similarities for a list of strings. Returns [{i, j, similarity}]. */
export function similarityMatrix(texts) {
  const pairs = []
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      pairs.push({ i, j, similarity: computeSimilarity(texts[i], texts[j]) })
    }
  }
  return pairs
}

/** First word (or two, if the first is very short) — used for the "repeated opening phrase" penalty. */
export function openingPhrase(text) {
  const words = normalize(text).split(' ').filter(Boolean)
  if (words.length === 0) return ''
  return words[0].length <= 3 && words.length > 1 ? `${words[0]} ${words[1]}` : words[0]
}
