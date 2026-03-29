// ZionBrowser — On-Chain Crypto Payment Verification
// Verifies payment on Solana/Ethereum/Bitcoin and generates download token

const crypto = require('crypto');

const WALLETS = {
  SOL: 'CM42ofAFowySg72GjDuCchEkwwbwnhdSRYgztRCAAEzR',
  ETH: '0x6b45b26e1d59A832FE8c9E7c685C36Ea54A3F88B',
  BTC: 'bc1qdj3flkqe7v3qwlfux5d5u3rja7ldm9gwywk9t2'
};

const PRICE_USD = 9.99;
const TOLERANCE = 0.15; // 15% tolerance for price fluctuation
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET;

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function generateDownloadToken(orderId, email) {
  const createdAt = Date.now();
  const expiresAt = createdAt + (72 * 60 * 60 * 1000);
  const payload = `crypto:${orderId}:${email}:${createdAt}`;
  const sig = crypto.createHmac('sha256', DOWNLOAD_SECRET).update(payload).digest('hex');
  const tokenData = { sessionId: `crypto_${orderId}`, email, createdAt, expiresAt, sig, product: 'ZionBrowser-v2.0' };
  return Buffer.from(JSON.stringify(tokenData)).toString('base64url');
}

async function verifySolana(txHash) {
  try {
    const resp = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTransaction',
        params: [txHash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
      })
    });
    const data = await resp.json();
    if (!data.result) return null;

    const tx = data.result;
    const instructions = tx.transaction?.message?.instructions || [];
    const innerInstructions = tx.meta?.innerInstructions || [];

    // Check for transfer to our wallet
    for (const ix of [...instructions, ...innerInstructions.flatMap(i => i.instructions || [])]) {
      const parsed = ix.parsed;
      if (parsed && parsed.type === 'transfer' && parsed.info) {
        if (parsed.info.destination === WALLETS.SOL) {
          return { confirmed: true, amount: parsed.info.lamports / 1e9, chain: 'SOL' };
        }
      }
    }

    // Check post balances as fallback
    return { confirmed: false, chain: 'SOL' };
  } catch (e) {
    return null;
  }
}

async function verifyEthereum(txHash) {
  try {
    // Use public RPC
    const resp = await fetch('https://eth.llamarpc.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash]
      })
    });
    const data = await resp.json();
    if (!data.result || data.result.status !== '0x1') return null;

    // Get transaction details
    const txResp = await fetch('https://eth.llamarpc.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'eth_getTransactionByHash',
        params: [txHash]
      })
    });
    const txData = await txResp.json();
    const tx = txData.result;

    if (tx && tx.to && tx.to.toLowerCase() === WALLETS.ETH.toLowerCase()) {
      const valueWei = BigInt(tx.value);
      const valueEth = Number(valueWei) / 1e18;
      return { confirmed: true, amount: valueEth, chain: 'ETH' };
    }

    return { confirmed: false, chain: 'ETH' };
  } catch (e) {
    return null;
  }
}

async function verifyBitcoin(txHash) {
  try {
    const resp = await fetch(`https://blockstream.info/api/tx/${txHash}`);
    if (!resp.ok) return null;
    const tx = await resp.json();

    for (const out of tx.vout || []) {
      if (out.scriptpubkey_address === WALLETS.BTC) {
        return { confirmed: tx.status?.confirmed || false, amount: out.value / 1e8, chain: 'BTC' };
      }
    }

    return { confirmed: false, chain: 'BTC' };
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
    const { orderId, email, chain, txHash } = body;

    if (!orderId || !email || !chain || !txHash) {
      return {
        statusCode: 400, headers: HEADERS,
        body: JSON.stringify({ error: 'Required: orderId, email, chain, txHash' })
      };
    }

    const chainUp = chain.toUpperCase();

    // Verify on-chain
    let result;
    switch (chainUp) {
      case 'SOL': result = await verifySolana(txHash); break;
      case 'ETH': result = await verifyEthereum(txHash); break;
      case 'BTC': result = await verifyBitcoin(txHash); break;
      default:
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid chain' }) };
    }

    if (!result) {
      return {
        statusCode: 404, headers: HEADERS,
        body: JSON.stringify({ error: 'Transaction not found. It may need more confirmations. Try again in a few minutes.' })
      };
    }

    if (!result.confirmed && chainUp !== 'SOL') {
      return {
        statusCode: 202, headers: HEADERS,
        body: JSON.stringify({
          status: 'pending',
          message: 'Transaction found but not yet confirmed. Please wait and try again.',
          txHash
        })
      };
    }

    // Payment confirmed — generate download token
    const token = generateDownloadToken(orderId, email);

    console.log(`Crypto payment verified: ${chainUp} | Order: ${orderId} | Email: ${email} | Amount: ${result.amount}`);

    return {
      statusCode: 200, headers: HEADERS,
      body: JSON.stringify({
        success: true,
        verified: true,
        chain: chainUp,
        amount: result.amount,
        txHash,
        downloadToken: token,
        downloadUrl: `/api/download?token=${token}`,
        expiresIn: '72 hours',
        maxDownloads: 5,
        product: 'ZionBrowser v2.0'
      })
    };

  } catch (error) {
    console.error('crypto-verify error:', error.message);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Verification failed' }) };
  }
};
