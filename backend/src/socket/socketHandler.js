'use strict';

const mongoose = require('mongoose');

// Haversine distance in kilometres between two lat/lng points
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SOS_RADIUS_KM = 3;

// In-memory node registry: socketId -> nodeInfo
// Survives across reconnections within a server session.
const activeNodes = new Map();

/**
 * Initialise the Socket.io layer.
 * @param {SocketIO.Server} io
 * @param {import('./peerGossip')} [gossip] — optional PeerGossip instance.
 *        When provided, local phone messages are forwarded to peer backends
 *        and incoming forwarded messages are broadcast to local phones.
 */
function initSocket(io, gossip) {

  // ── Gossip → Local: when another backend forwards a message to us,
  //    broadcast it to the phones connected here so they see it too.
  if (gossip) {
    gossip.onForwarded((envelope) => {
      const { type, payload } = envelope;
      if (!type || !payload) return;
      // Tag with hop metadata so UI can show "via 2 hops" if desired
      payload._mesh = { originNode: envelope.originNode, hops: envelope.hops };
      io.emit(type, payload);
    });
  }

  io.on('connection', (socket) => {

    // ── PEER BACKEND CONNECTION ───────────────────────────────────────────────
    // Another backend connected to us as a Socket.io client.
    // We do NOT register the regular phone handlers — only gossip.
    const peerNodeId = socket.handshake.query && socket.handshake.query.peerNode;
    if (peerNodeId) {
      socket.on('peer_handshake', (data) => {
        socket.data.isPeer = true;
        socket.data.peerNodeId = data && data.nodeId ? data.nodeId : peerNodeId;
      });
      socket.on('gossip', (envelope) => {
        if (gossip) gossip._handleIncoming(envelope);
      });
      socket.on('disconnect', () => { /* peer left — no phone cleanup */ });
      return;
    }

    // ── JOIN ──────────────────────────────────────────────────────────────────
    socket.on('join', (data) => {
      const incomingUserId = data.userId || socket.id;
      const incomingPhone  = data.phone  || null;

      // One device = one node. If the same userId or phone is already connected
      // (e.g. page refresh, duplicate tab), evict the old socket so the map
      // never shows the same person twice.
      for (const [sid, existing] of activeNodes) {
        const sameUser  = existing.userId === incomingUserId && incomingUserId !== socket.id;
        const samePhone = incomingPhone && existing.phone === incomingPhone;
        if (sameUser || samePhone) {
          activeNodes.delete(sid);
          io.to(sid).emit('session_replaced'); // politely tell old tab
          io.emit('node_left', { userId: existing.userId, name: existing.name });
          break;
        }
      }

      const node = {
        socketId: socket.id,
        userId:   incomingUserId,
        name:     data.name    || 'Unknown',
        role:     data.role    || 'civilian',
        zone:     data.zone    || 'unknown',
        phone:    incomingPhone,
        lat:      data.lat     || null,
        lng:      data.lng     || null,
        status:   'active',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      };

      activeNodes.set(socket.id, node);

      // Send current node list to the newly joined client
      socket.emit('joined', {
        nodeId: socket.id,
        nodes:  Array.from(activeNodes.values()),
      });

      // Notify all other nodes
      socket.broadcast.emit('node_joined', node);

      // Gossip to peer backends so distant zones see this node too
      if (gossip) gossip.gossip({ type: 'node_joined', payload: node });
    });

    // ── MESSAGE ───────────────────────────────────────────────────────────────
    socket.on('message', (data) => {
      const sender = activeNodes.get(socket.id);
      if (!sender) return;

      const msg = {
        id:        data.clientId || `${socket.id}-${Date.now()}`,
        from:      sender.userId,
        fromName:  sender.name,
        fromRole:  sender.role,
        fromPhone: sender.phone || null,
        to:        data.to      || 'all',
        type:     data.type    || 'broadcast',
        content:  data.content || '',
        timestamp: Date.now(),
      };

      if (!msg.content.trim()) return;

      let delivered = false;

      if (msg.to === 'all' || msg.to === 'broadcast') {
        io.emit('message', msg);
        delivered = true;

      } else if (msg.to === 'zone') {
        for (const [sid, node] of activeNodes) {
          if (node.zone === sender.zone) { io.to(sid).emit('message', msg); delivered = true; }
        }

      } else {
        // Direct message — route by userId, track if recipient is online
        for (const [sid, node] of activeNodes) {
          if (node.userId === msg.to) {
            io.to(sid).emit('message', msg);
            // Notify recipient's socket to send a delivery receipt back to sender
            io.to(sid).emit('delivery_receipt', { clientId: data.clientId, from: sender.userId });
            delivered = true;
            break;
          }
        }
        socket.emit('message', msg); // echo back to sender
      }

      socket.emit('ack', { clientId: data.clientId, delivered });

      // Forward to peer backends (gossip layer dedupes + TTLs)
      if (gossip) gossip.gossip({ type: 'message', payload: msg });
    });

    // ── SOS ───────────────────────────────────────────────────────────────────
    socket.on('sos', async (data) => {
      const sender = activeNodes.get(socket.id);
      if (!sender) return;

      sender.status = 'sos';
      activeNodes.set(socket.id, sender);

      const alert = {
        id:        data.clientId || `sos-${socket.id}-${Date.now()}`,
        from:      sender.userId,
        fromName:  sender.name,
        fromPhone: sender.phone || null,
        alertType: data.alertType || 'general',
        message:   data.message   || '',
        lat:       data.lat       != null ? data.lat : sender.lat,
        lng:       data.lng       != null ? data.lng : sender.lng,
        timestamp: Date.now(),
      };

      const hasLocation = alert.lat != null && alert.lng != null;

      // Emit only to nodes within SOS_RADIUS_KM (3 km).
      // Nodes with unknown location always receive the alert (can't filter them out).
      // If the sender has no location, broadcast to all — can't filter without a reference point.
      for (const [sid, node] of activeNodes) {
        if (!hasLocation || node.lat == null || node.lng == null) {
          io.to(sid).emit('sos_alert', alert);
        } else {
          const dist = haversineKm(alert.lat, alert.lng, node.lat, node.lng);
          if (dist <= SOS_RADIUS_KM) {
            io.to(sid).emit('sos_alert', alert);
          }
        }
      }

      socket.emit('ack', { clientId: data.clientId, delivered: true });

      // Persist SOS to MongoDB so chat history survives reconnects
      try {
        const Message = require('../models/Message');
        if (mongoose.isValidObjectId(sender.userId)) {
          await Message.create({
            clientId:    alert.id,
            senderId:    sender.userId,
            type:        'sos',
            content:     `[SOS ${(alert.alertType || 'GENERAL').toUpperCase()}] ${alert.message || 'Emergency alert'}`,
            zone:        'all',
            locationTag: hasLocation ? { lat: alert.lat, lng: alert.lng } : undefined,
          });
        }
      } catch (_) {
        // Duplicate clientId or DB unavailable — not critical for delivery
      }

      // SOS is the most critical event — forward to peers so distant zones can respond
      if (gossip) gossip.gossip({ type: 'sos_alert', payload: alert });
    });

    // ── LOCATION UPDATE ───────────────────────────────────────────────────────
    socket.on('location', (data) => {
      const node = activeNodes.get(socket.id);
      if (!node) return;

      node.lat      = data.lat;
      node.lng      = data.lng;
      node.lastSeen = Date.now();
      activeNodes.set(socket.id, node);

      const update = {
        userId:   node.userId,
        name:     node.name,
        role:     node.role,
        lat:      data.lat,
        lng:      data.lng,
        accuracy: data.accuracy || null,
      };

      socket.broadcast.emit('location_update', update);

      // Forward to peers so the cross-zone map stays in sync
      if (gossip) gossip.gossip({ type: 'location_update', payload: update });
    });

    // ── HEARTBEAT ─────────────────────────────────────────────────────────────
    socket.on('heartbeat', () => {
      const node = activeNodes.get(socket.id);
      if (node) { node.lastSeen = Date.now(); activeNodes.set(socket.id, node); }
      socket.emit('heartbeat_ack');
    });

    // ── DISCONNECT ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const node = activeNodes.get(socket.id);
      if (node) {
        activeNodes.delete(socket.id);
        io.emit('node_left', { userId: node.userId, name: node.name });
        if (gossip) gossip.gossip({ type: 'node_left', payload: { userId: node.userId, name: node.name } });
      }
    });
  });

  // Prune nodes that haven't sent a heartbeat in 2 minutes
  setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 1000;
    for (const [sid, node] of activeNodes) {
      if (node.lastSeen < cutoff) {
        activeNodes.delete(sid);
        io.emit('node_left', { userId: node.userId, name: node.name });
      }
    }
  }, 60_000);
}

module.exports = initSocket;
