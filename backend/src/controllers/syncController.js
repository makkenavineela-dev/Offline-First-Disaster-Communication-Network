const Message = require('../models/Message');
const Resource = require('../models/Resource');
const User = require('../models/User');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
 
const VALID_MSG_TYPES = ['direct', 'broadcast', 'sos', 'system'];
const VALID_STATUSES  = ['safe', 'sos', 'offline', 'active'];
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
 
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sync/push
//
// Devices call this when they reconnect to the mesh after being offline.
// Accepts a batch payload of:
//   messages  — array of messages queued while offline
//   resources — array of resource updates queued while offline
//   location  — the node's last known GPS position
//   status    — the node's current status (safe / sos / active)
//
// Each message can carry a clientId (UUID generated on-device) so we can
// deduplicate re-delivered messages on subsequent pushes.
// ─────────────────────────────────────────────────────────────────────────────
const pushSync = async (req, res) => {
  // Top-level guard: if req.body is missing (malformed Content-Type, etc.) return early
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ message: 'Request body must be JSON' });
  }
 
  const { messages = [], resources = [], location, status } = req.body;
 
  const results = {
    messages:  { created: 0, skipped: 0, errors: [] },
    resources: { upserted: 0, errors: [] },
    node:      { updated: false },
  };
 
  // ── Messages ──────────────────────────────────────────────────────────────
  for (const msg of messages) {
    try {
      if (!msg.content || typeof msg.content !== 'string' || !msg.content.trim()) {
        results.messages.errors.push({ clientId: msg.clientId, error: 'content is required' });
        continue;
      }
 
      const msgType = msg.type || 'direct';
      if (!VALID_MSG_TYPES.includes(msgType)) {
        results.messages.errors.push({ clientId: msg.clientId, error: `invalid type: ${msgType}` });
        continue;
      }
 
      if (msgType === 'direct' && (!msg.receiverId || !isValidObjectId(msg.receiverId))) {
        results.messages.errors.push({ clientId: msg.clientId, error: 'valid receiverId required for direct messages' });
        continue;
      }
 
      // Deduplication: skip if this clientId was already persisted
      if (msg.clientId) {
        const exists = await Message.exists({ clientId: msg.clientId });
        if (exists) {
          results.messages.skipped++;
          continue;
        }
      }
 
      await Message.create({
        clientId:    msg.clientId   || null,
        senderId:    req.user._id,
        receiverId:  msg.receiverId || null,
        type:        msgType,
        content:     msg.content.trim().substring(0, 2000),
        zone:        msg.zone       || (msgType === 'direct' ? null : 'all'),
        locationTag: msg.locationTag || null,
        // createdAt always set server-side for integrity — client timestamps not trusted
      });
 
      results.messages.created++;
    } catch (err) {
      // Catch duplicate key errors gracefully
      if (err.code === 11000) {
        results.messages.skipped++;
      } else {
        logger.error(`[Sync] Message error (clientId=${msg.clientId}): ${err.message}`);
        results.messages.errors.push({ clientId: msg.clientId, error: 'Message processing failed' });
      }
    }
  }
 
  // ── Resources ─────────────────────────────────────────────────────────────
  for (const r of resources) {
    try {
      const VALID_TYPES = ['medical', 'water', 'food', 'power', 'shelter'];
      if (!VALID_TYPES.includes(r.type)) {
        results.resources.errors.push({ type: r.type, error: `invalid resource type: ${r.type}` });
        continue;
      }
 
      await Resource.findOneAndUpdate(
        { ownerId: req.user._id, type: r.type },
        {
          ownerId:  req.user._id,
          type:     r.type,
          quantity: r.quantity !== undefined ? r.quantity : 0,
          unit:     r.unit     || 'units',
          status:   ['OK', 'LOW', 'CRITICAL'].includes(r.status) ? r.status : 'OK',
          isPublic: typeof r.isPublic === 'boolean' ? r.isPublic : false,
          location: r.location || undefined,
        },
        { upsert: true, new: true }
      );
 
      results.resources.upserted++;
    } catch (err) {
      logger.error(`[Sync] Resource error (type=${r.type}): ${err.message}`);
      results.resources.errors.push({ type: r.type, error: 'Resource processing failed' });
    }
  }
 
  // ── Node Location + Status ─────────────────────────────────────────────────
  const nodeUpdate = { lastSeen: new Date() };
 
  if (location && location.lat !== undefined && location.lng !== undefined) {
    const lat = parseFloat(location.lat);
    const lng = parseFloat(location.lng);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
        !(lat === 0 && lng === 0)) { // skip default unset (0,0) coordinates
      nodeUpdate.location = {
        type: 'Point',
        coordinates: [lng, lat],
        timestamp: new Date(),
      };
      results.node.updated = true;
    }
  }
 
  if (status && VALID_STATUSES.includes(status)) {
    nodeUpdate.status = status;
    results.node.updated = true;
  }
 
  if (Object.keys(nodeUpdate).length > 1) {
    try {
      await User.findByIdAndUpdate(req.user._id, nodeUpdate);
      results.node.updated = true;
    } catch (err) {
      logger.error(`[Sync] Node update failed: ${err.message}`);
      // Non-fatal — messages/resources already processed, still return results
    }
  }
 
  res.json({ success: true, results });
};
 
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sync/pull?since=<ISO-8601>
//
// Returns everything that changed since the given timestamp so a device can
// catch up after being offline.  Includes:
//   messages  — messages sent to or from this user + all broadcasts
//   nodes     — mesh nodes updated since the timestamp
//   resources — public resources updated since the timestamp
//
// If `since` is omitted the server defaults to the last 24 hours.
// ─────────────────────────────────────────────────────────────────────────────
const pullSync = async (req, res) => {
  try {
    let since;
 
    if (req.query.since) {
      since = new Date(req.query.since);
      if (isNaN(since.getTime())) {
        return res.status(400).json({ message: 'Invalid `since` timestamp — use ISO-8601 format' });
      }
    } else {
      since = new Date(Date.now() - 24 * 60 * 60 * 1000); // default: last 24 h
    }
 
    const myId = req.user._id;
 
    // Run all three queries in parallel for performance
    const [messages, nodes, resources] = await Promise.all([
      Message.find({
        createdAt: { $gte: since },
        $or: [
          { senderId: myId },
          { receiverId: myId },
          { type: { $in: ['broadcast', 'sos', 'system'] } },
        ],
      })
        .sort({ createdAt: 1 })
        .limit(500) // prevent runaway payloads
        .populate('senderId', 'name deviceId zone')
        .lean(),
 
      User.find({
        lastSeen: { $gte: since },
        status: { $ne: 'offline' },
      })
        .select('name deviceId role zone location status lastSeen updatedAt')
        .lean(),
 
      Resource.find({
        updatedAt: { $gte: since },
        isPublic: true,
      })
        .populate('ownerId', 'name zone')
        .lean(),
    ]);
 
    res.json({
      since: since.toISOString(),
      now:   new Date().toISOString(),
      messages,
      nodes,
      resources,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
 
module.exports = { pushSync, pullSync };
