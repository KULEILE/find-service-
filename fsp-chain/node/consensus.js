const axios = require('axios');
const { signData, verifySignature, canonicalJson, sha256, getMerkleRoot } = require('./crypto');

class ConsensusEngine {
  constructor(nodeId, port, storage, privateKey, publicKey) {
    this.nodeId = nodeId;
    this.port = port;
    this.storage = storage;
    this.privateKey = privateKey;
    this.publicKey = publicKey;

    // The addresses of all 4 validators
    this.peers = [3001, 3002, 3003, 3004].filter(p => p !== this.port).map(p => `http://localhost:${p}`);

    // State for the current consensus round
    this.currentView = 0;
    this.sequenceNumber = storage.getLatestBlock().height + 1;
    this.mempool = new Map(); // txId -> transaction
    this.prepares = new Map(); // txId -> Set of nodeIds
    this.commits = new Map(); // txId -> Set of nodeIds
    this.committed = new Set(); // txIds already saved to DB
  }

  // Step 1: Leader receives transaction from Gateway
  async handleNewTransaction(tx) {
    const txId = tx.transactionId;
    this.mempool.set(txId, tx);
    this.prepares.set(txId, new Set([this.nodeId]));
    this.commits.set(txId, new Set());

    if (this.nodeId === 1) {
      console.log(`[Node ${this.nodeId}] Leader initiating PBFT for tx: ${txId}`);
      await this.broadcast('/pbft/pre-prepare', { tx, sequenceNumber: this.sequenceNumber });
    }
    return { status: 'PENDING', transactionId: txId };
  }

  // Step 2: Followers receive Pre-Prepare from Leader
  async handlePrePrepare(data) {
    const { tx, sequenceNumber } = data;
    if (this.nodeId === 1) return; // Leader ignores its own broadcast

    this.mempool.set(tx.transactionId, tx);
    this.prepares.set(tx.transactionId, new Set([this.nodeId]));
    this.commits.set(tx.transactionId, new Set());
    this.sequenceNumber = sequenceNumber;

    console.log(`[Node ${this.nodeId}] Received Pre-Prepare for ${tx.transactionId}. Sending Prepare...`);
    
    const prepareMsg = { txId: tx.transactionId, sequenceNumber, nodeId: this.nodeId };
    prepareMsg.signature = signData(prepareMsg, this.privateKey);
    
    await this.broadcast('/pbft/prepare', prepareMsg);
    this.checkQuorum(tx.transactionId, 'PREPARE');
  }

  // Step 3: Receive Prepare from other nodes
  async handlePrepare(data) {
    const { txId, sequenceNumber, nodeId, signature } = data;
    const msgToVerify = { txId, sequenceNumber, nodeId };
    
    // Verify the signature of the peer
    const peerPublicKey = process.env[`VAL${nodeId}_PUBLIC`].replace(/\\n/g, '\n');
    if (!verifySignature(msgToVerify, signature, peerPublicKey)) return;

    if (!this.prepares.has(txId)) this.prepares.set(txId, new Set());
    this.prepares.get(txId).add(nodeId);
    
    this.checkQuorum(txId, 'PREPARE');
  }

  // Step 4: Receive Commit from other nodes
  async handleCommit(data) {
    const { txId, sequenceNumber, nodeId, signature } = data;
    const msgToVerify = { txId, sequenceNumber, nodeId };
    
    const peerPublicKey = process.env[`VAL${nodeId}_PUBLIC`].replace(/\\n/g, '\n');
    if (!verifySignature(msgToVerify, signature, peerPublicKey)) return;

    if (!this.commits.has(txId)) this.commits.set(txId, new Set());
    this.commits.get(txId).add(nodeId);
    
    this.checkQuorum(txId, 'COMMIT');
  }

  // Step 5: Check if we have enough votes (Quorum = 3 out of 4)
  async checkQuorum(txId, phase) {
    const votes = phase === 'PREPARE' ? this.prepares.get(txId) : this.commits.get(txId);
    
    if (votes && votes.size >= 3 && !this.committed.has(txId)) {
      if (phase === 'PREPARE') {
        console.log(`[Node ${this.nodeId}] PREPARE Quorum reached for ${txId}. Sending Commit...`);
        const commitMsg = { txId, sequenceNumber: this.sequenceNumber, nodeId: this.nodeId };
        commitMsg.signature = signData(commitMsg, this.privateKey);
        await this.broadcast('/pbft/commit', commitMsg);
        this.checkQuorum(txId, 'COMMIT');
      } 
      else if (phase === 'COMMIT') {
        console.log(`[Node ${this.nodeId}] COMMIT Quorum reached for ${txId}. Committing to SQLite!`);
        await this.commitBlock(txId);
      }
    }
  }

  // Step 6: Save to SQLite
  async commitBlock(txId) {
    if (this.committed.has(txId)) return;
    this.committed.add(txId);

    const tx = this.mempool.get(txId);
    const latestBlock = this.storage.getLatestBlock();
    const newHeight = latestBlock.height + 1;
    
    const block = {
      height: newHeight,
      previous_hash: latestBlock.hash,
      merkle_root: getMerkleRoot([tx]),
      timestamp: Date.now()
    };
    block.hash = sha256(canonicalJson(block));

    // Save to this node's independent SQLite DB
    this.storage.commitBlock(block, [tx]);
    
    // Cleanup
    this.mempool.delete(txId);
    this.prepares.delete(txId);
    this.commits.delete(txId);
  }

  // Helper to send HTTP requests to other validators
  async broadcast(endpoint, payload) {
    for (const peer of this.peers) {
      try {
        await axios.post(`${peer}${endpoint}`, payload, {
          headers: { 'x-fsp-validator-key': process.env.GATEWAY_API_KEY }
        });
      } catch (err) {
        // In a real PBFT, we handle timeouts and view-changes here.
        console.error(`[Node ${this.nodeId}] Failed to reach peer ${peer}`);
      }
    }
  }
}

module.exports = ConsensusEngine;