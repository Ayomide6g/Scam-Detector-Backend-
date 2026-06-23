import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, userId } = req.body;
  if (!email || !userId) return res.status(400).json({ error: 'Missing email or userId' });

  try {
    const { data: profile } = await supabase.from('profile').select('subscription_status, trial_ends_at').eq('id', userId).single();
    if (profile?.subscription_status === 'active') return res.status(400).json({ error: 'Already active' });
    if (profile?.subscription_status === 'trialing' && new Date(profile.trial_ends_at) > new Date()) return res.status(400).json({ error: 'Already on trial' });

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        amount: 5000,
        channels: ['card'],
        metadata: { userId: userId, purpose: 'trial_verification' },
        callback_url: 'https://scam-detector-backend.vercel.app/api/paystack-callback',
      }),
    });

    const data = await response.json();
    if (!data.status) return res.status(400).json({ error: data.message });

    await supabase.from('payment_references').insert({ reference: data.data.reference, user_id: userId, purpose: 'trial_verification' });

    res.status(200).json({
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
      reference: data.data.reference
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to initialize trial' });
  }
      }
