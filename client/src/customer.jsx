import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, money, day, when, STATUS } from './api';
import { useSession } from './session';
import { VerifyGate } from './verify';
import { Alert, Avatar, AuthImage, BellButton, Brand, BottomNav, Empty, Field, Icon, Sheet, Spinner, StarPick, Stars, StatusPill, TopBar, useAsync, useBadges, useToast } from './ui';

// ---------- site frame: top menu on large screens, bottom bar on phones ----------
export function SiteLayout() {
  const { customer, staff } = useSession();
  const b = useBadges('customer');
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  const inMessages = loc.pathname.startsWith('/messages');
  const portal = staff ? (staff.role === 'admin' ? '/admin' : '/provider') : null;
  const link = ({ isActive }) => (isActive ? 'active' : '');
  return (
    <div className="site">
      <header className="site-header">
        <div className="container hdr">
          <Brand />
          <nav className="navlinks" aria-label="Main">
            <NavLink to="/services" className={link}>Find a Service</NavLink>
            <NavLink to="/requests" className={link}>Track Request</NavLink>
            <NavLink to="/messages" className={link}>Messages{customer && b.messages > 0 && <span className="nbadge">{b.messages}</span>}</NavLink>
          </nav>
          <div className="navactions">
            {customer && <BellButton to="/notifications" count={b.notifications} />}
            {customer && <Link to="/more" className="btn ghost small"><Icon name="user" size={18} /> {customer.name.split(' ')[0]}</Link>}
            {portal ? <Link to={portal} className="btn small">Go to dashboard</Link> : <><Link to="/login" className="btn outline small">Log in</Link><Link to="/provider/signup" className="btn small">Become a provider</Link></>}
          </div>
          <button className="iconbtn menu-btn" onClick={() => setMenu(!menu)} aria-label="Menu" aria-expanded={menu}><Icon name={menu ? 'x' : 'menu'} /></button>
        </div>
        {menu && (
          <div className="mobile-menu">
            <Link className="mm" to="/services">Find a Service</Link><Link className="mm" to="/requests">Track a request</Link>
            {portal ? <Link className="mm" to={portal}>Go to dashboard</Link> : <><Link className="mm" to="/login">Provider or admin login</Link><Link className="mm" to="/provider/signup">Become a provider</Link></>}
          </div>
        )}
      </header>
      <main><Outlet context={b} /></main>
      {!inMessages && <Footer />}
      <BottomNav items={[
        { to: '/', icon: 'home', label: 'Home', end: true }, { to: '/services', icon: 'search', label: 'Search' },
        { to: '/messages', icon: 'chat', label: 'Messages', badge: customer ? b.messages : 0 },
        { to: '/requests', icon: 'list', label: 'Requests' }, { to: '/more', icon: 'user', label: 'Account', badge: customer ? b.notifications : 0 },
      ]} />
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="cols4">
          <div className="stack-s"><Brand /><p className="small" style={{ maxWidth: 340 }}>A central place to find trusted local service providers in all ten districts of Lesotho, talk to them privately and request work.</p></div>
          <div><h4>For customers</h4><Link to="/services">Find a service</Link><Link to="/requests">Track a request</Link><Link to="/messages">Messages</Link></div>
          <div><h4>For providers</h4><Link to="/provider/signup">Become a provider</Link><Link to="/login">Provider login</Link></div>
          <div><h4>Your privacy</h4><p className="small">Messages are private and encrypted. Customers never need an account and can delete their data at any time.</p></div>
        </div>
        <div className="legal">&copy; {new Date().getFullYear()} Find a Service Provider, Lesotho. All rights reserved.</div>
      </div>
    </footer>
  );
}

// ---------- shared provider card ----------
export function ProviderCard({ p }) {
  return (
    <Link to={`/providers/${p.id}`} className="card row" style={{ alignItems: 'flex-start' }}>
      <Avatar name={p.business_name} src={p.profile_image} />
      <div className="grow stack-s" style={{ gap: 4 }}>
        <b>{p.business_name}</b>
        <Stars rating={p.avg_rating} count={p.review_count} />
        <span className="small muted"><Icon name="pin" size={13} /> {p.district || 'Lesotho'}</span>
        {p.categories && <span className="small muted">{p.categories.slice(0, 2).join(', ')}</span>}
        <span className="small">From <span className="price">{money(p.from_price)}</span></span>
      </div>
    </Link>
  );
}

