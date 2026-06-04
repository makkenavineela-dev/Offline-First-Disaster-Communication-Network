/**
 * RESQ Mesh Boot
 *
 * Loaded on EVERY page so the Bluetooth mesh starts as soon as the user is
 * logged in — not just when they open the Messages page.
 *
 * Responsibilities:
 *   1. Explicitly request Bluetooth permissions (Android 12+) on first launch
 *   2. Start the BluetoothMesh native plugin (idempotent — safe per page)
 *   3. Persist a flag so we only prompt once
 *
 * Requires crypto-e2ee.js and bluetooth-mesh.js to be loaded first.
 */
(function () {
  'use strict';

  const isNative = typeof window !== 'undefined' &&
    typeof window.Capacitor !== 'undefined' &&
    window.Capacitor.isNativePlatform();

  // Only run on native Android — browser uses browser-mesh.js
  if (!isNative) return;

  // Don't boot on login/splash (user not registered yet)
  const path = window.location.pathname;
  if (path.indexOf('/login/') >= 0 || path.indexOf('/splash/') >= 0) return;

  function _plugin() {
    return window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BluetoothMesh
      ? Capacitor.Plugins.BluetoothMesh : null;
  }

  async function boot() {
    const uid = localStorage.getItem('resq_uid');
    if (!uid) {
      // Not registered yet — try again shortly
      setTimeout(boot, 1500);
      return;
    }

    const p = _plugin();
    if (!p) {
      console.warn('[Mesh Boot] BluetoothMesh plugin not available');
      return;
    }

    try {
      // 1. Request Bluetooth permissions explicitly (shows the system dialog)
      console.log('[Mesh Boot] Requesting Bluetooth permissions...');
      const perm = await p.requestPermissions();
      console.log('[Mesh Boot] Permission result:', JSON.stringify(perm));

      if (!perm || !perm.granted) {
        console.warn('[Mesh Boot] Bluetooth permission denied');
        window.dispatchEvent(new CustomEvent('resq:bt:status', {
          detail: { active: false, reason: 'permission' }
        }));
        // Update RESQ_BTMesh listeners too
        if (window.RESQ_BTMesh && RESQ_BTMesh._emit) {
          RESQ_BTMesh._emit('status', { connected: false, nodeCount: 0, reason: 'permission' });
        }
        return;
      }

      // 2. Export public key for E2EE
      let pubKey = '';
      if (window.RESQ_Crypto) {
        try { pubKey = await RESQ_Crypto.exportOwnPublicKey(); } catch (_) {}
      }

      // 3. Start the mesh (idempotent — native keeps running across pages)
      const name = localStorage.getItem('resq_name') || 'Unknown';
      console.log('[Mesh Boot] Starting BT mesh as', name, uid);
      const res = await p.start({ userId: uid, name: name, publicKey: pubKey });
      console.log('[Mesh Boot] Mesh started:', JSON.stringify(res));

      localStorage.setItem('resq_bt_booted', '1');

      if (window.RESQ_BTMesh && RESQ_BTMesh._emit) {
        RESQ_BTMesh._emit('status', { connected: true, nodeCount: 0, reason: 'scanning' });
      }
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      console.error('[Mesh Boot] Start failed:', msg);
      const reason = msg.toLowerCase().indexOf('disable') >= 0 ? 'bt_off'
                   : msg.toLowerCase().indexOf('permission') >= 0 ? 'permission'
                   : 'error';
      if (window.RESQ_BTMesh && RESQ_BTMesh._emit) {
        RESQ_BTMesh._emit('status', { connected: false, nodeCount: 0, reason: reason });
      }
      window.dispatchEvent(new CustomEvent('resq:bt:status', { detail: { active: false, reason: reason } }));
    }
  }

  // Wait for plugin + RESQ_BTMesh to be ready
  function waitAndBoot() {
    if (window.RESQ_BTMesh) {
      boot();
    } else {
      setTimeout(waitAndBoot, 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndBoot);
  } else {
    waitAndBoot();
  }
})();
