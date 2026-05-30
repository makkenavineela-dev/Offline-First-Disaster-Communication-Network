/**
 * RESQ Peer Gossip
 *
 * Lets multiple backends form a backbone over LAN/internet so messages, SOS
 * alerts, and location updates can hop between WiFi zones beyond the range
 * of any single backend.
 *
 * Design:
 *  - Each backend has a unique nodeId (RESQ_NODE_ID env var, else random).
 *  - Backend A connects (as Socket.io client) to backend B's URL and emits
 *    a `peer_handshake` so B knows it's a peer, not a phone.
 *  - Backend B does the same in reverse — connections are bidirectional.
 *  - Every gossip event carries: { type, payload, msgId, ttl, hops, originNode }
 *  - Seen-msg cache (5-min TTL) deduplicates messages that arrive via two
 *    routes in a mesh of >2 backends.
 *  - TTL prevents infinite loops; hops list lets us skip peers that already
 *    saw the message.
 */
'use strict';

const ioClient = require('socket.io-client');
const logger   = require('../utils/logger');

const SEEN_TTL_MS = 5 * 60 * 1000;
const MAX_HOPS    = 5;

class PeerGossip {
  constructor(nodeId) {
    this.nodeId       = nodeId;
    this.peers        = new Map();   // url -> { socket, status, lastConnected, lastError }
    this.seenMessages = new Map();   // msgId -> timestampReceived
    this.handlers     = [];          // (envelope) => void — called when forwarded msg arrives

    setInterval(() => this._pruneSeen(), 60_000).unref();
  }

  // ── Peer connection management ────────────────────────────────────────
  connectToPeer(url) {
    if (!url || this.peers.has(url)) return;

    const socket = ioClient(url, {
      transports:         ['websocket', 'polling'],
      reconnection:        true,
      reconnectionDelay:   5_000,
      reconnectionDelayMax: 30_000,
      timeout:             6_000,
      query: { peerNode: this.nodeId },
    });

    const entry = { socket, status: 'connecting', lastConnected: null, lastError: null };
    this.peers.set(url, entry);

    socket.on('connect', () => {
      entry.status        = 'connected';
      entry.lastConnected = Date.now();
      entry.lastError     = null;
      socket.emit('peer_handshake', { nodeId: this.nodeId });
      logger.info(`🌐 Gossip peer connected: ${url}`);
    });

    socket.on('disconnect', (reason) => {
      entry.status    = 'disconnected';
      entry.lastError = reason;
      logger.warn(`🌐 Gossip peer disconnected: ${url} (${reason})`);
    });

    socket.on('connect_error', (err) => {
      entry.status    = 'error';
      entry.lastError = err.message || String(err);
    });

    socket.on('gossip', (envelope) => this._handleIncoming(envelope));
  }

  removePeer(url) {
    const peer = this.peers.get(url);
    if (!peer) return;
    try { peer.socket.disconnect(); } catch (_) {}
    this.peers.delete(url);
    logger.info(`🌐 Gossip peer removed: ${url}`);
  }

  // ── Listener for forwarded messages (socketHandler registers here) ────
  onForwarded(fn) {
    if (typeof fn === 'function') this.handlers.push(fn);
  }

  // ── Gossip origination — called by socketHandler when a local message
  //    arrives from a phone, so it gets forwarded to all peer backends.
  gossip(envelope) {
    if (!envelope || !envelope.type) return;

    envelope.msgId      = envelope.msgId      || this._makeId();
    envelope.ttl        = envelope.ttl        || MAX_HOPS;
    envelope.hops       = envelope.hops       || [];
    envelope.originNode = envelope.originNode || this.nodeId;

    if (this.seenMessages.has(envelope.msgId)) return;
    this.seenMessages.set(envelope.msgId, Date.now());

    this._forward(envelope);
  }

  // ── Inbound gossip from a peer ────────────────────────────────────────
  _handleIncoming(envelope) {
    if (!envelope || !envelope.msgId) return;
    if (envelope.ttl == null || envelope.ttl <= 0) return;
    if (this.seenMessages.has(envelope.msgId)) return;

    this.seenMessages.set(envelope.msgId, Date.now());

    // Notify socketHandler so it can broadcast to local phones
    for (const fn of this.handlers) {
      try { fn(envelope); } catch (e) { logger.warn(`Gossip handler error: ${e.message}`); }
    }

    // Re-forward to other peers (loop guard prevents echo to sender)
    this._forward(envelope);
  }

  _forward(envelope) {
    if (envelope.hops.includes(this.nodeId)) return; // loop guard

    const next = {
      ...envelope,
      ttl:  envelope.ttl - 1,
      hops: [...envelope.hops, this.nodeId],
    };
    if (next.ttl <= 0) return;

    for (const [, peer] of this.peers) {
      if (peer.status === 'connected') {
        try { peer.socket.emit('gossip', next); } catch (_) {}
      }
    }
  }

  _pruneSeen() {
    const cutoff = Date.now() - SEEN_TTL_MS;
    for (const [id, ts] of this.seenMessages) {
      if (ts < cutoff) this.seenMessages.delete(id);
    }
  }

  _makeId() {
    return `${this.nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ── Status (for /api/network/peers admin endpoint) ────────────────────
  getStatus() {
    return {
      nodeId: this.nodeId,
      peers:  Array.from(this.peers.entries()).map(([url, p]) => ({
        url,
        status:        p.status,
        lastConnected: p.lastConnected,
        lastError:     p.lastError,
      })),
      seenMessagesCount: this.seenMessages.size,
    };
  }
}

module.exports = PeerGossip;
