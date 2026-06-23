// pages/api/cron/charge-trials.js
import { createClient } from '@supabase/supabase-js';

export const config = {
  maxDuration: 60, // 60s timeout for cron
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // 1. Secure the cron endpoint
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 2. Get all users whose trial expired today and haven't been charged
    const { data: expiredTrials, error } = await supabase
      .from('profile')
      .select('id, email, paystack_auth_code, paystack_customer_code')
      .eq('subscription_status', 'trialing')
      .lte('trial_ends_at', new Date().toISOString())
      .not('paystack_auth_code', 'is', null);

    if (error) throw error;
    if (!expiredTrials.length) {
      return res.status(200).json({ message: 'No trials to charge' });
    }

    const results = [];
    
    for (const user of expiredTrials) {
      try {
        // 3. Create subscription on Paystack using saved auth
        const subRes = await fetch('https://api.paystack.co/subscription', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            customer: user.paystack_customer_code,
            plan: 'PLN_ohpfbish1gkugvk', // Your ₦1000/month plan
            authorization: user.paystack_auth_code,
            start_date: new Date().toISOString(), // Start now
          }),
        });

        const subData = await subRes.json();

        if (!subData.status) {
          // Mark as past_due if charge fails
          await supabase
            .from('profile')
            .update({ 
              subscription_status: 'past_due',
              is_pro: false,
              updated_at: new Date().toISOString()
            })
            .eq('id', user.id);
          
          results.push({ userId: user.id, status: 'failed', reason: subData.message });
          continue;
        }

        // 4. Update DB: trial ended, sub is now active
        await supabase
          .from('profile')
          .update({
            subscription_status: 'active',
            is_pro: true,
            subscription_code: subData.data.subscription_code,
            next_payment_date: subData.data.next_payment_date,
            trial_ends_at: null, // Clear trial
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);

        results.push({ userId: user.id, status: 'success' });

      } catch (userError) {
        console.error(`Failed to charge user ${user.id}:`, userError);
        results.push({ userId: user.id, status: 'error', reason: userError.message });
      }
    }

    res.status(200).json({ charged: results.length, results });

  } catch (error) {
    console.error('cron error:', error);
    res.status(500).json({ error: 'Cron job failed' });
  }
}
