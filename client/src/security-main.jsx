import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes, Navigate } from 'react-router-dom';
import './styles.css';
import { ToastProvider } from './ui';
import { useSecurity, SecurityLogin, SecurityLayout, Overview, Permissions, Accounts, Logs, Policies } from './security';

// The security portal is a separate page (security.html) that uses address fragments (#/logs), so it works on any host without extra server rules.
//  In production, host it on its own address,
// for example security.yoursite.com, so it is not reachable from the public website.
function App() {
  const s = useSecurity();
  return (
    <Routes>
      <Route path="/login" element={s.user ? <Navigate to="/" replace /> : <SecurityLogin signIn={s.signIn} />} />
      <Route element={<SecurityLayout user={s.user} signOut={s.signOut} />}>
        <Route path="/" element={<Overview />} />
        <Route path="/permissions" element={<Permissions />} />
        <Route path="/accounts" element={<Accounts me={s.user || {}} />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/policies" element={<Policies />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode><ToastProvider><HashRouter><App /></HashRouter></ToastProvider></StrictMode>
);
