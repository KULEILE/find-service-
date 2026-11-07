// Deletes data that has passed its retention date. Runs every night, or manually: npm run retention
const { query } = require('../db');
const { logActivity } = require('../utils/helpers');
const { removeFiles } = require('../utils/uploads');

async function runRetention() {
  // 1. Conversations past their expiry date, unless a report about them is still open.
  const expired = await query(
    `SELECT c.id FROM conversations c
      WHERE c.expires_at IS NOT NULL AND c.expires_at < now()
        AND NOT EXISTS (SELECT 1 FROM message_reports mr WHERE mr.conversation_id = c.id AND mr.status = 'open')`);
  const ids = expired.rows.map((r) => r.id);
  let conversations = 0;
  if (ids.length) {
    const files = await query('SELECT a.file_path FROM message_attachments a JOIN messages m ON m.id = a.message_id WHERE m.conversation_id = ANY($1::uuid[])', [ids]);
    conversations = (await query('DELETE FROM conversations WHERE id = ANY($1::uuid[])', [ids])).rowCount;
    removeFiles(files.rows.map((f) => f.file_path));
  }
  // 2. Report snapshots after the retention period that follows resolution.
  const reports = (await query("DELETE FROM message_reports WHERE status <> 'open' AND retain_until IS NOT NULL AND retain_until < now()")).rowCount;
  // 3. Old one-time codes.
  const otps = (await query("DELETE FROM otp_codes WHERE created_at < now() - interval '1 day'")).rowCount;

  const summary = { conversations, reports, otps };
  await logActivity({ role: 'system', action: 'retention_run', entity: 'retention', details: summary });
  console.log('[retention]', summary);
  return summary;
}

module.exports = { runRetention };

if (require.main === module) {
  runRetention().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => require('../db').pool.end());
}
