export default function EmptyState({ message = 'No data available for this period.', icon = '📭' }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '3rem', color: '#4a4a4a',
    }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 14, color: '#888', textAlign: 'center', maxWidth: 320, lineHeight: 1.5 }}>
        {message}
      </div>
    </div>
  )
}
