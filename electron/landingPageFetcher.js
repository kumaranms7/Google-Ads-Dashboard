'use strict'

const https    = require('https')
const http     = require('http')
const zlib     = require('zlib')
const { URL }  = require('url')

// ── Browser-like request headers ─────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language':           'en-US,en;q=0.9',
  'Accept-Encoding':           'gzip, deflate, br',
  'Cache-Control':             'no-cache',
  'Pragma':                    'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest':            'document',
  'Sec-Fetch-Mode':            'navigate',
  'Sec-Fetch-Site':            'none',
  'Sec-Fetch-User':            '?1',
  'Connection':                'keep-alive',
}

// ── HTTP fetch with redirect following + decompression ───────────────────────

function fetchUrl(rawUrl, maxBytes = 500_000, redirects = 8) {
  return new Promise((resolve, reject) => {
    if (redirects === 0) return reject(new Error('Too many redirects'))
    let parsed
    try { parsed = new URL(rawUrl) } catch { return reject(new Error('Invalid URL: ' + rawUrl)) }

    const mod  = parsed.protocol === 'https:' ? https : http
    const opts = {
      headers:            { ...BROWSER_HEADERS },
      timeout:            18000,
      rejectUnauthorized: false,   // allow self-signed / expired certs on client sites
    }

    const req = mod.get(rawUrl, opts, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const loc = res.headers.location
        if (!loc) return reject(new Error('Redirect with no Location header'))
        const next = loc.startsWith('http') ? loc : new URL(loc, rawUrl).href
        return resolve(fetchUrl(next, maxBytes, redirects - 1))
      }
      if (res.statusCode && res.statusCode >= 400) {
        return reject(new Error(`HTTP ${res.statusCode} for ${rawUrl}`))
      }

      // Decompress if the server honoured Accept-Encoding
      const enc    = (res.headers['content-encoding'] || '').toLowerCase()
      let   stream = res
      try {
        if (enc === 'gzip')    stream = res.pipe(zlib.createGunzip())
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate())
        else if (enc === 'br')      stream = res.pipe(zlib.createBrotliDecompress())
      } catch { stream = res }

      const chunks = []
      let total    = 0
      stream.on('data', chunk => {
        total += chunk.length
        chunks.push(chunk)
        if (total >= maxBytes) req.destroy()
      })
      stream.on('end',   () => resolve(Buffer.concat(chunks).toString('utf8')))
      stream.on('error', reject)
    })
    req.on('error',   reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')) })
  })
}

// ── HTML parsing helpers (regex-based, no cheerio needed) ────────────────────

function extractTag(html, tag) {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? stripInlineTags(m[1]).trim() : ''
}

function extractMeta(html, name) {
  const pats = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'),
  ]
  for (const p of pats) { const m = html.match(p); if (m) return m[1].trim() }
  return ''
}

// Loosened from the original (2, 300) bounds — real headings do occasionally
// run short ("FAQ", "24/7") or long (a heading plus an inline sub-line), and
// this was silently dropping some of a page's real H2s with no indication
// to the user that anything had been cut. Still excludes single characters
// and pathological walls of text, but no longer eats a legitimate heading.
function extractAllTags(html, tag) {
  const results = []
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
  let m
  while ((m = re.exec(html)) !== null) {
    const text = stripInlineTags(m[1]).trim()
    if (text.length > 1 && text.length < 400) results.push(text)
  }
  return results
}

function stripInlineTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// Removes low-value boilerplate (nav menus, footers, cookie/consent banners)
// BEFORE heading/content extraction runs, so a mega-menu's category links or
// a footer's sitemap don't get mistaken for real page content. Deliberately
// leaves <header> alone — many sites wrap their actual hero section (H1
// included) in a semantic <header>, not just site nav, so stripping it risks
// losing real content. Regex-based like the rest of this file: best-effort,
// not a real DOM parse, so deeply nested boilerplate may not fully strip.
function stripBoilerplate(html) {
  return html
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<div[^>]*(?:id|class)=["'][^"']*(?:cookie|consent|gdpr)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ')
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractCTAs(html) {
  const ctas = new Set()
  // Button text
  const btnRe = /<button[^>]*>([\s\S]*?)<\/button>/gi
  let m
  while ((m = btnRe.exec(html)) !== null) {
    const t = stripInlineTags(m[1]).trim()
    if (t.length > 1 && t.length < 60) ctas.add(t)
  }
  // Input submit/button values
  const inputRe = /<input[^>]+(?:type=["'](?:submit|button)["'][^>]+value=["']([^"']+)["']|value=["']([^"']+)["'][^>]+type=["'](?:submit|button)["'])/gi
  while ((m = inputRe.exec(html)) !== null) {
    const t = (m[1] || m[2] || '').trim()
    if (t.length > 1 && t.length < 60) ctas.add(t)
  }
  // Anchor text with CTA keywords
  const CTA_KW = /\b(call|book|get|request|schedule|quote|estimate|hire|contact|order|buy|shop|start|sign up|try free|free quote)\b/i
  const aRe = /<a[^>]*>([\s\S]*?)<\/a>/gi
  while ((m = aRe.exec(html)) !== null) {
    const t = stripInlineTags(m[1]).trim()
    if (t.length > 1 && t.length < 60 && CTA_KW.test(t)) ctas.add(t)
  }
  return [...ctas].slice(0, 12)
}

function extractPhones(text) {
  const raw = text.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g) || []
  return [...new Set(raw)].slice(0, 3)
}

function extractServices(h1, h2s, bodyText) {
  // Extract noun phrases from headings as proxy for services
  const headings = [h1, ...h2s].filter(Boolean)
  const services = []
  headings.forEach(h => {
    // Simple heuristic: headings under 80 chars are likely service mentions
    if (h.length < 80) services.push(h)
  })
  return services.slice(0, 10)
}

// Maps each H2 to the raw text that follows it, up to the next H2 (or a
// generous cutoff near the end of the page) — this is what lets a later
// judgment of "does this section actually discuss hydro jetting" be checked
// against the section's own real content instead of guessing from the
// heading text alone.
function extractH2Sections(html, maxSections = 40, maxContentLen = 1200) {
  const positions = []
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    positions.push({ heading: stripInlineTags(m[1]).trim(), start: m.index, end: re.lastIndex })
  }
  const sections = []
  for (let i = 0; i < positions.length && sections.length < maxSections; i++) {
    const { heading, end } = positions[i]
    if (!heading || heading.length <= 1 || heading.length >= 400) continue
    const nextStart = i + 1 < positions.length ? positions[i + 1].start : Math.min(html.length, end + 4000)
    const content = stripTags(html.slice(end, nextStart)).slice(0, maxContentLen)
    sections.push({ heading, content })
  }
  return sections
}

// Nav menu links — run on the RAW html, before stripBoilerplate() removes
// <nav>/<header> for heading/content extraction. The menu is often the best
// source of "what pages this business actually wants highlighted" (curated
// by the site owner), especially for single-page / parallax sites where
// sitemap.xml only lists the one root URL and every "page" is really just
// an in-page section reached via a #hash link. Flags those same-page,
// different-section links specifically (isSameSection) so a caller can
// prioritize them — they're exactly the "different sections of the same
// page" the sitemap can never capture.
function extractNavLinks(html, baseUrl) {
  let baseNoHash
  try { const u = new URL(baseUrl); u.hash = ''; baseNoHash = u.href.replace(/\/$/, '') } catch { baseNoHash = baseUrl }

  const blocks = []
  const blockRe = /<(nav|header)[^>]*>([\s\S]*?)<\/\1>/gi
  let bm
  while ((bm = blockRe.exec(html)) !== null) blocks.push(bm[2])
  if (blocks.length === 0) return []

  const linkRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  const seen = new Set()
  const out  = []
  for (const block of blocks) {
    let m
    while ((m = linkRe.exec(block)) !== null) {
      const rawHref = m[1].trim()
      const text    = stripInlineTags(m[2]).trim()
      if (!rawHref || /^(mailto:|tel:|javascript:|#$)/i.test(rawHref)) continue
      let resolved
      try { resolved = new URL(rawHref, baseUrl).href } catch { continue }
      if (!/^https?:\/\//i.test(resolved)) continue
      if (seen.has(resolved)) continue
      seen.add(resolved)

      let isSameSection = false
      try {
        const ru = new URL(resolved)
        const noHash = `${ru.origin}${ru.pathname}`.replace(/\/$/, '')
        isSameSection = !!ru.hash && noHash === baseNoHash
      } catch {}

      out.push({ url: resolved, text: text.slice(0, 80), isSameSection })
    }
  }
  return out.slice(0, 40)
}

// ── Main analyzer ─────────────────────────────────────────────────────────────

// bustCache appends a one-off query param before fetching so a CDN/reverse
// proxy/caching plugin sitting in front of the client's site can't serve a
// stale copy after they've just edited the page — the returned `url` stays
// the clean original so it still matches the app's landingPages[url] cache key.
async function analyzeLandingPage(rawUrl, { bustCache = false } = {}) {
  let html
  try {
    const fetchTarget = bustCache
      ? rawUrl + (rawUrl.includes('?') ? '&' : '?') + '_rsacb=' + Date.now()
      : rawUrl
    html = await fetchUrl(fetchTarget)
  } catch (err) {
    return { error: err.message, url: rawUrl }
  }

  // Captured from the RAW html, before stripBoilerplate() removes <nav>/
  // <header> for the heading/content extraction below — this is the one
  // place those menu links get read, specifically for sitelink URL candidates.
  const navLinks = extractNavLinks(html, rawUrl)

  // Nav/footer/cookie-banner boilerplate stripped BEFORE any heading or
  // content extraction, so menu links and footer sitemaps never get read as
  // real page content or real headings.
  const cleanHtml   = stripBoilerplate(html)

  const title       = extractTag(html, 'title')
  const metaDesc    = extractMeta(html, 'description')
  const h1          = extractTag(cleanHtml, 'h1')
  const h2s         = extractAllTags(cleanHtml, 'h2')
  const h3s         = extractAllTags(cleanHtml, 'h3')
  const ctas        = extractCTAs(cleanHtml)
  const bodyText    = stripTags(cleanHtml)
  const phones      = extractPhones(bodyText)
  const services    = extractServices(h1, h2s, bodyText)
  const h2Sections  = extractH2Sections(cleanHtml)

  const TRUST_WORDS = [
    'licensed', 'insured', 'bonded', 'certified', 'guarantee', 'guaranteed',
    'years experience', 'years of experience', 'reviews', 'rated', '5-star',
    '5 star', 'award', 'bbb', 'accredited', 'satisfaction', 'trusted',
  ]
  const lowerBody   = bodyText.toLowerCase()
  const trustSignals = TRUST_WORDS.filter(w => lowerBody.includes(w))

  return {
    url:            rawUrl,
    title,
    metaDescription: metaDesc,
    h1,
    // Raised from (10, 8) — a real services page can easily list more than
    // 10 sections as H2s, and that cap was silently dropping the rest with
    // no "+N more" indicator anywhere the data was used.
    h2s:            h2s.slice(0, 40),
    h3s:            h3s.slice(0, 30),
    ctas,
    phoneNumbers:   phones,
    trustSignals,
    services,
    // Raised from 2000 — with nav/footer/cookie boilerplate now stripped
    // beforehand, this budget is spent on real page content instead of menu
    // links, so it can afford to cover far more of the actual page.
    bodySnippet:    bodyText.slice(0, 8000),
    // Per-heading section content — what actually appears under each H2, up
    // to the next H2. Lets an H2-update recommendation check whether a
    // section genuinely discusses a concept before suggesting it be named
    // in that heading.
    h2Sections,
    // Menu/nav links — see extractNavLinks() above. Each is
    // {url, text, isSameSection}; isSameSection flags a #hash link to a
    // different part of this SAME page rather than a genuinely separate URL.
    navLinks,
  }
}

// ── Sitemap discovery ─────────────────────────────────────────────────────────
// Real page URLs straight from the site's own sitemap.xml — far more reliable
// than guessing common paths like /about or /services.

function isSitemapFile(u) { return /sitemap[^/?]*\.xml(\?|$)/i.test(u) }

function parseSitemapLocs(xml) {
  if (!xml) return []
  const out = []
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
  let m
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim())
  return out
}

function dedupePageUrls(urls, max = 60) {
  const seen = new Set()
  const out  = []
  for (const u of urls) {
    if (!u || seen.has(u)) continue
    if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|css|js|zip|mp4|ico)(\?|$)/i.test(u)) continue
    seen.add(u)
    out.push(u)
    if (out.length >= max) break
  }
  return out
}

// Fetches /sitemap.xml (and common fallbacks). Sitemap index files (e.g. Yoast's
// sitemap_index.xml referencing post-sitemap.xml, page-sitemap.xml, etc.) are
// detected and followed one level deep.
async function fetchSitemapUrls(siteUrl, depth = 0) {
  if (depth > 1) return []

  let base
  try { const u = new URL(siteUrl); base = `${u.protocol}//${u.host}` } catch { return [] }

  const candidates = depth === 0
    ? [`${base}/sitemap.xml`, `${base}/sitemap_index.xml`, `${base}/wp-sitemap.xml`]
    : [siteUrl]

  for (const candidateUrl of candidates) {
    try {
      const xml  = await fetchUrl(candidateUrl, 3_000_000)
      const locs = parseSitemapLocs(xml)
      if (locs.length === 0) continue

      const subSitemaps = locs.filter(isSitemapFile)
      const pageUrls     = locs.filter(u => !isSitemapFile(u))

      if (subSitemaps.length > 0) {
        const nested = []
        for (const sub of subSitemaps.slice(0, 8)) {
          nested.push(...await fetchSitemapUrls(sub, depth + 1))
          if (nested.length >= 60) break
        }
        return dedupePageUrls([...pageUrls, ...nested])
      }
      return dedupePageUrls(pageUrls)
    } catch { /* try next candidate */ }
  }
  return []
}

// ── Live URL check (HEAD, falls back to GET) ─────────────────────────────────
// Used to verify AI-suggested sitelink URLs actually resolve before they're
// shown to the user — avoids surfacing 404s the model inferred but never saw.

function httpHead(rawUrl, redirects = 5) {
  return new Promise(resolve => {
    if (redirects === 0) return resolve(null)
    let parsed
    try { parsed = new URL(rawUrl) } catch { return resolve(null) }
    const mod = parsed.protocol === 'https:' ? https : http
    const req = mod.request(rawUrl, { method: 'HEAD', headers: BROWSER_HEADERS, timeout: 7000, rejectUnauthorized: false }, res => {
      res.resume()
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const loc  = res.headers.location
        const next = loc.startsWith('http') ? loc : new URL(loc, rawUrl).href
        return resolve(httpHead(next, redirects - 1))
      }
      resolve({ status: res.statusCode, finalUrl: rawUrl })
    })
    req.on('error',   () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.end()
  })
}

function httpGetStatus(rawUrl, redirects = 5) {
  return new Promise(resolve => {
    if (redirects === 0) return resolve(null)
    let parsed
    try { parsed = new URL(rawUrl) } catch { return resolve(null) }
    const mod = parsed.protocol === 'https:' ? https : http
    const req = mod.get(rawUrl, { headers: BROWSER_HEADERS, timeout: 7000, rejectUnauthorized: false }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        req.destroy()
        const loc  = res.headers.location
        const next = loc.startsWith('http') ? loc : new URL(loc, rawUrl).href
        return resolve(httpGetStatus(next, redirects - 1))
      }
      const status = res.statusCode
      req.destroy()
      resolve({ status, finalUrl: rawUrl })
    })
    req.on('error',   () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

// A redirect to a different registrable domain means the sitelink no longer
// points at the advertiser's own site (hijacked/expired path, affiliate
// redirect, etc.) — same hostname or a subdomain of it is fine, anything else
// isn't "within the authorized website" regardless of its HTTP status.
function isSameSite(finalUrl, allowedHost) {
  if (!allowedHost) return true
  try {
    const finalHost = new URL(finalUrl).hostname.replace(/^www\./, '')
    const expected   = allowedHost.replace(/^www\./, '')
    return finalHost === expected || finalHost.endsWith(`.${expected}`)
  } catch { return false }
}

// Tries HEAD first (cheap, no body download). Some servers (WAFs, certain
// CDNs/caching plugins) block or misreport HEAD, so fall back to GET before
// declaring the URL dead. When allowedHost is given, a redirect that lands
// outside that site is treated as dead, not live.
async function checkUrlLive(rawUrl, allowedHost) {
  if (!rawUrl) return false
  const head = await httpHead(rawUrl)
  if (head && head.status >= 200 && head.status < 400) return isSameSite(head.finalUrl, allowedHost)
  const get = await httpGetStatus(rawUrl)
  return !!(get && get.status >= 200 && get.status < 400 && isSameSite(get.finalUrl, allowedHost))
}

module.exports = { analyzeLandingPage, checkUrlLive, fetchSitemapUrls }
