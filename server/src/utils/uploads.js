const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { HttpError } = require('./helpers');

const dirs = {
  messages: path.join(config.uploadDir, 'private', 'messages'),   // never served publicly
  requests: path.join(config.uploadDir, 'private', 'requests'),   // never served publicly
  profiles: path.join(config.uploadDir, 'profiles'),               // public profile pictures
};
Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const imageOnly = (req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new HttpError(400, 'Only JPG, PNG or WebP images are allowed.')));
const storage = (dir) => multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + EXT[file.mimetype]),   // random name, extension from checked type
});
const make = (dir, files) => multer({ storage: storage(dir), fileFilter: imageOnly, limits: { fileSize: 5 * 1024 * 1024, files } });

function removeFiles(paths) {
  for (const p of paths || []) { try { fs.unlinkSync(p); } catch { /* already gone */ } }
}

module.exports = {
  dirs, removeFiles,
  messageUpload: make(dirs.messages, 1),
  requestUpload: make(dirs.requests, 3),
  profileUpload: make(dirs.profiles, 1),
};
