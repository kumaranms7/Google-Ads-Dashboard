import React, { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Layers, Link2, Type, AlignLeft, Megaphone, ListChecks, Phone } from 'lucide-react'
import { NoAccount } from './shared.jsx'
import SitelinksTab from './SitelinksTab.jsx'
import CampaignTextAssetTab from './CampaignTextAssetTab.jsx'
import CalloutTab from './CalloutTab.jsx'
import StructuredSnippetTab from './StructuredSnippetTab.jsx'
import CallAssetTab from './CallAssetTab.jsx'

const TABS = [
  { id: 'sitelinks',  label: 'Sitelinks',           icon: Link2      },
  { id: 'headline',   label: 'Headline',            icon: Type       },
  { id: 'description', label: 'Description',        icon: AlignLeft  },
  { id: 'callout',    label: 'Callout',             icon: Megaphone  },
  { id: 'snippet',    label: 'Structured Snippet',  icon: ListChecks },
  { id: 'call',       label: 'Call',                icon: Phone      },
]

export default function AIAssetsBuilder({ selectedAccount, hidePaused }) {
  const location = useLocation()
  // Lets other pages deep-link straight into a specific tab, e.g. Audit's
  // Asset Audit "Add Callouts" button navigating here with a target tab —
  // navigate('/ai-sitelinks-builder', { state: { tab: 'callout' } }).
  const [activeTab, setActiveTab] = useState(location.state?.tab || 'sitelinks')

  if (!selectedAccount) return <NoAccount />

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>

      {/* ── Page header ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1a3a6b', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Layers size={22} color="#1a3a6b" />
          AI Assets Builder
        </div>
        <div style={{ fontSize: 12, color: '#888' }}>
          Account: <strong style={{ color: '#1a3a6b' }}>{selectedAccount.name}</strong>
          <span style={{ margin: '0 6px', color: '#dde9f5' }}>|</span>
          ID: {selectedAccount.id}
        </div>
      </div>

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
      {activeTab === 'sitelinks'   && <SitelinksTab selectedAccount={selectedAccount} hidePaused={hidePaused} />}
      {activeTab === 'headline'    && <CampaignTextAssetTab selectedAccount={selectedAccount} hidePaused={hidePaused} fieldType="HEADLINE" />}
      {activeTab === 'description' && <CampaignTextAssetTab selectedAccount={selectedAccount} hidePaused={hidePaused} fieldType="DESCRIPTION" />}
      {activeTab === 'callout'     && <CalloutTab selectedAccount={selectedAccount} hidePaused={hidePaused} />}
      {activeTab === 'snippet'     && <StructuredSnippetTab selectedAccount={selectedAccount} hidePaused={hidePaused} />}
      {activeTab === 'call'        && <CallAssetTab selectedAccount={selectedAccount} hidePaused={hidePaused} />}
    </div>
  )
}
