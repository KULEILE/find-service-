import { createContext, useContext, useEffect, useState } from 'react';
import { tokens } from './api';

const Ctx = createContext(null);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }) {
  const [customer, setCustomer] = useState(() => tokens.info('customer'));
  const [staff, setStaff] = useState(() => tokens.info('staff'));
  useEffect(() => {
    const f = (e) => { if (e.detail === 'customer') setCustomer(null); if (e.detail === 'staff') setStaff(null); };
    window.addEventListener('fsp:signed-out', f);
    return () => window.removeEventListener('fsp:signed-out', f);
  }, []);
  const value = {
    customer, staff,
    signInCustomer: (token, info) => { tokens.set('customer', token, info); setCustomer(info); },
    signInStaff: (token, info) => { tokens.set('staff', token, info); setStaff(info); },
    signOut: (as) => { tokens.clear(as); (as === 'customer' ? setCustomer : setStaff)(null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
