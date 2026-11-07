import { io } from 'socket.io-client';

export const BASE = import.meta.env.VITE_API_URL || '';

// Three separate logins: customer (phone verified), staff (provider or admin), security (own portal).
const stores = { customer: localStorage, staff: localStorage, security: sessionStorage };
const K = (as) => `fsp_${as}`;
export const tokens = {
  get: (as) => stores[as].getItem(K(as) + '_token'),
  info: (as) => { try { return JSON.parse(stores[as].getItem(K(as) + '_info')); } catch { return null; } },
  set: (as, token, info) => { stores[as].setItem(K(as) + '_token', token); stores[as].setItem(K(as) + '_info', JSON.stringify(info)); window.dispatchEvent(new CustomEvent('fsp:signed-in', { detail: as })); },
  clear: (as) => { stores[as].removeItem(K(as) + '_token'); stores[as].removeItem(K(as) + '_info'); closeSocket(as); },
};

export class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }

export async function api(path, { method = 'GET', body, form, as } = {}) {
  const headers = {};
  const token = as ? tokens.get(as) : null;
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(`${BASE}/api${path}`, { method, headers, body: payload }); }
  catch { throw new ApiError('Cannot reach the server. Check your internet connection.', 0); }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && as && token) { tokens.clear(as); window.dispatchEvent(new CustomEvent('fsp:signed-out', { detail: as })); }
    throw new ApiError((data && data.error) || 'Something went wrong. Please try again.', res.status);
  }
  return data;
}

// Photos in chats are private, so they are fetched with the login token and shown from memory.
export async function fetchBlobUrl(path, as) {
  const res = await fetch(`${BASE}/api${path}`, { headers: { authorization: `Bearer ${tokens.get(as)}` } });
  if (!res.ok) throw new ApiError('Could not load the photo.', res.status);
  return URL.createObjectURL(await res.blob());
}

// ---- live connection ----
const sockets = {};
export function getSocket(as) {
  const token = tokens.get(as);
  if (!token) return null;
  if (!sockets[as]) sockets[as] = io(BASE || undefined, { auth: { token }, transports: ['websocket', 'polling'] });
  return sockets[as];
}
export function closeSocket(as) { if (sockets[as]) { sockets[as].close(); delete sockets[as]; } }

export const money = (n) => `M${Number(n).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
export const asset = (p) => (p ? (p.startsWith('http') ? p : `${BASE}${p}`) : null);
export const when = (d) => new Date(d).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const day = (d) => new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
export const clock = (d) => new Date(d).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
export const STATUS = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
