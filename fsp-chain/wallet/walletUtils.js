
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });
}

function signData(data, privateKey) {
  const message = JSON.stringify(data);

  return crypto.sign(
    null,
    Buffer.from(message),
    privateKey
  ).toString('hex');
}

function verifySignature(data, signature, publicKey) {
  return crypto.verify(
    null,
    Buffer.from(JSON.stringify(data)),
    publicKey,
    Buffer.from(signature, 'hex')
  );
}

function saveWallet(wallet, filename) {
  const walletPath = path.resolve(filename);

  fs.writeFileSync(
    walletPath,
    JSON.stringify(wallet, null, 2),
    { mode: 0o600 }
  );
}

module.exports = {
  generateKeyPair,
  signData,
  verifySignature,
  saveWallet
};
