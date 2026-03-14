const cron = require('node-cron');
const User = require('../models/User');

// Business Logic Layer: Background Daemon Tasks
const initCronJobs = () => {
  // Run every hour to check for offline/dead mesh nodes
  cron.schedule('0 * * * *', async () => {
    console.log('[Cron Worker] Running periodic node cleanup task...');
    try {
      // Find all users who haven't updated location/pinged in 24 hours
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const result = await User.updateMany(
        { 
          status: { $in: ['active', 'safe'] },
          'location.timestamp': { $lt: twentyFourHoursAgo }
        },
        { $set: { status: 'offline' } }
      );
      
      if (result.modifiedCount > 0) {
        console.log(`[Cron Worker] Marked ${result.modifiedCount} silent nodes as offline.`);
      }
    } catch (error) {
      console.error('[Cron Worker] Error during node cleanup:', error.message);
    }
  });
};

module.exports = initCronJobs;
