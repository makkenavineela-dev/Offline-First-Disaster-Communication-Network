'use strict';

const request  = require('supertest');
const mongoose = require('mongoose');
const app      = require('../server');

require('dotenv').config();

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const DEVICE = `SYN-${uid()}`;
const PASS   = 'TestPass123!';

let token  = '';
let userId = '';
let otherUserId = '';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(
      process.env.MONGO_URI || 'mongodb://localhost:27017/resq-disaster-app',
      { serverSelectionTimeoutMS: 10000 }
    );
  }
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'SyncUser', deviceId: DEVICE, password: PASS, role: 'civilian', zone: 'Zone-S' });
  token  = res.body.token;
  userId = res.body._id;

  const other = await request(app)
    .post('/api/auth/register')
    .send({ name: 'SyncOther', deviceId: DEVICE + '-b', password: PASS, role: 'civilian', zone: 'Zone-S' });
  otherUserId = other.body._id;
});

afterAll(async () => {
  const User     = mongoose.model('User');
  const Message  = mongoose.model('Message');
  const Resource = mongoose.model('Resource');
  await Promise.all([
    User.deleteMany({ _id: { $in: [userId, otherUserId] } }).catch(() => {}),
    Message.deleteMany({ senderId: userId }).catch(() => {}),
    Resource.deleteMany({ ownerId: userId }).catch(() => {}),
  ]);
  if (mongoose.connection.readyState === 1) await mongoose.connection.close();
});

describe('Sync — Push', () => {
  it('pushes a broadcast message offline batch', async () => {
    const res = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messages: [
          { clientId: `client-${Date.now()}`, type: 'broadcast', content: 'All safe at Zone S', zone: 'Zone-S' },
        ],
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.results.messages.created).toBe(1);
  });

  it('deduplicates messages with the same clientId', async () => {
    const clientId = `dedup-${Date.now()}`;
    await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ messages: [{ clientId, type: 'broadcast', content: 'First', zone: 'all' }] });

    const res = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ messages: [{ clientId, type: 'broadcast', content: 'Duplicate', zone: 'all' }] });

    expect(res.statusCode).toBe(200);
    expect(res.body.results.messages.skipped).toBe(1);
    expect(res.body.results.messages.created).toBe(0);
  });

  it('pushes a resource upsert', async () => {
    const res = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({
        resources: [{ type: 'food', quantity: 50, unit: 'kg', status: 'OK', isPublic: true }],
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.results.resources.upserted).toBe(1);
  });

  it('rejects resource with invalid type', async () => {
    const res = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ resources: [{ type: 'invalid', quantity: 1 }] });

    expect(res.statusCode).toBe(200);
    expect(res.body.results.resources.errors.length).toBeGreaterThan(0);
  });

  it('updates node location on push', async () => {
    const res = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ location: { lat: 12.9716, lng: 77.5946 }, status: 'safe' });

    expect(res.statusCode).toBe(200);
    expect(res.body.results.node.updated).toBe(true);
  });

  it('ignores (0,0) default coordinates', async () => {
    const res = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ location: { lat: 0, lng: 0 } });

    expect(res.statusCode).toBe(200);
    expect(res.body.results.node.updated).toBe(false);
  });

  it('requires auth to push', async () => {
    const res = await request(app)
      .post('/api/sync/push')
      .send({ messages: [] });

    expect(res.statusCode).toBe(401);
  });
});

describe('Sync — Pull', () => {
  it('pulls changes since a valid ISO timestamp', async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // last hour
    const res = await request(app)
      .get(`/api/sync/pull?since=${encodeURIComponent(since)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('messages');
    expect(res.body).toHaveProperty('nodes');
    expect(res.body).toHaveProperty('resources');
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it('defaults to last 24 hours when since is omitted', async () => {
    const res = await request(app)
      .get('/api/sync/pull')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('since');
    expect(res.body).toHaveProperty('now');
  });

  it('rejects invalid since timestamp', async () => {
    const res = await request(app)
      .get('/api/sync/pull?since=not-a-date')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
  });

  it('requires auth to pull', async () => {
    const res = await request(app).get('/api/sync/pull');
    expect(res.statusCode).toBe(401);
  });
});
