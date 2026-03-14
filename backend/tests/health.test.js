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

  it('should return a 200 OK for the health endpoint', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body.message).toContain('Operational');
  });
});
