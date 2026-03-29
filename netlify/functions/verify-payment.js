// ZionBrowser — Verify Stripe Payment & Generate Download Token
// After successful Stripe Checkout, client calls this with session_id
// We verify with Stripe API and return a signed download token

const crypto = require('crypto');

const STRIPE_SK = process.env.STRIPE_SECRET_KEY;
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'zion-padrao-bitcoin-dl-2026';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function generateDownloadToken(sessionId, email) {
  const createdAt = Date.now();
  const expiresAt = createdAt + (72 * 60 * 60 * 1000); // 72 hours
  const payload = `${sessionId}:${email}:${createdAt}`;
  const sig = crypto.createHmac('sha256', DOWNLOAD_SECRET).update(payload).digest('hex');
  const tokenData = { sessionId, email, createdAt, expiresAt, sig, product: 'ZionBrowser-v2.0' };
  return Buffer.from(JSON.stringify(tokenData)).toString('base64url');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'POST only' }) };
  }

  if (!STRIPE_SK) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server config error' }) };
  }

  try {
    const { session_id } = JSON.parse(event.body || '{}');

    if (!session_id) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'session_id required' }) };
    }

    // Verify with Stripe API
    const stripeResp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
      headers: { 'Authorization': `Bearer ${STRIPE_SK}` }
    });

    if (!stripeResp.ok) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid session' }) };
    }

    const session = await stripeResp.json();

    // Must be paid
    if (session.payment_status !== 'paid') {
      return {
        statusCode: 402, headers: HEADERS,
        body: JSON.stringify({ error: 'Payment not completed', status: session.payment_status })
      };
    }

    const email = session.customer_details?.email || session.customer_email || 'unknown';
    const token = generateDownloadToken(session.id, email);

    return {
      statusCode: 200, headers: HEADERS,
      body: JSON.stringify({
        success: true,
        paid: true,
        email,
        downloadToken: token,
        downloadUrl: `/api/download?token=${token}`,
        expiresIn: '72 hours',
        maxDownloads: 5,
        product: 'ZionBrowser v2.0 - AI Agent Browser Toolkit'
      })
    };

  } catch (error) {
    console.error('verify-payment error:', error.message);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Verification failed' }) };
  }
};
