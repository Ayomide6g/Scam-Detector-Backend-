import { parse } from 'tldts';
import leven from 'leven';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

// ===== ENV VARS =====
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const API_KEY = process.env.API_KEY || 'your-secret-key';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// ===== SUPABASE CLIENT =====
const supabase = SUPABASE_URL && SUPABASE_KEY? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ===== RATE LIMITER =====
const rateLimitStore = new Map();
const RATE_LIMIT = 30;
const RATE_WINDOW = 60 * 1000;

async function checkRateLimit(ip) {
  const now = Date.now();
  const userRequests = rateLimitStore.get(ip) || [];
  const recentRequests = userRequests.filter(time => now - time < RATE_WINDOW);
  if (recentRequests.length >= RATE_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((recentRequests[0] + RATE_WINDOW - now) / 1000) };
  }
  recentRequests.push(now);
  rateLimitStore.set(ip, recentRequests);
  return { allowed: true };
}

// CLEANUP
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of rateLimitStore.entries()) {
    const recent = times.filter(t => now - t < RATE_WINDOW);
    if (recent.length === 0) rateLimitStore.delete(ip);
    else rateLimitStore.set(ip, recent);
  }
}, 5 * 60 * 1000);

// ===== VALIDATION =====
const RequestSchema = z.object({ 
  text: z.string().min(1).max(5000),
  userId: z.string().optional() 
});

function sanitizeInput(text) {
  if (!text || typeof text !== 'string') return '';
  if (text.length > 5000) text = text.substring(0, 5000);
  
  // Only lowercase + trim. Keep spaces and numbers.
  let clean = text.toLowerCase().trim();
  
  // Remove zero-width chars only
  clean = clean.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
  
  return clean;
}

function hasWord(text, word) {
  const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return regex.test(text);
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'];
  if (apiKey!== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const contentLength = parseInt(req.headers['content-length'] || '0');
  if (contentLength > 10240) {
    return res.status(413).json({ error: 'Payload too large' });
  }

  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded? forwarded.split(',')[0].trim() : req.socket.remoteAddress || 'unknown';
  const rateCheck = await checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return res.status(429).json({ error: 'Too many requests', retryAfter: rateCheck.retryAfter });
  }

  const parseResult = RequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid request', details: parseResult.error.issues });
  }
  
  const { text } = parseResult.data;
  try {
    const result = analyzeMessage(text);
    if (supabase && result.score >= 40) {
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
    return res.status(200).json(result);
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Analysis failed', message: error.message });
  }
}

// ===== COMPANY DATABASE =====
const COMPANY_REGISTRY = [
  { name: 'MoMo PSB', industry: 'Fintech', domains: ['momobank.ng', 'momo.ng'], ussd: ['*671#'], never_asks_for: ['id via whatsapp', 'id via email link', 'bvn via whatsapp', 'bvn via sms link', 'account pin via chat', 'otp via telegram'], official_channels: 'MoMo app or *671#' },
  { name: 'GTBank', industry: 'Bank', domains: ['gtbank.com'], ussd: ['*737#'], never_asks_for: ['bvn via whatsapp', 'bvn via email link', 'token via sms link', 'token via whatsapp', 'password via email', 'card pin via chat'], official_channels: 'GTWorld app or *737#' },
  { name: 'MTN', industry: 'Telco', domains: ['mtn.ng', 'mtnonline.com'], ussd: ['*312#', '*310#'], never_asks_for: ['nin via whatsapp', 'nin via sms link', 'sim swap pin via call', 'puk via email link'], official_channels: 'MyMTN app or *312#' },
  { name: 'PayPal', industry: 'Fintech', domains: ['paypal.com'], ussd: [], never_asks_for: ['password via email link', 'account password via sms', 'verification code via whatsapp', '2fa code via chat'], official_channels: 'PayPal app' },
  { name: 'Apple', industry: 'Tech', domains: ['apple.com', 'icloud.com'], ussd: [], never_asks_for: ['apple id password via email', 'verification code via sms link', 'icloud login via whatsapp', 'password via call'], official_channels: 'Settings on my device' },
  { name: 'Binance', industry: 'Crypto', domains: ['binance.com'], ussd: [], never_asks_for: ['seed phrase via any channel', '12 words via chat', 'private key via email', 'wallet password via link', 'recovery phrase via whatsapp'], official_channels: 'Binance app' },
];

