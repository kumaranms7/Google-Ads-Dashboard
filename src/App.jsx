import React, { useState, useEffect, useCallback } from 'react'
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from './components/Sidebar.jsx'
import TopNav from './components/TopNav.jsx'
import Dashboard from './components/Dashboard.jsx'
import Footer from './components/Footer.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import BusinessProfileModal from './components/BusinessProfileModal.jsx'
import Reports from './pages/Reports.jsx'
import Keywords from './pages/Keywords.jsx'
import Audit from './pages/audit/index.jsx'
import AIRSABuilder from './pages/ai-rsa-builder/index.jsx'
import AISitelinksBuilder from './pages/ai-sitelinks-builder/index.jsx'
import CampaignManager from './pages/campaign-manager/index.jsx'
import AdGroupManager from './pages/ad-group-manager/index.jsx'
import KeywordsManager from './pages/keywords-manager/index.jsx'
import AIChatPanel from './components/AIChatPanel.jsx'

function AppShell() {
  const location = useLocation()
  const navigate  = useNavigate()

  const [settings,        setSettings]        = useState(null)
  const [accounts,        setAccounts]        = useState([])
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [dateRange,       setDateRange]       = useState('LAST_30_DAYS')
  const [dashboardData,   setDashboardData]   = useState(null)
  const [callSummary,     setCallSummary]     = useState(null)
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState(null)
  const [settingsOpen,    setSettingsOpen]    = useState(false)
  const [businessProfileOpen, setBusinessProfileOpen] = useState(false)
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsError,   setAccountsError]   = useState(null)
  const [refreshing,      setRefreshing]      = useState(false)
  const [lastRefreshed,   setLastRefreshed]   = useState(null)
  const [hidePaused,      setHidePaused]      = useState(false)
  const [fontScale,       setFontScale]       = useState(100)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Apply zoom to the entire document whenever fontScale changes
  useEffect(() => {
    document.body.style.zoom = fontScale + '%'
  }, [fontScale])

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const [saved, prefs] = await Promise.all([
          window.electronAPI.getSettings(),
          window.electronAPI.getPrefs(),
        ])
        setSettings(saved)
        if (prefs?.hidePaused !== undefined) setHidePaused(prefs.hidePaused)
        if (prefs?.fontScale   !== undefined) setFontScale(prefs.fontScale)
        if (prefs?.sidebarCollapsed !== undefined) setSidebarCollapsed(prefs.sidebarCollapsed)
        if (saved?.developerToken && saved?.refreshToken) {
          await loadAccounts(saved)
        } else {
          setSettingsOpen(true)
        }
      } catch { setSettingsOpen(true) }
    }
    init()
  }, [])

  const loadAccounts = useCallback(async (currentSettings) => {
    setAccountsLoading(true); setAccountsError(null)
    try {
      const accts = await window.electronAPI.fetchAccounts()
      setAccounts(accts)
      const lastId = currentSettings?.lastSelectedAccountId
      const toSelect = accts.find(a => a.id === lastId) || accts[0]
      if (toSelect) setSelectedAccount(toSelect)
    } catch (err) {
      setAccountsError(err.message || 'Failed to load accounts')
    } finally { setAccountsLoading(false) }
  }, [])

  const loadDashboard = useCallback(async (accountId, range) => {
    if (!accountId) return
    setLoading(true); setError(null)
    try {
      // Fetch dashboard and call summary in parallel
      const [data, callData] = await Promise.all([
        window.electronAPI.fetchDashboard({ customerId: accountId, dateRange: range }),
        window.electronAPI.fetchCallLeads({ customerId: accountId, dateRange: range }).catch(() => null),
      ])
      setDashboardData(data)
      setCallSummary(callData?.summary ?? null)
      setLastRefreshed(new Date())
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (selectedAccount) loadDashboard(selectedAccount.id, dateRange)
  }, [selectedAccount, dateRange, loadDashboard])

  const handleSelectAccount = (account) => { setSelectedAccount(account); setDashboardData(null) }

  const handleRefresh = async () => {
    if (!selectedAccount || refreshing) return
    setRefreshing(true)
    try {
      const [data, callData] = await Promise.all([
        window.electronAPI.refreshData({ customerId: selectedAccount.id, dateRange }),
        window.electronAPI.fetchCallLeads({ customerId: selectedAccount.id, dateRange }).catch(() => null),
      ])
      setDashboardData(data)
      setCallSummary(callData?.summary ?? null)
      setLastRefreshed(new Date())
    } catch (err) { setError(err.message || 'Refresh failed') }
    finally { setRefreshing(false) }
  }

  const handleSaveSettings = async (newSettings, fetchedAccounts) => {
    setSettings(newSettings)
    if (fetchedAccounts?.length) { setAccounts(fetchedAccounts); setSelectedAccount(fetchedAccounts[0]) }
    setSettingsOpen(false)
  }

  const handleHidePausedChange = (value) => {
    setHidePaused(value)
    window.electronAPI.setPrefs({ hidePaused: value }).catch(() => {})
  }

  const handleFontScaleChange = (value) => {
    setFontScale(value)
    window.electronAPI.setPrefs({ fontScale: value }).catch(() => {})
  }

  const handleToggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev
      window.electronAPI.setPrefs({ sidebarCollapsed: next }).catch(() => {})
      return next
    })
  }

  return (
    <div className="app-shell" style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      {!sidebarCollapsed && (
        <Sidebar
          accounts={accounts} selectedAccount={selectedAccount}
          onSelectAccount={handleSelectAccount}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenBusinessProfile={() => setBusinessProfileOpen(true)}
          hasCredentials={!!(settings?.developerToken)}
          loading={accountsLoading} error={accountsError}
          activePath={location.pathname} onNavigate={navigate}
          onToggleSidebar={handleToggleSidebar}
        />
      )}

      <div className="app-main" style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
        <TopNav
          selectedAccount={selectedAccount}
          dateRange={dateRange} onDateRangeChange={setDateRange}
          onRefresh={handleRefresh} refreshing={refreshing} lastRefreshed={lastRefreshed}
          hidePaused={hidePaused} onHidePausedChange={handleHidePausedChange}
          fontScale={fontScale} onFontScaleChange={handleFontScaleChange}
          activePath={location.pathname}
          sidebarCollapsed={sidebarCollapsed} onToggleSidebar={handleToggleSidebar}
        />

        <div className="app-routes" style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          <Routes>
            <Route path="/" element={
              <Dashboard loading={loading} error={error} dashboardData={dashboardData}
                callSummary={callSummary}
                selectedAccount={selectedAccount}
                onRetry={() => selectedAccount && loadDashboard(selectedAccount.id, dateRange)}
                hidePaused={hidePaused}
              />
            } />
            <Route path="/reports" element={
              <Reports selectedAccount={selectedAccount} dateRange={dateRange}
                dashboardData={dashboardData} hidePaused={hidePaused}
              />
            } />
            <Route path="/keywords" element={
              <Keywords selectedAccount={selectedAccount} dateRange={dateRange}
                hidePaused={hidePaused}
              />
            } />
            <Route path="/audit" element={
              <Audit selectedAccount={selectedAccount} dateRange={dateRange} />
            } />
            <Route path="/ai-rsa-builder" element={
              <AIRSABuilder selectedAccount={selectedAccount} hidePaused={hidePaused} />
            } />
            <Route path="/ai-sitelinks-builder" element={
              <AISitelinksBuilder selectedAccount={selectedAccount} hidePaused={hidePaused} />
            } />
            <Route path="/campaign-manager" element={
              <CampaignManager selectedAccount={selectedAccount} />
            } />
            <Route path="/ad-group-manager" element={
              <AdGroupManager selectedAccount={selectedAccount} />
            } />
            <Route path="/keywords-manager" element={
              <KeywordsManager selectedAccount={selectedAccount} dateRange={dateRange} />
            } />
          </Routes>
        </div>

        <Footer />
      </div>

      {settingsOpen && (
        <SettingsModal
          settings={settings} onSave={handleSaveSettings}
          onClose={() => setSettingsOpen(false)}
          canClose={!!(settings?.developerToken)}
        />
      )}

      {businessProfileOpen && selectedAccount && (
        <BusinessProfileModal
          account={selectedAccount}
          onClose={() => setBusinessProfileOpen(false)}
        />
      )}

      <AIChatPanel selectedAccount={selectedAccount} dateRange={dateRange} />
    </div>
  )
}

export default function App() {
  return (
    <MemoryRouter initialEntries={['/']}>
      <AppShell />
    </MemoryRouter>
  )
}
