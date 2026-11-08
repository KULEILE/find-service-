const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Try to find the fsp-chain directory
let chainPath = path.join(__dirname, '../../fsp-chain');
if (!fs.existsSync(chainPath)) {
  chainPath = path.join(__dirname, '../fsp-chain');
}
if (!fs.existsSync(chainPath)) {
  console.error("❌ Could not find fsp-chain directory at", chainPath);
  process.exit(1);
}

console.log(`📂 Found blockchain code at: ${chainPath}`);
console.log("🚀 Starting FSP Chain Cluster (4 Validators)...");

const nodes = [
  { id: 1, port: 3001 },
  { id: 2, port: 3002 },
  { id: 3, port: 3003 },
  { id: 4, port: 3004 },
];

nodes.forEach((node) => {
  const child = spawn('node', ['node/index.js', node.id.toString(), node.port.toString()], {
    cwd: chainPath, 
    stdio: 'inherit', 
    env: process.env 
  });

  child.on('error', (err) => {
    console.error(`❌ Failed to start Node ${node.id}:`, err);
  });
});