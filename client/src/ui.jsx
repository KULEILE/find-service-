import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, fetchBlobUrl, getSocket, asset, tokens, STATUS } from './api';

// ---------- icons (simple outline shapes) ----------
const PATHS = {
  home: 'M3 11l9-8 9 8v10H3V11z M9 21v-6h6v6', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  chat: 'M4 5h16v11H9l-5 4V5z', list: 'M6 3h12v18H6z M9 8h6 M9 12h6 M9 16h4', more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  bell: 'M6 16v-5a6 6 0 1 1 12 0v5l2 2H4l2-2z M10 21h4', back: 'M15 5l-7 7 7 7', send: 'M3 11l18-8-8 18-2-7-8-3z',
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M9 9h.01', phone: 'M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  pin: 'M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z M12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', check: 'M5 12l5 5 9-10',
  plus: 'M12 5v14 M5 12h14', trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13', flag: 'M5 21V4 M5 4h12l-2 4 2 4H5',
  filter: 'M4 6h16 M7 12h10 M10 18h4', menu: 'M4 6h16 M4 12h16 M4 18h16', activity: 'M3 12h4l3-8 4 16 3-8h4', settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z', users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2 20a7 7 0 0 1 14 0 M17 4.5a3.5 3.5 0 0 1 0 6.5 M18 14a6 6 0 0 1 4 6', grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z', arrow: 'M5 12h14 M13 6l6 6-6 6', x: 'M6 6l12 12 M18 6L6 18', logout: 'M9 4H4v16h5 M16 8l4 4-4 4 M20 12H9', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z', lock: 'M6 11h12v10H6z M8 11V8a4 4 0 1 1 8 0v3', wrench: 'M14 6a4 4 0 0 0 5 5l-9 9a2.5 2.5 0 0 1-4-4l9-9a4 4 0 0 0-1-1z',
  plumbing: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z', electrical: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z', carpentry: 'M14 4l6 6-3 3-6-6 3-3z M11 7L4 14l3 3 7-7',
  cleaning: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z M19 17v4 M17 19h4', mechanics: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  painting: 'M4 20c0-2 1-3 3-3l9-9 3 3-9 9c0 2-1 3-3 3H4z M14 6l4 4', gardening: 'M5 19c0-9 6-14 15-14 0 9-5 15-14 15 M5 19l8-8',
  appliance: 'M5 3h14v18H5z M5 8h14 M9 5.5h.01 M9 12v4', camera: 'M4 8h4l2-3h4l2 3h4v11H4z M12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
};
export function Icon({ name, size = 22, fill = false }) {
  if (name === 'star') return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" /></svg>;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(PATHS[name] || PATHS.more).split(' M').map((d, i) => <path key={i} d={(i ? 'M' : '') + d} />)}
    </svg>
  );
}

// ---------- small pieces ----------
export const Spinner = () => <div className="spinner" role="status" aria-label="Loading" />;
export const Empty = ({ icon = 'search', title, children }) => <div className="empty"><Icon name={icon} size={34} /><b>{title}</b>{children && <p>{children}</p>}</div>;
export const Alert = ({ kind = 'error', children }) => (children ? <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div> : null);
export const Pill = ({ kind, children }) => <span className={`pill ${kind || ''}`}>{children}</span>;
export const StatusPill = ({ status }) => <Pill kind={status}>{STATUS[status] || status}</Pill>;
export function Stars({ rating, count }) {
  const r = Number(rating) || 0;
  return <span className="stars"><Icon name="star" size={15} /> {r ? r.toFixed(1) : 'New'}{count != null && r ? <span className="muted" style={{ fontWeight: 400 }}>({count})</span> : null}</span>;
}
export function StarPick({ value, onChange }) {
  return <div className="star-pick" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} className={n <= value ? 'on' : ''} onClick={() => onChange(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}><Icon name="star" size={30} /></button>)}</div>;
}
export function Avatar({ name = '?', src, size }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return <div className={`avatar ${size || ''}`}>{src ? <img src={asset(src)} alt="" /> : initials}</div>;
}
export function Field({ label, hint, children }) {
  return <div className="field"><label>{label}</label>{children}{hint && <span className="hint">{hint}</span>}</div>;
}
export function Sheet({ title, onClose, children }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>{title}</h2><button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  );
}
// Private photos need the login token, so they are loaded through fetch.
export function AuthImage({ path, as, alt = 'Photo', style }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { let u; let live = true; fetchBlobUrl(path, as).then((x) => { u = x; if (live) setUrl(x); }).catch(() => {}); return () => { live = false; if (u) URL.revokeObjectURL(u); }; }, [path, as]);
  return url ? <img src={url} alt={alt} style={style} /> : <div className="spinner" style={{ margin: 12 }} />;
}

// ---------- toast ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState('');
  const timer = useRef();
  const show = useCallback((m) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(''), 3200); }, []);
  return <ToastCtx.Provider value={show}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>;
}

