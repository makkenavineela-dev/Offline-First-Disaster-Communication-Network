const request = require('supertest');
const app = require('../server');
const mongoose = require('mongoose');

describe('Health Check API', () => {
  afterAll(async () => {
    // Ensure all test database connections are closed after testing
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  });

  it('should return a 200 OK for the health endpoint with valid message', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.message).toMatch(/Operational/i);
  });

  it('should ensure the network routes are responsive', async () => {
    // Basic test to see if routes are at least defined/protected correctly
    const res = await request(app).get('/api/network/nodes');
    // It should be 401 because we haven't sent a token, but it proves the route is there
    expect([200, 401]).toContain(res.statusCode);
  });
});
