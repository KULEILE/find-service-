const express = require('express');
const { z } = require('zod');
const { query, tx } = require('../db');
const { asyncHandler, HttpError, logActivity, normalizePhone } = require('../utils/helpers');
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { profileUpload } = require('../utils/uploads');
const { changeStatus, statusSchema } = require('../utils/requestService');
const { updateConversationExpiry } = require('../utils/retention');

const router = express.Router();
router.use(authenticate('main'), requireRole('provider'));

const providerId = (req) => {
  if (!req.actor.providerId) throw new HttpError(403, 'No provider profile found for this account.');
  return req.actor.providerId;
};

async function loadMe(pid) {
  const [p, cov, svc] = await Promise.all([
    query(`SELECT p.id, p.business_name, p.description, p.phone, p.district_id, d.name AS district, p.profile_image, p.avg_rating, p.review_count, p.availability
             FROM providers p LEFT JOIN districts d ON d.id = p.district_id WHERE p.id = $1`, [pid]),
    query('SELECT district_id FROM provider_districts WHERE provider_id = $1', [pid]),
    query(`SELECT s.id, s.name, s.description, s.price, s.availability, s.category_id, c.name AS category
             FROM services s JOIN categories c ON c.id = s.category_id WHERE s.provider_id = $1 AND s.is_active ORDER BY s.created_at`, [pid]),
  ]);
  return { ...p.rows[0], coverage_district_ids: cov.rows.map((r) => r.district_id), services: svc.rows };
}

router.get('/me', requirePermission('provider_profiles', 'read'), asyncHandler(async (req, res) => {
  res.json(await loadMe(providerId(req)));
}));

const profileSchema = z.object({
  business_name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  phone: z.string().trim().min(8).max(30),
  district_id: z.coerce.number().int(),
  coverage_district_ids: z.array(z.coerce.number().int()).max(10).optional(),
  availability: z.string().trim().max(200).optional().or(z.literal('')),
});

router.put('/profile', requirePermission('provider_profiles', 'write'), asyncHandler(async (req, res) => {
  const pid = providerId(req);
  const b = profileSchema.parse(req.body);
  await tx(async (c) => {
    await c.query(
      'UPDATE providers SET business_name = $1, description = $2, phone = $3, district_id = $4, availability = $5 WHERE id = $6',
      [b.business_name, b.description || null, normalizePhone(b.phone), b.district_id, b.availability || null, pid]);
    if (b.coverage_district_ids) {
      await c.query('DELETE FROM provider_districts WHERE provider_id = $1', [pid]);
      for (const d of new Set([...b.coverage_district_ids, b.district_id])) {
        await c.query('INSERT INTO provider_districts (provider_id, district_id) VALUES ($1,$2)', [pid, d]);
      }
    }
    await logActivity({ userId: req.actor.id, role: 'provider', action: 'profile_updated', entity: 'provider', entityId: pid }, c);
  });
  res.json(await loadMe(pid));
}));

router.post('/profile/image', requirePermission('provider_profiles', 'write'), profileUpload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose an image to upload.');
  const url = `/uploads/profiles/${req.file.filename}`;
  await query('UPDATE providers SET profile_image = $1 WHERE id = $2', [url, providerId(req)]);
  res.json({ profile_image: url });
}));

// ---------- services ----------
const serviceSchema = z.object({
  category_id: z.coerce.number().int(),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  price: z.coerce.number().min(0).max(10000000),
  availability: z.string().trim().max(200).optional().or(z.literal('')),
});

router.post('/services', requirePermission('services', 'write'), asyncHandler(async (req, res) => {
  const b = serviceSchema.parse(req.body);
  const cat = await query('SELECT 1 FROM categories WHERE id = $1 AND is_active', [b.category_id]);
  if (!cat.rows[0]) throw new HttpError(400, 'Choose a valid category.');
  const { rows } = await query(
    'INSERT INTO services (provider_id, category_id, name, description, price, availability) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [providerId(req), b.category_id, b.name, b.description || null, b.price, b.availability || null]);
  await logActivity({ userId: req.actor.id, role: 'provider', action: 'service_added', entity: 'service', entityId: rows[0].id });
  res.status(201).json(rows[0]);
}));

router.put('/services/:id', requirePermission('services', 'write'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const b = serviceSchema.parse(req.body);
  const { rows } = await query(
    `UPDATE services SET category_id = $1, name = $2, description = $3, price = $4, availability = $5
      WHERE id = $6 AND provider_id = $7 RETURNING *`,
    [b.category_id, b.name, b.description || null, b.price, b.availability || null, id, providerId(req)]);
  if (!rows[0]) throw new HttpError(404, 'Service not found.');
  res.json(rows[0]);
}));

