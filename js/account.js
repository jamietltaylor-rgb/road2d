// Sign-in, cloud saves and the leaderboard. These talk to worker.js, which runs on
// Cloudflare alongside the game's files and keeps everything in Cloudflare's storage.
// Progress always saves on the device first; when you're signed in it's also copied
// to your account so you can carry on from any phone or computer.
window.Account = (() => {
  const KEY = (window.LR_PREFIX || 'lostroads') + '.account';
  const configured = location.protocol !== 'file:';
  // No email addresses: usernames and scrambled passwords live in Cloudflare's
  // storage (see worker.js). Signing in gives this device a token.
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
    return new Error('Accounts aren’t switched on for this site yet. (Site owner: deploy it as a Cloudflare Worker, see README.)');
  }

  const MESSAGES = {
    bad_username: 'Usernames are 3 to 20 letters, numbers, - or _.',
    short_password: 'Passwords need at least 8 characters.',
    username_taken: 'That username is taken. Try another one.',
    name_not_allowed: 'That username isn’t allowed. Please pick a different one.',
    wrong_login: 'That username and password don’t match.',
    too_many_tries: 'Too many wrong passwords. Wait 10 minutes and try again.',
    too_many_cards: 'Your postcard album online is full (200 postcards).',
    signed_out: 'You’ve been signed out. Sign in again.'
  };

  function friendly(body, statusCode) {
    const msg = String((body && (body.message || body.msg || body.error)) || '');
    for (const k in MESSAGES) if (msg.includes(k)) return MESSAGES[k];
    if (statusCode === 404 || statusCode === 405) {
      return 'Accounts aren’t switched on for this site yet. (Site owner: deploy it as a Cloudflare Worker with worker.js, see README.)';
    }
    if (statusCode === 429 || /rate limit/i.test(msg)) return 'Too many tries. Wait a minute and try again.';
    return msg || 'Something went wrong. Please try again.';
  }

  // Calls the game's server (worker.js) at /api/<action>
  async function api(action, args, keepalive) {
    if (!configured) throw notReady();
    let res;
    try {
      res = await fetch(`api/${action}`, {
        method: 'POST',
        keepalive: !!keepalive,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args || {})
      });
    } catch (e) {
      throw new Error('Couldn’t reach the save server. Check your connection.');
    }
    const isJson = (res.headers.get('content-type') || '').includes('json');
    const data = isJson ? await res.json().catch(() => null) : null;
    if (!isJson) throw new Error(friendly(null, 404));   // no server here, just the static files
    if (!res.ok || (data && data.error)) {
      const code = data && data.error;
      if (code === 'signed_out') { store(null); emit(); }
      throw new Error(MESSAGES[code] || friendly(data, res.status));
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
    return ((await api('getCards', { token: acct.token })) || {}).cards || [];
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
    const remote = ((await api('getSave', { token: acct.token })) || {}).data || null;
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
    const data = await api(create ? 'signup' : 'signin', { username, password });
    store({ token: data.token, username: data.username || username });
    emit();
    const replaced = await syncAfterSignIn();
    emit();
    return replaced;
  }

  async function signOut() {
    if (acct) {
      await pushSave(true).catch(() => {});
      api('signout', { token: acct.token }).catch(() => {});
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
      await api('putSave', { token: acct.token, data });
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
    api('putSave', { token: acct.token, data }, true).catch(() => {});
    lastPushed = body;
  }

  async function pushCard(card) {
    if (!acct) return;
    try {
      await api('putCard', { token: acct.token, id: String(card.id), data: card });
    } catch (e) { status = e.message; emit(); }
  }

  async function deleteCard(id) {
    if (!acct) return;
    try { await api('deleteCard', { token: acct.token, id: String(id) }); } catch (e) { status = e.message; emit(); }
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
      await api('submitBest', { token: acct.token, km: Math.round(km * 10) / 10 });
      lastBest = km;
    } catch (e) { /* try again next time */ }
  }

  async function leaderboard(limit = 50) {
    return ((await api('leaderboard', { limit })) || {}).rows || [];
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
