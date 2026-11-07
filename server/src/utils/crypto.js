const crypto = require('crypto');
const config = require('../config');

// AES-256-GCM: encrypts and also detects tampering. Stored as iv:tag:cipher (base64).
function encrypt(text) {
  if (text == null || text === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.messageKey, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(payload) {
  if (!payload) return '';
  try {
    const [iv, tag, enc] = payload.split(':').map((p) => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', config.messageKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '[message could not be decrypted]';
  }
}

const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Same object always gives the same text, so the same hash.
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

const hmac = (value) => crypto.createHmac('sha256', config.jwtSecret).update(String(value)).digest('hex');
const randomCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

module.exports = { encrypt, decrypt, sha256Hex, canonicalJson, hmac, randomCode, safeEqual };
