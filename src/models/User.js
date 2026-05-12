const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  schoolCode: { type: String, required: true }, // Denormalized for fast login
  
  // Login credentials
  email: { type: String },              // Required for Staff
  admissionNumber: { type: String },    // Required for Students
  password: { type: String, required: true },
  
  role: { 
    type: String, 
    enum: ['admin', 'hod', 'teacher', 'student'], 
    required: true 
  },
  
  firstName: String,
  lastName: String,
  
  // Metadata based on role
  roleData: {
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' }, // For Students
    classIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }] // For Teachers
  },
  
  biometrics: {
    faceData: String, // Encrypted template
    registeredAt: Date
  },
  
  status: { type: String, default: 'active' }
});

// Indexing for high-performance login per your spec
UserSchema.index({ schoolCode: 1, email: 1 });
UserSchema.index({ schoolCode: 1, admissionNumber: 1 });

module.exports = mongoose.model('User', UserSchema);