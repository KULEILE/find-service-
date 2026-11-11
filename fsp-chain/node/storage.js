const { Pool } = require('pg');

class Storage {
  constructor(nodeId) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error(`FATAL: Missing DATABASE_URL environment variable.`);
      process.exit(1);
    }

    this.pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    this.initPromise = this.init();
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        height INTEGER PRIMARY KEY,
        hash TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        merkle_root TEXT NOT NULL,
        timestamp BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transactions (
        transaction_id TEXT PRIMARY KEY,
        block_height INTEGER,
        envelope TEXT NOT NULL,
        FOREIGN KEY(block_height) REFERENCES blocks(height)
      );
    `);
  }

  async getLatestBlock() {
    await this.initPromise;
    const res = await this.pool.query('SELECT * FROM blocks ORDER BY height DESC LIMIT 1');
    return res.rows[0];
  }

  async getTransaction(txId) {
    await this.initPromise;
    const res = await this.pool.query('SELECT * FROM transactions WHERE transaction_id = $1', [txId]);
    return res.rows[0] ? JSON.parse(res.rows[0].envelope) : null;
  }

  async commitBlock(block, transactions) {
    await this.initPromise;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO blocks (height, hash, previous_hash, merkle_root, timestamp) VALUES ($1, $2, $3, $4, $5)',
        [block.height, block.hash, block.previous_hash, block.merkle_root, block.timestamp]
      );
      for (const tx of transactions) {
        await client.query(
          'INSERT INTO transactions (transaction_id, block_height, envelope) VALUES ($1, $2, $3)',
          [tx.transactionId, block.height, JSON.stringify(tx)]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

module.exports = Storage;