const axios = require('axios');
const { signData, verifySignature, canonicalJson, sha256, getMerkleRoot } = require('./crypto');

class ConsensusEngine {
  constructor(nodeId, port, storage, privateKey, publicKey) {
    this.nodeId = nodeId;
    this.port = port;
    this.storage = storage;
    this.privateKey = privateKey;
    this.publicKey = publicKey;

    // SINGLE NODE CONFIGURATION
    this.peers = [];
    console.log(`[Node ${this.nodeId}] Running in Single-Node Mode. No peers.`);

    // State for the current consensus round
    this.currentView = 0;
    this.sequenceNumber = 0; // Will be set after DB connects
    this.mempool = new Map(); // txId -> transaction
    this.prepares = new Map(); // txId -> Set of nodeIds
    this.commits = new Map(); // txId -> Set of nodeIds
    this.committed = new Set(); // txIds already saved to DB
  }

  // We call this once from index.js after the DB is ready
  async initialize() {
    const latest = await this.storage.getLatestBlock();
    this.sequenceNumber = latest.height + 1;
  }

  // Step 1: Leader receives transaction from Gateway
  async handleNewTransaction(tx) {
    const txId = tx.transactionId;
    this.mempool.set(txId, tx);
    this.prepares.set(txId, new Set([this.nodeId]));
    this.commits.set(txId, new Set());

    console.log(`[Node ${this.nodeId}] Leader initiating PBFT for tx: ${txId}`);
    
    // In single-node mode, we skip straight to commit
    await this.checkQuorum(txId, 'PREPARE');
    
    return { status: 'PENDING', transactionId: txId };
  }

  // Step 2: Followers receive Pre-Prepare from Leader
  async handlePrePrepare(data) {
    // Not used in single-node mode
    return;
  }

  // Step 3: Receive Prepare from other nodes
  async handlePrepare(data) {
    // Not used in single-node mode
    return;
  }

  // Step 4: Receive Commit from other nodes
  async handleCommit(data) {
    // Not used in single-node mode
    return;
  }

  // Step 5: Check if we have enough votes (Quorum = 1 out of 1)
  async checkQuorum(txId, phase) {
    const votes = phase === 'PREPARE' ? this.prepares.get(txId) : this.commits.get(txId);
    
    // Single node only needs 1 vote (itself)
    if (votes && votes.size >= 1 && !this.committed.has(txId)) {
      if (phase === 'PREPARE') {
        console.log(`[Node ${this.nodeId}] PREPARE Quorum reached (1/1). Committing...`);
        await this.commitBlock(txId);
      } 
    }
  }

  // Step 6: Save to PostgreSQL (Neon)
  async commitBlock(txId) {
    if (this.committed.has(txId)) return;
    this.committed.add(txId);

    const tx = this.mempool.get(txId);
    
    // Await the latest block from Postgres
    const latestBlock = await this.storage.getLatestBlock();
    const newHeight = latestBlock.height + 1;
    
    const block = {
      height: newHeight,
      previous_hash: latestBlock.hash,
      merkle_root: getMerkleRoot([tx]),
      timestamp: Date.now()
    };
    block.hash = sha256(canonicalJson(block));

    // Await the save to Postgres
    await this.storage.commitBlock(block, [tx]);
    console.log(`[Node ${this.nodeId}] COMMIT Quorum reached for ${txId}. Committing to Database!`);
    
    // Cleanup
    this.mempool.delete(txId);
    this.prepares.delete(txId);
    this.commits.delete(txId);
  }

  // Helper to send HTTP requests to other validators
  async broadcast(endpoint, payload) {
    // Not used in single-node mode
    return;
  }
}

module.exports = ConsensusEngine;