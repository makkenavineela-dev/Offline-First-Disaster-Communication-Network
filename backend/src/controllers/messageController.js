const Message = require('../models/Message');
const mongoose = require('mongoose');

const VALID_MSG_TYPES = ['broadcast', 'direct', 'sos', 'system', 'group'];
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// @desc    Get direct messages for a specific user chat
// @route   GET /api/messages/direct/:userId
// @access  Private
const getDirectMessages = async (req, res) => {
  try {
    const { userId } = req.params;
    const myId = req.user._id;

    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    const messages = await Message.find({
      type: 'direct',
      $or: [
        { senderId: myId, receiverId: userId },
        { senderId: userId, receiverId: myId }
      ]
    })
    .sort({ createdAt: 1 })
    .populate('senderId', 'name deviceId')
    .populate('receiverId', 'name deviceId');

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve messages' });
  }
};

// @desc    Get broadcast/system/sos messages
// @route   GET /api/messages/broadcasts/:zone
// @access  Private
const getBroadcasts = async (req, res) => {
  try {
    const { zone } = req.params;

    if (!zone || !/^[a-zA-Z0-9_\- ]{1,50}$/.test(zone)) {
      return res.status(400).json({ message: 'Invalid zone parameter' });
    }

    const messages = await Message.find({
      type: { $in: ['broadcast', 'sos', 'system'] },
      $or: [{ zone: zone }, { zone: 'all' }]
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('senderId', 'name deviceId zone role');

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve broadcasts' });
  }
};

// @desc    Send a message or SOS
// @route   POST /api/messages
// @access  Private
const sendMessage = async (req, res) => {
  try {
    const { receiverId, type, content, locationTag, zone } = req.body;

    const msgType = type || 'direct';
    if (!VALID_MSG_TYPES.includes(msgType)) {
      return res.status(400).json({ message: `Invalid type. Allowed: ${VALID_MSG_TYPES.join(', ')}` });
    }

    if (msgType === 'direct' && (!receiverId || !isValidObjectId(receiverId))) {
      return res.status(400).json({ message: 'Valid receiverId required for direct messages' });
    }

    if (locationTag) {
      const lat = parseFloat(locationTag.lat);
      const lng = parseFloat(locationTag.lng);
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ message: 'Invalid location coordinates' });
      }
    }

    const targetZone = zone || (msgType === 'direct' ? null : 'all');
    if (['broadcast', 'system'].includes(msgType) &&
        targetZone !== req.user.zone &&
        !['responder', 'shelter_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only responders can broadcast to other zones' });
    }

    const message = await Message.create({
      senderId: req.user._id,
      receiverId: receiverId || null,
      type: msgType,
      content,
      zone: targetZone,
      locationTag: locationTag || null
      // createdAt always set server-side — never accepted from client
    });

    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ message: 'Failed to send message' });
  }
};

module.exports = { getDirectMessages, getBroadcasts, sendMessage };
