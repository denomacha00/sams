const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const authorize = require('../middleware/roleAuth');

// Send a Notification (Teacher, HOD, or Admin)
router.post('/send', authorize(['admin', 'hod', 'teacher']), async (req, res) => {
    try {
        const { recipientId, title, message, type } = req.body;
        const senderId = req.headers['x-user-id']; // We'll get this from the login session

        const notification = await Notification.create({
            recipient: recipientId,
            sender: senderId, 
            title: title,
            message: message,
            type: type || 'System'
        });

        res.status(201).json({ 
            success: true, 
            message: "Notification sent successfully!" 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Notifications for the logged-in user
router.get('/my-alerts', authorize(['admin', 'hod', 'teacher']), async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const alerts = await Notification.find({ recipient: userId }).sort({ createdAt: -1 });
        res.json(alerts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;