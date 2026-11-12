import React from 'react'

// ── AI recommendation text highlighter ─────────────────────────────────────
// Splits free-form AI recommendation text into plain text plus two kinds of
// highlighted spans:
//   - ACTION  — imperative verbs telling the user what to do (Pause, Add, Switch…)
//   - METRIC  — the concrete numbers/keywords that justify the action ($12.40, 85%, "roof repair")
// Both are colored differently so recommendations can be scanned at a glance.

const ACTION_VERBS = [
  'Add','Remove','Delete','Pause','Re-enable','Enable','Disable','Switch','Move','Reduce','Increase',
  'Raise','Lower','Rewrite','Apply','Set','Cut','Align','Improve','Include','Filter','Analyze','Pull',
  'Adjust','Replace','Update','Optimize','Monitor','Consider','Create','Split','Merge','Target','Block',
  'Exclude','Cap','Test','Review','Check','Reallocate','Shift','Expand','Narrow','Tighten','Broaden',
  'Rotate','Refresh','Prioritize','Scale','Boost','Decrease','Fix','Restructure','Consolidate',
  'Duplicate','Archive','Pull','Rework','Trim','Bid','Group',
]

const ACTION_RE = new RegExp(`\\b(?:${ACTION_VERBS.join('|')})\\b`, 'gi')
const METRIC_RE = /\$[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?%|\b\d+\/10\b|"[^"]+"|\b\d{1,3}(?:,\d{3})+\b/g

const MASTER_RE = new RegExp(`(${METRIC_RE.source})|(${ACTION_RE.source})`, 'gi')

const STYLE = {
  action: { color:'#b71c1c', fontWeight:700, background:'#fdeaea', borderRadius:3, padding:'0 2px' },
  metric: { color:'#1565c0', fontWeight:700, background:'#e8f1fc', borderRadius:3, padding:'0 2px' },
}

/**
 * Renders recommendation text as React nodes with action verbs and key
 * metrics/keywords highlighted in distinct colors. Returns a plain string
 * unchanged (no matches) or an array of nodes.
 */
export function highlightRecommendation(text) {
  if (!text) return text
  const str = String(text)
  const nodes = []
  let lastIndex = 0
  let match
  let i = 0

  MASTER_RE.lastIndex = 0
  while ((match = MASTER_RE.exec(str)) !== null) {
    const [full, metric] = match
    if (match.index > lastIndex) nodes.push(str.slice(lastIndex, match.index))
    const isMetric = metric !== undefined
    nodes.push(
      <span key={`h${i++}`} style={isMetric ? STYLE.metric : STYLE.action}>{full}</span>
    )
    lastIndex = match.index + full.length
    if (match.index === MASTER_RE.lastIndex) MASTER_RE.lastIndex++
  }
  if (lastIndex < str.length) nodes.push(str.slice(lastIndex))

  return nodes.length ? nodes : str
}

export default highlightRecommendation
