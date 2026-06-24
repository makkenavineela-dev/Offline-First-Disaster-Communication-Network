/**
 * RESQ UI Dialogs — in-app confirm / alert / toast
 *
 * Replaces the blocking native window.confirm() / window.alert() popups with
 * themed, non-blocking in-app UI that matches the rest of the app.
 *
 *   RESQ_UI.confirm(message, opts) -> Promise<boolean>   (resolves true = confirmed)
 *   RESQ_UI.alert(message, opts)   -> Promise<void>      (single OK button)
 *   RESQ_UI.toast(message, kind)   -> void               (kind: 'ok' | 'warn' | 'err')
 *
 *   opts: { title, confirmText, cancelText, danger }
 *
 * Only one dialog is shown at a time (dialogs in this app are user-initiated
 * and sequential).
 */
(function () {
  'use strict';
  if (window.RESQ_UI) return;

  function injectStyles() {
    if (document.getElementById('resqUiStyle')) return;
    const st = document.createElement('style');
    st.id = 'resqUiStyle';
    st.textContent = `
      #resqUiBackdrop{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;
        justify-content:center;padding:24px;background:rgba(0,0,0,0.62);backdrop-filter:blur(4px);
        opacity:0;pointer-events:none;transition:opacity .2s;}
      #resqUiBackdrop.open{opacity:1;pointer-events:auto;}
      .resq-ui-card{width:100%;max-width:340px;background:#141414;border:1px solid #2A2A2A;
        border-radius:20px;padding:22px;box-shadow:0 24px 60px rgba(0,0,0,.6);
        font-family:'Barlow',sans-serif;transform:translateY(14px) scale(.97);transition:transform .2s;}
      #resqUiBackdrop.open .resq-ui-card{transform:none;}
      .resq-ui-title{font-size:17px;font-weight:800;color:#F5F5F0;margin-bottom:8px;}
      .resq-ui-msg{font-size:13px;line-height:1.5;color:#9A9A9A;white-space:pre-line;margin-bottom:20px;}
      .resq-ui-btns{display:flex;gap:10px;}
      .resq-ui-btn{flex:1;padding:12px;border-radius:12px;font-size:14px;font-weight:700;
        border:none;cursor:pointer;font-family:'Barlow',sans-serif;}
      .resq-ui-btn.cancel{background:#2A2A2A;color:#F5F5F0;}
      .resq-ui-btn.ok{background:#2979FF;color:#fff;}
      .resq-ui-btn.ok.danger{background:#FF1F1F;}
      #resqUiToast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:10001;
        padding:10px 18px;border-radius:22px;font-size:12px;font-weight:600;font-family:'Barlow',sans-serif;
        box-shadow:0 6px 20px rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .25s;
        max-width:84%;text-align:center;}`;
    document.head.appendChild(st);
  }

  let _backdrop = null;
  let _resolve = null;

  function _buildBackdrop() {
    injectStyles();
    if (_backdrop) return _backdrop;
    _backdrop = document.createElement('div');
    _backdrop.id = 'resqUiBackdrop';
    _backdrop.innerHTML =
      '<div class="resq-ui-card" role="dialog" aria-modal="true">' +
        '<div class="resq-ui-title" id="resqUiTitle"></div>' +
        '<div class="resq-ui-msg" id="resqUiMsg"></div>' +
        '<div class="resq-ui-btns" id="resqUiBtns"></div>' +
      '</div>';
    _backdrop.addEventListener('click', e => { if (e.target === _backdrop) _close(false); });
    (document.body || document.documentElement).appendChild(_backdrop);
    return _backdrop;
  }

  function _close(val) {
    if (_backdrop) _backdrop.classList.remove('open');
    const r = _resolve;
    _resolve = null;
    if (r) r(val);
  }

  function _dialog(message, opts, isConfirm) {
    opts = opts || {};
    const bd = _buildBackdrop();
    bd.querySelector('#resqUiTitle').textContent = opts.title || (isConfirm ? 'Confirm' : 'Notice');
    bd.querySelector('#resqUiMsg').textContent = message || '';
    const btns = bd.querySelector('#resqUiBtns');
    btns.innerHTML = '';

    if (isConfirm) {
      const cancel = document.createElement('button');
      cancel.className = 'resq-ui-btn cancel';
      cancel.textContent = opts.cancelText || 'Cancel';
      cancel.addEventListener('click', () => _close(false));
      btns.appendChild(cancel);
    }
    const ok = document.createElement('button');
    ok.className = 'resq-ui-btn ok' + (opts.danger ? ' danger' : '');
    ok.textContent = opts.confirmText || 'OK';
    ok.addEventListener('click', () => _close(true));
    btns.appendChild(ok);

    // Resolve any previously-open dialog as cancelled before showing this one
    if (_resolve) _close(false);

    return new Promise(res => {
      _resolve = res;
      void bd.offsetWidth;        // commit the closed state so the CSS transition runs
      bd.classList.add('open');   // then open synchronously (reliable even when not painting)
    });
  }

  let _toastTimer = null;
  function toast(message, kind) {
    injectStyles();
    let el = document.getElementById('resqUiToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'resqUiToast';
      (document.body || document.documentElement).appendChild(el);
    }
    el.style.background = kind === 'warn' ? 'rgba(255,170,0,0.96)'
                        : kind === 'err'  ? 'rgba(255,31,31,0.96)'
                        :                   'rgba(0,230,118,0.96)';
    el.style.color = kind === 'err' ? '#fff' : '#000';
    el.textContent = message;
    el.style.opacity = '1';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2800);
  }

  window.RESQ_UI = {
    confirm: (message, opts) => _dialog(message, opts, true),
    alert:   (message, opts) => _dialog(message, opts, false),
    toast:   toast,
  };
})();
