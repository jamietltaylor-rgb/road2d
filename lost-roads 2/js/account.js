// Sign-in, cloud saves and the leaderboard, using Supabase.
// Progress always saves on the device first; when you're signed in it's also copied
// to your account so you can carry on from any phone or computer.
window.Account = (() => {
  const CFG = window.SUPABASE_CONFIG || {};
  const URL_BASE = (CFG.url || '').replace(/\/+$/, '');
  const KEY = (window.LR_PREFIX || 'lostroads') + '.account';
  const configured = !!(URL_BASE && CFG.anonKey);
  // Supabase signs people in with an email address, so each username becomes a
  // stand-in address that's never emailed. Players only ever see their username.
  const EMAIL_DOMAIN = 'players.lost-roads.game';
  const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;

  let acct = LR.load(KEY, null);          // { access, refresh, expires, id, username }
  let refreshing = null;
  let lastPushed = '';
  let lastSaved = 0;
  let status = '';
  const listeners = [];
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
  const store = (a) => { acct = a; LR.save(KEY, a); };

  function notReady() {
    return new Error('Accounts aren’t switched on for this site yet. (Site owner: add your Supabase details to js/supabase-config.js.)');
  }

  function friendly(body, statusCode) {
    const msg = String((body && (body.msg || body.message || body.error_description || body.error)) || '');
    if (/invalid login credentials/i.test(msg)) return 'That username and password don’t match.';
    if (/already registered|already exists/i.test(msg)) return 'That username is taken. Try another one.';
    if (/database error saving new user/i.test(msg)) return 'That username is taken. Try another one.';
    if (/password/i.test(msg) && /(6|8|characters|weak|short)/i.test(msg)) return 'Pick a longer password (at least 8 characters).';
    if (/email.*confirm|not confirmed/i.test(msg)) return 'Your site’s Supabase project still has “Confirm email” switched on. Turn it off (see README).';
    if (/signups? not allowed|disabled/i.test(msg)) return 'New accounts are switched off in the Supabase project settings.';
    if (statusCode === 429 || /rate limit/i.test(msg)) return 'Too many tries. Wait a minute and try again.';
    return msg || 'Something went wrong. Please try again.';
  }

  async function authRequest(path, body, token) {
    if (!configured) throw notReady();
    let res;
    try {
      res = await fetch(`${URL_BASE}/auth/v1/${path}`, {
        method: 'POST',
        headers: Object.assign({ apikey: CFG.anonKey, 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}),
        body: JSON.stringify(body || {})
      });
    } catch (e) {
      throw new Error('Couldn’t reach the save server. Check your connection.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(friendly(data, res.status));
    return data;
  }

  function sessionFrom(data, username) {
    const s = data.session || data;
    if (!s || !s.access_token) throw new Error('Your Supabase project still has “Confirm email” switched on. Turn it off (see README).');
    const user = s.user || data.user || {};
    return {
      access: s.access_token,
      refresh: s.refresh_token,
      expires: Date.now() + (s.expires_in || 3600) * 1000,
      id: user.id,
      username: (user.user_metadata && user.user_metadata.username) || username
    };
  }

  async function token() {
    if (!acct) return null;
    if (Date.now() < acct.expires - 60000) return acct.access;
    if (!refreshing) {
      refreshing = authRequest('token?grant_type=refresh_token', { refresh_token: acct.refresh })
        .then((data) => { store(Object.assign({}, acct, sessionFrom(data, acct.username))); return acct.access; })
        .catch(() => { store(null); emit(); return null; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function rest(path, opts = {}) {
    if (!configured) throw notReady();
    const t = await token();
    const headers = Object.assign({ apikey: CFG.anonKey, 'content-type': 'application/json' }, opts.headers || {});
    if (t) headers.authorization = 'Bearer ' + t;
    let res;
    try {
      res = await fetch(`${URL_BASE}/rest/v1/${path}`, Object.assign({}, opts, { headers }));
    } catch (e) {
      throw new Error('Couldn’t reach the save server. Check your connection.');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 404 || (data && /relation|does not exist|schema cache/i.test(data.message || ''))) {
        throw new Error('The Supabase tables aren’t set up yet. (Site owner: run supabase-setup.sql, see README.)');
      }
      throw new Error(friendly(data, res.status));
    }
    return data;
  }

  // ---------------------------------------------------------------------------
  // Syncing
  // ---------------------------------------------------------------------------
  function collectLocal() {
    return {
      journey: LR.load(LR.KEYS.journey, null),
      stats: LR.load(LR.KEYS.stats, { metres: 0 }),
      settings: LR.load(LR.KEYS.settings, null)
    };
  }

  function applyLocal(d) {
    if (d.journey) LR.save(LR.KEYS.journey, d.journey);
    if (d.stats) LR.save(LR.KEYS.stats, d.stats);
    if (d.settings) LR.save(LR.KEYS.settings, d.settings);
  }

  async function fetchCards() {
    const rows = await rest(`cards?select=data&user_id=eq.${acct.id}&order=created_at.desc`);
    return (rows || []).map((r) => r.data);
  }

  async function syncCards() {
    const remote = await fetchCards();
    const have = new Set(remote.map((c) => String(c.id)));
    for (const c of LR.getCards()) {
      if (!have.has(String(c.id))) await pushCard(c);
    }
    const all = await fetchCards();
    if (!LR.saveCards(all)) LR.saveCards(all.slice(0, 30));
    return all;
  }

  // Returns true if the account's progress replaced this device's progress
  async function syncAfterSignIn() {
    const rows = await rest(`saves?select=data&user_id=eq.${acct.id}`);
    const remote = rows && rows[0] ? rows[0].data : null;
    const local = collectLocal();
    const remoteMetres = remote && remote.stats ? remote.stats.metres || 0 : -1;
    const localMetres = local.stats ? local.stats.metres || 0 : 0;
    let replaced = false;
    if (remote && remoteMetres >= localMetres) {
      applyLocal(remote);
      lastPushed = JSON.stringify(remote);
      replaced = true;
    } else {
      await pushSave(true);
    }
    await syncCards().catch(() => {});
    lastSaved = Date.now();
    return replaced;
  }

  async function enter(username, password, create) {
    username = String(username || '').trim();
    if (!USERNAME.test(username)) throw new Error('Usernames are 3 to 20 letters, numbers, - or _.');
    if (create && password.length < 8) throw new Error('Passwords need at least 8 characters.');
    const email = `${username.toLowerCase()}@${EMAIL_DOMAIN}`;
    const data = create
      ? await authRequest('signup', { email, password, data: { username } })
      : await authRequest('token?grant_type=password', { email, password });
    store(sessionFrom(data, username));
    emit();
    const replaced = await syncAfterSignIn();
    emit();
    return replaced;
  }

  async function signOut() {
    if (acct) {
      await pushSave(true).catch(() => {});
      authRequest('logout', {}, acct.access).catch(() => {});
    }
    store(null);
    lastPushed = '';
    emit();
  }

  async function pushSave(force) {
    if (!acct) return false;
    const data = collectLocal();
    const body = JSON.stringify(data);
    if (!force && body === lastPushed) return false;
    try {
      await rest('saves', {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: acct.id, data, updated_at: new Date().toISOString() })
      });
      lastPushed = body;
      lastSaved = Date.now();
      status = '';
    } catch (e) {
      status = e.message;
    }
    emit();
    return true;
  }

  // For when the page is closing: the browser finishes the request in the background
  function pushSaveOnExit() {
    if (!acct || Date.now() > acct.expires - 30000) return;
    const data = collectLocal();
    const body = JSON.stringify(data);
    if (body === lastPushed) return;
    try {
      fetch(`${URL_BASE}/rest/v1/saves`, {
        method: 'POST',
        keepalive: true,
        headers: {
          apikey: CFG.anonKey,
          authorization: 'Bearer ' + acct.access,
          'content-type': 'application/json',
          prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({ user_id: acct.id, data, updated_at: new Date().toISOString() })
      });
      lastPushed = body;
    } catch (e) { /* nothing more we can do */ }
  }

  async function pushCard(card) {
    if (!acct) return;
    try {
      await rest('cards', {
        method: 'POST',
        headers: { prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: acct.id, id: String(card.id), data: card })
      });
    } catch (e) { status = e.message; emit(); }
  }

  async function deleteCard(id) {
    if (!acct) return;
    try { await rest(`cards?user_id=eq.${acct.id}&id=eq.${encodeURIComponent(String(id))}`, { method: 'DELETE' }); } catch (e) { status = e.message; emit(); }
  }

  async function pullCards() {
    if (!acct) return null;
    try { return await syncCards(); } catch (e) { return null; }
  }

  // ---------------------------------------------------------------------------
  // Leaderboard
  // ---------------------------------------------------------------------------
  let lastBest = 0;
  async function submitBest(km) {
    if (!acct || !(km > lastBest + 0.05)) return;
    try {
      await rest('rpc/submit_best', { method: 'POST', body: JSON.stringify({ km: Math.round(km * 10) / 10 }) });
      lastBest = km;
    } catch (e) { /* try again next time */ }
  }

  async function leaderboard(limit = 50) {
    return (await rest(`profiles?select=username,best_km&best_km=gt.0&order=best_km.desc,updated_at.asc&limit=${limit}`)) || [];
  }

  return {
    configured,
    enter,
    signOut,
    pushSave,
    pushSaveOnExit,
    pushCard,
    deleteCard,
    pullCards,
    submitBest,
    leaderboard,
    onChange(fn) { listeners.push(fn); },
    get signedIn() { return !!acct; },
    get username() { return acct ? acct.username : ''; },
    get lastSaved() { return lastSaved; },
    get status() { return status; }
  };
})();
