/**
 * RESQ WiFi Direct Mesh
 *
 * Replaces Socket.io when no WiFi router or internet is available.
 * Uses Android WiFi Direct (P2P) for true device-to-device messaging.
 * Range: ~200m. No router, no internet, no cellular needed.
 *
 * Works alongside RESQ_Mesh: messages flow through whichever channel is live.
 * When RESQ_Mesh (Socket.io) is disconnected, this module auto-starts discovery.
 */
(function () {
  'use strict';

  const KEY_WD_QUEUE = 'resq_wd_queue';
  const isNative = typeof window !== 'undefined' &&
    typeof window.Capacitor !== 'undefined' &&
    window.Capacitor.isNativePlatform();

  const _listeners = {};
  let _connected   = false;
  let _isGO        = false;
  let _peers       = [];
  let _scanning    = false;

  function _emit(event, data) {
    (_listeners[event] || []).forEach(fn => { try { fn(data); } catch (_) {} });
  }

  function _getPlugin() {
    return isNative && window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.WifiDirect
      ? Capacitor.Plugins.WifiDirect
      : null;
  }

  function _enqueue(msg) {
    try {
      const q = JSON.parse(localStorage.getItem(KEY_WD_QUEUE) || '[]');
      q.push({ ...msg, _qAt: Date.now() });
      if (q.length > 50) q.splice(0, q.length - 50);
      localStorage.setItem(KEY_WD_QUEUE, JSON.stringify(q));
    } catch (_) {}
  }

  function _flushQueue() {
    try {
      const q = JSON.parse(localStorage.getItem(KEY_WD_QUEUE) || '[]');
      if (!q.length) return;
      const unsent = [];
      for (const item of q) {
        try {
          RESQ_WifiDirect.sendMessage(item.content, item.fromName);
        } catch (_) { unsent.push(item); }
      }
      localStorage.setItem(KEY_WD_QUEUE, JSON.stringify(unsent));
    } catch (_) {}
  }

  // ── Public API ────────────────────────────────────────────────────────────
  const RESQ_WifiDirect = {

    on(event, fn)  {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
    },
    off(event, fn) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(f => f !== fn);
    },

    isConnected() { return _connected; },
    isAvailable() { return !!_getPlugin(); },
    getPeers()    { return _peers; },

    /** Start peer discovery — fires 'peers' event with nearby RESQ devices */
    async startDiscovery() {
      const p = _getPlugin();
      if (!p) return { success: false, reason: 'not-native' };
      try {
        await p.startDiscovery();
        _scanning = true;
        window.dispatchEvent(new CustomEvent('resq:wd:status', { detail: { scanning: true } }));
        return { success: true };
      } catch (e) {
        return { success: false, reason: e.message };
      }
    },

    /** Connect to a peer device by its WiFi Direct address */
    async connectToPeer(address) {
      const p = _getPlugin();
      if (!p) return { success: false, reason: 'not-native' };
      try {
        await p.connect({ address });
        return { success: true };
      } catch (e) {
        return { success: false, reason: e.message };
      }
    },

    async disconnect() {
      const p = _getPlugin();
      if (!p) return;
      try { await p.disconnect(); } catch (_) {}
      _connected = false;
      _isGO      = false;
    },

    /** Send a text message over WiFi Direct */
    sendMessage(content, nameOverride) {
      const name = nameOverride || localStorage.getItem('resq_name') || 'Unknown';
      const p = _getPlugin();
      if (!p || !_connected) {
        _enqueue({ content, fromName: name, timestamp: Date.now() });
        return false;
      }
      p.sendMessage({ content, name }).catch(() => {
        _enqueue({ content, fromName: name, timestamp: Date.now() });
      });
      return true;
    },

    /** Inject this into the messaging page so WD messages appear alongside mesh messages */
    _bridgeToMesh(msg) {
      if (window.RESQ_Mesh) {
        RESQ_Mesh._injectExternalMessage({
          id:        'wd_' + msg.timestamp,
          from:      msg.from || 'wd-peer',
          fromName:  msg.from || 'Nearby Device',
          to:        'all',
          content:   msg.content,
          type:      'broadcast',
          timestamp: msg.timestamp || Date.now(),
          channel:   'wifi-direct',
        });
      }
    },
  };

  // ── Native event wiring ───────────────────────────────────────────────────
  function _wireNative() {
    const p = _getPlugin();
    if (!p) return;

    p.addListener('peers', (data) => {
      _peers = data.peers || [];
      _emit('peers', _peers);
      window.dispatchEvent(new CustomEvent('resq:wd:peers', { detail: _peers }));
    });

    p.addListener('connected', (data) => {
      _connected = true;
      _isGO      = data.isGroupOwner;
      _emit('connected', data);
      window.dispatchEvent(new CustomEvent('resq:wd:status', { detail: { connected: true } }));
      setTimeout(_flushQueue, 500);
    });

    p.addListener('message', (msg) => {
      _emit('message', msg);
      RESQ_WifiDirect._bridgeToMesh(msg);
    });

    p.addListener('status', (data) => {
      if (data.state === 'disconnected') {
        _connected = false;
        _isGO      = false;
      }
      _emit('status', data);
      window.dispatchEvent(new CustomEvent('resq:wd:status', { detail: data }));
    });
  }

  // ── Auto-start when Socket.io mesh goes offline ───────────────────────────
  function _autoStart() {
    if (!isNative) return;

    _wireNative();

    // If mesh is disconnected and WiFi Direct not yet active, start discovery
    function checkAndStart() {
      const meshOff = !(window.RESQ_Mesh && RESQ_Mesh.isConnected());
      if (meshOff && !_scanning && !_connected) {
        RESQ_WifiDirect.startDiscovery();
      }
    }

    // Give mesh.js 3 seconds to connect first
    setTimeout(checkAndStart, 3000);

    if (window.RESQ_Mesh) {
      RESQ_Mesh.on('status', (s) => {
        if (!s.connected && !_connected) {
          setTimeout(checkAndStart, 1000);
        }
      });
    }
  }

  window.RESQ_WifiDirect = RESQ_WifiDirect;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoStart);
  } else {
    _autoStart();
  }
})();
