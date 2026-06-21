// /api/paystack-webhook.js
import crypto from 'crypto';

export default async function handler(req, res) {
  // 1. Verify it's really Paystack calling us
  const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');
    
  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  
  // 2. Handle subscription events
  if (event.event === 'subscription.create') {
    const { customer, plan, subscription_code, status } = event.data;
    const userId = event.data.metadata?.userId; // We sent this in step 1
  
    console.log(`User ${userId} is now Pro`);
  }

  // 3. Handle failed payments
  if (event.event === 'invoice.payment_failed') {
    const userId = event.data.metadata?.userId;
    // TODO: MARK USER AS NOT PRO
    console.log(`Payment failed for user ${userId}`);
  }

  res.status(200).json({ received: true });
}
