const mongoose = require('mongoose');

const LicenseSchema = new mongoose.Schema({
    schoolName: { type: String, required: true },
    licenseKey: { type: String, required: true, unique: true },
    expiryDate: { type: Date, required: true },
    maxStudents: { type: Number, default: 100 },
    status: { type: String, enum: ['active', 'expired', 'suspended'], default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('License', LicenseSchema);