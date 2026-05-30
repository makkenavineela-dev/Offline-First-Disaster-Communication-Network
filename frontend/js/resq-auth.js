/**
 * RESQ Auth Helper
 * Automatically refreshes the JWT token if it is missing from localStorage.
 * Include this script in any page that calls authenticated API endpoints.
 */
(function () {
  const mobile = localStorage.getItem('resq_mobile');
  const name   = localStorage.getItem('resq_name');

  // Nothing to do if not logged in yet
  if (!mobile) return;

  // Token already present — nothing to do
  if (localStorage.getItem('resq_token')) return;

  // Token is missing: silently re-register to get a fresh JWT
  const serverBase =
    window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
      ? 'http://' + window.location.hostname + ':5000'
      : 'http://localhost:5000';

  fetch(serverBase + '/api/users/phone-register', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      phone: mobile,
      name:  name || ('User-' + mobile.slice(-4))
    })
  })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (d && d.token) {
        localStorage.setItem('resq_token', d.token);
        if (d.userId) localStorage.setItem('resq_uid', String(d.userId));
        // Dispatch event so any already-loaded page can react (e.g. reload resources)
        window.dispatchEvent(new CustomEvent('resq:token-ready', { detail: d }));
      }
    })
    .catch(() => {});
})();
