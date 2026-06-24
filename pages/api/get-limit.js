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
  const todayStart = new Date();
todayStart.setHours(0, 0, 0, 0);
const todayEnd = new Date();
todayEnd.setHours(23, 59, 59, 999);

const { data, error } = await supabase
  .from('rate_limits')
  .select('requests')
  .eq('ip', identifier)
  .gte('window_st', todayStart.toISOString())
  .lte('window_st', todayEnd.toISOString())
  .maybeSingle();

if (error) {
  console.error('Rate limit fetch error:', error);
  return res.status(500).json({ error: 'Rate limit check failed' });
}

const used = data?.requests ?? 0;
const remaining = Math.max(RATE_LIMIT - used, 0);
res.status(200).json({ checksRemaining: remaining, isPro: false });
}
