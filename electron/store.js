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
      claudeApiKey:          { type: 'string',  default: '' },
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
  }
}

async function saveSettings(data) {
  const s = await getStore()
  const fields = ['mccCustomerId','developerToken','oauthClientId','oauthClientSecret','refreshToken','claudeApiKey']
  for (const key of fields) {
    if (data[key] !== undefined) s.set(key, data[key])
  }
}

async function getPrefs() {
  const s = await getStore()
  return { hidePaused: s.get('hidePaused', false) }
}

async function savePrefs(data) {
  const s = await getStore()
  if (data.hidePaused !== undefined) s.set('hidePaused', Boolean(data.hidePaused))
}

async function getLastAccount() {
  const s = await getStore()
  return s.get('lastSelectedAccountId', '')
}

async function saveLastAccount(id) {
  const s = await getStore()
  s.set('lastSelectedAccountId', String(id))
}

module.exports = { getSettings, saveSettings, getPrefs, savePrefs, getLastAccount, saveLastAccount }
