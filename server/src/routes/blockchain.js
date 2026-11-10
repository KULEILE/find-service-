const express = require('express');
const axios = require('axios');
const { query } = require('../db');
const { asyncHandler } = require('../utils/helpers');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Only admins can view the blockchain explorer data
router.use(authenticate('main'), requireRole('admin'));

router.get('/explorer', asyncHandler(async (req, res) => {
  // 1. Get the chain status from Node 1
  let chainStatus = { height: 0, latestHash: '...' };
  try {
    const statusRes = await axios.get(`${process.env.CHAIN_NODE_URL}/chain/status`);
    chainStatus = statusRes.data;
  } catch (err) {
    console.error("Could not reach blockchain node", err.message);
  }

  // 2. Get the recent transactions from PostgreSQL outbox
  const { rows: transactions } = await query(
    `SELECT transaction_id, event_type, submission_status, created_at, confirmed_at 
     FROM outbox_events 
     ORDER BY created_at DESC LIMIT 50`
  );

  res.json({
    network: chainStatus,
    transactions
  });
}));

module.exports = router;