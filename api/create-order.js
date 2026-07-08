import Razorpay from 'razorpay';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { amount, currency, receipt } = req.body;

  if (!amount || amount < 100) {
    return res.status(400).json({ error: 'Amount must be at least 100 paise (1 INR)' });
  }

  const keyId = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_TAufD9QSOv2HRE';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '3OsQpLiPq10zEtln93bTsxDf';

  if (!keyId || !keySecret) {
    return res.status(401).json({ error: 'Razorpay API credentials are not configured' });
  }

  try {
    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const order = await razorpay.orders.create({
      amount: parseInt(amount, 10),
      currency: currency || 'INR',
      receipt: receipt || `receipt_${Date.now()}`,
    });

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (error) {
    console.error('Razorpay Order Creation Error:', error);
    const errMsg = error.description || (error.error && error.error.description) || error.message || String(error);
    return res.status(500).json({ 
      error: 'Failed to create order', 
      details: errMsg,
      diagnostics: {
        keyIdPrefix: keyId ? keyId.substring(0, 8) : "none",
        keyIdIsFallback: keyId === 'rzp_test_TAufD9QSOv2HRE',
        keySecretLength: keySecret ? keySecret.length : 0,
        keySecretIsFallback: keySecret === '3OsQpLiPq10zEtln93bTsxDf'
      }
    });
  }
}
