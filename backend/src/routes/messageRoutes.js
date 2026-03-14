const express = require('express');
const router = express.Router();
const {
  getDirectMessages,
  getBroadcasts,
  sendMessage
} = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');

router.route('/')
  .post(protect, sendMessage);

router.route('/direct/:userId')
  .get(protect, getDirectMessages);

router.route('/broadcast/:zone')
  .get(protect, getBroadcasts);

module.exports = router;
