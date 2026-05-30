'use strict';

const request  = require('supertest');
const mongoose = require('mongoose');
const app      = require('../server');

require('dotenv').config();

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const DEVICE = `RES-${uid()}`;
const PASS   = 'TestPass123!';

let token  = '';
let userId = '';
let resourceId = '';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(
      process.env.MONGO_URI || 'mongodb://localhost:27017/resq-disaster-app',
      { serverSelectionTimeoutMS: 10000 }
    );
  }
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'ResUser', deviceId: DEVICE, password: PASS, role: 'shelter_admin', zone: 'Zone-R' });
  token  = res.body.token;
  userId = res.body._id;
});

afterAll(async () => {
  const User     = mongoose.model('User');
  const Resource = mongoose.model('Resource');
  await Promise.all([
    User.deleteOne({ _id: userId }).catch(() => {}),
    Resource.deleteMany({ ownerId: userId }).catch(() => {}),
  ]);
  if (mongoose.connection.readyState === 1) await mongoose.connection.close();
});

describe('Resources — Create', () => {
  it('creates a valid resource', async () => {
    const res = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bottled Water', type: 'water', quantity: 200, unit: 'litres', status: 'OK' });

    expect(res.statusCode).toBe(201);
    expect(res.body.name).toBe('Bottled Water');
    expect(res.body.type).toBe('water');
    resourceId = res.body._id;
  });

  it('rejects resource with invalid type', async () => {
    const res = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jet Fuel', type: 'aviation', quantity: 1 });

    expect(res.statusCode).toBe(400);
  });

  it('rejects resource with missing name', async () => {
    const res = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'medical', quantity: 10 });

    expect(res.statusCode).toBe(400);
  });

  it('requires auth to create', async () => {
    const res = await request(app)
      .post('/api/resources')
      .send({ name: 'X', type: 'food', quantity: 1 });

    expect(res.statusCode).toBe(401);
  });
});

describe('Resources — Read', () => {
  it('lists all public resources', async () => {
    const res = await request(app)
      .get('/api/resources')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(r => r._id === resourceId)).toBe(true);
  });

  it('lists only my resources via /me', async () => {
    const res = await request(app)
      .get('/api/resources/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.every(r => r.ownerId === userId || typeof r.ownerId === 'object')).toBe(true);
  });

  it('requires auth to list', async () => {
    const res = await request(app).get('/api/resources');
    expect(res.statusCode).toBe(401);
  });
});

describe('Resources — Update', () => {
  it('updates own resource', async () => {
    const res = await request(app)
      .put(`/api/resources/${resourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 150, status: 'LOW' });

    expect(res.statusCode).toBe(200);
    expect(res.body.quantity).toBe(150);
    expect(res.body.status).toBe('LOW');
  });

  it('rejects update with invalid type', async () => {
    const res = await request(app)
      .put(`/api/resources/${resourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'invalid' });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for non-existent resource', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .put(`/api/resources/${fakeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 1 });

    expect(res.statusCode).toBe(404);
  });
});

describe('Resources — Delete', () => {
  it('deletes own resource', async () => {
    const res = await request(app)
      .delete(`/api/resources/${resourceId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(resourceId);
  });

  it('returns 404 when deleting already-deleted resource', async () => {
    const res = await request(app)
      .delete(`/api/resources/${resourceId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(404);
  });
});
