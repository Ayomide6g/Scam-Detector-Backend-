import { createClient } from '@supabase/supabase-js';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  : null;

const RATE_LIMIT = 3;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { userId } = req.query || {};

  // 1. Check if user is Pro first
  if (supabase && userId) {
    const { data: profile } = await supabase
      .from('profile')
      .select('plan')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.plan === 'pro') {
      return res.status(200).json({
        checksRemaining: 'unlimited',
        isPro: true
      });
    }
  }

  // 2. Use userId as identifier, fall back to IP
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || 'unknown';
  const identifier = userId || ip;

  if (!supabase) return res.status(200).json({ checksRemaining: RATE_LIMIT });

  const { data: record } = await supabase
    .from('rate_limits')
    .select('requests')
    .eq('ip', identifier)
    .maybeSingle();

  const remaining = record && record.requests >= RATE_LIMIT ? 0 : record ? Math.max(RATE_LIMIT - record.requests, 0) : RATE_LIMIT;
  res.status(200).json({ checksRemaining: remaining, isPro: false });
   }
