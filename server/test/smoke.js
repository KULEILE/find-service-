// End-to-end check of the main rules. Start the API first (npm start), then: npm run smoke
// It needs the demo data (npm run seed) and OTP_MODE=mock.
const { io } = require('socket.io-client');
const { query, pool } = require('../src/db');
const { runRetention } = require('../src/jobs/retention');

const BASE = process.env.API || 'http://localhost:4000';
let passed = 0, failed = 0;
const ok = (cond, label) => { cond ? passed++ : failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };

async function call(method, path, { token, body, form } = {}) {
  const headers = {}; if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form; else if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + '/api' + path, { method, headers, body: payload });
  let data = null; try { data = await res.json(); } catch { /* not json */ }
  return { status: res.status, data };
}
const png = () => new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' });

async function customerLogin(name, phone) {
  const a = await call('POST', '/customer/otp/request', { body: { name, phone } });
  const v = await call('POST', '/customer/otp/verify', { body: { phone, code: a.data.devOtp } });
  return v.data.token;
}
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).data?.token;

(async () => {
  const h = await call('GET', '/health'); ok(h.status === 200, 'API is running');

  // ---- public catalogue ----
  const cats = await call('GET', '/categories'); ok(cats.data.length === 8, '8 categories');
  const dist = await call('GET', '/districts'); ok(dist.data.length === 10, '10 districts');
  const list = await call('GET', '/providers?category=plumbing&district=1&max=300'); ok(list.status === 200 && list.data.length >= 3, 'search by category, district and price');
  ok(list.data.every((p) => Number(p.from_price) <= 300), 'price filter respected');
  const q = await call('GET', '/providers?q=kuleile'); const kp = q.data[0]; ok(kp && /Kuleile/.test(kp.business_name), 'search by provider name');
  const detail = await call('GET', `/providers/${kp.id}`); ok(detail.data.services.length === 4 && Array.isArray(detail.data.reviews), 'provider profile with services and reviews');

  // ---- phone OTP ----
  const bad = await call('POST', '/customer/otp/request', { body: { name: 'X Y', phone: '12' } }); ok(bad.status === 400, 'invalid phone rejected');
  const phoneA = '+26657' + String(Date.now()).slice(-6);
  const a = await call('POST', '/customer/otp/request', { body: { name: 'Test Customer A', phone: phoneA } });
  ok(a.status === 200 && /^\d{6}$/.test(a.data.devOtp), 'OTP issued (mock mode)');
  const wrong = await call('POST', '/customer/otp/verify', { body: { phone: phoneA, code: a.data.devOtp === '000000' ? '111111' : '000000' } }); ok(wrong.status === 400, 'wrong OTP refused');
  const stored = await query('SELECT code_hash FROM otp_codes WHERE phone = $1 ORDER BY created_at DESC LIMIT 1', [phoneA]); ok(!stored.rows[0].code_hash.includes(a.data.devOtp), 'OTP is stored hashed');
  const ver = await call('POST', '/customer/otp/verify', { body: { phone: phoneA, code: a.data.devOtp } }); ok(ver.status === 200 && ver.data.token, 'correct OTP gives a temporary token');
  const tokA = ver.data.token;
  const tokB = await customerLogin('Test Customer B', '+26657' + String(Date.now() + 7).slice(-6));

  // ---- private messaging ----
  const prov1 = await login('provider1@fsp.test', 'Provider@123'); ok(!!prov1, 'provider login');
  const prov2 = await login('provider2@fsp.test', 'Provider@123');
  const adminTok = await login('admin@fsp.test', 'Admin@12345'); ok(!!adminTok, 'admin login');
  const me1 = await call('GET', '/auth/me', { token: prov1 });
  const conv = await call('POST', '/conversations', { token: tokA, body: { provider_id: kp.id } }); ok(conv.status === 201, 'customer starts a conversation');
  const cid = conv.data.id;

  const sockA = io(BASE, { auth: { token: tokA } }); const sockP = io(BASE, { auth: { token: prov1 } });
  await Promise.all([new Promise((r) => sockA.on('connect', r)), new Promise((r) => sockP.on('connect', r))]);
  const joinedA = await new Promise((r) => sockA.emit('conversation:join', cid, r)); const joinedP = await new Promise((r) => sockP.emit('conversation:join', cid, r));
  ok(joinedA.ok && joinedP.ok, 'both members can join the live chat room');
  const sockBad = io(BASE, { auth: { token: tokB } }); await new Promise((r) => sockBad.on('connect', r));
  const joinedBad = await new Promise((r) => sockBad.emit('conversation:join', cid, r)); ok(joinedBad.ok === false, 'outsider cannot join the live chat room');
  const noAuth = io(BASE, { auth: { token: 'nonsense' } }); const refused = await new Promise((r) => { noAuth.on('connect_error', () => r(true)); setTimeout(() => r(false), 2000); }); ok(refused, 'socket without a valid token is refused');

  const gotLive = new Promise((r) => sockP.once('message:new', r));
  const form = new FormData(); form.append('text', 'Hello, are you free tomorrow? Leaking pipe, photo attached.'); form.append('image', png(), 'pipe.png');
  const sent = await call('POST', `/conversations/${cid}/messages`, { token: tokA, form }); ok(sent.status === 201 && sent.data.attachments.length === 1, 'customer sends text and photo');
  const live = await Promise.race([gotLive, new Promise((r) => setTimeout(() => r(null), 2000))]); ok(live && live.text.startsWith('Hello'), 'provider receives the message live');
  const raw = await query('SELECT content_enc FROM messages WHERE id = $1', [sent.data.id]); ok(raw.rows[0].content_enc && !raw.rows[0].content_enc.includes('Hello'), 'message text is encrypted in the database');

  const inbox = await call('GET', '/conversations', { token: prov1 }); ok(inbox.data.some((c) => c.id === cid && c.unread === 1 && c.preview.startsWith('Hello')), 'provider inbox shows the chat with 1 unread');
  const msgs = await call('GET', `/conversations/${cid}/messages`, { token: prov1 }); ok(msgs.data.messages[0].text.startsWith('Hello'), 'provider reads decrypted messages');
  const attId = msgs.data.messages[0].attachments[0].id;
  const rd = await call('POST', `/conversations/${cid}/read`, { token: prov1 }); ok(rd.data.read === 1, 'messages marked as read');
  const reply = await call('POST', `/conversations/${cid}/messages`, { token: prov1, body: { text: 'Yes, I can come at 10:00.' } }); ok(reply.status === 201, 'provider replies');

  ok((await call('GET', `/conversations/${cid}/messages`, { token: tokB })).status === 404, 'another customer cannot open the chat');
  ok((await call('GET', `/conversations/${cid}/messages`, { token: prov2 })).status === 404, 'another provider cannot open the chat');
  ok((await call('GET', `/conversations/${cid}/messages`, { token: adminTok })).status === 403, 'admin cannot open live chats');
  ok((await call('POST', `/conversations/${cid}/messages`, { token: tokB, body: { text: 'hi' } })).status === 404, 'outsider cannot post into the chat');
  ok((await call('GET', `/conversations/attachments/${attId}`, { token: tokB })).status === 404, 'outsider cannot download the photo');
  ok((await call('GET', `/conversations/attachments/${attId}`, { token: tokA })).status === 200, 'member can download the photo');
  ok((await fetch(BASE + '/uploads/private/messages/x.png')).status === 404, 'private folder is not served publicly');
  ok((await call('GET', `/conversations/${cid}/messages`)).status === 401, 'no token means no access');

  // ---- service requests, tracking, review ----
  const svcId = detail.data.services[0].id;
  const rf = new FormData(); rf.append('provider_id', kp.id); rf.append('service_id', svcId); rf.append('description', 'Kitchen pipe is leaking badly'); rf.append('location', 'Maseru West'); rf.append('preferred_date', '2026-12-01'); rf.append('images', png(), 'a.png');
  const rq = await call('POST', '/requests', { token: tokA, form: rf }); ok(rq.status === 201 && /^FSP-\d{4}-[A-Z0-9]{6}$/.test(rq.data.reference_number), 'request created with reference number');
  const ref = rq.data.reference_number, rid = rq.data.id;
  const linked = await query('SELECT conversation_id FROM service_requests WHERE id = $1', [rid]); ok(linked.rows[0].conversation_id === cid, 'request linked to the earlier conversation');
  ok((await call('GET', `/requests/track/${ref}`, { token: tokA })).data.status === 'pending', 'customer tracks own request');
  ok((await call('GET', `/requests/track/${ref}`, { token: tokB })).status === 404, 'another customer cannot track it');
  ok((await call('POST', '/requests', { form: rf })).status === 401, 'request needs a verified phone');
  ok((await call('POST', `/requests/${rid}/review`, { token: tokA, body: { rating: 5 } })).status === 409, 'review refused before completion');

  const pReq = await call('GET', '/provider/requests?status=pending', { token: prov1 }); ok(pReq.data.some((r) => r.id === rid), 'provider sees the request');
  ok((await call('PATCH', `/provider/requests/${rid}/status`, { token: prov2, body: { status: 'accepted' } })).status === 404, 'other provider cannot change it');
  ok((await call('PATCH', `/provider/requests/${rid}/status`, { token: prov1, body: { status: 'completed' } })).status === 409, 'cannot skip steps');
  for (const s of ['accepted', 'in_progress', 'completed']) ok((await call('PATCH', `/provider/requests/${rid}/status`, { token: prov1, body: { status: s } })).data.status === s, `provider sets ${s}`);
  ok((await call('POST', `/requests/${rid}/review`, { token: tokB, body: { rating: 5 } })).status === 404, 'other customer cannot review');
  const rev = await call('POST', `/requests/${rid}/review`, { token: tokA, body: { rating: 4, comment: 'Good work' } }); ok(rev.status === 201, 'customer reviews after completion');
  ok((await call('POST', `/requests/${rid}/review`, { token: tokA, body: { rating: 4 } })).status === 409, 'second review refused');
  const notes = await call('GET', '/notifications', { token: tokA }); ok(notes.data.items.some((n) => n.type === 'request_status'), 'customer got status notifications');

  // ---- blockchain preparation ----
  const ver1 = await call('GET', `/verify/request/${ref}`); ok(ver1.data.untampered === true, 'record fingerprint matches');
  await query("UPDATE service_requests SET description = 'changed' WHERE id = $1", [rid]);
  ok((await call('GET', `/verify/request/${ref}`)).data.untampered === false, 'tampering is detected');
  await query("UPDATE service_requests SET description = 'Kitchen pipe is leaking badly' WHERE id = $1", [rid]);
  const led = await query("SELECT count(*)::int AS n FROM ledger_records WHERE status = 'pending'"); ok(led.rows[0].n > 5, 'pending ledger records queued for phase 2');

  // ---- reports: admin sees only the snapshot ----
  const rep = await call('POST', `/conversations/${cid}/report`, { token: tokA, body: { reason: 'Rude language in this chat', message_ids: [reply.data.id] } }); ok(rep.status === 201, 'customer reports the conversation');
  ok((await call('POST', `/conversations/${cid}/report`, { token: tokA, body: { reason: 'Again please' } })).status === 409, 'duplicate open report refused');
  const reps = await call('GET', '/admin/reports', { token: adminTok }); ok(reps.data.some((r) => r.id === rep.data.id && r.status === 'open'), 'admin sees the report');
  const one = await call('GET', `/admin/reports/${rep.data.id}`, { token: adminTok }); ok(one.data.messages.length === 2 && one.data.messages.some((m) => m.is_reported && m.text.startsWith('Yes')), 'admin reads only the snapshot with context');
  ok(!JSON.stringify(one.data).includes(tokA), 'no customer token in report');
  const viewed = await query("SELECT 1 FROM security_logs WHERE event_type = 'report_viewed'"); ok(viewed.rowCount > 0, 'opening a report is logged');
  const del = await call('DELETE', `/conversations/${cid}`, { token: tokA }); ok(del.status === 409, 'chat with an open report cannot be deleted');
  const res = await call('PATCH', `/admin/reports/${rep.data.id}/resolve`, { token: adminTok, body: { action: 'warned', note: 'Warned' } }); ok(res.status === 200, 'admin resolves the report');
  const ret = await query('SELECT retain_until FROM message_reports WHERE id = $1', [rep.data.id]); ok(new Date(ret.rows[0].retain_until) > new Date(Date.now() + 29 * 86400000), 'snapshot kept for 30 days after resolution');

  // ---- retention ----
  const other = await call('POST', '/conversations', { token: tokB, body: { provider_id: kp.id } });
  await call('POST', `/conversations/${other.data.id}/messages`, { token: tokB, body: { text: 'short lived chat' } });
  await query("UPDATE conversations SET expires_at = now() - interval '1 day' WHERE id = ANY($1::uuid[])", [[other.data.id, cid]]);
  const openAgain = await call('POST', `/conversations/${cid}/report`, { token: tokA, body: { reason: 'Second report after review' } });
  const s = await runRetention();
  ok((await query('SELECT 1 FROM conversations WHERE id = $1', [other.data.id])).rowCount === 0, 'expired chat deleted by the retention job');
  ok((await query('SELECT 1 FROM conversations WHERE id = $1', [cid])).rowCount === 1, 'expired chat with an open report is kept');
  ok(s.conversations === 1, 'retention summary correct');

  // ---- security portal (different audience) ----
  ok((await call('POST', '/auth/login', { body: { email: 'security@fsp.test', password: 'Secure@12345' } })).status === 401, 'security admin cannot log in on the main app');
  ok((await call('POST', '/security/login', { body: { email: 'admin@fsp.test', password: 'Admin@12345' } })).status === 401, 'normal admin cannot log in to the security portal');
  const sec = (await call('POST', '/security/login', { body: { email: 'security@fsp.test', password: 'Secure@12345' } })).data?.token; ok(!!sec, 'security admin logs in to the security portal');
  ok((await call('GET', '/security/matrix', { token: adminTok })).status === 401, 'main-app token is refused by the security portal');
  ok((await call('GET', '/admin/stats', { token: sec })).status === 401, 'security token is refused by the main app');
  const matrix = await call('GET', '/security/matrix', { token: sec }); ok(matrix.data.roles.length === 4 && matrix.data.modules.length === 12, 'permission matrix loads');
  const roleId = (n) => matrix.data.roles.find((r) => r.name === n).id; const modId = (c) => matrix.data.modules.find((m) => m.code === c).id;
  ok((await call('PUT', '/security/permissions', { token: sec, body: { role_id: roleId('security_admin'), module_id: modId('security_administration'), can_read: true, can_write: false } })).status === 409, 'security admin cannot lock themselves out');
  const svcBody = { category_id: 1, name: 'Test service', price: 100 };
  ok((await call('POST', '/provider/services', { token: prov1, body: svcBody })).status === 201, 'provider can add a service');
  await call('PUT', '/security/permissions', { token: sec, body: { role_id: roleId('provider'), module_id: modId('services'), can_read: true, can_write: false } });
  ok((await call('POST', '/provider/services', { token: prov1, body: svcBody })).status === 403, 'removing write permission takes effect immediately');
  await call('PUT', '/security/permissions', { token: sec, body: { role_id: roleId('provider'), module_id: modId('services'), can_read: true, can_write: true } });
  ok((await call('POST', '/provider/services', { token: prov1, body: svcBody })).status === 201, 'restoring the permission works');
  ok((await call('GET', '/admin/stats', { token: prov1 })).status === 403, 'provider cannot use admin routes');
  const logs = await call('GET', '/security/logs?severity=warning', { token: sec }); ok(logs.data.length > 0, 'security log lists warnings');
  const ov = await call('GET', '/security/overview', { token: sec }); ok(ov.status === 200 && ov.data.last_24h.access_denied > 0, 'security overview counts denied access');

  // ---- lockout ----
  await query("INSERT INTO users (name, email, password_hash, role_id) SELECT 'Lock Test', 'lock@test.dev', password_hash, role_id FROM users WHERE email = 'provider3@fsp.test' ON CONFLICT DO NOTHING");
  let last; for (let i = 0; i < 5; i++) last = await call('POST', '/auth/login', { body: { email: 'lock@test.dev', password: 'wrong-password-1' } });
  ok((await call('POST', '/auth/login', { body: { email: 'lock@test.dev', password: 'Provider@123' } })).status === 423, 'account locks after 5 wrong passwords');
  await query("DELETE FROM users WHERE email = 'lock@test.dev'");

  // ---- provider opens a chat from a request ----
  const rf2 = new FormData(); rf2.append('provider_id', kp.id); rf2.append('service_id', svcId); rf2.append('description', 'Need a quote for a geyser'); rf2.append('location', 'Roma');
  const rq2 = await call('POST', '/requests', { token: tokB, form: rf2 }); ok(rq2.status === 201, 'second customer sends a request without chatting first');
  const oc = await call('POST', `/provider/requests/${rq2.data.id}/conversation`, { token: prov1 }); ok(oc.status === 200 && oc.data.id, 'provider opens a chat from the request');
  ok((await call('POST', `/provider/requests/${rq2.data.id}/conversation`, { token: prov2 })).status === 404, 'other provider cannot open a chat for that request');
  const link2 = await query('SELECT conversation_id FROM service_requests WHERE id = $1', [rq2.data.id]); ok(link2.rows[0].conversation_id === oc.data.id, 'request is linked to the new chat');
  await call('POST', `/conversations/${oc.data.id}/messages`, { token: prov1, body: { text: 'Hello, I saw your request.' } });
  const inboxB = await call('GET', '/conversations', { token: tokB }); ok(inboxB.data.some((c) => c.id === oc.data.id && c.unread === 1), 'customer sees the provider message in their inbox');

  // ---- customer erasure ----
  const eraseTok = await customerLogin('Erase Me', '+26657' + String(Date.now() + 99).slice(-6));
  ok((await call('DELETE', '/customer/data', { token: eraseTok })).data.deleted === true, 'customer can erase their data');
  ok((await call('GET', '/customer/me', { token: eraseTok })).status === 401, 'erased identity can no longer be used');
  ok((await call('DELETE', '/customer/data', { token: tokA })).status === 409, 'erasure waits while a report is open');

  [sockA, sockP, sockBad, noAuth].forEach((x) => x.close());
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
