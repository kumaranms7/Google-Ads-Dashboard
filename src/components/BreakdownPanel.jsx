import React, { useEffect, useState } from 'react'

// ── Device split bar ──────────────────────────────────────────────────────────
const DEVICE_COLOR = { Mobile: '#2563b0', Desktop: '#4caf50', Tablet: '#e8a020', Other: '#888' }

function AnimatedBar({ pct, color }) {
  const [width, setWidth] = useState(0)
  useEffect(() => { const t = setTimeout(() => setWidth(pct), 100); return () => clearTimeout(t) }, [pct])
  return (
    <div style={{ flex: 1, height: 8, background: '#dde9f5', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${width}%`, background: color, borderRadius: 4, transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
    </div>
  )
}

function DeviceSection({ deviceSplit }) {
  const items = deviceSplit?.length
    ? deviceSplit
    : [{ device: 'Mobile', pct: 54 }, { device: 'Desktop', pct: 37 }, { device: 'Tablet', pct: 9 }]

  return (
    <div>
      <div style={styles.sectionTitle}>Device Split</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(d => (
          <div key={d.device} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 12, color: '#555', width: 54, flexShrink: 0 }}>{d.device}</div>
            <AnimatedBar pct={d.pct} color={DEVICE_COLOR[d.device] || '#888'} />
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1a3a6b', width: 32, textAlign: 'right', flexShrink: 0 }}>{d.pct}%</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Keyword quality dots ──────────────────────────────────────────────────────
function QualityDots({ score }) {
  return (
    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} style={{
          width: 9, height: 9, borderRadius: '50%', display: 'inline-block',
          background: i < score ? '#2563b0' : '#dde9f5',
          border: i < score ? 'none' : '1px solid #c8d9ed',
        }} />
      ))}
    </div>
  )
}

function KeywordsSection({ keywords }) {
  const items = keywords?.length
    ? keywords
    : [
        { text: 'google ads agency',  qualityScore: 9, clicks: 1840 },
        { text: 'ppc management',     qualityScore: 8, clicks: 1220 },
        { text: 'search advertising', qualityScore: 7, clicks:  880 },
        { text: 'buy ads online',     qualityScore: 6, clicks:  620 },
        { text: 'ad campaign setup',  qualityScore: 8, clicks:  510 },
      ]

  return (
    <div>
      <div style={styles.sectionTitle}>Top Keywords · Quality Score</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {items.map((kw, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#4a4a4a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {kw.text}
            </span>
            <QualityDots score={kw.qualityScore || 0} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#1a3a6b', minWidth: 14, textAlign: 'right' }}>
              {kw.qualityScore}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Budget pacing ─────────────────────────────────────────────────────────────
const fmtBudget = v => '$' + Number(v||0).toLocaleString(undefined, { minimumFractionDigits:0, maximumFractionDigits:0 })
const fmtBudgetPct = v => Number(v||0).toFixed(1) + '%'

const ISSUE_COLOR = {
  'Overpacing':        '#e05c2a',
  'No activity':       '#888888',
  'Limited by budget': '#8a6000',
}

function BudgetUtilBar({ pct }) {
  const color = pct > 120 ? '#e05c2a' : pct > 95 ? '#f0b429' : '#4caf50'
  return (
    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
      <div style={{ width:52, height:6, background:'#dde9f5', borderRadius:3, overflow:'hidden', flexShrink:0 }}>
        <div style={{ height:'100%', width:`${Math.min(pct,100)}%`, background:color, borderRadius:3 }}/>
      </div>
      <span style={{ fontSize:10, fontWeight:600, color, whiteSpace:'nowrap' }}>{fmtBudgetPct(pct)}</span>
    </div>
  )
}

function BudgetSection({ budget }) {
  const items = budget?.length ? budget : []
  return (
    <div>
      <div style={styles.sectionTitle}>Budget Pacing</div>
      {items.length === 0 ? (
        <div style={{ fontSize:12, color:'#aaa', textAlign:'center', padding:'8px 0' }}>No budget data</div>
      ) : (
        <div style={{ overflow:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
            <thead>
              <tr>
                {[['Campaign','left'],['Daily Budget','right'],['Avg. Spend','right'],['Utilization','center'],['Issue','center']].map(([l,a]) => (
                  <th key={l} style={{ padding:'6px 7px', textAlign:a, fontSize:10, fontWeight:600,
                    color:'#fff', background:'#1a3a6b', whiteSpace:'nowrap' }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((b, i) => {
                const ic = ISSUE_COLOR[b.issue]
                return (
                  <tr key={i} style={{ background: i%2===0 ? '#fff' : '#f5f7fa' }}>
                    <td style={{ padding:'6px 7px', borderBottom:'1px solid #f0f4f8', maxWidth:130,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                      color:'#1a3a6b', fontWeight:500 }} title={b.name}>{b.name}</td>
                    <td style={{ padding:'6px 7px', borderBottom:'1px solid #f0f4f8', textAlign:'right', color:'#4a4a4a' }}>
                      {fmtBudget(b.budget)}
                    </td>
                    <td style={{ padding:'6px 7px', borderBottom:'1px solid #f0f4f8', textAlign:'right', color:'#4a4a4a' }}>
                      {fmtBudget(b.spend)}
                    </td>
                    <td style={{ padding:'6px 7px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      <BudgetUtilBar pct={b.utilization ?? b.pct ?? 0}/>
                    </td>
                    <td style={{ padding:'6px 7px', borderBottom:'1px solid #f0f4f8', textAlign:'center' }}>
                      {b.issue
                        ? <span style={{ fontSize:10, fontWeight:600, padding:'2px 6px', borderRadius:3, whiteSpace:'nowrap',
                            background:`${ic}22`, color:ic, border:`1px solid ${ic}44` }}>{b.issue}</span>
                        : <span style={{ fontSize:10, color:'#4caf50', fontWeight:600 }}>OK</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
const styles = {
  sectionTitle: {
    fontSize: 11, fontWeight: 600, color: '#1a3a6b',
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10,
  },
  divider: { height: 1, background: '#dde9f5' },
}

export default function BreakdownPanel({ deviceSplit, keywords, budget }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Performance Breakdown</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <DeviceSection  deviceSplit={deviceSplit} />
        <div style={styles.divider} />
        <KeywordsSection keywords={keywords} />
        <div style={styles.divider} />
        <BudgetSection  budget={budget} />
      </div>
    </div>
  )
}
