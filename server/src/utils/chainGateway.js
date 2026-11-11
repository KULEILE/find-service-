const axios = require('axios');
const crypto = require('crypto');

const formatKey = (key) => key ? key.replace(/\\n/g, '\n').trim() : '';
const privateKey = formatKey(process.env.FSP_APP_PRIVATE_KEY);

const canonicalJson = (obj) => {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
};

const signTransaction = (payload) => {
  const data = Buffer.from(canonicalJson(payload));
  return crypto.sign(null, data, privateKey).toString('hex');
};

async function submitToChain(event) {
  const envelope = {
    transactionId: event.transaction_id,
    eventType: event.event_type,
    timestamp: event.created_at.toISOString(),
    payload: event.payload
  };

  envelope.digitalSignature = signTransaction(envelope);

  try {
    const response = await axios.post(`${process.env.CHAIN_NODE_URL}/transactions`, envelope, {
      headers: { 'x-fsp-gateway-key': process.env.GATEWAY_API_KEY, 'Content-Type': 'application/json' }
    });
    return response.data; 
  } catch (error) {
    if (error.response && error.response.status === 409) {
      return { status: 'ALREADY_SUBMITTED', transactionId: event.transaction_id };
    }
    throw new Error(`Chain Gateway Error: ${JSON.stringify(error.response?.data || error.message)}`);
  }
}

module.exports = { submitToChain };