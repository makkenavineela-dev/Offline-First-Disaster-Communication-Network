const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true }, // For deduplication during sync
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Null for broadcast
  type: { type: String, enum: ['direct', 'broadcast', 'sos', 'system'], default: 'direct' },
  content: { type: String, required: true },
  zone: { type: String, default: 'all' }, // For targeted broadcasts
  locationTag: {
    lat: { type: Number },
    lng: { type: Number }
  },
  isDelivered: { type: Boolean, default: false }
}, { timestamps: true });

// Optimize pulling histories (Direct messages timeline)
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });

// Optimize pulling broadcasts
messageSchema.index({ type: 1, zone: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
