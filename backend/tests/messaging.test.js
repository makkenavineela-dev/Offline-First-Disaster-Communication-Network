'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');

require('dotenv').config();

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const DEV_A = `MSG-A${uid()}`;
const DEV_B = `MSG-B${uid()}`;
const PASS = 'TestPass123!';

let tokenA = '';
let tokenB = '';
let userAId = '';
let userBId = '';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(
      process.env.MONGO_URI || 'mongodb://localhost:27017/resq-disaster-app',
      { serverSelectionTimeoutMS: 10000 }
    );
  }
  // Register two users for messaging tests
  const resA = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Alice', deviceId: DEV_A, password: PASS, role: 'civilian', zone: 'Zone-A' });
  tokenA = resA.body.token;
  userAId = resA.body._id;

  const resB = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Bob', deviceId: DEV_B, password: PASS, role: 'civilian', zone: 'Zone-A' });
  tokenB = resB.body.token;
  userBId = resB.body._id;
});

afterAll(async () => {
  const User = mongoose.model('User');
  const Message = mongoose.model('Message');
  await Promise.all([
    User.deleteOne({ _id: userAId }).catch(() => {}),
    User.deleteOne({ _id: userBId }).catch(() => {}),
    Message.deleteMany({ senderId: { $in: [userAId, userBId] } }).catch(() => {}),
  ]);
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
});

describe('Messaging — Send', () => {
  it('sends a broadcast message', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: 'broadcast', content: 'All clear in Zone A', zone: 'Zone-A' });

    expect(res.statusCode).toBe(201);
    expect(res.body.type).toBe('broadcast');
    expect(res.body.content).toBe('All clear in Zone A');
    expect(res.body.isDelivered).toBe(false);
  });

  it('sends a direct message to another user', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: 'direct', content: 'Hey Bob, are you safe?', receiverId: userBId });

    expect(res.statusCode).toBe(201);
    expect(res.body.type).toBe('direct');
    expect(res.body.isDelivered).toBe(false);
  });

  it('rejects direct message without receiverId', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: 'direct', content: 'Missing receiver' });

    expect(res.statusCode).toBe(400);
  });

  it('rejects message with invalid type', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: 'invalid_type', content: 'Bad type' });

    expect(res.statusCode).toBe(400);
  });

  it('requires authentication to send', async () => {
    const res = await request(app)
      .post('/api/messages')
      .send({ type: 'broadcast', content: 'Unauthenticated' });

    expect(res.statusCode).toBe(401);
  });
});

describe('Messaging — Retrieve', () => {
  it('fetches broadcast messages for a zone', async () => {
    const res = await request(app)
      .get('/api/messages/broadcasts/Zone-A')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('fetches direct message history between two users', async () => {
    const res = await request(app)
      .get(`/api/messages/direct/${userBId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('marks messages as delivered when recipient fetches them', async () => {
    // Bob fetches — the message Alice sent should be marked delivered
    const res = await request(app)
      .get(`/api/messages/direct/${userAId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.statusCode).toBe(200);
    // After fetch, re-fetch as Alice — messages should now be isDelivered: true
    const check = await request(app)
      .get(`/api/messages/direct/${userBId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    const delivered = check.body.filter(m => m.isDelivered === true);
    expect(delivered.length).toBeGreaterThan(0);
  });

  it('rejects broadcast fetch with invalid zone (too long)', async () => {
    const badZone = 'A'.repeat(51);
    const res = await request(app)
      .get(`/api/messages/broadcasts/${badZone}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.statusCode).toBe(400);
  });
});

describe('Messaging — SOS', () => {
  it('sends an SOS broadcast', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        type: 'sos',
        content: 'TRAPPED under debris — Zone A school',
        zone: 'Zone-A',
        locationTag: { lat: 17.385, lng: 78.4867 }
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.type).toBe('sos');
  });

  it('rejects SOS with invalid coordinates', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        type: 'sos',
        content: 'Bad coords',
        zone: 'Zone-A',
        locationTag: { lat: 999, lng: 999 }
      });

    expect(res.statusCode).toBe(400);
  });
});
