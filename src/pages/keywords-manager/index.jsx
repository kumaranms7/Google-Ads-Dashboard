import React, { useState } from 'react'
import { KeyRound, ListChecks, PlusCircle, MinusCircle, Sparkles } from 'lucide-react'
import { NoAccount } from './shared.jsx'
import ManageKeywordsTab from './ManageKeywordsTab.jsx'
import AddNewKeywordsTab from './AddNewKeywordsTab.jsx'
import AddNegativeKeywordsTab from './AddNegativeKeywordsTab.jsx'
import AIKeywordPlannerTab from './AIKeywordPlannerTab.jsx'

const TABS = [
  { id: 'manage',  label: 'Manage Keywords',        icon: ListChecks },
  { id: 'add',     label: 'Add New Keywords',       icon: PlusCircle },
  { id: 'addNeg',  label: 'Add Negative Keywords',  icon: MinusCircle },
  { id: 'planner', label: 'AI Keyword Planner',      icon: Sparkles },
]

export default function KeywordsManager({ selectedAccount, dateRange }) {
  const [activeTab, setActiveTab] = useState('manage')

  if (!selectedAccount) return <NoAccount />

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1a3a6b', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
          <KeyRound size={22} color="#1a3a6b" />
          Keywords Manager
        </div>
        <div style={{ fontSize: 12, color: '#888' }}>
          Account: <strong style={{ color: '#1a3a6b' }}>{selectedAccount.name}</strong>
          <span style={{ margin: '0 6px', color: '#dde9f5' }}>|</span>
          ID: {selectedAccount.id}
        </div>
      </div>

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

      {activeTab === 'manage'  && <ManageKeywordsTab         selectedAccount={selectedAccount} dateRange={dateRange} />}
      {activeTab === 'add'     && <AddNewKeywordsTab         selectedAccount={selectedAccount} dateRange={dateRange} />}
      {activeTab === 'addNeg'  && <AddNegativeKeywordsTab    selectedAccount={selectedAccount} dateRange={dateRange} />}
      {activeTab === 'planner' && <AIKeywordPlannerTab       selectedAccount={selectedAccount} dateRange={dateRange} />}
    </div>
  )
}
