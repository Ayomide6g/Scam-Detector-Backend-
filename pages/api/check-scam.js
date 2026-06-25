import { parse } from 'tldts';
import leven from 'leven';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const RATE_LIMIT = 3;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const API_KEY = process.env.API_KEY || 'your-secret-key';

const RequestSchema = z.object({
  text: z.string().min(1).max(5000),
  userId: z.string().optional()
});

function sanitizeInput(text) {
  if (!text || typeof text!== 'string') return '';
  if (text.length > 5000) text = text.substring(0, 5000);
  let clean = text.toLowerCase().trim();
  clean = clean.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
  return clean;
}

function hasWord(text, word) {
  const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return regex.test(text);
}

const COMPANY_REGISTRY = [
  { name: 'MoMo PSB', industry: 'Fintech', domains: ['momobank.ng', 'momo.ng'], ussd: ['*671#'], never_asks_for: ['id via whatsapp', 'id via email link', 'bvn via whatsapp', 'bvn via sms link', 'account pin via chat', 'otp via telegram'], official_channels: 'MoMo app or *671#' },
  { name: 'GTBank', industry: 'Bank', domains: ['gtbank.com'], ussd: ['*737#'], never_asks_for: ['bvn via whatsapp', 'bvn via email link', 'token via sms link', 'token via whatsapp', 'password via email', 'card pin via chat'], official_channels: 'GTWorld app or *737#' },
  { name: 'MTN', industry: 'Telco', domains: ['mtn.ng', 'mtnonline.com'], ussd: ['*312#', '*310#'], never_asks_for: ['nin via whatsapp', 'nin via sms link', 'sim swap pin via call', 'puk via email link'], official_channels: 'MyMTN app or *312#' },
  { name: 'PayPal', industry: 'Fintech', domains: ['paypal.com'], ussd: [], never_asks_for: ['password via email link', 'account password via sms', 'verification code via whatsapp', '2fa code via chat'], official_channels: 'PayPal app' },
  { name: 'Apple', industry: 'Tech', domains: ['apple.com', 'icloud.com'], ussd: [], never_asks_for: ['apple id password via email', 'verification code via sms link', 'icloud login via whatsapp', 'password via call'], official_channels: 'Settings on my device' },
  { name: 'Binance', industry: 'Crypto', domains: ['binance.com'], ussd: [], never_asks_for: ['seed phrase via any channel', '12 words via chat', 'private key via email', 'wallet password via link', 'recovery phrase via whatsapp'], official_channels: 'Binance app' },
];

const CRITICAL_KEYWORDS = ['bvn', 'nin', 'ssn', 'seed phrase', 'private key', 'recovery phrase', '12 words', '24 words', 'mnemonic', 'card pin', 'atm pin', 'transaction pin'];
const HIGH_RISK_KEYWORDS = ['otp', 'pin', 'password', 'cvv', 'bank account', 'verify now', 'account suspended', 'claim prize', 'send money', 'free bitcoin', 'double my money', 'mining pool', 'investment opportunity', 'passport photo', 'utility bill', 'id card', 'selfie with id', 'routing number', 'iban', '2fa code'];
const SUSPICIOUS_KEYWORDS = ['urgent', 'act now', 'limited time', 'click here', 'download app', 'congratulations', 'you won', 'selected', 'bitcoin', 'crypto', 'forex', 'pay fee', 'processing fee', 'legal action', 'efcc'];

