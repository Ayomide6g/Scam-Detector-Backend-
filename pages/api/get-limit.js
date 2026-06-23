import { createClient } from '@supabase/supabase-js';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_KEY
? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  : null;

const RATE_LIMIT = 3;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Fix: Check both body and query for userId
  const userId = req.body?.userId || req.query?.userId;

  // 1. Check if user is Pro first
  if (supabase && userId) {
    const { data: profile } = await supabase
   .from('profile')
   .select('plan')
   .eq('id', userId)
   .maybeSingle();

    if (profile?.plan === 'pro') {
      return res.status(200).json({ checksRemaining: 'unlimited', isPro: true });
    }
  }

  // 2. Use userId as identifier, fall back to IP
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded? forwarded.split(',')[0].trim() : req.socket.remoteAddress || 'unknown';
  const identifier = userId || ip;

  if (!supabase) return res.status(200).json({ checksRemaining: RATE_LIMIT });

  const today = new Date().toISOString().split('T')[0];

  // 3. Call atomic RPC to check + reserve slot WITHOUT consuming yet
  const { data, error } = await supabase.rpc('check_and_reserve_slot', {
    p_identifier: identifier,
    p_today: today,
    p_rate_limit: RATE_LIMIT
  });

  if (error) {
    console.error('Rate limit RPC error:', error);
    return res.status(500).json({ error: 'Rate limit check failed' });
  }

  const { requests, blocked } = data[0];

  // 4. Return 429 if limit reached
  if (blocked) {
    return res.status(429).json({ 
      error: 'Daily limit reached', 
      checksRemaining: 0,
      isPro: false 
    });
  }

  // 5. If we got here, slot is reserved. Return remaining
  // Request only gets consumed after successful scan in your main endpoint
  const remaining = Math.max(RATE_LIMIT - requests, 0);
  res.status(200).json({ checksRemaining: remaining, isPro: false });
}
