import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useMatch, useNavigate, useParams } from 'react-router-dom';
import { api, getSocket, clock, when, day } from './api';
import { Alert, AuthImage, Avatar, Empty, Field, Icon, Sheet, Spinner, TopBar, useAsync, useToast } from './ui';

// ---------- messages: list on the left, chat on the right (one column on phones) ----------
export function MessagesLayout({ as, base }) {
  const match = useMatch(`${base}/:id`);
  const activeId = match ? match.params.id : null;
  const mine = as === 'customer' ? 'customer' : 'provider';
  const { data, loading, error, reload } = useAsync(() => api('/conversations', { as }), [as]);
  useEffect(() => {
    const s = getSocket(as); if (!s) return undefined;
    ['inbox:updated', 'message:new', 'message:read'].forEach((e) => s.on(e, reload));
    return () => ['inbox:updated', 'message:new', 'message:read'].forEach((e) => s.off(e, reload));
  }, [as, reload]);
  return (
    <div className={`msg-layout ${activeId ? 'has-chat' : ''}`}>
      <aside className="msg-list" aria-label="Conversations">
        <div className="msg-list-head"><h2>Messages</h2></div>
        <div className="msg-items">
          <Alert>{error}</Alert>
          {loading && !data ? <Spinner /> : data && data.length === 0 ? (
            <Empty icon="chat" title="No messages yet">{as === 'customer' ? 'Open a provider and tap Message to ask about price and availability.' : 'Messages from customers will show here.'}</Empty>
          ) : (data || []).map((c) => (
            <Link key={c.id} to={`${base}/${c.id}`} className={`convrow ${c.unread ? 'unread' : ''} ${c.id === activeId ? 'on' : ''}`}>
              <Avatar name={c.other_name} src={c.other_image} size="sm" />
              <div className="grow"><div className="row between"><b>{c.other_name}</b><span className="small muted">{day(c.last_message_at) === day(new Date()) ? clock(c.last_message_at) : day(c.last_message_at)}</span></div>
                <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.last_sender === mine ? 'You: ' : ''}{c.preview}</div></div>
              {c.unread > 0 && <span className="nbadge">{c.unread}</span>}
            </Link>
          ))}
        </div>
      </aside>
      <section className="msg-pane">
        {activeId ? <Outlet /> : <div className="msg-empty" style={{ display: 'grid', height: '100%' }}><div className="stack-s" style={{ justifyItems: 'center' }}><Icon name="chat" size={44} /><b style={{ color: 'var(--ink)' }}>Select a conversation</b><span className="small">Your private messages appear here.</span></div></div>}
      </section>
    </div>
  );
}

