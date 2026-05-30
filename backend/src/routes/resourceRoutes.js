const express = require('express');
const router  = express.Router();
const {
  getAllResources,
  getMyResources,
  addResource,
  updateResource,
  deleteResource,
} = require('../controllers/resourceController');
const { protect } = require('../middleware/authMiddleware');

router.route('/')
  .get(protect, getAllResources)   // list all public resources
  .post(protect, addResource);     // any logged-in user can add

router.route('/me')
  .get(protect, getMyResources);   // only your own

router.route('/:id')
  .put(protect, updateResource)    // owner-only edit
  .delete(protect, deleteResource); // owner-only delete

module.exports = router;
