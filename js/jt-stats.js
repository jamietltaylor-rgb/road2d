/* Jamie's visit counter and hidden admin panel.
   The SAME file is used by all four sites (Revise, Shared List, PackSmart, Lost Roads).

   1. Counting: once per visit it tells the counter (on roads2d.jamietaylor.org) that this site was
      opened, with a random anonymous id kept on the visitor's own device. No names, no email
      addresses, no IP numbers are stored.
   2. Admin panel: tap 5 times quickly in the very bottom-right corner of the screen (there is no
      button) and a password box appears. The right password shows the numbers for all four sites.
*/
(function () {
  if (window.__jtStats) return;
  window.__jtStats = 1;

  var API = window.__JT_STATS_API__ || 'https://roads2d.jamietaylor.org/api/stats/';
  var CORNER = 40;        // size of the invisible corner, in pixels
  var TAPS = 5;           // taps needed
  var WITHIN = 3000;      // ...inside this many milliseconds

  function get(key, session) {
    try { return (session ? sessionStorage : localStorage).getItem(key); } catch (e) { return null; }
  }
  function set(key, value, session) {
    try { (session ? sessionStorage : localStorage).setItem(key, value); return true; } catch (e) { return false; }
  }

  /* ---------------------------------------------------------------- counting */
  function newId() {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    var s = '';
    for (var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36);
    return s + Date.now().toString(36);
  }

  function track() {
    if (get('jt_skip')) return;            // this device was switched off in the admin panel
    if (get('jt_seen', true)) return;      // already counted during this visit
    var vid = get('jt_vid');
    if (!vid || !/^[a-z0-9]{12,40}$/.test(vid)) {
      vid = newId();
      if (!set('jt_vid', vid)) return;     // can't remember a visitor id here, so don't guess
    }
    set('jt_seen', '1', true);
    try {
      fetch(API + 'hit', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ vid: vid, path: location.pathname }),
        keepalive: true,
        credentials: 'omit'
      }).catch(function () {});
    } catch (e) { /* counting must never break the app */ }
  }

  /* ----------------------------------------------------------------- panel */
  var SITES = {
    revise: { name: 'Revise', icon: '📝', color: '#6366f1' },
    sharedlist: { name: 'Shared List', icon: '🛒', color: '#10b981' },
    packsmart: { name: 'PackSmart', icon: '🧳', color: '#f97316' },
    roads2d: { name: 'Lost Roads 2D', icon: '🚗', color: '#ef4444' }
  };
  var CSS =
    '.jts-back{position:fixed;inset:0;z-index:2147483600;background:rgba(10,12,20,.6);display:flex;align-items:center;justify-content:center;padding:16px;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent}' +
    '.jts-card{background:#fff;color:#1b1f2a;border-radius:18px;width:100%;max-width:520px;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.35);padding:20px;box-sizing:border-box}' +
    '.jts-card *{box-sizing:border-box;font-family:inherit}' +
    '.jts-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}' +
    '.jts-head h2{margin:0;font-size:20px;font-weight:700;color:#1b1f2a}' +
    '.jts-x{border:0;background:#eef0f4;color:#1b1f2a;width:34px;height:34px;border-radius:50%;font-size:18px;line-height:1;cursor:pointer}' +
    '.jts-card p{margin:0 0 12px;color:#4b5263}' +
    '.jts-in{width:100%;padding:12px 14px;border:1.5px solid #c9cedb;border-radius:12px;font-size:16px;background:#fff;color:#1b1f2a}' +
    '.jts-btn{display:inline-block;margin-top:10px;padding:12px 18px;border:0;border-radius:12px;background:#1b1f2a;color:#fff;font-size:16px;font-weight:600;cursor:pointer}' +
    '.jts-btn:disabled{opacity:.55}' +
    '.jts-btn.alt{background:#eef0f4;color:#1b1f2a}' +
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
    '.jts-row input{width:18px;height:18px}';

  var back = null;
  var openedAt = 0;
  var password = '';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function close() {
    password = '';
    if (back && back.parentNode) back.parentNode.removeChild(back);
    back = null;
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open() {
    if (back) return;
    if (!document.getElementById('jts-style')) {
      var st = el('style'); st.id = 'jts-style'; st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    back = el('div', 'jts-back');
    openedAt = Date.now();
    // ignore the "ghost" click that follows the last tap, so the box doesn't close straight away
    back.addEventListener('click', function (e) { if (e.target === back && Date.now() - openedAt > 700) close(); });
    document.addEventListener('keydown', onKey, true);
    showLogin();
    document.body.appendChild(back);
  }

  function shell(title) {
    back.textContent = '';
    var card = el('div', 'jts-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', title);
    var head = el('div', 'jts-head');
    head.appendChild(el('h2', '', title));
    var x = el('button', 'jts-x', '✕');
    x.type = 'button'; x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', close);
    head.appendChild(x);
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

  function showLogin(message) {
    var card = shell('Admin');
    card.appendChild(el('p', '', 'Enter the admin password.'));
    var form = el('form');
    var input = el('input', 'jts-in');
    input.type = 'password'; input.name = 'password'; input.autocomplete = 'current-password';
    input.placeholder = 'Password'; input.setAttribute('aria-label', 'Admin password');
    var err = el('div', 'jts-err', message || '');
    err.setAttribute('role', 'alert');
    var go = el('button', 'jts-btn', 'Open'); go.type = 'submit';
    form.appendChild(input); form.appendChild(err); form.appendChild(go);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!input.value) return;
      go.disabled = true; err.textContent = '';
      load(input.value, err, go);
    });
    card.appendChild(form);
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
  }

  function load(pw, err, btn) {
    post('summary', { password: pw }).then(function (res) {
      if (res.status === 200 && res.sites) { password = pw; showStats(res); return; }
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

  function fmtDay(d) {
    if (!d) return '—';
    var p = d.split('-');
    var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return parseInt(p[2], 10) + ' ' + m[parseInt(p[1], 10) - 1];
  }
  function n(v) { return (v || 0).toLocaleString(); }
  function plural(v, one, many) { return n(v) + ' ' + (v === 1 ? one : many); }

  function stat(label, people, visits) {
    var d = el('div');
    d.appendChild(el('b', '', n(people)));
    d.appendChild(el('span', '', label));
    if (visits != null) { var v = el('span', '', plural(visits, 'visit', 'visits')); v.style.display = 'block'; d.appendChild(v); }
    return d;
  }

  function siteCard(s) {
    var meta = SITES[s.id] || { name: s.id, icon: '🌐', color: '#555' };
    var box = el('div', 'jts-site');
    box.style.borderLeftColor = meta.color;
    var top = el('div', 'jts-top');
    top.appendChild(el('b', '', meta.icon + ' ' + meta.name));
    top.appendChild(el('span', 'jts-since', s.since ? 'counting since ' + fmtDay(s.since) : 'no visits yet'));
    box.appendChild(top);

    var big = el('div', 'jts-big');
    var a = el('div'); a.appendChild(el('span', 'jts-num', n(s.people))); a.appendChild(el('span', 'jts-lbl', 'different people'));
    var b = el('div'); b.appendChild(el('span', 'jts-num', n(s.visits))); b.appendChild(el('span', 'jts-lbl', 'visits in total'));
    big.appendChild(a); big.appendChild(b);
    box.appendChild(big);

    var grid = el('div', 'jts-grid');
    grid.appendChild(stat('today', s.today.people, s.today.visits));
    grid.appendChild(stat('last 7 days', s.days7.people, s.days7.visits));
    grid.appendChild(stat('last 30 days', s.days30.people, s.days30.visits));
    box.appendChild(grid);

    box.appendChild(el('div', 'jts-line', 'New in the last 7 days: ' + n(s.new7) + '  ·  Came back on another day: ' + n(s.cameBack)));

    var bars = el('div', 'jts-bars');
    bars.style.color = meta.color;
    var max = 1, i;
    for (i = 0; i < s.daily.length; i++) if (s.daily[i].people > max) max = s.daily[i].people;
    for (i = 0; i < s.daily.length; i++) {
      var bar = el('i');
      bar.style.height = Math.max(4, Math.round((s.daily[i].people / max) * 100)) + '%';
      bar.title = fmtDay(s.daily[i].day) + ': ' + plural(s.daily[i].people, 'person', 'people') + ', ' + plural(s.daily[i].visits, 'visit', 'visits');
      if (!s.daily[i].people) bar.style.opacity = '.25';
      bars.appendChild(bar);
    }
    box.appendChild(bars);
    var axis = el('div', 'jts-axis');
    axis.appendChild(el('span', '', fmtDay(s.daily[0].day)));
    axis.appendChild(el('span', '', 'different people each day'));
    axis.appendChild(el('span', '', 'today'));
    box.appendChild(axis);
    return box;
  }

  function showStats(res) {
    var card = shell('Visitors');
    var people = 0, visits = 0;
    res.sites.forEach(function (s) { people += s.people; visits += s.visits; });

    var all = el('div', 'jts-all');
    var big = el('div', 'jts-big'); big.style.margin = '0';
    var a = el('div'); a.appendChild(el('span', 'jts-num', n(people))); a.appendChild(el('span', 'jts-lbl', 'people across all four sites'));
    var b = el('div'); b.appendChild(el('span', 'jts-num', n(visits))); b.appendChild(el('span', 'jts-lbl', 'visits in total'));
    big.appendChild(a); big.appendChild(b); all.appendChild(big);
    card.appendChild(all);

    res.sites.forEach(function (s) { card.appendChild(siteCard(s)); });

    card.appendChild(el('p', 'jts-note',
      'A "person" is one browser on one device, counted without any name or email. Someone using two apps counts once in each app, and one person on two devices counts twice. Your own visits count too unless you switch this device off below. Robots are left out.'));

    var refresh = el('button', 'jts-btn alt', 'Refresh'); refresh.type = 'button';
    refresh.addEventListener('click', function () { refresh.disabled = true; load(password, null, null); });
    card.appendChild(refresh);

    var row = el('label', 'jts-row');
    var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!get('jt_skip');
    cb.addEventListener('change', function () {
      try { if (cb.checked) localStorage.setItem('jt_skip', '1'); else localStorage.removeItem('jt_skip'); } catch (e) {}
    });
    row.appendChild(cb);
    row.appendChild(document.createTextNode("Don't count visits from this device on this site"));
    card.appendChild(row);

    var det = el('details');
    det.appendChild(el('summary', '', 'Change the admin password'));
    var f = el('form'); f.style.marginTop = '10px';
    var np = el('input', 'jts-in');
    np.type = 'password'; np.autocomplete = 'new-password'; np.placeholder = 'New password (8 or more characters)';
    np.setAttribute('aria-label', 'New admin password');
    var msg = el('div', 'jts-err');
    var save = el('button', 'jts-btn', 'Save new password'); save.type = 'submit';
    f.appendChild(np); f.appendChild(msg); f.appendChild(save);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      msg.className = 'jts-err'; msg.textContent = '';
      if (np.value.length < 8) { msg.textContent = 'Use at least 8 characters.'; return; }
      save.disabled = true;
      post('password', { password: password, newPassword: np.value }).then(function (r) {
        save.disabled = false;
        if (r.ok) { password = np.value; np.value = ''; msg.className = 'jts-ok'; msg.textContent = 'Saved. Use the new password next time.'; }
        else msg.textContent = 'Could not save that. Try again.';
      }).catch(function () { save.disabled = false; msg.textContent = 'Could not reach the counter.'; });
    });
    det.appendChild(f);
    card.appendChild(det);
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', track);
  else track();
})();
