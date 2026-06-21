import { createClient } from '@supabase/supabase-js';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_KEY
 ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  : null;

const RATE_LIMIT = 3;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { userId } = req.body || req.query || {};

  // 1. Check if user is Pro first
  if (supabase && userId) {
    const { data: user } = await supabase
     .from('users')
     .select('is_pro')
     .eq('id', userId)
     .maybeSingle();

    if (user?.is_pro === true) {
      return res.status(200).json({
        checksRemaining: 'unlimited',
        isPro: true
      });
    }
  }

  // 2. If not Pro, run your existing IP-based 3/day logic
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded? forwarded.split(',')[0].trim() : req.socket.remoteAddress || 'unknown';

  if (!supabase) return res.status(200).json({ checksRemaining: RATE_LIMIT });

  const { data: record } = await supabase
   .from('rate_limits')
   .select('requests')
   .eq('ip', ip)
   .maybeSingle();

  const remaining = record? Math.max(RATE_LIMIT - record.requests, 0) : RATE_LIMIT;
  res.status(200).json({ checksRemaining: remaining, isPro: false });
}
