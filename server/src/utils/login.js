const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query } = require('../db');
const { HttpError, policyInt, logSecurity } = require('./helpers');
const { signToken } = require('../middleware/auth');

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);   // keeps timing the same for unknown emails
const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

async function loginUser(req, { allowedRoles, aud }) {
  const { email, password } = schema.parse(req.body);
  const { rows } = await query(
    `SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE lower(u.email) = lower($1)`, [email]);
  const u = rows[0];

  if (!u) {
    await bcrypt.compare(password, DUMMY_HASH);
    await logSecurity({ event: 'login_failed', severity: 'warning', req, details: { email, reason: 'unknown email' } });
    throw new HttpError(401, 'Wrong email or password.');
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    await logSecurity({ userId: u.id, role: u.role, event: 'login_blocked_locked', severity: 'warning', req });
    throw new HttpError(423, 'This account is locked for a short time after too many wrong passwords. Try again later.');
  }

  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) {
    const max = await policyInt('max_login_attempts', 5);
    const lockMinutes = await policyInt('lockout_minutes', 15);
    const failed = u.failed_logins + 1;
    const lock = failed >= max;
    await query('UPDATE users SET failed_logins = $1, locked_until = $2 WHERE id = $3',
      [lock ? 0 : failed, lock ? new Date(Date.now() + lockMinutes * 60000) : null, u.id]);
    await logSecurity({ userId: u.id, role: u.role, event: lock ? 'account_locked' : 'login_failed', severity: lock ? 'critical' : 'warning', req, details: { failed } });
    throw new HttpError(401, 'Wrong email or password.');
  }
  if (!allowedRoles.includes(u.role)) {
    await logSecurity({ userId: u.id, role: u.role, event: 'login_wrong_portal', severity: 'warning', req });
    throw new HttpError(401, 'Wrong email or password.');   // same message: do not reveal that the account exists
  }
  if (u.status !== 'active') throw new HttpError(403, 'This account is suspended. Please contact support.');

  await query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
  await logSecurity({ userId: u.id, role: u.role, event: 'login_success', req });
  return { token: signToken({ sub: u.id, role: u.role, aud }), user: { id: u.id, name: u.name, email: u.email, role: u.role } };
}

module.exports = { loginUser };
