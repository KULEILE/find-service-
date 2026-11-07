import { useState } from 'react';
import { api } from './api';
import { useSession } from './session';
import { Alert, Field, Icon } from './ui';

// Customers do not have accounts. This asks for a name and phone, checks a one-time code,
// and keeps a temporary login on this phone.
export function VerifyPhone({ onDone, reason }) {
  const { signInCustomer } = useSession();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [code, setCode] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function sendCode(e) {
    e?.preventDefault(); setError(''); setBusy(true);
    try { const r = await api('/customer/otp/request', { method: 'POST', body: form }); setDevOtp(r.devOtp || ''); setStep(2); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function verify(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const r = await api('/customer/otp/verify', { method: 'POST', body: { phone: form.phone, code } });
      signInCustomer(r.token, r.customer); onDone && onDone(r.customer);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="center stack-s">
        <div className="hero" style={{ padding: 0 }}><div className="logo" style={{ width: 64, height: 64, borderRadius: 18 }}><Icon name="lock" size={30} /></div></div>
        <h2>{step === 1 ? 'Verify your phone number' : 'Enter the code'}</h2>
        <p className="muted small">{step === 1 ? (reason || 'No account needed. We check your number so only you can see your messages and requests.') : `We sent a 6 digit code to ${form.phone}.`}</p>
      </div>
      <Alert>{error}</Alert>
      {step === 1 ? (
        <form className="stack" onSubmit={sendCode}>
          <Field label="Your name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} autoComplete="name" /></Field>
          <Field label="Phone number" hint="For example +266 5800 1234"><input className="input" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required autoComplete="tel" /></Field>
          <button className="btn block" disabled={busy}>{busy ? 'Sending...' : 'Send code'}</button>
        </form>
      ) : (
        <form className="stack" onSubmit={verify}>
          {devOtp && <Alert kind="info">Demo mode: your code is <b>{devOtp}</b></Alert>}
          <Field label="6 digit code"><input className="input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus autoComplete="one-time-code" /></Field>
          <button className="btn block" disabled={busy || code.length !== 6}>{busy ? 'Checking...' : 'Verify'}</button>
          <button type="button" className="btn ghost" onClick={sendCode} disabled={busy}>Send a new code</button>
          <button type="button" className="btn ghost" onClick={() => { setStep(1); setCode(''); setError(''); }}>Change phone number</button>
        </form>
      )}
    </div>
  );
}

// Shows its children only for a verified customer; otherwise asks for verification first.
export function VerifyGate({ title = 'Verify', reason, children }) {
  const { customer } = useSession();
  if (customer) return children;
  return (<div className="page narrow" style={{ paddingTop: 48 }}><div className="card"><VerifyPhone reason={reason} /></div></div>);
}
