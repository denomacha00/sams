const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    studentID: { type: String, required: true, unique: true },
    faceDescriptor: { type: Array, required: true }, // AI face fingerprint
    class: { type: String, required: true },
    schoolName: { type: String, required: true },
    lastSeen: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Student', StudentSchema);