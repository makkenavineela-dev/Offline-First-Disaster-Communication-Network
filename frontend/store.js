const STORAGE_KEY = 'resq_app_state';
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
  ? 'http://localhost:5000' 
  : window.location.origin;

window.RESQ_CONFIG = {
  API_BASE_URL: localStorage.getItem('resq_api_url') || API_BASE_URL
};

const storage = {
  get: async (key) => {
    try {
      if (typeof AsyncStorage !== 'undefined') {
        return await AsyncStorage.getItem(key);
      }
      return localStorage.getItem(key);
    } catch (e) {
      console.warn('Storage read failed:', e);
      return null;
    }
  },
  set: async (key, value) => {
    try {
      if (typeof AsyncStorage !== 'undefined') {
        await AsyncStorage.setItem(key, value);
      } else {
        localStorage.setItem(key, value);
      }
    } catch (e) {
      console.warn('Storage write failed:', e);
    }
  }
};

const getPersistentUserId = () => {
    try {
        let id = localStorage.getItem('resq_uid');
        if (!id) {
            id = 'RESQ-' + Math.random().toString(36).substr(2, 6).toUpperCase();
            localStorage.setItem('resq_uid', id);
        }
        return id;
    } catch (e) {
        return 'RESQ-GUEST-' + Math.random().toString(36).substr(2, 4).toUpperCase();
    }
};

const defaultState = {
  user: {
    id: getPersistentUserId(),
    name: 'You',
    zone: 'Zone B',
    role: 'First Responder',
    language: 'en'
  },
  status: {
    meshConnected: true,
    nodes: 12,
    battery: 94,
    latency: 18,
    gpsAccuracy: 4
  },
  resources: {
    medical: { level: 'CRITICAL', pct: 12 },
    water: { level: 'LOW', pct: 28 },
    food: { level: 'OK', pct: 65 },
    power: { level: 'LOW', pct: 45 }
  },
  alerts: [
    { type: 'EARTHQUAKE', magnitude: 5.8, dist: '3.2km' }
  ],
  messages: []
};

class Store {
  constructor() {
    this.state = null;
    this.listeners = [];
  }

  async init() {
    const saved = await storage.get(STORAGE_KEY);
    if (saved) {
      try {
        this.state = JSON.parse(saved);
        // Ensure ID is persistent even if state was wiped but localStorage wasn't
        if (!this.state.user.id) this.state.user.id = getPersistentUserId();
      } catch (e) {
        this.state = { ...defaultState };
      }
    } else {
      this.state = { ...defaultState };
    }
    this.notify();
  }

  getState() {
    return this.state || { ...defaultState };
  }

  async updateState(updates) {
    this.state = { ...this.state, ...updates };
    await storage.set(STORAGE_KEY, JSON.stringify(this.state));
    this.notify();
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    this.listeners.forEach(listener => listener(this.state));
  }
}

const store = new Store();
window.appStore = store;
// Expose a Promise so pages can await store readiness before rendering
window.appStoreReady = store.init();

// Register Service Worker for PWA Offline Capabilities
// Skip in Capacitor native context — SW intercepts Capacitor's bridge requests and breaks navigation
const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if ('serviceWorker' in navigator) {
  if (isNativeApp) {
    // Unregister any stale SW from previous APK installs.
    // Calling unregister() alone is not enough — the old SW stays active
    // for the current page. We must reload after unregistering so the next
    // page load runs without any SW intercepting navigation requests.
    navigator.serviceWorker.getRegistrations().then(regs => {
      if (regs.length > 0) {
        Promise.all(regs.map(reg => reg.unregister())).then(() => {
          console.log('Cleared ' + regs.length + ' stale SW(s). Reloading...');
          window.location.reload();
        });
      }
    });
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('SW Registered. Scope:', reg.scope))
        .catch(err => console.error('SW Registration Failed:', err));
    });
  }
}
