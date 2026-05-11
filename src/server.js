// 1. GLOBAL FIXES & IMPORTS
global.crypto = require("crypto"); // The fix that got us the Green Check!
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

// Import Routes
const licenseRoutes = require('./routes/licenseRoutes');

const app = express();

// 2. MIDDLEWARE
app.use(cors());
app.use(express.json());

// 3. DATABASE CONNECTION
const connectOptions = {
    serverSelectionTimeoutMS: 5000,
};

mongoose.connect(process.env.MONGODB_URI, connectOptions)
    .then(() => console.log('✅ SAMS Production Engine: Connected to Atlas'))
    .catch(err => {
        console.error('❌ SAMS Connection Failed!');
        console.error(`Reason: ${err.message}`);
        process.exit(1);
    });

// 4. SYSTEM ROUTES
app.use('/api/licenses', licenseRoutes);

// Health Check / Root Route
app.get('/', (req, res) => {
    res.json({
        system: "Smart Attendance Management System",
        owner: "denomacha00",
        status: "Live & Functional",
        environment: "Production VPS"
    });
});

// 5. START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`📡 SAMS Engine running on port ${PORT}`);
    console.log(`🌍 Domain: https://api.smart-managment.com`);
});