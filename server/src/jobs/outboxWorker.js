const { query } = require('../db');
const { submitToChain } = require('../utils/chainGateway');

// The worker runs every 3 seconds
const POLL_INTERVAL_MS = 3000;
let isRunning = false;

async function processOutbox() {
  if (isRunning) return; // Prevent overlapping runs
  isRunning = true;

  try {
    // 1. Fetch pending events (limit to 10 at a time to avoid flooding the chain)
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
        // 2. Submit to the blockchain gateway
        const result = await submitToChain(event);
        
        // 3. Update status to SUBMITTED
        await query(
          `UPDATE outbox_events 
           SET submission_status = 'SUBMITTED', retry_count = retry_count + 1 
           WHERE id = $1`,
          [event.id]
        );
        console.log(`[Outbox] Transaction ${event.transaction_id} submitted to chain.`);
        
      } catch (error) {
        // Handle failure (e.g., node is offline)
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

// Function to check the status of SUBMITTED transactions
async function checkConfirmations() {
  try {
    const { rows: submitted } = await query(
      `SELECT id, transaction_id FROM outbox_events 
       WHERE submission_status = 'SUBMITTED' 
       LIMIT 20`
    );

    for (const tx of submitted) {
      try {
        // Ask the chain if this transaction is confirmed
        const axios = require('axios');
        const res = await axios.get(`${process.env.CHAIN_NODE_URL}/transactions/${tx.transaction_id}`, {
          headers: { 'x-fsp-gateway-key': process.env.GATEWAY_API_KEY }
        });

        if (res.data.status === 'CONFIRMED') {
          // The chain has committed the block!
          await query(
            `UPDATE outbox_events 
             SET submission_status = 'CONFIRMED', confirmed_at = now() 
             WHERE id = $1`,
            [tx.id]
          );
          console.log(`[Outbox] Transaction ${tx.transaction_id} CONFIRMED by consensus.`);
        }
      } catch (err) {
        // If 404, it's still pending consensus (mempool). We just wait.
        if (err.response && err.response.status !== 404) {
          console.error(`[Outbox] Error checking status for ${tx.transaction_id}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[Outbox] Confirmation checker error:', err);
  }
}

function startOutboxWorker() {
  console.log('[Outbox] Worker started. Polling PostgreSQL every 3s...');
  
  // Run immediately, then set intervals
  processOutbox();
  setInterval(processOutbox, POLL_INTERVAL_MS);
  
  // Check confirmations every 5 seconds
  setInterval(checkConfirmations, 5000);
}

module.exports = { startOutboxWorker };