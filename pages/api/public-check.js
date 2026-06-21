import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = SUPABASE_URL && SUPABASE_KEY? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const RATE_LIMIT = 3;
const RATE_WINDOW = 24 * 60 * 60 * 1000; // 24 hours

async function checkRateLimitPublic(ip) {
  if (!supabase) return { allowed: true, remaining: RATE_LIMIT };

  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_WINDOW);

  const { data: record } = await supabase
   .from('rate_limits')
   .select('*')
   .eq('ip', ip)
   .maybeSingle();

  // Reset if 24h passed
  if (record && new Date(record.window_start) < windowStart) {
    await supabase.from('rate_limits')
     .update({ requests: 1, window_start: now })
     .eq('ip', ip);
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  // Block if over limit
  if (record && record.requests >= RATE_LIMIT) {
    const retryAfter = Math.ceil((new Date(record.window_start).getTime() + RATE_WINDOW - now.getTime()) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  // Increment count
  if (record) {
    await supabase.from('rate_limits')
     .update({ requests: record.requests + 1 })
     .eq('ip', ip);
    return { allowed: true, remaining: RATE_LIMIT - (record.requests + 1) };
  } else {
    await supabase.from('rate_limits')
     .insert({ ip: ip, requests: 1, window_start: now });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded? forwarded.split(',')[0].trim() : req.socket.remoteAddress || 'unknown';

  // Check rate limit FIRST using Supabase
  const rateCheck = await checkRateLimitPublic(ip);

  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: rateCheck.retryAfter,
      checksRemaining: 0,
      status: 'LIMIT_REACHED'
    });
  }

  // Then call your actual analysis logic
  const response = await fetch('https://scam-detector-backend.vercel.app/api/check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.API_KEY
    },
    body: JSON.stringify(req.body)
  });

  const data = await response.json();

  // Override with the real remaining count from Supabase
  data.checksRemaining = rateCheck.remaining;

  res.status(response.status).json(data);
              }
