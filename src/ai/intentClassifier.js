/**
 * SAMS Intent Classifier
 * Determines the user's goal (Attendance, Licensing, or Role Management)
 */
exports.classifyIntent = (text) => {
    const input = text.toLowerCase();
    
    if (input.includes("attendance") || input.includes("scan") || input.includes("present")) {
        return "MARK_ATTENDANCE";
    }
    if (input.includes("license") || input.includes("key") || input.includes("subscription")) {
        return "MANAGE_LICENSE";
    }
    if (input.includes("teacher") || input.includes("hod") || input.includes("admin")) {
        return "ROLE_MANAGEMENT";
    }
    
    return "GENERAL_INQUIRY";
};