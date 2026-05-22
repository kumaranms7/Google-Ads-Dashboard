'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings & credentials
  getSettings:    ()       => ipcRenderer.invoke('settings:get'),
  saveSettings:   (data)   => ipcRenderer.invoke('settings:save', data),

  // Preferences (hidePaused, etc.)
  getPrefs:       ()       => ipcRenderer.invoke('prefs:get'),
  setPrefs:       (data)   => ipcRenderer.invoke('prefs:set', data),

  // Accounts & dashboard
  fetchAccounts:  ()       => ipcRenderer.invoke('accounts:fetch'),
  fetchDashboard: (params) => ipcRenderer.invoke('dashboard:fetch', params),
  refreshData:    (params) => ipcRenderer.invoke('data:refresh',    params),

  // Reports
  fetchReport:    (params) => ipcRenderer.invoke('reports:fetch',   params),

  // Call leads
  fetchCallLeads: (params) => ipcRenderer.invoke('calls:fetch',     params),

  // Wasted spend keywords
  fetchWastedSpend: (params) => ipcRenderer.invoke('wasted:fetch',  params),

  // Top converting ads
  fetchTopAds:    (params) => ipcRenderer.invoke('ads:fetch',       params),

  // Negative keywords & search terms
  fetchNegatives: (params) => ipcRenderer.invoke('negatives:fetch', params),

  // Keywords with call conversion counts
  fetchKeywords:     (params) => ipcRenderer.invoke('keywords:fetch', params),

  // Keyword planner ideas
  fetchKeywordIdeas:  (params) => ipcRenderer.invoke('keywords:ideas',           params),
  cpcOptimize:        (params) => ipcRenderer.invoke('keywords:cpcOptimize',    params),
  negativeOptimize:        (params) => ipcRenderer.invoke('keywords:negativeOptimize',     params),
  negativeRowRecommend:    (params) => ipcRenderer.invoke('keywords:negativeRowRecommend', params),

  // Account audit
  fetchAudit:          (params) => ipcRenderer.invoke('audit:fetch',         params),
  auditAiRecommend:    (params) => ipcRenderer.invoke('audit:ai-recommend',  params),

  // PDF export (Electron printToPDF)
  exportPDF:      (opts)   => ipcRenderer.invoke('pdf:export',      opts),
})
