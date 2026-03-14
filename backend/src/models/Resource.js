const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['medical', 'water', 'food', 'power', 'shelter'], required: true },
  quantity: { type: Number, default: 0 },
  unit: { type: String, default: 'units' }, // e.g. liters, doses, meals
  status: { type: String, enum: ['OK', 'LOW', 'CRITICAL'], default: 'OK' },
  isPublic: { type: Boolean, default: false }, // If true, aggregated for Shelter / Zone
  location: {
    lat: { type: Number },
    lng: { type: Number }
  }
}, { timestamps: true });

module.exports = mongoose.model('Resource', resourceSchema);
