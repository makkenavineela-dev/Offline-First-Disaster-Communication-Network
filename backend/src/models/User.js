const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  deviceId: { type: String, required: true, unique: true }, // Mesh identifier
  password: { type: String, required: true },
  role: { type: String, enum: ['civilian', 'responder', 'shelter_admin'], default: 'civilian' },
  zone: { type: String, default: 'Unassigned' },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [lng, lat]
      default: [0, 0]
    },
    timestamp: { type: Date, default: Date.now }
  },
  status: { type: String, enum: ['safe', 'sos', 'offline', 'active'], default: 'active' },
  lastSeen: { type: Date, default: Date.now }
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Match password
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Optimization Indexes
userSchema.index({ 'location': '2dsphere' });
userSchema.index({ status: 1 });

module.exports = mongoose.model('User', userSchema);
