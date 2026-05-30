const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
  ownerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:     { type: String, required: true, trim: true },  // e.g. "Bandages", "IV Bags"
  type:     {
    type: String,
    enum: ['medical', 'water', 'food', 'power', 'shelter', 'equipment', 'communication', 'other'],
    required: true,
  },
  quantity: { type: Number, default: 0, min: 0 },
  unit:     { type: String, default: 'units' },          // liters, doses, meals, pcs…
  status:   { type: String, enum: ['OK', 'LOW', 'CRITICAL'], default: 'OK' },
  isPublic: { type: Boolean, default: true },            // shared on mesh by default
  location: {
    lat: { type: Number },
    lng: { type: Number },
  },
}, { timestamps: true });

resourceSchema.index({ ownerId: 1, createdAt: -1 });
resourceSchema.index({ type: 1, isPublic: 1 });

module.exports = mongoose.model('Resource', resourceSchema);
