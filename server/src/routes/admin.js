const express = require('express');
const { z } = require('zod');
const { query, tx } = require('../db');
const { asyncHandler, HttpError, policyInt, logActivity, logSecurity, notify } = require('../utils/helpers');
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { decrypt } = require('../utils/crypto');

const router = express.Router();
router.use(authenticate('main'), requireRole('admin'));

router.get('/stats', requirePermission('administration', 'read'), asyncHandler(async (req, res) => {
  const [prov, reqs, reports, misc] = await Promise.all([
    query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active FROM providers"),
    query('SELECT status, count(*)::int AS n FROM service_requests GROUP BY status'),
    query("SELECT count(*)::int AS n FROM message_reports WHERE status = 'open'"),
    query(`SELECT (SELECT count(*)::int FROM categories WHERE is_active) AS categories, (SELECT count(*)::int FROM services WHERE is_active) AS services,
                  (SELECT count(*)::int FROM customer_identities WHERE verified) AS customers, (SELECT count(*)::int FROM reviews) AS reviews`),
  ]);
  res.json({ providers: prov.rows[0], requests: Object.fromEntries(reqs.rows.map((r) => [r.status, r.n])), open_reports: reports.rows[0].n, ...misc.rows[0] });
}));

// ---------- categories ----------
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const catSchema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(300).optional().or(z.literal('')), icon: z.string().trim().max(30).optional().or(z.literal('')), is_active: z.boolean().optional() });

router.get('/categories', requirePermission('categories', 'read'), asyncHandler(async (req, res) => {
  res.json((await query(`SELECT c.*, (SELECT count(*)::int FROM services s WHERE s.category_id = c.id AND s.is_active) AS services FROM categories c ORDER BY c.id`)).rows);
}));

router.post('/categories', requirePermission('categories', 'write'), asyncHandler(async (req, res) => {
  const b = catSchema.parse(req.body);
  try {
    const { rows } = await query('INSERT INTO categories (name, slug, description, icon) VALUES ($1,$2,$3,$4) RETURNING *', [b.name, slugify(b.name), b.description || null, b.icon || null]);
    await logActivity({ userId: req.actor.id, role: 'admin', action: 'category_added', entity: 'category', entityId: rows[0].id });
    res.status(201).json(rows[0]);
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'A category with that name already exists.'); throw e; }
}));

router.put('/categories/:id', requirePermission('categories', 'write'), asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const b = catSchema.parse(req.body);
  const { rows } = await query('UPDATE categories SET name = $1, description = $2, icon = $3, is_active = COALESCE($4, is_active) WHERE id = $5 RETURNING *',
    [b.name, b.description || null, b.icon || null, b.is_active ?? null, id]);
  if (!rows[0]) throw new HttpError(404, 'Category not found.');
  await logActivity({ userId: req.actor.id, role: 'admin', action: 'category_updated', entity: 'category', entityId: id });
  res.json(rows[0]);
}));

router.delete('/categories/:id', requirePermission('categories', 'write'), asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const used = await query('SELECT 1 FROM services WHERE category_id = $1 LIMIT 1', [id]);
  if (used.rows[0]) { await query('UPDATE categories SET is_active = FALSE WHERE id = $1', [id]); }   // in use: hide it instead
  else await query('DELETE FROM categories WHERE id = $1', [id]);
  await logActivity({ userId: req.actor.id, role: 'admin', action: 'category_removed', entity: 'category', entityId: id });
  res.json({ removed: true, hidden_only: !!used.rows[0] });
}));

// ---------- providers ----------
router.get('/providers', requirePermission('provider_profiles', 'read'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.business_name, p.phone, p.status, p.avg_rating, p.review_count, p.created_at, d.name AS district, u.email, u.name AS owner_name,
            (SELECT count(*)::int FROM services s WHERE s.provider_id = p.id AND s.is_active) AS services,
            (SELECT count(*)::int FROM service_requests r WHERE r.provider_id = p.id) AS requests
       FROM providers p JOIN users u ON u.id = p.user_id LEFT JOIN districts d ON d.id = p.district_id ORDER BY p.created_at DESC`);
  res.json(rows);
}));

router.patch('/providers/:id/status', requirePermission('provider_profiles', 'write'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { status } = z.object({ status: z.enum(['active', 'suspended']) }).parse(req.body);
  await tx(async (c) => {
    const p = await c.query('UPDATE providers SET status = $1 WHERE id = $2 RETURNING user_id', [status, id]);
    if (!p.rows[0]) throw new HttpError(404, 'Provider not found.');
    await c.query('UPDATE users SET status = $1 WHERE id = $2', [status, p.rows[0].user_id]);
    await logActivity({ userId: req.actor.id, role: 'admin', action: `provider_${status}`, entity: 'provider', entityId: id }, c);
  });
  await logSecurity({ userId: req.actor.id, role: 'admin', event: 'provider_status_changed', req, details: { providerId: id, status } });
  res.json({ id, status });
}));

// ---------- monitor requests (customer phone numbers are not shown) ----------
router.get('/requests', requirePermission('service_requests', 'read'), asyncHandler(async (req, res) => {
  const status = z.string().max(20).optional().parse(req.query.status || undefined);
  const { rows } = await query(
    `SELECT r.id, r.reference_number, r.status, r.created_at, r.location, p.business_name, ci.name AS customer_name, s.name AS service_name
       FROM service_requests r JOIN providers p ON p.id = r.provider_id JOIN customer_identities ci ON ci.id = r.customer_id LEFT JOIN services s ON s.id = r.service_id
      WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC LIMIT 200`, [status || null]);
  res.json(rows);
}));

// ---------- reported conversations: admins only ever see the saved snapshot ----------
router.get('/reports', requirePermission('message_reports', 'read'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT mr.id, mr.reporter_role, mr.reason, mr.status, mr.created_at, mr.reviewed_at,
            p.business_name, ci.name AS customer_name
       FROM message_reports mr
       LEFT JOIN conversations c ON c.id = mr.conversation_id
       LEFT JOIN providers p ON p.id = c.provider_id
       LEFT JOIN customer_identities ci ON ci.id = c.customer_id
      ORDER BY (mr.status = 'open') DESC, mr.created_at DESC LIMIT 200`);
  res.json(rows);
}));

