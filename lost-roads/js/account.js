// Sign-in and cloud saves. Progress always saves on the device first; when you're
// signed in it's also copied to your account so you can carry on anywhere.
window.Account = (() => {
  const KEY = (window.LR_PREFIX || 'lostroads') + '.account';
  let acct = LR.load(KEY, null);         // { token, username }
  let lastPushed = '';
  let lastSaved = 0;
  let status = '';
  const listeners = [];

  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });

  async function api(path, opts = {}) {
    const headers = { 'content-type': 'application/json' };
    if (acct) headers.authorization = 'Bearer ' + acct.token;
    let res;
    try {
      res = await fetch('/api' + path, Object.assign({}, opts, { headers }));
    } catch (e) {
      throw new Error('Couldn’t reach the save server. Check your connection.');
    }
    let body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    if (res.status === 401 && acct && path !== '/login') {
      acct = null;
      LR.save(KEY, null);
      emit();
    }
    if (!res.ok) {
      if (!body && (res.status === 404 || res.status === 405)) throw new Error('Accounts aren’t switched on for this site yet.');
      throw new Error((body && body.error) || 'Something went wrong. Please try again.');
    }
    return body;
  }

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

  // Upload any postcards this device has that the account doesn't, then download the full album
  async function syncCards() {
    const remote = await api('/cards');
    const have = new Set(remote.cards.map((c) => String(c.id)));
    for (const c of LR.getCards()) {
      if (!have.has(String(c.id))) await api('/cards', { method: 'POST', body: JSON.stringify(c) }).catch(() => {});
    }
    const all = await api('/cards');
    if (!LR.saveCards(all.cards)) LR.saveCards(all.cards.slice(0, 30));
    return all.cards;
  }

  // Returns true if the account's progress replaced this device's progress
  async function syncAfterSignIn() {
    const remote = await api('/save');
    const local = collectLocal();
    const remoteMetres = remote.data && remote.data.stats ? remote.data.stats.metres || 0 : -1;
    const localMetres = local.stats ? local.stats.metres || 0 : 0;
    let replaced = false;
    if (remote.data && remoteMetres >= localMetres) {
      applyLocal(remote.data);
      lastPushed = JSON.stringify(remote.data);
      replaced = true;
    } else {
      await pushSave(true);
    }
    await syncCards().catch(() => {});
    lastSaved = Date.now();
    return replaced;
  }

  async function enter(username, password, create) {
    const r = await api(create ? '/signup' : '/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    acct = { token: r.token, username: r.username };
    LR.save(KEY, acct);
    emit();
    const replaced = await syncAfterSignIn();
    emit();
    return replaced;
  }

  async function signOut() {
    const was = acct;
    if (was) await pushSave(true).catch(() => {});
    if (was) api('/logout', { method: 'POST' }).catch(() => {});
    acct = null;
    LR.save(KEY, null);
    lastPushed = '';
    emit();
  }

  async function pushSave(force) {
    if (!acct) return false;
    const body = JSON.stringify(collectLocal());
    if (!force && body === lastPushed) return false;
    try {
      await api('/save', { method: 'PUT', body });
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
    const body = JSON.stringify(collectLocal());
    if (body === lastPushed) return;
    try {
      fetch('/api/save', {
        method: 'PUT',
        keepalive: true,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + acct.token },
        body
      });
      lastPushed = body;
    } catch (e) { /* nothing more we can do */ }
  }

  async function pushCard(card) {
    if (!acct) return;
    try { await api('/cards', { method: 'POST', body: JSON.stringify(card) }); } catch (e) { status = e.message; emit(); }
  }

  async function deleteCard(id) {
    if (!acct) return;
    try { await api('/cards/' + encodeURIComponent(String(id)), { method: 'DELETE' }); } catch (e) { status = e.message; emit(); }
  }

  async function pullCards() {
    if (!acct) return null;
    try { return await syncCards(); } catch (e) { return null; }
  }

  // Check the saved session is still valid when the page opens
  if (acct) api('/me').catch(() => {});

  return {
    enter,
    signOut,
    pushSave,
    pushSaveOnExit,
    pushCard,
    deleteCard,
    pullCards,
    onChange(fn) { listeners.push(fn); },
    get signedIn() { return !!acct; },
    get username() { return acct ? acct.username : ''; },
    get lastSaved() { return lastSaved; },
    get status() { return status; }
  };
})();
