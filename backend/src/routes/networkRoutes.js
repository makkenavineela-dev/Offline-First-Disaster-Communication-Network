const express = require('express');
const router = express.Router();
const { getActiveNodes, updateStatus, heartbeat } = require('../controllers/networkController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.route('/nodes')
  .get(protect, getActiveNodes);

router.route('/status')
  .put(protect, authorize('responder', 'shelter_admin'), updateStatus);

router.route('/heartbeat')
  .put(protect, heartbeat);

module.exports = router;
