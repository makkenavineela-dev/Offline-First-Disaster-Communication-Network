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
  // Tracks the last time this node sent any authenticated request or heartbeat.
  // Used by the cron cleanup job instead of updatedAt so that profile edits
  // don't accidentally reset the inactivity timer.
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
 
// Indexes
userSchema.index({ 'location': '2dsphere' });
userSchema.index({ status: 1 });
userSchema.index({ lastSeen: 1 }); // Used by cron cleanup
 
module.exports = mongoose.model('User', userSchema);
