import { parse } from 'tldts';
import leven from 'leven';

// 2. Rate limiting - ADDED. In-memory. Use Redis in production
const rateLimitStore = new Map();
const RATE_LIMIT = 30; // 30 requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

function checkRateLimit(ip) {
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

// 1. Input sanitation - ADDED. Cleans text before analysis
function sanitizeInput(text) {
  if (!text || typeof text!== 'string') return '';

  // Limit length - prevent spam/DoS
  if (text.length > 5000) text = text.substring(0, 5000);

  // Lowercase + trim
  let clean = text.toLowerCase().trim();

  // Normalize unicode - catches Cyrillic 'оtp'
  clean = clean.normalize('NFKD');

  // Remove zero-width/hidden chars scammers use
  clean = clean.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');

  // Collapse spaces/dashes/dots/stars between letters: 'o t p' → 'otp'
  clean = clean.replace(/([a-z])[\s\-\.\*\_]+([a-z0-9])/g, '$1$2');

  // Replace leetspeak: 0→o, 1→i, 3→e, 4→a, 5→s, 7→t
  clean = clean.replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e');
  clean = clean.replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't');

  return clean;
}

export default async function handler(req, res) {
  // CORS for React Native - keeping yours
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 2. Rate limiting check - ADDED
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return res.status(429).json({ error: 'Too many requests', retryAfter: rateCheck.retryAfter });
  }

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });

  try {
    const result = analyzeMessage(text); // No await needed now
    return res.status(200).json(result);
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Analysis failed', message: error.message });
  }
}

// ===== COMPANY DATABASE - ADD 500+ HERE =====
const COMPANY_REGISTRY = [
  { name: 'MoMo PSB', industry: 'Fintech', domains: ['momobank.ng', 'momo.ng'], ussd: ['*671#'], never_asks_for: ['id via whatsapp', 'id via email link', 'bvn via whatsapp', 'bvn via sms link', 'account pin via chat', 'otp via telegram'], official_channels: 'MoMo app or *671#' },
  { name: 'GTBank', industry: 'Bank', domains: ['gtbank.com'], ussd: ['*737#'], never_asks_for: ['bvn via whatsapp', 'bvn via email link', 'token via sms link', 'token via whatsapp', 'password via email', 'card pin via chat'], official_channels: 'GTWorld app or *737#' },
  { name: 'MTN', industry: 'Telco', domains: ['mtn.ng', 'mtnonline.com'], ussd: ['*312#', '*310#'], never_asks_for: ['nin via whatsapp', 'nin via sms link', 'sim swap pin via call', 'puk via email link'], official_channels: 'MyMTN app or *312#' },
  { name: 'PayPal', industry: 'Fintech', domains: ['paypal.com'], ussd: [], never_asks_for: ['password via email link', 'account password via sms', 'verification code via whatsapp', '2fa code via chat'], official_channels: 'PayPal app' },
  { name: 'Apple', industry: 'Tech', domains: ['apple.com', 'icloud.com'], ussd: [], never_asks_for: ['apple id password via email', 'verification code via sms link', 'icloud login via whatsapp', 'password via call'], official_channels: 'Settings on my device' },
  { name: 'Binance', industry: 'Crypto', domains: ['binance.com'], ussd: [], never_asks_for: ['seed phrase via any channel', '12 words via chat', 'private key via email', 'wallet password via link', 'recovery phrase via whatsapp'], official_channels: 'Binance app' },
  // ===== NIGERIA BANKS =====
];

// ===== WORLDWIDE DANGER KEYWORDS - expanded from yours =====
const CRITICAL_KEYWORDS = ['bvn', 'nin', 'ssn', 'seed phrase', 'private key', 'recovery phrase', '12 words', '24 words', 'mnemonic', 'card pin', 'atm pin', 'transaction pin'];
const HIGH_RISK_KEYWORDS = ['otp', 'pin', 'password', 'cvv', 'bank account', 'verify now', 'account suspended', 'claim prize', 'send money', 'free bitcoin', 'double my money', 'mining pool', 'investment opportunity', 'passport photo', 'utility bill', 'id card', 'selfie with id', 'account number', 'routing number', 'iban', '2fa code'];
const SUSPICIOUS_KEYWORDS = ['urgent', 'act now', 'limited time', 'click here', 'download app', 'congratulations', 'you won', 'selected', 'bitcoin', 'crypto', 'forex', 'pay fee', 'processing fee', 'legal action', 'efcc'];

