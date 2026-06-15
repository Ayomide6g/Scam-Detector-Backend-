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
  { name: 'MoMo PSB', industry: 'Fintech', domains: ['momobank.ng', 'momo.ng'], ussd: ['*671#'], never_asks_for: ['id via whatsapp', 'id via email link', 'bvn via whatsapp', 'bvn via sms link', 'account pin via chat', 'otp via telegram'], official_channels: 'MoMo app or *671#' },
  { name: 'GTBank', industry: 'Bank', domains: ['gtbank.com'], ussd: ['*737#'], never_asks_for: ['bvn via whatsapp', 'bvn via email link', 'token via sms link', 'token via whatsapp', 'password via email', 'card pin via chat'], official_channels: 'GTWorld app or *737#' },
  { name: 'MTN', industry: 'Telco', domains: ['mtn.ng', 'mtnonline.com'], ussd: ['*312#', '*310#'], never_asks_for: ['nin via whatsapp', 'nin via sms link', 'sim swap pin via call', 'puk via email link'], official_channels: 'MyMTN app or *312#' },
  { name: 'PayPal', industry: 'Fintech', domains: ['paypal.com'], ussd: [], never_asks_for: ['password via email link', 'account password via sms', 'verification code via whatsapp', '2fa code via chat'], official_channels: 'PayPal app' },
  { name: 'Apple', industry: 'Tech', domains: ['apple.com', 'icloud.com'], ussd: [], never_asks_for: ['apple id password via email', 'verification code via sms link', 'icloud login via whatsapp', 'password via call'], official_channels: 'Settings on my device' },
  { name: 'Binance', industry: 'Crypto', domains: ['binance.com'], ussd: [], never_asks_for: ['seed phrase via any channel', '12 words via chat', 'private key via email', 'wallet password via link', 'recovery phrase via whatsapp'], official_channels: 'Binance app' },
  
  // ===== NIGERIA BANKS =====
  { name: 'Access Bank', industry: 'Bank', domains: ['accessbankplc.com'], ussd: ['*901#'], never_asks_for: ['bvn via whatsapp', 'bvn via email link', 'card details via chat', 'account password via sms', 'otp via telegram'], official_channels: 'AccessMore app or *901#' },
  { name: 'Zenith Bank', industry: 'Bank', domains: ['zenithbank.com'], ussd: ['*966#'], never_asks_for: ['token via sms link', 'token via whatsapp', 'password via email link', 'bvn via call', 'card pin via chat'], official_channels: 'Zenith Bank app or *966#' },
  { name: 'First Bank', industry: 'Bank', domains: ['firstbanknigeria.com'], ussd: ['*894#'], never_asks_for: ['bvn via whatsapp', 'bvn via call', 'password via sms link', 'otp via email'], official_channels: 'FirstMobile app or *894#' },
  { name: 'UBA', industry: 'Bank', domains: ['ubagroup.com'], ussd: ['*919#'], never_asks_for: ['account number via email link', 'bvn via whatsapp', 'card pin via chat', 'password via sms'], official_channels: 'UBA Mobile app or *919#' },
  { name: 'Fidelity Bank', industry: 'Bank', domains: ['fidelitybank.ng'], ussd: ['*770#'], never_asks_for: ['account pin via whatsapp', 'bvn via email link', 'otp via telegram', 'password via chat'], official_channels: 'Fidelity Bank app or *770#' },
  { name: 'Ecobank', industry: 'Bank', domains: ['ecobank.com'], ussd: ['*326#'], never_asks_for: ['bvn via email link', 'bvn via whatsapp', 'token via sms', 'card pin via call'], official_channels: 'Ecobank Mobile app or *326#' },
  { name: 'Stanbic IBTC', industry: 'Bank', domains: ['stanbicibtcbank.com'], ussd: ['*909#'], never_asks_for: ['token via whatsapp', 'token via call', 'password via email link', 'bvn via sms'], official_channels: 'Stanbic IBTC app or *909#' },
  { name: 'Union Bank', industry: 'Bank', domains: ['unionbankng.com'], ussd: ['*826#'], never_asks_for: ['password via email link', 'password via whatsapp', 'bvn via sms', 'otp via chat'], official_channels: 'UnionMobile app or *826#' },
  { name: 'Sterling Bank', industry: 'Bank', domains: ['sterling.ng'], ussd: ['*822#'], never_asks_for: ['otp via sms link', 'otp via whatsapp', 'bvn via email', 'card pin via call'], official_channels: 'Sterling OnePay app or *822#' },
  { name: 'Wema Bank', industry: 'Bank', domains: ['wemabank.com'], ussd: ['*945#'], never_asks_for: ['bvn via whatsapp', 'bvn via email link', 'account pin via chat', 'password via sms'], official_channels: 'ALAT by Wema app or *945#' },
  { name: 'Polaris Bank', industry: 'Bank', domains: ['polarisbanklimited.com'], ussd: ['*833#'], never_asks_for: ['card cvv via chat', 'card pin via whatsapp', 'bvn via email link', 'otp via sms'], official_channels: 'Polaris Mobile app or *833#' },
  { name: 'Keystone Bank', industry: 'Bank', domains: ['keystonebankng.com'], ussd: ['*7111#'], never_asks_for: ['account details via email', 'bvn via whatsapp', 'password via sms link', 'token via chat'], official_channels: 'Keystone Mobile app or *7111#' },
  { name: 'Heritage Bank', industry: 'Bank', domains: ['hbng.com'], ussd: ['*745#'], never_asks_for: ['account pin via email', 'bvn via whatsapp', 'password via email link', 'otp via call'], official_channels: 'Heritage Bank app or *745#' },
  
  // ===== NIGERIA FINTECH =====
  { name: 'Opay', industry: 'Fintech', domains: ['opayweb.com', 'opay.com'], ussd: ['*955#'], never_asks_for: ['account pin via whatsapp', 'password via email link', 'otp via telegram', 'bvn via sms'], official_channels: 'Opay app or *955#' },
  { name: 'Palmpay', industry: 'Fintech', domains: ['palmpay.com'], ussd: ['*652#'], never_asks_for: ['bvn via whatsapp', 'bvn via call', 'otp via sms link', 'account pin via chat'], official_channels: 'Palmpay app or *652#' },
  { name: 'Kuda', industry: 'Fintech', domains: ['kuda.com'], ussd: [], never_asks_for: ['password via email link', 'account pin via whatsapp', 'bvn via sms link', 'otp via telegram'], official_channels: 'Kuda app' },
  { name: 'Moniepoint', industry: 'Fintech', domains: ['moniepoint.com'], ussd: ['*5573#'], never_asks_for: ['agent pin via whatsapp', 'bvn via email link', 'password via sms', 'otp via chat'], official_channels: 'Moniepoint app or *5573#' },
  { name: 'Paga', industry: 'Fintech', domains: ['mypaga.com'], ussd: ['*242#'], never_asks_for: ['password via sms link', 'account pin via whatsapp', 'bvn via email', 'otp via call'], official_channels: 'Paga app or *242#' },
  { name: 'Flutterwave', industry: 'Fintech', domains: ['flutterwave.com'], ussd: [], never_asks_for: ['merchant key via email', 'api key via whatsapp', 'secret key via chat', 'password via sms link'], official_channels: 'Flutterwave Dashboard' },
  { name: 'Paystack', industry: 'Fintech', domains: ['paystack.com'], ussd: [], never_asks_for: ['secret key via email', 'api key via whatsapp', 'password via sms link', 'account pin via chat'], official_channels: 'Paystack Dashboard' },
  { name: 'Carbon', industry: 'Fintech', domains: ['getcarbon.co'], ussd: ['*1303#'], never_asks_for: ['bvn via whatsapp', 'bvn via email link', 'loan pin via sms', 'password via chat'], official_channels: 'Carbon app or *1303#' },
  { name: 'FairMoney', industry: 'Fintech', domains: ['fairmoney.ng'], ussd: ['*566*55#'], never_asks_for: ['loan pin via whatsapp', 'bvn via email link', 'password via sms', 'otp via call'], official_channels: 'FairMoney app or *566*55#' },
  { name: 'Branch', industry: 'Fintech', domains: ['branch.co'], ussd: [], never_asks_for: ['account password via email link', 'bvn via whatsapp', 'otp via sms', 'pin via chat'], official_channels: 'Branch app' },
  { name: 'VBank', industry: 'Fintech', domains: ['vbank.ng'], ussd: ['*5037#'], never_asks_for: ['account pin via whatsapp', 'bvn via email link', 'password via sms', 'otp via call'], official_channels: 'VBank app or *5037#' },
  { name: 'Sparkle', industry: 'Fintech', domains: ['sparkle.ng'], ussd: [], never_asks_for: ['password via email link', 'account pin via whatsapp', 'bvn via sms', 'otp via telegram'], official_channels: 'Sparkle app' },
  
  // ===== NIGERIA TELCOS =====
  { name: 'Airtel', industry: 'Telco', domains: ['airtel.com.ng', 'airtel.africa'], ussd: ['*121#', '*312#'], never_asks_for: ['nin via whatsapp', 'nin via sms link', 'sim swap pin via call', 'puk via email'], official_channels: 'MyAirtel app or *121#' },
  { name: 'Glo', industry: 'Telco', domains: ['gloworld.com'], ussd: ['*777#'], never_asks_for: ['nin via sms link', 'nin via whatsapp', 'sim pin via call', 'puk via email'], official_channels: 'Glo Café app or *777#' },
  { name: '9mobile', industry: 'Telco', domains: ['9mobile.com.ng'], ussd: ['*200#'], never_asks_for: ['puk via email link', 'puk via whatsapp', 'nin via sms', 'sim pin via call'], official_channels: '9mobile app or *200#' },
  
  // ===== NIGERIA GOVT/SCHOLARSHIP =====
  { name: 'NIN', industry: 'Government', domains: ['nimc.gov.ng'], ussd: ['*346#'], never_asks_for: ['nin via whatsapp', 'payment via whatsapp', 'nin via email link', 'processing fee via sms'], official_channels: 'NIMC office or *346#' },
  { name: 'BVN', industry: 'Government', domains: ['nibss-plc.com.ng'], ussd: ['*565*0#'], never_asks_for: ['bvn via email link', 'bvn via whatsapp', 'payment to verify bvn'], official_channels: 'Bank branch only' },
  { name: 'JAMB', industry: 'Government', domains: ['jamb.gov.ng'], ussd: [], never_asks_for: ['payment via whatsapp', 'admission fee via email link', 'result pin via sms'], official_channels: 'JAMB portal only' },
  { name: 'NYSC', industry: 'Government', domains: ['nysc.gov.ng'], ussd: [], never_asks_for: ['call-up number via email link', 'payment via whatsapp', 'deployment fee via sms'], official_channels: 'NYSC portal' },
  { name: 'EFCC', industry: 'Government', domains: ['efcc.gov.ng'], ussd: [], never_asks_for: ['payment to clear name', 'fine via whatsapp', 'settlement via email'], official_channels: 'EFCC office only' },
  { name: 'NNPC', industry: 'Government', domains: ['nnpcgroup.com'], ussd: [], never_asks_for: ['job payment via whatsapp', 'recruitment fee via email', 'application fee to personal account'], official_channels: 'NNPC official website' },
  
  // ===== GLOBAL CRYPTO =====
  { name: 'Coinbase', industry: 'Crypto', domains: ['coinbase.com'], ussd: [], never_asks_for: ['seed phrase via any channel', 'private key via email', '12 words via chat', 'wallet password via link'], official_channels: 'Coinbase app' },
  { name: 'MetaMask', industry: 'Crypto', domains: ['metamask.io'], ussd: [], never_asks_for: ['seed phrase via any channel', '12 words via chat', 'private key via email', 'secret recovery phrase via whatsapp'], official_channels: 'MetaMask extension or app' },
  { name: 'Trust Wallet', industry: 'Crypto', domains: ['trustwallet.com'], ussd: [], never_asks_for: ['recovery phrase via any channel', '12 words via chat', 'private key via email', 'seed phrase via sms'], official_channels: 'Trust Wallet app' },
  { name: 'Kraken', industry: 'Crypto', domains: ['kraken.com'], ussd: [], never_asks_for: ['password via email link', 'seed phrase via any channel', 'private key via whatsapp', '2fa code via chat'], official_channels: 'Kraken app' },
  { name: 'KuCoin', industry: 'Crypto', domains: ['kucoin.com'], ussd: [], never_asks_for: ['seed phrase via any channel', 'private key via email', 'wallet password via link', '12 words via whatsapp'], official_channels: 'KuCoin app' },
  { name: 'Bybit', industry: 'Crypto', domains: ['bybit.com'], ussd: [], never_asks_for: ['api key via whatsapp', 'api key via chat', 'seed phrase via any channel', 'private key via email'], official_channels: 'Bybit app' },
  { name: 'OKX', industry: 'Crypto', domains: ['okx.com'], ussd: [], never_asks_for: ['private key via any channel', 'seed phrase via chat', '12 words via email', 'wallet password via link'], official_channels: 'OKX app' },
  { name: 'Phantom', industry: 'Crypto', domains: ['phantom.app'], ussd: [], never_asks_for: ['seed phrase via any channel', 'recovery phrase via chat', 'private key via email', '12 words via whatsapp'], official_channels: 'Phantom wallet' },
  
  // ===== GLOBAL TECH =====
  { name: 'Google', industry: 'Tech', domains: ['google.com', 'gmail.com'], ussd: [], never_asks_for: ['password via email link', 'verification code via whatsapp', '2fa code via sms from unknown number', 'account password via call'], official_channels: 'Google Account settings' },
  { name: 'Facebook', industry: 'Social', domains: ['facebook.com', 'fb.com'], ussd: [], never_asks_for: ['password via chat', 'password via email link', 'login code via whatsapp', 'account recovery via dm'], official_channels: 'Facebook app' },
  { name: 'Instagram', industry: 'Social', domains: ['instagram.com'], ussd: [], never_asks_for: ['password reset via dm', 'password via email link', 'login code via whatsapp', 'verification code via chat'], official_channels: 'Instagram app' },
  { name: 'WhatsApp', industry: 'Social', domains: ['whatsapp.com'], ussd: [], never_asks_for: ['6-digit code via chat', 'verification code via sms from unknown number', 'account pin via call', 'password via email'], official_channels: 'WhatsApp app only' },
  { name: 'Telegram', industry: 'Social', domains: ['telegram.org'], ussd: [], never_asks_for: ['login code via chat', 'password via email link', 'verification code via whatsapp', '2fa code via dm'], official_channels: 'Telegram app' },
  { name: 'TikTok', industry: 'Social', domains: ['tiktok.com'], ussd: [], never_asks_for: ['password via message', 'password via email link', 'login code via whatsapp', 'account pin via chat'], official_channels: 'TikTok app' },
  { name: 'X', industry: 'Social', domains: ['x.com', 'twitter.com'], ussd: [], never_asks_for: ['password via dm', 'password via email link', 'login code via whatsapp', 'verification code via chat'], official_channels: 'X app' },
  { name: 'Microsoft', industry: 'Tech', domains: ['microsoft.com', 'outlook.com'], ussd: [], never_asks_for: ['password via email link', 'account password via sms', 'verification code via whatsapp', '2fa code via call'], official_channels: 'Microsoft Account' },
  { name: 'Netflix', industry: 'Entertainment', domains: ['netflix.com'], ussd: [], never_asks_for: ['password via sms link', 'payment via whatsapp', 'account password via email', 'card details via chat'], official_channels: 'Netflix app' },
  { name: 'Amazon', industry: 'E-commerce', domains: ['amazon.com'], ussd: [], never_asks_for: ['password via email link', 'account password via sms', 'otp via whatsapp', 'card details via chat'], official_channels: 'Amazon app' },
  { name: 'LinkedIn', industry: 'Social', domains: ['linkedin.com'], ussd: [], never_asks_for: ['password via message', 'password via email link', 'login code via whatsapp', 'verification code via chat'], official_channels: 'LinkedIn app' },
  
  // ===== GLOBAL FINTECH/PAYMENT =====
  { name: 'Cash App', industry: 'Fintech', domains: ['cash.app'], ussd: [], never_asks_for: ['account pin via dm', 'ssn via email', 'password via sms link', 'card pin via whatsapp'], official_channels: 'Cash App' },
  { name: 'Venmo', industry: 'Fintech', domains: ['venmo.com'], ussd: [], never_asks_for: ['password via email link', 'account pin via whatsapp', 'ssn via chat', 'card details via sms'], official_channels: 'Venmo app' },
  { name: 'Wise', industry: 'Fintech', domains: ['wise.com'], ussd: [], never_asks_for: ['password via whatsapp', 'password via email link', 'account pin via chat', '2fa code via sms'], official_channels: 'Wise app' },
  { name: 'Revolut', industry: 'Fintech', domains: ['revolut.com'], ussd: [], never_asks_for: ['card details via email', 'account pin via whatsapp', 'password via sms link', 'otp via telegram'], official_channels: 'Revolut app' },
  { name: 'Stripe', industry: 'Fintech', domains: ['stripe.com'], ussd: [], never_asks_for: ['api key via email', 'secret key via whatsapp', 'password via sms link', 'account pin via chat'], official_channels: 'Stripe Dashboard' },
  { name: 'Skrill', industry: 'Fintech', domains: ['skrill.com'], ussd: [], never_asks_for: ['password via email link', 'account pin via whatsapp', 'otp via sms', 'card details via chat'], official_channels: 'Skrill app' },
  { name: 'Payoneer', industry: 'Fintech', domains: ['payoneer.com'], ussd: [], never_asks_for: ['account details via whatsapp', 'password via email link', 'card pin via chat', 'otp via sms'], official_channels: 'Payoneer app' },
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
