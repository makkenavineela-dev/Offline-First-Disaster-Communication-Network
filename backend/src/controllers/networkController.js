const User = require('../models/User');

// @desc    Get all active nodes in the mesh network
// @route   GET /api/network/nodes
// @access  Private
const getActiveNodes = async (req, res) => {
  try {
    // Return all users that are active and have a location tag
    const nodes = await User.find({ status: { $ne: 'offline' } })
      .select('name deviceId role zone location status')
      .sort({ 'location.timestamp': -1 });
      
    res.json(nodes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update your node status
// @route   PUT /api/network/status
// @access  Private
const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['safe', 'sos', 'offline', 'active'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const user = await User.findById(req.user._id);
    if (user) {
      user.status = status;
      await user.save();
      res.json({ message: 'Status updated', status: user.status });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getActiveNodes,
  updateStatus
};
