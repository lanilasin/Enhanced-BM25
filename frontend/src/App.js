import React, { useState, useRef, useEffect } from 'react';
import './App.css';

// Bot avatar icon (simple SVG)
const BotIcon = () => (
  <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="avatar-icon">
    <circle cx="16" cy="16" r="16" fill="#4f46e5"/>
    <rect x="9" y="11" width="14" height="10" rx="3" fill="white"/>
    <circle cx="13" cy="15" r="1.5" fill="#4f46e5"/>
    <circle cx="19" cy="15" r="1.5" fill="#4f46e5"/>
    <rect x="13" y="8" width="2" height="3" rx="1" fill="white"/>
    <rect x="17" y="8" width="2" height="3" rx="1" fill="white"/>
    <rect x="6" y="14" width="2" height="4" rx="1" fill="white"/>
    <rect x="24" y="14" width="2" height="4" rx="1" fill="white"/>
  </svg>
);

// Send icon
const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
    <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Chevron icon for sidebar toggle
const ChevronIcon = ({ open }) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18"
    style={{ transform: open ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.3s ease' }}>
    <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Context doc item — expandable
function ContextDoc({ doc, index }) {
  const [expanded, setExpanded] = useState(false);
  const preview = doc.text.substring(0, 120);
  const hasMore = doc.text.length > 120;

  return (
    <div className="context-doc">
      <div className="context-doc-header">
        <span className="context-doc-badge">Doc {index + 1}</span>
        <span className="context-doc-score">Score: {doc.score.toFixed(4)}</span>
      </div>
      <p className="context-doc-text">
        {expanded ? doc.text : `${preview}${hasMore ? '...' : ''}`}
      </p>
      {hasMore && (
        <button className="context-doc-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

// Typing indicator (three dots)
function TypingIndicator() {
  return (
    <div className="message-row assistant-row">
      <div className="avatar"><BotIcon /></div>
      <div className="bubble assistant-bubble typing-bubble">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>
    </div>
  );
}

function App() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Hi! I'm your research assistant. Ask me anything! I'll retrieve the most relevant evidence and generate an answer for you.",
      sources: null,
    }
  ]);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeSources, setActiveSources] = useState(null); // sources shown in sidebar
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!query.trim() || loading) return;

    const userText = query.trim();
    setQuery('');
    setLoading(true);

    // Snapshot history BEFORE adding the new turn.
    // Exclude the welcome message (index 0) and only pass real user/assistant
    // pairs so the backend can replay them as conversation context.
    // We use a ref-style snapshot via the functional updater below.
    let historySnapshot = [];
    setMessages(prev => {
      // Skip index 0 (the greeting), keep everything else that has content
      historySnapshot = prev
        .slice(1)
        .filter(m => m.content)
        .map(m => ({ role: m.role, content: m.content }));
      return [...prev, { role: 'user', content: userText, sources: null }];
    });

    // Add empty assistant placeholder
    setMessages(prev => [...prev, { role: 'assistant', content: '', sources: null }]);

    try {
      const response = await fetch('http://127.0.0.1:5000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userText, history: historySnapshot }),
      });

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          if (event.startsWith('data: ')) {
            const dataStr = event.slice(6);
            try {
              const data = JSON.parse(dataStr);

              if (data.type === 'context') {
                // Attach sources to the last assistant message and open the sidebar
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1].sources = data.retrieved;
                  return updated;
                });
                setActiveSources(data.retrieved);
                setSidebarOpen(true);
              } else if (data.type === 'token') {
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1].content += data.text;
                  return updated;
                });
              } else if (data.type === 'error') {
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1].content = data.text;
                  updated[updated.length - 1].isError = true;
                  return updated;
                });
                setLoading(false);
              } else if (data.type === 'done') {
                setLoading(false);
              }
            } catch (err) {
              console.warn('Failed to parse SSE chunk:', dataStr);
            }
          }
        }
      }
    } catch (error) {
      console.error('Stream error:', error);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1].content = 'Failed to connect to the backend. Make sure the Flask server and Ollama are running.';
        updated[updated.length - 1].isError = true;
        return updated;
      });
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="app-layout">
      {/* ── Main Chat Panel ── */}
      <div className={`chat-panel ${sidebarOpen ? 'with-sidebar' : ''}`}>
        {/* Header */}
        <header className="chat-header">
          <div className="chat-header-left">
            <BotIcon />
            <div>
              <h1 className="chat-title">Research Assistant</h1>
              <p className="chat-subtitle">Enhanced BM25 + Neural Re-ranking</p>
            </div>
          </div>
          <button
            className={`sidebar-toggle-btn ${sidebarOpen ? 'active' : ''}`}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Hide context panel' : 'Show context panel'}
          >
            <ChevronIcon open={sidebarOpen} />
            <span>{sidebarOpen ? 'Hide Sources' : 'Show Sources'}</span>
          </button>
        </header>

        {/* Messages */}
        <div className="messages-area">
          {messages.map((msg, i) => (
            <div key={i} className={`message-row ${msg.role === 'user' ? 'user-row' : 'assistant-row'}`}>
              {msg.role === 'assistant' && (
                <div className="avatar"><BotIcon /></div>
              )}
              <div className={`bubble ${msg.role === 'user' ? 'user-bubble' : 'assistant-bubble'} ${msg.isError ? 'error-bubble' : ''}`}>
                {msg.content
                  ? <p className="bubble-text">{msg.content}</p>
                  : msg.role === 'assistant' && loading && i === messages.length - 1
                    ? <p className="bubble-text thinking">Searching corpus…</p>
                    : null
                }
                {/* Sources badge — click to view in sidebar */}
                {msg.sources && msg.sources.length > 0 && (
                  <button
                    className="sources-badge"
                    onClick={() => { setActiveSources(msg.sources); setSidebarOpen(true); }}
                  >
                    📄 {msg.sources.length} sources retrieved — click to view
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Typing dots while waiting for first token */}
          {loading && messages[messages.length - 1]?.content === '' && (
            <TypingIndicator />
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <form className="input-bar" onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            className="input-textarea"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about the documents…"
            rows={1}
            disabled={loading}
          />
          <button
            type="submit"
            className={`send-btn ${query.trim() && !loading ? 'send-btn-active' : ''}`}
            disabled={!query.trim() || loading}
            title="Send"
          >
            <SendIcon />
          </button>
        </form>
      </div>

      {/* ── Collapsible Context Sidebar ── */}
      <aside className={`context-sidebar ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <div className="sidebar-header">
          <div className="sidebar-title-row">
            <span className="sidebar-title">Retrieved Context</span>
            <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>✕</button>
          </div>
          <p className="sidebar-subtitle">
            {activeSources
              ? `Top ${activeSources.length} docs · BM25 + Cross-Encoder re-ranked`
              : 'Sources will appear here after your first query'}
          </p>
        </div>

        <div className="sidebar-body">
          {activeSources && activeSources.length > 0 ? (
            activeSources.map((doc, i) => (
              <ContextDoc key={i} doc={doc} index={i} />
            ))
          ) : (
            <div className="sidebar-empty">
              <p>No sources yet.</p>
              <p>Send a query and the retrieved documents will show up here.</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default App;
