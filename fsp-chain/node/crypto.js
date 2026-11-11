const crypto = require('crypto');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const canonicalJson = (obj) => {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
};

const getMerkleRoot = (transactions) => {
  if (transactions.length === 0) return sha256('');
  let level = transactions.map(tx => sha256(canonicalJson(tx)));
  while (level.length > 1) {
    const nextLevel = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        nextLevel.push(sha256(level[i] + level[i + 1]));
      } else {
        nextLevel.push(sha256(level[i] + level[i]));
      }
    }
    level = nextLevel;
  }
  return level[0];
};

const signData = (data, privateKeyPem) => {
  const bufferData = Buffer.from(canonicalJson(data));
  return crypto.sign(null, bufferData, privateKeyPem).toString('hex');
};

const verifySignature = (data, signatureHex, publicKeyPem) => {
  try {
    const bufferData = Buffer.from(canonicalJson(data));
    const signatureBuffer = Buffer.from(signatureHex, 'hex');
    return crypto.verify(null, bufferData, publicKeyPem, signatureBuffer);
  } catch {
    return false;
  }
};

module.exports = { sha256, canonicalJson, getMerkleRoot, signData, verifySignature };