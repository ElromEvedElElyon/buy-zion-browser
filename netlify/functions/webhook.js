// ZionBrowser — Stripe Webhook Handler
// Receives payment events from Stripe and logs them

const crypto = require('crypto');

const STRIPE_SK = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sig = event.headers['stripe-signature'];

  // If webhook secret is configured, verify signature
  if (WEBHOOK_SECRET && sig) {
    try {
      // Manual Stripe signature verification (no SDK needed)
      const timestamp = sig.split(',').find(s => s.startsWith('t=')).split('=')[1];
      const v1Sig = sig.split(',').find(s => s.startsWith('v1=')).split('=')[1];
      const signedPayload = `${timestamp}.${event.body}`;
      const expectedSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(signedPayload).digest('hex');

      if (v1Sig !== expectedSig) {
        console.error('Webhook signature mismatch');
        return { statusCode: 400, body: 'Invalid signature' };
      }
    } catch (e) {
      console.error('Signature verification error:', e.message);
    }
  }

  try {
    const stripeEvent = JSON.parse(event.body);
    console.log(`Stripe webhook: ${stripeEvent.type} | ID: ${stripeEvent.id}`);

    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        console.log(`SALE! Email: ${session.customer_details?.email} | Amount: ${session.amount_total / 100} | Session: ${session.id}`);
        // Payment verified by Stripe. Customer gets download via success page.
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = stripeEvent.data.object;
        console.log(`Payment succeeded: ${pi.id} | Amount: ${pi.amount / 100}`);
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = stripeEvent.data.object;
        console.log(`Payment FAILED: ${pi.id} | Error: ${pi.last_payment_error?.message}`);
        break;
      }

      case 'charge.dispute.created': {
        const dispute = stripeEvent.data.object;
        console.log(`DISPUTE! Charge: ${dispute.charge} | Amount: ${dispute.amount / 100} | Reason: ${dispute.reason}`);
        // Log for review — terms state no chargebacks
        break;
      }

      default:
        console.log(`Unhandled event: ${stripeEvent.type}`);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ received: true })
    };

  } catch (error) {
    console.error('Webhook error:', error.message);
    return { statusCode: 400, body: 'Invalid payload' };
  }
};
