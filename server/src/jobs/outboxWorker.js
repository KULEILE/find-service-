const { query } = require('../db');
const { submitToChain } = require('../utils/chainGateway');
const axios = require('axios');

// The worker runs every 3 seconds
const POLL_INTERVAL_MS = 3000;
let isRunning = false;

async function processOutbox() {
  if (isRunning) return; // Prevent overlapping runs
  isRunning = true;

  try {
    // 1. Fetch pending events
    const { rows: events } = await query(
      `SELECT * FROM outbox_events 
       WHERE submission_status = 'PENDING' 
       ORDER BY created_at ASC 
       LIMIT 10`
    );

    if (events.length === 0) {
      isRunning = false;
      return;
    }

    for (const event of events) {
      try {
        console.log(`[Outbox] Attempting to submit ${event.transaction_id} to ${process.env.CHAIN_NODE_URL}`);
        
        // 2. Submit to the blockchain gateway
        const result = await submitToChain(event);
        console.log(`[Outbox] Node responded with:`, result);
        
        // 3. Update status based on the node's response
        if (result.status === 'CONFIRMED') {
          await query(
            `UPDATE outbox_events 
             SET submission_status = 'CONFIRMED', confirmed_at = now(), retry_count = retry_count + 1 
             WHERE id = $1`,
            [event.id]
          );
          console.log(`[Outbox] Transaction ${event.transaction_id} CONFIRMED immediately by node.`);
        } else {
          await query(
            `UPDATE outbox_events 
             SET submission_status = 'SUBMITTED', retry_count = retry_count + 1 
             WHERE id = $1`,
            [event.id]
          );
          console.log(`[Outbox] Transaction ${event.transaction_id} marked as SUBMITTED.`);
        }
        
      } catch (error) {
        console.error(`[Outbox] Failed to submit ${event.transaction_id}:`, error.message);
        
        await query(
          `UPDATE outbox_events 
           SET retry_count = retry_count + 1, 
               last_error_code = $1 
           WHERE id = $2`,
          [error.message.substring(0, 100), event.id]
        );
      }
    }
  } catch (err) {
    console.error('[Outbox] Worker error:', err);
  } finally {
    isRunning = false;
  }
}

// Fallback check for any transactions stuck on SUBMITTED
async function checkConfirmations() {
  try {
    const { rows: submitted } = await query(
      `SELECT id, transaction_id FROM outbox_events 
       WHERE submission_status = 'SUBMITTED' 
       LIMIT 20`
    );

    for (const tx of submitted) {
      try {
        const res = await axios.get(`${process.env.CHAIN_NODE_URL}/transactions/${tx.transaction_id}`, {
          headers: { 'x-fsp-gateway-key': process.env.GATEWAY_API_KEY }
        });

        if (res.data.status === 'CONFIRMED') {
          await query(
            `UPDATE outbox_events 
             SET submission_status = 'CONFIRMED', confirmed_at = now() 
             WHERE id = $1`,
            [tx.id]
          );
          console.log(`[Outbox] Transaction ${tx.transaction_id} CONFIRMED by fallback check.`);
        }
      } catch (err) {
        // 404 means it is still pending
      }
    }
  } catch (err) {
    console.error('[Outbox] Confirmation checker error:', err);
  }
}

function startOutboxWorker() {
  console.log('[Outbox] Worker started. Polling PostgreSQL every 3s...');
  processOutbox();
  setInterval(processOutbox, POLL_INTERVAL_MS);
  setInterval(checkConfirmations, 5000);
}

module.exports = { startOutboxWorker };