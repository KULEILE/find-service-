const config = require('../config');

async function sendOtp(phone, code) {
  if (config.otpMode === 'mock') {
    console.log(`[OTP mock] code for ${phone}: ${code}`);
    return;
  }
  // Connect an SMS provider here (for example Africa's Talking or Twilio), then send:
  // `Your Find a Service Provider code is ${code}. It expires in 5 minutes.`
  throw new Error('SMS provider is not configured. Set OTP_MODE=mock for demos.');
}

module.exports = { sendOtp };
