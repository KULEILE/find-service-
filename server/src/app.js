const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { ZodError } = require('zod');
const config = require('./config');
const { HttpError } = require('./utils/helpers');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({ origin: config.origins, credentials: true }));
app.use(express.json({ limit: '100kb' }));

// Only profile pictures are public. Chat and request photos are never served from a folder.
app.use('/uploads/profiles', express.static(path.join(config.uploadDir, 'profiles'), { maxAge: '7d', index: false }));

const api = express.Router();
api.use('/admin/blockchain', require('./routes/blockchain'));
api.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please slow down.' } }));
api.get('/health', (req, res) => res.json({ ok: true }));
api.use('/auth', require('./routes/auth'));
api.use('/customer', require('./routes/customer'));
api.use('/requests', require('./routes/requests'));
api.use('/conversations', require('./routes/messages'));
api.use('/provider', require('./routes/provider'));
api.use('/notifications', require('./routes/notifications'));
api.use('/admin', require('./routes/admin'));
api.use('/security', require('./routes/security'));
api.use('/', require('./routes/catalog'));
api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use('/api', api);

// If the React app has been built, serve it from here too (single server hosting).
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|uploads|socket\.io).*/, (req, res) => {
    const file = req.path.startsWith('/security') ? 'security.html' : 'index.html';
    res.sendFile(path.join(dist, file));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    const i = err.issues[0];
    return res.status(400).json({ error: (i.path.length ? i.path.join('.') + ': ' : '') + i.message });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.name === 'MulterError') return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That image is too large. The limit is 5 MB.' : 'The upload was not accepted.' });
  if (err.code === '22P02') return res.status(404).json({ error: 'Not found.' });   // badly formed id
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

module.exports = app;
