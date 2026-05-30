const express = require('express');
const router = express.Router();
const { getActiveNodes, updateStatus, heartbeat } = require('../controllers/networkController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.route('/nodes')
  .get(protect, getActiveNodes);

router.route('/status')
  .put(protect, authorize('responder', 'shelter_admin'), updateStatus);

router.route('/heartbeat')
  .put(protect, heartbeat);

// ─── Gossip peers ─────────────────────────────────────────────────────────────
// GET  /api/network/peers       — list this backend's gossip peers + status
// POST /api/network/peers       — add a peer at runtime  body: { url }
// DELETE /api/network/peers     — remove a peer            body: { url }
router.get('/peers', (req, res) => {
  const gossip = req.app.get('gossip');
  if (!gossip) return res.status(503).json({ message: 'Gossip layer unavailable' });
  res.json(gossip.getStatus());
});

router.post('/peers', protect, authorize('shelter_admin'), (req, res) => {
  const gossip = req.app.get('gossip');
  const url    = (req.body && req.body.url || '').trim();
  if (!gossip)         return res.status(503).json({ message: 'Gossip layer unavailable' });
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ message: 'Invalid peer URL (must start with http:// or https://)' });
  }
  gossip.connectToPeer(url);
  res.json({ message: 'Peer added', url });
});

router.delete('/peers', protect, authorize('shelter_admin'), (req, res) => {
  const gossip = req.app.get('gossip');
  const url    = (req.body && req.body.url || '').trim();
  if (!gossip) return res.status(503).json({ message: 'Gossip layer unavailable' });
  gossip.removePeer(url);
  res.json({ message: 'Peer removed', url });
});

module.exports = router;
