const User = require('../models/User');
 
const VALID_STATUSES = ['safe', 'sos', 'offline', 'active'];
 
// @desc    Get all active nodes in the mesh network
// @route   GET /api/network/nodes
// @access  Private
const getActiveNodes = async (req, res) => {
  try {
    const nodes = await User.find({ status: { $ne: 'offline' } })
      .select('name deviceId role zone location status lastSeen updatedAt')
      .sort({ lastSeen: -1 })
      .lean();
 
    res.json(nodes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
 
// @desc    Update this node's status
// @route   PUT /api/network/status
// @access  Private
const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
 
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }
 
    // Use findByIdAndUpdate for a single atomic operation (no double-save).
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { status, lastSeen: new Date() },
      { new: true, select: 'status lastSeen' }
    );
 
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
 
    res.json({ message: 'Status updated', status: user.status, lastSeen: user.lastSeen });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
 
// @desc    Lightweight heartbeat — signals the node is alive without a full update
// @route   PUT /api/network/heartbeat
// @access  Private
// Clients should call this every ~30 s when online so the cron job doesn't
// mark them as offline.  The authMiddleware already updates lastSeen, but
// this endpoint also marks the node as 'active' if it was previously offline.
const heartbeat = async (req, res) => {
  try {
    const update = { lastSeen: new Date() };
 
    // Re-activate the node if it was marked offline (e.g. after coming back
    // from a network outage).  Never force-upgrade an SOS node to 'active'.
    if (req.user.status === 'offline') {
      update.status = 'active';
    }
 
    await User.findByIdAndUpdate(req.user._id, update);
 
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
 
module.exports = {
  getActiveNodes,
  updateStatus,
  heartbeat,
};
