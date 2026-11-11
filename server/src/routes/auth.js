const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, tx } = require('../db');
const { asyncHandler, HttpError, logActivity, logSecurity, normalizePhone } = require('../utils/helpers');
const { authenticate, signToken } = require('../middleware/auth');
const { loginUser } = require('../utils/login');

const router = express.Router();

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100)
    .regex(/[A-Za-z]/, 'Password needs at least one letter').regex(/[0-9]/, 'Password needs at least one number'),
  phone: z.string().trim().min(8).max(30),
  business_name: z.string().trim().min(2).max(160).optional(),
});

router.post('/register-provider', asyncHandler(async (req, res) => {
  const b = registerSchema.parse(req.body);
  const exists = await query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [b.email]);
  if (exists.rows[0]) throw new HttpError(409, 'An account with this email already exists.');

  const hash = await bcrypt.hash(b.password, 12);
  const result = await tx(async (c) => {
    const role = await c.query("SELECT id FROM roles WHERE name = 'provider'");
    const u = await c.query('INSERT INTO users (name, email, password_hash, role_id) VALUES ($1,$2,$3,$4) RETURNING id, name, email',
      [b.name, b.email, hash, role.rows[0].id]);
    const p = await c.query('INSERT INTO providers (user_id, business_name, phone) VALUES ($1,$2,$3) RETURNING id',
      [u.rows[0].id, b.business_name || b.name, normalizePhone(b.phone)]);
    await logActivity({ userId: u.rows[0].id, role: 'provider', action: 'provider_registered', entity: 'provider', entityId: p.rows[0].id }, c);
    return { user: { ...u.rows[0], role: 'provider' } };
  });
  await logSecurity({ userId: result.user.id, role: 'provider', event: 'provider_registered', req });
  res.status(201).json({ token: signToken({ sub: result.user.id, role: 'provider', aud: 'main' }), user: result.user });
}));

router.post('/login', asyncHandler(async (req, res) => {
  // Allow security_admin to login here
  const { token, user } = await loginUser(req, { allowedRoles: ['provider', 'admin', 'security_admin'], aud: 'main' });
  res.json({ token, user });
}));

router.get('/me', authenticate('main'), asyncHandler(async (req, res) => {
  const a = req.actor;
  res.json({ user: { id: a.id, name: a.name, role: a.role, email: a.email, phone: a.phone, providerId: a.providerId } });
}));

module.exports = router;