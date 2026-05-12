const mongoose = require('mongoose');

const LicenseSchema = new mongoose.Schema({
    schoolName: { type: String, required: true },
    licenseKey: { type: String, required: true, unique: true },
    status: { type: String, enum: ['Active', 'Expired', 'Suspended'], default: 'Active' },
    studentLimit: { type: Number, default: 500 },
    expiryDate: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('License', LicenseSchema);