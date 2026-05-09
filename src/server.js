const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Production-Grade Middleware
app.use(cors());
app.use(express.json());

// Database Connection Logic
const connectOptions = {
    serverSelectionTimeoutMS: 5000, // Fail fast if password/IP is wrong
};

mongoose.connect(process.env.MONGODB_URI, connectOptions)
    .then(() => console.log('✅ SAMS Production Engine: Connected to Atlas'))
    .catch(err => {
        console.error('❌ SAMS Connection Failed!');
        console.error(`Reason: ${err.message}`);
        process.exit(1);
    });

// Core System Route
app.get('/', (req, res) => {
    res.json({
        system: "Smart Attendance Management System",
        owner: "denomacha00",
        status: "Live",
        environment: "Production"
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`📡 SAMS Engine running on port ${PORT}`);
    console.log(`🌍 Domain: https://api.smart-managment.com`);
});