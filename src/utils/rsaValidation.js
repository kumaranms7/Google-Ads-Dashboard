// RSA asset validation rules per Google Ads specs

export const HEADLINE_MAX    = 30
export const DESCRIPTION_MAX = 90
export const HEADLINES_REQUIRED    = 15
export const DESCRIPTIONS_REQUIRED = 4

// Words/phrases that should never appear in RSA assets
export const FORBIDDEN_PATTERNS = [
  /\bcheap\b/i,
  /\bdiy\b/i,
  /\bdo.?it.?yourself\b/i,
  /\bjunk.?removal.?job/i,
  /\bhiring\b/i,
  /\bwanted\b/i,
  /\bcurbside.?pickup\b/i,
  /\bbulk.?pickup\b/i,
  /\bcity.?pickup\b/i,
  /\bmunicipa\w+.?pickup\b/i,
  /\bdump.?near.?me\b/i,
  /\bwaste.?site\b/i,
  /\blandfill\b/i,
]

// Patterns that indicate a missing or weak CTA
export const CTA_PATTERNS = [
  /\bcall\b/i, /\bget\b/i, /\bbook\b/i, /\bschedule\b/i,
  /\brequest\b/i, /\bhire\b/i, /\bcontact\b/i, /\bquote\b/i,
  /\bestimate\b/i, /\bstart\b/i, /\bfind\b/i, /\border\b/i,
  /\bsign.?up\b/i, /\btry\b/i, /\bremove\b/i, /\bclean\b/i,
]

// Generic phrases that add no value
export const GENERIC_PATTERNS = [
  /^(?:best|top|great)\s+(?:service|quality|value|deal|company)s?$/i,
  /^we\s+(?:are|offer|provide|have)\b/i,
  /^click\s+here/i,
  /^learn\s+more$/i,
  /^find\s+out\s+more$/i,
  /^contact\s+us\s*(?:today|now)?$/i,
  /^#\s*1\s+(?:in|for)?/i,
  /^top\s+rated\s*(?:in|for)?/i,
]

// Connectors, articles, and subordinators that grammatically demand
// something after them — a headline/description ending on one of these is
// always a cut-off fragment, not a stylistic choice. Mirrors the same list
// electron/main.js uses server-side to trim/reject generated text; kept here
// too so the score shown in the UI reflects the same rule (previously the
// score only checked length/keywords/variety and could call a fragment
// "Excellent").
const DANGLING_WORD = /\b(for|and|the|a|an|to|of|in|on|at|by|or|nor|with|from|into|about|over|after|before|as|since|because|although|though|is|are|was|were|has|had|will|would|could|should|can|may|might|must|shall|do|does|did|your|our|their|its|this|that|these|those|we|you|they)\s*$/i

// Google Ads Dynamic Keyword Insertion syntax — {KeyWord:Default Text} (case
// of "keyword" controls capitalization: {Keyword:...}, {KeyWord:...}, etc.).
// The braces and "keyword:" tag are never displayed and don't count toward
// the character limit — only the default-text fallback does, since that's
// what actually renders whenever Google can't fit the matched search term.
const DKI_PATTERN = /\{keyword:([^}]+)\}/gi

/** Strips DKI syntax down to the default text Google actually counts/displays. */
export function getEffectiveText(text) {
  return String(text || '').replace(DKI_PATTERN, '$1')
}

/** Effective character length for validation — DKI-aware (see getEffectiveText). */
export function getEffectiveLength(text) {
  return getEffectiveText(text).length
}

/** True if text ends mid-thought — a dangling connector, or a trailing comma. */
export function endsIncomplete(text) {
  const t = getEffectiveText(text).trim()
  if (!t) return true
  if (t.endsWith(',')) return true
  return DANGLING_WORD.test(t)
}

/** Validate a single headline text. Returns array of issue strings (empty = valid). */
export function validateHeadline(text) {
  const issues = []
  if (!text || !text.trim()) { issues.push('Empty'); return issues }
  const len = getEffectiveLength(text)
  if (len > HEADLINE_MAX) issues.push(`Too long (${len}/${HEADLINE_MAX} chars)`)
  if (endsIncomplete(text)) issues.push('Ends mid-phrase — reads as cut off')
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.test(text)) { issues.push('Contains forbidden wording'); break }
  }
  return issues
}