// ---------- landing page ----------
export function Welcome() {
  const cats = useAsync(() => api('/categories'), []);
  const top = useAsync(() => api('/providers'), []);
  const stats = useAsync(() => api('/public-stats'), []);
  const s = stats.data;
  return (
    <>
      <section className="hero2">
        <div className="hero-visual">
          <div className="hero-photo" aria-hidden="true" />
          <div className="hero-badges">
            <div className="float">
              <span className="logo-mark"><Icon name="check" size={20} /></span>
              <div><b>Verified phone numbers</b><span className="muted small">No account needed</span></div>
            </div>
            <div className="float">
              <span className="logo-mark"><Icon name="star" size={20} /></span>
              <div><b>{s && Number(s.avg_rating) ? `${Number(s.avg_rating).toFixed(1)} average rating` : 'Honest reviews'}</b><span className="muted small">From real customers</span></div>
            </div>
          </div>
        </div>
        <div className="hero-copy">
          <h1>Find trusted <span>service providers</span> near you</h1>
          <p className="lead">Quick, easy and reliable services for your home or business.</p>
          <div className="hero-cta">
            <Link className="btn lg" to="/services">Find a Service</Link>
            <Link className="btn outline lg" to="/login">I'm a Service Provider</Link>
          </div>
          {s && <div className="trust"><div><b>{s.providers}</b><span>Active providers</span></div><div><b>{s.completed_jobs}</b><span>Jobs completed</span></div><div><b>10</b><span>Districts covered</span></div></div>}
        </div>
      </section>

      <section className="section"><div className="container">
        <div className="section-head"><div><h2>Popular services</h2><p>Choose a category to see providers near you.</p></div><Link to="/services" className="small only-desktop"><b>See all</b></Link></div>
        {cats.loading ? <Spinner /> : <div className="grid-cats">{(cats.data || []).map((c) => <Link key={c.id} to={`/providers?category=${c.slug}`} className="cat"><span className="ico"><Icon name={c.icon || 'more'} size={28} /></span>{c.name}</Link>)}</div>}
      </div></section>

      <section className="section soft"><div className="container">
        <div className="section-head"><div><h2>How it works</h2><p>From problem to solution in three simple steps.</p></div></div>
        <div className="steps3">
          <div className="step"><span className="num">1</span><h3>Search and compare</h3><p className="muted">Browse by category and district, compare prices and read honest reviews.</p></div>
          <div className="step"><span className="num">2</span><h3>Message or request</h3><p className="muted">Ask questions in private chat, then send a request. No account, just your phone number.</p></div>
          <div className="step"><span className="num">3</span><h3>Track and review</h3><p className="muted">Follow your request with a reference number and rate the provider when the job is done.</p></div>
        </div>
      </div></section>

      <section className="section"><div className="container">
        <div className="section-head"><div><h2>Top rated providers</h2><p>Chosen by customers like you.</p></div><Link to="/providers" className="small"><b>View all</b></Link></div>
        {top.loading ? <Spinner /> : <div className="grid-cards three">{(top.data || []).slice(0, 6).map((p) => <ProviderCard key={p.id} p={p} />)}</div>}
      </div></section>

      <section className="section"><div className="container">
        <div className="section-head"><div><h2>Why people choose us</h2></div></div>
        <div className="features">
          <div className="feature"><span className="ico"><Icon name="phone" size={24} /></span><h3>No account needed</h3><p>Verify your phone number with a one-time code and you are ready to message and request.</p></div>
          <div className="feature"><span className="ico"><Icon name="lock" size={24} /></span><h3>Private messaging</h3><p>Your chats are encrypted and visible only to you and the provider.</p></div>
          <div className="feature"><span className="ico"><Icon name="list" size={24} /></span><h3>Track every request</h3><p>A reference number shows the status of your job from pending to completed.</p></div>
          <div className="feature"><span className="ico"><Icon name="star" size={24} /></span><h3>Honest reviews</h3><p>Only customers with a completed job can leave a review, so ratings are real.</p></div>
        </div>
      </div></section>

      <section className="section"><div className="container">
        <div className="cta-band">
          <div className="stack-s"><h2>Are you a service provider?</h2><p>Create your free profile, list your services and prices, and receive requests and messages from customers across Lesotho.</p></div>
          <div className="row wrap"><Link className="btn lg" to="/provider/signup">Join as a provider</Link></div>
        </div>
      </div></section>
    </>
  );
}

