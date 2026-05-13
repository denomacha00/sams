const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    recipient: { type: String, required: true }, // Email or ID
    message: { type: String, required: true },
    type: { type: String, enum: ['Attendance', 'System', 'Alert'], default: 'Attendance' },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', NotificationSchema);