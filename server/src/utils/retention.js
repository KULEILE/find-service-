const { query } = require('../db');
const { policyInt } = require('./helpers');

const DAY = 24 * 60 * 60 * 1000;

// Sets conversations.expires_at using the retention rules:
//  - chat with no request:        last message + retention_chat_days (default 90)
//  - chat linked to open request: last message + retention_request_chat_days (default 365)
//  - chat linked to closed request: closed date + retention_request_chat_days
async function updateConversationExpiry(conversationId, db = null) {
  const run = db || { query };
  const chatDays = await policyInt('retention_chat_days', 90);
  const reqDays = await policyInt('retention_request_chat_days', 365);
  const { rows } = await run.query('SELECT last_message_at FROM conversations WHERE id = $1', [conversationId]);
  if (!rows[0]) return;
  const last = new Date(rows[0].last_message_at).getTime();
  const r = await run.query('SELECT closed_at FROM service_requests WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1', [conversationId]);
  let expires;
  if (!r.rows[0]) expires = last + chatDays * DAY;
  else if (r.rows[0].closed_at) expires = Math.max(last + chatDays * DAY, new Date(r.rows[0].closed_at).getTime() + reqDays * DAY);
  else expires = last + reqDays * DAY;
  await run.query('UPDATE conversations SET expires_at = $1 WHERE id = $2', [new Date(expires), conversationId]);
}

module.exports = { updateConversationExpiry };
