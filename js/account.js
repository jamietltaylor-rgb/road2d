// Sign-in, cloud saves and the leaderboard, using Supabase.
// Progress always saves on the device first; when you're signed in it's also copied
// to your account so you can carry on from any phone or computer.
window.Account = (() => {
  const CFG = window.SUPABASE_CONFIG || {};
  const URL_BASE = (CFG.url || '').replace(/\/+$/, '');
  const KEY = (window.LR_PREFIX || 'lostroads') + '.account';
  const configured = !!(URL_BASE && CFG.anonKey);
  // No email addresses: the game keeps its own usernames and passwords in your
  // Supabase database (see supabase-setup.sql). Signing in gives this device a token.
  const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;

  let acct = LR.load(KEY, null);          // { token, username }
  if (acct && !acct.token) acct = null;   // an old-style sign-in from before; sign in again
  let lastPushed = '';
  let lastSaved = 0;
  let status = '';
  const listeners = [];
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
  const store = (a) => { acct = a; LR.save(KEY, a); };

  function notReady() {
    return new Error('Accounts aren’t switched on for this site yet. (Site owner: add your Supabase details to js/supabase-config.js.)');
  }

  const MESSAGES = {
    bad_username: 'Usernames are 3 to 20 letters, numbers, - or _.',
    short_password: 'Passwords need at least 8 characters.',
    username_taken: 'That username is taken. Try another one.',
    wrong_login: 'That username and password don’t match.',
    too_many_tries: 'Too many wrong passwords. Wait 10 minutes and try again.',
    too_many_cards: 'Your postcard album online is full (200 postcards).',
    signed_out: 'You’ve been signed out. Sign in again.'
  };

  function friendly(body, statusCode) {
    const msg = String((body && (body.message || body.msg || body.error)) || '');
    for (const k in MESSAGES) if (msg.includes(k)) return MESSAGES[k];
    if (statusCode === 404 || /could not find the function|schema cache|does not exist/i.test(msg)) {
      return 'The Supabase database isn’t set up yet. (Site owner: run the new supabase-setup.sql, see README.)';
    }
    if (statusCode === 429 || /rate limit/i.test(msg)) return 'Too many tries. Wait a minute and try again.';
    return msg || 'Something went wrong. Please try again.';
  }

  // Calls one of the lr_ functions in supabase-setup.sql
  async function rpc(name, args, keepalive) {
    if (!configured) throw notReady();
    let res;
    try {
      res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
        method: 'POST',
        keepalive: !!keepalive,
        headers: { apikey: CFG.anonKey, 'content-type': 'application/json' },
        body: JSON.stringify(args || {})
      });
    } catch (e) {
      throw new Error('Couldn’t reach the save server. Check your connection.');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(friendly(data, res.status));
      if (data && String(data.message || '').includes('signed_out')) { store(null); emit(); }
      throw err;
    }
    if (data && data.error) throw new Error(MESSAGES[data.error] || data.error);
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
    return (await rpc('lr_get_cards', { p_token: acct.token })) || [];
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
    const remote = await rpc('lr_get_save', { p_token: acct.token });
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
    const data = await rpc(create ? 'lr_sign_up' : 'lr_sign_in', { p_username: username, p_password: password });
    store({ token: data.token, username: data.username || username });
    emit();
    const replaced = await syncAfterSignIn();
    emit();
    return replaced;
  }

  async function signOut() {
    if (acct) {
      await pushSave(true).catch(() => {});
      rpc('lr_sign_out', { p_token: acct.token }).catch(() => {});
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
      await rpc('lr_put_save', { p_token: acct.token, p_data: data });
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
    if (!acct) return;
    const data = collectLocal();
    const body = JSON.stringify(data);
    if (body === lastPushed) return;
    rpc('lr_put_save', { p_token: acct.token, p_data: data }, true).catch(() => {});
    lastPushed = body;
  }

  async function pushCard(card) {
    if (!acct) return;
    try {
      await rpc('lr_put_card', { p_token: acct.token, p_id: String(card.id), p_data: card });
    } catch (e) { status = e.message; emit(); }
  }

  async function deleteCard(id) {
    if (!acct) return;
    try { await rpc('lr_delete_card', { p_token: acct.token, p_id: String(id) }); } catch (e) { status = e.message; emit(); }
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
      await rpc('lr_submit_best', { p_token: acct.token, p_km: Math.round(km * 10) / 10 });
      lastBest = km;
    } catch (e) { /* try again next time */ }
  }

  async function leaderboard(limit = 50) {
    return (await rpc('lr_leaderboard', { p_limit: limit })) || [];
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
