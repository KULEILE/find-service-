const { z } = require('zod');
const { query, tx } = require('../db');
const { HttpError, logActivity, notify } = require('./helpers');
const { anchor, statusPayload } = require('./ledger');
const { updateConversationExpiry } = require('./retention');
const realtime = require('../realtime');

const PROVIDER_FLOW = { pending: ['accepted', 'rejected'], accepted: ['in_progress'], in_progress: ['completed'] };
const CUSTOMER_FLOW = { pending: ['cancelled'], accepted: ['cancelled'] };
const CLOSED = ['rejected', 'completed', 'cancelled'];
const LABEL = { accepted: 'accepted', rejected: 'declined', in_progress: 'started', completed: 'marked as completed', cancelled: 'cancelled' };

async function changeStatus({ requestId, newStatus, actorRole, actorId, ownerCheck }) {
  const out = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT r.*, p.user_id AS provider_user_id, p.business_name FROM service_requests r JOIN providers p ON p.id = r.provider_id WHERE r.id = $1 FOR UPDATE OF r`, [requestId]);
    const r = rows[0];
    if (!r || !ownerCheck(r)) throw new HttpError(404, 'Request not found.');
    const flow = actorRole === 'provider' ? PROVIDER_FLOW : CUSTOMER_FLOW;
    if (!(flow[r.status] || []).includes(newStatus)) throw new HttpError(409, `A ${r.status.replace('_', ' ')} request cannot be changed to ${newStatus.replace('_', ' ')}.`);

    const closed = CLOSED.includes(newStatus);
    await c.query('UPDATE service_requests SET status = $1, updated_at = now(), closed_at = CASE WHEN $2 THEN now() ELSE closed_at END WHERE id = $3', [newStatus, closed, r.id]);
    const h = await c.query(
      'INSERT INTO request_status_history (request_id, old_status, new_status, changed_by_role, changed_by_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [r.id, r.status, newStatus, actorRole, actorId]);
    await anchor(c, 'request_status', h.rows[0].id, statusPayload(h.rows[0]), 'request_status_history');
    await logActivity({ userId: actorRole === 'provider' ? actorId : null, role: actorRole, action: `request_${newStatus}`, entity: 'service_request', entityId: r.id }, c);
    if (closed && r.conversation_id) {
      await c.query('UPDATE service_requests SET closed_at = COALESCE(closed_at, now()) WHERE id = $1', [r.id]);
      await updateConversationExpiry(r.conversation_id, c);
    }
    return r;
  });

  // Tell the other side, live.
  if (actorRole === 'provider') {
    await notify('customer', out.customer_id, 'request_status', `${out.business_name} ${LABEL[newStatus]} your request ${out.reference_number}.`, `/track/${out.reference_number}`);
  } else {
    await notify('user', out.provider_user_id, 'request_status', `Request ${out.reference_number} was cancelled by the customer.`, `/provider/requests/${out.id}`);
  }
  realtime.emitTo(`user:${out.provider_user_id}`, 'request:updated', { id: out.id, status: newStatus });
  realtime.emitTo(`customer:${out.customer_id}`, 'request:updated', { id: out.id, status: newStatus });
  return { id: out.id, reference_number: out.reference_number, status: newStatus };
}

const statusSchema = z.object({ status: z.enum(['accepted', 'rejected', 'in_progress', 'completed', 'cancelled']) });

module.exports = { changeStatus, statusSchema };
