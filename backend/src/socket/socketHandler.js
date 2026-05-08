'use strict';

// In-memory node registry: socketId -> nodeInfo
// Survives across reconnections within a server session.
const activeNodes = new Map();

function initSocket(io) {
  io.on('connection', (socket) => {

    // ── JOIN ──────────────────────────────────────────────────────────────────
    socket.on('join', (data) => {
      const node = {
        socketId: socket.id,
        userId:   data.userId  || socket.id,
        name:     data.name    || 'Unknown',
        role:     data.role    || 'civilian',
        zone:     data.zone    || 'unknown',
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
    });

    // ── MESSAGE ───────────────────────────────────────────────────────────────
    socket.on('message', (data) => {
      const sender = activeNodes.get(socket.id);
      if (!sender) return;

      const msg = {
        id:       data.clientId || `${socket.id}-${Date.now()}`,
        from:     sender.userId,
        fromName: sender.name,
        fromRole: sender.role,
        to:       data.to      || 'all',
        type:     data.type    || 'broadcast',
        content:  data.content || '',
        timestamp: Date.now(),
      };

      if (!msg.content.trim()) return;

      if (msg.to === 'all' || msg.to === 'broadcast') {
        io.emit('message', msg);

      } else if (msg.to === 'zone') {
        for (const [sid, node] of activeNodes) {
          if (node.zone === sender.zone) io.to(sid).emit('message', msg);
        }

      } else {
        // Direct message — route by userId
        for (const [sid, node] of activeNodes) {
          if (node.userId === msg.to) { io.to(sid).emit('message', msg); break; }
        }
        socket.emit('message', msg); // echo back to sender
      }

      socket.emit('ack', { clientId: data.clientId, delivered: true });
    });

    // ── SOS ───────────────────────────────────────────────────────────────────
    socket.on('sos', (data) => {
      const sender = activeNodes.get(socket.id);
      if (!sender) return;

      sender.status = 'sos';
      activeNodes.set(socket.id, sender);

      const alert = {
        id:        data.clientId || `sos-${socket.id}-${Date.now()}`,
        from:      sender.userId,
        fromName:  sender.name,
        alertType: data.alertType || 'general',
        message:   data.message   || '',
        lat:       data.lat       != null ? data.lat : sender.lat,
        lng:       data.lng       != null ? data.lng : sender.lng,
        timestamp: Date.now(),
      };

      // Broadcast SOS to every connected node
      io.emit('sos_alert', alert);
      socket.emit('ack', { clientId: data.clientId, delivered: true });
    });

    // ── LOCATION UPDATE ───────────────────────────────────────────────────────
    socket.on('location', (data) => {
      const node = activeNodes.get(socket.id);
      if (!node) return;

      node.lat      = data.lat;
      node.lng      = data.lng;
      node.lastSeen = Date.now();
      activeNodes.set(socket.id, node);

      socket.broadcast.emit('location_update', {
        userId:   node.userId,
        name:     node.name,
        role:     node.role,
        lat:      data.lat,
        lng:      data.lng,
        accuracy: data.accuracy || null,
      });
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
