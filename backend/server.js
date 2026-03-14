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

// Custom Middleware
const { errorHandler } = require('./src/middleware/errorMiddleware');

// Background Jobs
const initCronJobs = require('./src/jobs/cron');

// Logger
const logger = require('./src/utils/logger');

// Load env vars
dotenv.config();

const app = express();

// Middleware
app.use(express.json({ limit: '10kb' })); // Body parser explicitly sized
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true
}));
app.use(helmet());
app.use(morgan('dev'));

// Data Sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data Sanitization against XSS
app.use(xss());

// Rate Limiting Config
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again in 15 minutes'
});
app.use('/api/', limiter);

// Basic health check route
app.get('/api/health', (req, res) => {
  res.json({ message: 'Welcome to RESQ Disaster Response API — System Operational 🟢' });
});

// API Routes
app.use('/api', authRoutes); // Auth and User Profile Routes
app.use('/api/messages', messageRoutes); // Messaging, SOS, and Broadcast Routes
app.use('/api/resources', resourceRoutes); // Shelter Resource Syncing Routes
app.use('/api/network', networkRoutes); // Mesh Connectivity / Map Tracking Routes

// API Documentation (Swagger)
const swaggerDocument = YAML.load(path.join(__dirname, 'swagger.yaml'));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Error Handling Middleware (must be after all routes)
app.use(errorHandler);

// Database Connection
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/resq-disaster-app';

if (process.env.NODE_ENV !== 'test') {
  mongoose
    .connect(MONGO_URI)
    .then(() => {
      logger.info('✅ Connected to MongoDB Backend Storage');
      
      // Initialize standard background data management layers
      initCronJobs();

      app.listen(PORT, () => {
        logger.info(`🚀 API Server running robustly on port ${PORT}`);
      });
    })
    .catch((error) => {
      logger.error(`❌ MongoDB Connection Error: ${error.message}`);
      process.exit(1);
    });
}

// Export for integration testing
module.exports = app;
