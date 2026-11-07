// The security portal: its own page, its own login, its own token. Host it on its own address.
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, tokens, when } from './api';
import { Alert, AuthLayout, Field, Pill, Portal, Spinner, useAsync, useToast } from './ui';

export function useSecurity() {
  const [user, setUser] = useState(() => tokens.info('security'));
  useEffect(() => { const f = (e) => e.detail === 'security' && setUser(null); window.addEventListener('fsp:signed-out', f); return () => window.removeEventListener('fsp:signed-out', f); }, []);
  return { user, signIn: (t, u) => { tokens.set('security', t, u); setUser(u); }, signOut: () => { tokens.clear('security'); setUser(null); } };
}

export function SecurityLogin({ signIn }) {
  const nav = useNavigate(); const [f, setF] = useState({ email: '', password: '' }); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e) { e.preventDefault(); setError(''); setBusy(true); try { const r = await api('/security/login', { method: 'POST', body: f }); signIn(r.token, r.user); nav('/', { replace: true }); } catch (x) { setError(x.message); } finally { setBusy(false); } }
  return (
    <AuthLayout title="Security portal" subtitle="Authorised security administrators only. Every attempt is recorded." heading="Protect the platform and the people who use it"
      points={['Control who can read and change each module', 'Watch logins and suspicious activity', 'Set security and data retention rules']}>
      <form className="stack" onSubmit={submit}>
        <Alert>{error}</Alert>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="username" /></Field>
        <Field label="Password"><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required autoComplete="current-password" /></Field>
        <button className="btn lg block" disabled={busy}>{busy ? 'Checking...' : 'Log in'}</button>
      </form>
    </AuthLayout>
  );
}

export function SecurityLayout({ user, signOut }) {
  if (!user) return <Navigate to="/login" replace />;
  const links = [
    { to: '/', icon: 'shield', label: 'Overview', end: true }, { to: '/permissions', icon: 'lock', label: 'Roles and permissions' },
    { to: '/accounts', icon: 'users', label: 'Accounts' }, { to: '/logs', icon: 'activity', label: 'Security log' }, { to: '/policies', icon: 'settings', label: 'Policies' },
  ];
  return <Portal links={links} user={user} label="Security administrator" mobileNav="tabs" padded onLogout={signOut} />;
}

const Table = ({ head, children }) => <div className="tablewrap"><table><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;

export function Overview() {
  const { data, loading, error } = useAsync(() => api('/security/overview', { as: 'security' }), []);
  if (loading) return <Spinner />; if (error) return <Alert>{error}</Alert>;
  const k = (n, l, warn) => <div className="kpi" style={warn && n > 0 ? { borderColor: 'var(--red)' } : {}}><b>{n}</b><span>{l}</span></div>;
  return (
    <>
      <h1>Overview</h1><p className="muted small">The last 24 hours.</p>
      <div className="cols">{k(data.last_24h.failed_logins, 'Failed logins', true)}{k(data.last_24h.access_denied, 'Access denied', true)}{k(data.locked_accounts, 'Locked accounts now', true)}{k(data.last_24h.critical, 'Critical events', true)}{k(data.last_24h.reports_viewed, 'Reports opened by admins')}</div>
      <h2>Suspicious activity</h2>
      {data.suspicious_ips.length === 0 ? <p className="muted">No address has had 5 or more failed attempts in the last hour.</p> : <Table head={['IP address', 'Failed attempts (1 hour)']}>{data.suspicious_ips.map((s) => <tr key={s.ip_address}><td>{s.ip_address}</td><td><Pill kind="critical">{s.attempts}</Pill></td></tr>)}</Table>}
      <h2>Latest alerts</h2>
      {data.latest_alerts.length === 0 ? <p className="muted">No alerts.</p> : <Table head={['When', 'Event', 'Level', 'IP']}>{data.latest_alerts.map((a, i) => <tr key={i}><td>{when(a.created_at)}</td><td>{a.event_type.replace(/_/g, ' ')}</td><td><Pill kind={a.severity}>{a.severity}</Pill></td><td>{a.ip_address}</td></tr>)}</Table>}
    </>
  );
}

export function Permissions() {
  const toast = useToast(); const { data, loading, error, reload } = useAsync(() => api('/security/matrix', { as: 'security' }), []); const [err, setErr] = useState('');
  if (loading) return <Spinner />; if (error) return <Alert>{error}</Alert>;
  const cell = (role, mod) => data.permissions.find((p) => p.role_id === role.id && p.module_id === mod.id) || { can_read: false, can_write: false };
  async function set(role, mod, can_read, can_write) { setErr(''); try { await api('/security/permissions', { method: 'PUT', body: { role_id: role.id, module_id: mod.id, can_read, can_write }, as: 'security' }); toast('Permission saved.'); reload(); } catch (e) { setErr(e.message); } }
  return (
    <>
      <h1>Roles and permissions</h1>
      <p className="muted small">R lets a role read a module. W lets it change things. Changes apply within seconds, even to people who are logged in. Customers have no account, so their access is the same for every verified phone number.</p>
      <Alert>{err}</Alert>
      <div className="tablewrap"><table className="matrix"><thead><tr><th>Module</th>{data.roles.map((r) => <th key={r.id} title={r.description}>{r.name.replace('_', ' ')}</th>)}</tr></thead>
        <tbody>{data.modules.map((m) => <tr key={m.id}><td><b>{m.name}</b></td>{data.roles.map((r) => { const c = cell(r, m); return (
          <td key={r.id} className="cell"><span className="toggle">
            <button className={`tg ${c.can_read ? 'on' : ''}`} aria-pressed={c.can_read} aria-label={`${r.name} read ${m.name}`} onClick={() => set(r, m, !c.can_read, c.can_read ? false : c.can_write)}>R</button>
            <button className={`tg ${c.can_write ? 'on' : ''}`} aria-pressed={c.can_write} aria-label={`${r.name} write ${m.name}`} onClick={() => set(r, m, c.can_read || !c.can_write, !c.can_write)}>W</button></span></td>); })}</tr>)}</tbody></table></div>
    </>
  );
}

