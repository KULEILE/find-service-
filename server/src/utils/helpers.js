const crypto = require('crypto');
const { query } = require('../db');
const realtime = require('../realtime');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- security policies (cached for 20 seconds) ----
let policyCache = { at: 0, map: {} };
async function getPolicies() {
  if (Date.now() - policyCache.at > 20000) {
    const { rows } = await query('SELECT key, value FROM security_policies');
    policyCache = { at: Date.now(), map: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  }
  return policyCache.map;
}
const clearPolicyCache = () => { policyCache.at = 0; };
async function policyInt(key, fallback) {
  const v = parseInt((await getPolicies())[key], 10);
  return Number.isFinite(v) ? v : fallback;
}

// ---- logs ----
async function logActivity({ userId = null, role = null, action, entity = null, entityId = null, details = null }, client = null) {
  await (client || { query }).query(
    'INSERT INTO system_activity (user_id, actor_role, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
    [userId, role, action, entity, entityId ? String(entityId) : null, details ? JSON.stringify(details) : null]
  );
}

async function logSecurity({ userId = null, role = null, event, severity = 'info', req = null, details = null }) {
  try {
    await query(
      'INSERT INTO security_logs (user_id, actor_role, event_type, severity, ip_address, user_agent, details) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [userId, role, event, severity, req ? req.ip : null, req ? (req.get('user-agent') || '').slice(0, 250) : null, details ? JSON.stringify(details) : null]
    );
  } catch (e) { console.error('security log failed', e.message); }
}

// ---- notifications (saved and pushed live) ----
async function notify(kind, recipientId, type, message, link = null, client = null) {
  const { rows } = await (client || { query }).query(
    'INSERT INTO notifications (recipient_kind, recipient_id, type, message, link) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [kind, recipientId, type, message, link]
  );
  realtime.emitTo(`${kind}:${recipientId}`, 'notification:new', rows[0]);
  return rows[0];
}

// Example: FSP-2026-7K3QZ9
function generateReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(0, alphabet.length)];
  return `FSP-${new Date().getFullYear()}-${code}`;
}

function normalizePhone(p) {
  return String(p || '').replace(/[\s\-()]/g, '');
}

module.exports = {
  HttpError, asyncHandler, getPolicies, clearPolicyCache, policyInt,
  logActivity, logSecurity, notify, generateReference, normalizePhone,
};
