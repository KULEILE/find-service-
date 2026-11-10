import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, when, money } from './api';
import { useSession } from './session';
import { Alert, BellButton, Empty, Field, Pill, Portal, Spinner, Stars, StatusPill, useAsync, useBadges, useToast } from './ui';

export function AdminLayout() {
  const { staff, signOut } = useSession(); const nav = useNavigate(); const b = useBadges('staff');
  if (!staff) return <Navigate to="/login" replace />;
  if (staff.role !== 'admin') return <Navigate to="/provider" replace />;
  const links = [
    { to: '/admin', icon: 'grid', label: 'Dashboard', end: true }, 
    { to: '/admin/categories', icon: 'list', label: 'Categories' }, 
    { to: '/admin/providers', icon: 'users', label: 'Providers' },
    { to: '/admin/requests', icon: 'wrench', label: 'Requests' }, 
    { to: '/admin/reports', icon: 'flag', label: 'Reports' }, 
    { to: '/admin/blockchain', icon: 'shield', label: 'Blockchain' }, // <-- Blockchain Link
    { to: '/admin/activity', icon: 'activity', label: 'Activity' }, 
    { to: '/admin/settings', icon: 'settings', label: 'Settings' },
  ];
  return <Portal links={links} user={staff} label="Administrator" mobileNav="tabs" padded onLogout={() => { signOut('staff'); nav('/login'); }} bell={<BellButton to="/admin/notifications" count={b.notifications} />} />;
}

const Table = ({ head, children }) => <div className="tablewrap"><table><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;

export function AdminDashboard() {
  const { data: s, loading, error } = useAsync(() => api('/admin/stats', { as: 'staff' }), []);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const r = s.requests; const total = Object.values(r).reduce((a, b) => a + b, 0);
  const k = (n, l) => <div className="kpi"><b>{n}</b><span>{l}</span></div>;
  return (
    <>
      <h1>Dashboard</h1>
      <div className="cols">{k(s.providers.total, 'Registered providers')}{k(s.providers.active, 'Active providers')}{k(s.customers, 'Verified customers')}{k(s.services, 'Services listed')}{k(s.categories, 'Categories')}{k(s.open_reports, 'Open reports')}</div>
      <h2>Service requests ({total})</h2>
      <div className="cols">{['pending', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled'].map((x) => <div key={x} className="kpi"><b>{r[x] || 0}</b><span><StatusPill status={x} /></span></div>)}</div>
    </>
  );
}

export function AdminCategories() {
  const toast = useToast(); const { data, loading, error, reload } = useAsync(() => api('/admin/categories', { as: 'staff' }), []);
  const [f, setF] = useState({ name: '', description: '', icon: '' }); const [err, setErr] = useState('');
  const act = async (fn, msg) => { setErr(''); try { await fn(); toast(msg); reload(); } catch (e) { setErr(e.message); } };
  return (
    <>
      <h1>Service categories</h1>
      <form className="card row wrap" onSubmit={(e) => { e.preventDefault(); act(async () => { await api('/admin/categories', { method: 'POST', body: f, as: 'staff' }); setF({ name: '', description: '', icon: '' }); }, 'Category added.'); }}>
        <div className="grow"><Field label="New category"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} /></Field></div>
        <div className="grow"><Field label="Description"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
        <div style={{ width: 150 }}><Field label="Icon"><select className="input" value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })}><option value="">Default</option>{['plumbing', 'electrical', 'carpentry', 'cleaning', 'mechanics', 'painting', 'gardening', 'appliance'].map((i) => <option key={i}>{i}</option>)}</select></Field></div>
        <button className="btn" style={{ alignSelf: 'end' }}>Add</button>
      </form>
      <Alert>{err || error}</Alert>
      {loading ? <Spinner /> : <Table head={['Name', 'Description', 'Services', 'Status', '']}>{data.map((c) => (
        <tr key={c.id}><td><b>{c.name}</b></td><td>{c.description}</td><td>{c.services}</td><td><Pill kind={c.is_active ? 'active' : 'disabled'}>{c.is_active ? 'Active' : 'Hidden'}</Pill></td>
          <td className="right"><button className="btn outline small" onClick={() => act(() => api(`/admin/categories/${c.id}`, { method: 'PUT', body: { name: c.name, description: c.description || '', icon: c.icon || '', is_active: !c.is_active }, as: 'staff' }), c.is_active ? 'Category hidden.' : 'Category shown.')}>{c.is_active ? 'Hide' : 'Show'}</button>{' '}
            <button className="btn danger small" onClick={() => window.confirm(`Remove "${c.name}"?`) && act(() => api(`/admin/categories/${c.id}`, { method: 'DELETE', as: 'staff' }), 'Category removed.')}>Remove</button></td></tr>))}</Table>}
    </>
  );
}

