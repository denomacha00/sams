const geolib = require('geolib'); // You'll need to run: npm install geolib

/**
 * Validates if the student is within the school's allowed GPS radius
 * Formula: Attendance is valid if distance <= school.settings.gpsRadius
 */
exports.validateLocation = (studentCoord, teacherCoord, radius = 100) => {
    const distance = geolib.getDistance(
        { latitude: studentCoord[1], longitude: studentCoord[0] },
        { latitude: teacherCoord[1], longitude: teacherCoord[0] }
    );
    return {
        isValid: distance <= radius,
        distanceFromTeacher: distance
    };
};

/**
 * Validates the encrypted QR data
 * Checks if the timestamp is within the 30-second window
 */
exports.validateQRTime = (qrTimestamp) => {
    const now = Date.now();
    const thirtySeconds = 30 * 1000;
    return (now - qrTimestamp) <= thirtySeconds;
};