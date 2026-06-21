import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const RATE_LIMIT = 3;
const WINDOW_HOURS = 24;

const supabase = SUPABASE_URL && SUPABASE_KEY? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

async function checkRateLimitPublic(ip) {
  if (!supabase) return { allowed: true, remaining: RATE_LIMIT };

  const windowStart = new Date();
  windowStart.setHours(windowStart.getHours() - WINDOW_HOURS);

  const { data, error } = await supabase
   .from('rate_limits')
   .select('*')
   .eq('ip_address', ip)
   .gte('window_start', windowStart.toISOString())
   .maybeSingle();

  if (error && error.code!== 'PGRST116') {
    console.error('Rate limit check error:', error);
    return { allowed: true, remaining: RATE_LIMIT };
  }

  if (!data) {
    const { error: insertError } = await supabase
     .from('rate_limits')
     .insert({ ip_address: ip, requests: 1, window_start: new Date().toISOString() });

    if (insertError) console.error('Insert error:', insertError);
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  if (data.requests >= RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  const { error: updateError } = await supabase
   .from('rate_limits')
   .update({ requests: data.requests + 1 })
   .eq('id', data.id);

  if (updateError) console.error('Update error:', updateError);
  return { allowed: true, remaining: RATE_LIMIT - (data.requests + 1) };
}

// Your existing analyzeMessage function stays the same
function analyzeMessage(text) {
  //... keep your existing logic here
  return { status: 'SAFE', score: 0, message: 'Looks safe', reasons: [] };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body;
  if (!text || typeof text!== 'string') {
    return res.status(400).json({ error: 'Text is required' });
  }

  const ip = getClientIp(req);
  const rateLimitResult = await checkRateLimitPublic(ip);

  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      checksRemaining: 0
    });
  }

  const result = analyzeMessage(text);

  // THIS IS THE KEY FIX: Add checksRemaining to response
  return res.status(200).json({
   ...result,
    checksRemaining: rateLimitResult.remaining
  });
}
