const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { asyncHandler, HttpError } = require('../utils/helpers');
const { requestPayload } = require('../utils/ledger');
const { sha256Hex, canonicalJson } = require('../utils/crypto');

const router = express.Router();

router.get('/districts', asyncHandler(async (req, res) => {
  res.json((await query('SELECT id, name FROM districts ORDER BY id')).rows);
}));

router.get('/public-stats', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT (SELECT count(*)::int FROM providers p JOIN users u ON u.id = p.user_id WHERE p.status = 'active' AND u.status = 'active') AS providers,
            (SELECT count(*)::int FROM service_requests WHERE status = 'completed') AS completed_jobs,
            (SELECT count(*)::int FROM reviews) AS reviews,
            (SELECT COALESCE(ROUND(AVG(rating)::numeric, 1), 0) FROM reviews) AS avg_rating`);
  res.json(rows[0]);
}));

router.get('/categories', asyncHandler(async (req, res) => {
  res.json((await query('SELECT id, name, slug, description, icon FROM categories WHERE is_active ORDER BY id')).rows);
}));

const searchSchema = z.object({
  category: z.string().max(80).optional(),
  district: z.coerce.number().int().optional(),
  min: z.coerce.number().min(0).optional(),
  max: z.coerce.number().min(0).optional(),
  q: z.string().trim().max(80).optional(),
  sort: z.enum(['rating', 'price_low', 'price_high']).optional(),
});

router.get('/providers', asyncHandler(async (req, res) => {
  const f = searchSchema.parse(req.query);
  const order = f.sort === 'price_low' ? 'from_price ASC' : f.sort === 'price_high' ? 'from_price DESC' : 'p.avg_rating DESC, p.review_count DESC';
  const { rows } = await query(
    `SELECT p.id, p.business_name, p.profile_image, p.avg_rating, p.review_count, d.name AS district,
            MIN(s.price) AS from_price, array_agg(DISTINCT c.name) AS categories
       FROM providers p
       JOIN users u ON u.id = p.user_id AND u.status = 'active'
       LEFT JOIN districts d ON d.id = p.district_id
       JOIN services s ON s.provider_id = p.id AND s.is_active
       JOIN categories c ON c.id = s.category_id AND c.is_active
      WHERE p.status = 'active'
        AND ($1::text IS NULL OR c.slug = $1)
        AND ($2::int IS NULL OR p.district_id = $2 OR EXISTS (SELECT 1 FROM provider_districts pd WHERE pd.provider_id = p.id AND pd.district_id = $2))
        AND ($3::numeric IS NULL OR s.price >= $3)
        AND ($4::numeric IS NULL OR s.price <= $4)
        AND ($5::text IS NULL OR p.business_name ILIKE '%' || $5 || '%' OR s.name ILIKE '%' || $5 || '%')
      GROUP BY p.id, d.name
      ORDER BY ${order}
      LIMIT 60`,
    [f.category || null, f.district ?? null, f.min ?? null, f.max ?? null, f.q || null]);
  res.json(rows);
}));

router.get('/providers/:id', asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const p = await query(
    `SELECT p.id, p.business_name, p.description, p.phone, p.profile_image, p.avg_rating, p.review_count, p.availability, d.name AS district
       FROM providers p JOIN users u ON u.id = p.user_id AND u.status = 'active' LEFT JOIN districts d ON d.id = p.district_id
      WHERE p.id = $1 AND p.status = 'active'`, [id]);
  if (!p.rows[0]) throw new HttpError(404, 'Provider not found.');
  const [services, coverage, reviews] = await Promise.all([
    query(`SELECT s.id, s.name, s.description, s.price, s.availability, c.name AS category, c.slug
             FROM services s JOIN categories c ON c.id = s.category_id WHERE s.provider_id = $1 AND s.is_active ORDER BY s.price`, [id]),
    query('SELECT d.id, d.name FROM provider_districts pd JOIN districts d ON d.id = pd.district_id WHERE pd.provider_id = $1', [id]),
    query(`SELECT r.rating, r.comment, r.created_at, split_part(ci.name, ' ', 1) AS customer_name
             FROM reviews r JOIN customer_identities ci ON ci.id = r.customer_id WHERE r.provider_id = $1 ORDER BY r.created_at DESC LIMIT 20`, [id]),
  ]);
  res.json({ ...p.rows[0], services: services.rows, coverage: coverage.rows, reviews: reviews.rows });
}));

// Public integrity check: recompute the fingerprint of a request and compare it with the stored one.
router.get('/verify/request/:reference', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM service_requests WHERE reference_number = $1', [String(req.params.reference).toUpperCase()]);
  const r = rows[0];
  if (!r) throw new HttpError(404, 'Reference number not found.');
  const recomputed = sha256Hex(canonicalJson(requestPayload(r)));
  res.json({ reference_number: r.reference_number, stored_hash: r.record_hash, recomputed_hash: recomputed, untampered: r.record_hash === recomputed, tx_hash: r.tx_hash || null });
}));

module.exports = router;
