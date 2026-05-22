import React, { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

const PALETTE = ['#1a3a6b', '#2563b0', '#3a8fd1', '#e8a020', '#4caf50', '#e05c2a']

const SEGMENT_NAMES = ['Brand Search', 'Non-Brand', 'Display', 'Shopping', 'Remarketing', 'Other']

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const { name, value, fill } = payload[0].payload
  return (
    <div style={{ background: '#fff', border: '1px solid #dde9f5', borderRadius: 6, padding: '6px 10px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: fill }}>{name}</div>
      <div style={{ fontSize: 12, color: '#555' }}>{value}%</div>
    </div>
  )
}

export default function DonutChart({ campaigns }) {
  const [activeIdx, setActiveIdx] = useState(null)

  // Build segments from campaign cost data; fallback to labelled static if none
  let segments = []
  if (campaigns?.length) {
    const totalCost = campaigns.reduce((s, c) => s + c.cost, 0)
    if (totalCost > 0) {
      segments = campaigns.slice(0, 4).map((c, i) => ({
        name:  c.name.length > 20 ? c.name.slice(0, 19) + '…' : c.name,
        value: Math.round((c.cost / totalCost) * 100),
        fill:  PALETTE[i % PALETTE.length],
      }))
      // Normalise to 100%
      const sum = segments.reduce((s, sg) => s + sg.value, 0)
      if (sum < 100 && segments.length) segments[0].value += (100 - sum)
    }
  }
  if (!segments.length) {
    // Static demo segments when no real data
    segments = [
      { name: 'Brand Search', value: 38, fill: '#1a3a6b' },
      { name: 'Non-Brand',    value: 31, fill: '#2563b0' },
      { name: 'Display',      value: 18, fill: '#3a8fd1' },
      { name: 'Shopping',     value: 13, fill: '#e8a020' },
    ]
  }

  const totalSpend = campaigns?.reduce((s, c) => s + c.cost, 0) || 0
  const spendLabel = totalSpend > 0
    ? '$' + totalSpend.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : '—'

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-header">
        <span className="card-title">Traffic by Campaign Type</span>
      </div>
      <div className="card-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div style={{ position: 'relative', width: '100%', height: 180 }}>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={segments}
                cx="50%" cy="50%"
                innerRadius={52} outerRadius={82}
                paddingAngle={2} dataKey="value"
                onMouseEnter={(_, i) => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(null)}
              >
                {segments.map((seg, i) => (
                  <Cell
                    key={seg.name}
                    fill={seg.fill}
                    opacity={activeIdx === null || activeIdx === i ? 1 : 0.5}
                    stroke="none"
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          {/* Centre label */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center', pointerEvents: 'none',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a6b' }}>{spendLabel}</div>
            <div style={{ fontSize: 9, color: '#888', marginTop: 1 }}>Total Spend</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', width: '100%' }}>
          {segments.map((seg, i) => (
            <div
              key={seg.name}
              style={{ display: 'flex', alignItems: 'center', gap: 7, opacity: activeIdx === null || activeIdx === i ? 1 : 0.5, transition: 'opacity 0.15s' }}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx(null)}
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: seg.fill, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 11, color: '#4a4a4a', fontWeight: 500, lineHeight: 1.2 }}>{seg.name}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b' }}>{seg.value}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