// ---------- one conversation, live ----------
export function Conversation({ as, base }) {
  const backTo = base;
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const me = as === 'customer' ? 'customer' : 'provider';
  const [info, setInfo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [reason, setReason] = useState('');
  const listRef = useRef(); const fileRef = useRef(); const lastTyped = useRef(0); const typingTimer = useRef();

  useEffect(() => { document.body.classList.add('in-chat'); return () => document.body.classList.remove('in-chat'); }, []);

  const markRead = useCallback(() => api(`/conversations/${id}/read`, { method: 'POST', as }).catch(() => {}), [id, as]);

  useEffect(() => {
    let live = true;
    api(`/conversations/${id}/messages`, { as }).then((d) => { if (!live) return; setInfo(d.conversation); setMessages(d.messages); markRead(); }).catch((e) => setError(e.message));
    const s = getSocket(as);
    if (!s) return undefined;
    const join = () => s.emit('conversation:join', id);
    const onNew = (m) => {
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (m.sender_role !== me) markRead();
    };
    const onRead = (e) => { if (e.reader_role !== me) setMessages((prev) => prev.map((m) => (m.sender_role === me && !m.read_at ? { ...m, read_at: new Date().toISOString() } : m))); };
    const onTyping = (e) => { if (e.conversationId === id && e.role !== me) { setTyping(true); clearTimeout(typingTimer.current); typingTimer.current = setTimeout(() => setTyping(false), 2500); } };
    if (s.connected) join(); s.on('connect', join); s.on('message:new', onNew); s.on('message:read', onRead); s.on('typing', onTyping);
    return () => { live = false; s.emit('conversation:leave', id); s.off('connect', join); s.off('message:new', onNew); s.off('message:read', onRead); s.off('typing', onTyping); };
  }, [id, as, me, markRead]);

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages, typing]);

  function onType(v) {
    setText(v);
    const now = Date.now();
    if (now - lastTyped.current > 1500) { lastTyped.current = now; getSocket(as)?.emit('typing', { conversationId: id }); }
  }
  async function send(e) {
    e?.preventDefault();
    if ((!text.trim() && !file) || sending) return;
    setSending(true); setError('');
    const form = new FormData(); if (text.trim()) form.append('text', text.trim()); if (file) form.append('image', file);
    try {
      const m = await api(`/conversations/${id}/messages`, { method: 'POST', form, as });
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m])); setText(''); setFile(null); if (fileRef.current) fileRef.current.value = '';
    } catch (err) { setError(err.message); } finally { setSending(false); }
  }
  async function report() {
    try { await api(`/conversations/${id}/report`, { method: 'POST', body: { reason }, as }); setSheet(null); setReason(''); toast('Report sent. An administrator will review it.'); }
    catch (err) { toast(err.message); }
  }
  async function remove() {
    try { await api(`/conversations/${id}`, { method: 'DELETE', as }); toast('Conversation deleted.'); nav(backTo, { replace: true }); }
    catch (err) { toast(err.message); setSheet(null); }
  }

  let lastDay = '';
  return (
    <div className="chat" style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto auto', height: '100%', minHeight: 0 }}>
      <div className="chat-head">
        <button className="iconbtn back" onClick={() => nav(backTo)} aria-label="Back to conversations"><Icon name="back" /></button>
        <Avatar name={info ? info.other_name : '?'} src={info?.other_image} size="sm" />
        <div className="grow"><b>{info ? info.other_name : 'Chat'}</b><div className="small muted"><Icon name="lock" size={12} /> Private and encrypted</div></div>
        <button className="iconbtn" onClick={() => setSheet('menu')} aria-label="More options"><Icon name="more" /></button>
      </div>
      <div className="chatlist" ref={listRef}>
        {as === 'customer' && info && !info.request && <Link className="btn outline small" style={{ alignSelf: 'center' }} to={`/providers/${info.provider_id}/request`}>Ready? Request this service</Link>}
        {info?.request && <Link className="card small" to={as === 'customer' ? `/track/${info.request.reference_number}` : `/provider/requests/${info.request.id}`} style={{ alignSelf: 'center', width: 'auto' }}>Linked request <b>{info.request.reference_number}</b></Link>}
        <Alert>{error}</Alert>
        {messages.map((m) => {
          const d = day(m.sent_at); const sep = d !== lastDay; lastDay = d;
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {sep && <div className="daysep">{d}</div>}
              <div className={`bubble ${m.sender_role === me ? 'mine' : ''}`}>
                {m.attachments.map((a) => <AuthImage key={a.id} path={`/conversations/attachments/${a.id}`} as={as} alt="Photo sent in chat" />)}
                {m.text}
                <div className="meta"><span>{clock(m.sent_at)}</span>{m.sender_role === me && <span>{m.read_at ? 'Seen' : 'Sent'}</span>}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="typing" aria-live="polite">{typing ? `${info?.other_name || 'They'} is typing...` : ''}</div>
      <div>
        {file && <div className="preview"><Icon name="image" /><span className="grow small">{file.name}</span><button className="iconbtn" onClick={() => { setFile(null); fileRef.current.value = ''; }} aria-label="Remove photo"><Icon name="x" /></button></div>}
        <form className="composer" onSubmit={send}>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => setFile(e.target.files[0] || null)} />
          <button type="button" className="iconbtn" onClick={() => fileRef.current.click()} aria-label="Attach a photo"><Icon name="image" /></button>
          <textarea rows={1} value={text} placeholder="Write a message" aria-label="Message" onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} maxLength={2000} />
          <button className="send" disabled={sending || (!text.trim() && !file)} aria-label="Send"><Icon name="send" size={20} /></button>
        </form>
      </div>

      {sheet === 'menu' && (
        <Sheet title="Conversation" onClose={() => setSheet(null)}>
          <button className="btn outline block" onClick={() => setSheet('report')}><Icon name="flag" size={18} /> Report this conversation</button>
          {as === 'customer' && <button className="btn danger block" onClick={() => setSheet('delete')}><Icon name="trash" size={18} /> Delete this conversation</button>}
        </Sheet>
      )}
      {sheet === 'report' && (
        <Sheet title="Report conversation" onClose={() => setSheet(null)}>
          <p className="muted small">An administrator will see only the reported messages and a few messages around them. The rest of the chat stays private.</p>
          <Field label="What is wrong?"><textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: rude or threatening language" maxLength={500} /></Field>
          <button className="btn block" disabled={reason.trim().length < 5} onClick={report}>Send report</button>
        </Sheet>
      )}
      {sheet === 'delete' && (
        <Sheet title="Delete conversation?" onClose={() => setSheet(null)}>
          <p className="muted">All messages and photos in this chat are deleted for both sides. This cannot be undone.</p>
          <button className="btn danger block" onClick={remove}>Delete</button><button className="btn ghost block" onClick={() => setSheet(null)}>Keep it</button>
        </Sheet>
      )}
    </div>
  );
}

// ---------- notifications ----------
export function Notifications({ as, backTo }) {
  const nav = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api('/notifications', { as }), [as]);
  useEffect(() => { const s = getSocket(as); if (!s) return undefined; s.on('notification:new', reload); return () => s.off('notification:new', reload); }, [as, reload]);
  async function open(n) { await api(`/notifications/${n.id}/read`, { method: 'POST', as }).catch(() => {}); if (n.link) nav(n.link); else reload(); }
  async function readAll() { await api('/notifications/read-all', { method: 'POST', as }); reload(); }
  return (
    <>
      <TopBar title="Notifications" back={backTo} right={data && data.unread > 0 ? <button className="iconbtn" onClick={readAll} aria-label="Mark all as read"><Icon name="check" /></button> : null} />
      <div className="page medium">
        <Alert>{error}</Alert>
        {loading && !data ? <Spinner /> : data && data.items.length === 0 ? <Empty icon="bell" title="Nothing new">Updates about messages and requests appear here.</Empty> :
          (data?.items || []).map((n) => (
            <button key={n.id} className="card" onClick={() => open(n)} style={n.read_at ? {} : { borderColor: '#f6b88c', background: '#fffaf6' }}>
              <div className="row between"><b className="small">{n.message}</b></div><span className="small muted">{when(n.created_at)}</span>
            </button>
          ))}
      </div>
    </>
  );
}
