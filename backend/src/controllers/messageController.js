const Message = require('../models/Message');

// @desc    Get direct messages for a specific user chat
// @route   GET /api/messages/:userId
// @access  Private
const getDirectMessages = async (req, res) => {
  try {
    const { userId } = req.params;
    const myId = req.user._id;

    const messages = await Message.find({
      type: 'direct',
      $or: [
        { senderId: myId, receiverId: userId },
        { senderId: userId, receiverId: myId }
      ]
    })
    .sort({ timestamp: 1 })
    .populate('senderId', 'name deviceId')
    .populate('receiverId', 'name deviceId');

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get broadcast/system/sos messages
// @route   GET /api/messages/broadcasts/:zone
// @access  Private
const getBroadcasts = async (req, res) => {
  try {
    const { zone } = req.params;
    
    // Simplification: In a real app we might join user table to match sender's zone
    // For now we get all broadcasts unless we store zone in the message directly
    const messages = await Message.find({
      type: { $in: ['broadcast', 'sos', 'system'] }
    })
    .sort({ timestamp: -1 })
    .limit(50)
    .populate('senderId', 'name deviceId zone role');

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Send a message or SOS
// @route   POST /api/messages
// @access  Private
const sendMessage = async (req, res) => {
  try {
    const { receiverId, type, content, locationTag } = req.body;
    
    const message = await Message.create({
      senderId: req.user._id,
      receiverId: receiverId || null,
      type: type || 'direct',
      content,
      locationTag
    });

    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getDirectMessages,
  getBroadcasts,
  sendMessage
};