// ---------- data loading ----------
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    return fn().then((data) => setState({ data, error: '', loading: false })).catch((e) => setState({ data: null, error: e.message, loading: false }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

// Unread counts for the bottom navigation, refreshed by live events.
export function useBadges(as) {
  const [b, setB] = useState({ messages: 0, notifications: 0 });
  const [tick, setTick] = useState(0);
  useEffect(() => { const f = (e) => e.detail === as && setTick((t) => t + 1); window.addEventListener('fsp:signed-in', f); return () => window.removeEventListener('fsp:signed-in', f); }, [as]);
  const load = useCallback(async () => {
    if (!tokens.get(as)) { setB({ messages: 0, notifications: 0 }); return; }
    try {
      const [c, n] = await Promise.all([api('/conversations', { as }), api('/notifications', { as })]);
      setB({ messages: c.reduce((s, x) => s + x.unread, 0), notifications: n.unread });
    } catch { /* not signed in yet */ }
  }, [as]);
  useEffect(() => {
    load();
    const s = getSocket(as);
    if (!s) return undefined;
    s.on('inbox:updated', load); s.on('notification:new', load); s.on('message:read', load);
    return () => { s.off('inbox:updated', load); s.off('notification:new', load); s.off('message:read', load); };
  }, [as, load, tick]);
  return { ...b, refresh: load };
}

// ---------- layout pieces ----------
export const Brand = ({ to = '/' }) => (
  <Link to={to} className="brand" aria-label="Find a Service Provider, home">
    <img className="brand-full" src="/logo.png" alt="Find a Service Provider" />
    <span className="brand-compact"><img src="/logo-icon.png" alt="" /><span>Find a Service <b>Provider</b></span></span>
  </Link>
);

// Page heading. On every screen size it sits inside the page, with an optional back arrow.
export function TopBar({ title, back, right }) {
  const nav = useNavigate();
  return (
    <div className="pagehead">
      {back !== false && <button className="iconbtn back" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))} aria-label="Go back"><Icon name="back" /></button>}
      <h1>{title}</h1>
      <div className="grow" />{right}
    </div>
  );
}

// Bottom tab bar. It is shown on phones and tablets only.
export function BottomNav({ items }) {
  return (
    <nav className="bottomnav" aria-label="Main">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name={i.icon} />{i.badge > 0 && <span className="badge">{i.badge > 9 ? '9+' : i.badge}</span>}{i.label}
        </NavLink>
      ))}
    </nav>
  );
}

export const BellButton = ({ to, count }) => {
  const nav = useNavigate();
  return <button className="iconbtn" onClick={() => nav(to)} aria-label={`Notifications${count ? `, ${count} unread` : ''}`}><Icon name="bell" />{count > 0 && <span className="badge" style={{ left: 'auto', right: 2, top: 4 }}>{count}</span>}</button>;
};

// Dashboard shell for provider, administrator and security areas:
// side menu on laptops and desktops, top bar plus tabs (or bottom bar) on phones and tablets.
export function Portal({ links, user, label, onLogout, bell, mobileNav = 'tabs', brandTo = '/', padded = false }) {
  return (
    <div className="portal">
      <aside className="sidebar">
        <Brand to={brandTo} />
        <nav aria-label="Menu">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={l.icon} size={20} />{l.label}{l.badge > 0 && <span className="nbadge">{l.badge}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="foot"><div><b>{user.name}</b><div className="muted small">{label}</div></div><button className="btn outline small" onClick={onLogout}><Icon name="logout" size={16} /> Log out</button></div>
      </aside>
      <div className="portal-main">
        <div className="portal-top">
          <div className="brand-m"><Brand to={brandTo} /></div>
          {bell}<span className="who only-desktop">{user.name}</span>
          <button className="iconbtn only-mobile" onClick={onLogout} aria-label="Log out"><Icon name="logout" /></button>
        </div>
        {mobileNav === 'tabs' && <nav className="tabs" aria-label="Sections">{links.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>{l.label}</NavLink>)}</nav>}
        <main className={`portal-content ${padded ? 'padded' : ''}`}><Outlet /></main>
      </div>
      {mobileNav === 'bottom' && <BottomNav items={links.slice(0, 5)} />}
    </div>
  );
}

// Login and sign up: brand panel beside the form on large screens, form only on phones.
export function AuthLayout({ title, subtitle, heading, points = [], children }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <Brand />
        <div><h2>{heading}</h2><ul>{points.map((p) => <li key={p}><Icon name="check" size={20} /><span>{p}</span></li>)}</ul></div>
        <p className="small" style={{ opacity: .85 }}>Connecting people and service providers across Lesotho.</p>
      </aside>
      <div className="auth-main">
        <div className="auth-card">
          <div className="only-mobile"><Brand /></div>
          <div className="stack-s"><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
          {children}
        </div>
      </div>
    </div>
  );
}
