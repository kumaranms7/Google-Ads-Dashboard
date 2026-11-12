import React, { useState, useRef, useEffect } from 'react'
import { MessageSquare, X, Send, Loader2, Sparkles, RotateCcw } from 'lucide-react'

const SUGGESTIONS = [
  'How is my account performing this period?',
  'Where is my budget being wasted?',
  'Which keywords should I add as negatives?',
  'What issues does my account have?',
]

const iconBtnStyle = {
  background:'rgba(255,255,255,0.15)', border:'none', borderRadius:6, width:28, height:28,
  display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', cursor:'pointer',
}

// Lightweight markdown renderer for assistant replies — mirrors the renderer
// already used for the AI Account Review (Reports.jsx MarkdownReview). Only
// ever applied to Claude's own text, never to raw user input.
function ChatMarkdown({ text }) {
  if (!text) return null
  return (
    <div style={{ fontSize:13, lineHeight:1.6 }}>
      {text.split('\n').map((line, i) => {
        if (line.startsWith('## ')) return (
          <div key={i} style={{ fontSize:13, fontWeight:700, color:'#1a3a6b', marginTop: i===0?0:10, marginBottom:4 }}>
            {line.slice(3)}
          </div>
        )
        if (line.startsWith('- ') || line.startsWith('• ')) return (
          <div key={i} style={{ display:'flex', gap:6, paddingLeft:4, paddingTop:2 }}>
            <span style={{ color:'#2563b0', flexShrink:0 }}>•</span>
            <span dangerouslySetInnerHTML={{ __html: line.slice(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }}/>
          </div>
        )
        if (line.trim() === '') return <div key={i} style={{ height:6 }}/>
        return (
          <div key={i} style={{ paddingTop:2 }}
            dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }}/>
        )
      })}
    </div>
  )
}

