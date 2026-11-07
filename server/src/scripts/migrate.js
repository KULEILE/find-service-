const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'database', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Database schema is ready.');
})().catch((e) => { console.error('Migration failed:', e.message); process.exitCode = 1; }).finally(() => pool.end());
