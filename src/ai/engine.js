const { classifyIntent } = require('./intentClassifier');
const { checkPermission } = require('./rolepermission');

exports.processRequest = async (userRole, userText) => {
    const intent = classifyIntent(userText);
    
    // Example logic: Checking if the user has permission for the detected intent
    const canAccess = checkPermission(userRole, intent.toLowerCase());
    
    if (!canAccess && intent !== "GENERAL_INQUIRY") {
        return { status: "DENIED", message: "Unauthorized role for this action." };
    }

    return { status: "SUCCESS", intent: intent };
};