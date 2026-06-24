/**
 * RESQ Browser Mesh — BroadcastChannel relay
 *
 * Only activates in a non-native browser environment.
 * On Android the real BluetoothMeshPlugin takes over instead.
 *
 * Simulates Bluetooth mesh between browser tabs on the same machine:
 *   Tab 1 (User A) ←──BroadcastChannel──→ Tab 2 (User B)
 *
 * This lets you test real-time messaging, peer discovery, E2EE
 * and relay logic without a physical Android device.
 *
 * How to use:
 *   1. Open /messaging/index.html  → you are User A (from localStorage)
 *   2. Open /test-user.html        → opens a second identity (User B)
 *   3. Both tabs discover each other and can exchange real E2EE messages
 */
(function () {
  'use strict';

  // Only run in browser — native Android uses BluetoothMeshPlugin
  const isNative = typeof window !== 'undefined' &&
    typeof window.Capacitor !== 'undefined' &&
    window.Capacitor.isNativePlatform();
  if (isNative) return;

  const CH_NAME  = 'resq_bt_mesh_v1';
  const TAB_ID   = 'tab_' + Math.random().toString(36).slice(2, 9);
  const KEY_HIST = 'resq_bt_history';

  let _channel;
  try { _channel = new BroadcastChannel(CH_NAME); }
  catch (_) { return; } // BroadcastChannel not supported (very old browser)

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _myUser() {
    return {
      userId:   localStorage.getItem('resq_uid')    || TAB_ID,
      name:     localStorage.getItem('resq_name')   || 'User-' + TAB_ID.slice(-4),
      role:     localStorage.getItem('resq_role')   || 'Civilian',
      tabId:    TAB_ID,
    };
  }

  function _broadcast(type, payload) {
    try { _channel.postMessage({ type, payload, tabId: TAB_ID, ts: Date.now() }); }
    catch (_) {}
  }

  function _addHistory(msg) {
    try {
      const h = JSON.parse(localStorage.getItem(KEY_HIST) || '[]');
      if (!h.find(m => m.id === msg.id)) {
        h.unshift(msg);
        if (h.length > 300) h.splice(300);
        localStorage.setItem(KEY_HIST, JSON.stringify(h));
      }
    } catch (_) {}
  }

  // ── Peer registry — delegates to RESQ_BTMesh._injectPeer so one source of truth ──
  const _tabToPeer = new Map(); // tabId → userId  (for cleanup on leave)

  function _upsertPeer(info) {
    const myId = _myUser().userId;
    if (info.userId === myId) return; // ignore self
    _tabToPeer.set(info.tabId, info.userId);
    if (!window.RESQ_BTMesh) return;
    // Check if peer already exists (avoid duplicates)
    const existing = RESQ_BTMesh.getPeers().find(p => p.userId === info.userId);
    if (!existing) {
      RESQ_BTMesh._injectPeer({
        userId: info.userId,
        name:   info.name   || 'Unknown',
        role:   info.role   || 'Civilian',
        rssi:   -55,
        hasKey: !!(window.RESQ_Crypto && RESQ_Crypto.canEncryptFor(info.userId)),
      });
    }
  }

  function _removePeer(tabId) {
    const userId = _tabToPeer.get(tabId);
    _tabToPeer.delete(tabId);
    if (userId && window.RESQ_BTMesh) RESQ_BTMesh._removePeer(userId);
  }

  // ── Fire event into RESQ_BTMesh listener system ────────────────────────────
  function _fireBTMesh(event, data) {
    if (window.RESQ_BTMesh && window.RESQ_BTMesh._emit) {
      RESQ_BTMesh._emit(event, data);
    }
  }

  // ── BroadcastChannel message handler ──────────────────────────────────────
  _channel.onmessage = async function (e) {
    const { type, payload, tabId } = e.data || {};
    if (tabId === TAB_ID) return; // ignore own messages

    if (type === 'join') {
      _upsertPeer(payload);
      // Reply so the joining tab knows we exist
      _broadcast('join_ack', _myUser());

      // Exchange public keys
      if (window.RESQ_Crypto) {
        const pk = await RESQ_Crypto.exportOwnPublicKey();
        _broadcast('pubkey', { userId: _myUser().userId, publicKey: pk });
      }
    }

    else if (type === 'join_ack') {
      _upsertPeer(payload);
    }

    else if (type === 'leave') {
      _removePeer(tabId);
    }

    else if (type === 'pubkey') {
      if (window.RESQ_Crypto && payload.userId && payload.publicKey) {
        await RESQ_Crypto.importPeerKey(payload.userId, payload.publicKey);
        // Mark the peer encryption-ready and refresh the peer list UI.
        // (Previously called an undefined _peerList() which threw.)
        if (window.RESQ_BTMesh) {
          const peer = RESQ_BTMesh.getPeers().find(p => p.userId === payload.userId);
          if (peer) peer.hasKey = true;
          _fireBTMesh('nodes', RESQ_BTMesh.getPeers());
        }
      }
    }

    else if (type === 'message') {
      const msg = payload;
      const myId = _myUser().userId;

      // Only deliver messages addressed to me or broadcast
      if (msg.to !== 'all' && msg.to !== myId) return;

      // Decrypt if E2EE
      let content = msg.ct;
      if (msg.enc && window.RESQ_Crypto) {
        try { content = await RESQ_Crypto.decrypt(msg.from, msg.ct); }
        catch (_) { content = '[Encrypted — key not available]'; }
      }

      const decoded = {
        id:        msg.id,
        from:      msg.from,
        fromName:  msg.fromName || 'Unknown',
        to:        msg.to,
        content,
        enc:       msg.enc,
        timestamp: msg.ts || Date.now(),
        channel:   'browser-mesh',
      };

      _addHistory(decoded);
      _fireBTMesh('message', decoded);

      // Vibrate if supported
      if (navigator.vibrate) navigator.vibrate([100]);
    }
  };

  // ── Patch RESQ_BTMesh to use BroadcastChannel for sends ───────────────────
  function _patchBTMesh() {
    if (!window.RESQ_BTMesh) { setTimeout(_patchBTMesh, 200); return; }

    // _emit is now exposed on RESQ_BTMesh directly — nothing extra needed here.

    // Patch sendPrivate — encrypt and broadcast
    const _origPrivate = RESQ_BTMesh.sendPrivate.bind(RESQ_BTMesh);
    RESQ_BTMesh.sendPrivate = async function(toUserId, plaintext) {
      const me = _myUser();
      let ct = plaintext, enc = false;
      if (window.RESQ_Crypto && RESQ_Crypto.canEncryptFor(toUserId)) {
        try { ct = await RESQ_Crypto.encrypt(toUserId, plaintext); enc = true; }
        catch (_) {}
      }
      const msg = {
        id: 'm_' + me.userId + '_' + Date.now(),
        from: me.userId, fromName: me.name,
        to: toUserId, ct, enc,
        ts: Date.now(),
      };
      _broadcast('message', msg);

      // Add to own history as sent
      _addHistory({
        id: msg.id, from: msg.from, fromName: msg.fromName,
        to: msg.to, content: plaintext, enc,
        timestamp: msg.ts, channel: 'browser-mesh',
      });

      return msg.id;
    };

    // Patch sendBroadcast
    const _origBroadcast = RESQ_BTMesh.sendBroadcast.bind(RESQ_BTMesh);
    RESQ_BTMesh.sendBroadcast = async function(plaintext) {
      const me = _myUser();
      const msg = {
        id: 'bc_' + me.userId + '_' + Date.now(),
        from: me.userId, fromName: me.name,
        to: 'all', ct: plaintext, enc: false,
        ts: Date.now(),
      };
      _broadcast('message', msg);
      _addHistory({
        id: msg.id, from: msg.from, fromName: msg.fromName,
        to: 'all', content: plaintext, enc: false,
        timestamp: msg.ts, channel: 'browser-mesh',
      });
      return msg.id;
    };

    // isConnected — true when RESQ_BTMesh._peers has entries
    RESQ_BTMesh.isConnected = function() { return RESQ_BTMesh.getPeers().length > 0; };

    // Fire status
    _fireBTMesh('status', { connected: false, nodeCount: 0 });

    // Announce ourselves to all other tabs
    const me = _myUser();
    _broadcast('join', me);

    // Share public key immediately
    if (window.RESQ_Crypto) {
      RESQ_Crypto.exportOwnPublicKey().then(pk => {
        _broadcast('pubkey', { userId: me.userId, publicKey: pk });
      });
    }

    // Prune stale peers every 30s
    setInterval(() => {
      const cutoff = Date.now() - 60_000;
      for (const [tabId] of _tabToPeer) {
        // No lastSeen on new simple map — just keep tabs that are known
        // Real cleanup happens via 'leave' message on tab close
      }
      // Heartbeat so others know we're still here
      _broadcast('join', _myUser());
    }, 30_000);

    console.log('[RESQ Browser Mesh] Ready — tab:', TAB_ID, '| user:', me.name);
  }

  // Announce leave on tab close
  window.addEventListener('beforeunload', () => _broadcast('leave', { tabId: TAB_ID }));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _patchBTMesh);
  } else {
    _patchBTMesh();
  }

})();