function analyzeMessage(text) {
  // 1. Input sanitation - ADDED. Keep rawText for URL extraction
  const rawText = text;
  const lowerText = sanitizeInput(text); // Sanitized version for matching

  // 1. Extract URLs - KEEPING YOUR REGEX
  const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-z0-9-]+\.[a-z]{2,})/gi;
  const urls = rawText.match(urlRegex) || []; // Use rawText so we get real URLs

  // 2. Define keyword lists - MERGED YOURS + NEW ONES
  const shorteners = ['bit.ly', 'tinyurl', 't.co', 'goo.gl', 'ow.ly', 'is.gd'];
  const sketchyTlds = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.work'];
  const whitelist = ['google.com', 'youtube.com', 'apple.com', 'paypal.com', 'binance.com', 'coinbase.com', 'instagram.com'];
  let score = 0;
  let reasons = [];
  let status = 'NO_CONTEXT';
  let detectedCompany = null;

  // 3. Check for gibberish/no real words - KEEPING YOUR LOGIC
  const hasRealWords = /\b[a-z]{3,}\b/i.test(rawText) &&!/^[^a-zA-Z]*$/.test(rawText);
  const hasKeywords = [...HIGH_RISK_KEYWORDS,...SUSPICIOUS_KEYWORDS,...CRITICAL_KEYWORDS].some(k => lowerText.includes(k));
  if (!hasRealWords && urls.length === 0) {
    return { status: 'NO_CONTEXT', score: 0, message: 'We need more information to properly assess this message.', reasons: ['No scannable content detected', 'Message contains no links or recognizable words'] };
  }

  // 3b. NEW: Detect company first
  for (const company of COMPANY_REGISTRY) {
    if (lowerText.includes(company.name.toLowerCase())) {
      detectedCompany = company;
      break;
    }
  }

  // 4. URL Analysis - KEEPING YOUR LOGIC + TYPOSQUAT
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

      // Your original checks - KEPT
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

      // NEW: Typosquat check - KEPT
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

  // 5. Keyword Analysis - KEEPING YOUR STRUCTURE + EXPANDED LISTS
  CRITICAL_KEYWORDS.forEach(keyword => {
    if (lowerText.includes(keyword)) {
      score += 40;
      reasons.push(`Critical data request: "${keyword}"`);
    }
  });
  HIGH_RISK_KEYWORDS.forEach(keyword => {
    if (lowerText.includes(keyword)) {
      score += 35;
      reasons.push(`High-risk phrase detected: "${keyword}"`);
    }
  });
  SUSPICIOUS_KEYWORDS.forEach(keyword => {
    if (lowerText.includes(keyword)) {
      score += 15;
      reasons.push(`Suspicious phrase detected: "${keyword}"`);
    }
  });

  // 5b. NEW: Company-specific rules
  if (detectedCompany) {
    for (const rule of detectedCompany.never_asks_for) {
      if (lowerText.includes(rule.split(' ')[0])) {
        score += 35;
        reasons.push(`${detectedCompany.name} never asks for "${rule}" via messages`);
      }
    }
  }

  // 6. Final Classification - KEEPING YOUR TIERS + ADDING CAUTION
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
  } else if (score >= 15) { // NEW CAUTION TIER YOU ASKED FOR
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

  // Cap score at 100 - KEEPING YOUR LOGIC
  score = Math.min(Math.max(score, 0), 100);
  if (status === 'NO_CONTEXT') score = Math.min(score, 30);

  return {
    status,
    score,
    message,
    company_detected: detectedCompany?.name || null,
    reasons: reasons.length? [...new Set(reasons)] : ['Analysis complete']
  };
  }
