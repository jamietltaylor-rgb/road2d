// Linking a Spotify account (Premium) so the car screen can browse and play your music.
// Uses Spotify's sign-in with PKCE, which is safe in the browser because there's no secret.
// Music plays through Spotify's Web Playback SDK inside the game, or, if that isn't
// available on this device, on whichever Spotify app you have open (phone, computer, speaker).
window.SpotifyAccount = (() => {
  const CLIENT_ID = ((window.SPOTIFY_CONFIG || {}).clientId || '').trim();
  const KEY = (window.LR_PREFIX || 'lostroads') + '.spotifyAuth';
  const SCOPES = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-library-read'
  ].join(' ');

  let auth = LR.load(KEY, null);          // { access, refresh, expires }
  let refreshing = null;
  let player = null;
  let deviceId = null;
  let sdkProblem = '';
  let profile = null;
  let playback = null;                     // last known playback state
  const listeners = [];
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });

  const redirectUri = () => new URL('./', location.href).href;
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randomString = (n) => b64url(crypto.getRandomValues(new Uint8Array(n))).slice(0, n);

  function saveAuth(a) { auth = a; LR.save(KEY, a); emit(); }

  // ---------------------------------------------------------------------------
  // Sign in
  // ---------------------------------------------------------------------------
  async function connect() {
    if (!CLIENT_ID) throw new Error('Spotify sign-in isn’t set up on this site yet.');
    if (!window.crypto || !crypto.subtle) throw new Error('Spotify sign-in needs the site to be on https.');
    const verifier = randomString(64);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = randomString(16);
    sessionStorage.setItem(KEY + '.verifier', verifier);
    sessionStorage.setItem(KEY + '.state', state);
    const q = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri(),
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: SCOPES,
      state
    });
    location.assign('https://accounts.spotify.com/authorize?' + q);
  }

  async function tokenRequest(params) {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(Object.assign({ client_id: CLIENT_ID }, params))
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error_description || 'Spotify didn’t accept the sign-in.');
    return body;
  }

  // Called when the page loads: finishes signing in if we've just come back from Spotify
  async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return null;
    const expected = sessionStorage.getItem(KEY + '.state');
    if (!expected || q.get('state') !== expected) return null;
    const clean = () => {
      q.delete('code'); q.delete('state'); q.delete('error');
      const rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
    };
    if (q.has('error')) { clean(); return 'denied'; }
    try {
      const t = await tokenRequest({
        grant_type: 'authorization_code',
        code: q.get('code'),
        redirect_uri: redirectUri(),
        code_verifier: sessionStorage.getItem(KEY + '.verifier') || ''
      });
      saveAuth({ access: t.access_token, refresh: t.refresh_token, expires: Date.now() + t.expires_in * 1000 });
      clean();
      return 'connected';
    } catch (e) {
      clean();
      return 'failed';
    } finally {
      sessionStorage.removeItem(KEY + '.state');
      sessionStorage.removeItem(KEY + '.verifier');
    }
  }

  async function token() {
    if (!auth) return null;
    if (Date.now() < auth.expires - 60000) return auth.access;
    if (!refreshing) {
      refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refresh })
        .then((t) => {
          saveAuth({ access: t.access_token, refresh: t.refresh_token || auth.refresh, expires: Date.now() + t.expires_in * 1000 });
          return auth.access;
        })
        .catch(() => { disconnect(); return null; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  function disconnect() {
    if (player) { try { player.disconnect(); } catch (e) { /* ignore */ } }
    player = null;
    deviceId = null;
    profile = null;
    playback = null;
    saveAuth(null);
  }

  // ---------------------------------------------------------------------------
  // Web API
  // ---------------------------------------------------------------------------
  class SpotifyError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

  async function api(path, opts = {}, retry = true) {
    const t = await token();
    if (!t) throw new SpotifyError('Connect Spotify first.', 'signed-out');
    const headers = { authorization: 'Bearer ' + t };
    if (opts.body) headers['content-type'] = 'application/json';
    const res = await fetch('https://api.spotify.com/v1' + path, Object.assign({}, opts, { headers }));
    if (res.status === 204 || res.status === 202) return null;
    const body = await res.json().catch(() => null);
    if (res.status === 401 && retry) { auth.expires = 0; return api(path, opts, false); }
    if (res.status === 429 && retry) {
      await new Promise((r) => setTimeout(r, (parseInt(res.headers.get('retry-after') || '2', 10)) * 1000));
      return api(path, opts, false);
    }
    if (!res.ok) {
      const msg = (body && body.error && (body.error.message || body.error)) || '';
      const reason = body && body.error && body.error.reason;
      if (res.status === 403 && /premium/i.test(msg + reason)) throw new SpotifyError('Playing music needs Spotify Premium.', 'premium');
      if (res.status === 403) throw new SpotifyError('Spotify says this account isn’t allowed to use this site yet. The site owner needs to add you in their Spotify developer settings.', 'forbidden');
      if (res.status === 404 && /device/i.test(msg + reason)) throw new SpotifyError('No Spotify player is available. Open Spotify on your phone or computer, then try again.', 'no-device');
      throw new SpotifyError(msg || 'Spotify had a problem. Try again in a moment.', 'other');
    }
    return body;
  }

  async function me() {
    if (!profile) profile = await api('/me');
    return profile;
  }

  // ---------------------------------------------------------------------------
  // The in-game player
  // ---------------------------------------------------------------------------
  function startSdk() {
    if (player || !auth) return;
    const go = () => {
      player = new window.Spotify.Player({
        name: 'Lost Roads car radio',
        getOAuthToken: (cb) => { token().then((t) => t && cb(t)); },
        volume: 0.7
      });
      player.addListener('ready', ({ device_id }) => { deviceId = device_id; sdkProblem = ''; emit(); });
      player.addListener('not_ready', () => { deviceId = null; emit(); });
      player.addListener('initialization_error', () => { sdkProblem = 'This browser can’t play Spotify inside the game, so music will play on your Spotify app instead.'; emit(); });
      player.addListener('authentication_error', () => { sdkProblem = 'Spotify needs you to connect again.'; emit(); });
      player.addListener('account_error', () => { sdkProblem = 'Playing music needs Spotify Premium.'; emit(); });
      player.addListener('player_state_changed', () => { refresh(); });
      player.connect();
      setTimeout(() => {
        if (!deviceId && !sdkProblem) { sdkProblem = 'Spotify’s in-game player didn’t start, so music will play on your Spotify app instead.'; emit(); }
      }, 9000);
    };
    if (window.Spotify && window.Spotify.Player) { go(); return; }
    window.onSpotifyWebPlaybackSDKReady = go;
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    s.onerror = () => { sdkProblem = 'Couldn’t load Spotify’s player.'; emit(); };
    document.head.appendChild(s);
  }

  // Must be called from a tap or click so phones allow sound
  function unlockAudio() {
    if (player && player.activateElement) { try { player.activateElement(); } catch (e) { /* ignore */ } }
  }

  async function targetDevice() {
    if (deviceId) return deviceId;
    const r = await api('/me/player/devices');
    const list = (r && r.devices) || [];
    const d = list.find((x) => x.is_active) || list[0];
    if (!d) throw new SpotifyError('No Spotify player is available. Open Spotify on your phone or computer, then try again.', 'no-device');
    return d.id;
  }

  async function playContext(uri, offsetUri) {
    const id = await targetDevice();
    const body = { context_uri: uri };
    if (offsetUri) body.offset = { uri: offsetUri };
    await api('/me/player/play?device_id=' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(body) });
    setTimeout(refresh, 700);
  }

  async function playTracks(uris, index = 0) {
    const id = await targetDevice();
    await api('/me/player/play?device_id=' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ uris, offset: { position: index } }) });
    setTimeout(refresh, 700);
  }

  async function control(action) {
    const id = playback && playback.device ? playback.device.id : await targetDevice();
    const q = '?device_id=' + encodeURIComponent(id);
    if (action === 'pause') await api('/me/player/pause' + q, { method: 'PUT' });
    if (action === 'resume') await api('/me/player/play' + q, { method: 'PUT' });
    if (action === 'next') await api('/me/player/next' + q, { method: 'POST' });
    if (action === 'previous') await api('/me/player/previous' + q, { method: 'POST' });
    setTimeout(refresh, 500);
  }

  async function setVolume(pct) {
    if (deviceId && player && (!playback || !playback.device || playback.device.id === deviceId)) {
      player.setVolume(pct / 100);
      return;
    }
    const id = playback && playback.device ? playback.device.id : await targetDevice();
    await api(`/me/player/volume?volume_percent=${Math.round(pct)}&device_id=${encodeURIComponent(id)}`, { method: 'PUT' });
  }

  async function refresh() {
    if (!auth) return null;
    try {
      playback = await api('/me/player');
    } catch (e) {
      playback = null;
    }
    emit();
    return playback;
  }

  async function pause() { if (playback && playback.is_playing) await control('pause').catch(() => {}); }
  async function resume() {
    if (playback && playback.item && !playback.is_playing) await control('resume').catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Library
  // ---------------------------------------------------------------------------
  async function playlists() {
    const r = await api('/me/playlists?limit=50');
    return ((r && r.items) || []).filter(Boolean);
  }
  async function liked() {
    const r = await api('/me/tracks?limit=50');
    return ((r && r.items) || []).map((x) => x.track).filter(Boolean);
  }
  async function search(q) {
    const r = await api('/search?type=track,playlist,album&limit=10&q=' + encodeURIComponent(q));
    return {
      tracks: (r && r.tracks && r.tracks.items || []).filter(Boolean),
      playlists: (r && r.playlists && r.playlists.items || []).filter(Boolean),
      albums: (r && r.albums && r.albums.items || []).filter(Boolean)
    };
  }

  return {
    configured: !!CLIENT_ID,
    redirectUri,
    connect,
    handleRedirect,
    disconnect,
    startSdk,
    unlockAudio,
    me,
    refresh,
    playContext,
    playTracks,
    control,
    setVolume,
    pause,
    resume,
    playlists,
    liked,
    search,
    onChange(fn) { listeners.push(fn); },
    get connected() { return !!auth; },
    get playback() { return playback; },
    get inGameDevice() { return deviceId; },
    get problem() { return sdkProblem; }
  };
})();
