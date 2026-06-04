/**
 * RESQ Notifications
 *
 * App-wide alerting for incoming mesh messages, SOS alerts, and resource shares.
 * Loaded on every page (after bluetooth-mesh.js) so the user is notified no
 * matter which screen they are on.
 *
 * Channels:
 *   1. In-app slide-down banner (always works in the WebView)
 *   2. Vibration (navigator.vibrate)
 *   3. Sound (Web Audio beep — distinct tone for SOS)
 *   4. System notification via Web Notifications API (when granted/supported)
 *
 * SOS alerts get an urgent red banner + triple-buzz + alarm tone.
 */
(function () {
  'use strict';

  let _wired = false;
  let _audioCtx = null;

  // Respect the "Vibration & Sound" preference (default on)
  function alertsEnabled() {
    return localStorage.getItem('resq_pref_vibrate') !== '0';
  }

  // ── Sound ──────────────────────────────────────────────────────────────────
  function beep(urgent) {
    if (!alertsEnabled()) return;
    try {
      _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = _audioCtx;
      const notes = urgent ? [880, 660, 880, 660] : [660, 880];
      let t = ctx.currentTime;
      notes.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.2);
        t += 0.22;
      });
    } catch (_) {}
  }

  function vibrate(urgent) {
    if (!alertsEnabled()) return;
    if (navigator.vibrate) {
      navigator.vibrate(urgent ? [200, 100, 200, 100, 400] : [120]);
    }
  }

  // ── In-app banner ──────────────────────────────────────────────────────────
  function showBanner(title, body, opts) {
    opts = opts || {};
    const urgent = !!opts.urgent;

    // Inject styles once
    if (!document.getElementById('resqNotifStyle')) {
      const st = document.createElement('style');
      st.id = 'resqNotifStyle';
      st.textContent = `
        #resqNotifStack{position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;
          flex-direction:column;gap:8px;padding:max(8px,env(safe-area-inset-top)) 10px 0;pointer-events:none;}
        .resq-notif{pointer-events:auto;border-radius:14px;padding:11px 14px;display:flex;gap:11px;
          align-items:flex-start;box-shadow:0 6px 24px rgba(0,0,0,.5);cursor:pointer;
          animation:resqNotifIn .28s cubic-bezier(.25,.8,.25,1);backdrop-filter:blur(12px);}
        .resq-notif.msg{background:rgba(41,121,255,.96);}
        .resq-notif.sos{background:rgba(255,31,31,.97);animation:resqNotifIn .28s cubic-bezier(.25,.8,.25,1),resqPulse 1s ease-in-out infinite .3s;}
        .resq-notif.res{background:rgba(0,230,118,.95);}
        .resq-notif .ic{font-size:22px;flex-shrink:0;line-height:1.2;}
        .resq-notif .tx{flex:1;min-width:0;color:#fff;}
        .resq-notif .ti{font-size:13px;font-weight:800;letter-spacing:.3px;}
        .resq-notif.res .ti,.resq-notif.res .bd{color:#003318;}
        .resq-notif .bd{font-size:12px;opacity:.95;margin-top:2px;line-height:1.35;
          overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
        .resq-notif .cl{font-size:18px;opacity:.7;flex-shrink:0;padding:0 2px;}
        @keyframes resqNotifIn{from{transform:translateY(-120%);opacity:0;}to{transform:translateY(0);opacity:1;}}
        @keyframes resqPulse{0%,100%{box-shadow:0 6px 24px rgba(255,31,31,.5);}50%{box-shadow:0 6px 34px rgba(255,31,31,.9);}}`;
      document.head.appendChild(st);
    }

    let stack = document.getElementById('resqNotifStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'resqNotifStack';
      document.body.appendChild(stack);
    }

    const el = document.createElement('div');
    el.className = 'resq-notif ' + (opts.kind || 'msg');
    el.innerHTML =
      '<div class="ic">' + (opts.icon || '💬') + '</div>' +
      '<div class="tx"><div class="ti"></div><div class="bd"></div></div>' +
      '<div class="cl">×</div>';
    el.querySelector('.ti').textContent = title;
    el.querySelector('.bd').textContent = body;

    const remove = () => { el.style.transition = 'opacity .2s, transform .2s'; el.style.opacity = '0'; el.style.transform = 'translateY(-30%)'; setTimeout(() => el.remove(), 200); };
    el.querySelector('.cl').addEventListener('click', (e) => { e.stopPropagation(); remove(); });
    el.addEventListener('click', () => { remove(); if (opts.onClick) opts.onClick(); });

    stack.appendChild(el);
    // Auto-dismiss (SOS stays longer)
    setTimeout(remove, urgent ? 9000 : 5000);

    // Limit stack size
    while (stack.children.length > 4) stack.firstChild.remove();
  }

  // ── System notification (Web Notifications API) ────────────────────────────
  function systemNotify(title, body, urgent) {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') {
        new Notification(title, { body, tag: 'resq', renotify: true });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((p) => {
          if (p === 'granted') new Notification(title, { body });
        });
      }
    } catch (_) {}
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  const RESQ_Notify = {
    message(fromName, content) {
      showBanner(fromName || 'New message', content || '', { kind: 'msg', icon: '💬' });
      vibrate(false); beep(false);
      systemNotify('RESQ · ' + (fromName || 'Message'), content || '', false);
    },
    sos(fromName, content) {
      showBanner('🆘 SOS — ' + (fromName || 'Emergency'), content || 'Someone needs help nearby!',
        { kind: 'sos', icon: '🆘', urgent: true, onClick: () => { location.href = '/sos/index.html'; } });
      vibrate(true); beep(true);
      systemNotify('🆘 SOS ALERT — ' + (fromName || ''), content || 'Someone needs help nearby', true);
    },
    resource(ownerName, name) {
      showBanner('📦 Resource shared', (ownerName || 'Someone') + ' shared ' + (name || 'a resource'),
        { kind: 'res', icon: '📦' });
      vibrate(false);
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
      // Suppress banner if the user is already looking at this chat
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

    // Proactively request system-notification permission once
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        setTimeout(() => Notification.requestPermission().catch(() => {}), 4000);
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
