// The car's touchscreen: browse and play your Spotify while you drive.
window.CarScreen = (() => {
  const $ = (id) => document.getElementById(id);
  const el = $('carScreen');
  const S = window.SpotifyAccount;
  let hooks = { getClock: () => '', beforeLeave: () => {}, onPlay: () => {} };
  let view = 'now';
  let pollTimer = 0;
  let loaded = {};
  let volumeTimer = 0;

  const ICON = {
    note: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    prev: '<path d="M6 5v14M19 5l-10 7 10 7z" fill="currentColor"/>',
    next: '<path d="M18 5v14M5 5l10 7-10 7z" fill="currentColor"/>',
    play: '<path d="M7 4.5l13 7.5-13 7.5z" fill="currentColor"/>',
    pause: '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor"/>',
    vol: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6"/>'
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const art = (images, size) => {
    if (!images || !images.length) return '';
    const pick = images.slice().sort((a, b) => Math.abs((a.width || 300) - size) - Math.abs((b.width || 300) - size))[0];
    return pick ? pick.url : '';
  };
  const time = (ms) => { const s = Math.floor((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // ---------------------------------------------------------------------------
  // Building the screen
  // ---------------------------------------------------------------------------
  el.innerHTML = `
    <div class="cs-frame" role="dialog" aria-label="Car screen">
      <nav class="cs-rail">
        <button type="button" data-view="now" aria-label="Now playing">${icon('note')}</button>
        <button type="button" data-view="playlists" aria-label="Playlists">${icon('list')}</button>
        <button type="button" data-view="liked" aria-label="Liked songs">${icon('heart')}</button>
        <button type="button" data-view="search" aria-label="Search">${icon('search')}</button>
        <span class="cs-clock" id="csClock"></span>
        <button type="button" class="cs-close" id="csClose" aria-label="Close the car screen">${icon('close')}</button>
      </nav>
      <div class="cs-main">
        <section class="cs-view" data-view="connect">
          <div class="cs-connect">
            <div class="cs-badge">${icon('note')}</div>
            <h4>Your Spotify, in the car</h4>
            <p id="csConnectText"></p>
            <button type="button" class="cs-pill" id="csConnect">Connect Spotify</button>
            <p class="cs-fine" id="csConnectFine"></p>
          </div>
        </section>
        <section class="cs-view" data-view="now">
          <div class="cs-now">
            <div class="cs-art" id="csArt"></div>
            <div class="cs-meta">
              <p class="cs-title" id="csTitle">Nothing playing</p>
              <p class="cs-artist" id="csArtist">Pick something from Playlists, Liked Songs or Search.</p>
              <div class="cs-progress"><span id="csPos">0:00</span><div class="cs-bar"><i id="csBar"></i></div><span id="csDur">0:00</span></div>
              <div class="cs-controls">
                <button type="button" data-act="previous" aria-label="Previous song">${icon('prev')}</button>
                <button type="button" data-act="toggle" class="cs-big" id="csToggle" aria-label="Play or pause">${icon('play')}</button>
                <button type="button" data-act="next" aria-label="Next song">${icon('next')}</button>
              </div>
              <label class="cs-volume">${icon('vol')}<input type="range" min="0" max="100" value="70" id="csVol" aria-label="Volume"></label>
              <p class="cs-device" id="csDevice"></p>
            </div>
          </div>
        </section>
        <section class="cs-view" data-view="playlists"><h4>Playlists</h4><div class="cs-grid" id="csPlaylists"></div></section>
        <section class="cs-view" data-view="liked"><h4>Liked Songs</h4><div class="cs-list" id="csLiked"></div></section>
        <section class="cs-view" data-view="search">
          <input type="search" id="csSearch" placeholder="Songs, artists, albums" autocomplete="off" spellcheck="false" enterkeyhint="search">
          <div class="cs-list" id="csResults"></div>
        </section>
        <p class="cs-error" id="csError"></p>
      </div>
    </div>`;

  const ui = {
    clock: $('csClock'), connectText: $('csConnectText'), connectFine: $('csConnectFine'), connect: $('csConnect'),
    art: $('csArt'), title: $('csTitle'), artist: $('csArtist'), pos: $('csPos'), dur: $('csDur'), bar: $('csBar'),
    toggle: $('csToggle'), vol: $('csVol'), device: $('csDevice'), playlists: $('csPlaylists'), liked: $('csLiked'),
    search: $('csSearch'), results: $('csResults'), error: $('csError')
  };

  function showError(msg) {
    ui.error.textContent = msg || '';
    clearTimeout(showError.t);
    if (msg) showError.t = setTimeout(() => (ui.error.textContent = ''), 6000);
  }

  function setView(v) {
    if (!S.connected) v = 'connect';
    view = v;
    el.querySelectorAll('.cs-view').forEach((s) => s.classList.toggle('active', s.dataset.view === v));
    el.querySelectorAll('.cs-rail [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    el.classList.toggle('signed-out', !S.connected);
    if (v === 'connect') renderConnect();
    if (v === 'playlists' && !loaded.playlists) loadPlaylists();
    if (v === 'liked' && !loaded.liked) loadLiked();
    if (v === 'search') setTimeout(() => ui.search.focus(), 50);
  }

  function renderConnect() {
    if (!S.configured) {
      ui.connectText.textContent = 'Spotify sign-in hasn’t been switched on for this site yet.';
      ui.connectFine.textContent = 'If this is your site, add your Spotify Client ID to js/spotify-config.js (the README explains how). Anyone can still play a Spotify link: Settings, then Radio.';
      ui.connect.hidden = true;
    } else {
      ui.connectText.textContent = 'Connect your Spotify account to play your playlists, liked songs and anything you search for, right from the dashboard.';
      ui.connectFine.textContent = 'Needs Spotify Premium. Your progress is saved before you go to Spotify to sign in.';
      ui.connect.hidden = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Now playing
  // ---------------------------------------------------------------------------
  function renderNow() {
    const p = S.playback;
    const item = p && p.item;
    if (!item) {
      ui.title.textContent = 'Nothing playing';
      ui.artist.textContent = 'Pick something from Playlists, Liked Songs or Search.';
      ui.art.style.backgroundImage = '';
      ui.bar.style.width = '0%';
      ui.pos.textContent = ui.dur.textContent = '0:00';
      ui.toggle.innerHTML = icon('play');
    } else {
      ui.title.textContent = item.name;
      ui.artist.textContent = (item.artists || (item.show ? [item.show] : [])).map((a) => a.name).join(', ');
      const img = art((item.album && item.album.images) || item.images, 300);
      ui.art.style.backgroundImage = img ? `url("${img}")` : '';
      ui.dur.textContent = time(item.duration_ms);
      ui.pos.textContent = time(p.progress_ms);
      ui.bar.style.width = `${Math.min(100, ((p.progress_ms || 0) / (item.duration_ms || 1)) * 100)}%`;
      ui.toggle.innerHTML = icon(p.is_playing ? 'pause' : 'play');
    }
    let dev = '';
    if (p && p.device) dev = p.device.id === S.inGameDevice ? 'Playing on the car radio' : `Playing on ${p.device.name}`;
    else if (S.inGameDevice) dev = 'Car radio ready';
    if (S.problem && !S.inGameDevice && !(p && p.device)) dev = S.problem;
    ui.device.textContent = dev;
    if (p && p.device && typeof p.device.volume_percent === 'number' && document.activeElement !== ui.vol) ui.vol.value = p.device.volume_percent;
  }

  // keep the progress bar moving between updates
  setInterval(() => {
    const p = S.playback;
    if (!p || !p.item || !p.is_playing || !isOpen()) return;
    p.progress_ms = Math.min(p.item.duration_ms, (p.progress_ms || 0) + 1000);
    ui.pos.textContent = time(p.progress_ms);
    ui.bar.style.width = `${(p.progress_ms / p.item.duration_ms) * 100}%`;
    if (p.progress_ms >= p.item.duration_ms - 500) S.refresh();
  }, 1000);

  // ---------------------------------------------------------------------------
  // Library views
  // ---------------------------------------------------------------------------
  async function loadPlaylists() {
    ui.playlists.innerHTML = '<p class="cs-empty">Loading your playlists…</p>';
    try {
      const list = await S.playlists();
      loaded.playlists = true;
      if (!list.length) { ui.playlists.innerHTML = '<p class="cs-empty">No playlists yet.</p>'; return; }
      ui.playlists.innerHTML = list.map((pl) => `
        <button type="button" class="cs-tile" data-uri="${esc(pl.uri)}">
          <span class="cs-cover" style="background-image:url('${esc(art(pl.images, 160))}')"></span>
          <span class="cs-name">${esc(pl.name)}</span>
        </button>`).join('');
    } catch (e) {
      ui.playlists.innerHTML = `<p class="cs-empty">${esc(e.message)}</p>`;
    }
  }

  let likedTracks = [];
  async function loadLiked() {
    ui.liked.innerHTML = '<p class="cs-empty">Loading your liked songs…</p>';
    try {
      likedTracks = await S.liked();
      loaded.liked = true;
      if (!likedTracks.length) { ui.liked.innerHTML = '<p class="cs-empty">No liked songs yet.</p>'; return; }
      ui.liked.innerHTML = likedTracks.map((t, i) => row(t, `data-liked="${i}"`)).join('');
    } catch (e) {
      ui.liked.innerHTML = `<p class="cs-empty">${esc(e.message)}</p>`;
    }
  }

  function row(t, attrs) {
    return `<button type="button" class="cs-row" ${attrs}>
      <span class="cs-thumb" style="background-image:url('${esc(art(t.album && t.album.images, 64))}')"></span>
      <span class="cs-text"><span class="cs-name">${esc(t.name)}</span><span class="cs-sub">${esc((t.artists || []).map((a) => a.name).join(', '))}</span></span>
    </button>`;
  }

  let searchTimer = 0;
  let searchTracks = [];
  ui.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = ui.search.value.trim();
    if (!q) { ui.results.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const r = await S.search(q);
        searchTracks = r.tracks;
        const lists = r.playlists.concat(r.albums);
        ui.results.innerHTML =
          r.tracks.map((t, i) => row(t, `data-search="${i}"`)).join('') +
          lists.map((x) => `<button type="button" class="cs-row" data-uri="${esc(x.uri)}">
            <span class="cs-thumb" style="background-image:url('${esc(art(x.images, 64))}')"></span>
            <span class="cs-text"><span class="cs-name">${esc(x.name)}</span><span class="cs-sub">${x.type === 'album' ? 'Album' : 'Playlist'}${x.artists ? ' · ' + esc(x.artists.map((a) => a.name).join(', ')) : ''}</span></span>
          </button>`).join('') || '<p class="cs-empty">Nothing found.</p>';
      } catch (e) {
        ui.results.innerHTML = `<p class="cs-empty">${esc(e.message)}</p>`;
      }
    }, 350);
  });
  ui.search.addEventListener('keydown', (e) => e.stopPropagation());

  // ---------------------------------------------------------------------------
  // Taps
  // ---------------------------------------------------------------------------
  async function run(fn) {
    S.unlockAudio();
    showError('');
    try {
      await fn();
      hooks.onPlay();
    } catch (e) {
      showError(e.message);
    }
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !el.contains(t)) return;
    if (t.dataset.view) { setView(t.dataset.view); return; }
    if (t.id === 'csClose') { close(); return; }
    if (t.id === 'csConnect') {
      hooks.beforeLeave();
      S.connect().catch((err) => showError(err.message));
      return;
    }
    if (t.dataset.act) {
      const act = t.dataset.act;
      run(async () => {
        if (act === 'toggle') {
          const p = S.playback;
          if (p && p.item) await S.control(p.is_playing ? 'pause' : 'resume');
          else { setView('playlists'); throw new Error('Choose something to play first.'); }
        } else {
          await S.control(act);
        }
      });
      return;
    }
    if (t.dataset.uri) { run(() => S.playContext(t.dataset.uri)).then(() => setView('now')); return; }
    if (t.dataset.liked) { const i = +t.dataset.liked; run(() => S.playTracks(likedTracks.map((x) => x.uri), i)).then(() => setView('now')); return; }
    if (t.dataset.search) { const i = +t.dataset.search; run(() => S.playTracks(searchTracks.map((x) => x.uri), i)).then(() => setView('now')); }
  });

  ui.vol.addEventListener('input', () => {
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => S.setVolume(+ui.vol.value).catch((e) => showError(e.message)), 150);
  });

  // stop game keys firing while typing on the screen; Escape closes it
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); e.stopPropagation(); }
  });
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });

  // ---------------------------------------------------------------------------
  // Open / close
  // ---------------------------------------------------------------------------
  function isOpen() { return el.classList.contains('open'); }

  function open(v) {
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('screen-open');
    if (S.connected) { S.startSdk(); S.refresh(); }
    setView(v || (S.connected ? 'now' : 'connect'));
    tick();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (S.connected) S.refresh(); }, 4000);
  }

  function close() {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('screen-open');
    clearInterval(pollTimer);
    if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
  }

  function tick() {
    ui.clock.textContent = hooks.getClock();
    if (isOpen()) setTimeout(tick, 1000);
  }

  S.onChange(() => {
    if (!S.connected) { loaded = {}; if (isOpen()) setView('connect'); }
    renderNow();
  });

  return {
    init(h) { hooks = Object.assign(hooks, h); renderConnect(); },
    open,
    close,
    toggle() { if (isOpen()) close(); else open(); },
    get isOpen() { return isOpen(); }
  };
})();
