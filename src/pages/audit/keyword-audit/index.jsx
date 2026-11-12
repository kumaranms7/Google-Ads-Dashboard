import React, { useState } from 'react'
import { InnerTabStrip, PdfHeading, computeKwPerfIssues, computeSearchTermNegatives } from '../shared.jsx'
import KeywordPerformanceTab from './KeywordPerformanceTab.jsx'
import SearchTermsTab from './SearchTermsTab.jsx'
import KeywordConflictTab from './KeywordConflictTab.jsx'
import KeywordCrossoverTab from './KeywordCrossoverTab.jsx'

const SUB_TABS = [
  { id: 'performance', label: 'Keyword Performance' },
  { id: 'searchTerms',  label: 'Search Terms' },
  { id: 'conflict',     label: 'Keyword Conflict' },
  { id: 'crossover',    label: 'Keyword Crossover' },
]

const SUB_TAB_INFO = {
  performance: { title: 'Keyword Performance', description: 'Keywords with high spend and no conversions, poor quality score, low CTR, or high CPC, plus your best-converting keywords.' },
  searchTerms:  { title: 'Search Terms',        description: 'Converting search terms worth adding as their own keyword, and wasted-spend terms worth excluding as negatives.' },
  conflict:     { title: 'Keyword Conflict',    description: 'Negative keywords that block, or could block, one of your own positive keywords (positive vs. negative).' },
  crossover:    { title: 'Keyword Crossover',   description: 'The same keyword text targeted in more than one ad group or campaign, causing internal competition (positive vs. positive).' },
}

export default function KeywordAuditTab(props) {
  const [sub, setSub] = useState('performance')
  const { pdfMode } = props
  // Same array builders the tables themselves render from, so these badges
  // always sum to exactly the top-level "Keyword Audit" nav badge.
  const counts = {
    performance: computeKwPerfIssues(props.kwAnalysis).length,
    searchTerms: computeSearchTermNegatives(props.stAnalysis).length,
    conflict:  (props.conflictData?.conflicts || []).length,
    crossover: (props.data?.keywords?.conflicts || []).length,
  }

  return (
    <div>
      {!pdfMode && <InnerTabStrip tabs={SUB_TABS} activeTab={sub} onChange={setSub} counts={counts} />}
      {(sub === 'performance' || pdfMode) && <>{pdfMode && <PdfHeading level={2} {...SUB_TAB_INFO.performance} />}<KeywordPerformanceTab {...props} /></>}
      {(sub === 'searchTerms' || pdfMode)  && <>{pdfMode && <PdfHeading level={2} {...SUB_TAB_INFO.searchTerms} />}<SearchTermsTab {...props} /></>}
      {(sub === 'conflict' || pdfMode)     && <>{pdfMode && <PdfHeading level={2} {...SUB_TAB_INFO.conflict} />}<KeywordConflictTab {...props} /></>}
      {(sub === 'crossover' || pdfMode)    && <>{pdfMode && <PdfHeading level={2} {...SUB_TAB_INFO.crossover} />}<KeywordCrossoverTab {...props} /></>}
    </div>
  )
}
