const express = require('express');
const router = express.Router();
const License = require('../models/License');
const { generateKey } = require('../utils/keyGen');

// Route to create a new school license
router.post('/generate', async (req, res) => {
    try {
        const { schoolName, durationMonths, studentLimit } = req.body;
        
        const key = generateKey(); // Uses the crypto fix we just applied
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + durationMonths);

        const newLicense = new License({
            schoolName,
            licenseKey: key,
            expiryDate: expiry,
            maxStudents: studentLimit
        });

        await newLicense.save();
        res.json({ success: true, message: "License Generated", key: key });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;