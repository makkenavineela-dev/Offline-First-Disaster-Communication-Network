'use strict';

const mongoose = require('mongoose');
require('dotenv').config();

// Connect before each test file; reconnect if a previous file closed the connection.
beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(
      process.env.MONGO_URI || 'mongodb://localhost:27017/resq-disaster-app',
      { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000 }
    );
  }
});

// Close after each test file so cleanup logic in individual files stays valid.
afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
});
