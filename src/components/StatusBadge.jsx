import { CAMPAIGN_STATUS, MATCH_TYPE, APPROVAL_STATUS, AD_STRENGTH, resolveEnum } from '../utils/enumMaps.js'

const BADGE_STYLES = {
  // Campaign / ad-group status
  'Enabled':              { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' },
  'Active':               { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' },
  'Eligible':             { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' },
  'Paused':               { bg: '#fff3e0', text: '#a56700', border: '#f0b429' },
  'Removed':              { bg: '#f5f5f5', text: '#4a4a4a', border: '#9e9e9e' },
  'Limited':              { bg: '#fff8e1', text: '#a56700', border: '#f0b429' },
  'Mixed':                { bg: '#fff3e0', text: '#a56700', border: '#f0b429' },
  // Approval
  'Disapproved':          { bg: '#fdecea', text: '#c62828', border: '#e05c2a' },
  'Under Review':         { bg: '#fff8e1', text: '#a56700', border: '#f0b429' },
  'Approved':             { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' },
  'Approved Limited':     { bg: '#fff8e1', text: '#a56700', border: '#f0b429' },
  'Area of Interest':     { bg: '#fff8e1', text: '#a56700', border: '#f0b429' },
  // Ad strength
  'Excellent':            { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' },
  'Good':                 { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' },
  'Average':              { bg: '#e3f2fd', text: '#1565c0', border: '#3a8fd1' },
  'Fair':                 { bg: '#fff8e1', text: '#a56700', border: '#f0b429' },
  'Poor':                 { bg: '#fdecea', text: '#c62828', border: '#e05c2a' },
  'Pending':              { bg: '#f5f5f5', text: '#666',    border: '#bdbdbd' },
  'No Ads':               { bg: '#f5f5f5', text: '#666',    border: '#bdbdbd' },
  // Match types
  'Broad':                { bg: '#e3f2fd', text: '#1565c0', border: '#3a8fd1' },
  'Phrase':               { bg: '#e8eaf6', text: '#283593', border: '#2563b0' },
  'Exact':                { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' },
  // Call status
  'Connected':            { bg: '#e8f5e9', text: '#2e7d32', border: '#4caf50' },
  'Not Connected':        { bg: '#fdecea', text: '#c62828', border: '#e05c2a' },
  // Ad type highlight
  'Responsive Search Ad': { bg: '#e3f2fd', text: '#1565c0', border: '#3a8fd1' },
  // Fallback
  'default':              { bg: '#f5f5f5', text: '#4a4a4a', border: '#bdbdbd' },
}

const TYPE_MAP = {
  status:   CAMPAIGN_STATUS,
  match:    MATCH_TYPE,
  approval: APPROVAL_STATUS,
  strength: AD_STRENGTH,
}

export default function StatusBadge({ value, type = 'status', style = {} }) {
  const map   = TYPE_MAP[type] ?? CAMPAIGN_STATUS
  const label = resolveEnum(map, value, String(value ?? '—'))
  const s     = BADGE_STYLES[label] ?? BADGE_STYLES['default']

  return (
    <span style={{
      background:   s.bg,
      color:        s.text,
      border:       `1px solid ${s.border}`,
      borderRadius: 99,
      padding:      '2px 10px',
      fontSize:     11,
      fontWeight:   500,
      display:      'inline-block',
      whiteSpace:   'nowrap',
      ...style,
    }}>
      {label}
    </span>
  )
}