export function AdminProviders() {
  const toast = useToast(); const { data, loading, error, reload } = useAsync(() => api('/admin/providers', { as: 'staff' }), []);
  async function setStatus(p, status) { try { await api(`/admin/providers/${p.id}/status`, { method: 'PATCH', body: { status }, as: 'staff' }); toast(`Provider ${status === 'active' ? 'activated' : 'suspended'}.`); reload(); } catch (e) { toast(e.message); } }
  return (
    <>
      <h1>Providers</h1><Alert>{error}</Alert>
      {loading ? <Spinner /> : <Table head={['Provider', 'Owner', 'District', 'Services', 'Requests', 'Rating', 'Status', '']}>{data.map((p) => (
        <tr key={p.id}><td><b>{p.business_name}</b><div className="small muted">{p.phone}</div></td><td>{p.owner_name}<div className="small muted">{p.email}</div></td><td>{p.district || '-'}</td><td>{p.services}</td><td>{p.requests}</td><td><Stars rating={p.avg_rating} count={p.review_count} /></td>
          <td><Pill kind={p.status}>{p.status}</Pill></td><td className="right">{p.status === 'active' ? <button className="btn danger small" onClick={() => setStatus(p, 'suspended')}>Suspend</button> : <button className="btn outline small" onClick={() => setStatus(p, 'active')}>Activate</button>}</td></tr>))}</Table>}
    </>
  );
}

