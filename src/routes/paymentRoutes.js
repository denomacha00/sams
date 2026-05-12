const express = require('express');
const router = express.Router();
const paymentCtrl = require('../controllers/paymentController');

router.post('/mpesa/pay', paymentCtrl.initiateMpesaPayment);
router.post('/card/pay', paymentCtrl.processCardPayment);

module.exports = router;