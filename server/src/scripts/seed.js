// Demo data: staff accounts, providers, services, customers, requests, reviews and one chat.
// Run once after migrate:  npm run seed
const bcrypt = require('bcryptjs');
const { query, tx, pool } = require('../db');
const { encrypt } = require('../utils/crypto');
const { anchor, requestPayload, statusPayload, reviewPayload } = require('../utils/ledger');
const { updateConversationExpiry } = require('../utils/retention');

let seed = 42;                                   // fixed seed: same demo data every time
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const PROVIDERS = [
  ['Kuleile Plumbing Services', 'Maseru', ['Berea'], 'plumbing', [['Pipe installation', 250], ['Leak repair', 200], ['Geyser installation', 400], ['Bathroom maintenance', 350]]],
  ['Matsieng Pipe Works', 'Maseru', [], 'plumbing', [['Leak repair', 180], ['Drain unblocking', 200]]],
  ['Thato Plumbing', 'Maseru', ['Mafeteng'], 'plumbing', [['Tap and basin repair', 200], ['Pipe installation', 260]]],
  ['Teboho Plumbing', 'Maseru', [], 'plumbing', [['Toilet repair', 250], ['Geyser repair', 450]]],
  ['Bright Spark Electricians', 'Berea', ['Maseru'], 'electrical', [['House wiring', 300], ['Plug and switch fitting', 120], ['Fault finding', 220]]],
  ['Sparkle Cleaners', 'Leribe', ['Botha-Bothe'], 'cleaning', [['House cleaning', 250], ['Office cleaning', 450]]],
  ['Mafeteng Motors', 'Mafeteng', ['Mohale\'s Hoek'], 'mechanics', [['Basic car service', 500], ['Brake repair', 650]]],
  ['Green Gardens', 'Maseru', ['Berea'], 'gardening', [['Lawn mowing', 150], ['Garden design', 800]]],
  ['Colour Craft Painters', 'Maseru', ['Berea', 'Leribe'], 'painting', [['Interior painting', 1200], ['Exterior painting', 1800]]],
  ['Woodworks Lesotho', 'Leribe', [], 'carpentry', [['Door fitting', 350], ['Cupboard building', 1500]]],
  ['Cool Air Appliance Repairs', 'Maseru', ['Berea'], 'appliance-repairs', [['Fridge repair', 400], ['Washing machine repair', 450]]],
];
const CUSTOMERS = [['Lerato Mokoena', '+26658000001'], ['Thabo Molefe', '+26658000002'], ['Palesa Tau', '+26658000003'], ['Mpho Sebata', '+26658000004'], ['Neo Khati', '+26658000005'], ['Retselisitsoe Lebusa', '+26658000006']];
const PLACES = ['Maseru West', 'Maseru Central', 'Ha Thetsane', 'Roma', 'Teyateyaneng', 'Hlotse', 'Mafeteng town', 'Berea Road'];
const WORK = ['Please come and have a look as soon as possible.', 'The problem started two days ago.', 'I need this done before the weekend.', 'Can you give me a quote on site?'];
const COMMENTS = ['Quick and professional.', 'Did a good job, fair price.', 'Arrived on time and cleaned up.', 'Good work, will call again.', 'Took longer than expected but the result is fine.'];

