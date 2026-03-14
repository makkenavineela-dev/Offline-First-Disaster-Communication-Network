const mongoose = require('mongoose');
 
const messageSchema = new mongoose.Schema({
  // Client-generated UUID for offline deduplication.
  // When a device queues messages while offline and later syncs them, this field
  // prevents the same message from being inserted more than once.
  clientId: { type: String, default: null },
 
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  type: { type: String, enum: ['direct', 'broadcast', 'sos', 'system'], default: 'direct' },
  content: { type: String, required: true, maxlength: 2000 },
  zone: { type: String, default: 'all' }, // For targeted broadcasts
  locationTag: {
    lat: { type: Number },
    lng: { type: Number }
  },
  isDelivered: { type: Boolean, default: false },
  deliveredAt: { type: Date, default: null }
}, { timestamps: true });
 
// Unique partial index on clientId — only enforced when clientId is non-null,
// preventing duplicate offline messages while still allowing null values.
messageSchema.index(
  { clientId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { clientId: { $ne: null } } }
);
 
// Optimize direct message history lookups
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
 
// Optimize broadcast / SOS pulls
messageSchema.index({ type: 1, zone: 1, createdAt: -1 });
 
// Optimize delta-sync pull (fetching everything since a timestamp)
messageSchema.index({ createdAt: 1 });
 
module.exports = mongoose.model('Message', messageSchema);
