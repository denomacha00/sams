// Biometric mark (Teacher Scans Student)
router.post('/biometric', async (req, res) => {
    try {
        const { studentID, liveFaceData } = req.body;
        const student = await User.findOne({ admissionNumber: studentID, role: 'student' });

        if (!student || !student.biometrics.faceData) {
            return res.status(404).json({ message: "Student or Biometric data not found" });
        }

        // Compare using our engine
        const matchResult = compareFace(liveFaceData, student.biometrics.faceData);

        if (matchResult.isMatch) {
            student.lastSeen = Date.now();
            await student.save();
            return res.json({ 
                success: true, 
                message: `✓ Match Found: ${student.firstName}`, 
                confidence: matchResult.confidence 
            });
        } else {
            return res.status(401).json({ message: "No match found. Try again." });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});