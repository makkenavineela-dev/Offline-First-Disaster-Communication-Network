/**
 * RESQ Mesh — offline-first P2P communication layer
 *
 * How it works without internet:
 *  One device on the local network runs the backend server (node server.js).
 *  All other devices connect to it via WebSocket over the shared WiFi/hotspot.
 *  No cloud server, no internet required — just a local IP.
 *
 * The server URL is discovered in this order:
 *  1. Value stored in localStorage under 'resq_server_ip'  (set from Settings)
 *  2. Same host as the page (works when backend serves the frontend)
 *  3. localhost:5000 (when running locally on the same device)
 */
(function () {
  'use strict';

  // ── Storage keys ─────────────────────────────────────────────────────────────
  const KEY_SERVER   = 'resq_server_ip';
  const KEY_NODES    = 'resq_nodes';
  const KEY_MSG_Q    = 'resq_msg_queue';
  const KEY_MSG_HIST = 'resq_msg_history';
  const KEY_SOS_HIST = 'resq_sos_history';

  // ── Internal state ────────────────────────────────────────────────────────────
  const _listeners  = {};   // event → [fn, ...]
  let   _socket     = null;
  let   _connected  = false;
  let   _reconnTimer= null;
  let   _hbTimer    = null;
  let   _ioLoaded   = false;

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function _emit(event, data) {
    (_listeners[event] || []).forEach(fn => { try { fn(data); } catch(e) {} });
  }

  function _getUser() {
    // Use phone number as userId fallback — it is always set immediately at
    // login, before the async phone-register response arrives with the MongoDB ID.
    // This prevents the timing bug where mesh joins with a random anon-XXX ID
    // that never matches msg.from once the real ID arrives.
    return {
      userId: localStorage.getItem('resq_uid')    ||
              localStorage.getItem('resq_mobile') ||
              ('anon-' + Math.random().toString(36).slice(2)),
      name:   localStorage.getItem('resq_name')   || 'Unknown',
      role:   localStorage.getItem('resq_role')   || 'civilian',
      zone:   localStorage.getItem('resq_zone')   || 'unknown',
      phone:  localStorage.getItem('resq_mobile') || null,
    };
  }

  function _serverUrl() {
    const stored = localStorage.getItem(KEY_SERVER);
    if (stored) return stored.replace(/\/$/, '');
    // Capacitor native app — backend runs on LAN machine, not the phone itself
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      return 'http://192.168.0.2:5000';
    }
    const h = window.location.hostname;
    if (h && h !== '' && !['localhost','127.0.0.1'].includes(h)) {
      return 'http://' + h + ':5000';
    }
    return 'http://localhost:5000';
  }

  // ── Offline queue ─────────────────────────────────────────────────────────────
  function _enqueue(item) {
    try {
      const q = JSON.parse(localStorage.getItem(KEY_MSG_Q) || '[]');
      q.push({ ...item, _qAt: Date.now() });
      // Keep last 100 items in queue
      if (q.length > 100) q.splice(0, q.length - 100);
      localStorage.setItem(KEY_MSG_Q, JSON.stringify(q));
    } catch(e) {}
  }

  function _flushQueue() {
    if (!_socket || !_socket.connected) return;
    try {
      const q = JSON.parse(localStorage.getItem(KEY_MSG_Q) || '[]');
      if (!q.length) return;
      const unsent = [];
      for (const item of q) {
        try {
          if (item._type === 'sos') _socket.emit('sos', item);
          else                      _socket.emit('message', item);
        } catch(e) { unsent.push(item); }
      }
      localStorage.setItem(KEY_MSG_Q, JSON.stringify(unsent));
    } catch(e) {}
  }

  // ── Message / SOS history ─────────────────────────────────────────────────────
  function _addMsg(msg) {
    try {
      const h = JSON.parse(localStorage.getItem(KEY_MSG_HIST) || '[]');
      // Deduplicate by id
      if (!h.find(m => m.id === msg.id)) {
        h.unshift(msg);
        if (h.length > 300) h.splice(300);
        localStorage.setItem(KEY_MSG_HIST, JSON.stringify(h));
      }
    } catch(e) {}
  }

  function _addSOS(alert) {
    try {
      const h = JSON.parse(localStorage.getItem(KEY_SOS_HIST) || '[]');
      if (!h.find(s => s.id === alert.id)) {
        h.unshift(alert);
        if (h.length > 50) h.splice(50);
        localStorage.setItem(KEY_SOS_HIST, JSON.stringify(h));
      }
    } catch(e) {}
  }

  // ── Node registry ─────────────────────────────────────────────────────────────
  function _saveKnownUsers(nodes) {
    try {
      const myId = localStorage.getItem('resq_uid');
      const phones = nodes
        .filter(n => n.userId !== myId && n.phone)
        .map(n => n.phone);
      if (phones.length) {
        const existing = JSON.parse(localStorage.getItem('resq_known_phones') || '[]');
        const merged   = [...new Set([...existing, ...phones])];
        localStorage.setItem('resq_known_phones', JSON.stringify(merged));
      }
    } catch(e) {}
  }

  function _setNodes(nodes) {
    try { localStorage.setItem(KEY_NODES, JSON.stringify(nodes)); } catch(e) {}
    _saveKnownUsers(nodes);
    _emit('status', { connected: _connected, nodeCount: nodes.length });
    _emit('nodes', nodes);
  }

  function _upsertNode(node) {
    try {
      const nodes = JSON.parse(localStorage.getItem(KEY_NODES) || '[]');
      const idx = nodes.findIndex(n => n.userId === node.userId);
      if (idx >= 0) nodes[idx] = { ...nodes[idx], ...node };
      else nodes.push(node);
      localStorage.setItem(KEY_NODES, JSON.stringify(nodes));
      _saveKnownUsers(nodes);
      _emit('status', { connected: _connected, nodeCount: nodes.length });
      _emit('nodes', nodes);
    } catch(e) {}
  }

  function _removeNode(data) {
    try {
      const nodes = JSON.parse(localStorage.getItem(KEY_NODES) || '[]');
      const filtered = nodes.filter(n => n.userId !== data.userId);
      localStorage.setItem(KEY_NODES, JSON.stringify(filtered));
      _emit('status', { connected: _connected, nodeCount: filtered.length });
      _emit('nodes', filtered);
    } catch(e) {}
  }

  function _updateLocation(data) {
    try {
      const nodes = JSON.parse(localStorage.getItem(KEY_NODES) || '[]');
      const node = nodes.find(n => n.userId === data.userId);
      if (node) { node.lat = data.lat; node.lng = data.lng; }
      localStorage.setItem(KEY_NODES, JSON.stringify(nodes));
      _emit('location_update', data);
    } catch(e) {}
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────────
  function _startHeartbeat() {
    _stopHeartbeat();
    _hbTimer = setInterval(() => {
      if (!_socket || !_socket.connected) return;
      const loc = window.RESQ_Location ? window.RESQ_Location.getLast() : null;
      if (loc) _socket.emit('location', { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy });
      _socket.emit('heartbeat');
    }, 30_000);
  }

  function _stopHeartbeat() {
    if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; }
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────────
  function _scheduleReconnect(delayMs) {
    if (_reconnTimer) return;
    _reconnTimer = setTimeout(() => { _reconnTimer = null; _connect(); }, delayMs || 5000);
  }

  // ── Socket connection ─────────────────────────────────────────────────────────
  function _connectSocket(url) {
    if (_socket) { try { _socket.disconnect(); } catch(e) {} _socket = null; }

    _socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: false,   // we handle reconnect manually
      timeout: 6000,
    });

    const user = _getUser();

    _socket.on('connect', () => {
      _connected = true;
      if (_reconnTimer) { clearTimeout(_reconnTimer); _reconnTimer = null; }
      _emit('status', { connected: true, nodeCount: 0 });

      const loc = window.RESQ_Location ? window.RESQ_Location.getLast() : null;
      _socket.emit('join', {
        userId: user.userId,
        name:   user.name,
        role:   user.role,
        zone:   user.zone,
        phone:  user.phone,
        lat:    loc ? loc.lat : null,
        lng:    loc ? loc.lng : null,
      });

      _startHeartbeat();
      setTimeout(_flushQueue, 500); // flush after join is processed
    });

    _socket.on('joined', (data) => {
      _setNodes(data.nodes || []);
    });

    _socket.on('message', (msg) => {
      _addMsg(msg);
      _emit('message', msg);
    });

    _socket.on('sos_alert', (alert) => {
      _addSOS(alert);
      _emit('sos', alert);
    });

    _socket.on('node_joined', (node) => {
      _upsertNode(node);
      _emit('node_joined', node);
    });

    _socket.on('node_left', (data) => {
      _removeNode(data);
      _emit('node_left', data);
    });

    _socket.on('location_update', (data) => {
      _updateLocation(data);
    });

    // Server confirms message was routed (delivered=true if recipient was online)
    _socket.on('ack', (data) => {
      _emit('ack', data);
    });

    // Server confirms direct message actually reached the recipient's socket
    _socket.on('delivery_receipt', (data) => {
      _emit('delivery_receipt', data);
    });

    _socket.on('disconnect', () => {
      _connected = false;
      _stopHeartbeat();
      _emit('status', { connected: false, nodeCount: RESQ_Mesh.getNodes().length });
      _scheduleReconnect(5000);
    });

    _socket.on('connect_error', () => {
      _connected = false;
      _emit('status', { connected: false, nodeCount: RESQ_Mesh.getNodes().length });
      _scheduleReconnect(8000);
    });
  }

  function _connect() {
    const url = _serverUrl();
    if (typeof io !== 'undefined') {
      _connectSocket(url);
      return;
    }
    if (_ioLoaded) return; // script already loading
    _ioLoaded = true;
    const s = document.createElement('script');
    s.src = url + '/socket.io/socket.io.js';
    s.onload  = () => _connectSocket(url);
    s.onerror = () => {
      _ioLoaded = false;
      _emit('status', { connected: false, nodeCount: 0 });
      _scheduleReconnect(10000);
    };
    document.head.appendChild(s);
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  const RESQ_Mesh = {
    /** Subscribe to a mesh event.
     *  Events: 'message', 'sos', 'status', 'nodes',
     *          'node_joined', 'node_left', 'location_update'
     */
    on(event, fn)  {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
    },
    off(event, fn) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(f => f !== fn);
    },

    /** Send a message.
     *  to: 'all' | 'zone' | userId string
     *  type: 'broadcast' | 'direct'
     */
    sendMessage(to, content, type) {
      to   = to   || 'all';
      type = type || 'broadcast';
      const clientId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const payload  = { to, content, type, clientId };
      if (_socket && _socket.connected) {
        _socket.emit('message', payload);
      } else {
        _enqueue({ ...payload, _type: 'message' });
        // Optimistically show in history
        const user = _getUser();
        _addMsg({
          id: clientId, from: user.userId, fromName: user.name,
          to, type, content, timestamp: Date.now(), _queued: true,
        });
      }
      return clientId;
    },

    /** Broadcast an SOS alert to all nodes. */
    sendSOS(alertType, message, coords) {
      const clientId = 'sos-' + Date.now();
      const payload  = {
        alertType: alertType || 'general',
        message:   message   || '',
        lat:  coords ? coords.lat : null,
        lng:  coords ? coords.lng : null,
        clientId,
        _type: 'sos',
      };
      if (_socket && _socket.connected) {
        _socket.emit('sos', payload);
      } else {
        _enqueue(payload);
      }
      return clientId;
    },

    /** Push a GPS location update to all nodes. */
    updateLocation(lat, lng, accuracy) {
      if (_socket && _socket.connected) {
        _socket.emit('location', { lat, lng, accuracy: accuracy || null });
      }
    },

    /** Get the current list of active nodes (from localStorage cache). */
    getNodes() {
      try { return JSON.parse(localStorage.getItem(KEY_NODES) || '[]'); } catch(e) { return []; }
    },

    /** Get local message history (newest first). */
    getHistory() {
      try { return JSON.parse(localStorage.getItem(KEY_MSG_HIST) || '[]'); } catch(e) { return []; }
    },

    /** Get local SOS history (newest first). */
    getSOSHistory() {
      try { return JSON.parse(localStorage.getItem(KEY_SOS_HIST) || '[]'); } catch(e) { return []; }
    },

    isConnected() { return _connected; },

    /** Change the server URL and reconnect immediately. */
    setServerUrl(url) {
      localStorage.setItem(KEY_SERVER, url);
      _ioLoaded = false;
      _connect();
    },

    /** Force a reconnect attempt. */
    reconnect() { _connect(); },

    /**
     * Inject a message from an external channel (e.g. incoming SMS) into local
     * history and fire the 'message' event so all listeners (messaging UI, etc.)
     * see it alongside mesh messages.
     */
    _injectExternalMessage(msg) {
      _addMsg(msg);
      _emit('message', msg);
    },
  };

  window.RESQ_Mesh = RESQ_Mesh;

  // ── Auto-connect ──────────────────────────────────────────────────────────────
  function _init() {
    _connect();

    // Forward GPS events to mesh so other nodes see our location
    window.addEventListener('resq:location', (e) => {
      if (_connected) RESQ_Mesh.updateLocation(e.detail.lat, e.detail.lng, e.detail.accuracy);
    });

    // When phone-register completes (resq-auth.js dispatches this), re-join with
    // the correct MongoDB userId so msg.from matches across all devices.
    window.addEventListener('resq:token-ready', (e) => {
      if (e.detail && e.detail.userId) {
        localStorage.setItem('resq_uid', String(e.detail.userId));
        if (_socket && _socket.connected) {
          const user = _getUser();
          _socket.emit('join', {
            userId: user.userId,
            name:   user.name,
            role:   user.role,
            zone:   user.zone,
            phone:  user.phone,
          });
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})();
