const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db');
const { HttpError, asyncHandler, logSecurity } = require('../utils/helpers');

// aud = "main" for the public app, "security" for the separate security portal.
function signToken({ sub, role, aud }) {
  return jwt.sign({ role, aud }, config.jwtSecret, {
    subject: sub, issuer: 'fsp', expiresIn: role === 'customer' ? '12h' : '8h',
  });
}

// Works for HTTP requests and for Socket.IO connections.
async function resolveActor(token, audience) {
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret, { issuer: 'fsp' }); }
  catch { throw new HttpError(401, 'Your session has expired. Please log in again.'); }
  if (audience && payload.aud !== audience) throw new HttpError(401, 'This login cannot be used here.');

  if (payload.role === 'customer') {
    const { rows } = await query('SELECT id, name, phone FROM customer_identities WHERE id = $1 AND verified', [payload.sub]);
    if (!rows[0]) throw new HttpError(401, 'Please verify your phone number again.');
    return { kind: 'customer', role: 'customer', aud: payload.aud, ...rows[0] };
  }

  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.status, r.name AS role, p.id AS provider_id
       FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN providers p ON p.user_id = u.id
      WHERE u.id = $1`, [payload.sub]);
  const u = rows[0];
  if (!u || u.status !== 'active') throw new HttpError(401, 'This account is not active.');
  // If a security admin changed the role after login, the old token stops working.
  if (u.role !== payload.role) throw new HttpError(401, 'Your access changed. Please log in again.');
  return { kind: 'user', role: u.role, aud: payload.aud, id: u.id, name: u.name, email: u.email, providerId: u.provider_id };
}

const authenticate = (audience = 'main') => asyncHandler(async (req, res, next) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Please log in first.');
  req.actor = await resolveActor(token, audience);
  next();
});

const requireRole = (...roles) => asyncHandler(async (req, res, next) => {
  if (!roles.includes(req.actor.role)) {
    await logSecurity({ userId: req.actor.kind === 'user' ? req.actor.id : null, role: req.actor.role, event: 'access_denied', severity: 'warning', req, details: { path: req.originalUrl, needed: roles } });
    throw new HttpError(403, 'You do not have access to this area.');
  }
  next();
});

// ---- read / write permission matrix, edited in the security portal ----
let permCache = { at: 0, map: new Map() };
async function loadPermissions() {
  if (Date.now() - permCache.at < 15000) return permCache.map;
  const { rows } = await query(
    `SELECT r.name AS role, m.code AS module, rp.can_read, rp.can_write
       FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN modules m ON m.id = rp.module_id`);
  permCache = { at: Date.now(), map: new Map(rows.map((x) => [`${x.role}:${x.module}`, x])) };
  return permCache.map;
}
const clearPermissionCache = () => { permCache.at = 0; };

const requirePermission = (moduleCode, mode = 'read') => asyncHandler(async (req, res, next) => {
  const entry = (await loadPermissions()).get(`${req.actor.role}:${moduleCode}`);
  const allowed = entry && (mode === 'write' ? entry.can_write : entry.can_read);
  if (!allowed) {
    await logSecurity({ userId: req.actor.kind === 'user' ? req.actor.id : null, role: req.actor.role, event: 'permission_denied', severity: 'warning', req, details: { module: moduleCode, mode } });
    throw new HttpError(403, `Your role does not have ${mode} access to this module.`);
  }
  next();
});

module.exports = { signToken, resolveActor, authenticate, requireRole, requirePermission, clearPermissionCache };
