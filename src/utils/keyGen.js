const crypto = require('crypto');

/**
 * SAMS License Key Generator
 * Creates secure, branded keys for Techworld clients
 */
exports.generate = (schoolName) => {
    const salt = "SAMS_2026_KENYA_TECHWORLD";
    const rawData = `${schoolName}_${Date.now()}_${salt}`;
    
    return crypto
        .createHash('sha256')
        .update(rawData)
        .digest('hex')
        .substring(0, 16)
        .toUpperCase();
};