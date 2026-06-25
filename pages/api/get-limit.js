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

  const today = new Date().toISOString().split('T')[0];

  // Check if user is Pro/Premium - unlimited forever
  const { data: profile } = await supabase
   .from('profile')
   .select('plan')
   .eq('id', userId)
   .maybeSingle();

  if (profile?.plan === 'pro' || profile?.plan === 'premium') {
    return res.status(200).json({ checksRemaining: 'unlimited', plan: profile.plan });
  }

  // READ ONLY - Free user logic
  const { data: record } = await supabase
   .from('rate_limits')
   .select('requests, window_start')
   .eq('ip', String(userId)) // Using userId as the identifier so it follows them everywhere
   .maybeSingle();

  // New user or first check ever = 3 checks
  if (!record) {
    return res.status(200).json({ checksRemaining: RATE_LIMIT, plan: 'free' });
  }

  // New day = reset to 3. But we DON'T write to DB here. POST will handle the reset.
  if (record.window_start!== today) {
    return res.status(200).json({ checksRemaining: RATE_LIMIT, plan: 'free' });
  }

  // Same day - return actual remaining
  const used = record.requests?? 0;
  const remaining = Math.max(RATE_LIMIT - used, 0);

  return res.status(200).json({
    checksRemaining: remaining,
    plan: 'free',
    used: used,
    limit: RATE_LIMIT
  });
  }