// Removing hides the service but keeps old requests readable.
router.delete('/services/:id', requirePermission('services', 'write'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const r = await query('UPDATE services SET is_active = FALSE WHERE id = $1 AND provider_id = $2', [id, providerId(req)]);
  if (!r.rowCount) throw new HttpError(404, 'Service not found.');
  res.json({ removed: true });
}));

// ---------- dashboard and requests ----------
router.get('/dashboard', asyncHandler(async (req, res) => {
  const pid = providerId(req);
  const [counts, rating, recent, unread] = await Promise.all([
    query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'pending')::int AS pending,
                  count(*) FILTER (WHERE status = 'completed')::int AS completed FROM service_requests WHERE provider_id = $1`, [pid]),
    query('SELECT avg_rating, review_count FROM providers WHERE id = $1', [pid]),
    query(`SELECT r.id, r.reference_number, r.status, r.created_at, ci.name AS customer_name, s.name AS service_name
             FROM service_requests r JOIN customer_identities ci ON ci.id = r.customer_id LEFT JOIN services s ON s.id = r.service_id
            WHERE r.provider_id = $1 ORDER BY r.created_at DESC LIMIT 5`, [pid]),
    query(`SELECT count(*)::int AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
            WHERE c.provider_id = $1 AND m.sender_role = 'customer' AND m.read_at IS NULL`, [pid]),
  ]);
  res.json({ ...counts.rows[0], avg_rating: Number(rating.rows[0].avg_rating), review_count: rating.rows[0].review_count, recent: recent.rows, unread_messages: unread.rows[0].n });
}));

router.get('/requests', requirePermission('service_requests', 'read'), asyncHandler(async (req, res) => {
  const status = z.enum(['pending', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled']).optional().parse(req.query.status || undefined);
  const { rows } = await query(
    `SELECT r.id, r.reference_number, r.status, r.created_at, r.preferred_date, r.preferred_time, r.description, ci.name AS customer_name, s.name AS service_name
       FROM service_requests r JOIN customer_identities ci ON ci.id = r.customer_id LEFT JOIN services s ON s.id = r.service_id
      WHERE r.provider_id = $1 AND ($2::text IS NULL OR r.status = $2) ORDER BY r.created_at DESC LIMIT 200`, [providerId(req), status || null]);
  res.json(rows);
}));

router.get('/requests/:id', requirePermission('service_requests', 'read'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { rows } = await query(
    `SELECT r.id, r.reference_number, r.status, r.description, r.location, r.preferred_date, r.preferred_time, r.created_at, r.conversation_id,
            ci.name AS customer_name, ci.phone AS customer_phone, ci.id AS customer_id, s.name AS service_name, s.price,
            (SELECT json_agg(json_build_object('id', a.id)) FROM request_attachments a WHERE a.request_id = r.id) AS attachments
       FROM service_requests r JOIN customer_identities ci ON ci.id = r.customer_id LEFT JOIN services s ON s.id = r.service_id
      WHERE r.id = $1 AND r.provider_id = $2`, [id, providerId(req)]);
  if (!rows[0]) throw new HttpError(404, 'Request not found.');
  const history = await query('SELECT old_status, new_status, changed_at FROM request_status_history WHERE request_id = $1 ORDER BY changed_at', [id]);
  res.json({ ...rows[0], history: history.rows });
}));

router.patch('/requests/:id/status', requirePermission('service_requests', 'write'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { status } = statusSchema.parse(req.body);
  const pid = providerId(req);
  res.json(await changeStatus({ requestId: id, newStatus: status, actorRole: 'provider', actorId: req.actor.id, ownerCheck: (r) => r.provider_id === pid }));
}));

// Provider opens (or creates) the chat with the customer of one of their requests.
router.post('/requests/:id/conversation', requirePermission('messaging', 'write'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const pid = providerId(req);
  const r = await query('SELECT customer_id FROM service_requests WHERE id = $1 AND provider_id = $2', [id, pid]);
  if (!r.rows[0]) throw new HttpError(404, 'Request not found.');
  const conv = await query(
    'INSERT INTO conversations (customer_id, provider_id) VALUES ($1,$2) ON CONFLICT (customer_id, provider_id) DO UPDATE SET status = conversations.status RETURNING id',
    [r.rows[0].customer_id, pid]);
  await query('UPDATE service_requests SET conversation_id = $1 WHERE id = $2 AND conversation_id IS NULL', [conv.rows[0].id, id]);
  await updateConversationExpiry(conv.rows[0].id);
  res.json({ id: conv.rows[0].id });
}));

module.exports = router;
