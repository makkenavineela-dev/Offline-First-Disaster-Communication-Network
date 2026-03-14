const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @desc    Register a new node/user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const { name, deviceId, password, role, zone } = req.body;

    const userExists = await User.findOne({ deviceId });
    if (userExists) {
      return res.status(400).json({ message: 'Device ID already registered' });
    }

    const user = await User.create({
      name,
      deviceId,
      password,
      role: role || 'civilian',
      zone: zone || 'Unassigned',
    });

    if (user) {
      res.status(201).json({
        _id: user._id,
        name: user.name,
        deviceId: user.deviceId,
        role: user.role,
        zone: user.zone,
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { deviceId, password } = req.body;

    const user = await User.findOne({ deviceId });

    if (user && (await user.matchPassword(password))) {
      res.json({
        _id: user._id,
        name: user.name,
        deviceId: user.deviceId,
        role: user.role,
        zone: user.zone,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: 'Invalid device ID or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user) {
      res.json({
        _id: user._id,
        name: user.name,
        deviceId: user.deviceId,
        role: user.role,
        zone: user.zone,
        location: user.location,
        status: user.status
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update user location
// @route   PUT /api/users/location
// @access  Private
const updateLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;

    const user = await User.findById(req.user._id);

    if (user) {
      user.location = {
        lat,
        lng,
        timestamp: new Date()
      };

      const updatedUser = await user.save();
      res.json(updatedUser.location);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  updateLocation
};
