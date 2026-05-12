const Session = require('../models/AttendanceSession');
const Record = require('../models/AttendanceRecord');
const { validateLocation, validateQRTime } = require('../utils/attendanceValidator');

exports.startSession = async (req, res) => {
    // Logic for Teacher to start a session
    // Generates the initial encrypted QR Data
};

exports.markViaQR = async (req, res) => {
    try {
        const { sessionId, studentId, studentLocation, qrTimestamp, teacherLocation } = req.body;

        // 1. Anti-Fraud: Check QR Timing
        if (!validateQRTime(qrTimestamp)) {
            return res.status(403).json({ message: "QR Code Expired. Please scan the new one." });
        }

        // 2. Security: Check GPS Radius
        const locationCheck = validateLocation(studentLocation, teacherLocation);
        if (!locationCheck.isValid) {
            return res.status(403).json({ message: "Out of range. You must be in the classroom." });
        }

        // 3. Success: Create the Attendance Record
        const record = new Record({
            studentId,
            sessionId,
            method: 'qr_scan',
            location: {
                coordinates: studentLocation,
                validated: true,
                distanceFromTeacher: locationCheck.distanceFromTeacher
            },
            status: 'present'
        });

        await record.save();
        res.json({ success: true, message: "✓ Marked Present" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};