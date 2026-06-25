import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const RATE_LIMIT = 3;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, userId } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });

  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || 'unknown';
  const identifier = userId || ip;
  const today = new Date().toISOString().split('T')[0];

  // Pro bypass
if (userId) {
  const { data: profile } = await supabase
    .from('profile')
    .select('plan')
    .eq('id', userId)
    .maybeSingle();
  if (profile?.plan === 'pro') {
    const response = await fetch('https://scam-detector-backend.vercel.app/api/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.API_KEY
      },
      body: JSON.stringify({ text, userId })
    });
    const data = await response.json();
    return res.status(200).json({ ...data, checksRemaining: 'unlimited' });
  }
}

  // Get or create record
  let { data: record } = await supabase
    .from('rate_limits')
    .select('*')
    .eq('ip', identifier)
    .maybeSingle();

  // Reset if old day or create fresh
  if (!record) {
    await supabase.from('rate_limits').insert({ ip: identifier, requests: 0, window_st: today });
    record = { requests: 0 };
  } else if (record.window_st !== today) {
    await supabase.from('rate_limits').update({ requests: 0, window_st: today }).eq('ip', identifier);
    record = { requests: 0 };
  }

  const used = record.requests ?? 0;

  if (used >= RATE_LIMIT) {
    return res.status(429).json({ error: 'Daily limit reached', checksRemaining: 0 });
  }

  // Run analysis
  const response = await fetch('https://scam-detector-backend.vercel.app/api/check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.API_KEY
    },
    body: JSON.stringify({ text, userId })
  });

  const data = await response.json();

  // Increment count
  await supabase.from('rate_limits').update({ requests: used + 1 }).eq('ip', identifier);

  return res.status(200).json({ ...data, checksRemaining: RATE_LIMIT - (used + 1) });
      }
