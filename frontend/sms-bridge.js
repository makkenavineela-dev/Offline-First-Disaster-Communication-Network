/**
 * RESQ SMS Bridge
 *
 * Two transports, one API:
 *   • Programmatic SMS via Capacitor SmsBridgePlugin (real send/receive,
 *     needs SEND_SMS + RECEIVE_SMS at runtime — works on Android only).
 *   • URI-intent fallback (sms:?body=...) that opens the native SMS app —
 *     no permissions, works everywhere but requires the user to tap Send.
 *
 * Exposes a unified window.RESQ_SMS for the messaging UI, contacts picker,
 * SOS broadcast, and login OTP flow.
 */
(function () {
  'use strict';

  const PREFIX     = '[RESQ]';
  const KEY_PHONES = 'resq_known_phones';

  const isNative = typeof window !== 'undefined' &&
    typeof window.Capacitor !== 'undefined' &&
    window.Capacitor.isNativePlatform();

  // ── Helpers ────────────────────────────────────────────────────────────
  function getKnownPhones() {
    const fromMesh     = JSON.parse(localStorage.getItem(KEY_PHONES)                || '[]');
    const fromContacts = JSON.parse(localStorage.getItem('resq_emergency_contacts') || '[]');
    return [...new Set([...fromMesh, ...fromContacts])].filter(Boolean);
  }

  function buildSmsText(message) {
    const name = localStorage.getItem('resq_name') || 'Unknown';
    const role = localStorage.getItem('resq_role') || 'civilian';
    return `${PREFIX} ${name}|${role}: ${message}`;
  }

  // ── URI-intent transport (no permissions, opens SMS app) ───────────────
  function openSmsIntent(numbers, text) {
    if (!numbers.length) return;
    const to  = numbers.join(';');
    const uri = `sms:${encodeURIComponent(to)}?body=${encodeURIComponent(text)}`;
    const a = document.createElement('a');
    a.href = uri;
    a.click();
  }

  function sendBroadcast(message) {
    const phones = getKnownPhones();
    if (!phones.length) {
      console.log('[SMS Bridge] No known phones — skipping SMS broadcast');
      return 0;
    }
    openSmsIntent(phones, buildSmsText(message));
    return phones.length;
  }

  function sendToNumber(number, message) {
    openSmsIntent([number], buildSmsText(message));
  }

  // ── Programmatic transport (Capacitor SmsBridge plugin) ────────────────
  async function sendDirect(phone, message) {
    if (!isNative) return { success: false, reason: 'not-native' };
    try {
      const text = message.startsWith(PREFIX) ? message : `${PREFIX} ${message}`;
      await Capacitor.Plugins.SmsBridge.sendSms({ number: phone, text });
      return { success: true, phone };
    } catch (err) {
      console.error('[SMS Bridge] sendSms failed', err);
      return { success: false, reason: err.message || String(err) };
    }
  }

  // ── Permission check (NEVER prompts) ───────────────────────────────────
  // On sideloaded builds Android blocks the SMS "restricted permission", and
  // calling sendSms() pops the scary "App was denied access" dialog. So we
  // only attempt a direct send when the permission is ALREADY granted; the
  // cached flag lets sync callers (SOS) decide without an async round-trip.
  let _canSendDirect = false;
  async function hasSendPermission() {
    if (!isNative) return false;
    try {
      const st = await Capacitor.Plugins.SmsBridge.checkPermissions();
      _canSendDirect = !!st && st.sendSms === 'granted';
      return _canSendDirect;
    } catch (_) { return false; }
  }

  // Unified send used by OTP / messaging UI. Tries programmatic first,
  // falls back to URI intent so callers don't have to branch themselves.
  async function send(phone, message) {
    if (isNative) {
      const result = await sendDirect(phone, message);
      if (result.success) return result;
      // fall through to URI intent if programmatic send was rejected
    }
    openSmsIntent([phone], message);
    return { success: true, phone, channel: 'uri' };
  }

  // ── Incoming SMS listener (SmsBridge fires 'smsReceived' for [RESQ] msgs) ─
  let _started = false;
  async function onReceive(callback) {
    if (!isNative) return;
    if (!_started) {
      try {
        await Capacitor.Plugins.SmsBridge.startListening();
        _started = true;
      } catch (err) {
        console.warn('[SMS Bridge] startListening failed:', err.message || err);
        return;
      }
    }
    Capacitor.Plugins.SmsBridge.addListener('smsReceived', (data) => {
      // Plugin already strips [RESQ] prefix and passes payload as `body`
      callback({
        from:      data.from,
        message:   data.body,
        timestamp: data.timestamp || Date.now(),
      });
    });
  }

  function startListening(onMessage) {
    // Legacy entry-point used by older callers — same as onReceive
    onReceive(onMessage || (() => {}));
  }

  function isAvailable() { return true; }

  // ── Public API ─────────────────────────────────────────────────────────
  window.RESQ_SMS = {
    // capability flags
    available: isNative,
    isAvailable,

    // helpers
    getKnownPhones,

    // sending
    send,
    sendDirect,
    sendBroadcast,
    sendToNumber,
    hasSendPermission,
    get canSendDirect() { return _canSendDirect; },

    // receiving
    onReceive,
    startListening,
  };

  // Auto-start the receiver and bridge incoming SMS to the mesh layer so
  // they appear in the messaging UI alongside mesh messages.
  if (isNative) {
    // Cache the SMS permission state up-front (no prompt) so send paths can
    // decide whether to send directly or open the SMS app.
    hasSendPermission();
    document.addEventListener('DOMContentLoaded', () => {
      onReceive((sms) => {
        window.dispatchEvent(new CustomEvent('resq:sms:incoming', { detail: sms }));
        if (window.RESQ_Mesh && typeof RESQ_Mesh._injectExternalMessage === 'function') {
          RESQ_Mesh._injectExternalMessage({
            id:        'sms_' + Date.now(),
            from:      sms.from,
            fromName:  sms.from,
            to:        'all',
            content:   sms.message,
            type:      'sms',
            timestamp: sms.timestamp,
            channel:   'sms',
          });
        }
      });
    });
  }

})();
