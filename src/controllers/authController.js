const User = require('../models/User');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
  const { schoolCode, username, password } = req.body; 
  // username is either Email or Admission Number

  try {
    // Find user belonging to that specific school code
    const user = await User.findOne({ 
      schoolCode: schoolCode.toLowerCase(),
      $or: [{ email: username }, { admissionNumber: username }]
    });

    if (!user) return res.status(401).json({ message: "Invalid School Code or Credentials" });

    // (Password comparison logic would go here)

    const token = jwt.sign(
      { id: user._id, role: user.role, schoolId: user.schoolId },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, role: user.role, firstName: user.firstName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};