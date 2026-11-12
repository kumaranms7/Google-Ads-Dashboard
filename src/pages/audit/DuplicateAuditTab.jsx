import React from 'react'
import { Copy, ArrowRight } from 'lucide-react'
import { Section, SeverityBadge } from './shared.jsx'

// Thin in this pass: Keyword Crossover (positive keyword text repeated across
// ad groups/campaigns) is the one deterministic duplicate signal that exists
// today. Campaign/ad-group/ad/asset name-similarity duplicate detection has
// no reliable non-AI signal anywhere in the codebase yet — flagged here
// honestly rather than faked.
export default function DuplicateAuditTab({ data, onGoToCrossover }) {
  const crossoverCount = (data?.keywords?.conflicts || []).length

  return (
    <Section title="Duplicate Audit">
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: crossoverCount > 0 ? 'rgba(224,92,42,0.06)' : 'rgba(76,175,80,0.06)', borderRadius: 8, border: `1px solid ${crossoverCount > 0 ? 'rgba(224,92,42,0.25)' : 'rgba(76,175,80,0.25)'}` }}>
          <Copy size={20} color={crossoverCount > 0 ? '#c0392b' : '#2e7d32'} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a3a6b' }}>{crossoverCount} duplicate keyword{crossoverCount === 1 ? '' : 's'} across ad groups/campaigns</div>
            <div style={{ fontSize: 11.5, color: '#888', marginTop: 2 }}>Same keyword text targeted in more than one place — full detail lives in Keyword Audit → Keyword Crossover.</div>
          </div>
          {onGoToCrossover && (
            <button onClick={onGoToCrossover} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#1a3a6b', color: '#fff', fontWeight: 600, fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              View <ArrowRight size={12} />
            </button>
          )}
        </div>

        <div style={{ padding: '14px 16px', background: '#fafcff', borderRadius: 8, border: '1px solid #eef2f7' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <SeverityBadge value="Low" />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1a3a6b' }}>Not yet available: campaigns, ad groups, ads &amp; assets</span>
          </div>
          <div style={{ fontSize: 12, color: '#666', lineHeight: 1.6 }}>
            Reliable duplicate detection for these entity types needs more than name-similarity — real config comparison (targeting, budget, ad copy, asset text) is not fetched account-wide anywhere in the app yet. Adding it is a planned follow-up rather than something this pass fakes with a name-matching heuristic.
          </div>
        </div>
      </div>
    </Section>
  )
}
