const axios = require('axios');
const crypto = require('crypto');

// Ensure the keys are formatted correctly (converting literal \n to actual newlines and trimming spaces)
const formatKey = (key) => key ? key.replace(/\\n/g, '\n').trim() : '';

const privateKey = formatKey(process.env.FSP_APP_PRIVATE_KEY);
const publicKey = formatKey(process.env.FSP_APP_PUBLIC_KEY);

// Fail fast if the key is missing or malformed
if (!privateKey || !privateKey.includes('BEGIN PRIVATE KEY')) {
  console.error("FATAL ERROR: FSP_APP_PRIVATE_KEY is missing or invalid in the environment variables.");
  process.exit(1);
}

// Same deterministic JSON stringification used by the chain
const canonicalJson = (obj) => {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
};

const signTransaction = (payload) => {
  const data = Buffer.from(canonicalJson(payload));
  // For Ed25519, null is passed as the algorithm. It handles hashing internally.
  return crypto.sign(null, data, privateKey).toString('hex');
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
    
    // Print the exact error from the Fly.io node to the Render logs
    const chainError = error.response ? error.response.data : error.message;
    console.error(`[Chain Gateway] Rejected by node. Status: ${error.response?.status}, Reason:`, chainError);
    
    throw new Error(`Chain Gateway Error: ${JSON.stringify(chainError)}`);
  }
}

module.exports = { submitToChain };