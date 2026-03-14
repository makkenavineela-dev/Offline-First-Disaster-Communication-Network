const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');
 
// Route Imports
const authRoutes = require('./src/routes/authRoutes');
const messageRoutes = require('./src/routes/messageRoutes');
const resourceRoutes = require('./src/routes/resourceRoutes');
const networkRoutes = require('./src/routes/networkRoutes');
const syncRoutes = require('./src/routes/syncRoutes');
 
// Custom Middleware
const { errorHandler } = require('./src/middleware/errorMiddleware');
 
// Background Jobs
const initCronJobs = require('./src/jobs/cron');
 
// Logger
const logger = require('./src/utils/logger');
 
// Load env vars
dotenv.config();
 
const app = express();
 
// ─── Body Parser ─────────────────────────────────────────────────────────────
// Sync endpoint needs more room for batched offline payloads (up to 1MB)
app.use('/api/sync', express.json({ limit: '1mb' }));
app.use(express.json({ limit: '10kb' }));
 
// ─── CORS ─────────────────────────────────────────────────────────────────────
// Offline-first mesh: if ALLOWED_ORIGINS is not configured, reflect the request
// origin so all devices on the local LAN / hotspot can reach the server.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
 
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  })
);
 
// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(
  helmet({
    // Allow Swagger UI to load its own inline scripts
    contentSecurityPolicy: false,
  })
);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(mongoSanitize());
app.use(xss());
 
// ─── Rate Limiting ────────────────────────────────────────────────────────────
// Standard limiter: 100 requests / 15 min per IP
const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: 'Too many requests from this IP, please try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});
 
// Relaxed limiter for sync: devices may push large queued batches on reconnect
const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { message: 'Sync rate limit exceeded, please retry shortly' },
  standardHeaders: true,
  legacyHeaders: false,
});
 
// Order matters: apply sync limiter before the standard one
app.use('/api/sync', syncLimiter);
app.use('/api/', standardLimiter);
 
// ─── Lightweight Ping (no auth, no DB hit) ────────────────────────────────────
// Clients use this to check if the local server is reachable before syncing.
app.get('/api/ping', (req, res) => {
  res.json({ pong: true, ts: new Date().toISOString() });
});
 
// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const dbStateMap = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  const dbStatus = dbStateMap[mongoose.connection.readyState] || 'unknown';
 
  res.json({
    message: 'Welcome to RESQ Disaster Response API — System Operational 🟢',
    database: dbStatus,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
 
// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api', authRoutes);               // Auth and User Profile
app.use('/api/messages', messageRoutes);   // Messaging, SOS, Broadcast
app.use('/api/resources', resourceRoutes); // Shelter Resource Syncing
app.use('/api/network', networkRoutes);    // Mesh Connectivity / Map
app.use('/api/sync', syncRoutes);          // Offline-First Batch Sync
 
// ─── API Documentation (Swagger) ──────────────────────────────────────────────
try {
  const swaggerDocument = YAML.load(path.join(__dirname, 'swagger.yaml'));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
} catch {
  logger.warn('Swagger YAML could not be loaded — API docs unavailable.');
}
 
// ─── 404 Catch-All ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.originalUrl} not found` });
});
 
// ─── Error Handling Middleware (must be last) ─────────────────────────────────
app.use(errorHandler);
 
// ─── Database + Server Bootstrap ─────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 5000;
const MONGO_URI =
  process.env.MONGO_URI || 'mongodb://localhost:27017/resq-disaster-app';
 
let server;
 
if (process.env.NODE_ENV !== 'test') {
  mongoose
    .connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000, // fail fast if DB is unreachable
      socketTimeoutMS: 45000,
    })
    .then(() => {
      logger.info('✅ Connected to MongoDB');
 
      initCronJobs();
 
      // Listen on all interfaces (0.0.0.0) so local network devices can reach us
      server = app.listen(PORT, '0.0.0.0', () => {
        logger.info(`🚀 RESQ API running on port ${PORT}`);
        logger.info(`📡 Swagger docs: http://localhost:${PORT}/api-docs`);
      });
    })
    .catch((error) => {
      logger.error(`❌ MongoDB connection error: ${error.message}`);
      process.exit(1);
    });
}
 
// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  if (server) {
    server.close(() => {
      mongoose.connection.close(false).then(() => {
        logger.info('MongoDB connection closed');
        process.exit(0);
      });
    });
    // Force exit after 10 s if graceful close stalls
    setTimeout(() => process.exit(1), 10000);
  } else {
    process.exit(0);
  }
};
 
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
 
// Export for integration testing
module.exports = app;
