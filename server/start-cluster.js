const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// When running from Render root, fsp-chain is one level up from 'server'
const chainPath = path.resolve(__dirname, '../fsp-chain');

console.log(`📂 Looking for blockchain code at: ${chainPath}`);

if (!fs.existsSync(chainPath)) {
  console.error(`❌ FATAL: Could not find fsp-chain directory at ${chainPath}`);
  process.exit(1);
}

console.log("🚀 Starting FSP Chain Cluster (4 Validators)...");

const nodes = [
  { id: 1, port: 3001 },
  { id: 2, port: 3002 },
  { id: 3, port: 3003 },
  { id: 4, port: 3004 },
];

nodes.forEach((node) => {
  // Using 'npm start' or direct node execution
  const child = spawn('node', ['node/index.js', node.id.toString(), node.port.toString()], {
    cwd: chainPath, 
    stdio: 'inherit', 
    env: process.env 
  });

  child.on('error', (err) => {
    console.error(`❌ Failed to start Node ${node.id}:`, err);
  });
});