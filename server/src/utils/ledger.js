// Blockchain preparation layer.
// PHASE 1 (now): every important record gets a SHA-256 fingerprint saved in the database
//                and queued in ledger_records with status "pending".
// PHASE 2 (next): implement submitPending() to write the pending hashes to the blockchain,
//                 then save tx_hash and set status = "anchored".
const config = require('../config');
const { query } = require('../db');
const { sha256Hex, canonicalJson } = require('./crypto');

const requestPayload = (r) => ({
  reference_number: r.reference_number, customer_id: r.customer_id, provider_id: r.provider_id,
  service_id: r.service_id, description: r.description, location: r.location,
  preferred_date: r.preferred_date ? String(r.preferred_date).slice(0, 10) : null, created_at: r.created_at,
});
const statusPayload = (h) => ({
  request_id: h.request_id, old_status: h.old_status, new_status: h.new_status,
  changed_by_role: h.changed_by_role, changed_by_id: h.changed_by_id, changed_at: h.changed_at,
});
const reviewPayload = (r) => ({
  request_id: r.request_id, customer_id: r.customer_id, provider_id: r.provider_id,
  rating: r.rating, comment: r.comment, created_at: r.created_at,
});

// db = a transaction client or null. table = table that has record_hash column (or null).
async function anchor(db, entityType, entityId, payload, table = null) {
  const run = db || { query };
  const hash = sha256Hex(canonicalJson(payload));
  if (table) await run.query(`UPDATE ${table} SET record_hash = $1 WHERE id = $2`, [hash, entityId]);
  await run.query('INSERT INTO ledger_records (entity_type, entity_id, record_hash) VALUES ($1,$2,$3)', [entityType, String(entityId), hash]);
  return hash;
}

async function submitPending() {
  if (!config.blockchainEnabled) return { skipped: true, reason: 'BLOCKCHAIN_ENABLED is false' };
  // TODO (phase 2): read pending rows, send each record_hash to the smart contract,
  // then UPDATE ledger_records SET status='anchored', tx_hash=..., block_number=..., anchored_at=now()
  throw new Error('Blockchain layer is not implemented yet');
}

module.exports = { anchor, submitPending, requestPayload, statusPayload, reviewPayload };
