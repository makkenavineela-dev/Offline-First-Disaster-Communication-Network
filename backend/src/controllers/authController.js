const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// Dummy hash for constant-time comparison when user not found (prevents timing attacks)
const DUMMY_HASH = '$2a$12$invalidhashpadding1234567890123456789012345678901234';

// @desc    Register a new node/user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { name, deviceId, password, role, zone } = req.body;

    const userExists = await User.findOne({ deviceId });
    if (userExists) {
      return res.status(400).json({ message: 'Device ID already registered' });
    }

    const user = await User.create({
      name, deviceId, password,
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
    res.status(500).json({ message: 'Registration failed' });
  }
};

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { deviceId, password } = req.body;

    const user = await User.findOne({ deviceId });

    // Always run bcrypt compare to prevent timing attacks
    // If user doesn't exist, compare against dummy hash (same time cost)
    const passwordToCheck = user ? user.password : DUMMY_HASH;
    const isMatch = await bcrypt.compare(password, passwordToCheck);

    if (user && isMatch) {
      return res.status(200).json({
        _id: user._id,
        name: user.name,
        deviceId: user.deviceId,
        role: user.role,
        zone: user.zone,
        token: generateToken(user._id),
      });
    } else {
      return res.status(401).json({ message: 'Invalid device ID or password' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Login failed' });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user) {
      res.status(200).json({
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
    res.status(500).json({ message: 'Failed to retrieve profile' });
  }
};

// @desc    Update user location
// @route   PUT /api/users/location
// @access  Private
const updateLocation = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { lat, lng } = req.body;
    const user = await User.findById(req.user._id);

    if (user) {
      user.location = {
        type: 'Point',
        coordinates: [parseFloat(lng), parseFloat(lat)],
        timestamp: new Date()
      };
      const updatedUser = await user.save();
      res.status(200).json(updatedUser.location);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Failed to update location' });
  }
};

module.exports = { registerUser, loginUser, getUserProfile, updateLocation };
