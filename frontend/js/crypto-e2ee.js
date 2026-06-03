/**
 * RESQ E2EE — End-to-End Encryption
 *
 * Uses Web Crypto API (built into Android WebView — no library needed, works offline).
 *
 * Algorithm: ECDH P-256 key exchange → AES-GCM-256 symmetric encryption
 * This is the same algorithm used by Signal Protocol at its core.
 *
 * How private messaging works:
 *   1. Each user generates an ECDH key pair on first launch (stored in localStorage)
 *   2. When two devices meet via BLE, they exchange public keys
 *   3. Person A encrypts a message using B's public key + A's private key
 *      → derives a shared secret only A and B can compute
 *   4. Relays (B, C ...) receive the ciphertext and forward it without reading it
 *   5. Only the recipient can derive the same shared secret and decrypt
 */
(function () {
  'use strict';

  const KEY_PRIV = 'resq_e2ee_priv';   // private key (JWK, never leaves device)
  const KEY_PUB  = 'resq_e2ee_pub';    // own public key (JWK, shared freely)
  const KEY_PEERS = 'resq_e2ee_peers'; // map of userId → base64 public key

  // ── Helpers ───────────────────────────────────────────────────────────────
  function b64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }
  function unb64(s) {
    return Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;
  }

  // ── Key Generation ────────────────────────────────────────────────────────
  async function generateKeyPair() {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const pubJwk  = await crypto.subtle.exportKey('jwk', pair.publicKey);
    localStorage.setItem(KEY_PRIV, JSON.stringify(privJwk));
    localStorage.setItem(KEY_PUB,  JSON.stringify(pubJwk));
    return { privateKey: pair.privateKey, publicKey: pair.publicKey };
  }

  async function loadOrGenerateKeys() {
    const privStr = localStorage.getItem(KEY_PRIV);
    const pubStr  = localStorage.getItem(KEY_PUB);
    if (privStr && pubStr) {
      try {
        const privateKey = await crypto.subtle.importKey(
          'jwk', JSON.parse(privStr),
          { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
        );
        const publicKey = await crypto.subtle.importKey(
          'jwk', JSON.parse(pubStr),
          { name: 'ECDH', namedCurve: 'P-256' }, true, []
        );
        return { privateKey, publicKey };
      } catch (_) {}
    }
    return generateKeyPair();
  }

  // ── Export own public key as base64 (to share via BLE) ───────────────────
  async function exportOwnPublicKey() {
    const pubStr = localStorage.getItem(KEY_PUB);
    if (!pubStr) { await loadOrGenerateKeys(); return exportOwnPublicKey(); }
    const jwk  = JSON.parse(pubStr);
    const key   = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []
    );
    const raw = await crypto.subtle.exportKey('raw', key); // 65 bytes uncompressed
    return b64(raw);
  }

  // ── Import a peer's public key and store it ───────────────────────────────
  async function importPeerKey(userId, base64PubKey) {
    try {
      const raw = unb64(base64PubKey);
      // Verify it is a valid P-256 key before storing
      await crypto.subtle.importKey(
        'raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []
      );
      const peers = JSON.parse(localStorage.getItem(KEY_PEERS) || '{}');
      peers[userId] = base64PubKey;
      localStorage.setItem(KEY_PEERS, JSON.stringify(peers));
      return true;
    } catch (_) {
      return false;
    }
  }

  function getPeerKey(userId) {
    const peers = JSON.parse(localStorage.getItem(KEY_PEERS) || '{}');
    return peers[userId] || null;
  }

  function getKnownPeerIds() {
    return Object.keys(JSON.parse(localStorage.getItem(KEY_PEERS) || '{}'));
  }

  // ── Derive shared AES key (ECDH) ──────────────────────────────────────────
  async function _deriveSharedKey(myPrivateKey, theirPublicKeyBase64) {
    const raw = unb64(theirPublicKeyBase64);
    const theirKey = await crypto.subtle.importKey(
      'raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []
    );
    return crypto.subtle.deriveKey(
      { name: 'ECDH', public: theirKey },
      myPrivateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // ── Encrypt a message for a specific recipient ────────────────────────────
  // Returns base64 string: [12-byte IV][ciphertext]
  async function encrypt(recipientUserId, plaintext) {
    const theirPubBase64 = getPeerKey(recipientUserId);
    if (!theirPubBase64) throw new Error('No public key for ' + recipientUserId);

    const { privateKey } = await loadOrGenerateKeys();
    const sharedKey = await _deriveSharedKey(privateKey, theirPubBase64);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, data);

    // Combine iv + ciphertext into one base64 blob
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return b64(combined.buffer);
  }

  // ── Decrypt a message from a specific sender ──────────────────────────────
  async function decrypt(senderUserId, base64Blob) {
    const theirPubBase64 = getPeerKey(senderUserId);
    if (!theirPubBase64) throw new Error('No public key for ' + senderUserId);

    const { privateKey } = await loadOrGenerateKeys();
    const sharedKey = await _deriveSharedKey(privateKey, theirPubBase64);

    const combined = new Uint8Array(unb64(base64Blob));
    const iv         = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, ciphertext);
    return new TextDecoder().decode(plainBuf);
  }

  // ── Check if we can encrypt for a peer (have their key) ──────────────────
  function canEncryptFor(userId) {
    return !!getPeerKey(userId);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.RESQ_Crypto = {
    init:            loadOrGenerateKeys,
    exportOwnPublicKey,
    importPeerKey,
    getPeerKey,
    getKnownPeerIds,
    canEncryptFor,
    encrypt,
    decrypt,
  };

  // Auto-init on load so keys are ready before first BLE sync
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => loadOrGenerateKeys());
  } else {
    loadOrGenerateKeys();
  }
})();
