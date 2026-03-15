const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');
const compression = require('compression');
 
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
 

// ─── Startup Environment Validation ──────────────────────────────────────────
const DEFAULT_JWT = 'resq-offline-disaster-secret-CHANGE-IN-PRODUCTION';
if (process.env.JWT_SECRET === DEFAULT_JWT && process.env.NODE_ENV === 'production') {
  logger.error('FATAL: JWT_SECRET is using the default insecure value in production. Exiting.');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  logger.warn('WARNING: JWT_SECRET is not set — using insecure default. Set it in .env before deploying.');
}
if (!process.env.MONGO_URI) {
  logger.warn('WARNING: MONGO_URI not set — using localhost default.');
}

const app = express();

// ─── Compression ──────────────────────────────────────────────────────────────
app.use(compression());
 
// ─── Body Parser ──────────────────────────────────────────────────────────────
// Use a single json middleware with a per-path size limit so the sync endpoint
// can accept batched payloads (up to 1 MB) while all other routes stay at 10 KB.
// Having two separate express.json() calls caused duplicate-parse edge cases
// with Express 5's updated body-parser internals.
app.use(express.json({
  limit: (req) => (req.path.startsWith('/api/sync') ? '1mb' : '10kb'),
}));
 
// ─── CORS ─────────────────────────────────────────────────────────────────────
// Offline-first mesh: if ALLOWED_ORIGINS is not configured, reflect the request
// origin so all devices on the local LAN / hotspot can reach the server without
// any configuration.
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
    contentSecurityPolicy: false, // Allow Swagger UI inline scripts
  })
);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
 
// NoSQL injection sanitisation (removes $ and . from keys in req.body/query/params)
app.use(mongoSanitize());
 
// ── XSS Sanitisation ─────────────────────────────────────────────────────────
// xss-clean is deprecated and incompatible with Express 5 because it attempts
// to reassign req.query, which is a read-only getter in Express 5. We replace
// it with a focused inline sanitiser that cleans only req.body (the only
// user-controlled surface that matters here — JWT auth protects all routes).
// HTML-encoding is intentionally minimal: disaster messages must survive
// round-trips without mangling characters like < > & ' " in field names.
app.use((req, _res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitiseObject(req.body);
  }
  next();
});
 
function sanitiseValue(val) {
  if (typeof val === 'string') {
    // Strip script tags and javascript: URIs — the only XSS vectors we care
    // about in this JSON API (no HTML is rendered server-side).
    return val
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/javascript\s*:/gi, '');
  }
  if (Array.isArray(val)) return val.map(sanitiseValue);
  if (val !== null && typeof val === 'object') return sanitiseObject(val);
  return val;
}
 
function sanitiseObject(obj) {
  const clean = {};
  for (const key of Object.keys(obj)) {
    clean[key] = sanitiseValue(obj[key]);
  }
  return clean;
}
 
// ─── Rate Limiting ────────────────────────────────────────────────────────────
// Standard limiter: 100 requests / 15 min per IP for all regular API routes.
const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: 'Too many requests from this IP, please try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip sync routes entirely — they have their own dedicated limiter below.
  skip: (req) => req.path.startsWith('/api/sync'),
});
 
// Relaxed limiter for the sync endpoint only (100 / 15 min).
// Devices may push large queued batches when they reconnect after being offline.
const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: 'Sync rate limit exceeded, please retry shortly' },
  standardHeaders: true,
  legacyHeaders: false,
});
 
app.use('/api/sync', syncLimiter);   // 300 req/15 min — sync only
app.use('/api/', standardLimiter);   // 100 req/15 min — everything else (sync skipped)
 
// ─── Lightweight Ping (no auth, no DB hit) ────────────────────────────────────
app.get('/api/ping', (_req, res) => {
  res.json({ pong: true, ts: new Date().toISOString() });
});
 
// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  res.json({
    message: 'Welcome to RESQ Disaster Response API — System Operational 🟢',
    database: states[mongoose.connection.readyState] || 'unknown',
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
  logger.warn('Swagger YAML could not be loaded — API docs route unavailable.');
}
 
// ─── 404 Catch-All ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.originalUrl} not found` });
});
 
// ─── Global Error Handler (must be last) ─────────────────────────────────────
app.use(errorHandler);
 
// ─── Database + Server Bootstrap ──────────────────────────────────────────────
const PORT     = parseInt(process.env.PORT, 10) || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/resq-disaster-app';
 
let server;
 
if (process.env.NODE_ENV !== 'test') {
  mongoose
    .connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    })
    .then(() => {
      logger.info('✅ Connected to MongoDB');
      initCronJobs();
      // Bind to 0.0.0.0 so all local network interfaces are reachable
      server = app.listen(PORT, '0.0.0.0', () => {
        logger.info(`🚀 RESQ API running on port ${PORT}`);
        logger.info(`📡 Swagger docs: http://localhost:${PORT}/api-docs`);
      });
    })
    .catch((err) => {
      logger.error(`❌ MongoDB connection failed: ${err.message}`);
      process.exit(1);
    });
}
 
// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  if (server) {
    server.close(() => {
      // Mongoose 9: connection.close() returns a Promise; no callback arg.
      mongoose.connection.close().then(() => {
        logger.info('MongoDB connection closed');
        process.exit(0);
      });
    });
    setTimeout(() => process.exit(1), 10000); // force-exit if stuck
  } else {
    process.exit(0);
  }
};
 
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
 
module.exports = app;
