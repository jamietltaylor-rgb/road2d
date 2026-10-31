// Plays a Spotify playlist, album or song through Spotify's own embedded player.
// No developer account or login code is needed: whoever is playing just pastes a link.
window.SpotifyRadio = (() => {
  let api = null;
  let controller = null;
  let loadingApi = false;
  let waiting = [];
  let currentUri = null;
  let isPaused = true;
  let wantPlay = false;
  let creating = false;
  let host = null;
  let onChange = () => {};

  const TYPES = 'playlist|album|track|artist|episode|show';

  // Accepts share links (open.spotify.com/...), embed links and spotify: URIs
  function parse(link) {
    if (!link) return null;
    const s = link.trim();
    let m = s.match(new RegExp(`^spotify:(${TYPES}):([A-Za-z0-9]{10,})$`, 'i'));
    if (m) return `spotify:${m[1].toLowerCase()}:${m[2]}`;
    m = s.match(new RegExp(`open\\.spotify\\.com/(?:intl-[a-z-]+/)?(?:embed/)?(${TYPES})/([A-Za-z0-9]{10,})`, 'i'));
    if (m) return `spotify:${m[1].toLowerCase()}:${m[2]}`;
    return null;
  }

  function withApi(cb, onError) {
    if (api) { cb(); return; }
    waiting.push(cb);
    if (loadingApi) return;
    loadingApi = true;
    window.onSpotifyIframeApiReady = (IFrameAPI) => {
      api = IFrameAPI;
      const list = waiting;
      waiting = [];
      list.forEach((f) => f());
    };
    const s = document.createElement('script');
    s.src = 'https://open.spotify.com/embed/iframe-api/v1';
    s.async = true;
    s.onerror = () => {
      loadingApi = false;
      creating = false;
      waiting = [];
      if (onError) onError();
    };
    document.head.appendChild(s);
  }

  function load(uri, el, onError) {
    host = el;
    if (uri === currentUri && (controller || creating)) return;
    currentUri = uri;
    if (controller) {
      controller.loadUri(uri);
      isPaused = true;
      setTimeout(() => { if (wantPlay) controller.play(); }, 900);
      return;
    }
    if (creating) return;
    creating = true;
    withApi(() => {
      el.innerHTML = '';
      const target = document.createElement('div');
      el.appendChild(target);
      api.createController(target, { uri, width: '100%', height: 80 }, (c) => {
        controller = c;
        creating = false;
        if (currentUri !== uri) c.loadUri(currentUri);
        c.addListener('ready', () => { if (wantPlay) c.resume(); });
        c.addListener('playback_update', (e) => {
          const paused = !!(e && e.data && e.data.isPaused);
          if (paused !== isPaused) { isPaused = paused; onChange(!paused); }
        });
      });
    }, onError);
  }

  function play() {
    wantPlay = true;
    if (controller) controller.resume();
  }

  function pause() {
    wantPlay = false;
    if (controller) controller.pause();
  }

  return {
    parse,
    load,
    play,
    pause,
    onPlaybackChange(fn) { onChange = fn; },
    get ready() { return !!controller; },
    get playing() { return !isPaused; },
    get uri() { return currentUri; }
  };
})();
