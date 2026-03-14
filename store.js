/**
 * RESQ App Store - Offline First
 * Uses localStorage (web) / AsyncStorage (React Native)
 * No server required.
 */
const STORAGE_KEY = 'resq_app_state';

const storage = {
  get: async (key) => {
    try {
      if (typeof AsyncStorage !== 'undefined') return await AsyncStorage.getItem(key);
      return localStorage.getItem(key);
    } catch(e) { return null; }
  },
  set: async (key, value) => {
    try {
      if (typeof AsyncStorage !== 'undefined') await AsyncStorage.setItem(key, value);
      else localStorage.setItem(key, value);
    } catch(e) {}
  }
};

const defaultState = {
  user: {
    id: 'RESQ-' + Math.random().toString(36).substr(2,6).toUpperCase(),
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
  },
  resources: {
    medical: { level: 'CRITICAL', pct: 12 },
    water:   { level: 'LOW',      pct: 28 },
    food:    { level: 'OK',       pct: 65 },
    power:   { level: 'LOW',      pct: 45 }
  },
  messages: [],
  alerts: [{ type: 'EARTHQUAKE', magnitude: 5.8, dist: '3.2km' }]
};

class Store {
  constructor() { this.state = null; this.listeners = []; }

  async init() {
    const saved = await storage.get(STORAGE_KEY);
    try { this.state = saved ? JSON.parse(saved) : { ...defaultState }; }
    catch(e) { this.state = { ...defaultState }; }
    this.notify();
  }

  getState() { return this.state || { ...defaultState }; }

  async updateState(updates) {
    this.state = { ...this.state, ...updates };
    await storage.set(STORAGE_KEY, JSON.stringify(this.state));
    this.notify();
  }

  subscribe(fn) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  notify() { this.listeners.forEach(fn => fn(this.state)); }
}

const store = new Store();
store.init();
window.appStore = store;
