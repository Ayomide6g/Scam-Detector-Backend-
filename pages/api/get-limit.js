import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const RATE_LIMIT = 3;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = req.query.userId;
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || 'unknown';
  const identifier = userId || ip;
  const today = new Date().toISOString().split('T')[0];

  if (userId) {
  const { data: profile } = await supabase
    .from('profile')
    .select('plan')
    .eq('id', userId)
    .maybeSingle();
  if (profile?.plan === 'pro') {
    return res.status(200).json({ checksRemaining: 'unlimited' });
  }
  }

  const { data: record } = await supabase
    .from('rate_limits')
    .select('*')
    .eq('ip', identifier)
    .maybeSingle();

  if (!record || record.window_st !== today) {
    return res.status(200).json({ checksRemaining: 3 });
  }

  return res.status(200).json({ checksRemaining: Math.max(RATE_LIMIT - record.requests, 0) });
}