(async () => {
  const done = await query("SELECT 1 FROM users WHERE email = 'admin@fsp.test'");
  if (done.rows[0]) { console.log('Demo data already exists. Nothing to do.'); return; }
  const role = Object.fromEntries((await query('SELECT id, name FROM roles')).rows.map((r) => [r.name, r.id]));
  const district = Object.fromEntries((await query('SELECT id, name FROM districts')).rows.map((r) => [r.name, r.id]));
  const category = Object.fromEntries((await query('SELECT id, slug FROM categories')).rows.map((r) => [r.slug, r.id]));
  const hash = (p) => bcrypt.hashSync(p, 10);

  await query('INSERT INTO users (name, email, password_hash, role_id) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',
    ['System Admin', 'admin@fsp.test', hash('Admin@12345'), role.admin, 'Security Admin', 'security@fsp.test', hash('Secure@12345'), role.security_admin]);

  const providers = [];
  for (let i = 0; i < PROVIDERS.length; i++) {
    const [name, dist, extra, cat, services] = PROVIDERS[i];
    const u = (await query('INSERT INTO users (name, email, password_hash, role_id) VALUES ($1,$2,$3,$4) RETURNING id', [name + ' (owner)', `provider${i + 1}@fsp.test`, hash('Provider@123'), role.provider])).rows[0];
    const p = (await query(
      'INSERT INTO providers (user_id, business_name, description, phone, district_id, availability) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [u.id, name, `We provide reliable ${cat.replace('-', ' ')} services for your home or business. Fast, clean and affordable.`, `+2665900${String(1000 + i)}`, district[dist], 'Mon to Sat, 08:00 to 17:00'])).rows[0];
    for (const d of new Set([dist, ...extra])) await query('INSERT INTO provider_districts (provider_id, district_id) VALUES ($1,$2)', [p.id, district[d]]);
    const svc = [];
    for (const [sn, price] of services) svc.push((await query('INSERT INTO services (provider_id, category_id, name, description, price) VALUES ($1,$2,$3,$4,$5) RETURNING id, price', [p.id, category[cat], sn, `${sn} by ${name}`, price])).rows[0]);
    providers.push({ id: p.id, userId: u.id, services: svc });
  }

  const customers = [];
  for (const [n, ph] of CUSTOMERS) customers.push((await query('INSERT INTO customer_identities (name, phone, verified, last_verified_at) VALUES ($1,$2,TRUE,now()) RETURNING id', [n, ph])).rows[0]);

  // About 60 requests over the last 120 days, so dashboards and the AI part have something to learn from.
  const STATUSES = ['completed', 'completed', 'completed', 'completed', 'accepted', 'in_progress', 'pending', 'cancelled', 'rejected'];
  let n = 0;
  for (let i = 0; i < 60; i++) {
    const pr = pick(providers); const sv = pick(pr.services); const cu = pick(customers);
    const status = STATUSES[Math.floor(rnd() * STATUSES.length)];
    const created = new Date(Date.now() - Math.floor(rnd() * 120) * 86400000 - Math.floor(rnd() * 20) * 3600000);
    const closed = ['completed', 'cancelled', 'rejected'].includes(status) ? new Date(created.getTime() + (1 + Math.floor(rnd() * 5)) * 86400000) : null;
    await tx(async (c) => {
      const r = (await c.query(
        `INSERT INTO service_requests (reference_number, customer_id, provider_id, service_id, description, location, preferred_date, status, created_at, updated_at, closed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) RETURNING *`,
        [`FSP-2026-SEED${String(++n).padStart(2, '0')}`, cu.id, pr.id, sv.id, pick(WORK), pick(PLACES), new Date(created.getTime() + 2 * 86400000).toISOString().slice(0, 10), status, created, closed])).rows[0];
      await anchor(c, 'service_request', r.id, requestPayload(r), 'service_requests');
      const h = (await c.query("INSERT INTO request_status_history (request_id, old_status, new_status, changed_by_role, changed_at) VALUES ($1,NULL,'pending','customer',$2) RETURNING *", [r.id, created])).rows[0];
      await anchor(c, 'request_status', h.id, statusPayload(h), 'request_status_history');
      if (status !== 'pending') {
        const h2 = (await c.query('INSERT INTO request_status_history (request_id, old_status, new_status, changed_by_role, changed_at) VALUES ($1,$2,$3,$4,$5) RETURNING *', [r.id, 'pending', status, status === 'cancelled' ? 'customer' : 'provider', closed || created])).rows[0];
        await anchor(c, 'request_status', h2.id, statusPayload(h2), 'request_status_history');
      }
      if (status === 'completed' && rnd() < 0.8) {
        const rv = (await c.query('INSERT INTO reviews (request_id, customer_id, provider_id, rating, comment, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
          [r.id, cu.id, pr.id, rnd() < 0.7 ? 5 - Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 2), pick(COMMENTS), closed])).rows[0];
        await anchor(c, 'review', rv.id, reviewPayload(rv), 'reviews');
      }
    });
  }
  await query(`UPDATE providers p SET avg_rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews r WHERE r.provider_id = p.id), 0),
                                      review_count = (SELECT COUNT(*) FROM reviews r WHERE r.provider_id = p.id)`);

  // One demo chat (messages are stored encrypted).
  const conv = (await query('INSERT INTO conversations (customer_id, provider_id) VALUES ($1,$2) RETURNING id', [customers[0].id, providers[0].id])).rows[0];
  const lines = [['customer', customers[0].id, 'Hello, are you available tomorrow morning? I have a leaking pipe in the kitchen.'], ['provider', providers[0].userId, 'Hi Lerato. Yes, I can come at 10:00. The call-out starts from M200.'], ['customer', customers[0].id, 'Perfect, I will send a request now.']];
  for (const [role_, sid, text] of lines) await query('INSERT INTO messages (conversation_id, sender_role, sender_id, content_enc) VALUES ($1,$2,$3,$4)', [conv.id, role_, sid, encrypt(text)]);
  await updateConversationExpiry(conv.id);

  console.log('Demo data created.');
  console.log('  Admin:          admin@fsp.test      / Admin@12345');
  console.log('  Security admin: security@fsp.test   / Secure@12345   (security portal)');
  console.log('  Providers:      provider1@fsp.test ... provider11@fsp.test / Provider@123');
  console.log('  Customers:      verify with phone +26658000001 (any of ...01 to ...06) and the code shown by the API');
})().catch((e) => { console.error('Seed failed:', e); process.exitCode = 1; }).finally(() => pool.end());
