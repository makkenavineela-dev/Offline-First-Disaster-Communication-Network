'use strict';

const request  = require('supertest');
const mongoose = require('mongoose');
const app      = require('../server');

require('dotenv').config();

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const CIVILIAN_DEV = `CIV-${uid()}`;
const ADMIN_DEV    = `ADM-${uid()}`;
const PASS         = 'TestPass123!';

let civToken   = '';
let adminToken = '';
let civId      = '';
let adminId    = '';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(
      process.env.MONGO_URI || 'mongodb://localhost:27017/resq-disaster-app',
      { serverSelectionTimeoutMS: 10000 }
    );
  }
  const civ = await request(app)
    .post('/api/auth/register')
    .send({ name: 'NetCivilian', deviceId: CIVILIAN_DEV, password: PASS, role: 'civilian', zone: 'Zone-N' });
  civToken = civ.body.token;
  civId    = civ.body._id;

  const adm = await request(app)
    .post('/api/auth/register')
    .send({ name: 'NetAdmin', deviceId: ADMIN_DEV, password: PASS, role: 'shelter_admin', zone: 'Zone-N' });
  adminToken = adm.body.token;
  adminId    = adm.body._id;
});

afterAll(async () => {
  const User = mongoose.model('User');
  await User.deleteMany({ _id: { $in: [civId, adminId] } }).catch(() => {});
  if (mongoose.connection.readyState === 1) await mongoose.connection.close();
});

describe('Network — Active Nodes', () => {
  it('returns list of active nodes', async () => {
    const res = await request(app)
      .get('/api/network/nodes')
      .set('Authorization', `Bearer ${civToken}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('requires auth to fetch nodes', async () => {
    const res = await request(app).get('/api/network/nodes');
    expect(res.statusCode).toBe(401);
  });
});

describe('Network — Heartbeat', () => {
  it('acknowledges heartbeat with ok:true', async () => {
    const res = await request(app)
      .put('/api/network/heartbeat')
      .set('Authorization', `Bearer ${civToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty('ts');
  });

  it('requires auth for heartbeat', async () => {
    const res = await request(app).put('/api/network/heartbeat');
    expect(res.statusCode).toBe(401);
  });
});

describe('Network — Status Update', () => {
  it('allows shelter_admin to update status', async () => {
    const res = await request(app)
      .put('/api/network/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active' });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it('rejects invalid status value', async () => {
    const res = await request(app)
      .put('/api/network/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'flying' });

    expect(res.statusCode).toBe(400);
  });

  it('forbids civilian from updating status', async () => {
    const res = await request(app)
      .put('/api/network/status')
      .set('Authorization', `Bearer ${civToken}`)
      .send({ status: 'active' });

    expect(res.statusCode).toBe(403);
  });

  it('requires auth for status update', async () => {
    const res = await request(app)
      .put('/api/network/status')
      .send({ status: 'active' });

    expect(res.statusCode).toBe(401);
  });
});

describe('Network — Gossip Peers', () => {
  it('returns gossip peer status', async () => {
    const res = await request(app).get('/api/network/peers');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('nodeId');
    expect(Array.isArray(res.body.peers)).toBe(true);
  });

  it('rejects adding a peer with invalid URL', async () => {
    const res = await request(app)
      .post('/api/network/peers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ url: 'not-a-url' });

    expect(res.statusCode).toBe(400);
  });

  it('forbids civilian from adding a peer', async () => {
    const res = await request(app)
      .post('/api/network/peers')
      .set('Authorization', `Bearer ${civToken}`)
      .send({ url: 'http://192.168.1.99:5000' });

    expect(res.statusCode).toBe(403);
  });
});
