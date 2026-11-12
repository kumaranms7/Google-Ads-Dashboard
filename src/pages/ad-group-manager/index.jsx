import React, { useState } from 'react'
import { Users, ListChecks, PlusCircle, History } from 'lucide-react'
import { NoAccount } from '../campaign-manager/shared.jsx'
import ManageTab from './ManageTab.jsx'
import CreateNewTab from './CreateNewTab.jsx'
import ChangelogPanel from './ChangelogPanel.jsx'

const TABS = [
  { id: 'manage', label: 'Manage',     icon: ListChecks },
  { id: 'create', label: 'Create New', icon: PlusCircle },
]

export default function AdGroupManager({ selectedAccount }) {
  const [activeTab, setActiveTab] = useState('manage')
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [refreshSignal, setRefreshSignal] = useState(0)

  if (!selectedAccount) return <NoAccount />

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>

      {/* ── Page header ── */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1a3a6b', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Users size={22} color="#1a3a6b" />
            Ad/Asset Group Manager
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            Account: <strong style={{ color: '#1a3a6b' }}>{selectedAccount.name}</strong>
            <span style={{ margin: '0 6px', color: '#dde9f5' }}>|</span>
            ID: {selectedAccount.id}
          </div>
        </div>
        <button
          onClick={() => setChangelogOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #dde9f5', background: '#fff', color: '#1a3a6b', cursor: 'pointer' }}
        >
          <History size={14} /> Recent Changes
        </button>
      </div>

      {changelogOpen && (
        <ChangelogPanel
          selectedAccount={selectedAccount}
          onClose={() => setChangelogOpen(false)}
          onRolledBack={() => setRefreshSignal(s => s + 1)}
        />
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '2px solid #eef2f7', marginBottom: 20, gap: 0, flexWrap: 'wrap' }}>
        {TABS.map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '10px 18px', fontSize: 13, fontWeight: active ? 700 : 500,
                color: active ? '#1a3a6b' : '#888',
                background: 'transparent', border: 'none',
                borderBottom: active ? '3px solid #1a3a6b' : '3px solid transparent',
                marginBottom: -2, cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <Icon size={14} /> {tab.label}
            </button>
          )
        })}
      </div>

      {/* ── Active tab content ── */}
      {activeTab === 'manage' && <ManageTab selectedAccount={selectedAccount} refreshSignal={refreshSignal} />}
      {activeTab === 'create' && <CreateNewTab selectedAccount={selectedAccount} />}
    </div>
  )
}