function analyzeMessage(text) {
  const rawText = text;
  const lowerText = sanitizeInput(text);
  const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-z0-9-]+\.[a-z]{2,})/gi;
  const urls = rawText.match(urlRegex) || [];
  const shorteners = ['bit.ly', 'tinyurl', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'rb.gy', 'shorturl.at', 'cutt.ly', 'tiny.cc', 't.me', 'wa.me'];
  const sketchyTlds = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.work', '.click', '.link', '.online', '.site', '.icu'];
  const whitelist = [ 'google.com', 'youtube.com', 'apple.com', 'paypal.com', 'binance.com', 'coinbase.com', 'instagram.com', 'mtn.ng', 'mtnonline.com', 'gtbank.com', 'zenithbank.com', 'firstbanknigeria.com', 'ubagroup.com', 'accessbankplc.com', 'kuda.com', 'opay.com', 'opayweb.com', 'flutterwave.com', 'cowrywise.com', 'piggyvest.com', 'momobank.ng', 'airtel.com.ng', 'carbon.ng', 'palmpay.com' ];

  let score = 0;
  let reasons = [];
  let status = 'NO_CONTEXT';
  let detectedCompany = null;
  const hasRealWords = /\b[a-z]{3,}\b/i.test(rawText) &&!/^[^a-zA-Z]*$/.test(rawText);
  const hasKeywords = [...HIGH_RISK_KEYWORDS,...SUSPICIOUS_KEYWORDS,...CRITICAL_KEYWORDS].some(k => hasWord(lowerText, k));

  if (!hasRealWords && urls.length === 0) {
    return { status: 'NO_CONTEXT', score: 0, message: 'We need more information to properly assess this message.', reasons: ['No scannable content detected', 'Message contains no links or recognizable words'] };
  }

  for (const company of COMPANY_REGISTRY) {
    if (hasWord(lowerText, company.name.toLowerCase())) {
      detectedCompany = company;
      break;
    }
  }

  if (urls.length > 0) {
    for (const url of urls) {
      let parsed, cleanUrl;
      try {
        parsed = parse(url);
        cleanUrl = parsed?.hostname || url.replace(/https?:\/\//, '').split('/')[0];
      } catch (e) {
        cleanUrl = url.replace(/https?:\/\//, '').split('/')[0];
        parsed = { domain: cleanUrl };
      }
      if (sketchyTlds.some(tld => cleanUrl.endsWith(tld))) {
        score += 40;
        reasons.push(`Suspicious domain detected: ${cleanUrl}`);
      }
      if (shorteners.some(s => cleanUrl.includes(s))) {
        score += 30;
        reasons.push(`Shortened link found: ${cleanUrl}`);
      }
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(cleanUrl)) {
        score += 50;
        reasons.push(`IP address used instead of domain`);
      }
      const parsedDomain = parsed?.domain && parsed?.publicSuffix? `${parsed.domain}.${parsed.publicSuffix}` : null;
      const isWhitelisted = parsedDomain && whitelist.some(safe => parsedDomain === safe);
      const isFakingWhitelisted =!isWhitelisted && whitelist.some(safe => cleanUrl.includes(safe));
      if (isWhitelisted) {
        score -= 20;
        reasons.push(`Link goes to trusted domain: ${cleanUrl}`);
      } else if (isFakingWhitelisted) {
        score += 45;
        reasons.push(`Domain impersonation detected: "${cleanUrl}" is pretending to be a trusted site — Do not click this link.`);
      }
      score = Math.max(score, 0);
      const phishingPathWords = ['login', 'verify', 'verification', 'secure', 'update', 'suspended', 'wallet', 'banking', 'account', 'support', 'confirm', 'validate', 'recover', 'unlock'];
      const fullUrl = url.toLowerCase();
      const phishingHits = phishingPathWords.filter(w => fullUrl.includes(w));
      if (phishingHits.length >= 2) {
        score += 30;
        reasons.push(`Phishing URL pattern detected: "${phishingHits.join(', ')}" in ${cleanUrl}`);
      } else if (phishingHits.length === 1) {
        score += 10;
        reasons.push(`Suspicious word in URL: "${phishingHits[0]}" in ${cleanUrl}`);
      }
      if (detectedCompany) {
        for (const officialDomain of detectedCompany.domains) {
          const domainToCompare = parsed.domain || cleanUrl;
          if (domainToCompare) {
            const distance = leven(domainToCompare, officialDomain);
            if (distance > 0 && distance <= 2) {
              score += 45;
              reasons.push(`Possible typosquat: ${cleanUrl} vs ${officialDomain}`);
            }
            if (domainToCompare === officialDomain) {
              score -= 30;
              reasons.push(`Matches official ${detectedCompany.name} domain`);
            }
          }
        }
      }
    }
  }

  const requestWords = ['send', 'share', 'provide', 'enter', 'submit', 'reply with', 'input', 'type', 'give', 'supply', 'forward'];
  const hasRequestWord = requestWords.some(w => hasWord(lowerText, w));

  CRITICAL_KEYWORDS.forEach(keyword => {
    if (hasWord(lowerText, keyword)) {
      if (hasRequestWord) {
        score += 40;
        reasons.push(`Critical data request: "${keyword}"`);
      } else {
        score += 5;
        reasons.push(`Sensitive term mentioned: "${keyword}" (no action word detected)`);
      }
    }
  });

  HIGH_RISK_KEYWORDS.forEach(keyword => {
    if (hasWord(lowerText, keyword)) {
      if (hasRequestWord) {
        score += 35;
        reasons.push(`High-risk phrase detected: "${keyword}"`);
      } else {
        score += 5;
        reasons.push(`Risk term mentioned: "${keyword}" (no action word detected)`);
      }
    }
  });

  if (detectedCompany) {
    const requestWords = ['send', 'share', 'provide', 'enter', 'submit', 'reply with', 'input', 'type', 'give', 'supply', 'forward'];
    const hasRequestWord = requestWords.some(w => hasWord(lowerText, w));
    for (const rule of detectedCompany.never_asks_for) {
      const sensitiveTermDetected = hasWord(lowerText, rule.split(' ')[0]);
      if (sensitiveTermDetected && hasRequestWord) {
        score += 35;
        reasons.push(`${detectedCompany.name} never asks for "${rule}" via messages — This is a scam tactic.`);
      }
    }
  }

  if (detectedCompany && score >= 40) {
    const hasCriticalRequest = CRITICAL_KEYWORDS.some(k => hasWord(lowerText, k));
    if (hasCriticalRequest) {
      const isNotification = ['linked', 'verified', 'updated', 'successful', 'confirmed', 'registered', 'changed', 'activated'].some(w => hasWord(lowerText, w));
      const isAskingForData = ['send', 'provide', 'share', 'give', 'enter', 'submit', 'type', 'input', 'reply with'].some(w => hasWord(lowerText, w));
      if (isNotification &&!isAskingForData) {
        score -= 30;
        reasons.push(`Likely legitimate ${detectedCompany.name} notification`);
      }
    }
  }

  const hasUrgency = ['urgent', 'act now', 'limited time', 'expires tonight', 'today only', 'last chance'].some(w => hasWord(lowerText, w));
  const hasMoney = ['send money', 'transfer', 'fee', 'payment', 'fund', 'investment'].some(w => hasWord(lowerText, w));
  const hasPersonalData = CRITICAL_KEYWORDS.some(k => hasWord(lowerText, k));
  if (hasUrgency && hasMoney && urls.length > 0) {
    score += 30;
    reasons.push('Dangerous combo: urgency + money request + link');
  }
  if (hasUrgency && hasPersonalData) {
    score += 25;
    reasons.push('Dangerous combo: urgency + sensitive data request');
  }
  if (hasMoney && hasPersonalData && urls.length > 0) {
    score += 35;
    reasons.push('Dangerous combo: money + personal data + link');
  }

  const capsWords = (rawText.match(/\b[A-Z]{3,}\b/g) || []);
  const exclamationCount = (rawText.match(/!/g) || []).length;
  if (capsWords.length >= 3) {
    score += 10;
    reasons.push(`Aggressive capitalization: ${capsWords.length} all-caps words`);
  }
  if (exclamationCount >= 3) {
    score += 10;
    reasons.push(`Pressure language: ${exclamationCount} exclamation marks`);
  }
  if (capsWords.length >= 3 && exclamationCount >= 3) {
    score += 10;
    reasons.push('High-pressure formatting pattern detected');
  }

  const isolationPhrases = [ "don't tell anyone", "keep this secret", "between us", "delete this message", "tell no one", "just between you and me", "don't inform anyone" ];
  const legitSecretContext = ['secret key', 'api key', 'private key generated', 'your key is', 'access key'];
  const isLegitSecretContext = legitSecretContext.some(phrase => lowerText.includes(phrase));
  isolationPhrases.forEach(phrase => {
    if (lowerText.includes(phrase)) {
      if (isLegitSecretContext) {
        score += 5;
        reasons.push(`Secrecy language detected — appears to be a credential notice, but be cautious. Legitimate companies never ask you to hide communications from others.`);
      } else {
        score += 30;
        reasons.push(`Isolation language detected: "${phrase}" — Scammers use this to stop you from verifying with trusted people. Always tell someone before acting.`);
      }
    }
  });

  const fakeAuthorityPhrases = [ 'cbn approved', 'sec approved', 'efcc cleared', 'efcc approved', 'government approved', 'central bank of nigeria', 'federal government of nigeria', 'interpol', 'world bank grant', 'un grant', 'united nations fund', 'nigerian government', 'presidency approved', 'court ordered', 'legal clearance', 'tax clearance certificate' ];
  fakeAuthorityPhrases.forEach(phrase => {
    if (lowerText.includes(phrase)) {
      score += 35;
      reasons.push(`Fake authority claim: "${phrase}" — Real government agencies never approve payments or grants via SMS, WhatsApp, or email links.`);
    }
  });

  const cryptoScamPhrases = [ 'seed phrase', 'connect your wallet', 'wallet connect', 'approve transaction', 'gas fee', 'smart contract', 'nft giveaway', 'airdrop claim', 'whitelist spot', 'presale access', 'recovery phrase', 'sync your wallet', 'wallet validation', 'claim your token', 'free crypto' ];
  cryptoScamPhrases.forEach(phrase => {
    if (lowerText.includes(phrase)) {
      score += 40;
      reasons.push(`Crypto scam phrase: "${phrase}" — Never connect your wallet or share your seed phrase with anyone. No legitimate platform asks for this.`);
    }
  });

  const jobHiringWords = ['we are hiring', 'we are recruiting', 'job opportunity', 'online job', 'data entry job', 'form filling job', 'typing job', 'work from home'];
  const jobScamSignals = ['registration fee', 'training fee', 'starter pack fee', 'no experience needed', 'no experience required', 'earn 500k weekly', 'earn 200k weekly', 'earn 100k daily', 'guaranteed income', 'earn weekly', 'earn daily', 'instant payment'];
  const hasJobHiring = jobHiringWords.some(phrase => lowerText.includes(phrase));
  const hasJobScamSignal = jobScamSignals.some(phrase => lowerText.includes(phrase));
  if (hasJobHiring && hasJobScamSignal) {
    score += 40;
    reasons.push(`Fake job scam: job offer combined with unrealistic earnings or fees — Legitimate employers never charge registration or training fees.`);
  } else if (hasJobScamSignal) {
    score += 30;
    reasons.push(`Job scam signal: unrealistic earnings or suspicious fees detected — No legitimate job requires you to pay before you start.`);
  } else if (hasJobHiring) {
    score += 5;
    reasons.push(`Job offer mention detected — verify through official company channels before responding.`);
  }

  const timePressurePhrases = [ 'within 24 hours', 'within 48 hours', 'within 72 hours', 'before midnight', 'expires in', 'expiring soon', 'before 12am', 'before 12pm', 'respond immediately', 'reply immediately', 'act immediately', 'do this now', 'time is running out', 'running out of time', 'final notice', 'last notice', 'last warning' ];
  const legitTimeContext = ['delivery', 'shipment', 'appointment', 'booking', 'reservation', 'subscription', 'renewal', 'invoice', 'bill'];
  const isLegitTimeContext = legitTimeContext.some(phrase => lowerText.includes(phrase));
  timePressurePhrases.forEach(phrase => {
    if (lowerText.includes(phrase)) {
      if (isLegitTimeContext) {
        score += 5;
        reasons.push(`Time-sensitive message — appears to be a legitimate notice but always verify through official channels.`);
      } else {
        score += 25;
        reasons.push(`Time pressure tactic: "${phrase}" — Scammers create fake deadlines to stop you from thinking clearly. Legitimate companies always give reasonable time.`);
      }
    }
  });

  const romanceAffectionWords = ['i love you', 'i miss you', 'my love', 'my darling', 'sweetheart', 'my dear'];
  const romanceMoneyPhrases = [ 'send me airtime', 'send me recharge card', 'buy me airtime', 'stuck abroad', 'stranded abroad', 'stuck at the airport', 'my money is seized', 'my account is frozen', 'i need your help urgently', 'send gift card', 'buy gift card for me', 'itunes card', 'steam card', 'google play card', 'military officer', 'serving abroad', 'doctor abroad', 'widower', 'widow with child', 'want to relocate' ];
  const hasAffection = romanceAffectionWords.some(phrase => lowerText.includes(phrase));
  const hasMoneyAngle = romanceMoneyPhrases.some(phrase => lowerText.includes(phrase));
  if (hasAffection && hasMoneyAngle) {
    score += 40;
    reasons.push(`Romance scam pattern: affection combined with money/gift request — Never send money or airtime to someone you haven't met in person.`);
  } else if (hasMoneyAngle) {
    score += 30;
    reasons.push(`Romance scam signal detected — requests for airtime, gift cards or money transfers are common scam tactics.`);
  }

  let message = '';
  if (score === 0 && urls.length === 0 &&!hasKeywords) {
    status = 'NO_CONTEXT';
    message = 'We need more information to properly assess this message.';
    reasons = ['No links or keywords detected', 'Message contains only casual text', 'Too short to analyze patterns'];
  } else if (score >= 70) {
    status = 'HIGH_RISK';
    message = 'This message shows strong signs of fraud. Do not engage.';
  } else if (score >= 30) {
    status = 'SUSPICIOUS';
    message = 'This message contains suspicious patterns. Be careful.';
  } else if (score >= 15) {
    status = 'CAUTION';
    if (detectedCompany) {
      message = `This appears related to ${detectedCompany.name} but be careful. ${detectedCompany.name} only uses ${detectedCompany.official_channels} for sensitive requests.`;
    } else {
      message = 'This appears to be safe but I have to be careful. Never share passwords, PINs, or ID documents via links or messages.';
    }
  } else if (urls.length > 0 || hasKeywords) {
    status = 'SAFE';
    message = 'This content appears to be safe. No significant scam indicators were detected.';
    if (reasons.length === 0) {
      reasons = ['No suspicious keywords detected', 'No malicious links or redirects found', 'Sender reputation looks good'];
    }
  } else {
    status = 'NO_CONTEXT';
    message = 'We need more information to properly assess this message.';
    reasons = ['No scannable content detected'];
  }

  score = Math.min(Math.max(score, 0), 100);
  if (status === 'NO_CONTEXT') score = Math.min(score, 30);
  return { status, score, message, company_detected: detectedCompany?.name || null, reasons: reasons.length? reasons : ['No issues detected'] };
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = req.body?.userId;
if (!userId) {
  return res.status(400).json({ error: 'userId required' });
}
const identifier = String(userId);
const forwarded = req.headers['x-forwarded-for'];
const ip = forwarded? forwarded.split(',')[0].trim() : req.socket.remoteAddress || 'unknown';
  const today = new Date().toISOString().split('T')[0];

  if (userId) {
    const { data: profile } = await supabase
    .from('profile')
    .select('plan')
    .eq('id', userId)
    .maybeSingle();
    if (profile?.plan === 'pro' || profile?.plan === 'premium') {
      if (req.method === 'POST') {
        const parseResult = RequestSchema.safeParse(req.body);
        if (!parseResult.success) return res.status(400).json({ error: 'Invalid request' });
        const result = analyzeMessage(parseResult.data.text);
        return res.status(200).json({...result, checksRemaining: 'unlimited' });
      }
    }
  }

if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

// POST = ONLY HERE do we create/update the database
let { data: record, error: selectError } = await supabase
 .from('rate_limits')
 .select('*')
 .eq('ip', identifier)
 .maybeSingle();

if (selectError) {
  console.error('Select error:', selectError);
  return res.status(500).json({ error: 'DB select failed' });
}

let requests = 0;
let window_start = new Date().toISOString(); // timestamptz needs full ISO

if (record) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const recordDate = new Date(record.window_start).toISOString().split('T')[0];

  if (recordDate === today) {
    requests = record.requests;
    window_start = record.window_start; // keep existing timestamp
  }
}

if (requests >= RATE_LIMIT) {
  return res.status(429).json({ error: 'Daily limit reached', checksRemaining: 0 });
}

const parseResult = RequestSchema.safeParse(req.body);
if (!parseResult.success) {
  return res.status(400).json({ error: 'Invalid request', details: parseResult.error.issues });
}

const { text } = parseResult.data;
const result = analyzeMessage(text);

const { error: upsertError } = await supabase
 .from('rate_limits')
 .upsert({
    ip: identifier,
    requests: requests + 1,
    window_start: window_start
  }, {
    onConflict: 'ip'
  });

if (upsertError) {
  console.error('Upsert error:', upsertError);
  return res.status(500).json({ error: 'DB upsert failed' });
}

if (result.score >= 40) {
  try {
    await supabase.from('scam_logs').insert({
      ip: ip,
      text_preview: text.substring(0, 100),
      score: result.score,
      status: result.status,
      company: result.company_detected,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.error('Supabase log error:', e);
  }
}

return res.status(200).json({
 ...result,
  checksRemaining: RATE_LIMIT - (requests + 1)
});
}
