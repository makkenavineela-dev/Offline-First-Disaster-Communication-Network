const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  getUserProfile,
  updateLocation
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { body } = require('express-validator');

const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('deviceId').matches(/^[A-Z0-9-]{6,20}$/).withMessage('Invalid Device ID format'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('role').optional().isIn(['civilian', 'responder', 'shelter_admin']),
  body('zone').optional().trim()
];

const loginValidation = [
  body('deviceId').notEmpty(),
  body('password').notEmpty()
];

const locationValidation = [
  body('lat').isFloat({ min: -90, max: 90 }),
  body('lng').isFloat({ min: -180, max: 180 })
];

// Auth endpoints
router.post('/auth/register', registerValidation, registerUser);
router.post('/auth/login', loginValidation, loginUser);

// User endpoints
router.route('/users/profile')
  .get(protect, getUserProfile);

router.route('/users/location')
  .put(protect, locationValidation, updateLocation);

module.exports = router;
