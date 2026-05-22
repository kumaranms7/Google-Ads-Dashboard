import React from 'react'

/* __APP_VERSION__ is injected by vite.config.mjs define */
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0'

export default function Footer() {
  const year = new Date().getFullYear()
  return (
    <div style={{
      flexShrink: 0,
      height: 40,
      background: '#1a3a6b',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      borderTop: '1px solid rgba(255,255,255,0.08)',
    }}>
      <span style={{ fontSize: 12, color: '#3a8fd1' }}>
        Google Ads Dashboard by Top Ten Website Marketing
      </span>
      <span style={{ fontSize: 11, color: '#dde9f5', opacity: 0.6 }}>
        v{VERSION}
      </span>
      <span style={{ fontSize: 12, color: '#dde9f5' }}>
        © {year} Top Ten Website Marketing. All rights reserved.
      </span>
    </div>
  )
}
