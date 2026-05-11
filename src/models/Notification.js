// Update your existing model with this 'sender' field
const NotificationSchema = new mongoose.Schema({
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Added this
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, enum: ['Timetable', 'Attendance', 'Request', 'Urgent'], default: 'Request' },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});