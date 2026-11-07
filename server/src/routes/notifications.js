const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { asyncHandler } = require('../utils/helpers');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate('main'), requirePermission('notifications', 'read'));

const kind = (req) => (req.actor.role === 'customer' ? 'customer' : 'user');

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT id, type, message, link, read_at, created_at FROM notifications WHERE recipient_kind = $1 AND recipient_id = $2 ORDER BY created_at DESC LIMIT 50',
    [kind(req), req.actor.id]);
  res.json({ items: rows, unread: rows.filter((n) => !n.read_at).length });
}));

router.post('/read-all', requirePermission('notifications', 'write'), asyncHandler(async (req, res) => {
  await query('UPDATE notifications SET read_at = now() WHERE recipient_kind = $1 AND recipient_id = $2 AND read_at IS NULL', [kind(req), req.actor.id]);
  res.json({ ok: true });
}));

router.post('/:id/read', requirePermission('notifications', 'write'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  await query('UPDATE notifications SET read_at = now() WHERE id = $1 AND recipient_kind = $2 AND recipient_id = $3', [id, kind(req), req.actor.id]);
  res.json({ ok: true });
}));

module.exports = router;
