const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    studentID: { type: String, required: true, unique: true },
    // This array stores the 128 numbers that represent a face
    faceDescriptor: { type: Array, required: true }, 
    class: { type: String, required: true },
    schoolName: { type: String, required: true },
    lastSeen: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Student', StudentSchema);