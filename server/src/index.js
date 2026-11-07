const http = require('http');
const cron = require('node-cron');
const config = require('./config');
const { pool } = require('./db');
const app = require('./app');
const { initSocket } = require('./socket');
const { runRetention } = require('./jobs/retention');

async function main() {
  await pool.query('SELECT 1');   // fail early if the database is not reachable
  const server = http.createServer(app);
  initSocket(server);
  cron.schedule('0 2 * * *', () => runRetention().catch((e) => console.error('retention failed', e)));   // every night at 02:00
  server.listen(config.port, () => console.log(`Find a Service Provider API running on port ${config.port}`));
  const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => { console.error('Could not start:', e.message); process.exit(1); });
