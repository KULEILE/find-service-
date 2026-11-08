const { spawn } = require('child_process');
const path = require('path');

// Path to your blockchain folder
const chainPath = path.join(__dirname, '../../fsp-chain');

const nodes = [
  { id: 1, port: 3001 },
  { id: 2, port: 3002 },
  { id: 3, port: 3003 },
  { id: 4, port: 3004 },
];

console.log("Starting local FSP Chain Cluster...");

nodes.forEach((node) => {
  const child = spawn('node', ['node/index.js', node.id.toString(), node.port.toString()], {
    cwd: chainPath, // Run from the fsp-chain directory
    stdio: 'inherit', // Show node logs in the Render console
    env: process.env // Pass the keys from Render
  });

  child.on('close', (code) => {
    console.log(`[Node ${node.id}] exited with code ${code}`);
  });
});