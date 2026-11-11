import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api, money, when, day, asset, STATUS } from './api';
import { useSession } from './session';
import { Alert, AuthLayout, Avatar, AuthImage, BellButton, Empty, Field, Icon, Portal, Sheet, Spinner, Stars, StatusPill, TopBar, useAsync, useBadges, useToast } from './ui';

// ---------- login (providers, admins, and security admins) ----------
export function Login() {
  const { signInStaff } = useSession(); const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '' }); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  
  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try { 
      const r = await api('/auth/login', { method: 'POST', body: f }); 
      signInStaff(r.token, r.user); 
      
      // ROLE-BASED ROUTING
      if (r.user.role === 'security_admin') {
        nav('/security', { replace: true });
      } else if (r.user.role === 'admin') {
        nav('/admin', { replace: true });
      } else {
        nav('/provider', { replace: true });
      }
    }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  
  return (
    <AuthLayout title="Welcome back" subtitle="Log in as a service provider, administrator, or security admin." heading="Manage your services, messages and requests in one place"
      points={['Reply to customers in private chat', 'Accept and track every request', 'Build your reputation with reviews']}>
      <form className="stack" onSubmit={submit}>
        <Alert>{error}</Alert>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="email" /></Field>
        <Field label="Password"><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required autoComplete="current-password" /></Field>
        <button className="btn lg block" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</button>
        <p className="center small">New provider? <Link to="/provider/signup"><b>Create an account</b></Link></p>
        <p className="center small"><Link to="/">Back to the website</Link></p>
      </form>
    </AuthLayout>
  );
}

