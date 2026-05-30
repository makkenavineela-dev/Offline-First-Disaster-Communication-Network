/**
 * RESQ Contacts Bridge
 * Wraps the native Android ContactsPlugin so web JS can read the phone book.
 * Caches contacts in localStorage so the list opens instantly next time.
 */
(function () {
  'use strict';

  const isNative = typeof window !== 'undefined' &&
    typeof window.Capacitor !== 'undefined' &&
    window.Capacitor.isNativePlatform();

  const CACHE_KEY = 'resq_contacts_cache';

  const RESQ_Contacts = {
    available: isNative,

    async list({ forceRefresh = false } = {}) {
      if (!forceRefresh) {
        try {
          const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
          if (cached && cached.contacts && cached.contacts.length) {
            if (isNative) this._refresh().catch(() => {});
            return cached.contacts;
          }
        } catch (e) {}
      }

      if (!isNative) {
        console.warn('[RESQ_Contacts] Only works on Android app');
        return [];
      }

      return this._refresh();
    },

    async _refresh() {
      try {
        const result = await Capacitor.Plugins.Contacts.getContacts();
        const contacts = result.contacts || [];
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          contacts,
          cachedAt: Date.now(),
        }));
        return contacts;
      } catch (err) {
        console.error('[RESQ_Contacts] read error', err);
        return [];
      }
    },

    clearCache() {
      localStorage.removeItem(CACHE_KEY);
    },

    filter(contacts, query) {
      if (!query) return contacts;
      const q = query.toLowerCase().trim();
      return contacts.filter(c =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q))
      );
    },
  };

  window.RESQ_Contacts = RESQ_Contacts;
})();
