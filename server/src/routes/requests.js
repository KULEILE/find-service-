const express = require('express');
const path = require('path');
const { z } = require('zod');
const { query, tx } = require('../db');
const { asyncHandler, HttpError, generateReference, notify, logActivity, logSecurity } = require('../utils/helpers');
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { requestUpload } = require('../utils/uploads');
const { anchor, requestPayload, statusPayload, reviewPayload } = require('../utils/ledger');
const { updateConversationExpiry } = require('../utils/retention');
const { changeStatus } = require('../utils/requestService');

const router = express.Router();

const createSchema = z.object({
  provider_id: z.string().uuid(),
  service_id: z.string().uuid(),
  description: z.string().trim().min(5, 'Describe the work in a few words').max(1500),
  location: z.string().trim().min(2).max(160),
  preferred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  preferred_time: z.string().max(20).optional().or(z.literal('')),
});

// ---------- customer: create a request ----------
router.post('/', authenticate('main'), requireRole('customer'), requirePermission('service_requests', 'write'),
  requestUpload.array('images', 3),
  asyncHandler(async (req, res) => {
    const b = createSchema.parse(req.body);
    const svc = await query(
      `SELECT s.id, s.name, p.user_id AS provider_user_id FROM services s JOIN providers p ON p.id = s.provider_id JOIN users u ON u.id = p.user_id
        WHERE s.id = $1 AND s.provider_id = $2 AND s.is_active AND p.status = 'active' AND u.status = 'active'`, [b.service_id, b.provider_id]);
    if (!svc.rows[0]) throw new HttpError(404, 'That service is no longer available.');

    const conv = await query('SELECT id FROM conversations WHERE customer_id = $1 AND provider_id = $2', [req.actor.id, b.provider_id]);
    const conversationId = conv.rows[0] ? conv.rows[0].id : null;

    let created;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      try {
        created = await tx(async (c) => {
          const r = (await c.query(
            `INSERT INTO service_requests (reference_number, customer_id, provider_id, service_id, conversation_id, description, location, preferred_date, preferred_time)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [generateReference(), req.actor.id, b.provider_id, b.service_id, conversationId, b.description, b.location, b.preferred_date || null, b.preferred_time || null])).rows[0];
          await anchor(c, 'service_request', r.id, requestPayload(r), 'service_requests');
          const h = (await c.query(
            "INSERT INTO request_status_history (request_id, old_status, new_status, changed_by_role, changed_by_id) VALUES ($1,NULL,'pending','customer',$2) RETURNING *", [r.id, req.actor.id])).rows[0];
          await anchor(c, 'request_status', h.id, statusPayload(h), 'request_status_history');
          for (const f of req.files || []) {
            await c.query('INSERT INTO request_attachments (request_id, file_path, file_type) VALUES ($1,$2,$3)', [r.id, f.path, f.mimetype]);
          }
          if (conversationId) await updateConversationExpiry(conversationId, c);
          await logActivity({ role: 'customer', action: 'request_created', entity: 'service_request', entityId: r.id }, c);
          return r;
        });
      } catch (e) { if (e.code !== '23505') throw e; }   // reference clash: try a new one
    }
    if (!created) throw new HttpError(500, 'Could not create the request. Please try again.');

    await notify('user', svc.rows[0].provider_user_id, 'new_request', `New request ${created.reference_number}: ${svc.rows[0].name}`, `/provider/requests/${created.id}`);
    res.status(201).json({ id: created.id, reference_number: created.reference_number, status: created.status });
  }));

// ---------- customer: list and track ----------
router.get('/', authenticate('main'), requireRole('customer'), requirePermission('service_requests', 'read'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.reference_number, r.status, r.created_at, r.preferred_date, p.business_name, s.name AS service_name
       FROM service_requests r JOIN providers p ON p.id = r.provider_id LEFT JOIN services s ON s.id = r.service_id
      WHERE r.customer_id = $1 ORDER BY r.created_at DESC LIMIT 100`, [req.actor.id]);
  res.json(rows);
}));

router.get('/track/:ref', authenticate('main'), requireRole('customer'), requirePermission('service_requests', 'read'), asyncHandler(async (req, res) => {
  const ref = String(req.params.ref).trim().toUpperCase();
  const { rows } = await query(
    `SELECT r.*, p.business_name, p.phone AS provider_phone, s.name AS service_name,
            (SELECT json_agg(json_build_object('id', a.id)) FROM request_attachments a WHERE a.request_id = r.id) AS attachments
       FROM service_requests r JOIN providers p ON p.id = r.provider_id LEFT JOIN services s ON s.id = r.service_id
      WHERE r.reference_number = $1`, [ref]);
  const r = rows[0];
  if (!r) throw new HttpError(404, 'No request found with that reference number.');
  if (r.customer_id !== req.actor.id) {
    await logSecurity({ role: 'customer', event: 'request_access_denied', severity: 'warning', req, details: { reference: ref, customerId: req.actor.id } });
    throw new HttpError(404, 'No request found with that reference number.');   // same answer as "not found"
  }
  const [history, review] = await Promise.all([
    query('SELECT old_status, new_status, changed_at FROM request_status_history WHERE request_id = $1 ORDER BY changed_at', [r.id]),
    query('SELECT rating, comment, created_at FROM reviews WHERE request_id = $1', [r.id]),
  ]);
  const { record_hash, tx_hash, customer_id, ...safe } = r;
  res.json({ ...safe, record_hash, tx_hash, history: history.rows, review: review.rows[0] || null });
}));

router.post('/:id/cancel', authenticate('main'), requireRole('customer'), requirePermission('service_requests', 'write'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  res.json(await changeStatus({ requestId: id, newStatus: 'cancelled', actorRole: 'customer', actorId: req.actor.id, ownerCheck: (r) => r.customer_id === req.actor.id }));
}));

// ---------- customer: review after completion ----------
router.post('/:id/review', authenticate('main'), requireRole('customer'), requirePermission('reviews', 'write'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const b = z.object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(600).optional() }).parse(req.body);
  const { rows } = await query('SELECT * FROM service_requests WHERE id = $1 AND customer_id = $2', [id, req.actor.id]);
  const r = rows[0];
  if (!r) throw new HttpError(404, 'Request not found.');
  if (r.status !== 'completed') throw new HttpError(409, 'You can review a provider only after the service is completed.');

  const review = await tx(async (c) => {
    let rv;
    try {
      rv = (await c.query('INSERT INTO reviews (request_id, customer_id, provider_id, rating, comment) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [r.id, req.actor.id, r.provider_id, b.rating, b.comment || null])).rows[0];
    } catch (e) { if (e.code === '23505') throw new HttpError(409, 'You already reviewed this request.'); throw e; }
    await anchor(c, 'review', rv.id, reviewPayload(rv), 'reviews');
    await c.query(
      `UPDATE providers SET avg_rating = (SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE provider_id = $1),
                            review_count = (SELECT COUNT(*) FROM reviews WHERE provider_id = $1) WHERE id = $1`, [r.provider_id]);
    return rv;
  });
  const pu = await query('SELECT user_id FROM providers WHERE id = $1', [r.provider_id]);
  await notify('user', pu.rows[0].user_id, 'new_review', `You received a ${b.rating} star review for ${r.reference_number}.`, '/provider');
  res.status(201).json(review);
}));

// ---------- request photos: only the customer and the assigned provider ----------
router.get('/attachments/:id', authenticate('main'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { rows } = await query(
    `SELECT a.file_path, a.file_type, r.customer_id, p.user_id AS provider_user_id
       FROM request_attachments a JOIN service_requests r ON r.id = a.request_id JOIN providers p ON p.id = r.provider_id WHERE a.id = $1`, [id]);
  const a = rows[0];
  const allowed = a && ((req.actor.role === 'customer' && a.customer_id === req.actor.id) || (req.actor.role === 'provider' && a.provider_user_id === req.actor.id));
  if (!allowed) throw new HttpError(404, 'File not found.');
  res.set({ 'Content-Type': a.file_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(path.resolve(a.file_path));
}));

module.exports = router;
