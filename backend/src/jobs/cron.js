const cron = require('node-cron');
const User = require('../models/User');
const logger = require('../utils/logger');

// Business Logic Layer: Background Daemon Tasks
const initCronJobs = () => {
  // Run every hour to check for offline/dead mesh nodes
  cron.schedule('0 * * * *', async () => {
    logger.info('[Cron] Running periodic node cleanup task...');
    try {
      // Find all users who haven't updated location/pinged in 48 hours
      // CRITICAL: We NEVER auto-offline users with status 'sos'
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      
      const result = await User.updateMany(
        { 
          status: { $in: ['active', 'safe'] },
          role: { $nin: ['responder', 'admin'] },
          updatedAt: { $lt: fortyEightHoursAgo }
        },
        { $set: { status: 'offline' } }
      );
      
      if (result.modifiedCount > 0) {
        logger.warn(`[Cron] Marked ${result.modifiedCount} silent nodes as offline.`);
      }
    } catch (error) {
      logger.error(`[Cron] Error during node cleanup: ${error.message}`);
    }
  });
};

module.exports = initCronJobs;
