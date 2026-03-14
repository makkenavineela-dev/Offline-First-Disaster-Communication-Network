const STORAGE_KEY = 'resq_app_state';

// Try to use AsyncStorage (if available in a React Native web shim) or fallback to localStorage
const storage = {
  get: async (key) => {
    if (typeof AsyncStorage !== 'undefined') {
      return await AsyncStorage.getItem(key);
    }
    return localStorage.getItem(key);
  },
  set: async (key, value) => {
    if (typeof AsyncStorage !== 'undefined') {
      await AsyncStorage.setItem(key, value);
    } else {
      localStorage.setItem(key, value);
    }
  }
};

const defaultState = {
  user: {
    id: 'RESQ-7F3A-K9',
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

// Simple event bus and state manager
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

  async updateResource(type, updates) {
    const newResources = { ...this.state.resources };
    newResources[type] = { ...newResources[type], ...updates };
    await this.updateState({ resources: newResources });
  }

  subscribe(listener) {
    this.listeners.push(listener);
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    this.listeners.forEach(listener => listener(this.state));
  }
}

const store = new Store();
// Call init early so it's ready
store.init();

window.appStore = store;
