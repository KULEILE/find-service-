const config = require('../config');
const { query } = require('../db');
const { sha256Hex, canonicalJson } = require('./crypto');

const requestPayload = (r) => ({
  reference_number: r.reference_number, 
  customer_id: r.customer_id, 
  provider_id: r.provider_id,
  service_id: r.service_id, 
  description: r.description, 
  location: r.location,
  preferred_date: r.preferred_date ? String(r.preferred_date).slice(0, 10) : null, 
  created_at: r.created_at,
});

const statusPayload = (h) => ({
  request_id: h.request_id, 
  old_status: h.old_status, 
  new_status: h.new_status,
  changed_by_role: h.changed_by_role, 
  changed_by_id: h.changed_by_id, 
  changed_at: h.changed_at,
});

const reviewPayload = (r) => ({
  request_id: r.request_id, 
  customer_id: r.customer_id, 
  provider_id: r.provider_id,
  rating: r.rating, 
  comment: r.comment, 
  created_at: r.created_at,
});

// db = a transaction client or null. 
async function anchor(db, entityType, entityId, payload, table = null) {
  const run = db || { query };
  const hash = sha256Hex(canonicalJson(payload));
  
  // 1. Update the local table with the hash for easy UI display
  if (table) {
    await run.query(`UPDATE ${table} SET record_hash = $1 WHERE id = $2`, [hash, entityId]);
  }

  // 2. Create a unique transaction ID (can be a UUID or a combination of entityType + entityId + hash)
  const transactionId = `${entityType}_${entityId}_${Date.now()}`;
  
  // 3. Map to the correct on-chain event types
  let eventType = 'UNKNOWN';
  if (entityType === 'service_request') eventType = 'SERVICE_REQUEST_CREATED';
  if (entityType === 'request_status') eventType = 'REQUEST_STATUS_CHANGED';
  if (entityType === 'review') eventType = 'REVIEW_SUBMITTED';

  // 4. Insert into the Outbox
  await run.query(
    `INSERT INTO outbox_events 
      (transaction_id, event_type, entity_reference, payload, payload_commitment) 
     VALUES ($1, $2, $3, $4, $5)`,
    [
      transactionId, 
      eventType, 
      String(entityId), 
      JSON.stringify(payload), 
      hash
    ]
  );

  return hash;
}

module.exports = { anchor, requestPayload, statusPayload, reviewPayload };