export default function AIChatPanel({ selectedAccount, dateRange }) {
  const [open,     setOpen]     = useState(false)
  const [messages, setMessages] = useState([]) // [{ role:'user'|'assistant', content }]
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const scrollRef = useRef(null)

  const accountId  = selectedAccount?.id
  const rangeKey   = JSON.stringify(dateRange)

  // Data context changed — old conversation could reference a different
  // account/period, so start fresh rather than risk a misleading answer.
  useEffect(() => {
    setMessages([])
    setError(null)
  }, [accountId, rangeKey])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading, open])

  async function send(text) {
    const q = (text ?? input).trim()
    if (!q || loading || !selectedAccount) return
    setInput('')
    setError(null)
    const next = [...messages, { role:'user', content:q }]
    setMessages(next)
    setLoading(true)
    try {
      const result = await window.electronAPI.chatAsk({
        customerId:  selectedAccount.id,
        accountName: selectedAccount.name,
        dateRange,
        messages:    next,
      })
      setMessages(m => [...m, { role:'assistant', content: result.text }])
    } catch (err) {
      setError(err.message === 'NO_API_KEY'
        ? 'Claude API key not configured. Add it in Settings → AI Features.'
        : (err.message || 'Something went wrong — please try again.'))
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} title="Top Ten AdPilot" style={{
          position:'fixed', right:24, bottom:24, zIndex:9998,
          width:54, height:54, borderRadius:'50%', border:'none', cursor:'pointer',
          background:'linear-gradient(135deg,#2563b0,#1a3a6b)', color:'#fff',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 6px 20px rgba(26,58,107,0.4)',
        }}>
          <MessageSquare size={22} />
        </button>
      )}

      {open && (
        <div style={{
          position:'fixed', top:0, right:0, bottom:0, width:500, maxWidth:'92vw', zIndex:9999,
          background:'#fff', boxShadow:'-6px 0 30px rgba(0,0,0,0.18)',
          display:'flex', flexDirection:'column',
        }}>
          {/* Header */}
          <div style={{
            padding:'16px 18px', background:'linear-gradient(135deg,#1a3a6b,#2563b0)', color:'#fff',
            display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0,
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:9, minWidth:0 }}>
              <Sparkles size={18} style={{ flexShrink:0 }} />
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:700 }}>Top Ten AdPilot</div>
                <div style={{ fontSize:11, opacity:0.8, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {selectedAccount?.name || 'No account selected'}
                </div>
              </div>
            </div>
            <div style={{ display:'flex', gap:6, flexShrink:0 }}>
              {messages.length > 0 && (
                <button onClick={() => { setMessages([]); setError(null) }} title="Clear conversation" style={iconBtnStyle}>
                  <RotateCcw size={15} />
                </button>
              )}
              <button onClick={() => setOpen(false)} title="Close" style={iconBtnStyle}>
                <X size={17} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{ flex:1, overflowY:'auto', padding:'16px 14px', background:'#f7f9fc' }}>
            {messages.length === 0 && (
              <div>
                <div style={{ fontSize:12.5, color:'#666', lineHeight:1.6, marginBottom:14 }}>
                  Ask me anything about <strong>{selectedAccount?.name || 'this account'}</strong>'s Google Ads
                  performance. I'll pull the latest account data before answering.
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => send(s)} disabled={!selectedAccount} style={{
                      textAlign:'left', padding:'9px 12px', fontSize:12, borderRadius:8,
                      border:'1px solid #dde9f5', background:'#fff', color:'#1a3a6b',
                      cursor: selectedAccount ? 'pointer' : 'not-allowed',
                    }}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{ display:'flex', justifyContent: m.role==='user' ? 'flex-end' : 'flex-start', marginBottom:10 }}>
                <div style={{
                  maxWidth:'88%', padding: m.role==='user' ? '9px 13px' : '11px 13px',
                  borderRadius: m.role==='user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: m.role==='user' ? '#1a3a6b' : '#fff',
                  color: m.role==='user' ? '#fff' : '#222',
                  border: m.role==='user' ? 'none' : '1px solid #e8eef7',
                  fontSize:13, boxShadow: m.role==='user' ? 'none' : '0 1px 3px rgba(0,0,0,0.04)',
                  whiteSpace: m.role==='user' ? 'pre-wrap' : 'normal',
                }}>
                  {m.role === 'user' ? m.content : <ChatMarkdown text={m.content} />}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display:'flex', justifyContent:'flex-start', marginBottom:10 }}>
                <div style={{ padding:'10px 13px', borderRadius:'12px 12px 12px 2px', background:'#fff', border:'1px solid #e8eef7', display:'flex', alignItems:'center', gap:8, fontSize:12, color:'#666' }}>
                  <Loader2 size={14} className="spin" /> Analyzing account data…
                </div>
              </div>
            )}

            {error && (
              <div style={{ padding:'10px 12px', background:'#fff5f5', border:'1px solid #ffd5cc', borderRadius:8, fontSize:12, color:'#c0392b', marginTop:6 }}>
                {error}
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ padding:'12px 14px', borderTop:'1px solid #eef2f7', background:'#fff', flexShrink:0 }}>
            <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selectedAccount ? 'Ask about this account’s performance…' : 'Select an account first'}
                disabled={!selectedAccount || loading}
                rows={1}
                style={{
                  flex:1, resize:'none', maxHeight:90, padding:'9px 12px', fontSize:13,
                  border:'1px solid #dde9f5', borderRadius:8, outline:'none', fontFamily:'inherit',
                  background: (!selectedAccount || loading) ? '#f5f7fa' : '#fff',
                }}
              />
              <button onClick={() => send()} disabled={!input.trim() || loading || !selectedAccount} style={{
                width:38, height:38, borderRadius:8, border:'none', flexShrink:0,
                background: (!input.trim() || loading || !selectedAccount) ? '#dde9f5' : '#1a3a6b',
                color:      (!input.trim() || loading || !selectedAccount) ? '#aaa'    : '#fff',
                cursor:     (!input.trim() || loading || !selectedAccount) ? 'not-allowed' : 'pointer',
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
