const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const { z } = require('zod');
const { query, tx } = require('../db');
const config = require('../config');
const { asyncHandler, HttpError, policyInt, logActivity, logSecurity, normalizePhone } = require('../utils/helpers');
const { authenticate, requireRole, signToken } = require('../middleware/auth');
const { hmac, randomCode, safeEqual } = require('../utils/crypto');
const { sendOtp } = require('../utils/sms');
const { removeFiles } = require('../utils/uploads');

const router = express.Router();
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many code requests. Please wait a few minutes.' } });
const PHONE = /^\+?[0-9]{8,15}$/;

// Step 1: customer gives name and phone. We send a 6 digit code.
router.post('/otp/request', otpLimiter, asyncHandler(async (req, res) => {
  const body = z.object({ name: z.string().trim().min(2).max(120), phone: z.string() }).parse(req.body);
  const phone = normalizePhone(body.phone);
  if (!PHONE.test(phone)) throw new HttpError(400, 'Enter a valid phone number, for example +26658001234.');

  const last = await query('SELECT created_at FROM otp_codes WHERE phone = $1 ORDER BY created_at DESC LIMIT 1', [phone]);
  if (last.rows[0] && Date.now() - new Date(last.rows[0].created_at).getTime() < 30000) throw new HttpError(429, 'Please wait 30 seconds before asking for a new code.');

  // A verified customer keeps the name they first used, so nobody can rename them.
  await query(
    `INSERT INTO customer_identities (name, phone) VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET name = CASE WHEN customer_identities.verified THEN customer_identities.name ELSE EXCLUDED.name END`,
    [body.name, phone]);

  const code = randomCode();
  const ttl = await policyInt('otp_ttl_minutes', 5);
  await query('UPDATE otp_codes SET consumed = TRUE WHERE phone = $1 AND NOT consumed', [phone]);
  await query('INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1,$2,$3)', [phone, hmac(phone + ':' + code), new Date(Date.now() + ttl * 60000)]);
  await sendOtp(phone, code);
  res.json({ sent: true, phone, ...(config.otpMode === 'mock' ? { devOtp: code } : {}) });
}));

// Step 2: customer sends the code back. We give a temporary token.
router.post('/otp/verify', otpLimiter, asyncHandler(async (req, res) => {
  const body = z.object({ phone: z.string(), code: z.string().regex(/^[0-9]{6}$/, 'Enter the 6 digit code') }).parse(req.body);
  const phone = normalizePhone(body.phone);
  const { rows } = await query('SELECT * FROM otp_codes WHERE phone = $1 AND NOT consumed ORDER BY created_at DESC LIMIT 1', [phone]);
  const otp = rows[0];
  if (!otp || new Date(otp.expires_at) < new Date()) throw new HttpError(400, 'This code has expired. Ask for a new one.');
  const maxTries = await policyInt('otp_max_attempts', 5);
  if (otp.attempts >= maxTries) throw new HttpError(429, 'Too many wrong codes. Ask for a new one.');

  if (!safeEqual(otp.code_hash, hmac(phone + ':' + body.code))) {
    await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    await logSecurity({ event: 'otp_failed', severity: 'warning', req, details: { phone } });
    throw new HttpError(400, 'That code is not correct.');
  }
  await query('UPDATE otp_codes SET consumed = TRUE WHERE id = $1', [otp.id]);
  const { rows: ids } = await query('UPDATE customer_identities SET verified = TRUE, last_verified_at = now() WHERE phone = $1 RETURNING id, name, phone', [phone]);
  if (!ids[0]) throw new HttpError(400, 'Start again from the beginning.');
  await logSecurity({ event: 'otp_verified', req, details: { customerId: ids[0].id } });
  res.json({ token: signToken({ sub: ids[0].id, role: 'customer', aud: 'main' }), customer: ids[0] });
}));

router.get('/me', authenticate('main'), requireRole('customer'), asyncHandler(async (req, res) => {
  res.json({ customer: { id: req.actor.id, name: req.actor.name, phone: req.actor.phone } });
}));

// Customer asks us to erase their data (GDPR right to erasure).
router.delete('/data', authenticate('main'), requireRole('customer'), asyncHandler(async (req, res) => {
  const id = req.actor.id;
  const open = await query(
    `SELECT 1 FROM message_reports WHERE status = 'open'
       AND (reporter_id = $1 OR conversation_id IN (SELECT id FROM conversations WHERE customer_id = $1)) LIMIT 1`, [id]);
  if (open.rows[0]) throw new HttpError(409, 'A report about one of your chats is still being reviewed. You can delete your data once it is resolved.');

  const files = await query(
    `SELECT ma.file_path FROM message_attachments ma JOIN messages m ON m.id = ma.message_id JOIN conversations c ON c.id = m.conversation_id WHERE c.customer_id = $1
     UNION ALL SELECT ra.file_path FROM request_attachments ra JOIN service_requests r ON r.id = ra.request_id WHERE r.customer_id = $1`, [id]);

  await tx(async (c) => {
    await c.query('DELETE FROM conversations WHERE customer_id = $1', [id]);
    await c.query('DELETE FROM request_attachments WHERE request_id IN (SELECT id FROM service_requests WHERE customer_id = $1)', [id]);
    await c.query("DELETE FROM notifications WHERE recipient_kind = 'customer' AND recipient_id = $1", [id]);
    await c.query('DELETE FROM otp_codes WHERE phone = $1', [req.actor.phone]);
    // Requests stay for the provider's records, but they no longer point to a real person.
    await c.query("UPDATE customer_identities SET name = 'Deleted customer', phone = 'deleted-' || replace(id::text, '-', ''), verified = FALSE WHERE id = $1", [id]);
    await logActivity({ role: 'customer', action: 'customer_data_erased', entity: 'customer', entityId: id }, c);
  });
  removeFiles(files.rows.map((f) => f.file_path));
  res.json({ deleted: true });
}));

module.exports = router;
