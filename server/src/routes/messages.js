const express = require('express');
const path = require('path');
const { z } = require('zod');
const { query, tx } = require('../db');
const { asyncHandler, HttpError, policyInt, logActivity, logSecurity, notify } = require('../utils/helpers');
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/crypto');
const { messageUpload, removeFiles } = require('../utils/uploads');
const { updateConversationExpiry } = require('../utils/retention');
const realtime = require('../realtime');

const router = express.Router();
router.use(authenticate('main'), requireRole('customer', 'provider'), requirePermission('messaging', 'read'));

// Loads a conversation ONLY if the logged in person is one of its two members.
async function loadConversation(req, id) {
  const mine = req.actor.role === 'customer' ? 'c.customer_id = $2' : 'p.user_id = $2';
  const { rows } = await query(
    `SELECT c.*, ci.name AS customer_name, p.business_name, p.profile_image, p.user_id AS provider_user_id
       FROM conversations c JOIN customer_identities ci ON ci.id = c.customer_id JOIN providers p ON p.id = c.provider_id
      WHERE c.id = $1 AND ${mine}`, [id, req.actor.id]);
  if (!rows[0]) {
    const exists = await query('SELECT 1 FROM conversations WHERE id = $1', [id]);
    if (exists.rows[0]) await logSecurity({ userId: req.actor.kind === 'user' ? req.actor.id : null, role: req.actor.role, event: 'conversation_access_denied', severity: 'warning', req, details: { conversationId: id } });
    throw new HttpError(404, 'Conversation not found.');
  }
  return rows[0];
}

const format = (m) => ({
  id: m.id, conversation_id: m.conversation_id, sender_role: m.sender_role, text: decrypt(m.content_enc),
  sent_at: m.sent_at, read_at: m.read_at, attachments: m.attachments || [],
});

// ---- start (or reopen) a conversation with a provider ----
router.post('/', requireRole('customer'), requirePermission('messaging', 'write'), asyncHandler(async (req, res) => {
  const { provider_id } = z.object({ provider_id: z.string().uuid() }).parse(req.body);
  const p = await query("SELECT p.id FROM providers p JOIN users u ON u.id = p.user_id WHERE p.id = $1 AND p.status = 'active' AND u.status = 'active'", [provider_id]);
  if (!p.rows[0]) throw new HttpError(404, 'Provider not found.');
  const { rows } = await query(
    'INSERT INTO conversations (customer_id, provider_id) VALUES ($1,$2) ON CONFLICT (customer_id, provider_id) DO UPDATE SET status = conversations.status RETURNING id',
    [req.actor.id, provider_id]);
  // Earlier requests to this provider that had no chat yet are now linked to it.
  await query('UPDATE service_requests SET conversation_id = $1 WHERE customer_id = $2 AND provider_id = $3 AND conversation_id IS NULL', [rows[0].id, req.actor.id, provider_id]);
  await updateConversationExpiry(rows[0].id);
  res.status(201).json({ id: rows[0].id });
}));

// ---- inbox ----
router.get('/', asyncHandler(async (req, res) => {
  const isCustomer = req.actor.role === 'customer';
  const owner = isCustomer ? req.actor.id : req.actor.providerId;
  const { rows } = await query(
    `SELECT c.id, c.last_message_at, ci.name AS customer_name, p.business_name, p.profile_image,
            lm.content_enc, lm.has_image, lm.sender_role AS last_sender,
            (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.sender_role <> $2 AND m.read_at IS NULL) AS unread
       FROM conversations c
       JOIN customer_identities ci ON ci.id = c.customer_id
       JOIN providers p ON p.id = c.provider_id
       LEFT JOIN LATERAL (SELECT m.content_enc, m.sender_role, EXISTS (SELECT 1 FROM message_attachments a WHERE a.message_id = m.id) AS has_image
                            FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC LIMIT 1) lm ON TRUE
      WHERE ${isCustomer ? 'c.customer_id' : 'c.provider_id'} = $1
      ORDER BY c.last_message_at DESC LIMIT 100`, [owner, req.actor.role]);
  res.json(rows.map((r) => {
    const text = decrypt(r.content_enc);
    return {
      id: r.id, last_message_at: r.last_message_at, unread: r.unread, last_sender: r.last_sender,
      other_name: isCustomer ? r.business_name : r.customer_name, other_image: isCustomer ? r.profile_image : null,
      preview: r.last_sender ? (text ? text.slice(0, 70) : r.has_image ? 'Photo' : '') : 'No messages yet',
    };
  }));
}));

