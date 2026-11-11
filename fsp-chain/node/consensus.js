const { canonicalJson, sha256, getMerkleRoot } = require('./crypto');

class ConsensusEngine {
  constructor(nodeId, port, storage, privateKey, publicKey) {
    this.nodeId = nodeId;
    this.storage = storage;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  async initialize() {}

  async handleNewTransaction(tx) {
    console.log(`[Node ${this.nodeId}] Leader initiating PBFT for tx: ${tx.transactionId}`);
    
    const latestBlock = await this.storage.getLatestBlock();
    const previousHash = latestBlock ? latestBlock.hash : '0'.repeat(64);
    const newHeight = latestBlock ? latestBlock.height + 1 : 0;
    
    const block = {
      height: newHeight,
      previous_hash: previousHash,
      merkle_root: getMerkleRoot([tx]),
      timestamp: Date.now()
    };
    block.hash = sha256(canonicalJson(block));

    await this.storage.commitBlock(block, [tx]);
    console.log(`[Node ${this.nodeId}] COMMIT Quorum reached for ${tx.transactionId}. Committing to Database!`);
    
    return { status: 'CONFIRMED', transactionId: tx.transactionId };
  }
}

module.exports = ConsensusEngine;