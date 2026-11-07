const Database = require('better-sqlite3');
const path = require('path');

class Storage {
  constructor(nodeId) {
    this.db = new Database(path.join(__dirname, `..`, `node${nodeId}.db`));
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blocks (
        height INTEGER PRIMARY KEY,
        hash TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        merkle_root TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transactions (
        transaction_id TEXT PRIMARY KEY,
        block_height INTEGER,
        envelope TEXT NOT NULL,
        FOREIGN KEY(block_height) REFERENCES blocks(height)
      );
    `);
  }

  getLatestBlock() {
    return this.db.prepare('SELECT * FROM blocks ORDER BY height DESC LIMIT 1').get();
  }

  getBlock(height) {
    return this.db.prepare('SELECT * FROM blocks WHERE height = ?').get(height);
  }

  getTransaction(txId) {
    const row = this.db.prepare('SELECT * FROM transactions WHERE transaction_id = ?').get(txId);
    return row ? JSON.parse(row.envelope) : null;
  }

  // Save a committed block and its transactions
  commitBlock(block, transactions) {
    const insertBlock = this.db.prepare('INSERT INTO blocks (height, hash, previous_hash, merkle_root, timestamp) VALUES (?, ?, ?, ?, ?)');
    const insertTx = this.db.prepare('INSERT INTO transactions (transaction_id, block_height, envelope) VALUES (?, ?, ?)');

    const transaction = this.db.transaction(() => {
      insertBlock.run(block.height, block.hash, block.previous_hash, block.merkle_root, block.timestamp);
      for (const tx of transactions) {
        insertTx.run(tx.transactionId, block.height, JSON.stringify(tx));
      }
    });
    transaction();
  }
}

module.exports = Storage;