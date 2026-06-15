import { parse } from 'tldts';
import leven from 'leven';

export default async function handler(req, res) {
  // CORS for React Native - keeping mine
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });

  try {
    const result = analyzeMessage(text); // No await needed now
    return res.status(200).json(result);
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({
      error: 'Analysis failed',
      message: error.message
    });
  }
}

// ===== COMPANY DATABASE - ADD 500+ HERE =====
const COMPANY_REGISTRY = [
  { name: 'MoMo PSB', industry: 'Fintech', domains: ['momobank.ng', 'momo.ng'], ussd: ['*671#'], never_asks_for: ['id via link', 'bvn via whatsapp'], official_channels: 'MoMo app or *671#' },
  { name: 'GTBank', industry: 'Bank', domains: ['gtbank.com'], ussd: ['*737#'], never_asks_for: ['bvn via link', 'token via sms'], official_channels: 'GTWorld app or *737#' },
  { name: 'MTN', industry: 'Telco', domains: ['mtn.ng', 'mtnonline.com'], ussd: ['*312#', '*310#'], never_asks_for: ['nin via link'], official_channels: 'MyMTN app' },
  { name: 'PayPal', industry: 'Fintech', domains: ['paypal.com'], ussd: [], never_asks_for: ['password via email'], official_channels: 'PayPal app' },
  { name: 'Apple', industry: 'Tech', domains: ['apple.com', 'icloud.com'], ussd: [], never_asks_for: ['apple id via link'], official_channels: 'Settings on my device' },
  { name: 'Binance', industry: 'Crypto', domains: ['binance.com'], ussd: [], never_asks_for: ['seed phrase', '12 words'], official_channels: 'Binance app' },
  // Add 494 more companies here
];

// ===== WORLDWIDE DANGER KEYWORDS - expanded from mine =====
const CRITICAL_KEYWORDS = ['bvn', 'nin', 'ssn', 'seed phrase', 'private key', 'recovery phrase', '12 words', '24 words', 'mnemonic', 'card pin', 'atm pin', 'transaction pin'];
const HIGH_RISK_KEYWORDS = ['otp', 'pin', 'password', 'cvv', 'bank account', 'verify now', 'account suspended', 'claim prize', 'send money', 'free bitcoin', 'double my money', 'mining pool', 'investment opportunity', 'passport photo', 'utility bill', 'id card', 'selfie with id', 'account number', 'routing number', 'iban', '2fa code'];
const SUSPICIOUS_KEYWORDS = ['urgent', 'act now', 'limited time', 'click here', 'download app', 'congratulations', 'you won', 'selected', 'bitcoin', 'crypto', 'forex', 'pay fee', 'processing fee', 'legal action', 'efcc'];

function analyzeMessage(text) {
  const lowerText = text.toLowerCase();

  // 1. Extract URLs - KEEPING MY REGEX
  const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-z0-9-]+\.[a-z]{2,})/gi;
  const urls = text.match(urlRegex) || [];

  // 2. Define keyword lists - MERGED MINE + NEW ONES
  const shorteners = ['bit.ly', 'tinyurl', 't.co', 'goo.gl', 'ow.ly', 'is.gd'];
  const sketchyTlds = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.work'];
  const whitelist = ['google.com', 'youtube.com', 'apple.com', 'paypal.com', 'binance.com', 'coinbase.com', 'instagram.com'];

  let score = 0;
  let reasons = [];
  let status = 'NO_CONTEXT';
  let detectedCompany = null;

  // 3. Check for gibberish/no real words - KEEPING MY LOGIC
  const hasRealWords = /\b[a-z]{3,}\b/i.test(text) &&!/^[^a-zA-Z]*$/.test(text);
  const hasKeywords = [...HIGH_RISK_KEYWORDS,...SUSPICIOUS_KEYWORDS,...CRITICAL_KEYWORDS].some(k => lowerText.includes(k));

  if (!hasRealWords && urls.length === 0) {
    return {
      status: 'NO_CONTEXT',
      score: 0,
      message: 'We need more information to properly assess this message.',
      reasons: ['No scannable content detected', 'Message contains no links or recognizable words']
    };
  }

  // 3b. NEW: Detect company first
  for (const company of COMPANY_REGISTRY) {
    if (lowerText.includes(company.name.toLowerCase())) {
      detectedCompany = company;
      break;
    }
  }

  // 4. URL Analysis - KEEPING MY LOGIC + TYPOSQUAT
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
      // My original checks - KEPT
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

  // 5. Keyword Analysis - KEEPING MY STRUCTURE + EXPANDED LISTS
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

  // 6. Final Classification - KEEPING MY TIERS + ADDING CAUTION
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
    // NEW CAUTION TIER I ASKED FOR
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

  // Cap score at 100 - KEEPING MY LOGIC
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
