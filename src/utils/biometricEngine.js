/**
 * SAMS Biometric Engine
 * Logic for matching live scans against stored face templates.
 */
exports.compareFace = (liveDescriptor, storedDescriptor) => {
    // Euclidean distance calculation for face similarity
    const distance = Math.sqrt(
        liveDescriptor.reduce((acc, val, i) => acc + Math.pow(val - storedDescriptor[i], 2), 0)
    );

    // Confidence score based on distance (Lower distance = Higher confidence)
    const confidence = (1 - distance) * 100;

    return {
        isMatch: confidence >= 98.7, // Your specified threshold
        confidence: confidence.toFixed(2)
    };
};