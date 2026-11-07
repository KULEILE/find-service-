require('dotenv').config();
const express = require('express');
const Storage = require('./storage');
const ConsensusEngine = require('./consensus');
const { verifySignature, canonicalJson, sha256 } = require('./crypto');

const app = express();
app.use(express.json({ limit: '100kb' }));

// Read NODE_ID and PORT from command line arguments (e.g., node index.js 1 3001)
const NODE_ID = parseInt(process.argv[2] || process.env.NODE_ID || 1);
const PORT = parseInt(process.argv[3] || process.env.PORT || 3001);

console.log(`[Boot] Starting Validator ${NODE_ID} on port ${PORT}...`);

// 1. Initialize independent SQLite DB for this node
const storage = new Storage(NODE_ID);

// 2. Genesis Block Setup (MUST run before Consensus Engine)
if (!storage.getLatestBlock()) {
  const genesis = {
    height: 0,
    hash: sha256('GENESIS_FSP_CHAIN'),
    previous_hash: '0'.repeat(64),
    merkle_root: sha256(''),
    timestamp: Date.now()
  };
  storage.commitBlock(genesis, []);
  console.log(`[Node ${NODE_ID}] Genesis block created.`);
}

// 3. Load this node's keys (ensure .env file exists first!)
if (!process.env[`VAL${NODE_ID}_PRIVATE`]) {
    console.error(`ERROR: Missing keys in .env for Validator ${NODE_ID}. Did you run "npm run generate-keys"?`);
    process.exit(1);
}

const nodePrivateKey = process.env[`VAL${NODE_ID}_PRIVATE`].replace(/\\n/g, '\n');
const nodePublicKey = process.env[`VAL${NODE_ID}_PUBLIC`].replace(/\\n/g, '\n');
const fspAppPublicKey = process.env.FSP_APP_PUBLIC_KEY.replace(/\\n/g, '\n');

// 4. Initialize Consensus Engine
const consensus = new ConsensusEngine(NODE_ID, PORT, storage, nodePrivateKey, nodePublicKey);

// --- MIDDLEWARE ---
// 1. Authenticate the FSP Backend Gateway
const authenticateGateway = (req, res, next) => {
  if (req.headers['x-fsp-gateway-key'] !== process.env.GATEWAY_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized gateway' });
  }
  next();
};

// 2. Authenticate Peer Validators (Node-to-Node)
const authenticateValidator = (req, res, next) => {
  if (req.headers['x-fsp-validator-key'] !== process.env.GATEWAY_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized validator' });
  }
  next();
};

// --- GATEWAY ROUTES ---

// 1. Submit a new transaction from FSP Backend
app.post('/transactions', authenticateGateway, (req, res) => {
  const envelope = req.body;
  
  if (!envelope.transactionId || !envelope.digitalSignature) {
    return res.status(400).json({ error: 'Invalid envelope format' });
  }

  // Check for idempotency
  if (storage.getTransaction(envelope.transactionId)) {
    return res.status(409).json({ error: 'Transaction already exists', transactionId: envelope.transactionId });
  }

  // Verify Ed25519 Signature from FSP Backend
  const payloadToVerify = { ...envelope };
  delete payloadToVerify.digitalSignature;
  
  const isValid = verifySignature(payloadToVerify, envelope.digitalSignature, fspAppPublicKey);
  if (!isValid) {
    return res.status(400).json({ error: 'Invalid digital signature from FSP Backend' });
  }

  // Start Consensus
  consensus.handleNewTransaction(envelope).then(result => {
    res.status(202).json(result);
  }).catch(err => {
    console.error(err);
    res.status(500).json({ error: 'Consensus initiation failed' });
  });
});

// 2. Get transaction status
app.get('/transactions/:id', authenticateGateway, (req, res) => {
  const tx = storage.getTransaction(req.params.id);
  if (tx) {
    return res.json({ status: 'CONFIRMED', transaction: tx });
  }
  res.status(404).json({ error: 'Transaction not found or still pending consensus' });
});

// 3. Get chain status (Used by the Explorer and Gateway)
app.get('/chain/status', (req, res) => {
  const latest = storage.getLatestBlock();
  res.json({
    nodeId: NODE_ID,
    networkId: 'FSP-MAIN',
    height: latest.height,
    latestHash: latest.hash,
    timestamp: new Date().toISOString()
  });
});

// --- PBFT CONSENSUS ROUTES (Node-to-Node) ---

app.post('/pbft/pre-prepare', authenticateValidator, (req, res) => {
  consensus.handlePrePrepare(req.body);
  res.json({ ok: true });
});

app.post('/pbft/prepare', authenticateValidator, (req, res) => {
  consensus.handlePrepare(req.body);
  res.json({ ok: true });
});

app.post('/pbft/commit', authenticateValidator, (req, res) => {
  consensus.handleCommit(req.body);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[FSP Chain Validator ${NODE_ID}] running on port ${PORT}`);
});