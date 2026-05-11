const express = require('express');
const router = express.Router();
const keyGen = require('../utils/keyGen');

// POST: Create a new school license
router.post('/', async (req, res) => {
    try {
        const { schoolName, durationMonths, studentLimit } = req.body;
        
        // Generate a secure license key using our crypto utility
        const licenseKey = keyGen.generate(schoolName);

        res.status(201).json({
            status: "Success",
            message: `License created for ${schoolName}`,
            details: {
                licenseKey,
                validFor: `${durationMonths} months`,
                limit: `${studentLimit} students`,
                provider: "Techworld Tech"
            }
        });
    } catch (error) {
        res.status(500).json({ status: "Error", message: error.message });
    }
});

module.exports = router;