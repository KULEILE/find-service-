// Genesis Block Setup
(async () => {
  const latest = await storage.getLatestBlock();
  if (!latest) {
    const genesis = {
      height: 0,
      hash: sha256('GENESIS_FSP_CHAIN'),
      previous_hash: '0'.repeat(64),
      merkle_root: sha256(''),
      timestamp: Date.now()
    };
    await storage.commitBlock(genesis, []);
    console.log(`[Node ${NODE_ID}] Genesis block created.`);
  }

  // Initialize consensus with the correct sequence number from the DB
  await consensus.initialize();
  
  app.listen(PORT, () => {
    console.log(`[FSP Chain Validator ${NODE_ID}] running on port ${PORT}`);
  });
})();