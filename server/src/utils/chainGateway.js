const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');

// Ensure the keys are formatted correctly (converting literal \n to actual newlines)
const formatKey = (key) => key ? key.replace(/\\n/g, '\n') : '';

const privateKey = formatKey(process.env.FSP_APP_PRIVATE_KEY);
const publicKey = formatKey(process.env.FSP_APP_PUBLIC_KEY);

// Same deterministic JSON stringification used by the chain
const canonicalJson = (obj) => {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
};

const signTransaction = (payload) => {
  const sign = crypto.createSign('SHA256');
  sign.update(canonicalJson(payload));
  return sign.sign(privateKey, 'hex');
};

async function submitToChain(event) {
  const envelope = {
    transactionId: event.transaction_id,
    networkId: 'FSP-MAIN',
    schemaVersion: 1,
    transactionType: event.event_type,
    entityReference: event.entity_reference,
    eventTimestamp: event.created_at.toISOString(),
    payload: event.payload,
    payloadCommitment: event.payload_commitment,
    submitterIdentity: 'fsp-application'
  };

  // Sign the envelope
  envelope.digitalSignature = signTransaction(envelope);

  try {
    const response = await axios.post(`${process.env.CHAIN_NODE_URL}/transactions`, envelope, {
      headers: {
        'x-fsp-gateway-key': process.env.GATEWAY_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    return response.data; // Returns { status: 'PENDING', transactionId: '...' }
  } catch (error) {
    if (error.response && error.response.status === 409) {
      // Idempotency: This transaction was already submitted
      return { status: 'ALREADY_SUBMITTED', transactionId: event.transaction_id };
    }
    throw new Error(`Chain Gateway Error: ${error.response ? error.response.data.error : error.message}`);
  }
}

module.exports = { submitToChain };