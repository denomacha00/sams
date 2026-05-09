const crypto = require('crypto');

const generateLicenseKey = () => {
    // Generates a key like SAMS-XXXX-XXXX-XXXX
    const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part3 = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `SAMS-${part1}-${part2}-${part3}`;
};

module.exports = { generateLicenseKey };