export function Accounts({ me }) {
  const toast = useToast(); const { data, loading, error, reload } = useAsync(() => api('/security/users', { as: 'security' }), []);
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'admin' }); const [err, setErr] = useState('');
  const act = async (fn, msg) => { setErr(''); try { await fn(); toast(msg); reload(); } catch (e) { setErr(e.message); } };
  return (
    <>
      <h1>Accounts</h1>
      <form className="card row wrap" onSubmit={(e) => { e.preventDefault(); act(async () => { await api('/security/users', { method: 'POST', body: f, as: 'security' }); setF({ name: '', email: '', password: '', role: 'admin' }); }, 'Staff account created.'); }}>
        <div className="grow"><Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field></div>
        <div className="grow"><Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field></div>
        <div className="grow"><Field label="Temporary password" hint="At least 10 characters"><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={10} autoComplete="new-password" /></Field></div>
        <div style={{ width: 170 }}><Field label="Role"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="admin">Administrator</option><option value="security_admin">Security admin</option></select></Field></div>
        <button className="btn" style={{ alignSelf: 'end' }}>Create staff account</button>
      </form>
      <Alert>{err || error}</Alert>
      {loading ? <Spinner /> : <Table head={['Name', 'Email', 'Role', 'Status', 'Last login', '']}>{data.map((u) => (
        <tr key={u.id}><td><b>{u.name}</b></td><td>{u.email}</td><td>{u.role.replace('_', ' ')}</td><td><Pill kind={u.locked ? 'critical' : u.status}>{u.locked ? 'locked' : u.status}</Pill></td><td>{u.last_login_at ? when(u.last_login_at) : 'Never'}</td>
          <td className="right">{u.id !== me.id && <>
            {u.locked && <button className="btn outline small" onClick={() => act(() => api(`/security/users/${u.id}`, { method: 'PATCH', body: { unlock: true }, as: 'security' }), 'Account unlocked.')}>Unlock</button>}{' '}
            {u.status === 'active' ? <button className="btn danger small" onClick={() => window.confirm(`Suspend ${u.name}?`) && act(() => api(`/security/users/${u.id}`, { method: 'PATCH', body: { status: 'suspended' }, as: 'security' }), 'Account suspended.')}>Suspend</button>
              : <button className="btn outline small" onClick={() => act(() => api(`/security/users/${u.id}`, { method: 'PATCH', body: { status: 'active' }, as: 'security' }), 'Account activated.')}>Activate</button>}</>}</td></tr>))}</Table>}
    </>
  );
}

export function Logs() {
  const [sev, setSev] = useState('');
  const { data, loading, error } = useAsync(() => api(`/security/logs${sev ? `?severity=${sev}` : ''}`, { as: 'security' }), [sev]);
  return (
    <>
      <div className="row between wrap"><h1>Security log</h1><select className="input" style={{ width: 180 }} value={sev} onChange={(e) => setSev(e.target.value)} aria-label="Filter by level"><option value="">All levels</option><option value="info">Information</option><option value="warning">Warnings</option><option value="critical">Critical</option></select></div>
      <Alert>{error}</Alert>
      {loading ? <Spinner /> : <Table head={['When', 'Event', 'Level', 'Who', 'IP address', 'Details']}>{data.map((l) => <tr key={l.id}><td>{when(l.created_at)}</td><td>{l.event_type.replace(/_/g, ' ')}</td><td><Pill kind={l.severity}>{l.severity}</Pill></td><td>{l.user_email || l.actor_role || '-'}</td><td>{l.ip_address}</td><td className="small muted">{l.details ? JSON.stringify(l.details).slice(0, 90) : ''}</td></tr>)}</Table>}
    </>
  );
}

export function Policies() {
  const toast = useToast(); const { data, loading, error, reload } = useAsync(() => api('/security/policies', { as: 'security' }), []); const [edit, setEdit] = useState({});
  async function save(p) { try { await api(`/security/policies/${p.key}`, { method: 'PUT', body: { value: edit[p.key] }, as: 'security' }); toast('Policy saved.'); setEdit({ ...edit, [p.key]: undefined }); reload(); } catch (e) { toast(e.message); } }
  return (
    <>
      <h1>Security policies</h1><p className="muted small">Rules for logins, one-time codes and how long private data is kept.</p><Alert>{error}</Alert>
      {loading ? <Spinner /> : <Table head={['Policy', 'What it controls', 'Value', '']}>{data.map((p) => (
        <tr key={p.key}><td><b>{p.key.replace(/_/g, ' ')}</b></td><td className="small">{p.description}</td>
          <td style={{ width: 120 }}><input className="input" style={{ minHeight: 38 }} inputMode="numeric" value={edit[p.key] ?? p.value} onChange={(e) => setEdit({ ...edit, [p.key]: e.target.value.replace(/\D/g, '') })} aria-label={p.key} /></td>
          <td className="right"><button className="btn outline small" disabled={edit[p.key] === undefined || edit[p.key] === p.value} onClick={() => save(p)}>Save</button></td></tr>))}</Table>}
    </>
  );
}
