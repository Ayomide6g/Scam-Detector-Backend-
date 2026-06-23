// pages/api/paystack-callback.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const { reference } = req.query;
  if (!reference) return res.status(400).send('Missing reference');

  try {
    // 1. Verify the transaction with Paystack
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.status || verifyData.data.status !== 'success') {
      return res.redirect(302, 'https://yourapp.com/payment-failed'); // Change to your app URL
    }

    // 2. Get userId from our saved reference
    const { data: refData } = await supabase
      .from('payment_references')
      .select('user_id')
      .eq('reference', reference)
      .single();

    if (!refData) throw new Error('Reference not found');
    const userId = refData.user_id;

    const { customer, authorization } = verifyData.data;

    // 3. Save customer + auth details + start 7 day trial
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    const { error } = await supabase
      .from('profile')
      .update({
        email: customer.email,
        paystack_customer_code: customer.customer_code,
        paystack_auth_code: authorization.authorization_code,
        paystack_auth_signature: authorization.signature,
        card_last4: authorization.last4,
        card_type: authorization.card_type,
        subscription_status: 'trialing',
        is_pro: true, // Give pro access during trial
        trial_started_at: new Date().toISOString(),
        trial_ends_at: trialEndsAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) throw error;

    // 4. Redirect user to success page in your app
    res.redirect(302, 'https://yourapp.com/payment-success'); // Change to your app URL

  } catch (error) {
    console.error('callback error:', error);
    res.redirect(302, 'https://yourapp.com/payment-failed'); // Change to your app URL
  }
}
