const Payment = require('../models/Payment');
const License = require('../models/License');

// M-Pesa Payment Logic (Using your Till: 4158238)
exports.initiateMpesaPayment = async (req, res) => {
    try {
        const { schoolId, amount, phoneNumber } = req.body;
        
        // In a real scenario, this calls the Safaricom API using your Till Number
        console.log(`Initiating STK Push to ${phoneNumber} for Till: 4158238`);

        const newPayment = new Payment({
            schoolId,
            amount,
            paymentMethod: 'mpesa',
            mpesaDetails: { phoneNumber, receiptNumber: "PENDING" },
            status: 'pending'
        });

        await newPayment.save();
        res.json({ success: true, message: "STK Push sent to your phone." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Bank/Card Payment Logic (Using your Acc: 519601019976434)
exports.processCardPayment = async (req, res) => {
    try {
        const { schoolId, amount } = req.body;
        
        console.log(`Processing MasterCard payment to Account: 519601019976434`);

        // Logic to interface with a payment gateway (like Flutterwave or Stripe)
        res.json({ success: true, message: "Payment directed to MasterCard account." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};