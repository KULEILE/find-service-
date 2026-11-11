require('dotenv').config();
const express = require('express');
const Storage = require('./storage');
const ConsensusEngine = require('./consensus');
const { verifySignature, sha256 } = require('./crypto');

const app = express();
app.use(express.json({ limit: '100kb' }));

const NODE_ID = parseInt(process.argv[2] || 1);
const PORT = parseInt(process.argv[3] || 10000);

const storage = new Storage(NODE_ID);
const nodePrivateKey = process.env.VAL1_PRIVATE.replace(/\\n/g, '\n');
const nodePublicKey = process.env.VAL1_PUBLIC.replace(/\\n/g, '\n');
const fspAppPublicKey = process.env.FSP_APP_PUBLIC_KEY.replace(/\\n/g, '\n');

const consensus = new ConsensusEngine(NODE_ID, PORT, storage, nodePrivateKey, nodePublicKey);

const authenticateGateway = (req, res, next) => {
  if (req.headers['x-fsp-gateway-key'] !== process.env.GATEWAY_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized gateway' });
  }
  next();
};

app.post('/transactions', authenticateGateway, async (req, res) => {
  const envelope = req.body;
  
  if (!envelope.transactionId || !envelope.digitalSignature) {
    return res.status(400).json({ error: 'Invalid envelope format' });
  }

  const existing = await storage.getTransaction(envelope.transactionId);
  if (existing) {
    return res.status(409).json({ error: 'Transaction already exists' });
  }

  const payloadToVerify = { ...envelope };
  delete payloadToVerify.digitalSignature;
  
  const isValid = verifySignature(payloadToVerify, envelope.digitalSignature, fspAppPublicKey);
  if (!isValid) {
    return res.status(400).json({ error: 'Invalid digital signature' });
  }

  try {
    const result = await consensus.handleNewTransaction(envelope);
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Consensus failed' });
  }
});

app.get('/chain/status', async (req, res) => {
  const latest = await storage.getLatestBlock();
  res.json({
    nodeId: NODE_ID,
    height: latest ? latest.height : 0,
    latestHash: latest ? latest.hash : '...',
  });
});

(async () => {
  try {
    const latest = await storage.getLatestBlock();
    if (!latest) {
      const genesis = {
        height: 0,
        hash: sha256('GENESIS_FSP_CHAIN'),
        previous_hash: '0'.repeat(64),
        merkle_root: sha256(''),
        timestamp: Date.now()
      };
      await storage.commitBlock(genesis, []);
      console.log(`[Node ${NODE_ID}] Genesis block created.`);
    }
    app.listen(PORT, () => console.log(`[FSP Chain] running on port ${PORT}`));
  } catch (err) {
    console.error(`[Node ${NODE_ID}] Startup failed:`, err);
    process.exit(1);
  }
})();