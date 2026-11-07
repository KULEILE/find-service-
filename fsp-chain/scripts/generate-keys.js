const { generateKeyPair } = require('../node/crypto');
const fs = require('fs');
const path = require('path');

console.log("Generating Ed25519 Keypairs...\n");

const backendKeys = generateKeyPair();
const validator1 = generateKeyPair();
const validator2 = generateKeyPair();
const validator3 = generateKeyPair();
const validator4 = generateKeyPair();

const envContent = `
# FSP Backend Keys (Used to sign transactions before sending to the chain)
FSP_APP_PUBLIC_KEY="${backendKeys.publicKey.replace(/\n/g, '\\n')}"
FSP_APP_PRIVATE_KEY="${backendKeys.privateKey.replace(/\n/g, '\\n')}"

# Validator 1 Keys
VAL1_PUBLIC="${validator1.publicKey.replace(/\n/g, '\\n')}"
VAL1_PRIVATE="${validator1.privateKey.replace(/\n/g, '\\n')}"

# Validator 2 Keys
VAL2_PUBLIC="${validator2.publicKey.replace(/\n/g, '\\n')}"
VAL2_PRIVATE="${validator2.privateKey.replace(/\n/g, '\\n')}"

# Validator 3 Keys
VAL3_PUBLIC="${validator3.publicKey.replace(/\n/g, '\\n')}"
VAL3_PRIVATE="${validator3.privateKey.replace(/\n/g, '\\n')}"

# Validator 4 Keys
VAL4_PUBLIC="${validator4.publicKey.replace(/\n/g, '\\n')}"
VAL4_PRIVATE="${validator4.privateKey.replace(/\n/g, '\\n')}"

# Gateway Security
GATEWAY_API_KEY="super-secret-gateway-key-123"
`;

fs.writeFileSync(path.join(__dirname, '..', '.env'), envContent);
console.log("✅ Keys generated and saved to fsp-chain/.env");
console.log("⚠️  IMPORTANT: Copy FSP_APP_PUBLIC_KEY and FSP_APP_PRIVATE_KEY to your server/.env as well!");