export function Services() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const { data, loading, error } = useAsync(() => api('/categories'), []);
  return (
    <>
      <TopBar title="Choose a service" back={false} />
      <div className="page">
        <form className="searchbox" style={{ maxWidth: 640 }} onSubmit={(e) => { e.preventDefault(); nav(`/providers?q=${encodeURIComponent(q)}`); }}>
          <Icon name="search" size={20} /><input className="input" placeholder="Search for a service or provider" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <h2>Categories</h2>
        <Alert>{error}</Alert>
        {loading ? <Spinner /> : <div className="grid-cats">{(data || []).map((c) => (
          <Link key={c.id} to={`/providers?category=${c.slug}`} className="cat"><span className="ico"><Icon name={c.icon || 'more'} size={28} /></span>{c.name}</Link>
        ))}</div>}
      </div>
    </>
  );
}

function FilterBody({ draft, setDraft, dists, onApply, onClear }) {
  return (
    <div className="stack">
      <Field label="District"><select className="input" value={draft.district} onChange={(e) => setDraft({ ...draft, district: e.target.value })}><option value="">All districts</option>{(dists || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
      <div className="two"><Field label="Lowest price (M)"><input className="input" inputMode="numeric" value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Highest price (M)"><input className="input" inputMode="numeric" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value.replace(/\D/g, '') })} /></Field></div>
      <Field label="Sort by"><select className="input" value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value })}><option value="">Best rated</option><option value="price_low">Price: low to high</option><option value="price_high">Price: high to low</option></select></Field>
      <button className="btn block" onClick={onApply}>Show results</button>
      <button className="btn ghost block" onClick={onClear}>Clear filters</button>
    </div>
  );
}

export function Providers() {
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useState(false);
  const f = { category: sp.get('category') || '', q: sp.get('q') || '', district: sp.get('district') || '', min: sp.get('min') || '', max: sp.get('max') || '', sort: sp.get('sort') || '' };
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const cats = useAsync(() => api('/categories'), []);
  const dists = useAsync(() => api('/districts'), []);
  const { data, loading, error } = useAsync(() => api(`/providers?${qs}`), [qs]);
  const catName = (cats.data || []).find((c) => c.slug === f.category)?.name;
  const [draft, setDraft] = useState(f);
  useEffect(() => setDraft({ district: sp.get('district') || '', min: sp.get('min') || '', max: sp.get('max') || '', sort: sp.get('sort') || '' }), [sp]);
  const activeFilters = ['district', 'min', 'max', 'sort'].filter((k) => f[k]).length;
  const apply = () => { setSp(new URLSearchParams(Object.entries({ ...f, ...draft }).filter(([, v]) => v))); setOpen(false); };
  const clear = () => { setSp(new URLSearchParams(Object.entries({ category: f.category, q: f.q }).filter(([, v]) => v))); setOpen(false); };
  const body = <FilterBody draft={draft} setDraft={setDraft} dists={dists.data} onApply={apply} onClear={clear} />;

  return (
    <>
      <TopBar title={catName || (f.q ? `Results for "${f.q}"` : 'All providers')} back="/services"
        right={<button className="btn outline small only-mobile" onClick={() => setOpen(true)}><Icon name="filter" size={18} /> Filters{activeFilters > 0 ? ` (${activeFilters})` : ''}</button>} />
      <div className="page">
        <div className="listing">
          <aside className="filters card"><h3>Filters</h3>{body}</aside>
          <div className="stack">
            <div className="searchbox"><Icon name="search" size={20} /><input className="input" placeholder="Search by provider or service name" aria-label="Search provider" defaultValue={f.q} onKeyDown={(e) => { if (e.key === 'Enter') { const n = new URLSearchParams(sp); e.target.value ? n.set('q', e.target.value) : n.delete('q'); setSp(n); } }} /></div>
            <div className="chips" aria-label="Categories"><button className={`chip ${!f.category ? 'on' : ''}`} onClick={() => { const n = new URLSearchParams(sp); n.delete('category'); setSp(n); }}>All</button>{(cats.data || []).map((c) => <button key={c.id} className={`chip ${f.category === c.slug ? 'on' : ''}`} onClick={() => { const n = new URLSearchParams(sp); n.set('category', c.slug); setSp(n); }}>{c.name}</button>)}</div>
            <Alert>{error}</Alert>
            {loading ? <Spinner /> : data && data.length === 0 ? <Empty title="No providers found">Try another district, a higher price limit or a different search.</Empty> : <>
              <p className="muted small">{data.length} provider{data.length === 1 ? '' : 's'} found</p>
              <div className="grid-cards">{(data || []).map((p) => <ProviderCard key={p.id} p={p} />)}</div></>}
          </div>
        </div>
      </div>
      {open && <Sheet title="Filters" onClose={() => setOpen(false)}>{body}</Sheet>}
    </>
  );
}

