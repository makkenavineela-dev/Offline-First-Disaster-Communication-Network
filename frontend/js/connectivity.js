/**
 * RESQ Connectivity Monitor
 * Shows real connection state in the top bar on every page.
 * States: OFFLINE | SMS ONLY | WIFI DIRECT | MESH+SMS | QUEUED(n)
 */
(function () {
  'use strict';

  const POLL_MS = 4000;

  // ── State ──────────────────────────────────────────────────────────────────
  let _meshConnected = false;
  let _smsAvailable  = false;
  let _wdAvailable   = false; // WiFi Direct
  let _bleAvailable  = false; // BLE SOS
  let _queuedCount   = 0;

  // ── Read queued message count ──────────────────────────────────────────────
  function _readQueue() {
    try {
      const mq  = JSON.parse(localStorage.getItem('resq_msg_queue')  || '[]');
      const sq  = JSON.parse(localStorage.getItem('resq_sos_queue')  || '[]');
      const wdq = JSON.parse(localStorage.getItem('resq_wd_queue')   || '[]');
      return mq.length + sq.length + wdq.length;
    } catch (_) { return 0; }
  }

  // ── Build the bar HTML ─────────────────────────────────────────────────────
  function _barHtml() {
    _queuedCount = _readQueue();

    if (_queuedCount > 0 && !_meshConnected && !_wdAvailable) {
      return {
        bg:    'rgba(255,170,0,0.12)',
        border:'rgba(255,170,0,0.4)',
        dot:   '#FFAA00',
        blink:  true,
        label: `${_queuedCount} MESSAGE${_queuedCount > 1 ? 'S' : ''} QUEUED`,
        sub:   'Will send when signal returns',
        color: '#FFAA00',
      };
    }

    if (_meshConnected && _smsAvailable) {
      return {
        bg:    'rgba(0,230,118,0.1)',
        border:'rgba(0,230,118,0.3)',
        dot:   '#00E676',
        blink:  true,
        label: 'MESH + SMS ACTIVE',
        sub:   'WiFi mesh + cellular ready',
        color: '#00E676',
      };
    }

    if (_meshConnected) {
      return {
        bg:    'rgba(0,230,118,0.1)',
        border:'rgba(0,230,118,0.3)',
        dot:   '#00E676',
        blink:  true,
        label: 'WIFI MESH ACTIVE',
        sub:   'Local mesh — no internet needed',
        color: '#00E676',
      };
    }

    if (_wdAvailable) {
      return {
        bg:    'rgba(41,121,255,0.1)',
        border:'rgba(41,121,255,0.35)',
        dot:   '#2979FF',
        blink:  true,
        label: 'WIFI DIRECT ACTIVE',
        sub:   'Device-to-device — no router',
        color: '#2979FF',
      };
    }

    if (_smsAvailable) {
      return {
        bg:    'rgba(255,170,0,0.08)',
        border:'rgba(255,170,0,0.3)',
        dot:   '#FFAA00',
        blink:  false,
        label: 'SMS ONLY',
        sub:   'Cellular SMS — no WiFi needed',
        color: '#FFAA00',
      };
    }

    if (_bleAvailable) {
      return {
        bg:    'rgba(156,39,176,0.1)',
        border:'rgba(156,39,176,0.35)',
        dot:   '#CE93D8',
        blink:  true,
        label: 'BLE SOS BEACON',
        sub:   'Bluetooth only — very short range',
        color: '#CE93D8',
      };
    }

    return {
      bg:    'rgba(255,31,31,0.08)',
      border:'rgba(255,31,31,0.25)',
      dot:   '#FF1F1F',
      blink:  false,
      label: 'OFFLINE',
      sub:   _queuedCount > 0
        ? `${_queuedCount} message${_queuedCount > 1 ? 's' : ''} queued — no signal`
        : 'No network — messages will queue',
      color: '#FF1F1F',
    };
  }

  // ── Inject / update the top bar ────────────────────────────────────────────
  function _updateBar() {
    const info = _barHtml();

    let bar = document.getElementById('resqConnBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'resqConnBar';
      // padding-top respects the phone's notch/status-bar (safe-area-inset-top)
      // so the bar is never hidden behind the system status bar.
      bar.style.cssText = `
        padding:max(6px,env(safe-area-inset-top)) 16px 6px;
        display:flex; align-items:center; justify-content:center;
        gap:6px; flex-shrink:0; transition:background 0.4s,border-color 0.4s;
        border-bottom:1px solid; position:relative; z-index:50;`;

      // Replace or prepend — find the existing offline-top-bar and swap it
      const existing = document.querySelector('.offline-top-bar');
      if (existing) {
        existing.parentNode.replaceChild(bar, existing);
      } else {
        const phone = document.querySelector('.phone') || document.body;
        phone.insertBefore(bar, phone.firstChild);
      }
    }

    bar.style.background   = info.bg;
    bar.style.borderColor  = info.border;

    const blinkStyle = info.blink
      ? 'animation:resqConnBlink 1.5s step-end infinite;'
      : '';

    bar.innerHTML = `
      <div style="width:6px;height:6px;border-radius:50%;background:${info.dot};${blinkStyle}flex-shrink:0;"></div>
      <span style="font-size:11px;font-weight:700;color:${info.color};letter-spacing:0.5px;">${info.label}</span>
      <span style="font-size:10px;color:#555;font-weight:400;margin-left:2px;">${info.sub}</span>`;

    // Inject blink keyframes once
    if (!document.getElementById('resqConnStyle')) {
      const st = document.createElement('style');
      st.id = 'resqConnStyle';
      st.textContent = '@keyframes resqConnBlink{50%{opacity:0}}';
      document.head.appendChild(st);
    }
  }

  // ── Poll for state changes ─────────────────────────────────────────────────
  function _poll() {
    _meshConnected = !!(window.RESQ_BTMesh && RESQ_BTMesh.isConnected());
    _smsAvailable  = !!(window.RESQ_SMS    && RESQ_SMS.available);
    _wdAvailable   = false; // WiFi Direct removed
    _bleAvailable  = !!(window.RESQ_BLE    && RESQ_BLE.isAdvertising());
    _updateBar();
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function _init() {
    _poll();
    setInterval(_poll, POLL_MS);

    // React immediately to BT mesh / SMS events
    if (window.RESQ_BTMesh) {
      RESQ_BTMesh.on('status', _poll);
    }
    window.addEventListener('resq:bt:status',    _poll);
    window.addEventListener('resq:ble:status',   _poll);
    window.addEventListener('resq:sms:incoming', _poll);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
})();
