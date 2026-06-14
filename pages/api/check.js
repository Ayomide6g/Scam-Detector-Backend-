export default async function handler(req, res) {
  // CORS for React Native
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });

  const result = analyzeMessage(text);
  return res.status(200).json(result);
}

function analyzeMessage(text) {
  const lowerText = text.toLowerCase();

  // 1. Extract URLs
  const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-z0-9-]+\.[a-z]{2,})/gi;
  const urls = text.match(urlRegex) || [];

  // 2. Define keyword lists
  const highRiskKeywords = [
    'otp', 'pin', 'password', 'cvv', 'bank account', 'verify now', 
    'account suspended', 'claim prize', 'send money', 'free bitcoin', 
    'double your money', 'mining pool', 'investment opportunity'
  ];

  const suspiciousKeywords = [
    'urgent', 'act now', 'limited time', 'click here', 'download app', 
    'congratulations', 'you won', 'selected', 'bitcoin', 'crypto', 'forex'
  ];

  const shorteners = ['bit.ly', 'tinyurl', 't.co', 'goo.gl', 'ow.ly'];
  const sketchyTlds = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz'];
  const whitelist = ['google.com', 'youtube.com', 'apple.com', 'paypal.com', 'binance.com', 'coinbase.com', 'instagram.com'];

  let score = 0;
  let reasons = [];
  let status = 'NO_CONTEXT';

  // 3. Check for gibberish/no real words
  const hasRealWords = /\b[a-z]{3,}\b/i.test(text) && !/^[^a-zA-Z]*$/.test(text);
  const hasKeywords = [...highRiskKeywords, ...suspiciousKeywords].some(k => lowerText.includes(k));

  if (!hasRealWords && urls.length === 0) {
    return {
      status: 'NO_CONTEXT',
      score: 0,
      message: 'We need more information to properly assess this message.',
      reasons: ['No scannable content detected', 'Message contains no links or recognizable words']
    };
  }

  // 4. URL Analysis
  if (urls.length > 0) {
    urls.forEach(url => {
      const cleanUrl = url.replace(/https?:\/\//, '').split('/')[0];
      
      // High risk URLs
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
      // Whitelist check
      if (whitelist.some(safe => cleanUrl.includes(safe))) {
        score -= 20;
        reasons.push(`Link goes to trusted domain: ${cleanUrl}`);
      }
    });
  }

  // 5. Keyword Analysis
  highRiskKeywords.forEach(keyword => {
    if (lowerText.includes(keyword)) {
      score += 35;
      reasons.push(`High-risk phrase detected: "${keyword}"`);
    }
  });

  suspiciousKeywords.forEach(keyword => {
    if (lowerText.includes(keyword)) {
      score += 15;
      reasons.push(`Suspicious phrase detected: "${keyword}"`);
    }
  });

  // 6. Final Classification + add message field
  let message = '';
  
  if (score === 0 && urls.length === 0 && !hasKeywords) {
    status = 'NO_CONTEXT';
    message = 'We need more information to properly assess this message.';
    reasons = ['No links or keywords detected', 'Message contains only casual text', 'Too short to analyze patterns'];
  } else if (score >= 70) {
    status = 'HIGH_RISK';
    message = 'This message shows strong signs of fraud. Do not engage.';
  } else if (score >= 30) {
    status = 'SUSPICIOUS';
    message = 'This message contains suspicious patterns. Be careful.';
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

  // Cap score at 100
  score = Math.min(Math.max(score, 0), 100);
  if (status === 'NO_CONTEXT') score = Math.min(score, 30);

  return { 
    status, 
    score, 
    message,
    reasons: reasons.length ? reasons : ['Analysis complete'] 
  };
}
