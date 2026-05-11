const express = require('express');
const router = express.Router();
const Student = require('../models/Student');

// Route to register a new student (First-time scan)
router.post('/register', async (req, res) => {
    try {
        const newStudent = new Student(req.body);
        await newStudent.save();
        res.status(201).json({ message: "✅ Student Registered in SAMS" });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Route to mark attendance (Daily scan)
router.post('/mark', async (req, res) => {
    try {
        const { studentID } = req.body;
        const student = await Student.findOneAndUpdate(
            { studentID },
            { lastSeen: Date.now() },
            { new: true }
        );
        
        if (!student) return res.status(404).json({ message: "❌ Student Not Found" });
        
        res.json({ message: `Welcome, ${student.name}! Attendance marked.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;