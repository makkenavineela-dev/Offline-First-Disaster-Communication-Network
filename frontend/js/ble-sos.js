/**
 * RESQ BLE SOS
 *
 * Last-resort SOS broadcast over Bluetooth Low Energy.
 * Works with ZERO network — no WiFi, no cellular, no internet.
 * Range: ~30–100m (Bluetooth).
 *
 * When SOS is triggered:
 *  1. SMS via cellular         (if available)
 *  2. Mesh broadcast           (if WiFi available)
 *  3. WiFi Direct broadcast    (if peer connected)
 *  4. BLE beacon (this module) — always last resort, no pairing needed
 *
 * Other RESQ devices within Bluetooth range continuously scan for beacons
 * and show an SOS banner when one is received.
 */
(function () {
  'use strict';

  const isNative = typeof window !== 'undefined' &&
    typeof window.Capacitor !== 'undefined' &&
    window.Capacitor.isNativePlatform();

  let _advertising = false;
  let _scanning    = false;
  let _beaconTimer = null;

  const _listeners = {};
  function _emit(event, data) {
    (_listeners[event] || []).forEach(fn => { try { fn(data); } catch (_) {} });
  }

  function _getPlugin() {
    return isNative && window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BleSos
      ? Capacitor.Plugins.BleSos
      : null;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  const RESQ_BLE = {

    on(event, fn)  {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
    },

    isAdvertising() { return _advertising; },
    isScanning()    { return _scanning;    },
    isAvailable()   { return !!_getPlugin(); },

    /**
     * Broadcast an SOS beacon via BLE.
     * Repeats every 5 seconds for durationMs (default 5 minutes).
     */
    async broadcastSOS(alertType, coords, durationMs) {
      const p = _getPlugin();
      if (!p) {
        console.warn('[BLE SOS] Plugin not available — native Android only');
        return { success: false, reason: 'not-native' };
      }

      const name  = (localStorage.getItem('resq_name') || 'Unknown').slice(0, 8);
      const lat   = coords && coords.lat != null ? coords.lat : 0;
      const lng   = coords && coords.lng != null ? coords.lng : 0;
      const ttl   = durationMs || 5 * 60 * 1000; // 5 minutes default

      try {
        await p.startSosBeacon({ alertType, name, lat, lng });
        _advertising = true;
        window.dispatchEvent(new CustomEvent('resq:ble:status', { detail: { advertising: true } }));

        // Auto-stop after TTL
        if (_beaconTimer) clearTimeout(_beaconTimer);
        _beaconTimer = setTimeout(() => RESQ_BLE.stopBeacon(), ttl);

        return { success: true };
      } catch (e) {
        return { success: false, reason: e.message };
      }
    },

    async stopBeacon() {
      const p = _getPlugin();
      if (p) { try { await p.stopSosBeacon(); } catch (_) {} }
      _advertising = false;
      if (_beaconTimer) { clearTimeout(_beaconTimer); _beaconTimer = null; }
      window.dispatchEvent(new CustomEvent('resq:ble:status', { detail: { advertising: false } }));
    },

    /** Start scanning for nearby BLE SOS beacons */
    async startScanning() {
      const p = _getPlugin();
      if (!p) return { success: false, reason: 'not-native' };
      try {
        await p.startScanning();
        _scanning = true;
        window.dispatchEvent(new CustomEvent('resq:ble:status', { detail: { scanning: true } }));
        return { success: true };
      } catch (e) {
        return { success: false, reason: e.message };
      }
    },

    async stopScanning() {
      const p = _getPlugin();
      if (p) { try { await p.stopScanning(); } catch (_) {} }
      _scanning = false;
    },
  };

  // ── Wire native events ────────────────────────────────────────────────────
  function _wireNative() {
    const p = _getPlugin();
    if (!p) return;

    p.addListener('ble_sos', (alert) => {
      _emit('sos', alert);

      // Inject into BT mesh history so SOS banner + history work
      if (window.RESQ_BTMesh) {
        RESQ_BTMesh._injectExternalMessage({
          id: 'ble_' + alert.timestamp,
          from: alert.from || 'ble-beacon',
          fromName: alert.from || 'BLE Beacon',
          to: 'all',
          content: '🆘 SOS ' + (alert.alertType || '') + (alert.from ? ' from ' + alert.from : ''),
          type: 'sos',
          timestamp: alert.timestamp,
          channel: 'ble',
        });
      }

      // Show SOS banner if the function exists on the current page
      if (typeof window.showSosBanner === 'function') {
        window.showSosBanner({
          fromName:  alert.from,
          alertType: alert.alertType,
          message:   `BLE beacon · ${alert.rssi}dBm`,
          fromPhone: null,
        });
      }

      // Vibrate
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 500]);
    });

    p.addListener('ble_status', (data) => {
      _advertising = data.advertising;
      _scanning    = data.scanning;
      window.dispatchEvent(new CustomEvent('resq:ble:status', { detail: data }));
    });
  }

  // ── Init — wire native events only ────────────────────────────────────────
  // NOTE: We do NOT auto-start scanning here. BluetoothMesh (bluetooth-mesh.js)
  // is the single owner of the BLE radio — it handles peer discovery, messaging
  // AND SOS broadcasts. Running a second BLE scanner here would fight for the
  // radio and double-request permissions. SOS beacons are sent via the mesh
  // broadcast instead. RESQ_BLE.broadcastSOS() can still be called explicitly.
  function _init() {
    if (!isNative) return;
    _wireNative();
  }

  window.RESQ_BLE = RESQ_BLE;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
})();
