'use strict'

let _store = null

async function getStore() {
  if (_store) return _store
  const { default: Store } = await import('electron-store')
  _store = new Store({
    name: 'google-ads-settings',
    schema: {
      mccCustomerId:         { type: 'string',  default: '' },
      developerToken:        { type: 'string',  default: '' },
      oauthClientId:         { type: 'string',  default: '' },
      oauthClientSecret:     { type: 'string',  default: '' },
      refreshToken:          { type: 'string',  default: '' },
      lastSelectedAccountId: { type: 'string',  default: '' },
      defaultDateRange:      { type: 'string',  default: 'LAST_30_DAYS' },
      hidePaused:            { type: 'boolean', default: false },
      sidebarCollapsed:      { type: 'boolean', default: false },
      claudeApiKey:          { type: 'string',  default: '' },
      merchantCenterId:      { type: 'string',  default: '' },
      accountProfiles:       { type: 'object',  default: {} },
    },
  })
  return _store
}

async function getSettings() {
  const s = await getStore()
  return {
    mccCustomerId:         s.get('mccCustomerId',     ''),
    developerToken:        s.get('developerToken',    ''),
    oauthClientId:         s.get('oauthClientId',     ''),
    oauthClientSecret:     s.get('oauthClientSecret', ''),
    refreshToken:          s.get('refreshToken',      ''),
    lastSelectedAccountId: s.get('lastSelectedAccountId', ''),
    defaultDateRange:      s.get('defaultDateRange',  'LAST_30_DAYS'),
    claudeApiKey:          s.get('claudeApiKey',      ''),
    merchantCenterId:      s.get('merchantCenterId',  ''),
  }
}

async function saveSettings(data) {
  const s = await getStore()
  const fields = ['mccCustomerId','developerToken','oauthClientId','oauthClientSecret','refreshToken','claudeApiKey','merchantCenterId']
  for (const key of fields) {
    if (data[key] !== undefined) s.set(key, data[key])
  }
}

async function getPrefs() {
  const s = await getStore()
  return {
    hidePaused:       s.get('hidePaused', false),
    sidebarCollapsed: s.get('sidebarCollapsed', false),
  }
}

async function savePrefs(data) {
  const s = await getStore()
  if (data.hidePaused       !== undefined) s.set('hidePaused',       Boolean(data.hidePaused))
  if (data.sidebarCollapsed !== undefined) s.set('sidebarCollapsed', Boolean(data.sidebarCollapsed))
}

async function getLastAccount() {
  const s = await getStore()
  return s.get('lastSelectedAccountId', '')
}

async function saveLastAccount(id) {
  const s = await getStore()
  s.set('lastSelectedAccountId', String(id))
}

// Per-account business context (advertiser identity + what they sell) used to
// ground AI asset generation — kept separate from app-level settings above
// because it's client-account data, not application config. An account can
// have MORE THAN ONE website/brand running through it (some clients advertise
// several sites from a single Google Ads account), so this is stored as a
// list of website profiles rather than one profile per account.
async function getAccountWebsites(customerId) {
  const s = await getStore()
  const profiles = s.get('accountProfiles', {})
  const entry = profiles[String(customerId)]
  if (!entry) return []
  if (Array.isArray(entry.websites)) return entry.websites
  // Migrate the old single-profile shape ({websiteUrl, advertiser, whatWeSell,
  // updatedAt}) transparently on read — no explicit migration step needed.
  if (entry.websiteUrl || entry.advertiser || entry.whatWeSell) {
    return [{ id: 'w1', websiteUrl: entry.websiteUrl || '', advertiser: entry.advertiser || '', whatWeSell: entry.whatWeSell || '', updatedAt: entry.updatedAt || '' }]
  }
  return []
}

async function saveAccountWebsites(customerId, websites) {
  const s = await getStore()
  const profiles = s.get('accountProfiles', {})
  const key = String(customerId)
  profiles[key] = { websites: websites || [] }
  s.set('accountProfiles', profiles)
  return profiles[key].websites
}

// Adds a new website entry, or updates an existing one when `website.id` is
// already present in the saved list.
async function saveAccountWebsite(customerId, website) {
  const existing = await getAccountWebsites(customerId)
  const id = website.id || `w${Date.now()}`
  const next = {
    id,
    websiteUrl: website.websiteUrl || '',
    advertiser: website.advertiser || '',
    whatWeSell: website.whatWeSell || '',
    updatedAt: new Date().toISOString(),
  }
  const idx = existing.findIndex(w => w.id === id)
  const updated = idx >= 0 ? existing.map((w, i) => i === idx ? next : w) : [...existing, next]
  await saveAccountWebsites(customerId, updated)
  return next
}

async function deleteAccountWebsite(customerId, id) {
  const existing = await getAccountWebsites(customerId)
  const updated = existing.filter(w => w.id !== id)
  await saveAccountWebsites(customerId, updated)
  return updated
}

module.exports = {
  getSettings, saveSettings, getPrefs, savePrefs, getLastAccount, saveLastAccount,
  getAccountWebsites, saveAccountWebsites, saveAccountWebsite, deleteAccountWebsite,
}