export function ProviderDetail() {
  const { id } = useParams();
  const { data: p, loading, error } = useAsync(() => api(`/providers/${id}`), [id]);
  if (loading) return <Spinner />;
  if (error) return <><TopBar title="Provider" /><div className="page"><Alert>{error}</Alert></div></>;
  const from = p.services.length ? Math.min(...p.services.map((s) => Number(s.price))) : null;
  const actions = <><Link className="btn outline grow" to={`/messages/new/${p.id}`}><Icon name="chat" size={18} /> Message</Link><Link className="btn grow" to={`/providers/${p.id}/request`}>Request Service</Link></>;
  return (
    <>
      <TopBar title="Provider details" back="/services" />
      <div className="page">
        <div className="split">
          <div className="stack">
            <div className="card row" style={{ alignItems: 'flex-start', gap: 18 }}>
              <Avatar name={p.business_name} src={p.profile_image} size="lg" />
              <div className="stack-s grow"><h1>{p.business_name}</h1><Stars rating={p.avg_rating} count={p.review_count} />
                <span className="small muted"><Icon name="pin" size={14} /> {p.district}, Lesotho</span>{p.availability && <span className="small muted">{p.availability}</span>}</div>
            </div>
            {p.description && <div className="card stack-s"><h2>About</h2><p>{p.description}</p></div>}
            <div className="card stack"><h2>Services and prices</h2>
              <div className="stack-s">{p.services.map((s) => <div key={s.id} className="row between" style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}><div><b>{s.name}</b><div className="small muted">{s.category}</div></div><span className="price">{money(s.price)}</span></div>)}</div></div>
            {p.coverage.length > 0 && <div className="card stack-s"><h2>Areas covered</h2><div className="row wrap">{p.coverage.map((d) => <span key={d.id} className="pill">{d.name}</span>)}</div></div>}
            <div className="card stack"><h2>Reviews</h2>
              {p.reviews.length === 0 ? <p className="muted small">No reviews yet.</p> : p.reviews.map((r, i) => (
                <div key={i} className="stack-s" style={{ gap: 4, paddingBottom: 12, borderBottom: '1px solid var(--line)' }}><div className="row between"><b>{r.customer_name}</b><Stars rating={r.rating} /></div>{r.comment && <p className="small">{r.comment}</p>}<span className="small muted">{day(r.created_at)}</span></div>))}</div>
          </div>
          <aside className="card stack sticky only-desktop">
            {from != null && <div><div className="small muted">Prices start from</div><div className="price" style={{ fontSize: '1.8rem' }}>{money(from)}</div></div>}
            <div className="stack-s">{p.availability && <div className="small"><Icon name="check" size={14} /> {p.availability}</div>}<div className="small"><Icon name="lock" size={14} /> Chats are private and encrypted</div></div>
            <Link className="btn block" to={`/providers/${p.id}/request`}>Request Service</Link>
            <Link className="btn outline block" to={`/messages/new/${p.id}`}><Icon name="chat" size={18} /> Message provider</Link>
            {p.phone && <a className="btn ghost block" href={`tel:${p.phone}`}><Icon name="phone" size={18} /> {p.phone}</a>}
          </aside>
        </div>
        <div className="row only-mobile" style={{ position: 'sticky', bottom: 76, background: 'rgba(255,255,255,.96)', padding: 10, borderRadius: 16, boxShadow: 'var(--shadow)' }}>{actions}</div>
      </div>
    </>
  );
}

