const Student = require('../models/Student');

exports.markAttendance = async (req, res) => {
    try {
        const { studentID, location } = req.body;
        const student = await Student.findOne({ studentID });

        if (!student) return res.status(404).json({ message: "Student Not Registered" });

        // Logic to save the scan to a new Attendance collection
        console.log(`✅ Attendance: ${student.name} marked at ${location}`);
        res.json({ success: true, student: student.name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};