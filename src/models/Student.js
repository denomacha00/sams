const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    studentID: { type: String, required: true, unique: true },
    faceVector: { type: Array, required: true }, // Stores the AI face numbers
    class: { type: String, required: true },
    status: { type: String, default: 'Active' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Student', StudentSchema);