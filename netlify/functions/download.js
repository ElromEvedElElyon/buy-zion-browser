// ZionBrowser — Secure Download with HMAC Token Verification
// Serves the ZionBrowser ZIP after verifying signed download token

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'zion-padrao-bitcoin-dl-2026';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

// In-memory download counter (resets on deploy, but sufficient for low volume)
const downloadCounts = {};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  try {
    const params = event.queryStringParameters || {};
    const { token } = params;

    if (!token) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Download token required' }) };
    }

    // Decode and verify token
    let tokenData;
    try {
      tokenData = JSON.parse(Buffer.from(token, 'base64url').toString());
    } catch (e) {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Invalid token format' }) };
    }

    const { sessionId, email, createdAt, expiresAt, sig, product } = tokenData;

    // Verify HMAC signature
    const payload = `${sessionId}:${email}:${createdAt}`;
    const expectedSig = crypto.createHmac('sha256', DOWNLOAD_SECRET).update(payload).digest('hex');

    if (sig !== expectedSig) {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Invalid token signature' }) };
    }

    // Check expiration
    if (Date.now() > expiresAt) {
      return {
        statusCode: 410, headers: HEADERS,
        body: JSON.stringify({
          error: 'Download token expired',
          message: 'Your download link has expired. Contact standardbitcoin.io@gmail.com with your payment receipt for a new link.'
        })
      };
    }

    // Check download count (max 5)
    const countKey = sessionId;
    downloadCounts[countKey] = (downloadCounts[countKey] || 0) + 1;
    if (downloadCounts[countKey] > 5) {
      return {
        statusCode: 429, headers: HEADERS,
        body: JSON.stringify({
          error: 'Maximum downloads reached (5)',
          message: 'Contact standardbitcoin.io@gmail.com for additional downloads.'
        })
      };
    }

    // Locate the ZIP file
    const filePaths = [
      path.join(__dirname, '..', '..', 'private', 'ZionBrowser-v2.0.zip'),
      path.join(process.cwd(), 'private', 'ZionBrowser-v2.0.zip')
    ];

    let fileBuffer = null;
    for (const fp of filePaths) {
      try {
        if (fs.existsSync(fp)) {
          fileBuffer = fs.readFileSync(fp);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!fileBuffer) {
      // Fallback: email delivery
      return {
        statusCode: 200, headers: HEADERS,
        body: JSON.stringify({
          success: true,
          message: 'Payment verified! Your ZionBrowser package is being prepared.',
          deliveryMethod: 'email',
          instructions: 'You will receive ZionBrowser-v2.0.zip at your email within 24 hours. If not, contact standardbitcoin.io@gmail.com',
          email: email,
          downloadsUsed: downloadCounts[countKey],
          downloadsRemaining: 5 - downloadCounts[countKey]
        })
      };
    }

    // Serve the ZIP file
    console.log(`Download: ${email} | Session: ${sessionId} | Count: ${downloadCounts[countKey]}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="ZionBrowser-v2.0.zip"',
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'no-store, no-cache',
        'X-Downloads-Remaining': (5 - downloadCounts[countKey]).toString()
      },
      body: fileBuffer.toString('base64'),
      isBase64Encoded: true
    };

  } catch (error) {
    console.error('download error:', error.message);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Download failed' }) };
  }
};
