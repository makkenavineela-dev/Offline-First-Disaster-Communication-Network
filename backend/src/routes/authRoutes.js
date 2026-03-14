const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  getUserProfile,
  updateLocation
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// Auth endpoints
router.post('/auth/register', registerUser);
router.post('/auth/login', loginUser);

// User endpoints
router.route('/users/profile')
  .get(protect, getUserProfile);

router.route('/users/location')
  .put(protect, updateLocation);

module.exports = router;
