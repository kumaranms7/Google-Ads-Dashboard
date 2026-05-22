import React from 'react'

function Sk({ w = '100%', h = 16, r = 4, style = {} }) {
  return (
    <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />
  )
}

function SkKPICard() {
  return (
    <div style={{ background: '#dde9f5', borderRadius: 8, padding: '14px 16px', animation: 'pulse 1.6s ease-in-out infinite' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <Sk w="55%" h={11} />
        <Sk w="18%" h={18} r={4} />
      </div>
      <Sk w="65%" h={24} r={4} style={{ marginBottom: 8 }} />
      <Sk w="40%" h={10} />
    </div>
  )
}

function SkTable() {
  return (
    <div className="card">
      <div className="card-header"><Sk w="35%" h={13} /></div>
      <div>
        <div style={{ background: '#1a3a6b', padding: '10px 14px', display: 'flex', gap: 16, opacity: 0.5 }}>
          {['35%','12%','12%','12%','12%','10%','10%'].map((w, i) => (
            <Sk key={i} w={w} h={10} style={{ background: 'rgba(255,255,255,0.3)' }} />
          ))}
        </div>
        {[1,2,3,4,5].map(i => (
          <div key={i} style={{ padding: '9px 14px', display: 'flex', gap: 16, borderBottom: '1px solid #f0f4f8' }}>
            {['35%','12%','12%','12%','12%','10%','10%'].map((w, j) => (
              <Sk key={j} w={w} h={11} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function LoadingSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI rows */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {[1,2,3,4].map(i => <SkKPICard key={i} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {[1,2,3,4].map(i => <SkKPICard key={i} />)}
      </div>

      {/* Chart row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
        <div className="card">
          <div className="card-header">
            <Sk w="35%" h={13} />
            <Sk w="160px" h={28} r={6} />
          </div>
          <div className="card-body">
            <Sk w="100%" h={240} r={6} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><Sk w="55%" h={13} /></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ position: 'relative', width: 180, height: 180 }}>
              <Sk w={180} h={180} r={90} />
              <div style={{ position: 'absolute', inset: 36, background: '#f5f7fa', borderRadius: '50%' }} />
            </div>
            <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[1,2,3,4].map(i => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sk w={10} h={10} r={2} />
                  <div style={{ flex: 1 }}><Sk w="80%" h={11} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <SkTable />
        <div className="card">
          <div className="card-header"><Sk w="40%" h={13} /></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Sk w={52} h={11} />
                <Sk w="1fr" h={8} r={4} style={{ flex: 1 }} />
                <Sk w={30} h={11} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