// ---- one conversation with its messages ----
router.get('/:id/messages', asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const c = await loadConversation(req, id);
  const { rows } = await query(
    `SELECT m.*, (SELECT COALESCE(json_agg(json_build_object('id', a.id, 'file_type', a.file_type, 'name', a.original_name)), '[]'::json)
                    FROM message_attachments a WHERE a.message_id = m.id) AS attachments
       FROM messages m WHERE m.conversation_id = $1 ORDER BY m.sent_at ASC LIMIT 300`, [id]);
  const rq = await query('SELECT id, reference_number, status FROM service_requests WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1', [id]);
  const isCustomer = req.actor.role === 'customer';
  res.json({
    conversation: {
      id: c.id, status: c.status, provider_id: c.provider_id,
      other_name: isCustomer ? c.business_name : c.customer_name, other_image: isCustomer ? c.profile_image : null,
      request: rq.rows[0] || null,
    },
    messages: rows.map(format),
  });
}));

// ---- send a message (text and/or one photo) ----
router.post('/:id/messages', requirePermission('messaging', 'write'), messageUpload.single('image'), asyncHandler(async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const c = await loadConversation(req, id);
    if (c.status !== 'open') throw new HttpError(409, 'This conversation is closed.');
    const text = z.string().trim().max(2000).optional().parse(req.body.text);
    if (!text && !req.file) throw new HttpError(400, 'Write a message or attach a photo.');

    const msg = await tx(async (cl) => {
      const m = (await cl.query('INSERT INTO messages (conversation_id, sender_role, sender_id, content_enc) VALUES ($1,$2,$3,$4) RETURNING *',
        [id, req.actor.role, req.actor.id, encrypt(text)])).rows[0];
      m.attachments = [];
      if (req.file) {
        const a = (await cl.query(
          'INSERT INTO message_attachments (message_id, file_path, original_name, file_type, size_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id, file_type, original_name AS name',
          [m.id, req.file.path, (req.file.originalname || 'photo').slice(0, 200), req.file.mimetype, req.file.size])).rows[0];
        m.attachments.push(a);
      }
      await cl.query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [id]);
      await updateConversationExpiry(id, cl);
      return m;
    });

    const out = format(msg);
    realtime.emitTo(`conv:${id}`, 'message:new', out);

    // Notify the other person (one unread notification per conversation, so the bell is not flooded).
    const toCustomer = req.actor.role === 'provider';
    const kind = toCustomer ? 'customer' : 'user';
    const recipient = toCustomer ? c.customer_id : c.provider_user_id;
    const link = toCustomer ? `/messages/${id}` : `/provider/messages/${id}`;
    const dup = await query('SELECT 1 FROM notifications WHERE recipient_kind = $1 AND recipient_id = $2 AND type = $3 AND link = $4 AND read_at IS NULL', [kind, recipient, 'new_message', link]);
    if (!dup.rows[0]) await notify(kind, recipient, 'new_message', `New message from ${toCustomer ? c.business_name : c.customer_name}`, link);
    realtime.emitTo(`${kind}:${recipient}`, 'inbox:updated', { conversation_id: id });
    res.status(201).json(out);
  } catch (e) {
    if (req.file) removeFiles([req.file.path]);   // do not keep a photo if the message was refused
    throw e;
  }
}));

// ---- mark the other person's messages as read ----
router.post('/:id/read', asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  await loadConversation(req, id);
  const r = await query('UPDATE messages SET read_at = now() WHERE conversation_id = $1 AND sender_role <> $2 AND read_at IS NULL RETURNING id', [id, req.actor.role]);
  await query(`UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL AND link LIKE '%' || $2`, [req.actor.id, `/messages/${id}`]);
  if (r.rowCount) realtime.emitTo(`conv:${id}`, 'message:read', { conversation_id: id, reader_role: req.actor.role });
  res.json({ read: r.rowCount });
}));

