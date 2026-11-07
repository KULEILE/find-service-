const { Pool, types } = require('pg');
const config = require('./config');

// Return DATE columns as plain 'YYYY-MM-DD' text so time zones never shift a date.
types.setTypeParser(1082, (v) => v);

// Hosted databases (Render and similar) require SSL. A database on your own computer does not.
const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(config.databaseUrl);
const ssl = isLocal ? undefined : { rejectUnauthorized: false };
const pool = new Pool({ connectionString: config.databaseUrl, ssl });

const query = (text, params) => pool.query(text, params);

// Run several queries as one all-or-nothing unit.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };