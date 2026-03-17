const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // Decode token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Find user and attach to request
      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        return res.status(401).json({ message: 'User not found' });
      }

      return next();
    } catch (error) {
      logger.error(`Token verification failed from IP ${req.ip}: ${error.message}`);
      logger.warn(`Failed auth attempt — IP: ${req.ip}, time: ${new Date().toISOString()}`);
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    logger.warn(`No token provided — IP: ${req.ip}, path: ${req.originalUrl}, time: ${new Date().toISOString()}`);
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Access denied — insufficient permissions`
      });
    }
    next();
  };
};

module.exports = { protect, authorize };