router.get('/reports/:id', requirePermission('message_reports', 'read'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const r = await query(
    `SELECT mr.*, p.business_name, ci.name AS customer_name FROM message_reports mr
       LEFT JOIN conversations c ON c.id = mr.conversation_id LEFT JOIN providers p ON p.id = c.provider_id LEFT JOIN customer_identities ci ON ci.id = c.customer_id
      WHERE mr.id = $1`, [id]);
  if (!r.rows[0]) throw new HttpError(404, 'Report not found.');
  const snap = await query('SELECT sender_role, content_enc, has_image, sent_at, is_reported FROM report_snapshots WHERE report_id = $1 ORDER BY sent_at', [id]);
  // Opening a report is itself recorded, so the security admin can see who looked.
  await logSecurity({ userId: req.actor.id, role: 'admin', event: 'report_viewed', req, details: { reportId: id } });
  await logActivity({ userId: req.actor.id, role: 'admin', action: 'report_viewed', entity: 'report', entityId: id });
  const { reporter_id, ...report } = r.rows[0];
  res.json({ ...report, messages: snap.rows.map((m) => ({ sender_role: m.sender_role, text: decrypt(m.content_enc), has_image: m.has_image, sent_at: m.sent_at, is_reported: m.is_reported })) });
}));

router.patch('/reports/:id/resolve', requirePermission('message_reports', 'write'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const b = z.object({ action: z.enum(['dismissed', 'warned', 'provider_suspended']), note: z.string().trim().max(500).optional() }).parse(req.body);
  const { rows } = await query(
    `SELECT mr.*, c.provider_id, c.customer_id, p.user_id AS provider_user_id FROM message_reports mr
       LEFT JOIN conversations c ON c.id = mr.conversation_id LEFT JOIN providers p ON p.id = c.provider_id WHERE mr.id = $1`, [id]);
  const r = rows[0];
  if (!r) throw new HttpError(404, 'Report not found.');
  if (r.status !== 'open') throw new HttpError(409, 'This report is already resolved.');
  if (b.action === 'provider_suspended' && (r.reporter_role !== 'customer' || !r.provider_id)) throw new HttpError(409, 'Only a provider reported by a customer can be suspended.');

  const days = await policyInt('retention_report_days', 30);
  await tx(async (c) => {
    await c.query('UPDATE message_reports SET status = $1, reviewed_by = $2, reviewed_at = now(), resolution_note = $3, retain_until = $4 WHERE id = $5',
      [b.action, req.actor.id, b.note || null, new Date(Date.now() + days * 86400000), id]);
    if (b.action === 'provider_suspended') {
      await c.query("UPDATE providers SET status = 'suspended' WHERE id = $1", [r.provider_id]);
      await c.query("UPDATE users SET status = 'suspended' WHERE id = $1", [r.provider_user_id]);
    }
    await logActivity({ userId: req.actor.id, role: 'admin', action: `report_${b.action}`, entity: 'report', entityId: id }, c);
  });
  if (b.action === 'warned') {
    if (r.reporter_role === 'customer' && r.provider_user_id) await notify('user', r.provider_user_id, 'warning', 'A customer reported one of your conversations. Please keep messages respectful.');
    if (r.reporter_role === 'provider' && r.customer_id) await notify('customer', r.customer_id, 'warning', 'A provider reported one of your messages. Please keep messages respectful.');
  }
  await notify(r.reporter_role === 'customer' ? 'customer' : 'user', r.reporter_id, 'report_result', 'Thank you. We reviewed your report and took action where needed.');
  res.json({ id, status: b.action });
}));

// ---------- activity and settings ----------
router.get('/activity', requirePermission('system_activity', 'read'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.actor_role, a.created_at, u.name AS user_name
       FROM system_activity a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 150`);
  res.json(rows);
}));

router.get('/settings', requirePermission('administration', 'read'), asyncHandler(async (req, res) => {
  res.json((await query('SELECT key, value FROM app_settings ORDER BY key')).rows);
}));

router.put('/settings', requirePermission('administration', 'write'), asyncHandler(async (req, res) => {
  const b = z.record(z.string().max(60), z.string().max(200)).parse(req.body);
  const allowed = (await query('SELECT key FROM app_settings')).rows.map((r) => r.key);
  for (const [k, v] of Object.entries(b)) if (allowed.includes(k)) await query('UPDATE app_settings SET value = $1, updated_at = now() WHERE key = $2', [v, k]);
  await logActivity({ userId: req.actor.id, role: 'admin', action: 'settings_updated', entity: 'settings' });
  res.json({ saved: true });
}));

module.exports = router;
