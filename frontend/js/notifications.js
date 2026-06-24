/**
 * RESQ Notifications — PHONE notifications only (no in-app banners)
 *
 * Loaded on every page (after bluetooth-mesh.js). When a mesh message, SOS
 * alert, or resource share arrives, this posts a REAL phone notification to
 * the Android system tray (sound + vibration handled by the OS notification
 * channel). It does NOT draw any in-app banner inside the WebView.
 *
 *   - Native:  Capacitor LocalNotif plugin  → system-tray notification
 *   - Browser: Web Notifications API         → fallback for PWA / desktop
 *
 * SOS alerts use the urgent channel (red, high-priority, alarm vibration).
 */
(function () {
  'use strict';

  let _wired = false;

  // ── Phone notification (system tray) ────────────────────────────────────────
  function _notifPlugin() {
    return (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.LocalNotif)
      ? Capacitor.Plugins.LocalNotif : null;
  }

  function systemNotify(title, body, urgent) {
    // 1) Native Android system-tray notification (real phone notification)
    const p = _notifPlugin();
    if (p) {
      p.notify({ title: title, body: body, urgent: !!urgent }).catch(function () {});
      return;
    }
    // 2) Web Notifications fallback (browser / PWA)
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') {
        new Notification(title, { body, tag: 'resq', renotify: true });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') new Notification(title, { body });
        });
      }
    } catch (_) {}
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  const RESQ_Notify = {
    message(fromName, content) {
      systemNotify('RESQ · ' + (fromName || 'Message'), content || '', false);
    },
    sos(fromName, content) {
      systemNotify('🆘 SOS ALERT — ' + (fromName || ''), content || 'Someone needs help nearby', true);
    },
    resource(ownerName, name) {
      systemNotify('📦 Resource shared', (ownerName || 'Someone') + ' shared ' + (name || 'a resource'), false);
    },
    // Manual test
    _test() { this.message('Test', 'This is a test notification'); },
  };
  window.RESQ_Notify = RESQ_Notify;

  // ── Wire to mesh events ─────────────────────────────────────────────────────
  function wire() {
    const mesh = window.RESQ_BTMesh || window.RESQ_Mesh;
    if (!mesh || !mesh.on) { setTimeout(wire, 300); return; }
    if (_wired) return;
    _wired = true;

    const myId = () => localStorage.getItem('resq_uid');

    mesh.on('message', (msg) => {
      if (!msg || msg.from === myId()) return; // skip own
      // Don't double-notify SOS here (handled by 'sos' event)
      if (typeof msg.content === 'string' && msg.content.indexOf('🆘') === 0) return;
      // Suppress if the user is already looking at this chat
      if (window.__resqActivePeer && window.__resqActivePeer === msg.from) return;
      RESQ_Notify.message(msg.fromName, msg.content);
    });

    mesh.on('sos', (alert) => {
      if (!alert || alert.from === myId()) return;
      // Respect the "SOS Alerts" preference (default on)
      if (localStorage.getItem('resq_pref_sos_alerts') === '0') return;
      RESQ_Notify.sos(alert.fromName, alert.message);
    });

    mesh.on('resource', (payload) => {
      if (!payload || payload.action !== 'upsert' || !payload.resource) return;
      if (payload.from === myId()) return;
      RESQ_Notify.resource(payload.resource.ownerName, payload.resource.name);
    });

    // Proactively request notification permission (native first, then web)
    const p = _notifPlugin();
    if (p && p.requestPermission) {
      setTimeout(() => p.requestPermission().catch(() => {}), 2000);
    } else {
      try {
        if ('Notification' in window && Notification.permission === 'default') {
          setTimeout(() => Notification.requestPermission().catch(() => {}), 4000);
        }
      } catch (_) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
