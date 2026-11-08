const { spawn } = require('child_process');

const nodes = [
  { id: 1, port: 3001 },
  { id: 2, port: 3002 },
  { id: 3, port: 3003 },
  { id: 4, port: 3004 },
];

console.log("Starting all 4 FSP Chain validators in one container...");

nodes.forEach((node) => {
  const child = spawn('node', ['node/index.js', node.id.toString(), node.port.toString()], {
    stdio: 'inherit', // This pipes the logs of all 4 nodes to the main console
    env: process.env
  });

  child.on('close', (code) => {
    console.log(`[Node ${node.id}] exited with code ${code}`);
  });
});