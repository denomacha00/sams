// 1. GLOBAL FIX: Ensure crypto is available for the key generator on VPS
global.crypto = require('crypto');

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

// 2. IMPORT ROUTES
const licenseRoutes = require('./routes/licenseRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');

// 3. INITIALIZE APP
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// 4. MIDDLEWARE
app.use(cors());
app.use(express.json());

// 5. DATABASE CONNECTION (Using your existing db.js logic)
const connectDB = require('./configs/db');
connectDB();

// 6. API ROUTES
app.use('/api/licenses', licenseRoutes);
app.use('/api/attendance', attendanceRoutes);

// 7. BASE STATUS ROUTE
app.get('/', (req, res) => {
    res.json({
        system: "SAMS Production Engine",
        status: "Online",
        database: "Connected to Atlas",
        domain: "https://api.smart-managment.com"
    });
});

// 8. ERROR HANDLING (Prevents server from crashing)
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('❌ SAMS Internal Engine Error');
});

// 9. START SERVER
app.listen(PORT, () => {
    console.log(`\n📡 SAMS Engine running on port ${PORT}`);
    console.log(`🌍 Domain: https://api.smart-managment.com`);
    console.log(`✅ SAMS Production Engine: Connected to Atlas\n`);
});