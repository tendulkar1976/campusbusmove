import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing required signature verification fields' });
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET || '3OsQpLiPq10zEtln93bTsxDf';

  if (!keySecret) {
    return res.status(500).json({ error: 'Razorpay API credentials are not configured' });
  }

  try {
    const generated_signature = crypto
      .createHmac('sha256', keySecret)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (generated_signature === razorpay_signature) {
      return res.status(200).json({ success: true, message: 'Payment verified successfully' });
    } else {
      return res.status(400).json({ success: false, error: 'Signature verification failed' });
    }
  } catch (error) {
    console.error('Razorpay Signature Verification Error:', error);
    return res.status(500).json({ error: error.message || 'Failed to verify payment signature' });
  }
}
