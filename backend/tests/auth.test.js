'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');

require('dotenv').config();

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const TEST_DEVICE = `AUT-${uid()}`;
const TEST_PASS = 'TestPass123!';
let authToken = '';
let userId = '';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(
      process.env.MONGO_URI || 'mongodb://localhost:27017/resq-disaster-app',
      { serverSelectionTimeoutMS: 10000 }
    );
  }
});

afterAll(async () => {
  // Clean up test user
  if (userId) {
    const User = mongoose.model('User');
    await User.deleteOne({ _id: userId }).catch(() => {});
  }
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
});

describe('Auth — Register', () => {
  it('registers a new user and returns a JWT', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test User', deviceId: TEST_DEVICE, password: TEST_PASS, role: 'civilian', zone: 'Zone-A' });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.deviceId).toBe(TEST_DEVICE);
    authToken = res.body.token;
    userId = res.body._id;
  });

  it('rejects duplicate deviceId registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Duplicate', deviceId: TEST_DEVICE, password: TEST_PASS });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/already registered/i);
  });

  it('rejects registration with missing required fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'No Device' });

    expect(res.statusCode).toBe(400);
  });
});

describe('Auth — Login', () => {
  it('logs in with correct credentials and returns a JWT', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ deviceId: TEST_DEVICE, password: TEST_PASS });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('token');
    authToken = res.body.token;
  });

  it('rejects login with wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ deviceId: TEST_DEVICE, password: 'wrong' });

    expect(res.statusCode).toBe(401);
  });

  it('rejects login with unknown deviceId', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ deviceId: 'nonexistent-device', password: TEST_PASS });

    expect(res.statusCode).toBe(401);
  });
});

describe('Auth — Profile', () => {
  it('returns profile for authenticated user', async () => {
    const res = await request(app)
      .get('/api/users/profile')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.deviceId).toBe(TEST_DEVICE);
    expect(res.body.role).toBe('civilian');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/users/profile');
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/users/profile')
      .set('Authorization', 'Bearer invalid.token.here');
    expect(res.statusCode).toBe(401);
  });
});
