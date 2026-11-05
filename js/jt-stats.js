/* Jamie's visitor counter, feedback box, announcement banner and hidden admin panel.
   The SAME file is used by all four sites (Revise, Shared List, PackSmart, Lost Roads).

   1. Counting: once per visit it tells the counter (on roads2d.jamietaylor.org) that this site was
      opened, with a random anonymous id kept on the visitor's own device. It also notes where the
      visitor came from, which pages they open, and (through window.jtEvent) which features get used.
      No names, no email addresses, no IP numbers are stored.
   2. Errors: real visitors' JavaScript errors from this site's own files are logged (max 5 per page).
   3. Banner / maintenance screen / feedback button: switched on from the admin panel.
      Feedback is opened with window.jtFeedback(); any element with class "jt-fb-link" is shown only
      while the feedback box is switched on for the site.
   4. Admin panel: tap 5 times quickly in the very bottom-right corner of the screen (there is no
      button) and a password box appears. The right password shows the numbers and the tools.
*/
(function () {
  if (window.__jtStats) return;
  window.__jtStats = 2;

  var API = window.__JT_STATS_API__ || 'https://roads2d.jamietaylor.org/api/stats/';
  var CORNER = 40;        // size of the invisible corner, in pixels
  var TAPS = 5;           // taps needed
  var WITHIN = 3000;      // ...inside this many milliseconds
  var noop = function () {};

  function get(key, session) {
    try { return (session ? sessionStorage : localStorage).getItem(key); } catch (e) { return null; }
  }
  function set(key, value, session) {
    try { (session ? sessionStorage : localStorage).setItem(key, value); return true; } catch (e) { return false; }
  }
  function del(key) { try { localStorage.removeItem(key); } catch (e) {} }

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    if (kids) for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c == null || c === false) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  /* ---------------------------------------------------------------- counting */
  function newId() {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    var s = '';
    for (var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36);
    return s + Date.now().toString(36);
  }
  function skipped() { return !!get('jt_skip'); }   // this device was switched off in the admin panel
  function getVid() {
    var vid = get('jt_vid');
    if (!vid || !/^[a-z0-9]{12,40}$/.test(vid)) {
      vid = newId();
      if (!set('jt_vid', vid)) return '';     // can't remember a visitor id here, so don't guess
    }
    return vid;
  }
  function send(action, obj) {
    try {
      fetch(API + action, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify(obj),
        keepalive: true,
        credentials: 'omit'
      }).catch(noop);
    } catch (e) { /* counting must never break the app */ }
  }
  // "/" plus, for apps that use #home style pages, the first word after the #
  function pagePath() {
    var seg = (location.hash || '').replace(/^#\/?/, '').split(/[\/?]/)[0];
    return location.pathname + (seg && /^[a-z][a-z0-9_-]{0,30}$/i.test(seg) ? '#' + seg.toLowerCase() : '');
  }
  function refHost() {
    try {
      if (!document.referrer) return '';
      var host = new URL(document.referrer).hostname.replace(/^www\./, '');
      return host === location.hostname.replace(/^www\./, '') ? '' : host;
    } catch (e) { return ''; }
  }
  // ?from=tt-revise on a link tells the panel which video/post sent the visitor
  function fromTag() {
    try {
      var q = new URLSearchParams(location.search);
      return (q.get('from') || q.get('utm_source') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
    } catch (e) { return ''; }
  }
  function openedMode() {
    try {
      if (window.navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)) return 'app';
    } catch (e) {}
    return 'web';
  }

  var lastPath = '';
  function track() {
    if (skipped()) return;
    var vid = getVid();
    if (!vid) return;
    var first = !get('jt_seen', true);        // first page of this visit?
    var body = { vid: vid, path: pagePath(), s: first ? 1 : 0 };
    if (first) {
      set('jt_seen', '1', true);
      body.ref = refHost();
      body.from = fromTag();
      body.mode = openedMode();
      body.mt = navigator.maxTouchPoints || 0;
    }
    lastPath = body.path;
    send('hit', body);
  }

  // pages inside single-page apps (the address changes without a reload)
  var routeTimer = 0;
  function onRoute() {
    clearTimeout(routeTimer);
    routeTimer = setTimeout(function () {
      if (skipped()) return;
      var p = pagePath();
      if (p === lastPath) return;
      lastPath = p;
      var vid = getVid();
      if (vid) send('hit', { vid: vid, path: p, s: 0 });
    }, 400);
  }
  ['pushState', 'replaceState'].forEach(function (k) {
    var orig = window.history && history[k];
    if (typeof orig !== 'function') return;
    history[k] = function () {
      var r = orig.apply(this, arguments);
      try { onRoute(); } catch (e) {}
      return r;
    };
  });
  window.addEventListener('popstate', onRoute);
  window.addEventListener('hashchange', onRoute);

  // feature counters: window.jtEvent('quiz_started') or window.jtEvent('game_over', km)
  var eventsSent = 0;
  window.jtEvent = function (name, value) {
    try {
      if (skipped() || eventsSent >= 300 || typeof name !== 'string' || !/^[a-z_]{2,30}$/.test(name)) return;
      var vid = getVid();
      if (!vid) return;
      eventsSent++;
      var body = { vid: vid, name: name };
      if (typeof value === 'number' && isFinite(value)) body.v = Math.round(value * 100) / 100;
      send('event', body);
    } catch (e) {}
  };

  // real visitors' errors from this site's own files
  var errorsSent = 0;
  function reportError(msg, src, line) {
    if (skipped() || errorsSent >= 5 || !msg) return;
    errorsSent++;
    var vid = getVid();
    if (vid) send('error', { vid: vid, msg: String(msg).replace(/^Uncaught\s+/, '').slice(0, 200), src: String(src || '').slice(0, 60), line: line || 0, path: pagePath() });
  }
  window.addEventListener('error', function (e) {
    try {
      if (!e.filename || e.filename.indexOf(location.origin) !== 0) return;     // other people's code, extensions...
      reportError(e.message, e.filename.split('/').pop().split('?')[0], e.lineno);
    } catch (x) {}
  });
  window.addEventListener('unhandledrejection', function (e) {
    try {
      var r = e.reason;
      var msg = r && r.message ? r.message : (typeof r === 'string' ? r : '');
      var stack = r && r.stack ? String(r.stack) : '';
      if (!msg || stack.indexOf(location.origin) === -1) return;
      reportError('Promise: ' + msg, 'promise', 0);
    } catch (x) {}
  });

  /* ----------------------------------------------------------------- panel */
  var SITES = {
    revise: { name: 'Revise', icon: '📝', color: '#6366f1', host: 'revision.jamietaylor.org' },
    sharedlist: { name: 'Shared List', icon: '🛒', color: '#10b981', host: 'sharedlist.jamietaylor.org' },
    packsmart: { name: 'PackSmart', icon: '🧳', color: '#f97316', host: 'packsmart.jamietaylor.org' },
    roads2d: { name: 'Lost Roads 2D', icon: '🚗', color: '#ef4444', host: 'roads2d.jamietaylor.org' }
  };
  var SITE_IDS = ['revise', 'sharedlist', 'packsmart', 'roads2d'];
  var FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  var CSS =
    '.jts-back{position:fixed;inset:0;z-index:2147483600;background:rgba(10,12,20,.6);display:flex;align-items:center;justify-content:center;padding:16px;font:15px/1.4 ' + FONT + ';-webkit-tap-highlight-color:transparent}' +
    '.jts-card{background:#fff;color:#1b1f2a;border-radius:18px;width:100%;max-width:520px;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.35);padding:20px;box-sizing:border-box;text-align:left}' +
    '.jts-card.wide{max-width:600px;height:min(92vh,800px)}' +
    '.jts-card *{box-sizing:border-box;font-family:inherit}' +
    '.jts-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}' +
    '.jts-head h2{margin:0;font-size:20px;font-weight:700;color:#1b1f2a}' +
    '.jts-x{border:0;background:#eef0f4;color:#1b1f2a;width:34px;height:34px;border-radius:50%;font-size:18px;line-height:1;cursor:pointer}' +
    '.jts-card p{margin:0 0 12px;color:#4b5263}' +
    '.jts-in{width:100%;padding:12px 14px;border:1.5px solid #c9cedb;border-radius:12px;font-size:16px;background:#fff;color:#1b1f2a}' +
    '.jts-ta{width:100%;min-height:96px;padding:10px 12px;border:1.5px solid #c9cedb;border-radius:12px;font-size:16px;background:#fff;color:#1b1f2a;resize:vertical}' +
    '.jts-btn{display:inline-block;margin-top:10px;padding:12px 18px;border:0;border-radius:12px;background:#1b1f2a;color:#fff;font-size:16px;font-weight:600;cursor:pointer}' +
    '.jts-btn:disabled{opacity:.55}' +
    '.jts-btn.alt{background:#eef0f4;color:#1b1f2a}' +
    '.jts-btn+.jts-btn{margin-left:8px}' +
    '.jts-err{color:#b42318;margin:10px 0 0;font-weight:600;min-height:1.2em}' +
    '.jts-ok{color:#067647;margin:10px 0 0;font-weight:600}' +
    '.jts-site{border:1px solid #e3e6ee;border-radius:14px;padding:14px;margin:0 0 12px;border-left-width:6px}' +
    '.jts-top{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
    '.jts-top b{font-size:17px}' +
    '.jts-since{font-size:12px;color:#6b7280}' +
    '.jts-big{display:flex;gap:22px;margin:8px 0 4px}' +
    '.jts-big div{min-width:0}' +
    '.jts-num{display:block;font-size:30px;font-weight:800;line-height:1.1}' +
    '.jts-lbl{display:block;font-size:12px;color:#6b7280}' +
    '.jts-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0 6px}' +
    '.jts-grid div{background:#f4f5f9;border-radius:10px;padding:8px 10px}' +
    '.jts-grid b{display:block;font-size:18px}' +
    '.jts-grid span{font-size:11px;color:#6b7280;display:block}' +
    '.jts-line{font-size:13px;color:#4b5263;margin:4px 0}' +
    '.jts-bars{display:flex;align-items:flex-end;gap:3px;height:46px;margin-top:10px}' +
    '.jts-bars i{flex:1;border-radius:3px 3px 0 0;min-height:2px;background:currentColor;opacity:.9}' +
    '.jts-axis{display:flex;justify-content:space-between;font-size:10px;color:#9aa1b2;margin-top:2px}' +
    '.jts-all{background:#1b1f2a;color:#fff;border-radius:14px;padding:14px;margin:0 0 12px}' +
    '.jts-all .jts-lbl{color:#b7bdcc}' +
    '.jts-note{font-size:12px;color:#6b7280;margin:6px 0 12px}' +
    '.jts-card details{margin:12px 0 0;border-top:1px solid #e3e6ee;padding-top:12px}' +
    '.jts-card summary{cursor:pointer;font-weight:600}' +
    '.jts-row{display:flex;gap:8px;align-items:center;margin:10px 0 0;font-size:14px}' +
    '.jts-row input{width:18px;height:18px;flex:none}' +
    '.jts-tabs{display:flex;gap:6px;overflow-x:auto;margin:0 -20px 12px;padding:8px 20px;position:sticky;top:-20px;background:#fff;z-index:2;-webkit-overflow-scrolling:touch}' +
    '.jts-tab{flex:none;border:0;background:#eef0f4;color:#1b1f2a;padding:8px 12px;border-radius:999px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}' +
    '.jts-tab[aria-selected=true]{background:#1b1f2a;color:#fff}' +
    '.jts-badge{display:inline-block;min-width:18px;padding:0 5px;margin-left:6px;border-radius:9px;background:#d92d20;color:#fff;font-size:11px;line-height:18px;text-align:center}' +
    '.jts-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}' +
    '.jts-chip{border:1.5px solid #c9cedb;background:#fff;color:#1b1f2a;padding:6px 11px;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer}' +
    '.jts-chip[aria-pressed=true]{background:#1b1f2a;color:#fff;border-color:#1b1f2a}' +
    '.jts-list{margin:0 0 12px}' +
    '.jts-li{margin:0 0 9px}' +
    '.jts-li .t{display:flex;justify-content:space-between;gap:10px;font-size:14px}' +
    '.jts-li .t span:first-child{min-width:0;overflow-wrap:anywhere}' +
    '.jts-li .t span:last-child{color:#4b5263;white-space:nowrap}' +
    '.jts-li .b{height:7px;border-radius:4px;background:#eef0f4;margin-top:3px;overflow:hidden}' +
    '.jts-li .b i{display:block;height:100%;border-radius:4px;background:currentColor}' +
    '.jts-sub{font-size:12px;font-weight:700;color:#4b5263;text-transform:uppercase;letter-spacing:.04em;margin:18px 0 8px}' +
    '.jts-mini{border:0;background:#eef0f4;color:#1b1f2a;border-radius:8px;padding:7px 11px;font-size:13px;font-weight:600;cursor:pointer}' +
    '.jts-mini.red{background:#fee4e2;color:#b42318}' +
    '.jts-item{border:1px solid #e3e6ee;border-radius:12px;padding:10px 12px;margin:0 0 10px}' +
    '.jts-item.new{border-color:#6366f1;background:#f5f5ff}' +
    '.jts-item .meta{font-size:12px;color:#6b7280;margin-top:4px;overflow-wrap:anywhere}' +
    '.jts-item .msg{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:4px}' +
    '.jts-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center}' +
    '.jts-acts .jts-in{flex:1;min-width:140px;padding:8px 10px;font-size:15px}' +
    '.jts-tag{display:inline-block;padding:1px 8px;border-radius:999px;color:#fff;font-size:11px;font-weight:700;margin-right:6px}' +
    '.jts-kv{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:8px 0}' +
    '.jts-kv div{background:#f4f5f9;border-radius:10px;padding:8px 10px}' +
    '.jts-kv b{display:block;font-size:20px}' +
    '.jts-kv span{font-size:12px;color:#6b7280}' +
    '.jts-hours{display:flex;align-items:flex-end;gap:2px;height:80px;margin-top:6px}' +
    '.jts-hours i{flex:1;background:currentColor;border-radius:2px 2px 0 0;min-height:2px}' +
    '.jts-sql{font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;width:100%;height:150px;border:1.5px solid #c9cedb;border-radius:10px;padding:8px;color:#1b1f2a;background:#f8f9fb}' +
    '.jts-pad{padding:6px 0 14px;color:#6b7280}' +
    '.jts-hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;opacity:0}' +
    '.jts-banner{position:fixed;top:max(8px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:2147482000;width:calc(100% - 24px);max-width:520px;display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:14px;font:14px/1.4 ' + FONT + ';box-shadow:0 6px 24px rgba(0,0,0,.25);color:#fff;background:#2563eb}' +
    '.jts-banner.warning{background:#b45309}' +
    '.jts-banner span{flex:1;overflow-wrap:anywhere}' +
    '.jts-banner button{border:0;background:rgba(255,255,255,.22);color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;flex:none;line-height:1}' +
    '.jts-maint{position:fixed;inset:0;z-index:2147482500;background:#0f172a;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;font:16px/1.5 ' + FONT + '}' +
    '.jts-maint h2{font-size:26px;margin:0 0 10px;color:#fff}' +
    '.jts-maint p{max-width:420px;margin:0;opacity:.85}' +
    '@media print{.jts-banner,.jts-maint,.jts-back{display:none!important}}';

  function ensureStyle() {
    if (document.getElementById('jts-style')) return;
    var st = h('style', { id: 'jts-style' });
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  var back = null;
  var openedAt = 0;
  var password = '';
  var cardEl = null, bodyEl = null;
  var st = { tab: 'overview', site: 'revise', days: 30, summary: null, cache: {} };

  function close() {
    password = '';
    st.summary = null; st.cache = {};
    if (back && back.parentNode) back.parentNode.removeChild(back);
    back = null;
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open() {
    if (back) return;
    ensureStyle();
    back = h('div', { class: 'jts-back' });
    openedAt = Date.now();
    // ignore the "ghost" click that follows the last tap, so the box doesn't close straight away
    back.addEventListener('click', function (e) { if (e.target === back && Date.now() - openedAt > 700) close(); });
    document.addEventListener('keydown', onKey, true);
    showLogin();
    document.body.appendChild(back);
  }

  function shell(title, wide) {
    back.textContent = '';
    var card = h('div', { class: 'jts-card' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    var head = h('div', { class: 'jts-head' }, [h('h2', { text: title })]);
    head.appendChild(h('button', { class: 'jts-x', type: 'button', 'aria-label': 'Close', text: '✕', onclick: close }));
    card.appendChild(head);
    back.appendChild(card);
    return card;
  }

  function post(action, body) {
    return fetch(API + action, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(body),
      credentials: 'omit'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; });
    });
  }
  // admin call: adds the password, and goes back to the sign-in box if it stops working
  function api(action, extra) {
    var b = extra || {};
    b.password = password;
    return post(action, b).then(function (r) {
      if (r.status === 401 || r.status === 429) {
        showLogin(r.status === 429 ? 'Too many wrong tries. Wait 15 minutes and try again.' : 'Please sign in again.');
        throw new Error('auth');
      }
      return r;
    });
  }
  function fail(box, msg) {
    if (!box) return;
    box.textContent = '';
    box.appendChild(h('div', { class: 'jts-err', text: msg }));
  }
  function call(action, extra, ok, box) {
    api(action, extra).then(function (r) {
      if (r.status >= 200 && r.status < 300) ok(r);
      else fail(box, 'Something went wrong (' + (r.error || r.status) + '). Try again.');
    }).catch(function (e) {
      if (e && e.message === 'auth') return;
      fail(box, 'Could not reach the counter. Check your internet and try again.');
    });
  }

  function showLogin(message) {
    var card = shell('Admin');
    card.appendChild(h('p', { text: 'Enter the admin password.' }));
    var input = h('input', { class: 'jts-in', type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'Password', 'aria-label': 'Admin password' });
    var err = h('div', { class: 'jts-err', role: 'alert', text: message || '' });
    var go = h('button', { class: 'jts-btn', type: 'submit', text: 'Open' });
    var form = h('form', null, [input, err, go]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!input.value) return;
      go.disabled = true; err.textContent = '';
      login(input.value, err, go);
    });
    card.appendChild(form);
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
  }

  function login(pw, err, btn) {
    post('summary', { password: pw }).then(function (res) {
      if (res.status === 200 && res.sites) {
        password = pw; st.summary = res; st.cache = {};
        set('jt_owner', '1');            // this is the owner's device: maintenance shows a small bar instead of blocking
        showPanel();
        return;
      }
      var m = res.error === 'wrong_password' ? 'That password is not right.'
        : res.error === 'locked' ? 'Too many wrong tries. Wait 15 minutes and try again.'
        : res.error === 'not_set_up' ? 'The counter is not set up yet.'
        : 'Could not reach the counter. Try again.';
      if (err) err.textContent = m;
      if (btn) btn.disabled = false;
    }).catch(function () {
      if (err) err.textContent = 'Could not reach the counter. Check your internet and try again.';
      if (btn) btn.disabled = false;
    });
  }

  /* ---- small helpers for drawing */
  function fmtDay(d) {
    if (!d) return '—';
    var p = d.split('-');
    var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return parseInt(p[2], 10) + ' ' + m[parseInt(p[1], 10) - 1];
  }
  function fmtTime(ms) {
    try { return new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return new Date(ms).toLocaleString(); }
  }
  function n(v) { return (v || 0).toLocaleString(); }
  function plural(v, one, many) { return n(v) + ' ' + (v === 1 ? one : many); }
  function pct(a, b) { return b ? Math.round((a / b) * 100) + '%' : '—'; }

  function copyText(text, btn) {
    function done(ok) { if (btn) { var old = btn.textContent; btn.textContent = ok ? 'Copied ✓' : 'Press and hold to copy'; setTimeout(function () { btn.textContent = old; }, 1600); } }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); }); return; }
    } catch (e) {}
    try {
      var ta = h('textarea', { style: 'position:fixed;left:-9999px' }); ta.value = text;
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      done(ok);
    } catch (e) { done(false); }
  }

  function stat(label, people, visits) {
    var d = h('div', null, [h('b', { text: n(people) }), h('span', { text: label })]);
    if (visits != null) d.appendChild(h('span', { text: plural(visits, 'visit', 'visits') }));
    return d;
  }

  function siteChips(box) {
    var row = h('div', { class: 'jts-chips' });
    SITE_IDS.forEach(function (id) {
      row.appendChild(h('button', {
        class: 'jts-chip', type: 'button', 'aria-pressed': id === st.site ? 'true' : 'false',
        text: SITES[id].icon + ' ' + SITES[id].name,
        onclick: function () { st.site = id; renderTab(); }
      }));
    });
    box.appendChild(row);
  }
  function periodChips(box) {
    var row = h('div', { class: 'jts-chips' });
    [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].forEach(function (p) {
      row.appendChild(h('button', {
        class: 'jts-chip', type: 'button', 'aria-pressed': p[0] === st.days ? 'true' : 'false', text: p[1],
        onclick: function () { st.days = p[0]; renderTab(); }
      }));
    });
    box.appendChild(row);
  }

  function barList(rows, color, labelFn, emptyText) {
    var wrap = h('div', { class: 'jts-list' });
    var total = 0, max = 1;
    rows.forEach(function (r) { total += r.n; if (r.n > max) max = r.n; });
    if (!total) { wrap.appendChild(h('p', { class: 'jts-note', text: emptyText || 'Nothing yet.' })); return wrap; }
    rows.forEach(function (r) {
      var t = h('div', { class: 't' }, [h('span', { text: labelFn ? labelFn(r.val) : r.val }), h('span', { text: n(r.n) + ' · ' + pct(r.n, total) })]);
      var i = h('i'); i.style.width = Math.max(2, Math.round((r.n / max) * 100)) + '%';
      var b = h('div', { class: 'b' }, [i]); b.style.color = color;
      wrap.appendChild(h('div', { class: 'jts-li' }, [t, b]));
    });
    return wrap;
  }

  function loading(box) { box.textContent = ''; box.appendChild(h('p', { class: 'jts-pad', text: 'Loading…' })); }

  /* ---- Overview */
  function siteCard(s) {
    var meta = SITES[s.id] || { name: s.id, icon: '🌐', color: '#555' };
    var box = h('div', { class: 'jts-site' });
    box.style.borderLeftColor = meta.color;
    box.appendChild(h('div', { class: 'jts-top' }, [
      h('b', { text: meta.icon + ' ' + meta.name }),
      h('span', { class: 'jts-since', text: s.since ? 'counting since ' + fmtDay(s.since) : 'no visits yet' })
    ]));
    box.appendChild(h('div', { class: 'jts-big' }, [
      h('div', null, [h('span', { class: 'jts-num', text: n(s.people) }), h('span', { class: 'jts-lbl', text: 'different people' })]),
      h('div', null, [h('span', { class: 'jts-num', text: n(s.visits) }), h('span', { class: 'jts-lbl', text: 'visits in total' })])
    ]));
    box.appendChild(h('div', { class: 'jts-grid' }, [
      stat('today', s.today.people, s.today.visits),
      stat('last 7 days', s.days7.people, s.days7.visits),
      stat('last 30 days', s.days30.people, s.days30.visits)
    ]));
    box.appendChild(h('div', { class: 'jts-line', text: 'New in the last 7 days: ' + n(s.new7) + '  ·  Came back on another day: ' + n(s.cameBack) }));
    box.appendChild(h('div', { class: 'jts-line', text: 'Back the next day: ' + (s.day1.cohort ? s.day1.back + ' of ' + s.day1.cohort + ' (' + pct(s.day1.back, s.day1.cohort) + ')' : 'too early to tell') +
      '  ·  Back within a week: ' + (s.day7.cohort ? s.day7.back + ' of ' + s.day7.cohort + ' (' + pct(s.day7.back, s.day7.cohort) + ')' : 'too early to tell') }));
    box.appendChild(h('div', { class: 'jts-line', text: 'Opened from a home-screen icon: ' + plural(s.fromHomeScreen, 'person', 'people') }));
    if (s.errors7 || s.feedbackNew) {
      box.appendChild(h('div', { class: 'jts-line', style: 'color:#b42318;font-weight:600', text:
        (s.errors7 ? '⚠ ' + plural(s.errors7, 'error', 'errors') + ' this week  ' : '') + (s.feedbackNew ? '💬 ' + plural(s.feedbackNew, 'new note', 'new notes') : '') }));
    }

    var bars = h('div', { class: 'jts-bars' });
    bars.style.color = meta.color;
    var max = 1, i;
    for (i = 0; i < s.daily.length; i++) if (s.daily[i].people > max) max = s.daily[i].people;
    for (i = 0; i < s.daily.length; i++) {
      var bar = h('i', { title: fmtDay(s.daily[i].day) + ': ' + plural(s.daily[i].people, 'person', 'people') + ', ' + plural(s.daily[i].visits, 'visit', 'visits') });
      bar.style.height = Math.max(4, Math.round((s.daily[i].people / max) * 100)) + '%';
      if (!s.daily[i].people) bar.style.opacity = '.25';
      bars.appendChild(bar);
    }
    box.appendChild(bars);
    box.appendChild(h('div', { class: 'jts-axis' }, [h('span', { text: fmtDay(s.daily[0].day) }), h('span', { text: 'different people each day' }), h('span', { text: 'today' })]));
    return box;
  }

  function tabOverview(box) {
    var res = st.summary, people = 0, visits = 0;
    res.sites.forEach(function (s) { people += s.people; visits += s.visits; });
    box.appendChild(h('div', { class: 'jts-all' }, [h('div', { class: 'jts-big', style: 'margin:0' }, [
      h('div', null, [h('span', { class: 'jts-num', text: n(people) }), h('span', { class: 'jts-lbl', text: 'people across all four sites' })]),
      h('div', null, [h('span', { class: 'jts-num', text: n(visits) }), h('span', { class: 'jts-lbl', text: 'visits in total' })])
    ])]));
    res.sites.forEach(function (s) { box.appendChild(siteCard(s)); });
    box.appendChild(h('p', { class: 'jts-note', text:
      'A "person" is one browser on one device, counted without any name or email. Someone using two apps counts once in each app, and one person on two devices counts twice. Your own visits count too unless you switch this device off in Tools. Robots are left out.' }));
    var refresh = h('button', { class: 'jts-btn alt', type: 'button', text: 'Refresh' });
    refresh.addEventListener('click', function () {
      refresh.disabled = true;
      call('summary', {}, function (r) { st.summary = r; st.cache = {}; showPanel(); }, null);
    });
    box.appendChild(refresh);
  }

  /* ---- numbers that need the "detail" report */
  function withDetail(box, draw) {
    var key = 'detail' + st.days;
    if (st.cache[key]) { draw(st.cache[key].sites[st.site]); return; }
    var ph = h('div', { class: 'jts-pad', text: 'Loading…' });
    box.appendChild(ph);
    call('detail', { days: st.days }, function (r) {
      st.cache[key] = r;
      if (ph.parentNode) ph.parentNode.removeChild(ph);
      draw(r.sites[st.site]);
    }, ph);
  }
  function head2(box) { siteChips(box); periodChips(box); }

  var SRC = { direct: 'Typed in, bookmarked or unknown', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', x: 'X / Twitter', youtube: 'YouTube',
    google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', reddit: 'Reddit', whatsapp: 'WhatsApp', snapchat: 'Snapchat', pinterest: 'Pinterest',
    linkedin: 'LinkedIn', github: 'GitHub', email: 'Email', claude: 'Claude', lovable: 'Lovable', 'my other sites': 'From my other sites' };
  function srcLabel(v) { return SRC[v] || (v.indexOf('.') > -1 ? v : 'Tagged link: ' + v); }

  function tabSources(box) {
    head2(box);
    withDetail(box, function (d) {
      box.appendChild(h('div', { class: 'jts-sub', text: 'Where people came from (visits)' }));
      box.appendChild(barList(d.source, SITES[st.site].color, srcLabel, 'No visits in this period yet.'));
      box.appendChild(h('div', { class: 'jts-sub', text: 'Make a tagged link' }));
      box.appendChild(h('p', { class: 'jts-note', text: 'Put a different tag on each link you share (one per TikTok video, say). Visits through it then appear above under "Tagged link". Letters, numbers, - and _ only.' }));
      var tag = h('input', { class: 'jts-in', type: 'text', placeholder: 'Tag, e.g. tt-video1', maxlength: '30', 'aria-label': 'Tag name' });
      tag.value = 'tt-' + st.site;
      var out = h('input', { class: 'jts-in', type: 'text', readonly: true, 'aria-label': 'Tagged link', style: 'margin-top:8px' });
      function upd() { var t = tag.value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30); out.value = 'https://' + SITES[st.site].host + '/?from=' + t; }
      tag.addEventListener('input', upd); upd();
      var cp = h('button', { class: 'jts-btn alt', type: 'button', text: 'Copy link', onclick: function () { copyText(out.value, cp); } });
      box.appendChild(tag); box.appendChild(out); box.appendChild(cp);
    });
  }

  function countryLabel(code) {
    if (code === 'XX') return 'Unknown';
    if (code === 'T1') return 'Tor network';
    var name = code, flag = '';
    try { name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch (e) {}
    try { if (/^[A-Z]{2}$/.test(code)) flag = String.fromCodePoint(127397 + code.charCodeAt(0), 127397 + code.charCodeAt(1)) + ' '; } catch (e) {}
    return flag + name;
  }
  var DEV = { phone: '📱 Phone', tablet: 'Tablet', computer: '💻 Computer' };
  var MODE = { app: 'Opened from a home-screen icon (installed)', web: 'Opened in a browser' };
  function tabAudience(box) {
    head2(box);
    withDetail(box, function (d) {
      var c = SITES[st.site].color;
      box.appendChild(h('div', { class: 'jts-sub', text: 'Countries (visits)' }));
      box.appendChild(barList(d.country, c, countryLabel, 'No visits in this period yet.'));
      box.appendChild(h('div', { class: 'jts-sub', text: 'Devices' }));
      box.appendChild(barList(d.device, c, function (v) { return DEV[v] || v; }));
      box.appendChild(h('div', { class: 'jts-sub', text: 'Systems' }));
      box.appendChild(barList(d.os, c));
      box.appendChild(h('div', { class: 'jts-sub', text: 'How it was opened' }));
      box.appendChild(barList(d.mode, c, function (v) { return MODE[v] || v; }));
    });
  }

  function tabPages(box) {
    head2(box);
    withDetail(box, function (d) {
      box.appendChild(h('div', { class: 'jts-sub', text: 'Most-opened pages (page views)' }));
      box.appendChild(barList(d.page, SITES[st.site].color, function (v) { return v === '/' ? 'Home page  (/)' : v; }, 'No page views in this period yet.'));
      box.appendChild(h('p', { class: 'jts-note', text: 'Pages inside the app that change the address bar (or the # part) are counted when they open. Ids and invite codes are hidden.' }));
    });
  }

  function hourName(hr) { var s = hr % 12 === 0 ? 12 : hr % 12; return s + (hr < 12 ? 'am' : 'pm'); }
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  function tabTimes(box) {
    head2(box);
    withDetail(box, function (d) {
      var c = SITES[st.site].color, i, max = 0, best = 0, total = 0;
      for (i = 0; i < 24; i++) { total += d.hour[i]; if (d.hour[i] > max) { max = d.hour[i]; best = i; } }
      box.appendChild(h('div', { class: 'jts-sub', text: 'Time of day (UK time, visits)' }));
      if (!total) { box.appendChild(h('p', { class: 'jts-note', text: 'No visits in this period yet.' })); return; }
      var bars = h('div', { class: 'jts-hours' });
      bars.style.color = c;
      for (i = 0; i < 24; i++) {
        var b = h('i', { title: hourName(i) + ': ' + plural(d.hour[i], 'visit', 'visits') });
        b.style.height = Math.max(3, Math.round((d.hour[i] / max) * 100)) + '%';
        if (!d.hour[i]) b.style.opacity = '.25';
        bars.appendChild(b);
      }
      box.appendChild(bars);
      box.appendChild(h('div', { class: 'jts-axis' }, ['12am', '6am', '12pm', '6pm', '11pm'].map(function (t) { return h('span', { text: t }); })));
      box.appendChild(h('p', { class: 'jts-line', style: 'margin-top:8px', text: 'Busiest hour: ' + hourName(best) + ' to ' + hourName((best + 1) % 24) }));
      box.appendChild(h('div', { class: 'jts-sub', text: 'Day of the week (visits)' }));
      box.appendChild(barList(DAYS.map(function (nm, k) { return { val: nm, n: d.dow[k] }; }), c));
    });
  }

  var EVENT_NAMES = {
    quiz_started: 'Quizzes started', quiz_finished: 'Quizzes finished', exam_taken: 'Practice exams handed in', exam_added: 'Exams added',
    question_added: 'Questions added', ai_questions: 'AI question sets made', ai_marked: 'Answers marked by AI',
    list_created: 'Shopping lists created', list_joined: 'Lists joined from an invite', item_added: 'Items added', meal_list_created: 'Meal-plan lists made',
    trip_created: 'Trips created', list_printed: 'Packing lists printed',
    hitchhiker_dropped: 'Hitchhikers dropped off', fuel_filled: 'Fuel top-ups (pump or jerry cans)', game_over: 'Games finished'
  };
  function tabFeatures(box) {
    head2(box);
    withDetail(box, function (d) {
      box.appendChild(h('div', { class: 'jts-sub', text: 'What people did (number of times)' }));
      var rows = d.events.map(function (e) { return { val: e.name, n: e.n }; }).sort(function (a, b) { return b.n - a.n; });
      box.appendChild(barList(rows, SITES[st.site].color, function (v) { return EVENT_NAMES[v] || v; }, 'Nothing yet. These fill up as people use the features.'));
      d.events.forEach(function (e) {
        if (e.name === 'game_over' && e.n) box.appendChild(h('p', { class: 'jts-line', text: 'Distance driven in finished games: ' + n(Math.round(e.v)) + ' km in total, about ' + n(Math.round(e.v / e.n)) + ' km a game.' }));
      });
      box.appendChild(h('p', { class: 'jts-note', text: 'These count every time something happens, not different people. Your own use counts unless you switch this device off in Tools.' }));
    });
  }

  /* ---- Accounts and Lost Roads players */
  var COUNT_NAMES = { accounts: 'Accounts', active7: 'Signed in, last 7 days', active30: 'Signed in, last 30 days', saves: 'Study sets saved online',
    groups: 'Shared lists', items: 'List items', members: 'People in lists', lists: 'Saved packing lists',
    players: 'Players', withScore: 'With a leaderboard score', postcards: 'Postcards saved', bestKm: 'Furthest drive (km)' };
  var COUNT_ORDER = ['players', 'accounts', 'active7', 'active30', 'withScore', 'saves', 'groups', 'members', 'items', 'lists', 'postcards', 'bestKm'];

  function accountCard(id, a) {
    var meta = SITES[id];
    var box = h('div', { class: 'jts-site' });
    box.style.borderLeftColor = meta.color;
    box.appendChild(h('div', { class: 'jts-top' }, [h('b', { text: meta.icon + ' ' + meta.name })]));
    if (!a || !a.ok) {
      box.appendChild(h('p', { class: 'jts-line', style: 'margin-top:8px', text: a && a.reason === 'not_set_up' ? 'Not connected yet. See "Connect the other sites" below.' : 'Could not be read right now. Check it has been connected (see below).' }));
      return box;
    }
    var kv = h('div', { class: 'jts-kv' });
    COUNT_ORDER.forEach(function (k) {
      if (a.counts[k] == null) return;
      kv.appendChild(h('div', null, [h('b', { text: n(a.counts[k]) }), h('span', { text: COUNT_NAMES[k] || k })]));
    });
    box.appendChild(kv);
    return box;
  }

  function tabAccounts(box) {
    loading(box);
    call('accounts', {}, function (r) {
      box.textContent = '';
      SITE_IDS.forEach(function (id) { box.appendChild(accountCard(id, r[id])); });
      box.appendChild(h('p', { class: 'jts-note', text: 'Only totals are shown. Nobody\'s email, name or content is read.' }));

      var pending = SITE_IDS.filter(function (id) { return id !== 'roads2d' && !(r[id] && r[id].ok); });
      var play = h('div'); box.appendChild(play);
      var sql = h('div'); box.appendChild(sql);
      if (pending.length) {
        sql.appendChild(h('div', { class: 'jts-sub', text: 'Connect the other sites' }));
        sql.appendChild(h('p', { class: 'jts-note', text: 'One-time step: each site\'s database needs a tiny "counts only" function so this page can read totals. It cannot read anyone\'s details.' }));
        sql.appendChild(h('button', { class: 'jts-btn alt', type: 'button', text: 'Show the setup steps', onclick: function () { showSetup(sql, pending); } }));
      }
      drawPlayers(play);
    }, box);
  }

  function showSetup(box, ids) {
    loading(box);
    call('link_sql', {}, function (r) {
      box.textContent = '';
      box.appendChild(h('div', { class: 'jts-sub', text: 'Connect the other sites' }));
      box.appendChild(h('p', { class: 'jts-note', text: 'For each site: open its database\'s SQL editor, paste the box below, and press Run. Then come back here and press Refresh on Overview. It is safe to run twice.' }));
      ids.forEach(function (id) {
        var text = r.sql[id] || '';
        box.appendChild(h('div', { class: 'jts-line', style: 'font-weight:700;margin-top:10px', text: SITES[id].icon + ' ' + SITES[id].name }));
        if (id === 'packsmart') box.appendChild(h('p', { class: 'jts-note', text: 'PackSmart\'s database is looked after by Lovable. If you cannot find a SQL editor there, paste this into the Lovable chat and ask it to "run this SQL on the database".' }));
        else box.appendChild(h('p', { class: 'jts-note', text: 'In Supabase: open this site\'s project, then SQL Editor, then New query.' }));
        var ta = h('textarea', { class: 'jts-sql', readonly: true, 'aria-label': SITES[id].name + ' setup SQL' }); ta.value = text;
        box.appendChild(ta);
        var cp = h('button', { class: 'jts-btn alt', type: 'button', text: 'Copy', onclick: function () { copyText(text, cp); } });
        box.appendChild(cp);
      });
    }, box);
  }

  function drawPlayers(box) {
    box.appendChild(h('div', { class: 'jts-sub', text: 'Lost Roads players' }));
    var list = h('div'); box.appendChild(list);
    loading(list);
    call('players', {}, function (r) {
      list.textContent = '';
      if (!r.rows || !r.rows.length) list.appendChild(h('p', { class: 'jts-note', text: 'No players have signed up yet.' }));
      (r.rows || []).forEach(function (p) { list.appendChild(playerRow(p, list)); });
      box.appendChild(h('p', { class: 'jts-note', text: '"Remove score" takes the player off the leaderboard (they can score again). "Delete" removes the whole account, save and postcards.' }));
      drawBlocked(box);
    }, list);
  }

  function playerRow(p, list) {
    var item = h('div', { class: 'jts-item' });
    item.appendChild(h('b', { text: p.username }));
    item.appendChild(h('div', { class: 'meta', text: (p.best_km > 0 ? p.best_km.toFixed(1) + ' km best' : 'no score') + '  ·  last active ' + fmtTime(p.updated_at) }));
    var acts = h('div', { class: 'jts-acts' });
    item.appendChild(acts);
    function reload() { var holder = list.parentNode; holder.textContent = ''; drawPlayers(holder); }
    function buttons() {
      acts.textContent = '';
      acts.appendChild(h('button', { class: 'jts-mini', type: 'button', text: 'Rename', onclick: renameForm }));
      if (p.best_km > 0) acts.appendChild(h('button', { class: 'jts-mini', type: 'button', text: 'Remove score', onclick: function () { call('player_unscore', { id: p.id }, reload, item); } }));
      var del = h('button', { class: 'jts-mini red', type: 'button', text: 'Delete' });
      var armed = false, timer = 0;
      del.addEventListener('click', function () {
        if (!armed) { armed = true; del.textContent = 'Tap again to delete'; timer = setTimeout(function () { armed = false; del.textContent = 'Delete'; }, 4000); return; }
        clearTimeout(timer); call('player_delete', { id: p.id }, reload, item);
      });
      acts.appendChild(del);
    }
    function renameForm() {
      acts.textContent = '';
      var inp = h('input', { class: 'jts-in', type: 'text', maxlength: '20', 'aria-label': 'New username' }); inp.value = p.username;
      var msg = h('div', { class: 'jts-err', style: 'width:100%;margin:0' });
      acts.appendChild(inp);
      acts.appendChild(h('button', { class: 'jts-mini', type: 'button', text: 'Save', onclick: function () {
        api('player_rename', { id: p.id, name: inp.value }).then(function (r) {
          if (r.status === 200) reload();
          else msg.textContent = r.error === 'username_taken' ? 'That name is taken.' : r.error === 'bad_username' ? '3 to 20 letters, numbers, - or _.' : 'Could not rename.';
        }).catch(function (e) { if (!e || e.message !== 'auth') msg.textContent = 'Could not reach the counter.'; });
      } }));
      acts.appendChild(h('button', { class: 'jts-mini', type: 'button', text: 'Cancel', onclick: buttons }));
      acts.appendChild(msg);
      try { inp.focus(); } catch (e) {}
    }
    buttons();
    return item;
  }

  function drawBlocked(box) {
    box.appendChild(h('div', { class: 'jts-sub', text: 'Blocked words in usernames' }));
    var holder = h('div'); box.appendChild(holder);
    call('blocked_get', {}, function (r) {
      var ta = h('textarea', { class: 'jts-ta', style: 'min-height:64px', placeholder: 'Type words separated by spaces or commas', 'aria-label': 'Blocked words' });
      ta.value = (r.words || []).join(' ');
      var msg = h('div', { class: 'jts-ok' });
      var save = h('button', { class: 'jts-btn alt', type: 'button', text: 'Save list' });
      save.addEventListener('click', function () {
        save.disabled = true; msg.textContent = '';
        call('blocked_set', { words: ta.value.split(/[\s,]+/).filter(Boolean) }, function (x) { save.disabled = false; ta.value = x.words.join(' '); msg.textContent = 'Saved.'; }, msg);
      });
      holder.appendChild(ta); holder.appendChild(save); holder.appendChild(msg);
      holder.appendChild(h('p', { class: 'jts-note', text: 'New sign-ups containing these words (even with look-alike numbers, like 0 for o) are refused. Names already on the leaderboard are not hidden: use Rename or Delete above.' }));
    }, holder);
  }

  /* ---- Errors */
  function siteTag(id) {
    var t = h('span', { class: 'jts-tag', text: (SITES[id] || { name: id }).name });
    t.style.background = (SITES[id] || { color: '#555' }).color;
    return t;
  }
  function tabErrors(box) {
    loading(box);
    call('errors', {}, function (r) {
      box.textContent = '';
      box.appendChild(h('p', { class: 'jts-note', text: 'Errors that real visitors hit in this site\'s own code. The same error is grouped into one line.' }));
      if (!r.rows.length) { box.appendChild(h('p', { class: 'jts-pad', text: 'No errors recorded. 🎉' })); return; }
      box.appendChild(h('button', { class: 'jts-mini red', type: 'button', text: 'Clear all', style: 'margin-bottom:10px', onclick: function () { call('errors_clear', {}, function () { tabErrors(box); }, box); } }));
      r.rows.forEach(function (e) {
        var item = h('div', { class: 'jts-item' });
        item.appendChild(h('div', null, [siteTag(e.site), h('b', { text: e.msg })]));
        item.appendChild(h('div', { class: 'meta', text: (e.src || 'unknown file') + (e.line ? ':' + e.line : '') + '  ·  page ' + e.path + '  ·  ' + plural(e.n, 'time', 'times') + '  ·  last ' + fmtTime(e.last_at) }));
        item.appendChild(h('div', { class: 'jts-acts' }, [h('button', { class: 'jts-mini', type: 'button', text: 'Clear', onclick: function () { call('errors_clear', { id: e.id }, function () { tabErrors(box); }, box); } })]));
        box.appendChild(item);
      });
    }, box);
  }

  /* ---- Feedback */
  var KINDS = { idea: '💡 Idea', problem: '🐞 Problem', other: '💬 Note' };
  function tabFeedback(box) {
    loading(box);
    call('feedback_list', {}, function (r) {
      box.textContent = '';
      if (!r.rows.length) { box.appendChild(h('p', { class: 'jts-pad', text: 'No notes yet. Visitors can send them from the "Send feedback" link inside each app (switch it on or off in Tools).' })); return; }
      if (r.rows.some(function (x) { return !x.seen; })) box.appendChild(h('button', { class: 'jts-mini', type: 'button', text: 'Mark all as read', style: 'margin-bottom:10px', onclick: function () { call('feedback_seen', {}, function () { tabFeedback(box); }, box); } }));
      r.rows.forEach(function (f) {
        var item = h('div', { class: 'jts-item' + (f.seen ? '' : ' new') });
        item.appendChild(h('div', null, [siteTag(f.site), h('b', { text: KINDS[f.kind] || KINDS.other })]));
        item.appendChild(h('div', { class: 'msg', text: f.msg }));
        item.appendChild(h('div', { class: 'meta', text: fmtTime(f.at) + '  ·  from page ' + f.path + (f.contact ? '  ·  contact: ' + f.contact : '') }));
        var acts = h('div', { class: 'jts-acts' });
        if (!f.seen) acts.appendChild(h('button', { class: 'jts-mini', type: 'button', text: 'Mark as read', onclick: function () { call('feedback_seen', { id: f.id }, function () { tabFeedback(box); }, box); } }));
        acts.appendChild(h('button', { class: 'jts-mini red', type: 'button', text: 'Delete', onclick: function () { call('feedback_delete', { id: f.id }, function () { tabFeedback(box); }, box); } }));
        item.appendChild(acts);
        box.appendChild(item);
      });
    }, box);
  }

  /* ---- Tools */
  function siteChecks(selected) {
    var wrap = h('div', { class: 'jts-chips', style: 'margin:6px 0 0' });
    var boxes = {};
    SITE_IDS.forEach(function (id) {
      var cb = h('input', { type: 'checkbox' });
      cb.checked = selected.indexOf(id) > -1;
      boxes[id] = cb;
      wrap.appendChild(h('label', { class: 'jts-row', style: 'margin:0 12px 0 0' }, [cb, SITES[id].name]));
    });
    return { el: wrap, get: function () { return SITE_IDS.filter(function (id) { return boxes[id].checked; }); } };
  }

  function tabTools(box) {
    loading(box);
    call('config_get', {}, function (cfg) {
      box.textContent = '';
      var bannerSites = siteChecks(cfg.banner.sites.length || cfg.banner.text ? cfg.banner.sites : SITE_IDS);
      var maintSites = siteChecks(cfg.maintenance.sites.length || cfg.maintenance.on ? cfg.maintenance.sites : SITE_IDS);
      var fbSites = siteChecks(cfg.feedback.sites);

      box.appendChild(h('div', { class: 'jts-sub', text: 'Announcement banner' }));
      box.appendChild(h('p', { class: 'jts-note', text: 'A short message shown at the top of the sites you tick, every time someone opens the site. Visitors can close it for that visit. Leave the text empty to turn it off.' }));
      var bText = h('textarea', { class: 'jts-ta', style: 'min-height:64px', maxlength: '300', placeholder: 'e.g. New: you can now print your packing list!', 'aria-label': 'Banner text' }); bText.value = cfg.banner.text;
      var bStyle = h('select', { class: 'jts-in', 'aria-label': 'Banner style', style: 'margin-top:8px' }, [h('option', { value: 'info', text: 'Blue (news)' }), h('option', { value: 'warning', text: 'Orange (heads-up)' })]);
      bStyle.value = cfg.banner.style;
      box.appendChild(bText); box.appendChild(bStyle); box.appendChild(bannerSites.el);

      box.appendChild(h('div', { class: 'jts-sub', text: 'Maintenance switch' }));
      box.appendChild(h('p', { class: 'jts-note', text: 'Covers the sites you tick with a "back soon" screen for visitors. On your own device you only see a small bar, so you can still test.' }));
      var mOn = h('input', { type: 'checkbox' }); mOn.checked = cfg.maintenance.on;
      box.appendChild(h('label', { class: 'jts-row', style: 'margin:0 0 8px;font-weight:700' }, [mOn, 'Maintenance screen is ON']));
      var mText = h('textarea', { class: 'jts-ta', style: 'min-height:64px', maxlength: '300', placeholder: 'Optional message, e.g. Back at 6pm', 'aria-label': 'Maintenance message' }); mText.value = cfg.maintenance.text;
      box.appendChild(mText); box.appendChild(maintSites.el);

      box.appendChild(h('div', { class: 'jts-sub', text: 'Feedback link' }));
      box.appendChild(h('p', { class: 'jts-note', text: 'Show the "Send feedback" link inside the sites you tick.' }));
      box.appendChild(fbSites.el);

      var msg = h('div', { class: 'jts-ok' });
      var save = h('button', { class: 'jts-btn', type: 'button', text: 'Save changes' });
      save.addEventListener('click', function () {
        save.disabled = true; msg.className = 'jts-ok'; msg.textContent = '';
        api('config_set', { config: {
          banner: { text: bText.value, style: bStyle.value, sites: bannerSites.get() },
          maintenance: { on: mOn.checked, text: mText.value, sites: maintSites.get() },
          feedback: { sites: fbSites.get() }
        } }).then(function (r) {
          save.disabled = false;
          if (r.status === 200) {
            msg.textContent = 'Saved. Visitors see the change within a minute or two. On this device it shows as soon as you close this panel.';
            closedNowReset();
            try { window.__jtRefreshConfig(); } catch (e) {}
          }
          else { msg.className = 'jts-err'; msg.textContent = 'Could not save. Try again.'; }
        }).catch(function (e) { save.disabled = false; if (!e || e.message !== 'auth') { msg.className = 'jts-err'; msg.textContent = 'Could not reach the counter.'; } });
      });
      box.appendChild(save); box.appendChild(msg);

      box.appendChild(h('div', { class: 'jts-sub', text: 'This device' }));
      var cb = h('input', { type: 'checkbox' }); cb.checked = !!get('jt_skip');
      cb.addEventListener('change', function () { if (cb.checked) set('jt_skip', '1'); else del('jt_skip'); });
      box.appendChild(h('label', { class: 'jts-row' }, [cb, 'Don\'t count visits from this device on this site']));

      var det = h('details');
      det.appendChild(h('summary', { text: 'Change the admin password' }));
      var np = h('input', { class: 'jts-in', type: 'password', autocomplete: 'new-password', placeholder: 'New password (8 or more characters)', 'aria-label': 'New admin password' });
      var pm = h('div', { class: 'jts-err' });
      var ps = h('button', { class: 'jts-btn', type: 'submit', text: 'Save new password' });
      var f = h('form', { style: 'margin-top:10px' }, [np, pm, ps]);
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        pm.className = 'jts-err'; pm.textContent = '';
        if (np.value.length < 8) { pm.textContent = 'Use at least 8 characters.'; return; }
        ps.disabled = true;
        api('password', { newPassword: np.value }).then(function (r) {
          ps.disabled = false;
          if (r.ok) { password = np.value; np.value = ''; pm.className = 'jts-ok'; pm.textContent = 'Saved. Use the new password next time.'; }
          else pm.textContent = 'Could not save that. Try again.';
        }).catch(function (x) { ps.disabled = false; if (!x || x.message !== 'auth') pm.textContent = 'Could not reach the counter.'; });
      });
      det.appendChild(f);
      box.appendChild(det);
    }, box);
  }

  /* ---- the panel itself */
  var TABS = [
    ['overview', 'Overview', tabOverview], ['sources', 'Sources', tabSources], ['audience', 'Audience', tabAudience],
    ['pages', 'Pages', tabPages], ['times', 'Times', tabTimes], ['features', 'Features', tabFeatures],
    ['accounts', 'Accounts', tabAccounts], ['errors', 'Errors', tabErrors], ['feedback', 'Feedback', tabFeedback], ['tools', 'Tools', tabTools]
  ];
  function badgeFor(id) {
    var total = 0;
    if (!st.summary) return 0;
    st.summary.sites.forEach(function (s) { total += id === 'errors' ? s.errors7 : id === 'feedback' ? s.feedbackNew : 0; });
    return total;
  }
  function showPanel() {
    var card = shell('Admin panel', true);
    var tabs = h('div', { class: 'jts-tabs', role: 'tablist' });
    TABS.forEach(function (t) {
      var b = h('button', { class: 'jts-tab', type: 'button', role: 'tab', 'data-tab': t[0], onclick: function () { st.tab = t[0]; renderTab(); } }, [t[1]]);
      var cnt = badgeFor(t[0]);
      if (cnt) b.appendChild(h('span', { class: 'jts-badge', text: String(cnt) }));
      tabs.appendChild(b);
    });
    card.appendChild(tabs);
    bodyEl = h('div');
    card.appendChild(bodyEl);
    cardEl = card;
    renderTab();
  }
  function renderTab() {
    var btns = cardEl.querySelectorAll('.jts-tab');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-tab') === st.tab;
      btns[i].setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) { try { var tb = btns[i].parentNode; tb.scrollLeft = btns[i].offsetLeft - (tb.clientWidth - btns[i].offsetWidth) / 2; } catch (e) {} }
    }
    bodyEl.textContent = '';
    cardEl.scrollTop = 0;
    for (var k = 0; k < TABS.length; k++) if (TABS[k][0] === st.tab) TABS[k][2](bodyEl);
  }

  /* ---------------------------------------- the invisible bottom-right corner */
  var taps = [];
  var downAt = 0;
  function inCorner(e) {
    return e.clientX >= window.innerWidth - CORNER && e.clientY >= window.innerHeight - CORNER;
  }
  window.addEventListener('pointerdown', function (e) {
    if (e.isPrimary === false) return;
    downAt = inCorner(e) ? Date.now() : 0;
    if (!downAt) taps = [];
  }, true);
  window.addEventListener('pointercancel', function () { downAt = 0; taps = []; }, true);
  window.addEventListener('pointerup', function (e) {
    if (e.isPrimary === false || !downAt) return;
    var now = Date.now();
    var quick = now - downAt < 600;   // a tap, not a long press such as holding a game pedal
    downAt = 0;
    if (!quick || !inCorner(e)) { taps = []; return; }
    taps = taps.filter(function (t) { return now - t < WITHIN; });
    taps.push(now);
    if (taps.length >= TAPS) { taps = []; setTimeout(open, 350); }
  }, true);

  /* ------------------------------------------------ visitor feedback box */
  var fbBack = null;
  function closeFeedback() {
    if (fbBack && fbBack.parentNode) fbBack.parentNode.removeChild(fbBack);
    fbBack = null;
    document.removeEventListener('keydown', onFbKey, true);
  }
  function onFbKey(e) { if (e.key === 'Escape') closeFeedback(); }

  function openFeedback() {
    if (fbBack) return;
    ensureStyle();
    var kind = 'idea', startedAt = Date.now();
    fbBack = h('div', { class: 'jts-back' });
    fbBack.addEventListener('click', function (e) { if (e.target === fbBack && Date.now() - startedAt > 400) closeFeedback(); });
    document.addEventListener('keydown', onFbKey, true);
    var card = h('div', { class: 'jts-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Send feedback' });
    card.appendChild(h('div', { class: 'jts-head' }, [h('h2', { text: 'Send feedback' }), h('button', { class: 'jts-x', type: 'button', 'aria-label': 'Close', text: '✕', onclick: closeFeedback })]));
    card.appendChild(h('p', { text: 'Got an idea, or something not working? Tell me. Please don\'t include passwords or private details.' }));
    var chips = h('div', { class: 'jts-chips' });
    var chipEls = {};
    ['idea', 'problem', 'other'].forEach(function (k) {
      chipEls[k] = h('button', { class: 'jts-chip', type: 'button', 'aria-pressed': k === kind ? 'true' : 'false', text: KINDS[k], onclick: function () {
        kind = k; for (var j in chipEls) chipEls[j].setAttribute('aria-pressed', j === k ? 'true' : 'false');
      } });
      chips.appendChild(chipEls[k]);
    });
    card.appendChild(chips);
    var msg = h('textarea', { class: 'jts-ta', maxlength: '1000', placeholder: 'Your message', 'aria-label': 'Your message' });
    var contact = h('input', { class: 'jts-in', type: 'text', maxlength: '120', placeholder: 'Email or name (optional)', 'aria-label': 'Contact (optional)', style: 'margin-top:10px' });
    var trap = h('input', { class: 'jts-hp', type: 'text', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', name: 'website' });
    var err = h('div', { class: 'jts-err', role: 'alert' });
    var send_ = h('button', { class: 'jts-btn', type: 'submit', text: 'Send' });
    var form = h('form', null, [msg, contact, h('div', { class: 'jts-note', text: 'Add an email or name only if you would like a reply.' }), trap, err, send_]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.textContent = '';
      if (msg.value.trim().length < 3) { err.textContent = 'Please write a few words first.'; return; }
      send_.disabled = true;
      post('feedback', { kind: kind, msg: msg.value, contact: contact.value, hp: trap.value, path: pagePath() }).then(function (r) {
        if (r.status === 200) {
          card.textContent = '';
          card.appendChild(h('div', { class: 'jts-head' }, [h('h2', { text: 'Thank you! 🙏' })]));
          card.appendChild(h('p', { text: 'Your note has been sent.' }));
          card.appendChild(h('button', { class: 'jts-btn', type: 'button', text: 'Close', onclick: closeFeedback }));
          return;
        }
        send_.disabled = false;
        err.textContent = r.error === 'too_many' ? 'You\'ve sent a few notes already. Please try again later.' : 'Sorry, that didn\'t send. Please try again.';
      }).catch(function () { send_.disabled = false; err.textContent = 'Couldn\'t reach the server. Check your internet and try again.'; });
    });
    card.appendChild(form);
    fbBack.appendChild(card);
    document.body.appendChild(fbBack);
    setTimeout(function () { try { msg.focus(); } catch (e) {} }, 50);
  }
  window.jtFeedback = openFeedback;

  /* ------------------------------ banner, maintenance screen, feedback link */
  var bannerEl = null, maintEl = null, ownerEl = null, lastConfig = 0, closedNow = {};
  function closedNowReset() { closedNow = {}; }
  function dropEl(el) { if (el && el.parentNode) el.parentNode.removeChild(el); return null; }

  function applyConfig(c) {
    lastConfig = Date.now();
    ensureStyle();
    var fbStyle = document.getElementById('jts-fb-style');
    if (c.feedback && !fbStyle) {
      fbStyle = h('style', { id: 'jts-fb-style' });
      fbStyle.textContent = '.jt-fb-link{display:inline-flex!important}section.jt-fb-link,div.jt-fb-link,p.jt-fb-link{display:block!important}';
      (document.head || document.documentElement).appendChild(fbStyle);
    } else if (!c.feedback && fbStyle) dropEl(fbStyle);

    if (bannerEl && (!c.banner || bannerEl.getAttribute('data-id') !== c.banner.id)) bannerEl = dropEl(bannerEl);
    // Closing the banner hides it for the rest of that visit; it shows again next visit. On the owner's own
    // device it comes back on every page load, so you can always see what visitors see.
    var isOwner = !!get('jt_owner');
    if (c.banner && !bannerEl && !closedNow[c.banner.id] && (isOwner || !get('jt_banner_' + c.banner.id, true))) {
      var id = c.banner.id;
      bannerEl = h('div', { class: 'jts-banner ' + (c.banner.style === 'warning' ? 'warning' : ''), role: 'status', 'data-id': id }, [
        h('span', { text: c.banner.text }),
        h('button', { type: 'button', 'aria-label': 'Close message', text: '✕', onclick: function () {
          closedNow[id] = true;
          if (!get('jt_owner')) set('jt_banner_' + id, '1', true);
          bannerEl = dropEl(bannerEl);
        } })
      ]);
      document.body.appendChild(bannerEl);
    }

    var m = c.maintenance;
    if (!m) { maintEl = dropEl(maintEl); ownerEl = dropEl(ownerEl); return; }
    if (get('jt_owner')) {
      maintEl = dropEl(maintEl);
      if (!ownerEl) {
        ownerEl = h('div', { class: 'jts-banner warning', role: 'status', style: 'z-index:2147482600' }, [
          h('span', { text: '🛠 Maintenance screen is ON for visitors. You can still use the site.' }),
          h('button', { type: 'button', 'aria-label': 'Close message', text: '✕', onclick: function () { ownerEl = dropEl(ownerEl); } })
        ]);
        document.body.appendChild(ownerEl);
      }
      return;
    }
    if (!maintEl) {
      maintEl = h('div', { class: 'jts-maint', role: 'alertdialog', 'aria-live': 'polite' }, [h('h2', { text: '🛠️ Back soon' }), h('p', { text: '' })]);
      document.body.appendChild(maintEl);
    }
    maintEl.lastChild.textContent = m.text || 'This site is being updated. Please check back in a little while.';
  }

  function fetchConfig() {
    try {
      // the owner's device skips the one-minute cache so changes show straight away
      fetch(API + 'config', get('jt_owner') ? { credentials: 'omit', cache: 'no-store' } : { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (c) { if (c && document.body) applyConfig(c); }).catch(noop);
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - lastConfig > 120000) fetchConfig();
  });

  window.__jtRefreshConfig = fetchConfig;
  function start() { track(); fetchConfig(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