// Opens (or creates) the chat with a provider, then goes to it.
export function NewConversation() {
  return <VerifyGate title="Message provider" reason="To keep your messages private, we check your phone number first. You do not need an account."><StartChat /></VerifyGate>;
}
function StartChat() {
  const { providerId } = useParams(); const nav = useNavigate(); const [error, setError] = useState('');
  useEffect(() => { api('/conversations', { method: 'POST', body: { provider_id: providerId }, as: 'customer' }).then((r) => nav(`/messages/${r.id}`, { replace: true })).catch((e) => setError(e.message)); }, [providerId, nav]);
  return <div className="page narrow">{error ? <Alert>{error}</Alert> : <Spinner />}</div>;
}

export function RequestService() {
  return <VerifyGate title="Request service" reason="We check your phone number so the provider can reach you and only you can track this request."><RequestForm /></VerifyGate>;
}
function RequestForm() {
  const { id } = useParams(); const nav = useNavigate();
  const { data: p, loading, error } = useAsync(() => api(`/providers/${id}`), [id]);
  const [f, setF] = useState({ service_id: '', description: '', preferred_date: '', preferred_time: '', location: '' });
  const [files, setFiles] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (p) setF((x) => ({ ...x, service_id: x.service_id || p.services[0]?.id || '', location: x.location || p.district || '' })); }, [p]);
  const today = new Date().toISOString().slice(0, 10);
  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    const form = new FormData(); form.append('provider_id', id); Object.entries(f).forEach(([k, v]) => v && form.append(k, v)); files.forEach((x) => form.append('images', x));
    try { const r = await api('/requests', { method: 'POST', form, as: 'customer' }); nav(`/request-sent/${r.reference_number}`, { state: { provider: p.business_name, providerId: id }, replace: true }); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  if (loading) return <Spinner />;
  if (error) return <div className="page"><Alert>{error}</Alert></div>;
  const sel = p.services.find((s) => s.id === f.service_id);
  return (
    <>
      <TopBar title="Request a service" back={`/providers/${id}`} />
      <div className="page">
        <div className="split">
          <form className="card stack" onSubmit={submit}>
            <Alert>{err}</Alert>
            <Field label="Service" hint={sel ? `Starts from ${money(sel.price)}` : ''}><select className="input" value={f.service_id} onChange={(e) => setF({ ...f, service_id: e.target.value })} required>{p.services.map((s) => <option key={s.id} value={s.id}>{s.name} ({money(s.price)})</option>)}</select></Field>
            <Field label="What do you need help with?"><textarea className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="For example: fix a leaking pipe in the kitchen" required minLength={5} maxLength={1500} /></Field>
            <div className="two">
              <Field label="Preferred date"><input className="input" type="date" min={today} value={f.preferred_date} onChange={(e) => setF({ ...f, preferred_date: e.target.value })} /></Field>
              <Field label="Preferred time"><input className="input" type="time" value={f.preferred_time} onChange={(e) => setF({ ...f, preferred_time: e.target.value })} /></Field>
            </div>
            <Field label="Location" hint="Village, town or street where the work is needed"><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} required minLength={2} /></Field>
            <Field label="Photos (optional, up to 3)"><input className="input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles([...e.target.files].slice(0, 3))} /></Field>
            <button className="btn lg block" disabled={busy}>{busy ? 'Sending...' : 'Send Request'}</button>
          </form>
          <aside className="stack sticky">
            <div className="card row"><Avatar name={p.business_name} src={p.profile_image} /><div><b>{p.business_name}</b><div className="small muted">{p.district}</div><Stars rating={p.avg_rating} count={p.review_count} /></div></div>
            <div className="card soft stack-s"><h3>What happens next</h3><p className="small muted">1. The provider receives your request and replies.</p><p className="small muted">2. You get a reference number to track progress.</p><p className="small muted">3. After the job you can leave a review.</p></div>
          </aside>
        </div>
      </div>
    </>
  );
}

