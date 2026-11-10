
const fs = require('fs');

class ColdWallet {
  constructor(walletFile) {
    this.walletFile = walletFile;
  }

  exportPublicKey() {
    const wallet = JSON.parse(
      fs.readFileSync(this.walletFile, 'utf8')
    );

    return wallet.publicKey;
  }

  // Cold wallet does not automatically sign
  // online application transactions.
}

module.exports = ColdWallet;