// ---- photo in a chat: only the two members can open it ----
router.get('/attachments/:id', asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { rows } = await query(
    `SELECT a.file_path, a.file_type, m.conversation_id FROM message_attachments a JOIN messages m ON m.id = a.message_id WHERE a.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'File not found.');
  await loadConversation(req, rows[0].conversation_id);   // throws unless this person is a member
  res.set({ 'Content-Type': rows[0].file_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(path.resolve(rows[0].file_path));
}));

// ---- report a conversation: saves a snapshot of the reported messages for admins ----
router.post('/:id/report', requirePermission('message_reports', 'write'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const b = z.object({ reason: z.string().trim().min(5, 'Tell us what is wrong').max(500), message_ids: z.array(z.string().uuid()).max(10).optional() }).parse(req.body);
  await loadConversation(req, id);

  const open = await query("SELECT 1 FROM message_reports WHERE conversation_id = $1 AND reporter_id = $2 AND status = 'open'", [id, req.actor.id]);
  if (open.rows[0]) throw new HttpError(409, 'You already reported this conversation. We are reviewing it.');

  const all = (await query(
    `SELECT m.id, m.sender_role, m.content_enc, m.sent_at, EXISTS (SELECT 1 FROM message_attachments a WHERE a.message_id = m.id) AS has_image
       FROM messages m WHERE m.conversation_id = $1 ORDER BY m.sent_at ASC`, [id])).rows;
  if (!all.length) throw new HttpError(400, 'There are no messages to report yet.');

  let reported = new Set(b.message_ids && b.message_ids.length ? b.message_ids.filter((x) => all.some((m) => m.id === x)) : []);
  if (!reported.size) all.filter((m) => m.sender_role !== req.actor.role).slice(-10).forEach((m) => reported.add(m.id));   // no choice made: last 10 from the other person
  if (!reported.size) all.slice(-10).forEach((m) => reported.add(m.id));

  const ctx = await policyInt('report_context_messages', 3);
  const keep = new Set();
  all.forEach((m, i) => { if (reported.has(m.id)) for (let j = Math.max(0, i - ctx); j <= Math.min(all.length - 1, i + ctx); j++) keep.add(j); });

  const reportId = await tx(async (c) => {
    const r = (await c.query('INSERT INTO message_reports (conversation_id, reporter_role, reporter_id, reason) VALUES ($1,$2,$3,$4) RETURNING id', [id, req.actor.role, req.actor.id, b.reason])).rows[0];
    for (const i of [...keep].sort((a, z) => a - z)) {
      const m = all[i];
      await c.query('INSERT INTO report_snapshots (report_id, sender_role, content_enc, has_image, sent_at, is_reported) VALUES ($1,$2,$3,$4,$5,$6)',
        [r.id, m.sender_role, m.content_enc, m.has_image, m.sent_at, reported.has(m.id)]);
    }
    await logActivity({ userId: req.actor.kind === 'user' ? req.actor.id : null, role: req.actor.role, action: 'conversation_reported', entity: 'report', entityId: r.id }, c);
    return r.id;
  });
  await logSecurity({ userId: req.actor.kind === 'user' ? req.actor.id : null, role: req.actor.role, event: 'conversation_reported', severity: 'warning', req, details: { reportId } });
  const admins = await query("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.status = 'active'");
  for (const a of admins.rows) await notify('user', a.id, 'report', 'A conversation was reported and needs review.', '/admin/reports');
  res.status(201).json({ id: reportId });
}));

// ---- customer deletes a conversation (right to erasure) ----
router.delete('/:id', requireRole('customer'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  await loadConversation(req, id);
  const open = await query("SELECT 1 FROM message_reports WHERE conversation_id = $1 AND status = 'open'", [id]);
  if (open.rows[0]) throw new HttpError(409, 'This conversation was reported and is being reviewed. You can delete it after the review.');
  const files = await query('SELECT a.file_path FROM message_attachments a JOIN messages m ON m.id = a.message_id WHERE m.conversation_id = $1', [id]);
  await tx(async (c) => {
    await c.query('DELETE FROM conversations WHERE id = $1', [id]);
    await logActivity({ role: 'customer', action: 'conversation_deleted_by_customer', entity: 'conversation', entityId: id }, c);
  });
  removeFiles(files.rows.map((f) => f.file_path));
  res.json({ deleted: true });
}));

module.exports = router;
