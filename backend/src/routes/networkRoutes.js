const express = require('express');
const router = express.Router();
const {
  getActiveNodes,
  updateStatus
} = require('../controllers/networkController');
const { protect } = require('../middleware/authMiddleware');

router.route('/nodes')
  .get(protect, getActiveNodes);

router.route('/status')
  .put(protect, updateStatus);

module.exports = router;
