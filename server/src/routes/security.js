// Security administration. This is the "security configuration module with a different domain":
// it uses its own login, its own token audience ("security") and is meant to run on its own address.
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { query, tx } = require('../db');
const { asyncHandler, HttpError, clearPolicyCache, logActivity, logSecurity } = require('../utils/helpers');
const { authenticate, requireRole, requirePermission, clearPermissionCache } = require('../middleware/auth');
const { loginUser } = require('../utils/login');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { token, user } = await loginUser(req, { allowedRoles: ['security_admin'], aud: 'security' });
  res.json({ token, user });
}));

router.use(authenticate('security'), requireRole('security_admin'));
const read = requirePermission('security_administration', 'read');
const write = requirePermission('security_administration', 'write');

router.get('/me', asyncHandler(async (req, res) => res.json({ user: { id: req.actor.id, name: req.actor.name, email: req.actor.email, role: req.actor.role } })));

// ---------- overview and suspicious activity ----------
router.get('/overview', read, asyncHandler(async (req, res) => {
  const [counts, locked, suspicious, latest] = await Promise.all([
    query(`SELECT count(*) FILTER (WHERE event_type = 'login_failed')::int AS failed_logins,
                  count(*) FILTER (WHERE event_type IN ('access_denied','permission_denied','conversation_access_denied','request_access_denied'))::int AS access_denied,
                  count(*) FILTER (WHERE event_type = 'report_viewed')::int AS reports_viewed,
                  count(*) FILTER (WHERE severity = 'critical')::int AS critical
             FROM security_logs WHERE created_at > now() - interval '24 hours'`),
    query('SELECT count(*)::int AS n FROM users WHERE locked_until > now()'),
    query(`SELECT ip_address, count(*)::int AS attempts FROM security_logs
            WHERE event_type IN ('login_failed','otp_failed') AND created_at > now() - interval '1 hour' AND ip_address IS NOT NULL
            GROUP BY ip_address HAVING count(*) >= 5 ORDER BY attempts DESC LIMIT 10`),
    query(`SELECT l.event_type, l.severity, l.created_at, l.ip_address FROM security_logs l WHERE l.severity <> 'info' ORDER BY l.created_at DESC LIMIT 8`),
  ]);
  res.json({ last_24h: counts.rows[0], locked_accounts: locked.rows[0].n, suspicious_ips: suspicious.rows, latest_alerts: latest.rows });
}));

// ---------- roles, modules and the read / write matrix ----------
router.get('/matrix', read, asyncHandler(async (req, res) => {
  const [roles, modules, perms] = await Promise.all([
    query('SELECT id, name, description, is_registered FROM roles ORDER BY id'),
    query('SELECT id, code, name FROM modules ORDER BY id'),
    query('SELECT role_id, module_id, can_read, can_write FROM role_permissions'),
  ]);
  res.json({ roles: roles.rows, modules: modules.rows, permissions: perms.rows });
}));

router.put('/permissions', write, asyncHandler(async (req, res) => {
  const b = z.object({ role_id: z.coerce.number().int(), module_id: z.coerce.number().int(), can_read: z.boolean(), can_write: z.boolean() }).parse(req.body);
  const info = await query('SELECT r.name AS role, m.code AS module FROM roles r, modules m WHERE r.id = $1 AND m.id = $2', [b.role_id, b.module_id]);
  if (!info.rows[0]) throw new HttpError(404, 'Role or module not found.');
  if (info.rows[0].role === 'security_admin' && info.rows[0].module === 'security_administration' && !(b.can_read && b.can_write)) {
    throw new HttpError(409, 'The security admin must always keep read and write access to security administration, or nobody could fix permissions.');
  }
  const can_read = b.can_write ? true : b.can_read;   // writing needs reading
  await query(
    `INSERT INTO role_permissions (role_id, module_id, can_read, can_write) VALUES ($1,$2,$3,$4)
     ON CONFLICT (role_id, module_id) DO UPDATE SET can_read = $3, can_write = $4, updated_at = now()`, [b.role_id, b.module_id, can_read, b.can_write]);
  clearPermissionCache();
  await logActivity({ userId: req.actor.id, role: 'security_admin', action: 'permission_changed', entity: 'role_permission', entityId: `${info.rows[0].role}:${info.rows[0].module}`, details: { can_read, can_write: b.can_write } });
  await logSecurity({ userId: req.actor.id, role: 'security_admin', event: 'permission_changed', severity: 'warning', req, details: { role: info.rows[0].role, module: info.rows[0].module, can_read, can_write: b.can_write } });
  res.json({ ...b, can_read });
}));

