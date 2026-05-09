const mongoose = require('mongoose');

const LicenseSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, unique: true },
    schoolName: { type: String, required: true },
    tier: { type: String, enum: ['trial', 'basic', 'pro'], default: 'basic' },
    status: { type: String, enum: ['unused', 'active', 'expired'], default: 'unused' },
    expiryDate: { type: Date, required: true },
    activatedAt: { type: Date },
    vpsIp: { type: String, default: '185.143.228.182' }
}, { timestamps: true });

module.exports = mongoose.model('License', LicenseSchema);