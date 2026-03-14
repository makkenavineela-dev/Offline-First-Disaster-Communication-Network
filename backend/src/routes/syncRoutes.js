const express = require('express');
const router = express.Router();
const { pushSync, pullSync } = require('../controllers/syncController');
const { protect } = require('../middleware/authMiddleware');
 
// POST /api/sync/push  — upload queued offline data to the server
router.route('/push')
  .post(protect, pushSync);
 
// GET  /api/sync/pull?since=<ISO>  — download all changes since a timestamp
router.route('/pull')
  .get(protect, pullSync);
 
module.exports = router;