// ---------- accounts ----------
router.get('/users', read, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, r.name AS role, u.status, u.failed_logins, (u.locked_until > now()) AS locked, u.last_login_at, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id ORDER BY r.id DESC, u.created_at DESC LIMIT 300`);
  res.json(rows);
}));

router.post('/users', write, asyncHandler(async (req, res) => {
  const b = z.object({
    name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(160),
    password: z.string().min(10, 'Use at least 10 characters').regex(/[A-Za-z]/).regex(/[0-9]/), role: z.enum(['admin', 'security_admin']),
  }).parse(req.body);
  const exists = await query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [b.email]);
  if (exists.rows[0]) throw new HttpError(409, 'An account with this email already exists.');
  const role = await query('SELECT id FROM roles WHERE name = $1', [b.role]);
  const { rows } = await query('INSERT INTO users (name, email, password_hash, role_id) VALUES ($1,$2,$3,$4) RETURNING id, name, email',
    [b.name, b.email, await bcrypt.hash(b.password, 12), role.rows[0].id]);
  await logActivity({ userId: req.actor.id, role: 'security_admin', action: 'staff_account_created', entity: 'user', entityId: rows[0].id, details: { role: b.role } });
  await logSecurity({ userId: req.actor.id, role: 'security_admin', event: 'staff_account_created', severity: 'warning', req, details: { newUser: rows[0].id, role: b.role } });
  res.status(201).json({ ...rows[0], role: b.role });
}));

router.patch('/users/:id', write, asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  if (id === req.actor.id) throw new HttpError(409, 'You cannot change your own account here.');
  const b = z.object({ role: z.enum(['admin', 'security_admin']).optional(), status: z.enum(['active', 'suspended', 'disabled']).optional(), unlock: z.boolean().optional() }).parse(req.body);
  await tx(async (c) => {
    const u = (await c.query('SELECT u.id, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 FOR UPDATE OF u', [id])).rows[0];
    if (!u) throw new HttpError(404, 'User not found.');
    if (b.role) {
      if (u.role === 'provider') throw new HttpError(409, 'A provider account cannot be changed into a staff role.');
      await c.query('UPDATE users SET role_id = (SELECT id FROM roles WHERE name = $1) WHERE id = $2', [b.role, id]);
    }
    if (b.status) {
      await c.query('UPDATE users SET status = $1 WHERE id = $2', [b.status, id]);
      if (u.role === 'provider') await c.query('UPDATE providers SET status = $1 WHERE user_id = $2', [b.status === 'active' ? 'active' : 'suspended', id]);
    }
    if (b.unlock) await c.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [id]);
    await logActivity({ userId: req.actor.id, role: 'security_admin', action: 'account_changed', entity: 'user', entityId: id, details: b }, c);
  });
  await logSecurity({ userId: req.actor.id, role: 'security_admin', event: 'account_changed', severity: 'warning', req, details: { target: id, ...b } });
  res.json({ id, ...b });
}));

// ---------- security log ----------
router.get('/logs', read, asyncHandler(async (req, res) => {
  const f = z.object({ severity: z.enum(['info', 'warning', 'critical']).optional(), event: z.string().max(60).optional() }).parse(req.query);
  const { rows } = await query(
    `SELECT l.id, l.event_type, l.severity, l.actor_role, l.ip_address, l.details, l.created_at, u.email AS user_email
       FROM security_logs l LEFT JOIN users u ON u.id = l.user_id
      WHERE ($1::text IS NULL OR l.severity = $1) AND ($2::text IS NULL OR l.event_type = $2)
      ORDER BY l.created_at DESC LIMIT 200`, [f.severity || null, f.event || null]);
  res.json(rows);
}));

// ---------- security policies ----------
router.get('/policies', read, asyncHandler(async (req, res) => {
  res.json((await query('SELECT key, value, description, updated_at FROM security_policies ORDER BY key')).rows);
}));

router.put('/policies/:key', write, asyncHandler(async (req, res) => {
  const key = z.string().max(60).parse(req.params.key);
  const { value } = z.object({ value: z.coerce.number().int().min(1).max(3650) }).parse(req.body);
  const { rows } = await query('UPDATE security_policies SET value = $1, updated_by = $2, updated_at = now() WHERE key = $3 RETURNING key, value', [String(value), req.actor.id, key]);
  if (!rows[0]) throw new HttpError(404, 'Policy not found.');
  clearPolicyCache();
  await logActivity({ userId: req.actor.id, role: 'security_admin', action: 'policy_changed', entity: 'policy', entityId: key, details: { value } });
  await logSecurity({ userId: req.actor.id, role: 'security_admin', event: 'policy_changed', req, details: { key, value } });
  res.json(rows[0]);
}));

module.exports = router;