const CRITICAL_KEYWORDS = ['bvn', 'nin', 'ssn', 'seed phrase', 'private key', 'recovery phrase', '12 words', '24 words', 'mnemonic', 'card pin', 'atm pin', 'transaction pin'];
const HIGH_RISK_KEYWORDS = ['otp', 'pin', 'password', 'cvv', 'bank account', 'verify now', 'account suspended', 'claim prize', 'send money', 'free bitcoin', 'double my money', 'mining pool', 'investment opportunity', 'passport photo', 'utility bill', 'id card', 'selfie with id', 'account number', 'routing number', 'iban', '2fa code'];
const SUSPICIOUS_KEYWORDS = ['urgent', 'act now', 'limited time', 'click here', 'download app', 'congratulations', 'you won', 'selected', 'bitcoin', 'crypto', 'forex', 'pay fee', 'processing fee', 'legal action', 'efcc'];

function analyzeMessage(text) {
  const rawText = text;
  const lowerText = sanitizeInput(text);
  const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-z0-9-]+\.[a-z]{2,})/gi;
  const urls = rawText.match(urlRegex) || [];
  const shorteners = ['bit.ly', 'tinyurl', 't.co', 'goo.gl', 'ow.ly', 'is.gd'];
  const sketchyTlds = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.work'];
  const whitelist = ['google.com', 'youtube.com', 'apple.com', 'paypal.com', 'binance.com', 'coinbase.com', 'instagram.com'];
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
      if (whitelist.some(safe => cleanUrl.includes(safe))) {
        score -= 20;
        reasons.push(`Link goes to trusted domain: ${cleanUrl}`);
      }
      score = Math.max(score, 0);
      
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
  
  CRITICAL_KEYWORDS.forEach(keyword => {
    if (hasWord(lowerText, keyword)) {
      score += 40;
      reasons.push(`Critical data request: "${keyword}"`);
    }
  });
  
  HIGH_RISK_KEYWORDS.forEach(keyword => {
    if (hasWord(lowerText, keyword)) {
      score += 35;
      reasons.push(`High-risk phrase detected: "${keyword}"`);
    }
  });
  
  SUSPICIOUS_KEYWORDS.forEach(keyword => {
    if (hasWord(lowerText, keyword)) {
      score += 15;
      reasons.push(`Suspicious phrase detected: "${keyword}"`);
    }
  });
  
  if (detectedCompany) {
    for (const rule of detectedCompany.never_asks_for) {
      if (hasWord(lowerText, rule.split(' ')[0])) {
        score += 35;
        reasons.push(`${detectedCompany.name} never asks for "${rule}" via messages`);
      }
    }
  }

    // ===== Context check for all critical data requests =====
  if (detectedCompany && score >= 40) {
    const hasCriticalRequest = CRITICAL_KEYWORDS.some(k => hasWord(lowerText, k));
    
    if (hasCriticalRequest) {
      const isNotification = ['linked', 'verified', 'updated', 'successful', 'confirmed', 'registered', 'changed', 'activated'].some(w => 
        hasWord(lowerText, w)
      );
      const isAskingForData = ['send', 'provide', 'share', 'give', 'enter', 'submit', 'type', 'input', 'reply with'].some(w => 
        hasWord(lowerText, w)
      );
      
      // If it's a company notification and NOT asking you to send the data
      if (isNotification && !isAskingForData) {
        score -= 30;
        reasons.push(`Likely legitimate ${detectedCompany.name} notification`);
      }
    }
  }
  // ===== END =====
  
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
  
  return { status, score, message, company_detected: detectedCompany?.name || null, reasons: reasons.length? [...new Set(reasons)] : ['Analysis complete'] };
        }