export function RequestSent() {
  const { ref } = useParams(); const { state } = useLocation();
  return (
    <div className="page narrow" style={{ paddingTop: 64 }}>
      <div className="card stack center" style={{ padding: 32, justifyItems: 'center' }}>
        <div className="logo-big" style={{ background: 'var(--green)' }}><Icon name="check" size={40} /></div>
        <h1>Request sent</h1>
        <p>{state?.provider || 'The provider'} has been notified. They will contact you soon.</p>
        <div className="card tint" style={{ width: '100%' }}><div className="small muted">Your reference number</div><b style={{ fontSize: '1.6rem', letterSpacing: 1 }}>{ref}</b><div className="small muted">Keep it to track your request.</div></div>
        <Link className="btn block" to={`/track/${ref}`}>Track this request</Link>
        {state?.providerId && <Link className="btn outline block" to={`/messages/new/${state.providerId}`}>Message the provider</Link>}
        <Link className="btn ghost block" to="/">Back to Home</Link>
      </div>
    </div>
  );
}

export function MyRequests() { return <VerifyGate title="My requests" reason="Verify your phone number to see and track your requests."><MyRequestsList /></VerifyGate>; }
function MyRequestsList() {
  const nav = useNavigate(); const [ref, setRef] = useState('');
  const { data, loading, error } = useAsync(() => api('/requests', { as: 'customer' }), []);
  return (
    <>
      <TopBar title="My requests" back={false} />
      <div className="page">
        <form className="searchbox" style={{ maxWidth: 520 }} onSubmit={(e) => { e.preventDefault(); if (ref.trim()) nav(`/track/${ref.trim().toUpperCase()}`); }}>
          <Icon name="search" size={20} /><input className="input" placeholder="Find by reference number" aria-label="Reference number" value={ref} onChange={(e) => setRef(e.target.value)} />
        </form>
        <Alert>{error}</Alert>
        {loading ? <Spinner /> : data && data.length === 0 ? <Empty icon="list" title="No requests yet">When you request a service it appears here.</Empty> : (
          <div className="grid-cards three">{(data || []).map((r) => (
            <Link key={r.id} to={`/track/${r.reference_number}`} className="card stack-s" style={{ gap: 6 }}>
              <div className="row between"><b>{r.service_name || 'Service'}</b><StatusPill status={r.status} /></div>
              <span className="small">{r.business_name}</span><span className="small muted">{r.reference_number} &nbsp; {day(r.created_at)}</span>
            </Link>))}</div>)}
      </div>
    </>
  );
}

