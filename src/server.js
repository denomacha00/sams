// 1. GLOBAL FIX: Ensure crypto is available for license generation on VPS
global.crypto = require('crypto');

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// 2. IMPORT ROUTES
const licenseRoutes = require('./routes/licenseRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const authRoutes = require('./routes/authRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

// 3. INITIALIZE APP
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// 4. MIDDLEWARE
app.use(cors());
app.use(express.json());

// 5. DATABASE CONNECTION
const connectDB = require('./configs/db');
connectDB();

// 6. SAMS API ROUTES
app.use('/api/auth', authRoutes);           // School Code Login
app.use('/api/licenses', licenseRoutes);     // License Key Management
app.use('/api/attendance', attendanceRoutes); // QR, GPS, and Biometrics
app.use('/api/payments', paymentRoutes);     // M-Pesa Till & Bank Acc
app.use('/api/notifications', notificationRoutes); // System Alerts

// 7. BASE STATUS ROUTE
app.get('/', (req, res) => {
    res.json({
        system: "SAMS Production Engine",
        version: "3.0.0",
        status: "Online",
        database: "Connected to Atlas",
        active_gateways: ["M-Pesa 4158238", "MasterCard 519601019976434"],
        developer: "Denis Macharia"
    });
});

// 8. GLOBAL ERROR HANDLER
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: '❌ SAMS Internal Engine Error' });
});

// 9. START SERVER
app.listen(PORT, () => {
    console.log(`\n📡 SAMS Engine running on port ${PORT}`);
    console.log(`🌍 Domain: https://api.smart-managment.com`);
    console.log(`✅ SAMS Production Engine: Connected to Atlas\n`);
});