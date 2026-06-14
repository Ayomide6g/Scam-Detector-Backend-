// pages/api/check.js
export default async function handler(req, res) {
  // 1. Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text } = req.body;

    // 2. Validate input
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }
    if (text.length > 5000) {
      return res.status(400).json({ error: 'Text too long. Max 5000 chars.' });
    }
    if (text.trim().length < 5) {
      return res.status(200).json({ 
        risk: 'NO_CONTENT', 
        score: 0, 
        reasons: ['Message too short to analyze'],
        desc: 'Please paste a message, SMS, or link to check'
      });
    }

    let score = 0;
    let reasons = [];
    const input = text.toLowerCase();

    // 3. Better detection rules
    // URL but not known safe domains
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = input.match(urlRegex) || [];
    const safeDomains = ['whatsapp.com', 'telegram.org', 'google.com'];
    const hasUnsafeUrl = urls.some(url => !safeDomains.some(d => url.includes(d)));
    if (hasUnsafeUrl) {
      score += 30;
      reasons.push('Contains an unknown or suspicious link');
    }

    // Keywords with word boundaries to avoid false positives
    if (/\burgent\b|\bimmediately\b/.test(input)) {
      score += 15;
      reasons.push('Uses urgency to pressure you');
    }
    if (/\botp\b|\bone.?time.?password\b|\bverification code\b/.test(input)) {
      score += 40;
      reasons.push('Asks for OTP/verification code');
    }
    if (/\blog.?in\b|\bverify account\b|\bconfirm details\b/.test(input)) {
      score += 25;
      reasons.push('Asks you to log in or verify account');
    }
    if (/\bwon\b|\bprize\b|\blottery\b|\bcongratulations\b/.test(input)) {
      score += 20;
      reasons.push('Claims you won a prize');
    }

    // 4. Determine risk level + description
    let risk, desc;
    if (score >= 70) {
      risk = 'HIGH_RISK';
      desc = 'High risk of scam detected. Do not click links or share info.';
    } else if (score >= 40) {
      risk = 'SUSPICIOUS';
      desc = 'This message shows suspicious patterns. Proceed with caution.';
    } else {
      risk = 'SAFE';
      desc = 'No significant scam indicators were detected.';
    }

    if (reasons.length === 0) reasons.push('No scam indicators detected in this text');

    // 5. TODO: Add rate limiting here. Use Redis, Upstash, or Vercel KV
    // const checksLeft = await checkUserLimit(req); 

    res.status(200).json({ 
      risk, 
      score, 
      reasons,
      desc,
      checksLeft: 3 // Replace with real DB value
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
  }
