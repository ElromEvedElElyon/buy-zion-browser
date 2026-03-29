// ZionBrowser — Create Crypto Payment Order
// Generates order with real-time price via CoinGecko

const crypto = require('crypto');

const WALLETS = {
  SOL: 'CM42ofAFowySg72GjDuCchEkwwbwnhdSRYgztRCAAEzR',
  ETH: '0x6b45b26e1d59A832FE8c9E7c685C36Ea54A3F88B',
  BTC: 'bc1qdj3flkqe7v3qwlfux5d5u3rja7ldm9gwywk9t2'
};

const PRICE_USD = 9.99;
const HMAC_SECRET = process.env.HMAC_SECRET || 'zion-crypto-order-2026';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

async function getCryptoPrice(coin) {
  const ids = { SOL: 'solana', ETH: 'ethereum', BTC: 'bitcoin' };
  const id = ids[coin];
  if (!id) return null;
  try {
    const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
    const data = await resp.json();
    return data[id]?.usd || null;
  } catch (e) {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { email, chain } = body;

    if (!email || !chain) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Required: email, chain (SOL/ETH/BTC)' }) };
    }

    const chainUp = chain.toUpperCase();
    if (!WALLETS[chainUp]) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid chain. Use SOL, ETH, or BTC' }) };
    }

    // Generate unique order ID
    const orderId = crypto.randomBytes(12).toString('hex');
    const memo = orderId.substring(0, 8);

    // Get real-time crypto price
    const pricePerToken = await getCryptoPrice(chainUp);
    if (!pricePerToken) {
      return { statusCode: 503, headers: HEADERS, body: JSON.stringify({ error: 'Price feed unavailable. Try again.' }) };
    }

    const amountToken = PRICE_USD / pricePerToken;

    // HMAC-sign the order
    const orderData = `${orderId}:${email}:${chainUp}:${Date.now()}`;
    const orderSignature = crypto.createHmac('sha256', HMAC_SECRET).update(orderData).digest('hex');

    return {
      statusCode: 200, headers: HEADERS,
      body: JSON.stringify({
        success: true,
        order: {
          orderId,
          product: 'ZionBrowser v2.0',
          priceUsd: PRICE_USD,
          chain: chainUp,
          amountToken: parseFloat(amountToken.toFixed(8)),
          pricePerToken,
          recipientWallet: WALLETS[chainUp],
          memo,
          orderSignature,
          expiresAt: Date.now() + (30 * 60 * 1000), // 30 min
          instructions: `Send exactly ${amountToken.toFixed(8)} ${chainUp} to ${WALLETS[chainUp]}`
        }
      })
    };
  } catch (error) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server error' }) };
  }
};
