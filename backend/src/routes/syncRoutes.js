const express = require('express');
const router = express.Router();
const { pushSync, pullSync } = require('../controllers/syncController');
const { protect } = require('../middleware/authMiddleware');

// @desc    Push local queued data to server
// @route   POST /api/sync/push
// @access  Private
router.post('/push', protect, pushSync);

// @desc    Pull remote changes since timestamp
// @route   GET /api/sync/pull
// @access  Private
router.get('/pull', protect, pullSync);

module.exports = router;