/** Validate a single description text. Returns array of issue strings. */
export function validateDescription(text) {
  const issues = []
  if (!text || !text.trim()) { issues.push('Empty'); return issues }
  const len = getEffectiveLength(text)
  if (len > DESCRIPTION_MAX) issues.push(`Too long (${len}/${DESCRIPTION_MAX} chars)`)
  if (endsIncomplete(text)) issues.push('Ends mid-sentence — not a complete thought')
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.test(text)) { issues.push('Contains forbidden wording'); break }
  }
  return issues
}

/** Detect exact duplicates in a list of strings. Returns Set of duplicate texts. */
export function findDuplicates(texts) {
  const seen = new Set()
  const dupes = new Set()
  for (const t of texts) {
    const key = t.toLowerCase().trim()
    if (seen.has(key)) dupes.add(key)
    else seen.add(key)
  }
  return dupes
}

/** Detect near-duplicates (same words, different order or minor suffix). */
export function findNearDuplicates(texts) {
  const normalize = t => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).sort().join(' ')
  const seen = new Map()   // normalized → original
  const pairs = []
  for (const t of texts) {
    const key = normalize(t)
    if (seen.has(key)) pairs.push([seen.get(key), t])
    else seen.set(key, t)
  }
  return pairs
}

/** Check if any headline contains a keyword from the provided list. */
export function hasKeywordCoverage(headlines, keywords) {
  const kwLower = keywords.map(k => k.toLowerCase().trim())
  const hlText  = headlines.map(h => (h.text || h).toLowerCase())
  return kwLower.some(kw => hlText.some(h => h.includes(kw) || kw.split(' ').some(w => w.length > 3 && h.includes(w))))
}

/** Check whether at least one headline or description contains a CTA. */
export function hasCTA(assets) {
  return assets.some(a => CTA_PATTERNS.some(p => p.test(a.text || a)))
}

/** Full RSA validation — returns { valid, errors, warnings } */
export function validateRSA({ headlines, descriptions }) {
  const errors   = []
  const warnings = []

  // Count checks
  if (headlines.length < HEADLINES_REQUIRED)
    errors.push(`Need ${HEADLINES_REQUIRED} headlines, have ${headlines.length}`)
  if (descriptions.length < DESCRIPTIONS_REQUIRED)
    errors.push(`Need ${DESCRIPTIONS_REQUIRED} descriptions, have ${descriptions.length}`)

  // Character length (DKI-aware — {KeyWord:Default Text} counts as its default text only)
  headlines.forEach((h, i) => {
    const t = h.text || h
    const len = getEffectiveLength(t)
    if (len > HEADLINE_MAX) errors.push(`Headline ${i + 1} exceeds ${HEADLINE_MAX} chars (${len})`)
  })
  descriptions.forEach((d, i) => {
    const t = d.text || d
    const len = getEffectiveLength(t)
    if (len > DESCRIPTION_MAX) errors.push(`Description ${i + 1} exceeds ${DESCRIPTION_MAX} chars (${len})`)
  })

  // Duplicates
  const hlTexts = headlines.map(h => h.text || h)
  const dTexts  = descriptions.map(d => d.text || d)
  if (findDuplicates(hlTexts).size > 0)  warnings.push('Duplicate headlines detected')
  if (findDuplicates(dTexts).size > 0)   warnings.push('Duplicate descriptions detected')
  if (findNearDuplicates(hlTexts).length > 0) warnings.push('Near-duplicate headlines detected')

  // Sentence completeness
  const incompleteCount = [...hlTexts, ...dTexts].filter(t => endsIncomplete(t)).length
  if (incompleteCount > 0) warnings.push(`${incompleteCount} asset(s) end mid-sentence — not a complete thought`)

  // Forbidden wording
  const allTexts = [...hlTexts, ...dTexts]
  for (const p of FORBIDDEN_PATTERNS) {
    if (allTexts.some(t => p.test(t))) {
      warnings.push('Forbidden wording found (free/cheap/DIY/city pickup etc.)')
      break
    }
  }

  // CTA check
  if (!hasCTA([...headlines, ...descriptions])) warnings.push('No clear CTA found in any asset')

  return { valid: errors.length === 0, errors, warnings }
}