// ---------- sign up in 3 steps: account, profile, services ----------
export function Signup() {
  const { staff, signInStaff } = useSession(); const nav = useNavigate();
  const [step, setStep] = useState(staff?.role === 'provider' ? 2 : 1);
  const cats = useAsync(() => api('/categories'), []); const dists = useAsync(() => api('/districts'), []);
  const [acct, setAcct] = useState({ name: '', phone: '', email: '', password: '' });
  const [prof, setProf] = useState({ business_name: '', phone: '', description: '', district_id: '', coverage: [] }); const [photo, setPhoto] = useState(null);
  const [svcs, setSvcs] = useState([{ category_id: '', name: '', price: '' }]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  const run = async (fn) => { setError(''); setBusy(true); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const createAccount = (e) => { e.preventDefault(); run(async () => { const r = await api('/auth/register-provider', { method: 'POST', body: acct }); signInStaff(r.token, r.user); setProf((p) => ({ ...p, business_name: acct.name, phone: acct.phone })); setStep(2); }); };
  const saveProfile = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/provider/profile', { method: 'PUT', as: 'staff', body: { business_name: prof.business_name, description: prof.description, phone: prof.phone, district_id: prof.district_id, coverage_district_ids: prof.coverage } });
      if (photo) { const form = new FormData(); form.append('image', photo); await api('/provider/profile/image', { method: 'POST', form, as: 'staff' }); }
      setStep(3);
    });
  };
  const saveServices = (e) => {
    e.preventDefault();
    run(async () => { for (const s of svcs.filter((x) => x.name && x.price !== '')) await api('/provider/services', { method: 'POST', as: 'staff', body: { ...s, category_id: s.category_id || cats.data[0].id } }); nav('/provider', { replace: true }); });
  };
  const toggleCov = (id) => setProf((p) => ({ ...p, coverage: p.coverage.includes(id) ? p.coverage.filter((x) => x !== id) : [...p.coverage, id] }));

  return (
    <AuthLayout title={step === 1 ? 'Create your provider account' : step === 2 ? 'Create your profile' : 'Add your services'}
      subtitle={step === 1 ? 'Free to join. It takes about two minutes.' : step === 2 ? 'Tell customers who you are and where you work.' : 'List what you offer and your starting prices.'}
      heading="Grow your business with customers across Lesotho"
      points={['Be found by customers in all ten districts', 'Receive requests and messages in one dashboard', 'Collect reviews and build trust']}>
      <div className="stack">
        <div className="steps" aria-label={`Step ${step} of 3`}>{[1, 2, 3].map((n) => <i key={n} className={n <= step ? 'on' : ''} />)}</div>
        <Alert>{error}</Alert>
        {step === 1 && (
          <form className="stack" onSubmit={createAccount}>
            <Field label="Full name"><input className="input" value={acct.name} onChange={(e) => setAcct({ ...acct, name: e.target.value })} required minLength={2} autoComplete="name" /></Field>
            <Field label="Phone number"><input className="input" inputMode="tel" value={acct.phone} onChange={(e) => setAcct({ ...acct, phone: e.target.value })} required autoComplete="tel" /></Field>
            <Field label="Email"><input className="input" type="email" value={acct.email} onChange={(e) => setAcct({ ...acct, email: e.target.value })} required autoComplete="email" /></Field>
            <Field label="Password" hint="At least 8 characters with a letter and a number"><input className="input" type="password" value={acct.password} onChange={(e) => setAcct({ ...acct, password: e.target.value })} required minLength={8} autoComplete="new-password" /></Field>
            <button className="btn block" disabled={busy}>{busy ? 'Creating...' : 'Sign up'}</button>
            <p className="center small">Already have an account? <Link to="/login"><b>Log in</b></Link></p>
          </form>
        )}
        {step === 2 && (
          <form className="stack" onSubmit={saveProfile}>
            <Field label="Business or provider name"><input className="input" value={prof.business_name} onChange={(e) => setProf({ ...prof, business_name: e.target.value })} required minLength={2} /></Field>
            <Field label="Business phone number"><input className="input" inputMode="tel" value={prof.phone} onChange={(e) => setProf({ ...prof, phone: e.target.value })} required /></Field>
            <Field label="Short description"><textarea className="input" value={prof.description} onChange={(e) => setProf({ ...prof, description: e.target.value })} placeholder="Tell customers about your services" maxLength={1000} /></Field>
            <Field label="Main district"><select className="input" value={prof.district_id} onChange={(e) => setProf({ ...prof, district_id: e.target.value })} required><option value="">Choose district</option>{(dists.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label="Other districts you cover"><div className="row wrap">{(dists.data || []).filter((d) => String(d.id) !== String(prof.district_id)).map((d) => <button type="button" key={d.id} className={`chip ${prof.coverage.includes(d.id) ? 'on' : ''}`} onClick={() => toggleCov(d.id)}>{d.name}</button>)}</div></Field>
            <Field label="Profile photo or logo (optional)"><input className="input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files[0] || null)} /></Field>
            <button className="btn block" disabled={busy}>{busy ? 'Saving...' : 'Next'}</button>
          </form>
        )}
        {step === 3 && (
          <form className="stack" onSubmit={saveServices}>
            <p className="muted small">Add what you offer and your starting price in maloti. You can change these later.</p>
            {svcs.map((s, i) => (
              <div key={i} className="card stack-s">
                <Field label="Category"><select className="input" value={s.category_id} onChange={(e) => setSvcs(svcs.map((x, j) => (j === i ? { ...x, category_id: e.target.value } : x)))}>{(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                <Field label="Service name"><input className="input" value={s.name} onChange={(e) => setSvcs(svcs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="For example: Leak repair" /></Field>
                <Field label="Price from (M)"><input className="input" inputMode="numeric" value={s.price} onChange={(e) => setSvcs(svcs.map((x, j) => (j === i ? { ...x, price: e.target.value.replace(/\D/g, '') } : x)))} /></Field>
                {svcs.length > 1 && <button type="button" className="btn ghost small" onClick={() => setSvcs(svcs.filter((_, j) => j !== i))}><Icon name="trash" size={16} /> Remove</button>}
              </div>
            ))}
            <button type="button" className="btn outline block" onClick={() => setSvcs([...svcs, { category_id: '', name: '', price: '' }])}><Icon name="plus" size={18} /> Add another service</button>
            <button className="btn block" disabled={busy}>{busy ? 'Saving...' : 'Finish'}</button>
            <button type="button" className="btn ghost block" onClick={() => nav('/provider')}>Skip for now</button>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}

// ---------- layout ----------
export function ProviderLayout() {
  const { staff, signOut } = useSession(); const nav = useNavigate();
  const b = useBadges('staff');
  if (!staff) return <Navigate to="/login" replace />;
  if (staff.role !== 'provider') return <Navigate to={staff.role === 'admin' ? '/admin' : '/login'} replace />;
  const links = [
    { to: '/provider', icon: 'grid', label: 'Dashboard', end: true }, { to: '/provider/requests', icon: 'list', label: 'Requests' },
    { to: '/provider/messages', icon: 'chat', label: 'Messages', badge: b.messages }, { to: '/provider/services', icon: 'wrench', label: 'Services' }, { to: '/provider/profile', icon: 'user', label: 'Profile' },
  ];
  return <Portal links={links} user={staff} label="Service provider" mobileNav="bottom" onLogout={() => { signOut('staff'); nav('/login'); }} bell={<BellButton to="/provider/notifications" count={b.notifications} />} />;
}

export function Dashboard() {
  const { staff } = useSession();
  const { data, loading, error } = useAsync(() => api('/provider/dashboard', { as: 'staff' }), []);
  const hour = new Date().getHours(); const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <>
      <TopBar back={false} title="Dashboard" />
      <div className="page">
        <div><p className="muted">{greet},</p><h1 style={{ color: 'var(--orange)' }}>{staff.name.split(' ')[0]}</h1></div>
        <Alert>{error}</Alert>
        {loading ? <Spinner /> : data && <>
          <div className="kpis">
            <div className="kpi"><b>{data.total}</b><span>Total requests</span></div><div className="kpi"><b>{data.pending}</b><span>Pending</span></div>
            <div className="kpi"><b>{data.completed}</b><span>Completed</span></div><div className="kpi"><b>{data.avg_rating ? data.avg_rating.toFixed(1) : '-'}</b><span>Rating ({data.review_count} reviews)</span></div>
          </div>
          {data.unread_messages > 0 && <Link to="/provider/messages" className="card tint row between"><span><Icon name="chat" size={18} /> You have {data.unread_messages} unread message{data.unread_messages > 1 ? 's' : ''}</span><Icon name="arrow" size={16} /></Link>}
          <div className="row between"><h2>Recent requests</h2><Link to="/provider/requests" className="small"><b>See all</b></Link></div>
          {data.recent.length === 0 ? <Empty icon="list" title="No requests yet">Complete your profile and services so customers can find you.</Empty> : <div className="grid-cards">{data.recent.map((r) => (
            <Link key={r.id} to={`/provider/requests/${r.id}`} className="card row between"><div><b>{r.customer_name}</b><div className="small muted">{r.service_name} &nbsp; {when(r.created_at)}</div></div><StatusPill status={r.status} /></Link>
          ))}</div>}
        </>}
      </div>
    </>
  );
}

export function Requests() {
  const [tab, setTab] = useState('all');
  const { data, loading, error } = useAsync(() => api('/provider/requests', { as: 'staff' }), []);
  const rows = (data || []).filter((r) => tab === 'all' || (tab === 'active' ? ['accepted', 'in_progress'].includes(r.status) : r.status === tab));
  return (
    <>
      <TopBar title="Requests" back={false} />
      <div className="page">
        <div className="chips" role="tablist">{[['all', 'All'], ['pending', 'Pending'], ['active', 'Active'], ['completed', 'Completed']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
        <Alert>{error}</Alert>
        {loading ? <Spinner /> : rows.length === 0 ? <Empty icon="list" title="Nothing here">No requests in this list.</Empty> : <div className="grid-cards three">{rows.map((r) => (
          <Link key={r.id} to={`/provider/requests/${r.id}`} className="card stack-s" style={{ gap: 4 }}>
            <div className="row between"><b>{r.customer_name}</b><StatusPill status={r.status} /></div>
            <span className="small">{r.service_name}</span><span className="small muted">{r.reference_number} &nbsp; {when(r.created_at)}</span>
          </Link>
        ))}</div>}
      </div>
    </>
  );
}

export function RequestDetail() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast();
  const { data: r, loading, error, reload } = useAsync(() => api(`/provider/requests/${id}`, { as: 'staff' }), [id]);
  const [busy, setBusy] = useState(false);
  async function setStatus(status) { setBusy(true); try { await api(`/provider/requests/${id}/status`, { method: 'PATCH', body: { status }, as: 'staff' }); toast('Request updated.'); reload(); } catch (e) { toast(e.message); } finally { setBusy(false); } }
  async function openChat() { try { const c = await api(`/provider/requests/${id}/conversation`, { method: 'POST', as: 'staff' }); nav(`/provider/messages/${c.id}`); } catch (e) { toast(e.message); } }
  if (loading) return <Spinner />;
  if (error) return <><TopBar title="Request" back="/provider/requests" /><div className="page"><Alert>{error}</Alert></div></>;
  return (
    <>
      <TopBar title="Request details" back="/provider/requests" />
      <div className="page">
        <div className="split">
          <div className="stack">
            <div className="card stack"><div className="row between"><span className="small muted">{r.reference_number}</span><StatusPill status={r.status} /></div>
              <div><div className="label">Service needed</div><p>{r.service_name}{r.price != null ? ` (from ${money(r.price)})` : ''}</p></div>
              <div><div className="label">Details</div><p>{r.description}</p></div>
              <div className="two"><div><div className="label">Date and time</div><p>{r.preferred_date ? day(r.preferred_date) : 'Not set'} {r.preferred_time || ''}</p></div><div><div className="label">Location</div><p>{r.location}</p></div></div>
              {r.attachments && <div className="row wrap">{r.attachments.map((a) => <div key={a.id} style={{ width: 120 }}><AuthImage path={`/requests/attachments/${a.id}`} as="staff" style={{ width: '100%', borderRadius: 12 }} /></div>)}</div>}</div>
            <div className="card"><h3 style={{ marginBottom: 14 }}>Progress</h3><div className="timeline">{r.history.map((h, i) => <div className="tl" key={i}><i /><div><b>{STATUS[h.new_status]}</b><div className="small muted">{when(h.changed_at)}</div></div></div>)}</div></div>
          </div>
          <aside className="stack sticky">
            <div className="card stack"><div className="row"><Avatar name={r.customer_name} size="sm" /><div className="grow"><b>{r.customer_name}</b><div className="small muted">{r.customer_phone}</div></div></div>
              <div className="row"><a className="btn outline grow" href={`tel:${r.customer_phone}`}><Icon name="phone" size={18} /> Call</a><button className="btn outline grow" onClick={openChat}><Icon name="chat" size={18} /> Message</button></div></div>
            {r.status === 'pending' && <div className="row"><button className="btn grow" disabled={busy} onClick={() => setStatus('accepted')}>Accept</button><button className="btn outline grow" disabled={busy} onClick={() => setStatus('rejected')}>Decline</button></div>}
            {r.status === 'accepted' && <button className="btn block" disabled={busy} onClick={() => setStatus('in_progress')}>Start work</button>}
            {r.status === 'in_progress' && <button className="btn block" disabled={busy} onClick={() => setStatus('completed')}>Mark as completed</button>}
          </aside>
        </div>
      </div>
    </>
  );
}

export function ServicesPage() {
  const toast = useToast();
  const me = useAsync(() => api('/provider/me', { as: 'staff' }), []); const cats = useAsync(() => api('/categories'), []);
  const [edit, setEdit] = useState(null); const [error, setError] = useState('');
  async function save(e) {
    e.preventDefault(); setError('');
    const body = { category_id: edit.category_id || cats.data[0].id, name: edit.name, description: edit.description || '', price: edit.price };
    try { await api(edit.id ? `/provider/services/${edit.id}` : '/provider/services', { method: edit.id ? 'PUT' : 'POST', body, as: 'staff' }); setEdit(null); me.reload(); toast('Service saved.'); } catch (x) { setError(x.message); }
  }
  async function remove(s) { try { await api(`/provider/services/${s.id}`, { method: 'DELETE', as: 'staff' }); me.reload(); toast('Service removed.'); } catch (x) { toast(x.message); } }
  return (
    <>
      <TopBar title="My services" back={false} right={<button className="iconbtn" onClick={() => setEdit({ name: '', price: '', category_id: '', description: '' })} aria-label="Add service"><Icon name="plus" /></button>} />
      <div className="page">
        <Alert>{me.error}</Alert>
        {me.loading ? <Spinner /> : me.data.services.length === 0 ? <Empty icon="wrench" title="No services yet">Add what you offer so customers can find and request you.</Empty> : <div className="grid-cards three">{me.data.services.map((s) => (
          <div key={s.id} className="card row between"><div className="grow"><b>{s.name}</b><div className="small muted">{s.category}</div></div><span className="price">{money(s.price)}</span>
            <button className="iconbtn" onClick={() => setEdit({ ...s, price: Number(s.price) })} aria-label={`Edit ${s.name}`}><Icon name="more" /></button></div>
        ))}</div>}
        <button className="btn outline block" onClick={() => setEdit({ name: '', price: '', category_id: '', description: '' })}><Icon name="plus" size={18} /> Add a service</button>
      </div>
      {edit && (
        <Sheet title={edit.id ? 'Edit service' : 'Add service'} onClose={() => setEdit(null)}>
          <form className="stack" onSubmit={save}>
            <Alert>{error}</Alert>
            <Field label="Category"><select className="input" value={edit.category_id || cats.data?.[0]?.id || ''} onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}>{(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Service name"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required minLength={2} /></Field>
            <Field label="Price from (M)"><input className="input" inputMode="numeric" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value.replace(/\D/g, '') })} required /></Field>
            <Field label="Description (optional)"><textarea className="input" value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={500} /></Field>
            <button className="btn block">Save service</button>
            {edit.id && <button type="button" className="btn danger block" onClick={() => { remove(edit); setEdit(null); }}>Remove service</button>}
          </form>
        </Sheet>
      )}
    </>
  );
}

export function ProfilePage() {
  const { staff, signOut } = useSession(); const nav = useNavigate(); const toast = useToast();
  const me = useAsync(() => api('/provider/me', { as: 'staff' }), []); const dists = useAsync(() => api('/districts'), []);
  const [f, setF] = useState(null); const [photo, setPhoto] = useState(null); const [error, setError] = useState('');
  useEffect(() => { if (me.data) setF({ business_name: me.data.business_name, description: me.data.description || '', phone: me.data.phone || '', district_id: me.data.district_id || '', coverage_district_ids: me.data.coverage_district_ids, availability: me.data.availability || '' }); }, [me.data]);
  async function save(e) {
    e.preventDefault(); setError('');
    try {
      await api('/provider/profile', { method: 'PUT', body: f, as: 'staff' });
      if (photo) { const form = new FormData(); form.append('image', photo); await api('/provider/profile/image', { method: 'POST', form, as: 'staff' }); setPhoto(null); }
      toast('Profile saved.'); me.reload();
    } catch (x) { setError(x.message); }
  }
  if (!f) return <><TopBar title="Profile" back={false} /><Spinner /></>;
  const toggle = (id) => setF({ ...f, coverage_district_ids: f.coverage_district_ids.includes(id) ? f.coverage_district_ids.filter((x) => x !== id) : [...f.coverage_district_ids, id] });
  return (
    <>
      <TopBar title="Profile" back={false} />
      <form className="page medium" onSubmit={save}>
        <div className="card row"><Avatar name={f.business_name} src={me.data.profile_image} size="lg" /><div><b>{staff.name}</b><div className="small muted">{staff.email}</div><Stars rating={me.data.avg_rating} count={me.data.review_count} /></div></div>
        <Alert>{error}</Alert>
        <div className="card stack">
        <Field label="Business or provider name"><input className="input" value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} required /></Field>
        <Field label="Description"><textarea className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={1000} /></Field>
        <Field label="Phone number"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></Field>
        <Field label="Main district"><select className="input" value={f.district_id} onChange={(e) => setF({ ...f, district_id: e.target.value })} required><option value="">Choose district</option>{(dists.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Other districts you cover"><div className="row wrap">{(dists.data || []).map((d) => <button type="button" key={d.id} className={`chip ${f.coverage_district_ids.includes(d.id) ? 'on' : ''}`} onClick={() => toggle(d.id)}>{d.name}</button>)}</div></Field>
        <Field label="Availability" hint="For example: Mon to Sat, 08:00 to 17:00"><input className="input" value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value })} maxLength={200} /></Field>
        <Field label="Change photo or logo"><input className="input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files[0] || null)} /></Field>
        </div>
        <div className="row wrap"><button className="btn">Save profile</button>
        <Link className="btn outline" to={`/providers/${me.data.id}`}>See how customers view my profile</Link>
        <button type="button" className="btn danger" onClick={() => { signOut('staff'); nav('/login'); }}><Icon name="logout" size={18} /> Log out</button></div>
      </form>
    </>
  );
}