export function TrackRequest() { return <VerifyGate title="Track request" reason="Verify your phone number to see this request. Only the person who made it can open it."><Track /></VerifyGate>; }
function Track() {
  const { ref } = useParams(); const toast = useToast();
  const { data: r, loading, error, reload } = useAsync(() => api(`/requests/track/${ref}`, { as: 'customer' }), [ref]);
  const [rating, setRating] = useState(0); const [comment, setComment] = useState(''); const [sheet, setSheet] = useState(false);
  async function cancel() { try { await api(`/requests/${r.id}/cancel`, { method: 'POST', as: 'customer' }); setSheet(false); toast('Request cancelled.'); reload(); } catch (e) { toast(e.message); setSheet(false); } }
  async function review() { try { await api(`/requests/${r.id}/review`, { method: 'POST', body: { rating, comment }, as: 'customer' }); toast('Thank you for your review.'); reload(); } catch (e) { toast(e.message); } }
  if (loading) return <Spinner />;
  if (error) return <><TopBar title="Track request" back="/requests" /><div className="page"><Alert>{error}</Alert></div></>;
  return (
    <>
      <TopBar title="Track request" back="/requests" />
      <div className="page">
        <div className="split">
          <div className="stack">
            <div className="card stack-s"><h2>{r.service_name || 'Service'}</h2><span>{r.business_name}</span>
              <span className="small muted"><Icon name="pin" size={13} /> {r.location}{r.preferred_date ? ` \u00a0 ${day(r.preferred_date)}` : ''} {r.preferred_time || ''}</span><p>{r.description}</p>
              {r.attachments && <div className="row wrap">{r.attachments.map((a) => <div key={a.id} style={{ width: 110 }}><AuthImage path={`/requests/attachments/${a.id}`} as="customer" style={{ width: '100%', borderRadius: 12 }} /></div>)}</div>}</div>
            <div className="card"><h3 style={{ marginBottom: 14 }}>Progress</h3><div className="timeline">{r.history.map((h, i) => <div className="tl" key={i}><i /><div><b>{STATUS[h.new_status]}</b><div className="small muted">{when(h.changed_at)}</div></div></div>)}</div></div>
            {r.status === 'completed' && (r.review ? <div className="card stack-s"><h3>Your review</h3><Stars rating={r.review.rating} />{r.review.comment && <p className="small">{r.review.comment}</p>}</div> : (
              <div className="card stack-s"><h3>How was the service?</h3><StarPick value={rating} onChange={setRating} /><textarea className="input" placeholder="Write a short review (optional)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={600} /><button className="btn" disabled={!rating} onClick={review}>Submit review</button></div>))}
          </div>
          <aside className="stack sticky">
            <div className="card tint stack-s"><div className="small muted">Reference number</div><b style={{ fontSize: '1.4rem' }}>{r.reference_number}</b><div><StatusPill status={r.status} /></div></div>
            <div className="card stack-s"><Link className="btn outline block" to={`/messages/new/${r.provider_id}`}><Icon name="chat" size={18} /> Message provider</Link>{r.provider_phone && <a className="btn outline block" href={`tel:${r.provider_phone}`}><Icon name="phone" size={18} /> Call provider</a>}
              {['pending', 'accepted'].includes(r.status) && <button className="btn danger block" onClick={() => setSheet(true)}>Cancel request</button>}</div>
            <p className="small muted" style={{ wordBreak: 'break-all' }}>Record fingerprint: {r.record_hash ? r.record_hash.slice(0, 24) + '...' : 'not yet created'}{r.tx_hash ? ` (on blockchain: ${r.tx_hash.slice(0, 14)}...)` : ''}</p>
          </aside>
        </div>
      </div>
      {sheet && <Sheet title="Cancel this request?" onClose={() => setSheet(false)}><p className="muted">The provider will be told. You can send a new request later.</p><button className="btn danger block" onClick={cancel}>Yes, cancel request</button><button className="btn ghost block" onClick={() => setSheet(false)}>Keep it</button></Sheet>}
    </>
  );
}

export function More() {
  const { customer, signOut } = useSession(); const nav = useNavigate(); const toast = useToast(); const [sheet, setSheet] = useState(false);
  const b = useBadges('customer');
  async function erase() { try { await api('/customer/data', { method: 'DELETE', as: 'customer' }); signOut('customer'); setSheet(false); toast('Your data was deleted.'); nav('/'); } catch (e) { toast(e.message); setSheet(false); } }
  return (
    <>
      <TopBar title="My account" back={false} />
      <div className="page medium">
        {customer ? <div className="card row"><Avatar name={customer.name} /><div><b>{customer.name}</b><div className="small muted">{customer.phone} (verified)</div></div></div>
          : <div className="card stack-s"><h3>You are not verified yet</h3><p className="small muted">Verify your phone number when you message a provider or send a request. No account is needed.</p></div>}
        {customer && <Link to="/notifications" className="card row between"><span><Icon name="bell" size={18} /> Notifications</span>{b.notifications > 0 && <span className="pill">{b.notifications} new</span>}</Link>}
        <Link to="/login" className="card row between"><span>Service provider or admin login</span><Icon name="arrow" size={18} /></Link>
        <div className="card stack-s"><h3>Your privacy</h3><p className="small muted">Messages are private between you and the provider, and are encrypted. Chats are deleted automatically after a set time. You can delete your data at any time.</p></div>
        {customer && <div className="two"><button className="btn outline" onClick={() => { signOut('customer'); nav('/'); }}><Icon name="logout" size={18} /> Sign out of this phone</button>
          <button className="btn danger" onClick={() => setSheet(true)}><Icon name="trash" size={18} /> Delete my data</button></div>}
      </div>
      {sheet && <Sheet title="Delete all your data?" onClose={() => setSheet(false)}><p className="muted">Your chats, photos and phone number are erased. Requests stay in the provider's records without your name. This cannot be undone.</p><button className="btn danger block" onClick={erase}>Delete my data</button><button className="btn ghost block" onClick={() => setSheet(false)}>Keep my data</button></Sheet>}
    </>
  );
}