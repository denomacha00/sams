const express = require('express');
const router = express.Router();
const attendanceCtrl = require('../controllers/attendanceController');

router.post('/scan', attendanceCtrl.markAttendance);

module.exports = router;