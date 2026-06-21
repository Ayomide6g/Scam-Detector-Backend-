// create-subscription.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, userId } = req.body;
  
  if (!email || !userId) {
    return res.status(400).json({ error: 'Missing email or userId' });
  }

  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        amount: 100, // ₦1 for card verification. Trial is still 7 days free
        plan: 'PLN_ohpfbish1gkugvk',
        metadata: { 
          userId: userId,
          cancel_action: 'https://yourapp.com/payment-cancelled' // Optional
        },
        callback_url: 'https://scam-detector-backend.vercel.app/api/paystack-callback',
      }),
    });

    const data = await response.json();
    
    if (data.status) {
      res.status(200).json({ 
        authorization_url: data.data.authorization_url,
        access_code: data.data.access_code,
        reference: data.data.reference
      });
    } else {
      res.status(400).json({ error: data.message });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to initialize payment' });
  }
}
