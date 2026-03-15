const express = require('express');
const router = express.Router();
const { getPublicResources, getMyResources, addResource } = require('../controllers/resourceController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.route('/')
  .post(protect, authorize('responder', 'shelter_admin'), addResource);

router.route('/public')
  .get(protect, getPublicResources);

router.route('/me')
  .get(protect, getMyResources);

module.exports = router;
