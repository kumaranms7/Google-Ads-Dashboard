import { useEffect, useState } from 'react'

// PDF export (electron/main.js, 'pdf:export') toggles a `.pdf-printing` class
// on <html> before calling printToPDF so CSS can expand scroll/height-
// constrained containers to their full content. That class toggle alone
// can't un-paginate a table, though — pagination slices the data array in
// JS before render, and nothing makes React re-render just because an
// external script changed a class. This hook watches that same class via
// MutationObserver so any paginated table can bypass its slice (and show
// every row) for the moment a PDF capture is in progress.
export default function usePdfExportMode() {
  const [active, setActive] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('pdf-printing')
  )

  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setActive(el.classList.contains('pdf-printing')))
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  return active
}
