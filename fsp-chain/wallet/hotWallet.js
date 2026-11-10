
const fs = require('fs');
const { signData, verifySignature } = require('./walletUtils');

class HotWallet {
  constructor(walletFile) {
    this.wallet = JSON.parse(
      fs.readFileSync(walletFile, 'utf8')
    );
  }

  signTransaction(transaction) {
    return signData(
      transaction,
      this.wallet.privateKey
    );
  }

  getPublicKey() {
    return this.wallet.publicKey;
  }
}

module.exports = HotWallet;