export function AdminRequests() {
  const [status, setStatus] = useState('');
  const { data, loading, error } = useAsync(() => api(`/admin/requests${status ? `?status=${status}` : ''}`, { as: 'staff' }), [status]);
  return (
    <>
      <div className="row between wrap"><h1>Service requests</h1>
        <select className="input" style={{ width: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="">All statuses</option>{['pending', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>
      <Alert>{error}</Alert>
      {loading ? <Spinner /> : data.length === 0 ? <Empty title="No requests">Nothing matches this filter.</Empty> : <Table head={['Reference', 'Service', 'Provider', 'Customer', 'Location', 'Status', 'Created']}>{data.map((r) => (
        <tr key={r.id}><td><b>{r.reference_number}</b></td><td>{r.service_name}</td><td>{r.business_name}</td><td>{r.customer_name}</td><td>{r.location}</td><td><StatusPill status={r.status} /></td><td>{when(r.created_at)}</td></tr>))}</Table>}
      <p className="small muted">Customer phone numbers and chats are not shown here.</p>
    </>
  );
}

export function AdminReports() {
  const toast = useToast(); const list = useAsync(() => api('/admin/reports', { as: 'staff' }), []);
  const [openId, setOpenId] = useState(null); const [detail, setDetail] = useState(null); const [note, setNote] = useState(''); const [err, setErr] = useState('');
  async function open(id) { setErr(''); setNote(''); try { setDetail(await api(`/admin/reports/${id}`, { as: 'staff' })); setOpenId(id); } catch (e) { setErr(e.message); } }
  async function resolve(action) { try { await api(`/admin/reports/${openId}/resolve`, { method: 'PATCH', body: { action, note }, as: 'staff' }); toast('Report resolved.'); setOpenId(null); setDetail(null); list.reload(); } catch (e) { setErr(e.message); } }
  return (
    <>
      <h1>Reported conversations</h1>
      <p className="muted small">You can read only the messages that were reported and a few around them. Every time you open a report it is recorded in the security log.</p>
      <Alert>{err || list.error}</Alert>
      <div className="reports-grid">
        <div className="stack-s">{list.loading ? <Spinner /> : list.data.length === 0 ? <Empty icon="flag" title="No reports">Reported conversations will show here.</Empty> : list.data.map((r) => (
          <button key={r.id} className="card stack-s" style={{ gap: 4, borderColor: openId === r.id ? 'var(--orange)' : undefined }} onClick={() => open(r.id)}>
            <div className="row between"><b>{r.business_name || 'Provider'} and {r.customer_name || 'customer'}</b><Pill kind={r.status}>{r.status.replace('_', ' ')}</Pill></div>
            <span className="small">{r.reason}</span><span className="small muted">Reported by {r.reporter_role} &nbsp; {when(r.created_at)}</span></button>))}</div>
        <div>{detail ? (
          <div className="card stack">
            <div className="row between"><h2>Reported messages</h2><Pill kind={detail.status}>{detail.status.replace('_', ' ')}</Pill></div>
            <div className="alert info small">Reason given: {detail.reason}</div>
            <div className="chatlist" style={{ background: 'var(--bg)', borderRadius: 12, padding: 12 }}>{detail.messages.map((m, i) => (
              <div key={i} className={`bubble ${m.sender_role === 'provider' ? 'mine' : ''}`} style={m.is_reported ? { outline: '3px solid var(--red)' } : { opacity: .75 }}>
                <b className="small">{m.sender_role}{m.is_reported ? ' (reported)' : ''}</b><br />{m.text || (m.has_image ? '[photo]' : '')}{m.text && m.has_image ? ' [photo]' : ''}<div className="meta">{when(m.sent_at)}</div></div>))}</div>
            {detail.status === 'open' ? <>
              <Field label="Note for the record (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
              <div className="row wrap"><button className="btn outline" onClick={() => resolve('dismissed')}>Dismiss report</button><button className="btn outline" onClick={() => resolve('warned')}>Warn the other person</button>
                {detail.reporter_role === 'customer' && <button className="btn danger" onClick={() => window.confirm('Suspend this provider?') && resolve('provider_suspended')}>Suspend provider</button>}</div>
            </> : <p className="small muted">Resolved {detail.reviewed_at ? when(detail.reviewed_at) : ''}. This evidence is deleted automatically after the retention period.</p>}
          </div>) : <Empty icon="flag" title="Select a report">Choose a report to read the reported messages.</Empty>}</div>
      </div>
    </>
  );
}

export function AdminBlockchain() {
  const { data, loading, error } = useAsync(() => api('/admin/blockchain/explorer', { as: 'staff' }), []);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <>
      <h1>Blockchain Explorer</h1>
      <p className="muted small">Live view of the FSP Chain network and recent transactions.</p>
      
      <Alert>{error}</Alert>

      <div className="cols">
        <div className="kpi">
          <b>{data.network.height}</b>
          <span>Current Block Height</span>
        </div>
        <div className="kpi">
          <b>3</b>
          <span>Active Validators</span>
        </div>
      </div>

      <h2>Network Status</h2>
      <Table head={['Node', 'Status', 'Latest Hash']}>
        <tr>
          <td>Node 1 (Leader)</td>
          <td><Pill kind="active">Synced</Pill></td>
          <td className="small muted" style={{ wordBreak: 'break-all' }}>
            {data.network.latestHash}
          </td>
        </tr>
      </Table>

      <h2>Recent Transactions (Outbox)</h2>
      <Table head={['Tx ID', 'Event Type', 'Status', 'Created', 'Confirmed']}>
        {data.transactions.map((tx) => (
          <tr key={tx.transaction_id}>
            <td className="small muted" style={{ maxWidth: '150px', wordBreak: 'break-all' }}>
              {tx.transaction_id}
            </td>
            <td><b>{tx.event_type}</b></td>
            <td>
              <Pill kind={tx.submission_status === 'CONFIRMED' ? 'completed' : 'pending'}>
                {tx.submission_status}
              </Pill>
            </td>
            <td className="small muted">{when(tx.created_at)}</td>
            <td className="small muted">{tx.confirmed_at ? when(tx.confirmed_at) : '-'}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

export function AdminActivity() {
  const { data, loading, error } = useAsync(() => api('/admin/activity', { as: 'staff' }), []);
  return (<><h1>System activity</h1><Alert>{error}</Alert>{loading ? <Spinner /> : <Table head={['When', 'Action', 'Who', 'Item']}>{data.map((a) => <tr key={a.id}><td>{when(a.created_at)}</td><td>{a.action.replace(/_/g, ' ')}</td><td>{a.user_name || a.actor_role || 'system'}</td><td className="small muted">{a.entity} {a.entity_id ? String(a.entity_id).slice(0, 8) : ''}</td></tr>)}</Table>}</>);
}

export function AdminSettings() {
  const toast = useToast(); const { data, loading, error } = useAsync(() => api('/admin/settings', { as: 'staff' }), []);
  const [vals, setVals] = useState(null);
  const current = vals || Object.fromEntries((data || []).map((x) => [x.key, x.value]));
  async function save(e) { e.preventDefault(); try { await api('/admin/settings', { method: 'PUT', body: current, as: 'staff' }); toast('Settings saved.'); } catch (x) { toast(x.message); } }
  return (
    <>
      <h1>General settings</h1><Alert>{error}</Alert>
      {loading ? <Spinner /> : <form className="card stack" style={{ maxWidth: 480 }} onSubmit={save}>
        {Object.keys(current).map((k) => <Field key={k} label={k.replace(/_/g, ' ')}><input className="input" value={current[k]} onChange={(e) => setVals({ ...current, [k]: e.target.value })} /></Field>)}
        <button className="btn">Save settings</button></form>}
      <p className="small muted">Passwords, roles and security rules are managed in the separate security portal.</p>
    </>
  );
}