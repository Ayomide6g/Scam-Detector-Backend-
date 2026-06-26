import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const RATE_LIMIT = 3;

export default async function handler(req, res) {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = req.query.userId;
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

  // Check if user is Pro/Premium - unlimited forever
  const { data: profile } = await supabase
   .from('profile')
   .select('plan')
   .eq('id', userId)
   .maybeSingle();

  if (profile?.plan === 'pro' || profile?.plan === 'premium') {
    return res.status(200).json({ checksRemaining: 'unlimited', plan: profile.plan });
  }

// Free user logic - FIXED to use user_id + checks_remaining
const { data: row, error } = await supabase
 .from('user_limits')
 .select('checks_used, checks_remaining, window_start')
 .eq('user_id', userId)
 .maybeSingle();

if (error && error.code!== 'PGRST116') {
  return res.status(500).json({ error: error.message });
}

// New user OR new day = reset to 3
if (!row || row.window_start!== today) {
  const { data: upserted } = await supabase
   .from('user_limits')
   .upsert({
      user_id: userId,
      checks_used: 0,
      checks_remaining: RATE_LIMIT,
      window_start: today
    }, { onConflict: 'user_id' })
   .select()
   .single();

  return res.status(200).json({ checksRemaining: upserted.checks_remaining, plan: 'free' });
}

// Same day = return actual remaining
return res.status(200).json({
  checksRemaining: row.checks_remaining,
  plan: 'free',
  used: row.checks_used,
  limit: RATE_LIMIT
});
