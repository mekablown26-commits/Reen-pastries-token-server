const https = require('https');

const MPESA_BASE_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

/**
 * Get MPesa OAuth access token
 */
const getMpesaToken = () => {
  return new Promise((resolve, reject) => {
    const credentials = Buffer.from(
      `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString('base64');

    const options = {
      hostname: MPESA_BASE_URL.replace('https://', ''),
      path: '/oauth/v1/generate?grant_type=client_credentials',
      method: 'GET',
      headers: { Authorization: `Basic ${credentials}` },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.access_token);
        } catch {
          reject(new Error('Failed to parse MPesa token response'));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
};

/**
 * Initiate STK Push (Lipa Na MPesa Online)
 * @param {object} params
 * @param {string} params.phoneNumber - Customer phone in 254XXXXXXXXX format
 * @param {number} params.amount - Amount in KES
 * @param {string} params.orderNumber - For reference
 * @param {string} params.accountRef - Display on customer's phone
 */
const initiateSTKPush = async ({ phoneNumber, amount, orderNumber, accountRef }) => {
  const token = await getMpesaToken();

  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const password = Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
  ).toString('base64');

  // Normalise phone number
  const normalised = String(phoneNumber).replace(/^0/, '254').replace(/^\+/, '');

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.ceil(amount), // MPesa requires whole numbers
    PartyA: normalised,
    PartyB: process.env.MPESA_SHORTCODE,
    PhoneNumber: normalised,
    CallBackURL: process.env.MPESA_CALLBACK_URL,
    AccountReference: accountRef || `RP-${orderNumber}`,
    TransactionDesc: `Reen Pastries Order ${orderNumber}`,
  };

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: MPESA_BASE_URL.replace('https://', ''),
      path: '/mpesa/stkpush/v1/processrequest',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Failed to parse STK push response'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
};

/**
 * Query STK push status
 */
const queryStkStatus = async (checkoutRequestId) => {
  const token = await getMpesaToken();
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const password = Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
  ).toString('base64');

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: MPESA_BASE_URL.replace('https://', ''),
      path: '/mpesa/stkpushquery/v1/query',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Parse error')); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
};

module.exports = { initiateSTKPush, queryStkStatus, getMpesaToken };
