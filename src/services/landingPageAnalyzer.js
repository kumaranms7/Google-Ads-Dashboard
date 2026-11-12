// Thin client-side wrapper — delegates to the Electron main process
// which does the actual HTTP fetch + HTML parsing via landingPageFetcher.js.

export async function analyzeLandingPage(url, { bustCache = false } = {}) {
  if (!url || !url.startsWith('http')) {
    return { error: 'No valid URL provided', url }
  }
  return window.electronAPI.rsaAnalyzeLandingPage({ url, bustCache })
}
