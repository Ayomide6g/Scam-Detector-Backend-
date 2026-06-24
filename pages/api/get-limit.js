import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const RATE_LIMIT = 3;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = req.body?.userId || req.query?.userId;
  const consume = req.method === 'POST';

  // Pro bypass
  if (userId) {
    const { data: profile } = await supabase
   .from('profile')
   .select('plan')
   .eq('id', userId)
   .maybeSingle();
    if (profile?.plan === 'pro') {
      return res.status(200).json({ checksRemaining: 'unlimited', isPro: true });
    }
  }

  // Identifier stays same across devices if logged in
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded? forwarded.split(',')[0].trim() : req.socket.remoteAddress || 'unknown';
  const identifier = userId || ip;

  // Today as 20260624
  const d = new Date();
  const today = Number(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`);

  // Find row for this identifier today
  const { data: row } = await supabase
 .from('rate_limits')
 .select('window')
 .eq('ip', identifier)
 .gte('window', today * 100) // 2026062400
 .lt('window', (today + 1) * 100) // 2026062500
 .maybeSingle();

  // Last 2 digits = used count
  const used = row? Number(String(row.window).slice(-2)) : 0;
  const remaining = Math.max(RATE_LIMIT - used, 0);

  if (!consume) {
    return res.status(200).json({ checksRemaining: remaining, isPro: false });
  }

  if (remaining <= 0) {
    return res.status(429).json({ error: 'Daily limit reached', checksRemaining: 0 });
  }

  // New value: 20260624 + 01 = 2026062401
  const newWindow = today * 100 + (used + 1);

  if (row) {
    await supabase.from('rate_limits').delete().eq('ip', identifier).eq('window', row.window);
  }
  await supabase.from('rate_limits').insert({ ip: identifier, window: newWindow });

  return res.status(200).json({ checksRemaining: remaining - 1, isPro: false });
}
