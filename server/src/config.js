require('dotenv').config();
const crypto = require('crypto');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

function need(name, devFallback) {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`Missing required environment variable ${name}`);
  console.warn(`[config] ${name} not set. Using a development default. Do not use this in production.`);
  return devFallback;
}

const keyHex = need('MESSAGE_ENC_KEY', crypto.createHash('sha256').update('dev-only-message-key').digest('hex'));
if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error('MESSAGE_ENC_KEY must be 64 hex characters');

module.exports = {
  isProd,
  port: Number(process.env.PORT || 4000),
  databaseUrl: need('DATABASE_URL', 'postgres://postgres:password@localhost:5432/find_a_service_provider'),
  jwtSecret: need('JWT_SECRET', 'dev-only-jwt-secret-change-me'),
  messageKey: Buffer.from(keyHex, 'hex'),
  origins: [process.env.CLIENT_ORIGIN || 'http://localhost:5173', process.env.SECURITY_ORIGIN || 'http://127.0.0.1:5173']
    .join(',').split(',').map((s) => s.trim()).filter(Boolean),
  otpMode: process.env.OTP_MODE || 'mock',
  blockchainEnabled: process.env.BLOCKCHAIN_ENABLED === 'true',
  uploadDir: path.join(__dirname, '..', 'uploads'),
};
