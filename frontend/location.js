/**
 * RESQ — Offline GPS Location Tracker
 * Works entirely without internet using device GPS hardware.
 * Saves position to localStorage and fires 'resq:location' events.
 */

const LOCATION_KEY = 'resq_location';
const LOCATION_HISTORY_KEY = 'resq_location_history';
const MAX_HISTORY = 20;

let _watchId = null;
let _lastPosition = null;

/** Read the last known position from localStorage */
function getLastLocation() {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/** Save a position object to localStorage and dispatch event */
function _savePosition(pos) {
  const location = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: Math.round(pos.coords.accuracy),      // metres
    altitude: pos.coords.altitude,
    speed: pos.coords.speed,
    heading: pos.coords.heading,
    timestamp: pos.timestamp || Date.now()
  };

  _lastPosition = location;

  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(location));

    // Append to rolling history
    let history = [];
    const raw = localStorage.getItem(LOCATION_HISTORY_KEY);
    if (raw) history = JSON.parse(raw);
    history.push(location);
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    localStorage.setItem(LOCATION_HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    console.warn('RESQ location save failed:', e);
  }

  // Notify all listeners via a custom DOM event
  window.dispatchEvent(new CustomEvent('resq:location', { detail: location }));
}

function _onError(err) {
  const codes = { 1: 'Permission denied', 2: 'Position unavailable', 3: 'Timeout' };
  const msg = codes[err.code] || 'Unknown GPS error';
  console.warn('RESQ GPS error:', msg);
  window.dispatchEvent(new CustomEvent('resq:location:error', { detail: { code: err.code, message: msg } }));
}

/** Options tuned for high-accuracy GPS without network assistance */
const GPS_OPTIONS = {
  enableHighAccuracy: true,   // force GPS hardware, not WiFi/cell
  timeout: 15000,             // 15 s per fix attempt
  maximumAge: 0               // never use cached positions
};

/**
 * Start continuous GPS tracking.
 * Uses Capacitor Geolocation plugin when running in APK context,
 * falls back to browser navigator.geolocation otherwise.
 * Safe to call multiple times — only one watcher is created.
 */
async function startLocationTracking() {
  if (_watchId !== null) return; // already tracking

  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  if (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) {
    const Geo = window.Capacitor.Plugins.Geolocation;

    // Request permission first (Android requires this)
    try {
      const perm = await Geo.requestPermissions();
      const status = perm.location || perm.coarseLocation;
      if (status === 'denied') {
        _onError({ code: 1 });
        return;
      }
    } catch (e) { /* plugin may not have requestPermissions */ }

    // Capacitor watchPosition returns an id string
    _watchId = await Geo.watchPosition(GPS_OPTIONS, (pos, err) => {
      if (err) { _onError(err); return; }
      if (pos && pos.coords) _savePosition(pos);
    });
  } else if ('geolocation' in navigator) {
    // Browser / PWA context
    _watchId = navigator.geolocation.watchPosition(_savePosition, _onError, GPS_OPTIONS);
  } else {
    console.warn('RESQ: Geolocation not supported on this device.');
  }
}

/** Stop GPS tracking and free the watcher */
async function stopLocationTracking() {
  if (_watchId === null) return;

  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) {
    await window.Capacitor.Plugins.Geolocation.clearWatch({ id: _watchId });
  } else if ('geolocation' in navigator) {
    navigator.geolocation.clearWatch(_watchId);
  }
  _watchId = null;
}

/** Get a single one-off fix (used by pages that just need current location once) */
async function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) {
      window.Capacitor.Plugins.Geolocation.getCurrentPosition(GPS_OPTIONS)
        .then(pos => { _savePosition(pos); resolve(_lastPosition); })
        .catch(reject);
    } else if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        pos => { _savePosition(pos); resolve(_lastPosition); },
        reject,
        GPS_OPTIONS
      );
    } else {
      reject(new Error('Geolocation not supported'));
    }
  });
}

// Expose globally for all pages
window.RESQ_Location = {
  start: startLocationTracking,
  stop: stopLocationTracking,
  getCurrent: getCurrentPosition,
  getLast: getLastLocation
};
