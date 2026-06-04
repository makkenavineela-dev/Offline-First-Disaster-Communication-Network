/**
 * RESQ Bluetooth Mesh — JS bridge
 *
 * Wraps BluetoothMeshPlugin (Android native) with:
 *   - E2EE encryption/decryption via RESQ_Crypto
 *   - Store-and-forward queue (localStorage)
 *   - Event system identical to old RESQ_Mesh API so UI code stays unchanged
 *   - Auto-init on page load
 *
 * Message delivery order (all offline, zero internet):
 *   1. BLE Mesh (this module)   — hops between phones via Bluetooth
 *   2. SMS fallback             — if RESQ_SMS is available (cellular)
 */
(function () {
  'use strict';

  const KEY_HIST  = 'resq_bt_history'; // received messages
  const KEY_QUEUE = 'resq_bt_queue';   // outbound queue
  const KEY_SOS   = 'resq_sos_history';

  // Structured-message prefixes (broadcast over mesh, routed specially)
  const RES_PREFIX = '__RESQ_RES__';   // resource sync — silent, updates list
  const SOS_PREFIX = '🆘';             // SOS alert — shown in chat + 'sos' event

  const isNative = typeof window !== 'undefined' &&
    typeof window.Capacitor !== 'undefined' &&
    window.Capacitor.isNativePlatform();

  const _listeners = {};
  let _active      = false;
  let _peers       = [];  // { userId, name, rssi, hasKey }

  // ── SOS history helpers ─────────────────────────────────────────────────────
  function _addSOSHistory(alert) {
    try {
      const h = JSON.parse(localStorage.getItem(KEY_SOS) || '[]');
      if (!h.find(s => s.id === alert.id)) {
        h.unshift(alert);
        if (h.length > 50) h.splice(50);
        localStorage.setItem(KEY_SOS, JSON.stringify(h));
      }
    } catch (_) {}
  }

  // Parse "🆘 SOS Flood from Vineela: trapped | GPS:12.9,77.5" into a structured alert
  function _parseSosContent(content, msg) {
    try {
      const alert = {
        id:        msg.id || ('sos_' + (msg.timestamp || Date.now())),
        from:      msg.from,
        fromName:  msg.fromName || 'Unknown',
        alertType: 'Emergency',
        message:   content,
        lat: null, lng: null,
        timestamp: msg.timestamp || Date.now(),
      };
      // Extract alert type: "🆘 SOS <Type> from"
      const t = content.match(/🆘\s*SOS\s+([^\s]+)/i);
      if (t) alert.alertType = t[1];
      // Extract GPS
      const g = content.match(/GPS:\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/i);
      if (g) { alert.lat = parseFloat(g[1]); alert.lng = parseFloat(g[2]); }
      return alert;
    } catch (_) { return null; }
  }

  // ── Event system ──────────────────────────────────────────────────────────
  function _emit(event, data) {
    (_listeners[event] || []).forEach(fn => { try { fn(data); } catch (_) {} });
  }

  function _plugin() {
    return isNative && window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BluetoothMesh
      ? Capacitor.Plugins.BluetoothMesh : null;
  }

  // ── History helpers ───────────────────────────────────────────────────────
  function _addToHistory(msg) {
    try {
      const h = JSON.parse(localStorage.getItem(KEY_HIST) || '[]');
      if (!h.find(m => m.id === msg.id)) {
        h.unshift(msg);
        if (h.length > 300) h.splice(300);
        localStorage.setItem(KEY_HIST, JSON.stringify(h));
      }
    } catch (_) {}
  }

  // ── Outbound queue ────────────────────────────────────────────────────────
  function _enqueue(item) {
    try {
      const q = JSON.parse(localStorage.getItem(KEY_QUEUE) || '[]');
      q.push({ ...item, _qAt: Date.now() });
      if (q.length > 100) q.splice(0, q.length - 100);
      localStorage.setItem(KEY_QUEUE, JSON.stringify(q));
    } catch (_) {}
  }

  // ── Wire native plugin events ─────────────────────────────────────────────
  async function _wirePlugin() {
    const p = _plugin();
    if (!p) return;

    // Peer discovered
    p.addListener('bt_peer_found', (peer) => {
      const existing = _peers.findIndex(x => x.userId === peer.userId);
      if (existing >= 0) _peers[existing] = { ..._peers[existing], ...peer };
      else               _peers.push({ ...peer, hasKey: !!(window.RESQ_Crypto && RESQ_Crypto.canEncryptFor(peer.userId)) });
      _emit('nodes', _peers);
      _emit('node_joined', peer);
      window.dispatchEvent(new CustomEvent('resq:ble:peer', { detail: peer }));
    });

    // Peer lost
    p.addListener('bt_peer_lost', (data) => {
      _peers = _peers.filter(x => x.userId !== data.userId);
      _emit('node_left', data);
      window.dispatchEvent(new CustomEvent('resq:ble:peer_lost', { detail: data }));
    });

    // Public key received from peer → store it, update peer's hasKey flag
    p.addListener('bt_pubkey', async (data) => {
      if (window.RESQ_Crypto) {
        await RESQ_Crypto.importPeerKey(data.userId, data.publicKey);
        const peer = _peers.find(x => x.userId === data.userId);
        if (peer) peer.hasKey = true;
        _emit('nodes', _peers);
      }
    });

    // Message received from mesh
    p.addListener('bt_message', async (msg) => {
      let content = msg.content;

      // If encrypted, decrypt now using E2EE
      if (msg.enc && window.RESQ_Crypto) {
        try {
          content = await RESQ_Crypto.decrypt(msg.from, msg.content);
        } catch (_) {
          content = '[Encrypted message — key not available]';
        }
      }

      // ── Structured-message routing ─────────────────────────────────────────
      // Resource-sync messages are NOT shown in chat — they update the
      // resources list silently. SOS messages are shown in chat AND fire 'sos'.
      if (typeof content === 'string' && content.indexOf(RES_PREFIX) === 0) {
        try {
          const payload = JSON.parse(content.slice(RES_PREFIX.length));
          _emit('resource', { ...payload, from: msg.from, fromName: msg.fromName, timestamp: msg.timestamp });
        } catch (_) {}
        return; // do not add to chat history
      }

      const decoded = {
        id:        msg.id,
        from:      msg.from,
        fromName:  msg.fromName || 'Unknown',
        to:        msg.to,
        content,
        enc:       msg.enc,
        timestamp: msg.timestamp || Date.now(),
        channel:   'bluetooth',
      };

      _addToHistory(decoded);
      _emit('message', decoded);

      // SOS detection — fire a dedicated 'sos' event for the SOS page banner
      if (typeof content === 'string' && content.indexOf(SOS_PREFIX) === 0) {
        const sosAlert = _parseSosContent(content, msg);
        if (sosAlert) {
          _addSOSHistory(sosAlert);
          _emit('sos', sosAlert);
        }
      }

      _emit('status', { connected: true, nodeCount: _peers.length });
    });

    // Status updates
    p.addListener('bt_status', (s) => {
      _active = s.active;
      _emit('status', { connected: _active, nodeCount: _peers.length });
      window.dispatchEvent(new CustomEvent('resq:bt:status', { detail: s }));
    });
  }

  // ── Public API (mirrors old RESQ_Mesh API so UI works without changes) ────
  const RESQ_BTMesh = {

    on(event, fn)  {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
    },

    // Exposed so browser-mesh.js can fire events into the UI without touching private _listeners
    _emit,
    off(event, fn) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(f => f !== fn);
    },

    isConnected()  { return _active; },
    getNodes()     { return _peers;  },
    getPeers()     { return _peers;  },

    getHistory() {
      try { return JSON.parse(localStorage.getItem(KEY_HIST) || '[]'); }
      catch (_) { return []; }
    },

    /**
     * Send a private E2EE message to a specific user.
     * The message is encrypted here in JS before going to the native layer.
     * Relaying devices see only ciphertext — they cannot read it.
     */
    async sendPrivate(toUserId, plaintext) {
      const myId   = localStorage.getItem('resq_uid')  || 'unknown';
      const myName = localStorage.getItem('resq_name') || 'Unknown';

      let ct = plaintext;
      let enc = false;

      if (window.RESQ_Crypto && RESQ_Crypto.canEncryptFor(toUserId)) {
        try {
          ct  = await RESQ_Crypto.encrypt(toUserId, plaintext);
          enc = true;
        } catch (_) {}
      }

      // Optimistically add to local history (sent message)
      const local = {
        id:        'm_out_' + Date.now(),
        from:      myId,
        fromName:  myName,
        to:        toUserId,
        content:   plaintext, // store plaintext locally for our own display
        enc,
        timestamp: Date.now(),
        channel:   'bluetooth',
      };
      _addToHistory(local);

      const p = _plugin();
      if (p) {
        try {
          await p.sendMessage({ to: toUserId, ct, enc, fromName: myName });
        } catch (_) {
          _enqueue({ to: toUserId, ct, enc, fromName: myName });
        }
      } else {
        _enqueue({ to: toUserId, ct, enc, fromName: myName });
      }

      _emit('message', local);
      return local.id;
    },

    /**
     * Send an unencrypted broadcast to all nearby nodes.
     * All relays and recipients can read this — used for group/SOS messages.
     */
    async sendBroadcast(plaintext) {
      const myId   = localStorage.getItem('resq_uid')  || 'unknown';
      const myName = localStorage.getItem('resq_name') || 'Unknown';

      const local = {
        id:        'm_bc_' + Date.now(),
        from:      myId,
        fromName:  myName,
        to:        'all',
        content:   plaintext,
        enc:       false,
        timestamp: Date.now(),
        channel:   'bluetooth',
      };
      _addToHistory(local);

      const p = _plugin();
      if (p) {
        try { await p.sendMessage({ to: 'all', ct: plaintext, enc: false, fromName: myName }); }
        catch (_) { _enqueue({ to: 'all', ct: plaintext, enc: false, fromName: myName }); }
      } else {
        _enqueue({ to: 'all', ct: plaintext, enc: false, fromName: myName });
      }

      _emit('message', local);
      return local.id;
    },

    // Keep old sendMessage API for SOS page compatibility
    sendMessage(to, content, type) {
      if (to === 'all' || type === 'broadcast') return RESQ_BTMesh.sendBroadcast(content);
      return RESQ_BTMesh.sendPrivate(to, content);
    },

    // SOS broadcast (used by SOS page) — appears in EVERYONE's Messages over mesh,
    // fires the 'sos' event, and is saved to SOS history. SMS is handled separately
    // by the SOS page (sendSMSAlert) so saved contacts are notified too.
    async sendSOS(alertType, message, coords) {
      const myId   = localStorage.getItem('resq_uid')  || 'me';
      const name   = localStorage.getItem('resq_name') || 'Unknown';
      const lat    = coords && coords.lat != null ? coords.lat.toFixed(5) : null;
      const lng    = coords && coords.lng != null ? coords.lng.toFixed(5) : null;
      const text   = `🆘 SOS ${alertType} from ${name}: ${message}${lat ? ` | GPS:${lat},${lng}` : ''}`;

      // Save to our own SOS history immediately
      const alert = {
        id: 'sos_' + Date.now(), from: myId, fromName: name,
        alertType, message, lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null, timestamp: Date.now(), _mine: true,
      };
      _addSOSHistory(alert);

      // Broadcast over mesh (unencrypted so every device + relay can read it)
      await RESQ_BTMesh.sendBroadcast(text);
      return alert.id;
    },

    /** Get local SOS history (newest first) */
    getSOSHistory() {
      try { return JSON.parse(localStorage.getItem(KEY_SOS) || '[]'); }
      catch (_) { return []; }
    },

    /**
     * Broadcast a resource update over the mesh. Silent — does NOT appear in
     * chat. The resources page listens via on('resource', cb) and merges it.
     * payload: { action:'upsert'|'delete', resource:{...} | id:'...' }
     */
    async broadcastResource(payload) {
      const text = RES_PREFIX + JSON.stringify(payload);
      return RESQ_BTMesh.sendBroadcast(text);
    },

    // Legacy method used by messaging page to inject SMS messages
    _injectExternalMessage(msg) {
      _addToHistory(msg);
      _emit('message', msg);
    },

    /**
     * Inject a peer directly into the peer list and fire UI events.
     * Used by browser-mesh.js and the preview eval for testing.
     * { userId, name, rssi, hasKey }
     */
    _injectPeer(peer) {
      _peers.push(peer);
      _emit('node_joined', peer);
      _emit('nodes',       _peers.slice());
      _emit('status', { connected: true, nodeCount: _peers.length });
    },

    /** Remove a peer by userId */
    _removePeer(userId) {
      _peers = _peers.filter(p => p.userId !== userId);
      _emit('node_left', { userId });
      _emit('nodes', _peers.slice());
    },

    /** Reset the in-memory peer list */
    _clearPeers() {
      _peers = [];
      _emit('nodes', []);
      _emit('status', { connected: false, nodeCount: 0 });
    },
  };

  // ── Init ──────────────────────────────────────────────────────────────────
  async function _init() {
    // IMPORTANT: expose RESQ_BTMesh FIRST so pages can always access it
    // regardless of whether BLE starts successfully
    window.RESQ_BTMesh = RESQ_BTMesh;
    window.RESQ_Mesh   = RESQ_BTMesh;

    await _wirePlugin();

    const p = _plugin();
    if (!p) {
      // Non-native browser — browser-mesh.js handles discovery via BroadcastChannel
      _emit('status', { connected: false, nodeCount: 0, reason: 'browser' });
      return;
    }

    // Signal UI that we are starting
    _emit('status', { connected: false, nodeCount: 0, reason: 'starting' });

    try {
      const pubKey = window.RESQ_Crypto ? await RESQ_Crypto.exportOwnPublicKey() : '';
      const userId = localStorage.getItem('resq_uid')  || ('local_' + Math.random().toString(36).slice(2));
      const name   = localStorage.getItem('resq_name') || 'Unknown';

      await p.start({ userId, name, publicKey: pubKey });
      _active = true;
      _emit('status', { connected: true, nodeCount: 0, reason: 'scanning' });
    } catch (err) {
      // BT off, permissions denied, or unsupported — surface the reason
      const reason = (err && err.message) ? err.message.toLowerCase() : 'unknown';
      _active = false;
      _emit('status', {
        connected: false,
        nodeCount: 0,
        reason: reason.includes('permission') ? 'permission' :
                reason.includes('disable')    ? 'bt_off'    : 'error',
        error: err && err.message,
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
})();
