import React, { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import dayjs from 'dayjs'

const TABS = [
  { key: 'clicks',      label: 'Clicks',      primary: 'clicks',      secondary: 'impressions' },
  { key: 'spend',       label: 'Spend',        primary: 'spend',       secondary: null },
  { key: 'conversions', label: 'Conversions',  primary: 'conversions', secondary: null },
]

const FMT = {
  clicks:      v => Number(v).toLocaleString(),
  impressions: v => Number(v).toLocaleString(),
  spend:       v => '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  conversions: v => Number(v).toLocaleString(),
}

const CustomTooltip = ({ active, payload, label, tab }) => {
  if (!active || !payload?.length) return null
  const fmt = dayjs(label).isValid() ? dayjs(label).format('MMM D') : label
  return (
    <div style={{
      background: '#fff', border: '1px solid #dde9f5', borderRadius: 7,
      padding: '8px 12px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: '#1a3a6b', marginBottom: 4 }}>{fmt}</div>
      {payload.map(p => (
        <div key={p.name} style={{ fontSize: 12, color: p.color }}>
          <span style={{ fontWeight: 600 }}>{p.name}:</span> {FMT[p.dataKey]?.(p.value) ?? p.value}
        </div>
      ))}
    </div>
  )
}

const TickDate = ({ x, y, payload }) => {
  const label = dayjs(payload.value).isValid() ? dayjs(payload.value).format('MMM D') : payload.value
  return <text x={x} y={y + 10} textAnchor="middle" fill="#888" fontSize={10}>{label}</text>
}

const TickY = ({ x, y, payload, tab }) => {
  const v = tab === 'spend'
    ? '$' + (payload.value >= 1000 ? (payload.value / 1000).toFixed(0) + 'k' : payload.value)
    : payload.value >= 1000 ? (payload.value / 1000).toFixed(0) + 'k' : payload.value
  return <text x={x - 4} y={y + 4} textAnchor="end" fill="#888" fontSize={10}>{v}</text>
}

export default function PerformanceChart({ dailySeries }) {
  const [activeTab, setActiveTab] = useState('clicks')
  const tab = TABS.find(t => t.key === activeTab) || TABS[0]

  const data = (dailySeries || []).map(d => ({ ...d, name: d.date }))

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Performance Over Time</span>
        <div style={{ display: 'flex', gap: 2, background: '#f5f7fa', borderRadius: 6, padding: 3 }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: '4px 12px', fontSize: 12,
                fontWeight: activeTab === t.key ? 700 : 400,
                color: activeTab === t.key ? '#1a3a6b' : '#888',
                background: activeTab === t.key ? '#fff' : 'transparent',
                borderRadius: 4, border: 'none', cursor: 'pointer',
                borderBottom: activeTab === t.key ? '2px solid #e8a020' : '2px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card-body">
        {(!data || data.length === 0) ? (
          <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 13 }}>
            No data available for the selected period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="name" tick={<TickDate />} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={<TickY tab={activeTab} />} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={<CustomTooltip tab={activeTab} />} />
              <Legend iconType="line" wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
              <Line
                type="monotone"
                dataKey={tab.primary}
                name={tab.label}
                stroke="#2563b0"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
              {tab.secondary && (
                <Line
                  type="monotone"
                  dataKey={tab.secondary}
                  name="Impressions"
                  stroke="#3a8fd1"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
