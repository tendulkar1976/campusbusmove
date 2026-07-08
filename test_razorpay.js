import Razorpay from 'razorpay';

const keyId = 'rzp_test_TAufD9QSOv2HRE';
const keySecret = '3OsQpLiPq10zEtln93bTsxDf';

async function test() {
  try {
    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    console.log("Attempting to create order...");
    const order = await razorpay.orders.create({
      amount: 100, // 1 INR in paise
      currency: 'INR',
      receipt: 'receipt_test_123',
    });

    console.log("Success! Order details:", order);
  } catch (error) {
    console.error("Failed to create order. Error details:", error);
  }
}

test();
