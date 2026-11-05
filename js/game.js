(() => {
  'use strict';

  // Anonymous feature counters for the owner's admin panel (js/jt-stats.js). Counting must never break the game.
  const track = (name, value) => { try { if (window.jtEvent) window.jtEvent(name, value); } catch (e) { /* ignore */ } };

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');

  const DESIGN_H = 720;          // everything is drawn as if the screen is 720px tall
  const PXM = 8;                 // world pixels per metre
  const SEG = 2200;              // metres per landscape region
  const PLACE_EVERY = 1500;      // metres between village signs
  const STATION_EVERY = 2400;    // metres between fuel stops
  const STATION_OFFSET = 1300;
  const MAX_V = 30;              // metres per second (about 67 mph)
  const MILE = 1609.344;         // metres in a mile
  const MPH = 2.23694;           // metres per second -> miles per hour
  const DAY_SECONDS = 540;       // one full day takes nine minutes
  const FUEL_RANGE = 3600;       // metres on a full tank

  let W = 1280, H = DESIGN_H, scale = 1, dpr = 1, yOff = 0;

  // Phone/tablet or computer? Touch screens without a precise pointer get the phone layout.
  const coarse = matchMedia('(pointer: coarse)');
  const IS_TOUCH = coarse.matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  document.body.classList.add(IS_TOUCH ? 'device-touch' : 'device-desk');
  if (IS_IOS) document.body.classList.add('ios');
  if (!document.fullscreenEnabled) document.body.classList.add('no-fullscreen');

  // ---------------------------------------------------------------------------
  // Small maths and colour helpers
  // ---------------------------------------------------------------------------
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  function hash(i) {
    let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const hash2 = (i, s) => hash((Math.imul(i | 0, 374761393) + Math.imul(s | 0, 668265263)) | 0);

  function noise(x, s) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    const a = hash2(i, s), b = hash2(i + 1, s);
    return (a + (b - a) * u) * 2 - 1;
  }

  function fbm(x, s, oct) {
    let sum = 0, amp = 1, norm = 0, fr = 1;
    for (let k = 0; k < oct; k++) {
      sum += noise(x * fr, s + k * 101) * amp;
      norm += amp;
      amp *= 0.5;
      fr *= 2.03;
    }
    return sum / norm;
  }

  // ---------------------------------------------------------------------------
  // Landscapes
  // ---------------------------------------------------------------------------
  const BIOMES = [
    { name: 'Pine Valley', far: '#7b8a92', mid: '#566a62', back: '#3e5148', front: '#2c3c34', ground: '#262f29', verge: '#3a4636', relief: [1, 1, 0.9], density: [0.6, 0.75], tree: 'pine' },
    { name: 'Heather Moor', far: '#8b8892', mid: '#72646c', back: '#5b4c50', front: '#463b39', ground: '#332c28', verge: '#56463f', relief: [0.6, 0.7, 0.5], density: [0.07, 0.22], tree: 'shrub' },
    { name: 'Salt Coast', far: '#8e9a9e', mid: '#62787d', back: '#5b6458', front: '#495045', ground: '#3d3d36', verge: '#67654f', relief: [0.45, 0.03, 0.45], density: [0.05, 0.14], tree: 'broad' },
    { name: 'High Pass', far: '#aab1b8', mid: '#86909a', back: '#57656b', front: '#3c494e', ground: '#a3a9ac', verge: '#c8cdcf', relief: [1.7, 1.3, 1.1], density: [0.3, 0.38], tree: 'snowpine' },
    { name: 'Rust Woods', far: '#8c8a80', mid: '#6f6853', back: '#6d5537', front: '#553f2a', ground: '#30271e', verge: '#5d452f', relief: [0.8, 0.8, 0.7], density: [0.55, 0.7], tree: 'broad' },
    { name: 'Birch Wood', far: '#8a9096', mid: '#6c766f', back: '#727b70', front: '#56604f', ground: '#2c3127', verge: '#4b5440', relief: [0.9, 0.8, 0.8], density: [0.55, 0.62], tree: 'birch' },
    { name: 'Old Orchard', far: '#8d8f88', mid: '#71745f', back: '#5f6640', front: '#4c5434', ground: '#333824', verge: '#5b6340', relief: [0.6, 0.5, 0.35], density: [0.85, 0.75], tree: 'orchard' },
    { name: 'Wind Farm Ridge', far: '#97a0a6', mid: '#7b878a', back: '#6c7778', front: '#4e5753', ground: '#2e342f', verge: '#4d5743', relief: [1.25, 1.0, 0.6], density: [0.22, 0.16], tree: 'shrub', treeBack: 'turbine' },
    { name: 'Dune Road', far: '#a39e93', mid: '#8b8576', back: '#ad9f80', front: '#978a6b', ground: '#6b604c', verge: '#a3956f', relief: [0.4, 0.3, 1.1], density: [0.3, 0.5], tree: 'marram' },
    { name: 'Peat Bog', far: '#7f8584', mid: '#5f6862', back: '#4c5147', front: '#3a3e33', ground: '#24251e', verge: '#44463a', relief: [0.35, 0.25, 0.18], density: [0.35, 0.55], tree: 'reed' }
  ];
  const COLOUR_KEYS = ['far', 'mid', 'back', 'front', 'ground', 'verge'];
  BIOMES.forEach((b) => COLOUR_KEYS.forEach((k) => (b[k] = hex(b[k]))));

  const biomeCache = [0];
  function biomeIndex(s) {
    s = Math.max(0, s);
    while (biomeCache.length <= s) {
      const n = biomeCache.length, prev = biomeCache[n - 1];
      let b = Math.floor(hash2(n, 4242) * BIOMES.length);
      if (b === prev) b = (b + 1 + Math.floor(hash2(n, 99) * (BIOMES.length - 1))) % BIOMES.length;
      biomeCache.push(b);
    }
    return biomeCache[s];
  }

  function biomeAt(m) {
    const s = Math.floor(Math.max(0, m) / SEG);
    const local = Math.max(0, m) - s * SEG;
    return { a: BIOMES[biomeIndex(s)], b: BIOMES[biomeIndex(s + 1)], t: smooth(SEG - 420, SEG, local) };
  }

  function paletteAt(m) {
    const { a, b, t } = biomeAt(m);
    const p = { name: t < 0.5 ? a.name : b.name, relief: [], density: [] };
    COLOUR_KEYS.forEach((k) => (p[k] = mix(a[k], b[k], t)));
    for (let i = 0; i < 3; i++) p.relief[i] = lerp(a.relief[i], b.relief[i], t);
    for (let i = 0; i < 2; i++) p.density[i] = lerp(a.density[i], b.density[i], t);
    return p;
  }

  // ---------------------------------------------------------------------------
  // Sky and time of day
  // ---------------------------------------------------------------------------
  const SKY = [
    { t: 0.00, top: '#0d1219', hor: '#283038', light: 0.12 },
    { t: 0.20, top: '#2b3340', hor: '#6f6d72', light: 0.35 },
    { t: 0.25, top: '#55606d', hor: '#c6a58c', light: 0.62 },
    { t: 0.32, top: '#8a9caa', hor: '#d9d3c5', light: 0.9 },
    { t: 0.50, top: '#90a6b3', hor: '#d6dad6', light: 1.0 },
    { t: 0.68, top: '#8a9aa7', hor: '#dbcfbb', light: 0.94 },
    { t: 0.76, top: '#4d4b5c', hor: '#cf9673', light: 0.6 },
    { t: 0.82, top: '#232a37', hor: '#5d5459', light: 0.3 },
    { t: 0.88, top: '#111721', hor: '#2b323b', light: 0.14 },
    { t: 1.00, top: '#0d1219', hor: '#283038', light: 0.12 }
  ];
  SKY.forEach((k) => { k.top = hex(k.top); k.hor = hex(k.hor); });

  function skyAt(tod) {
    for (let i = 0; i < SKY.length - 1; i++) {
      const a = SKY[i], b = SKY[i + 1];
      if (tod >= a.t && tod <= b.t) {
        const f = smooth(0, 1, (tod - a.t) / (b.t - a.t));
        return { top: mix(a.top, b.top, f), hor: mix(a.hor, b.hor, f), light: lerp(a.light, b.light, f) };
      }
    }
    return SKY[0];
  }

  function timeLabel(tod) {
    if (tod < 0.2 || tod >= 0.86) return 'night';
    if (tod < 0.29) return 'first light';
    if (tod < 0.42) return 'morning';
    if (tod < 0.58) return 'midday';
    if (tod < 0.72) return 'afternoon';
    return 'dusk';
  }

  function clockText(tod) {
    const mins = Math.floor(tod * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------------------
  // Places
  // ---------------------------------------------------------------------------
  const PRE = ['Ash', 'Bram', 'Cold', 'Fen', 'Hal', 'Kel', 'Lang', 'Mar', 'Nether', 'Old', 'Red', 'Salt', 'Stan', 'Thorn', 'Wren', 'Brack', 'Elder', 'Gil', 'Hollin', 'Rook', 'Swale', 'Crow'];
  const SUF = ['combe', 'ford', 'mere', 'wick', 'thorpe', 'by', 'stead', 'well', 'haven', 'ley', 'dale', 'moor', 'bridge', 'gate', 'holm', 'field'];
  function placeName(n) {
    const a = PRE[Math.floor(hash2(n, 11) * PRE.length)];
    const b = SUF[Math.floor(hash2(n, 23) * SUF.length)];
    let name = a + b;
    const r = hash2(n, 37);
    if (r < 0.1) name = 'Upper ' + name;
    else if (r < 0.18) name = 'Little ' + name;
    else if (r < 0.24) name = name + ' Cross';
    return name;
  }

  // ---------------------------------------------------------------------------
  // Terrain shapes
  // ---------------------------------------------------------------------------
  const roadY = (wx) => 566 + fbm(wx * 0.0007, 7, 3) * 52 + noise(wx * 0.0035, 9) * 6;

  const LAYERS = {
    far:   { p: 0.03, base: 452, amp: 115, freq: 0.0034, seed: 1, oct: 5 },
    mid:   { p: 0.10, base: 486, amp: 62,  freq: 0.0050, seed: 2, oct: 4 },
    back:  { p: 0.28, base: 508, amp: 28,  freq: 0.0070, seed: 3, oct: 3, cell: 13, size: [16, 32], d: 0 },
    front: { p: 0.55, base: 538, amp: 34,  freq: 0.0055, seed: 4, oct: 3, cell: 25, size: [40, 82], d: 1 }
  };

  function ridge(L, wx, relief) {
    return L.base - (fbm(wx * L.freq, L.seed, L.oct) * 0.5 + 0.5) * L.amp * relief;
  }

  // ---------------------------------------------------------------------------
  // Game state (resumes where you left off)
  // ---------------------------------------------------------------------------
  const saved = LR.load(LR.KEYS.journey, null);
  const stats = LR.load(LR.KEYS.stats, { metres: 0 });
  const settings = Object.assign(
    { muted: false, radio: false, radioSource: 'builtin', engine: 'petrol', engineVol: 0.8, radioVol: 0.8, spotifyUri: '', lowPower: false, rainStyle: 'patter', rainVol: 0.8 },
    LR.load(LR.KEYS.settings, {})
  );

  const state = {
    cam: saved ? saved.cam : 0,
    trip: saved ? (saved.trip != null ? saved.trip : Math.max(0, saved.cam / PXM)) : 0,   // metres on the odometer this journey
    tod: saved ? saved.tod : 0.235,
    fuel: saved ? saved.fuel : 100,
    v: 0,
    cruise: false,
    cruiseV: 0,
    started: false,
    time: 0,
    lastPlace: -1,
    paused: false,
    seed: saved && saved.seed ? saved.seed : (Math.random() * 1e6) | 0,
    money: saved && typeof saved.money === 'number' ? saved.money : 5,
    cans: saved && Array.isArray(saved.cans) ? saved.cans : [],
    passengers: saved && Array.isArray(saved.passengers) ? saved.passengers : saved && saved.passenger ? [saved.passenger] : [],
    seats: saved && saved.seats ? saved.seats : 1,
    stuck: saved && saved.stuck != null ? saved.stuck : null,
    flat: saved ? !!saved.flat : false,
    dead: saved ? !!saved.dead : false,
    mucky: saved ? !!saved.mucky : false,
    done: new Set(saved && saved.done ? saved.done : []),
    carried: saved ? saved.carried || 0 : 0,
    earned: saved ? saved.earned || 0 : 0,
    over: false,
    chatT: 25,
    flash: 0,
    emptyT: 0,
    dark: 0
  };
  const input = { go: false, brake: false };

  let carX = 0;
  let particles = [];
  let drops = [];
  let stars = [];
  let fogSprite, fogTint, tintColourKey = '';
  let grainPattern, vignette;

  // ---------------------------------------------------------------------------
  // Pre-rendered pieces
  // ---------------------------------------------------------------------------
  function buildFogSprite() {
    fogSprite = document.createElement('canvas');
    fogSprite.width = 512;
    fogSprite.height = 160;
    const g = fogSprite.getContext('2d');
    for (let i = 0; i < 26; i++) {
      const x = 70 + Math.random() * 372;
      const y = 55 + Math.random() * 50;
      const r = 30 + Math.random() * 55;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.16)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    fogTint = document.createElement('canvas');
    fogTint.width = 512;
    fogTint.height = 160;
  }

  function tintFog(c) {
    const key = `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
    if (key === tintColourKey) return;
    tintColourKey = key;
    const g = fogTint.getContext('2d');
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, 512, 160);
    g.drawImage(fogSprite, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = rgb(c);
    g.fillRect(0, 0, 512, 160);
    g.globalCompositeOperation = 'source-over';
  }

  function buildGrain() {
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d');
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainPattern = ctx.createPattern(c, 'repeat');
  }

  function buildStars() {
    stars = [];
    for (let i = 0; i < 140; i++) {
      stars.push({ x: Math.random(), y: Math.random() * 380, s: Math.random() < 0.15 ? 1.6 : 1, tw: Math.random() * 6 });
    }
  }

  function buildDrops() {
    drops = [];
    for (let i = 0; i < 240; i++) {
      drops.push({ x: Math.random() * 2400, y: Math.random() * H, len: 10 + Math.random() * 16, sp: 700 + Math.random() * 400 });
    }
  }

  function resize() {
    const low = settings.lowPower;
    const maxDpr = low ? 1 : IS_TOUCH ? 1.6 : 2;
    const maxPx = low ? 900000 : IS_TOUCH ? 2300000 : 4200000;
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const px = innerWidth * innerHeight * dpr * dpr;
    if (px > maxPx) dpr = Math.sqrt(maxPx / (innerWidth * innerHeight));
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    // tall phone screens get zoomed out so you can still see the road ahead
    // phones on their side: zoom out a touch and keep the road above the on-screen buttons
    const touchLandscape = IS_TOUCH && innerWidth > innerHeight;
    scale = Math.min(canvas.height / (DESIGN_H * (touchLandscape ? 1.24 : 1)), canvas.width / 700);
    W = canvas.width / scale;
    const extra = canvas.height / scale - DESIGN_H;
    yOff = touchLandscape ? 0 : extra * 0.5;
    H = DESIGN_H + extra - yOff;
    carX = Math.min(W * 0.34, 520);
    vignette = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.85);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(8,10,14,0.55)');
  }

  // ---------------------------------------------------------------------------
  // Drawing helpers
  // ---------------------------------------------------------------------------
  function fillRidge(L, cam, relief, colour, step) {
    const shift = cam * L.p;
    ctx.beginPath();
    ctx.moveTo(-10, H);
    for (let x = -10; x <= W + step; x += step) ctx.lineTo(x, ridge(L, x + shift, relief));
    ctx.lineTo(W + step, H);
    ctx.closePath();
    ctx.fillStyle = rgb(colour);
    ctx.fill();
  }

  function fogWash(fog, alpha, yTop) {
    const g = ctx.createLinearGradient(0, yTop, 0, H);
    g.addColorStop(0, rgb(fog, 0));
    g.addColorStop(0.3, rgb(fog, alpha));
    g.addColorStop(1, rgb(fog, alpha * 0.85));
    ctx.fillStyle = g;
    ctx.fillRect(0, yTop, W, H - yTop);
  }

  function fogBanks(p, y, size, alpha, seed, drift) {
    const cell = 520;
    const shift = state.cam * p + state.time * drift;
    const i0 = Math.floor((shift - 1000) / cell);
    const i1 = Math.floor((shift + W + 1000) / cell);
    for (let i = i0; i <= i1; i++) {
      const r1 = hash2(i, seed), r2 = hash2(i, seed + 1), r3 = hash2(i, seed + 2);
      if (r3 < 0.25) continue;
      const w = (650 + r1 * 520) * size;
      const h = w * 0.3;
      const sx = i * cell + r2 * 240 - shift;
      ctx.globalAlpha = alpha * (0.45 + r3 * 0.55);
      ctx.drawImage(fogTint, sx - w / 2, y - h / 2 + (r1 - 0.5) * 36, w, h);
    }
    ctx.globalAlpha = 1;
  }

  function treePath(type, x, y, h) {
    if (type === 'pine' || type === 'snowpine') {
      const hw = h * 0.22;
      ctx.rect(x - h * 0.025, y - h * 0.18, h * 0.05, h * 0.2);
      for (let k = 0; k < 3; k++) {
        const by = y - h * (0.12 + k * 0.25);
        const ty = y - h * (0.5 + k * 0.25);
        const w = hw * (1 - k * 0.24);
        ctx.moveTo(x - w, by);
        ctx.lineTo(x, ty);
        ctx.lineTo(x + w, by);
        ctx.closePath();
      }
    } else if (type === 'broad') {
      ctx.rect(x - h * 0.03, y - h * 0.5, h * 0.06, h * 0.52);
      const blobs = [[0, 0.66, 0.27], [-0.17, 0.52, 0.2], [0.19, 0.55, 0.22], [0.04, 0.45, 0.2]];
      for (const [bx, by, br] of blobs) {
        ctx.moveTo(x + bx * h + br * h, y - by * h);
        ctx.arc(x + bx * h, y - by * h, br * h, 0, Math.PI * 2);
      }
    } else if (type === 'birch') {
      // the pale trunk is drawn separately; this is the airy crown
      const blobs = [[0, 0.82, 0.13], [-0.09, 0.7, 0.1], [0.1, 0.66, 0.11], [0.02, 0.56, 0.09]];
      for (const [bx, by, br] of blobs) {
        ctx.moveTo(x + bx * h + br * h, y - by * h);
        ctx.ellipse(x + bx * h, y - by * h, br * h, br * h * 1.3, 0, 0, Math.PI * 2);
      }
    } else if (type === 'orchard') {
      ctx.rect(x - h * 0.03, y - h * 0.32, h * 0.06, h * 0.34);
      ctx.moveTo(x + h * 0.26, y - h * 0.44);
      ctx.ellipse(x, y - h * 0.44, h * 0.26, h * 0.2, 0, 0, Math.PI * 2);
    } else if (type === 'turbine') {
      ctx.moveTo(x - h * 0.018, y);
      ctx.lineTo(x - h * 0.008, y - h);
      ctx.lineTo(x + h * 0.008, y - h);
      ctx.lineTo(x + h * 0.018, y);
      ctx.closePath();
      ctx.rect(x - h * 0.02, y - h * 1.015, h * 0.06, h * 0.03);
    } else if (type === 'marram') {
      for (let k = -3; k <= 3; k++) {
        const lean = k * 0.09 + Math.sin(state.time * 1.3 + x * 0.05) * 0.05;
        ctx.moveTo(x + k * h * 0.05 - h * 0.012, y);
        ctx.lineTo(x + k * h * 0.05 + lean * h, y - h * (0.55 - Math.abs(k) * 0.07));
        ctx.lineTo(x + k * h * 0.05 + h * 0.012, y);
        ctx.closePath();
      }
    } else if (type === 'reed') {
      for (let k = -2; k <= 2; k++) {
        const top = y - h * (0.5 - Math.abs(k) * 0.06);
        const sway = Math.sin(state.time * 1.1 + x * 0.03 + k) * h * 0.02;
        ctx.rect(x + k * h * 0.06 + sway, top, h * 0.012, y - top);
        ctx.moveTo(x + k * h * 0.06 + sway + h * 0.03, top + h * 0.06);
        ctx.ellipse(x + k * h * 0.06 + sway + h * 0.006, top + h * 0.06, h * 0.022, h * 0.06, 0, 0, Math.PI * 2);
      }
    } else {
      ctx.moveTo(x + h * 0.4, y);
      ctx.ellipse(x, y, h * 0.4, h * 0.16, 0, 0, Math.PI * 2);
      ctx.moveTo(x + h * 0.55, y + 1);
      ctx.ellipse(x + h * 0.3, y + 1, h * 0.25, h * 0.11, 0, 0, Math.PI * 2);
    }
  }

  function snowPath(x, y, h) {
    for (let k = 0; k < 3; k++) {
      const ty = y - h * (0.5 + k * 0.25);
      const w = h * 0.22 * (1 - k * 0.24) * 0.45;
      ctx.moveTo(x - w, ty + h * 0.13);
      ctx.lineTo(x, ty);
      ctx.lineTo(x + w, ty + h * 0.13);
      ctx.closePath();
    }
  }

  function drawTreeLayer(L, pal, colour, extra, distM) {
    const shift = state.cam * L.p;
    const relief = pal.relief[2];
    fillRidge(L, state.cam, relief, colour, 6);

    const i0 = Math.floor((shift - 120) / L.cell);
    const i1 = Math.floor((shift + W + 120) / L.cell);
    const snowy = [], birches = [], turbines = [], pools = [], grasses = [];
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const sx = i * L.cell + (hash2(i, L.seed + 5) - 0.5) * L.cell * 0.8 - shift;
      const m = distM + (sx - carX) / PXM;
      const bio = biomeAt(m);
      const B = hash2(i, L.seed + 7) < bio.t ? bio.b : bio.a;
      let type = L.d === 0 && B.treeBack ? B.treeBack : B.tree;
      const y = ridge(L, sx + shift, relief) + 3;
      // bog pools sit between the reeds
      if (type === 'reed' && L.d === 1 && hash2(i, L.seed + 13) < 0.22) pools.push([sx, y + 4, 18 + hash2(i, L.seed + 14) * 26]);
      if (type === 'turbine') {
        // wind turbines stand well apart
        if (i % 7 !== 0 || hash2(i, L.seed + 11) > 0.75) continue;
        const h = L.size[1] * 3.1;
        treePath(type, sx, y, h);
        turbines.push([sx, y - h * 1.0, h * 0.42, hash2(i, 3) * 6.28]);
        continue;
      }
      const dens = lerp(bio.a.density[L.d], bio.b.density[L.d], bio.t);
      const clump = type === 'orchard' ? 1 : 0.55 + 0.75 * (noise(i * 0.09, L.seed + 9) * 0.5 + 0.5);
      if (hash2(i, L.seed + 6) > dens * clump) continue;
      let h = lerp(L.size[0], L.size[1], hash2(i, L.seed + 8));
      if (type === 'orchard') h *= 0.75;
      if (type === 'marram' || type === 'reed') h *= 0.55;
      if (type === 'birch') h *= 1.1;
      if (type === 'marram') { grasses.push([sx, y, h]); continue; }
      treePath(type, sx, y, h);
      if (type === 'snowpine') snowy.push([sx, y, h]);
      if (type === 'birch') birches.push([sx, y, h]);
    }
    ctx.fillStyle = rgb(colour);
    ctx.fill();
    if (grasses.length) {
      ctx.beginPath();
      grasses.forEach(([x, y, h]) => treePath('marram', x, y, h));
      ctx.fillStyle = rgb(mix(colour, extra.grass, 0.6));
      ctx.fill();
    }
    if (pools.length) {
      ctx.beginPath();
      pools.forEach(([x, y, w]) => { ctx.moveTo(x + w, y); ctx.ellipse(x, y, w, w * 0.12, 0, 0, Math.PI * 2); });
      ctx.fillStyle = rgb(extra.water);
      ctx.fill();
    }
    if (snowy.length) {
      ctx.beginPath();
      snowy.forEach(([x, y, h]) => snowPath(x, y, h));
      ctx.fillStyle = rgb(extra.snow);
      ctx.fill();
    }
    if (birches.length) {
      ctx.beginPath();
      birches.forEach(([x, y, h]) => ctx.rect(x - h * 0.016, y - h * 0.86, h * 0.032, h * 0.86));
      ctx.fillStyle = rgb(extra.birch);
      ctx.fill();
      ctx.beginPath();
      birches.forEach(([x, y, h]) => { for (let k = 1; k < 6; k++) ctx.rect(x - h * 0.016, y - h * (0.13 * k + 0.05), h * (0.012 + (k % 2) * 0.012), h * 0.012); });
      ctx.fillStyle = rgb(colour);
      ctx.fill();
    }
    if (turbines.length) {
      ctx.strokeStyle = rgb(colour);
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      turbines.forEach(([x, y, r, ph]) => {
        const a0 = state.time * 0.9 + ph;
        for (let k = 0; k < 3; k++) {
          const a = a0 + (k * Math.PI * 2) / 3;
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
      });
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  // ---------------------------------------------------------------------------
  // Roadside things
  // ---------------------------------------------------------------------------
  function drawPoles(colour) {
    const sp = 320;
    const i0 = Math.floor((state.cam - sp) / sp);
    const i1 = Math.floor((state.cam + W + sp) / sp);
    const tops = [];
    ctx.strokeStyle = rgb(colour);
    ctx.fillStyle = rgb(colour);
    for (let i = i0; i <= i1; i++) {
      const wx = i * sp + 120;
      const sx = wx - state.cam;
      const base = roadY(wx) - 4;
      const top = base - 150;
      ctx.fillRect(sx - 2, top, 4, base - top);
      ctx.fillRect(sx - 13, top + 8, 26, 3);
      tops.push([sx, top + 8]);
    }
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < tops.length - 1; k++) {
      const [x0, y0] = tops[k], [x1, y1] = tops[k + 1];
      for (const off of [-10, 10]) {
        ctx.moveTo(x0 + off, y0);
        ctx.quadraticCurveTo((x0 + x1) / 2 + off, (y0 + y1) / 2 + 22, x1 + off, y1);
      }
    }
    ctx.stroke();
  }

  function drawSigns(dark, postColour, plateColour, inkColour) {
    const n0 = Math.max(1, Math.floor((state.cam - 300) / PXM / PLACE_EVERY));
    const n1 = Math.floor((state.cam + W + 300) / PXM / PLACE_EVERY) + 1;
    ctx.font = '500 11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let n = n0; n <= n1; n++) {
      const wx = n * PLACE_EVERY * PXM - 60;
      const sx = wx - state.cam;
      if (sx < -150 || sx > W + 150) continue;
      const base = roadY(wx) - 3;
      const name = placeName(n).toUpperCase();
      const w = Math.max(70, ctx.measureText(name).width + 22);
      ctx.fillStyle = rgb(postColour);
      ctx.fillRect(sx - w / 2 + 8, base - 62, 3, 62);
      ctx.fillRect(sx + w / 2 - 11, base - 62, 3, 62);
      ctx.fillStyle = rgb(plateColour);
      ctx.fillRect(sx - w / 2, base - 84, w, 24);
      ctx.strokeStyle = rgb(inkColour, 0.7);
      ctx.lineWidth = 1;
      ctx.strokeRect(sx - w / 2 + 3, base - 81, w - 6, 18);
      ctx.fillStyle = rgb(inkColour);
      ctx.fillText(name, sx, base - 71.5);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // Fuel stops are unevenly spaced. The first six are always open, so you get a chance
  // to buy jerry cans at the garage. After that some are shut, but never two in a row,
  // and the road after a shut one is short enough to reach on a full tank plus a can.
  let stationList = [], stationSeed = null;
  function ensureStations(m) {
    if (stationSeed !== state.seed) { stationList = [{ m: STATION_OFFSET, closed: false }]; stationSeed = state.seed; }
    while (stationList[stationList.length - 1].m < m + 6000) {
      const n = stationList.length;
      const prev = stationList[n - 1];
      const r = hash2(n, 500 + state.seed * 7), r2 = hash2(n, 900 + state.seed * 7);
      let gap = n < 4 ? 1500 + r * 900 : 1600 + r * 2300;
      if (prev.closed) gap = 1200 + r * 1000;
      const closed = n >= 6 && !prev.closed && gap <= 2800 && r2 < 0.35;
      stationList.push({ m: prev.m + gap, closed });
    }
  }
  function stationIndexNear(m) {
    ensureStations(m);
    let best = 0;
    for (let i = 0; i < stationList.length; i++) {
      if (Math.abs(stationList[i].m - m) < Math.abs(stationList[best].m - m)) best = i;
      if (stationList[i].m > m + 5000) break;
    }
    return best;
  }
  function stationWorldX(n) { ensureStations(0); while (stationList.length <= n) ensureStations(stationList[stationList.length - 1].m + 1); return stationList[n].m * PXM; }
  function nearestStation(wx) { return stationWorldX(stationIndexNear(wx / PXM)); }
  function nearestStationInfo(wx) { const i = stationIndexNear(wx / PXM); return { wx: stationList[i].m * PXM, closed: stationList[i].closed }; }
  function nextStationAfter(wx) {
    const m = wx / PXM;
    ensureStations(m);
    const st = stationList.find((x) => x.m >= m);
    return st.m * PXM;
  }

  function drawStations(dark, bodyColour, roofColour, lamp0) {
    ensureStations(state.cam / PXM + W / PXM);
    for (const st of stationList) {
      const wx = st.m * PXM;
      const sx = wx - state.cam;
      if (sx < -300 || sx > W + 300) continue;
      const lamp = st.closed ? mix(roofColour, bodyColour, 0.3) : lamp0;
      const base = roadY(wx) - 4;
      // shop
      ctx.fillStyle = rgb(bodyColour);
      ctx.fillRect(sx + 30, base - 58, 120, 58);
      ctx.fillStyle = rgb(roofColour);
      ctx.beginPath();
      ctx.moveTo(sx + 24, base - 58);
      ctx.lineTo(sx + 90, base - 82);
      ctx.lineTo(sx + 156, base - 58);
      ctx.closePath();
      ctx.fill();
      // windows, lit at night
      ctx.fillStyle = rgb(mix(roofColour, lamp, 0.25 + dark * 0.75), 1);
      ctx.fillRect(sx + 50, base - 42, 26, 20);
      ctx.fillRect(sx + 104, base - 42, 26, 20);
      // canopy and pump
      ctx.fillStyle = rgb(roofColour);
      ctx.fillRect(sx - 70, base - 76, 96, 6);
      ctx.fillRect(sx - 64, base - 70, 3, 70);
      ctx.fillRect(sx + 18, base - 70, 3, 70);
      ctx.fillStyle = rgb(bodyColour);
      ctx.fillRect(sx - 30, base - 30, 13, 30);
      ctx.fillRect(sx - 27, base - 26, 7, 6);
      // sign
      ctx.fillStyle = rgb(roofColour);
      ctx.fillRect(sx - 112, base - 96, 3, 96);
      ctx.fillStyle = rgb(mix(bodyColour, lamp, 0.35 + dark * 0.5));
      ctx.fillRect(sx - 134, base - 112, 48, 22);
      ctx.fillStyle = rgb(roofColour);
      ctx.font = '500 11px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(st.closed ? 'SHUT' : 'FUEL', sx - 110, base - 97);
      ctx.textAlign = 'left';
      if (st.closed) {
        // boarded windows
        ctx.strokeStyle = rgb(roofColour);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const wxo of [50, 104]) { ctx.moveTo(sx + wxo, base - 42); ctx.lineTo(sx + wxo + 26, base - 22); ctx.moveTo(sx + wxo + 26, base - 42); ctx.lineTo(sx + wxo, base - 22); }
        ctx.stroke();
      }

      if (dark > 0.2 && !st.closed) {
        ctx.globalCompositeOperation = 'lighter';
        for (const [gx, gy, r] of [[sx - 110, base - 101, 70], [sx + 90, base - 32, 110], [sx - 22, base - 70, 60]]) {
          const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
          g.addColorStop(0, rgb(lamp, 0.28 * dark));
          g.addColorStop(1, rgb(lamp, 0));
          ctx.fillStyle = g;
          ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  function drawMarkerPosts(colour) {
    const sp = 110;
    const i0 = Math.floor(state.cam / sp) - 1;
    const i1 = Math.floor((state.cam + W) / sp) + 1;
    ctx.fillStyle = rgb(colour);
    for (let i = i0; i <= i1; i++) {
      const wx = i * sp;
      const sx = wx - state.cam;
      ctx.fillRect(sx, roadY(wx) - 13, 2.5, 12);
    }
  }

  // ---------------------------------------------------------------------------
  // The journey: hitchhikers, things on the road, money and jerry cans
  // ---------------------------------------------------------------------------
  const CAN_PRICE = 20, CAN_FILL_PRICE = 3, CAN_FUEL = 60, MAX_CANS = 3;
  const SEAT_PRICES = { 2: 40, 3: 90 };   // price of the 2nd and 3rd passenger seat
  const MAX_SEATS = 3;
  const NAMES = ['Margaret', 'Tom', 'Priya', 'Ewan', 'Aled', 'Ruth', 'Kwame', 'Isla', 'Dougie', 'Mei', 'Frank', 'Niamh', 'Owen', 'Sadie', 'Bill', 'Ada', 'Jonah', 'Elsie', 'Rafi', 'Bryony'];
  const COATS = ['#7c4b3a', '#3f5a6b', '#8a7a3c', '#4d6146', '#6b4a68', '#2f3b46', '#9a6b3f', '#5a5f66', '#8b3a2f'];
  const CHAT = [
    'I used to walk this road to school. It felt longer then.',
    'My nan swore there was a ghost at the crossroads back there.',
    'You get used to the fog. You start to miss it when it lifts.',
    'I’m going to see my brother. We haven’t spoken in a while.',
    'There used to be a tea room along here. Best scones in the county.',
    'Is that your luggage on the roof? Going somewhere nice?',
    'I’ve hitched this road for thirty years. You’re the first to stop today.',
    'Don’t mind me. I’ll just watch the hills.',
    'My dog would have loved this car. He loved a window.',
    'They say the old bridge is haunted. I say it’s just badly lit.',
    'I came out to photograph herons. Didn’t see a single one.',
    'Rain’s coming. You can smell it.',
    'I’m a postman, believe it or not. Day off.',
    'Funny how a road can feel like it’s remembering you.',
    'Keep an eye out for sheep round here. They own the place.',
    'If you see a fuel stop, take it. They’re further apart than you’d think.',
    'I left my bike at a pub three villages back. Long story.',
    'Do you ever just drive to see where it goes? Me neither. Until today.'
  ];
  const THANKS = ['This’ll do lovely.', 'Right here’s perfect, thank you.', 'You’re a star.', 'I’ll hop out here. Safe travels.', 'Thanks for the company.'];

  let spots = [], spotSeed = null;
  const ev = {};
  // Roadside jobs come from a shuffled deck, so every kind turns up before any repeats.
  // The order is different on every journey but stays the same if you reload.
  const EVENTS = ['tree', 'sheep', 'rocks', 'mud', 'glass', 'gate', 'ford', 'tractor', 'battery'];
  let eventCount = 0;
  function eventKind(n) {
    const round = Math.floor(n / EVENTS.length);
    const deck = EVENTS.slice();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(hash2(i + round * 31, state.seed * 13 + 4242) * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck[n % EVENTS.length];
  }
  function ensureSpots(uptoM) {
    if (spotSeed !== state.seed) { spots = []; spotSeed = state.seed; eventCount = 0; }
    let m = spots.length ? spots[spots.length - 1].m : 260;
    let k = spots.length ? spots[spots.length - 1].id + 1 : 0;
    while (m < uptoM) {
      const r = (i) => hash2(k, state.seed * 31 + i * 977);
      m += 420 + r(1) * 620;
      const near = Math.abs(stationWorldX(stationIndexNear(m)) / PXM - m) < 140 || Math.abs((Math.round(m / PLACE_EVERY) * PLACE_EVERY) - m) < 60;
      if (!near) {
        const p = r(2);
        let kind = p < 0.3 ? 'hitch' : p < 0.36 ? 'cash' : p < 0.43 ? 'view' : p < 0.48 ? 'deer' : 'event';
        if (spots.length === 0) kind = 'hitch';
        if (kind === 'event') kind = eventKind(eventCount++);
        spots.push({ id: k, m, kind, r: r(3), r2: r(4), r3: r(5) });
      }
      k++;
    }
  }
  const hitchInfo = (sp) => ({
    name: NAMES[Math.floor(sp.r * NAMES.length)],
    coat: COATS[Math.floor(sp.r2 * COATS.length)],
    dest: Math.floor(sp.m / PLACE_EVERY) + 1 + Math.floor(sp.r3 * 3)
  });
  const fareFor = (fromM, dest) => Math.round(4 + ((dest * PLACE_EVERY - fromM) / 1000) * 3);

  let captionTimer = 0;
  function caption(text) {
    ui.caption.textContent = text;
    ui.caption.classList.add('show');
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => ui.caption.classList.remove('show'), 7000);
  }
  function earn(amount, msg) {
    state.money += amount;
    state.earned += amount;
    RoadAudio.chime();
    toast(msg);
  }
  function charge(amount, msg) {
    state.money = Math.max(0, state.money - amount);
    toast(msg);
  }

  function dropOff(p, missed) {
    const fare = fareFor(p.from, p.dest);
    const tip = missed ? 0 : Math.floor(Math.random() * 5);
    const pay = missed ? Math.ceil(fare / 2) : fare + tip;
    state.passengers = state.passengers.filter((x) => x !== p);
    state.carried++;
    track('hitchhiker_dropped');
    if (missed) caption(`${p.name}: Ah, that was my stop back there. Never mind, I’ll walk. Here’s something for the petrol.`);
    else caption(`${p.name}: ${THANKS[Math.floor(Math.random() * THANKS.length)]} Here’s £${pay}${tip ? ', and a bit extra' : ''}.`);
    earn(pay, `+£${pay} from ${p.name}`);
  }

  function atOpenStation(carW) {
    const st = nearestStationInfo(carW);
    return !st.closed && Math.abs(st.wx - carW) < 90;
  }
  function buyCan() {
    const carW = state.cam + carX;
    if (!atOpenStation(carW) || state.v > 1.5) { toast('You can buy jerry cans when you’re stopped at a fuel station.'); return; }
    if (state.cans.length >= MAX_CANS) { toast(`The boot only fits ${MAX_CANS} jerry cans.`); return; }
    if (state.money < CAN_PRICE) { toast(`A jerry can costs £${CAN_PRICE}. Pick up some hitchhikers to earn more.`); return; }
    state.money -= CAN_PRICE;
    state.cans.push(true);
    RoadAudio.chime();
    toast(`Bought a jerry can and filled it (−£${CAN_PRICE})`);
  }
  function carStyle() {
    if (!settings.car) settings.car = { paint: 'oxide', shape: 'estate' };
    return settings.car;
  }
  function owned() {
    if (!stats.owned) stats.owned = { paints: ['oxide'], shapes: ['estate'] };
    return stats.owned;
  }
  function pickStyle(kind, id, price, name) {
    const o = owned();
    const list = kind === 'paint' ? o.paints : o.shapes;
    if (!list.includes(id)) {
      if (state.money < price) { toast(`That costs \u00a3${price}. Pick up a few more hitchhikers.`); return; }
      state.money -= price;
      list.push(id);
      RoadAudio.chime();
      toast(kind === 'paint' ? `Resprayed in ${name} (\u2212\u00a3${price})` : `Your car is now a ${name.toLowerCase()} (\u2212\u00a3${price})`);
    } else {
      toast(kind === 'paint' ? `Switched to ${name}` : `Switched to the ${name.toLowerCase()}`);
    }
    if (kind === 'paint') carStyle().paint = id; else carStyle().shape = id;
    saveSettings();
    LR.save(LR.KEYS.stats, stats);
    persist(true);
  }

  // ---- the garage at open fuel stations ----
  function garageOpen() { return ui.garage.classList.contains('open'); }
  function openGarage() {
    if (!atOpenStation(state.cam + carX) || state.v > 1.5) { toast('The garage is at the fuel station. Stop there to go in.'); return; }
    state.v = 0;
    input.go = input.brake = false;
    renderGarage();
    ui.garage.classList.add('open');
    ui.garage.setAttribute('aria-hidden', 'false');
  }
  function closeGarage() {
    ui.garage.classList.remove('open');
    ui.garage.setAttribute('aria-hidden', 'true');
    if (document.activeElement) document.activeElement.blur();
  }
  function renderGarage() {
    ui.garageMoney.textContent = `\u00a3${state.money}`;
    const items = [];
    const cansFull = state.cans.filter(Boolean).length;
    items.push({
      name: 'Jerry can',
      desc: `Holds ${CAN_FUEL}% of a tank. Comes full. Empty cans are refilled for \u00a3${CAN_FILL_PRICE} each when you fill up at a pump. Stop the car to pour it in. You have ${state.cans.length} of ${MAX_CANS}${state.cans.length ? ` (${cansFull} full)` : ''}.`,
      price: CAN_PRICE,
      can: state.cans.length < MAX_CANS,
      why: 'The boot is full',
      buy: buyCan
    });
    const nextSeat = state.seats + 1;
    items.push({
      name: nextSeat === 2 ? 'Fold-down back seat' : 'Bench seat in the boot',
      desc: state.seats >= MAX_SEATS
        ? `All ${MAX_SEATS} passenger seats fitted.`
        : `Carry ${nextSeat} hitchhikers at once instead of ${state.seats}. More passengers, more fares.`,
      price: SEAT_PRICES[nextSeat] || 0,
      can: state.seats < MAX_SEATS,
      why: 'Fully fitted',
      buy: buySeat
    });
    ui.garageList.innerHTML = '';
    const heading = (t) => { const h = document.createElement('p'); h.className = 'g-section'; h.textContent = t; ui.garageList.appendChild(h); };
    heading('Supplies and seats');
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'g-item';
      const text = document.createElement('div');
      const n = document.createElement('p'); n.className = 'g-name'; n.textContent = it.name;
      const d = document.createElement('p'); d.className = 'g-desc'; d.textContent = it.desc;
      text.append(n, d);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'g-buy';
      if (!it.can) { b.textContent = it.why; b.disabled = true; }
      else if (state.money < it.price) { b.textContent = `\u00a3${it.price}`; b.disabled = true; b.title = 'Not enough money yet'; }
      else b.textContent = `Buy \u00a3${it.price}`;
      b.addEventListener('click', () => { it.buy(); renderGarage(); });
      row.append(text, b);
      ui.garageList.appendChild(row);
    }

    // paint
    heading('Paint');
    const sw = document.createElement('div');
    sw.className = 'g-swatches';
    for (const pnt of PAINTS) {
      const have = owned().paints.includes(pnt.id);
      const using = carStyle().paint === pnt.id;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'g-swatch' + (using ? ' using' : '');
      b.innerHTML = `<i style="background:${pnt.hex}"></i><span>${pnt.name}</span><em>${using ? 'Your car' : have ? 'Owned' : '\u00a3' + pnt.price}</em>`;
      b.disabled = using || (!have && state.money < pnt.price);
      b.addEventListener('click', () => { pickStyle('paint', pnt.id, pnt.price, pnt.name); renderGarage(); });
      sw.appendChild(b);
    }
    ui.garageList.appendChild(sw);

    // body
    heading('Body');
    for (const [id, sh] of Object.entries(SHAPES)) {
      const have = owned().shapes.includes(id);
      const using = carStyle().shape === id;
      const row = document.createElement('div');
      row.className = 'g-item';
      const text = document.createElement('div');
      const n = document.createElement('p'); n.className = 'g-name'; n.textContent = sh.name;
      const d = document.createElement('p'); d.className = 'g-desc'; d.textContent = sh.desc;
      text.append(n, d);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'g-buy';
      if (using) { b.textContent = 'Your car'; b.disabled = true; }
      else if (have) b.textContent = 'Switch';
      else { b.textContent = `Buy \u00a3${sh.price}`; b.disabled = state.money < sh.price; }
      b.addEventListener('click', () => { pickStyle('shape', id, sh.price, sh.name); renderGarage(); });
      row.append(text, b);
      ui.garageList.appendChild(row);
    }
    ui.garageList.appendChild(Object.assign(document.createElement('p'), { className: 'g-note', textContent: 'Paint and bodies you buy are yours to keep, even after a new journey.' }));
  }
  function buySeat() {
    const next = state.seats + 1;
    const price = SEAT_PRICES[next];
    if (!price || state.money < price) return;
    state.money -= price;
    state.seats = next;
    RoadAudio.chime();
    toast(`Fitted a new seat. You can now carry ${state.seats} hitchhikers.`);
    persist(true);
  }

  function useCan() {
    const i = state.cans.indexOf(true);
    if (i < 0) { toast(state.cans.length ? 'Your jerry cans are empty. Fill them at a fuel station.' : 'You don’t have a jerry can. Buy one at the garage.'); return false; }
    if (state.v > 0.5) { toast('Stop the car first, then you can pour in the jerry can.'); return false; }
    if (state.fuel > 97) { toast('Your tank is already full.'); return false; }
    state.cruise = false;
    input.go = input.brake = false;
    Minigames.open('can', {
      data: { amount: CAN_FUEL, fuel: state.fuel },
      onWin: (r) => {
        state.cans[i] = false;
        state.fuel = Math.min(100, state.fuel + r.added);
        toast(r.spilled > 3 ? `Can emptied, though you spilt about ${Math.round(r.spilled)}% on the road.` : 'You poured the whole can in without spilling a drop.');
        persist(true);
      }
    });
    return true;
  }

  function fillCans() {
    const empties = state.cans.filter((c) => !c).length;
    if (!empties) return;
    const afford = Math.min(empties, Math.floor(state.money / CAN_FILL_PRICE));
    if (!afford) { toast(`Filling a jerry can costs \u00a3${CAN_FILL_PRICE}. Pick up some hitchhikers to earn more.`); return; }
    let filled = 0;
    state.cans = state.cans.map((c) => { if (c || filled >= afford) return c; filled++; return true; });
    state.money -= filled * CAN_FILL_PRICE;
    track('fuel_filled');
    RoadAudio.glug();
    toast(`Filled ${filled === 1 ? 'a jerry can' : `${filled} jerry cans`} (\u2212\u00a3${filled * CAN_FILL_PRICE}).`);
    persist(true);
  }

  function fillUp() {
    const carW = state.cam + carX;
    if (!atOpenStation(carW)) return;
    if (state.v > 0.5) { toast('Stop at the pump first.'); return; }
    if (state.fuel >= 92) { toast('Your tank is already full.'); return; }
    input.go = input.brake = false;
    state.cruise = false;
    Minigames.open('pump', {
      data: { fuel: state.fuel },
      onWin: (r) => {
        state.fuel = r.fuel;
        track('fuel_filled');
        const empties = state.cans.filter((c) => !c).length;
        const afford = Math.min(empties, Math.floor(state.money / CAN_FILL_PRICE));
        let filled = 0;
        state.cans = state.cans.map((c) => { if (c || filled >= afford) return c; filled++; return true; });
        if (filled) { state.money -= filled * CAN_FILL_PRICE; }
        let msg = r.spilled ? 'Full, but you splashed petrol down the side of the car.' : 'Filled up to the brim.';
        if (filled) msg += ` You filled ${filled === 1 ? 'your jerry can' : `${filled} jerry cans`} too (\u2212\u00a3${filled * CAN_FILL_PRICE}).`;
        if (filled < empties) msg += ` You couldn’t afford to fill ${empties - filled === 1 ? 'the other can' : `${empties - filled} more cans`} (\u00a3${CAN_FILL_PRICE} each).`;
        toast(msg);
        persist(true);
      },
      onCancel: (r) => { if (r && r.fuel > state.fuel) { state.fuel = r.fuel; toast(`You stopped pumping at ${Math.round(r.fuel)}%.`); } }
    });
  }

  function honk() {
    RoadAudio.horn();
    const carW = state.cam + carX;
    if (spots.some((sp) => sp.kind === 'sheep' && !state.done.has(sp.id) && sp.m * PXM > carW && sp.m * PXM - carW < 600)) {
      setTimeout(() => RoadAudio.baa(), 350);
      toast('The sheep just stare at you. You\u2019ll have to shoo them yourself.');
    }
  }

  // ---- roadside jobs (minigames) ----
  const BLOCKERS = { sheep: 80, tree: 40, rocks: 50, gate: 30, ford: 90 };
  function blockerAhead(carW) {
    for (const sp of spots) {
      if (!(sp.kind in BLOCKERS) || state.done.has(sp.id)) continue;
      const start = sp.m * PXM - BLOCKERS[sp.kind];
      const gap = start - (carW + 62);
      if (gap > -20 && gap < 360) return sp;
    }
    return null;
  }
  function startJob(kind, onDone, doneMsg, payMsg) {
    state.v = 0;
    state.cruise = false;
    input.go = input.brake = false;
    Minigames.open(kind, {
      money: state.money,
      onWin: () => { onDone(); toast(doneMsg); persist(true); },
      onPay: (cost) => { state.money = Math.max(0, state.money - cost); onDone(); toast(payMsg(cost)); persist(true); }
    });
  }
  function clearBlocker(sp) {
    const msgs = {
      tree: ['You cut the tree up and dragged it clear.', (c) => `A farmer turns up with a tractor and clears it (\u2212\u00a3${c}).`],
      rocks: ['You rolled the rocks off the road.', (c) => `A farmer clears the rocks with his loader (\u2212\u00a3${c}).`],
      sheep: ['The road\u2019s clear. The sheep look unimpressed.', (c) => `The farmer whistles and the sheep trot off (\u2212\u00a3${c}).`],
      gate: ['Gate open. You drive through and close it behind you, like a good visitor.', (c) => `The farmer opens the gate for you (\u2212\u00a3${c}).`],
      ford: ['You made it across the ford without drowning the engine.', (c) => `A tractor tows you across the ford (\u2212\u00a3${c}).`]
    }[sp.kind];
    startJob(sp.kind, () => { state.done.add(sp.id); (ev[sp.id] || (ev[sp.id] = {})).t = state.time; }, msgs[0], msgs[1]);
  }
  function getUnstuck() {
    startJob('mud', () => { state.stuck = null; state.v = 2.5; }, 'You rocked the car free of the mud.', (c) => `A tractor tows you out of the mud (\u2212\u00a3${c}).`);
  }
  function cleanScreen() {
    startJob('wipe', () => { state.mucky = false; }, 'Windscreen clean. You can see the road again.', (c) => `You pay a lad at the farm shop to wash it (\u2212\u00a3${c}).`);
  }
  function jumpStart() {
    startJob('jump', () => { state.dead = false; }, 'The engine catches. You thank the other driver and pack the leads away.', (c) => `Roadside recovery gets you going (\u2212\u00a3${c}).`);
  }
  function changeTyre() {
    startJob('tyre', () => { state.flat = false; }, 'Spare wheel on. Off you go.', (c) => `Roadside recovery fits a new tyre (\u2212\u00a3${c}).`);
  }

  function updateJourney(dt, carW) {
    const carM = carW / PXM;
    ensureSpots(carM + 1500);
    const front = carW + 62;
    for (const sp of spots) {
      if (sp.m < carM - 200) continue;
      if (sp.m > carM + 300) break;
      const x = sp.m * PXM;
      const e = ev[sp.id] || (ev[sp.id] = { wait: 0, t: -1 });
      if (state.done.has(sp.id)) continue;
      if (sp.kind === 'hitch') {
        if (state.passengers.length < state.seats && Math.abs(x - carW) < 80 && state.v < 1.5) {
          const h = hitchInfo(sp);
          state.passengers.push({ name: h.name, dest: h.dest, from: sp.m, coat: h.coat });
          state.done.add(sp.id);
          state.chatT = 30 + Math.random() * 20;
          caption(`${h.name}: Thanks for stopping. Could you take me as far as ${placeName(h.dest)}? I’ll pay you £${fareFor(sp.m, h.dest)}.`);
        }
      } else if (sp.kind in BLOCKERS) {
        const start = x - BLOCKERS[sp.kind];
        if (front > start && front < start + 220) {
          if (state.v > 3) {
            RoadAudio.bump();
            if (sp.kind === 'sheep') charge(10, 'You clipped a sheep. The farmer wants \u00a310 for the vet.');
            else if (sp.kind === 'tree') charge(15, 'You hit the fallen tree. Fixing the bumper costs \u00a315.');
            else if (sp.kind === 'gate') charge(20, 'You went into the gate. The farmer wants \u00a320 for a new one.');
            else if (sp.kind === 'ford') charge(5, 'Splash! You hit the water too fast and stopped dead.');
            else charge(15, 'You hit a rock. Fixing the bumper costs \u00a315.');
          }
          state.v = 0;
          state.cruise = false;
          state.cam = start - 62 - carX;
        }
      } else if (sp.kind === 'mud') {
        if (carW > x - 10 && state.stuck == null) {
          state.done.add(sp.id);
          state.stuck = sp.id;
          state.v = 0;
          state.cruise = false;
          toast('The wheels sink into a patch of deep mud. You\u2019re stuck.');
        }
      } else if (sp.kind === 'glass') {
        if (carW > x) {
          state.done.add(sp.id);
          if (state.v > 4 && !state.flat) {
            state.flat = true;
            state.cruise = false;
            RoadAudio.bump();
            toast('Bang. Something sharp on the road: you\u2019ve got a puncture.');
          }
        }
      } else if (sp.kind === 'tractor') {
        if (e.t < 0 && x > carW && x - carW < 700) e.t = state.time;   // tractor comes the other way
        if (carW > x - 40) {
          state.done.add(sp.id);
          if (state.v > 2) {
            state.mucky = true;
            state.cruise = false;
            RoadAudio.bump();
            toast('A tractor roars past and sprays mud all over your windscreen. You can hardly see.');
          }
        }
      } else if (sp.kind === 'battery') {
        if (carW > x) {
          state.done.add(sp.id);
          if (!state.dead) {
            state.dead = true;
            state.cruise = false;
            toast('The engine coughs, splutters and dies. The battery’s flat.');
          }
        }
      } else if (sp.kind === 'cash') {
        if (carW > x) {
          state.done.add(sp.id);
          const amt = sp.r < 0.7 ? 5 : 10;
          earn(amt, `You spotted a £${amt} note on the verge.`);
        }
      } else if (sp.kind === 'deer') {
        if (e.t < 0 && x > carW && x - carW < 420) {
          state.done.add(sp.id);
          if (state.dark > 0.4 || sp.r < 0.3) {
            e.t = state.time;
            if (state.v > 16) { state.v *= 0.6; toast('A deer leaps across the road. You brake on instinct.'); }
          }
        }
      }
    }

    if (state.passengers.length) {
      state.chatT -= dt;
      if (state.chatT <= 0 && state.v > 2) {
        const p = state.passengers[Math.floor(Math.random() * state.passengers.length)];
        caption(`${p.name}: ${CHAT[Math.floor(Math.random() * CHAT.length)]}`);
        state.chatT = 50 + Math.random() * 40;
      }
      for (const p of state.passengers.slice()) {
        const signX = p.dest * PLACE_EVERY * PXM - 60;
        if (carW > signX - 240 && carW < signX + 300 * PXM && state.v < 1.5) dropOff(p, false);
        else if (carW > signX + 300 * PXM) dropOff(p, true);
      }
    }
  }

  // ---- drawing ----
  function drawPerson(x, base, coat, ink, skin, card, wave, dest) {
    ctx.fillStyle = rgb(ink);
    ctx.fillRect(x - 4, base - 14, 3, 14);
    ctx.fillRect(x + 1, base - 14, 3, 14);
    ctx.fillStyle = rgb(mix(coat, ink, 0.35));
    ctx.fillRect(x - 10, base - 30, 6, 14);           // backpack
    ctx.fillStyle = rgb(coat);
    ctx.fillRect(x - 5, base - 31, 10, 18);           // coat
    ctx.fillStyle = rgb(skin);
    ctx.beginPath(); ctx.arc(x, base - 35.5, 4.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgb(ink);
    ctx.fillRect(x - 4.5, base - 40.5, 9, 3);         // hat
    // arm out with thumb up
    ctx.strokeStyle = rgb(coat);
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x + 4, base - 27);
    ctx.lineTo(x + 13, base - 31 - wave);
    ctx.stroke();
    ctx.fillStyle = rgb(skin);
    ctx.fillRect(x + 12, base - 35 - wave, 2.2, 4);
    // cardboard sign with where they're going
    if (dest) {
      ctx.font = '500 6.5px "IBM Plex Mono", monospace';
      const w = Math.max(28, ctx.measureText(dest).width + 6);
      ctx.fillStyle = rgb(card);
      ctx.fillRect(x - 6 - w, base - 27, w, 10);
      ctx.fillStyle = rgb(ink);
      ctx.textAlign = 'center';
      ctx.fillText(dest, x - 6 - w / 2, base - 19.5);
      ctx.textAlign = 'left';
    }
  }

  function drawSpotsBehind(dark, shade) {
    const camM = state.cam / PXM;
    ensureSpots(camM + W / PXM + 200);
    const ink = shade(hex('#26231f')), skin = shade(hex('#c9a084')), card = shade(hex('#c8b48a'));
    for (const sp of spots) {
      if (sp.m < camM - 40) continue;
      if (sp.m > camM + W / PXM + 40) break;
      const x = sp.m * PXM - state.cam;
      const base = roadY(sp.m * PXM) - 3;
      if (sp.kind === 'hitch' && !state.done.has(sp.id)) {
        const h = hitchInfo(sp);
        const wave = Math.sin(state.time * 3 + sp.id) * 2;
        drawPerson(x, base, shade(hex(h.coat)), ink, skin, card, wave, placeName(h.dest).toUpperCase());
      } else if (sp.kind === 'cash' && !state.done.has(sp.id)) {
        const a = 0.5 + 0.5 * Math.sin(state.time * 5 + sp.id);
        ctx.fillStyle = rgb(shade(hex('#b9c7a8'), -0.2));
        ctx.fillRect(x - 4, base - 3, 8, 3);
        ctx.strokeStyle = `rgba(255,250,230,${0.35 + a * 0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 6, base - 6); ctx.lineTo(x + 6, base - 6);
        ctx.moveTo(x, base - 12); ctx.lineTo(x, base);
        ctx.stroke();
      } else if (sp.kind === 'view') {
        const post = shade(hex('#3b342c'));
        ctx.fillStyle = rgb(post);
        ctx.fillRect(x - 1.5, base - 52, 3, 52);
        ctx.fillStyle = rgb(shade(hex('#6b4a2e'), -0.1));
        ctx.fillRect(x - 36, base - 70, 72, 20);
        ctx.fillStyle = rgb(shade(hex('#efe7d6'), -0.15));
        ctx.font = '500 9.5px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(state.done.has(sp.id) ? 'VIEWPOINT ✓' : 'VIEWPOINT', x, base - 56.5);
        ctx.textAlign = 'left';
        // bench
        ctx.fillStyle = rgb(post);
        ctx.fillRect(x + 22, base - 10, 26, 2.5);
        ctx.fillRect(x + 22, base - 16, 26, 2);
        ctx.fillRect(x + 24, base - 10, 2, 10);
        ctx.fillRect(x + 44, base - 10, 2, 10);
      }
    }
  }

  function drawSheep(x, y, wool, ink, dir) {
    ctx.fillStyle = rgb(ink);
    for (const lx of [-5, -2, 3, 6]) ctx.fillRect(x + lx, y - 6, 1.6, 6);
    ctx.fillStyle = rgb(wool);
    ctx.beginPath();
    ctx.ellipse(x, y - 10, 9.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(ink);
    ctx.beginPath();
    ctx.ellipse(x + dir * 10, y - 12, 3.4, 2.6, dir * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSpotsOnRoad(dark, shade) {
    const camM = state.cam / PXM;
    const wool = shade(hex('#d8d3c6'), -0.1), ink = shade(hex('#24211d'));
    for (const sp of spots) {
      if (sp.m < camM - 60) continue;
      if (sp.m > camM + W / PXM + 60) break;
      const x0 = sp.m * PXM - state.cam;
      const e = ev[sp.id] || { t: -1 };
      const gone = state.done.has(sp.id);
      const since = e.t >= 0 ? state.time - e.t : 0;
      if (sp.kind === 'sheep' && (!gone || (e.t >= 0 && since < 2.5))) {
        const k = gone ? smooth(0, 2.5, since) : 0;
        ctx.globalAlpha = 1 - k;
        const n = 5 + Math.floor(sp.r * 5);
        for (let i = 0; i < n; i++) {
          const ox = (hash2(i, sp.id) - 0.5) * 140;
          const x = x0 + ox + k * (hash2(i, sp.id + 1) - 0.3) * 120;
          const y = roadY(sp.m * PXM + ox) + 8 + (hash2(i, sp.id + 2) - 0.5) * 6 - k * 40;
          const bob = gone ? 0 : Math.sin(state.time * 2 + i) * 0.6;
          drawSheep(x, y + bob, wool, ink, hash2(i, sp.id + 3) < 0.5 ? -1 : 1);
        }
        ctx.globalAlpha = 1;
      } else if (sp.kind === 'tree' && (!gone || (e.t >= 0 && since < 2))) {
        const k = gone ? smooth(0, 2, since) : 0;
        ctx.globalAlpha = 1 - k;
        const base = roadY(sp.m * PXM) + 8;
        ctx.save();
        ctx.translate(x0 - k * 60, base - k * 30);
        ctx.rotate(-0.42 - k * 0.3);
        ctx.fillStyle = rgb(shade(hex('#4a3a2c')));
        ctx.fillRect(-10, -6, 150, 11);
        ctx.strokeStyle = rgb(shade(hex('#4a3a2c')));
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [bx, by, ex, ey] of [[40, -4, 60, -26], [70, 4, 95, 22], [95, -4, 120, -24], [118, 2, 150, 14]]) { ctx.moveTo(bx, by); ctx.lineTo(ex, ey); }
        ctx.stroke();
        ctx.fillStyle = rgb(shade(hex('#3a4a33')));
        ctx.beginPath();
        for (const [cx, cy, r] of [[130, -8, 22], [150, 6, 18], [108, -22, 16], [118, 16, 15]]) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, Math.PI * 2); }
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (sp.kind === 'rocks' && (!gone || (e.t >= 0 && since < 1.5))) {
        const k = gone ? smooth(0, 1.5, since) : 0;
        ctx.globalAlpha = 1 - k;
        for (let i = 0; i < 6; i++) {
          const ox = (hash2(i, sp.id + 7) - 0.5) * 90;
          const r = 5 + hash2(i, sp.id + 8) * 9;
          const y = roadY(sp.m * PXM + ox) + 9 - r * 0.6 - k * 30;
          ctx.fillStyle = rgb(shade(hex(i % 2 ? '#7d7d77' : '#68695f')));
          ctx.beginPath();
          ctx.ellipse(x0 + ox, y, r * 1.2, r, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (sp.kind === 'mud') {
        const base = roadY(sp.m * PXM) + 6;
        ctx.fillStyle = rgb(shade(hex('#4a3826')));
        ctx.beginPath();
        ctx.ellipse(x0, base, 46, 7, 0, 0, Math.PI * 2);
        ctx.ellipse(x0 + 30, base + 2, 22, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgb(shade(mix(hex('#4a3826'), hex('#9aa3a3'), 0.35)), 0.6);
        ctx.beginPath(); ctx.ellipse(x0 - 8, base - 1, 18, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      } else if (sp.kind === 'glass' && !gone) {
        const base = roadY(sp.m * PXM) + 5;
        const a = 0.35 + 0.35 * Math.sin(state.time * 6 + sp.id);
        ctx.fillStyle = `rgba(220,232,236,${a})`;
        for (let i = 0; i < 7; i++) ctx.fillRect(x0 + (hash2(i, sp.id) - 0.5) * 30, base + (hash2(i, sp.id + 1) - 0.5) * 4, 2.5, 1.5);
      } else if (sp.kind === 'gate' && (!gone || (e.t >= 0 && since < 1.2))) {
        // a five-bar farm gate across the road, swinging open once you've done the job
        const k = gone ? smooth(0, 1.2, since) : 0;
        const gx = x0 - 6, base = roadY(sp.m * PXM) + 8;
        const post = rgb(shade(hex('#4a3a2c'))), bar = rgb(shade(hex('#b9ad94')));
        ctx.fillStyle = post;
        ctx.fillRect(gx - 4, base - 46, 7, 50);
        ctx.fillRect(gx + 64, base - 46, 7, 50);
        ctx.save();
        ctx.translate(gx + 2, base - 6);
        ctx.scale(Math.cos(k * 1.4), 1);
        ctx.fillStyle = bar;
        for (let i = 0; i < 5; i++) ctx.fillRect(0, -36 + i * 8, 62, 3.2);
        ctx.fillRect(0, -36, 3.5, 36);
        ctx.fillRect(58, -36, 3.5, 36);
        ctx.save(); ctx.translate(2, -2); ctx.rotate(-0.5); ctx.fillRect(0, -1.6, 68, 3.2); ctx.restore();
        ctx.restore();
      } else if (sp.kind === 'ford' && (!gone || (e.t >= 0 && since < 3))) {
        // brown flood water lying across the dip in the road
        const k = gone ? smooth(0, 3, since) : 0;
        const base = roadY(sp.m * PXM) + 7;
        ctx.globalAlpha = 1 - k * 0.8;
        ctx.fillStyle = rgb(shade(mix(hex('#6b6450'), hex('#a9b8bc'), 0.5)));
        ctx.beginPath();
        ctx.ellipse(x0 + 20, base + 1, 150, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgb(shade(hex('#dfe6e4')), 0.25);
        ctx.beginPath();
        ctx.ellipse(x0, base - 3, 110, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = rgb(shade(hex('#c9d2d0')), 0.5);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const wx = x0 - 70 + i * 40 + Math.sin(state.time * 1.5 + i) * 6;
          ctx.moveTo(wx, base - 2 + (i % 2) * 3); ctx.lineTo(wx + 18, base - 2 + (i % 2) * 3);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (!gone) {
          // depth post
          ctx.fillStyle = rgb(shade(hex('#d9d6cc')));
          ctx.fillRect(x0 - 110, base - 34, 4, 34);
          ctx.fillStyle = rgb(shade(hex('#b5462f')));
          for (let i = 0; i < 3; i++) ctx.fillRect(x0 - 110, base - 30 + i * 10, 4, 4);
        }
      } else if (sp.kind === 'tractor' && e.t >= 0 && since < 6) {
        // a tractor coming the other way, flinging mud off its back wheels
        const tx = x0 + 300 - since * 140;
        const base = roadY(sp.m * PXM + 300 - since * 140) + 2;
        const body = rgb(shade(hex('#5d7a3a'))), dark = rgb(shade(hex('#1d1e1f')));
        ctx.fillStyle = body;
        ctx.fillRect(tx - 34, base - 30, 40, 16);
        ctx.fillRect(tx - 4, base - 52, 26, 36);
        ctx.fillStyle = rgb(shade(hex('#9fb0b8')), 0.6);
        ctx.fillRect(tx, base - 48, 18, 14);
        ctx.fillStyle = dark;
        ctx.beginPath(); ctx.arc(tx + 10, base - 14, 15, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(tx - 26, base - 9, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgb(shade(hex('#4a3826')));
        for (let i = 0; i < 5; i++) {
          const a = state.time * 9 + i * 1.3;
          ctx.fillRect(tx + 24 + (a % 3) * 10, base - 20 - ((a * 7) % 18), 3, 3);
        }
      } else if (sp.kind === 'deer' && e.t >= 0 && since < 1.5) {
        const k = since / 1.5;
        const x = x0 - 30 + k * 160;
        const y = roadY(sp.m * PXM) + 4 - Math.sin(k * Math.PI) * 34 - k * 30;
        const sc = 1 - k * 0.45;
        ctx.globalAlpha = 1 - smooth(0.7, 1, k);
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(sc, sc);
        const c = shade(hex('#6a4a32'));
        ctx.fillStyle = rgb(c);
        ctx.strokeStyle = rgb(c);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, -18, 14, 6.5, -0.15, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(11, -22); ctx.lineTo(17, -34);
        ctx.moveTo(-10, -14); ctx.lineTo(-20, -4);
        ctx.moveTo(-6, -14); ctx.lineTo(-14, -2);
        ctx.moveTo(8, -14); ctx.lineTo(20, -8);
        ctx.moveTo(11, -15); ctx.lineTo(24, -12);
        ctx.stroke();
        ctx.beginPath(); ctx.ellipse(19, -36, 4.5, 2.6, 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // The car
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Car shapes and paint (bought at the garage, kept for good once bought)
  // ---------------------------------------------------------------------------
  const PAINTS = [
    { id: 'oxide', name: 'Oxide red', hex: '#7a3e30', price: 0 },
    { id: 'green', name: 'Racing green', hex: '#2f4a3a', price: 15 },
    { id: 'navy', name: 'Navy', hex: '#2c3a52', price: 15 },
    { id: 'cream', name: 'Cream', hex: '#d3c8ad', price: 15 },
    { id: 'mustard', name: 'Mustard', hex: '#b08a35', price: 15 },
    { id: 'sky', name: 'Faded sky', hex: '#6c8ea3', price: 15 },
    { id: 'charcoal', name: 'Charcoal', hex: '#34373b', price: 15 },
    { id: 'plum', name: 'Plum', hex: '#5b3a4e', price: 15 }
  ];
  const poly = (pts) => {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.length === 4) ctx.quadraticCurveTo(p[0], p[1], p[2], p[3]); else ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
  };
  const NOSE = [[32, -30], [51, -27], [59, -26, 60, -19], [60, -10], [59, -5, 54, -5]];
  const FRONT_WINDOW = [[-10, -30], [-10, -46], [12, -46], [16, -46, 18, -43], [27, -30]];
  const SHAPES = {
    estate: {
      name: 'Estate', desc: 'The old faithful, with a roof rack.', price: 0,
      body: [[-55, -5], [-58, -19], [-58, -27, -51, -27], [-45, -27], [-41, -46], [-40, -50, -35, -50], [13, -50], [18, -50, 21, -46], ...NOSE],
      windows: [[[-39, -30], [-36, -46], [-14, -46], [-14, -30]], FRONT_WINDOW],
      seats: [[-25, -38.5], [6, -38.5], [-33, -38.5]], rear: -58, rack: true, doors: true
    },
    hatch: {
      name: 'Hatchback', desc: 'Shorter and nippier-looking.', price: 25,
      body: [[-50, -5], [-52, -20], [-50, -28], [-38, -48], [-34, -50, -30, -50], [13, -50], [18, -50, 21, -46], ...NOSE],
      windows: [[[-44, -30], [-35, -46], [-14, -46], [-14, -30]], FRONT_WINDOW],
      seats: [[-24, -38.5], [6, -38.5], [-33, -36]], rear: -52, rack: false, doors: true
    },
    coupe: {
      name: 'Coupé', desc: 'Low, sleek and a bit impractical.', price: 60,
      body: [[-55, -5], [-58, -18], [-58, -25, -51, -26], [-28, -41], [-22, -44, -14, -44], [6, -44], [12, -44, 16, -40], [30, -28], [51, -25], [59, -24, 60, -17], [60, -10], [59, -5, 54, -5]],
      windows: [[[-36, -29], [-26, -38], [-14, -40], [-14, -29]], [[-10, -29], [-10, -40], [6, -40], [10, -40, 13, -37], [24, -29]]],
      seats: [[-22, -34], [4, -34], [-28, -33]], rear: -58, rack: false, doors: true
    },
    pickup: {
      name: 'Pickup', desc: 'Open back. Hitchhikers can ride in the bed.', price: 45,
      body: [[-58, -5], [-60, -27], [-12, -27], [-10, -48], [-6, -50], [13, -50], [18, -50, 21, -46], ...NOSE],
      windows: [[[-7, -30], [-5, -46], [12, -46], [16, -46, 18, -43], [27, -30]]],
      seats: [[4, -38.5], [-42, -31], [-26, -31]], rear: -60, rack: false, doors: false, bed: true
    },
    van: {
      name: 'Camper van', desc: 'Tall, roomy and slow-looking.', price: 70,
      body: [[-58, -5], [-59, -62], [-59, -66, -54, -66], [20, -66], [26, -66, 28, -60], [36, -34], [51, -29], [59, -27, 60, -19], [60, -10], [59, -5, 54, -5]],
      windows: [[[-53, -58], [-36, -58], [-36, -44], [-53, -44]], [[-31, -58], [-14, -58], [-14, -44], [-31, -44]], [[-9, -58], [10, -58], [10, -44], [-9, -44]], [[14, -58], [22, -58], [31, -38], [14, -38]]],
      seats: [[-44, -48], [0, -48], [-22, -48]], rear: -59, rack: false, doors: false, stripe: true, roofbox: true
    }
  };

  function drawCar(cx, cy, angle, wheelRot, c) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // wheel wells
    ctx.fillStyle = rgb(c.under);
    for (const wx of [-34, 34]) { ctx.beginPath(); ctx.arc(wx, 0, 13.5, 0, Math.PI * 2); ctx.fill(); }

    const S = SHAPES[c.shape] || SHAPES.estate;

    // body
    ctx.beginPath();
    poly(S.body);
    ctx.fillStyle = rgb(c.body);
    ctx.fill();

    // lower shading
    ctx.fillStyle = rgb(c.shade);
    ctx.fillRect(S.rear + 1, -14, 60 - S.rear - 1, 6);
    ctx.beginPath();
    ctx.moveTo(S.rear + 2, -8); ctx.lineTo(60, -8); ctx.quadraticCurveTo(59, -5, 54, -5); ctx.lineTo(S.rear + 3, -5); ctx.closePath();
    ctx.fill();
    if (S.stripe) {
      ctx.fillStyle = rgb(c.trim, 0.85);
      ctx.fillRect(S.rear + 1, -34, 60 - S.rear - 4, 5);
    }

    // re-cut the wheel arches over the body
    ctx.fillStyle = rgb(c.under);
    for (const wx of [-34, 34]) {
      ctx.beginPath();
      ctx.arc(wx, 0, 14.5, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
    }

    // windows
    ctx.fillStyle = rgb(c.glass);
    ctx.beginPath();
    S.windows.forEach(poly);
    ctx.fill();

    // pickup bed
    if (S.bed) {
      ctx.fillStyle = rgb(c.under, 0.7);
      ctx.fillRect(S.rear + 2, -27, -12 - S.rear - 3, 2);
      ctx.fillStyle = rgb(c.case);
      ctx.fillRect(-52, -33, 14, 6);
    }

    // passengers
    for (let i = 0; i < (c.riders || 0); i++) {
      const [hx, hy] = S.seats[i];
      ctx.fillStyle = rgb(c.passenger, 0.85);
      ctx.beginPath(); ctx.arc(hx, hy, 4.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(hx - 6, hy + 4.5, 12, 4);
    }

    // trim and doors
    ctx.strokeStyle = rgb(c.trim, 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(S.rear + 1, -21); ctx.lineTo(59, -21);
    ctx.stroke();
    if (S.doors) {
      ctx.strokeStyle = rgb(c.shade, 0.9);
      ctx.beginPath();
      ctx.moveTo(-12, -29); ctx.lineTo(-12, -8);
      ctx.moveTo(16, -29); ctx.lineTo(16, -8);
      ctx.stroke();
    }

    // bumpers
    ctx.fillStyle = rgb(c.trim);
    ctx.fillRect(S.rear - 3, -11, 7, 3);
    ctx.fillRect(56, -11, 7, 3);

    // roof rack and luggage
    if (S.rack) {
      ctx.fillStyle = rgb(c.under);
      ctx.fillRect(-36, -53, 48, 1.6);
      ctx.fillRect(-33, -53, 1.6, 3);
      ctx.fillRect(8, -53, 1.6, 3);
      ctx.fillStyle = rgb(c.case);
      ctx.fillRect(-30, -63, 24, 10);
      ctx.fillRect(-4, -60, 12, 7);
      ctx.fillStyle = rgb(c.under, 0.6);
      ctx.fillRect(-19, -63, 2, 10);
    }
    if (S.roofbox) {
      ctx.fillStyle = rgb(c.under);
      ctx.beginPath(); poly([[-44, -66], [-40, -73], [2, -73], [6, -66]]); ctx.fill();
    }

    // lamps
    ctx.fillStyle = rgb(c.head);
    ctx.beginPath(); ctx.arc(57, -21, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgb(c.tail);
    ctx.fillRect((SHAPES[c.shape] || SHAPES.estate).rear - 1, -24, 2.5, 6);

    // wheels
    for (const wx of [-34, 34]) {
      ctx.fillStyle = rgb(c.tyre);
      ctx.beginPath();
      if (c.flat && wx > 0) ctx.ellipse(wx, 2, 12.5, 9, 0, 0, Math.PI * 2); else ctx.arc(wx, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(c.hub);
      ctx.beginPath(); ctx.arc(wx, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgb(c.tyre, 0.8);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = wheelRot + (k * Math.PI * 2) / 5;
        ctx.moveTo(wx, 0);
        ctx.lineTo(wx + Math.cos(a) * 6, Math.sin(a) * 6);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function local(cx, cy, angle, lx, ly) {
    const cs = Math.cos(angle), sn = Math.sin(angle);
    return [cx + lx * cs - ly * sn, cy + lx * sn + ly * cs];
  }

  // ---------------------------------------------------------------------------
  // Main draw
  // ---------------------------------------------------------------------------
  const NIGHT = hex('#10151c');
  const LAMP = hex('#ffcf8f');
  const CAR = {
    body: hex('#7a3e30'), shade: hex('#5a2c23'), glass: hex('#2a3236'), trim: hex('#c9c6bd'),
    under: hex('#1b1d1e'), tyre: hex('#161718'), hub: hex('#8d8f8c'), case: hex('#6b4a2e'),
    head: hex('#efe3c2'), tail: hex('#8e2a22')
  };

  function draw(dt) {
    const distM = (state.cam + carX) / PXM;
    const sky = skyAt(state.tod);
    const dark = 1 - sky.light;
    const pal = paletteAt(distM);
    const rain = clamp((noise(distM * 0.0009, 77) * 0.5 + 0.5) * 2.2 - 1.45, 0, 1);
    const density = clamp(0.6 + fbm(distM * 0.0011, 55, 2) * 0.3 + rain * 0.25, 0.3, 1);

    let fog = mix(sky.hor, sky.top, 0.18);
    fog = mix(fog, hex('#cfd2ce'), 0.22 * sky.light);
    tintFog(fog);

    const shade = (c, extra = 0) => mix(mix(c, sky.hor, 0.06), NIGHT, clamp(dark * 0.8 + extra, 0, 1));

    ctx.setTransform(scale, 0, 0, scale, 0, yOff * scale);

    // sky
    const sg = ctx.createLinearGradient(0, -yOff * 0.6, 0, 500);
    sg.addColorStop(0, rgb(sky.top));
    sg.addColorStop(1, rgb(sky.hor));
    ctx.fillStyle = sg;
    ctx.fillRect(0, -yOff, W, H + yOff);

    // stars
    const starA = clamp((dark - 0.55) * 2.4, 0, 1) * (1 - density * 0.55);
    if (starA > 0.01) {
      ctx.fillStyle = '#e8ecf2';
      for (const s of stars) {
        ctx.globalAlpha = starA * (0.45 + 0.35 * Math.sin(state.time * 0.8 + s.tw)) * (1 - s.y / 420);
        ctx.fillRect(s.x * W, s.y, s.s, s.s);
      }
      ctx.globalAlpha = 1;
    }

    // sun and moon, softened by the fog
    const sunT = (state.tod - 0.21) / 0.62;
    if (sunT > 0 && sunT < 1) {
      const x = W * (0.12 + 0.76 * sunT), y = 470 - Math.sin(Math.PI * sunT) * 330;
      const low = 1 - Math.sin(Math.PI * sunT);
      const col = mix(hex('#fff2dc'), hex('#ffb27f'), low);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 160);
      g.addColorStop(0, rgb(col, 0.55 - density * 0.2));
      g.addColorStop(0.12, rgb(col, 0.3));
      g.addColorStop(1, rgb(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - 160, y - 160, 320, 320);
      ctx.fillStyle = rgb(col, 0.75 - density * 0.35);
      ctx.beginPath(); ctx.arc(x, y, 17, 0, Math.PI * 2); ctx.fill();
    }
    const moonT = (((state.tod + 0.5) % 1) - 0.21) / 0.62;
    if (moonT > 0 && moonT < 1) {
      const x = W * (0.12 + 0.76 * moonT), y = 450 - Math.sin(Math.PI * moonT) * 300;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 90);
      g.addColorStop(0, `rgba(210,220,232,${0.22 * dark})`);
      g.addColorStop(1, 'rgba(210,220,232,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 90, y - 90, 180, 180);
      ctx.fillStyle = `rgba(226,230,236,${0.7 * dark})`;
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
    }

    // layered landscape, each layer washed further into the fog
    fillRidge(LAYERS.far, state.cam, pal.relief[0], shade(pal.far), 8);
    fogWash(fog, 0.55 * density, 250);
    fillRidge(LAYERS.mid, state.cam, pal.relief[1], shade(pal.mid), 7);
    fogWash(fog, 0.45 * density, 330);
    fogBanks(0.18, 470, 1.1, 0.75 * density, 300, 7);

    const extra = {
      snow: shade(mix(hex('#dfe3e4'), fog, 0.3)),
      birch: shade(mix(hex('#e6e3da'), fog, 0.35)),
      grass: shade(hex('#56603c')),
      water: shade(mix(mix(pal.front, sky.top, 0.45), fog, 0.2))
    };
    drawTreeLayer(LAYERS.back, pal, shade(pal.back), extra, distM);
    fogWash(fog, 0.38 * density, 380);
    fogBanks(0.4, 505, 0.95, 0.6 * density, 400, 5);
    drawTreeLayer(LAYERS.front, pal, shade(pal.front), extra, distM);
    fogWash(fog, 0.3 * density, 420);
    fogBanks(0.7, 540, 0.9, 0.55 * density, 500, 4);

    // near layer: poles, signs, fuel stops, road
    const near = shade(mix(pal.front, NIGHT, 0.25));
    drawPoles(mix(near, fog, 0.25));
    drawSigns(dark, near, shade(hex('#e4ddcc'), -0.15), shade(hex('#2d2b28')));
    drawStations(dark, shade(hex('#b9b1a2')), shade(hex('#3b3a37')), LAMP);
    drawMarkerPosts(shade(hex('#d8d4ca'), -0.1));
    state.dark = dark;
    drawSpotsBehind(dark, shade);

    // grass edge behind the road
    ctx.beginPath();
    for (let x = -10; x <= W + 10; x += 4) {
      const wx = x + state.cam;
      const t = hash2(Math.floor(wx / 4), 61);
      ctx.lineTo(x, roadY(wx) - 2 - t * 6);
    }
    ctx.lineTo(W + 10, H); ctx.lineTo(-10, H); ctx.closePath();
    ctx.fillStyle = rgb(shade(pal.verge));
    ctx.fill();

    // road band
    ctx.beginPath();
    for (let x = -10; x <= W + 10; x += 6) ctx.lineTo(x, roadY(x + state.cam));
    for (let x = W + 10; x >= -10; x -= 6) ctx.lineTo(x, roadY(x + state.cam) + 15);
    ctx.closePath();
    ctx.fillStyle = rgb(shade(hex('#33353a')));
    ctx.fill();
    ctx.beginPath();
    for (let x = -10; x <= W + 10; x += 6) ctx.lineTo(x, roadY(x + state.cam) + 0.5);
    ctx.strokeStyle = rgb(shade(hex('#7c7d7c')), 0.8);
    ctx.lineWidth = 1;
    ctx.stroke();

    // ground below road
    ctx.beginPath();
    for (let x = -10; x <= W + 10; x += 6) ctx.lineTo(x, roadY(x + state.cam) + 15);
    ctx.lineTo(W + 10, H); ctx.lineTo(-10, H); ctx.closePath();
    ctx.fillStyle = rgb(shade(pal.ground));
    ctx.fill();

    drawSpotsOnRoad(dark, shade);

    // car
    const carW = state.cam + carX;
    const yb = roadY(carW - 34), yf = roadY(carW + 34);
    const angle = Math.atan2(yf - yb, 68);
    const vN = state.v / MAX_V;
    const bounce = Math.sin(state.time * 11) * 0.35 * vN + noise(carW * 0.03, 88) * 0.7 * vN;
    const cy = (yb + yf) / 2 - 11 + bounce;

    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(carX, (yb + yf) / 2 + 2, 62, 4, angle, 0, Math.PI * 2);
    ctx.fill();

    // exhaust
    for (const p of particles) {
      const a = (1 - p.age / p.life) * 0.22;
      ctx.fillStyle = p.mud ? rgb(shade(hex('#4a3826')), Math.min(1, a * 3)) : rgb(mix(fog, hex('#ffffff'), 0.2), a);
      ctx.beginPath();
      ctx.arc(p.x - state.cam, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    const carCols = {};
    for (const k in CAR) carCols[k] = k === 'head' || k === 'tail' ? CAR[k] : shade(CAR[k]);
    const lightsOn = clamp(Math.max((dark - 0.3) * 2.2, rain * 0.7, (density - 0.85) * 3), 0, 1);
    if (lightsOn > 0.05) {
      carCols.head = mix(CAR.head, hex('#fff4d8'), lightsOn);
      carCols.tail = mix(CAR.tail, hex('#ff4a36'), lightsOn);
    }
    const paint = PAINTS.find((x) => x.id === carStyle().paint) || PAINTS[0];
    carCols.body = shade(hex(paint.hex));
    carCols.shade = shade(mix(hex(paint.hex), hex('#000000'), 0.27));
    carCols.shape = carStyle().shape;
    carCols.passenger = shade(hex('#1e1c1a'));
    carCols.riders = state.passengers.length;
    carCols.flat = state.flat;
    drawCar(carX, cy, angle, carW / 11, carCols);

    // headlights cutting through the mist
    if (lightsOn > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      const [hx, hy] = local(carX, cy, angle, 58, -21);
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(angle);
      const beam = ctx.createLinearGradient(0, 0, 460, 0);
      beam.addColorStop(0, rgb(LAMP, 0.32 * lightsOn));
      beam.addColorStop(1, rgb(LAMP, 0));
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.lineTo(460, -34);
      ctx.lineTo(460, 34);
      ctx.lineTo(0, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const halo = ctx.createRadialGradient(hx, hy, 0, hx, hy, 46);
      halo.addColorStop(0, rgb(LAMP, 0.5 * lightsOn));
      halo.addColorStop(1, rgb(LAMP, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(hx - 46, hy - 46, 92, 92);
      const [tx, ty] = local(carX, cy, angle, -59, -21);
      const tg = ctx.createRadialGradient(tx, ty, 0, tx, ty, 26);
      tg.addColorStop(0, `rgba(255,70,50,${0.4 * lightsOn})`);
      tg.addColorStop(1, 'rgba(255,70,50,0)');
      ctx.fillStyle = tg;
      ctx.fillRect(tx - 26, ty - 26, 52, 52);
      ctx.globalCompositeOperation = 'source-over';
    }

    // mist that drifts in front of the car
    fogWash(fog, 0.14 * density, 440);
    fogBanks(1.25, 560, 0.85, 0.42 * density, 600, 10);

    // dark foreground grass
    const fp = 1.6;
    ctx.beginPath();
    ctx.moveTo(-10, H);
    for (let x = -10; x <= W + 10; x += 3) {
      const wx = x + state.cam * fp;
      const hill = 706 + fbm(wx * 0.004, 71, 3) * 22;
      const blade = hash2(Math.floor(wx / 3), 72) * 10 * (noise(wx * 0.02, 73) * 0.5 + 0.6);
      ctx.lineTo(x, hill - blade);
    }
    ctx.lineTo(W + 10, H);
    ctx.closePath();
    ctx.fillStyle = rgb(mix(shade(pal.ground), NIGHT, 0.55));
    ctx.fill();

    // rain
    if (rain > 0.02) {
      ctx.strokeStyle = rgb(mix(fog, hex('#ffffff'), 0.3), 0.32 * rain);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const count = Math.floor(drops.length * rain * (settings.lowPower ? 0.35 : IS_TOUCH ? 0.6 : 1));
      for (let i = 0; i < count; i++) {
        const d = drops[i];
        d.y += d.sp * dt;
        d.x -= (d.sp * 0.12 + state.v * PXM * 0.6) * dt;
        if (d.y > H) { d.y = -20 - Math.random() * yOff; d.x = Math.random() * (W + 200); }
        if (d.x < -40) d.x += W + 200;
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.len * 0.15, d.y - d.len);
      }
      ctx.stroke();
    }

    // lightning
    if (state.flash > 0.01) {
      ctx.fillStyle = `rgba(232,236,242,${state.flash * 0.5})`;
      ctx.fillRect(0, -yOff, W, H + yOff);
      state.flash = Math.max(0, state.flash - dt * 2.6);
    }

    // mud sprayed over the windscreen
    if (state.mucky) {
      ctx.fillStyle = 'rgba(74,56,38,0.5)';
      ctx.fillRect(0, -yOff, W, H + yOff);
      ctx.fillStyle = 'rgba(64,48,32,0.45)';
      ctx.beginPath();
      for (let i = 0; i < 90; i++) {
        const mx = hash2(i, 91) * W, my = -yOff + hash2(i, 92) * (H + yOff), r = 10 + hash2(i, 93) * 38;
        ctx.moveTo(mx + r, my);
        ctx.ellipse(mx, my, r, r * (0.5 + hash2(i, 94) * 0.5), hash2(i, 95) * 3, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // vignette and film grain
    ctx.fillStyle = vignette;
    ctx.fillRect(0, -yOff, W, H + yOff);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.045;
    ctx.translate((Math.random() * 160) | 0, (Math.random() * 160) | 0);
    ctx.fillStyle = grainPattern;
    ctx.fillRect(-160, -160, canvas.width + 160, canvas.height + 160);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;

    return { distM, pal, rain, dark, carW, cy, angle };
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const ui = {
    place: $('place'), region: $('region'), km: $('km'), speed: $('speed'), speedLabel: $('speedLabel'),
    fuel: $('fuel'), prompt: $('prompt'), intro: $('intro'), resume: $('resume'), toast: $('toast'),
    flash: $('flash'), soundBtn: $('soundBtn'), radioBtn: $('radioBtn'), albumLink: $('albumLink'),
    settings: $('settings'), settingsBtn: $('settingsBtn'), closeSettings: $('closeSettings'), engineVol: $('engineVol'),
    radioVol: $('radioVol'), radioVolRow: $('radioVolRow'), soundAll: $('soundAll'), spotifyBox: $('spotifyBox'),
    spotifyLink: $('spotifyLink'), spotifyLoad: $('spotifyLoad'), spotifyError: $('spotifyError'),
    dock: $('spotifyDock'), dockHide: $('dockHide'), embed: $('spotifyEmbed'),
    acctForm: $('acctForm'), acctUser: $('acctUser'), acctPass: $('acctPass'), acctSignIn: $('acctSignIn'),
    acctCreate: $('acctCreate'), acctError: $('acctError'), acctName: $('acctName'), acctStatus: $('acctStatus'),
    acctSave: $('acctSave'), acctSignOut: $('acctSignOut'), introAcct: $('introAcct'),
    fullscreen: $('fullscreenToggle'), lowPower: $('lowPower'),
    screenBtn: $('screenBtn'), money: $('money'), cans: $('cans'), nextFuel: $('nextFuel'), passenger: $('passenger'),
    caption: $('caption'), gameover: $('gameover'), overBoard: $('overBoard'),
    garage: $('garage'), garageList: $('garageList'), garageMoney: $('garageMoney'), garageClose: $('garageClose'), overText: $('overText'), overStats: $('overStats'), restart: $('restartBtn'),
    actionBtn: document.querySelector('#touch [data-act="action"]'),
    action2Btn: document.querySelector('#touch [data-act="action2"]'), accountRadioBox: $('accountRadioBox'), spAcctText: $('spAcctText'),
    spOpenScreen: $('spOpenScreen'), spDisconnect: $('spDisconnect')
  };

  let toastTimer = 0;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 3200);
  }

  function updateAlbumLink() {
    const n = LR.getCards().length;
    ui.albumLink.textContent = n ? `Album (${n})` : 'Album';
  }

  let hudTimer = 0;
  let action = null, action2 = null;
  function runAction() { if (action) action.run(); }
  function runAction2() { if (action2) action2.run(); }
  window.__lrAction = () => action;
  function updateHud(info, dt) {
    hudTimer -= dt;
    if (hudTimer > 0) return;
    hudTimer = 0.1;

    const placeIdx = Math.floor(info.distM / PLACE_EVERY);
    if (placeIdx !== state.lastPlace) {
      state.lastPlace = placeIdx;
      ui.place.classList.remove('show');
      void ui.place.offsetWidth;
      ui.place.textContent = placeName(placeIdx);
      ui.place.classList.add('show');
    }
    ui.region.textContent = `${info.pal.name} · ${clockText(state.tod)}`;
    ui.km.textContent = `${(state.trip / MILE).toFixed(1)} miles this journey`;
    ui.speed.textContent = `${Math.round(state.v * MPH)} mph`;
    ui.speedLabel.textContent = state.cruise ? 'Cruise' : 'Speed';
    const cb = document.querySelector('#touch [data-act="cruise"]');
    if (cb) cb.classList.toggle('on', state.cruise);
    ui.fuel.style.width = `${state.fuel}%`;
    ui.fuel.classList.toggle('low', state.fuel < 15);

    // money, jerry cans, next fuel, passenger
    ui.money.textContent = `£${state.money}`;
    let cansHtml = '';
    for (let i = 0; i < MAX_CANS; i++) {
      const c = state.cans[i];
      cansHtml += `<i class="can ${c === undefined ? 'none' : c ? 'full' : 'empty'}"></i>`;
    }
    if (ui.cans.innerHTML !== cansHtml) ui.cans.innerHTML = cansHtml;
    const nextWx = nextStationAfter(info.carW + 100);
    const nextMi = (nextWx - info.carW) / PXM / MILE;
    const nextShut = nearestStationInfo(nextWx).closed;
    ui.nextFuel.textContent = `next fuel ${nextMi.toFixed(1)} mi${nextShut && nextMi < 0.6 ? ' · looks shut' : ''}`;
    ui.passenger.textContent = state.passengers.length
      ? `${state.passengers.length > 1 ? 'Passengers' : 'Passenger'}: ${state.passengers.map((p) => `${p.name} (${placeName(p.dest)})`).join(', ')} · ${state.seats} seat${state.seats > 1 ? 's' : ''}`
      : (state.seats > 1 ? `${state.seats} passenger seats` : '');

    const touch = IS_TOUCH;
    const stInfo = nearestStationInfo(info.carW);
    const atSt = Math.abs(stInfo.wx - info.carW) < 90;
    const gap = (stInfo.wx - info.carW) / PXM;
    let msg = '';
    action = null;
    action2 = null;
    const fullCan = state.cans.includes(true);

    // what's on the road just ahead?
    let ahead = null;
    for (const sp of spots) {
      const d = (sp.m * PXM - info.carW);
      if (d < -90) continue;
      if (d > 520) break;
      if (!state.done.has(sp.id) && sp.kind !== 'cash' && sp.kind !== 'deer' && sp.kind !== 'glass' && sp.kind !== 'battery') { ahead = { sp, d }; break; }
      if (sp.kind === 'view' && state.done.has(sp.id)) continue;
    }

    const key = (k, t) => (touch ? `Tap ${t}` : `Press ${k}`);
    const blocker = blockerAhead(info.carW);
    const leaving = state.passengers.find((p) => info.carW > p.dest * PLACE_EVERY * PXM - 700);
    if (state.over) msg = '';
    else if (state.stuck != null) {
      msg = `You’re stuck in the mud. ${key('E', 'Get unstuck')} to rock the car free.`;
      action = { label: 'Get unstuck', run: getUnstuck };
    } else if (state.flat && state.v < 0.5) {
      msg = `Flat tyre. ${key('E', 'Change tyre')} to fit the spare.`;
      action = { label: 'Change tyre', run: changeTyre };
    } else if (state.flat) msg = 'Flat tyre! Stop to change it.';
    else if (state.dead && state.v < 0.5) {
      msg = `The battery’s flat. A passing driver has jump leads. ${key('E', 'Jump start')} to get going.`;
      action = { label: 'Jump start', run: jumpStart };
    } else if (state.dead) msg = 'The engine’s died. Coast to a stop.';
    else if (state.mucky && state.v < 0.5) {
      msg = `Mud all over the windscreen. ${key('E', 'Clean screen')} to wipe it off.`;
      action = { label: 'Clean screen', run: cleanScreen };
    } else if (state.mucky) msg = 'You can hardly see through the mud. Stop and clean the windscreen.';
    else if (state.fuel <= 0 && !fullCan) msg = 'Out of fuel…';
    else if (state.fuel <= 0 && state.v > 0.5) msg = 'Out of fuel! Coast to a stop, then use your jerry can.';
    else if (state.fuel <= 0) {
      msg = `Out of fuel. ${key('J', 'Use can')} to pour in your jerry can.`;
      action = { label: 'Use can', run: useCan };
    }
    else if (blocker && state.v < 0.5) {
      const what = { sheep: 'Sheep are blocking the road', tree: 'A fallen tree is blocking the road', rocks: 'Rocks have fallen onto the road' }[blocker.kind];
      msg = blocker.kind === 'gate' ? `A farm gate is shut across the road. ${key('E', 'Open gate')} to get out and open it.`
        : blocker.kind === 'ford' ? `The river’s flooded over the road. ${key('E', 'Cross ford')} to edge across.`
        : `${what}. ${key('E', 'Clear road')} to get out and deal with it.`;
      action = { label: blocker.kind === 'gate' ? 'Open gate' : blocker.kind === 'ford' ? 'Cross ford' : 'Clear road', run: () => clearBlocker(blocker) };
    } else if (atSt && stInfo.closed) msg = 'This fuel station has shut down. Hope you’ve got enough fuel, or a full jerry can, to reach the next one.';
    else if (atSt && state.v < 0.5) {
      if (state.fuel < 92) {
        msg = touch ? 'Tap Fill up to use the pump, or Garage for jerry cans and upgrades.' : 'Press E to fill up at the pump, or G for the garage (jerry cans and upgrades).';
        action = { label: 'Fill up', run: fillUp };
        action2 = { label: 'Garage', run: openGarage };
      } else if (state.cans.some((c) => !c)) {
        msg = touch ? `Tank full. Tap Fill cans to fill your empty jerry cans (\u00a3${CAN_FILL_PRICE} each), or Garage.` : `Tank full. Press E to fill your empty jerry cans (\u00a3${CAN_FILL_PRICE} each), or G for the garage.`;
        action = { label: 'Fill cans', run: fillCans };
        action2 = { label: 'Garage', run: openGarage };
      } else {
        msg = touch ? 'Tank full. Tap Garage for jerry cans and upgrades.' : 'Tank full. Press E (or G) for the garage: jerry cans and upgrades.';
        action = { label: 'Garage', run: openGarage };
      }
    } else if (atSt) msg = 'Stop here to fill up and visit the garage';
    else if (ahead && ahead.sp.kind === 'hitch') {
      const h = hitchInfo(ahead.sp);
      msg = state.passengers.length >= state.seats
        ? `Someone’s thumbing a lift, but you’ve no free seats.${state.seats < MAX_SEATS ? ' Buy another seat at a garage.' : ''}`
        : `${h.name} wants a lift to ${placeName(h.dest)}. Stop next to them to pick them up.`;
    } else if (ahead && ahead.sp.kind === 'sheep') msg = 'Sheep on the road ahead. Slow down and stop.';
    else if (ahead && ahead.sp.kind === 'tree') msg = 'A fallen tree is blocking the road ahead. Slow down and stop.';
    else if (ahead && ahead.sp.kind === 'rocks') msg = 'Rocks on the road ahead. Slow down and stop.';
    else if (ahead && ahead.sp.kind === 'gate') msg = 'There’s a gate across the road ahead. Slow down and stop.';
    else if (ahead && ahead.sp.kind === 'ford') msg = 'Water across the road ahead. Slow down and stop.';
    else if (ahead && ahead.sp.kind === 'tractor') msg = 'A tractor’s coming the other way…';
    else if (ahead && ahead.sp.kind === 'mud') msg = 'The road ahead looks very muddy…';
    else if (ahead && ahead.sp.kind === 'view') msg = touch ? 'Viewpoint. Open the car screen and tap Photo.' : 'Viewpoint. Press P (or Photo on the car screen) to take a postcard.';
    else if (leaving) msg = `Stop to let ${leaving.name} out at ${placeName(leaving.dest)}.`;
    else if (gap > 0 && gap < 260 && state.fuel < 80) msg = 'Fuel stop ahead';
    else if (state.fuel < 15 && fullCan) msg = touch ? 'Running low. Stop and tap Use can to pour in a jerry can.' : 'Running low. Stop and press J to pour in a jerry can.';
    else if (state.fuel < 15) msg = 'Running low on fuel, and no full jerry can…';

    if (!action && fullCan && state.fuel < 75 && state.v < 0.5) action = { label: 'Use can', run: useCan };
    if (CarScreen.isOpen) CarScreen.refresh();
    if (ui.actionBtn) {
      ui.actionBtn.hidden = !action;
      if (action) ui.actionBtn.textContent = action.label;
    }
    if (ui.action2Btn) {
      ui.action2Btn.hidden = !action2;
      if (action2) ui.action2Btn.textContent = action2.label;
    }
    ui.prompt.textContent = msg;
  }

  // ---------------------------------------------------------------------------
  // Speedometer and odometer
  // ---------------------------------------------------------------------------
  const SPEEDO_MAX = 80;
  const spAngle = (mph) => -120 + (clamp(mph, 0, SPEEDO_MAX) / SPEEDO_MAX) * 240;
  (function buildSpeedo() {
    const g = document.getElementById('spTicks');
    let html = '';
    for (let mph = 0; mph <= SPEEDO_MAX; mph += 5) {
      const a = (spAngle(mph) - 90) * Math.PI / 180;
      const major = mph % 20 === 0;
      const r1 = 52, r2 = major ? 44 : 48;
      html += `<line class="sp-tick${major ? ' major' : ''}" x1="${(60 + Math.cos(a) * r1).toFixed(2)}" y1="${(60 + Math.sin(a) * r1).toFixed(2)}" x2="${(60 + Math.cos(a) * r2).toFixed(2)}" y2="${(60 + Math.sin(a) * r2).toFixed(2)}"/>`;
      if (major) html += `<text class="sp-num" x="${(60 + Math.cos(a) * 35).toFixed(2)}" y="${(60 + Math.sin(a) * 35).toFixed(2)}">${mph}</text>`;
    }
    g.innerHTML = html;
  })();

  // a mechanical odometer: five white-on-black miles wheels and a black-on-white tenths wheel
  const ODO_WHEELS = 6;
  const odoEl = document.getElementById('odo');
  const odoStrips = [];
  for (let i = 0; i < ODO_WHEELS; i++) {
    const w = document.createElement('span');
    w.className = 'odo-wheel';
    const strip = document.createElement('span');
    strip.className = 'odo-strip';
    strip.innerHTML = '01234567890'.split('').map((d) => `<b>${d}</b>`).join('');
    w.appendChild(strip);
    odoEl.appendChild(w);
    odoStrips.push(strip);
  }
  let odoH = 11, shownMph = 0, lastTenth = -1;
  const lastOdo = [];
  function measureOdo() { odoH = odoStrips[0].firstChild.getBoundingClientRect().height || 11; lastOdo.length = 0; }
  addEventListener('resize', measureOdo);
  setTimeout(measureOdo, 50);

  function updateGauges(dt) {
    // needle, with a little lag like a real one
    shownMph += (state.v * MPH - shownMph) * Math.min(1, dt * 6);
    document.getElementById('spNeedle').style.transform = `rotate(${spAngle(shownMph).toFixed(2)}deg)`;
    document.getElementById('speedo').classList.toggle('cruise', state.cruise);

    // odometer: each wheel rolls over as the one to its right goes from 9 to 0
    const tenths = (state.trip / MILE) * 10;
    let lower = tenths % 10;
    for (let i = ODO_WHEELS - 1; i >= 0; i--) {
      const k = ODO_WHEELS - 1 - i;
      let pos;
      if (k === 0) pos = lower;
      else {
        const t = tenths / Math.pow(10, k);
        pos = Math.floor(t) % 10 + clamp(lower - 9, 0, 1);
        lower = pos;
      }
      const y = (-pos * odoH).toFixed(2);
      if (lastOdo[i] !== y) { odoStrips[i].style.transform = `translateY(${y}px)`; lastOdo[i] = y; }
    }
    const tenth = Math.floor(tenths);
    if (lastTenth >= 0 && tenth !== lastTenth && state.started) RoadAudio.tick();
    lastTenth = tenth;
  }

  // ---------------------------------------------------------------------------
  // Postcards
  // ---------------------------------------------------------------------------
  function takePostcard(info) {
    if (!state.started) return;
    RoadAudio.shutter();
    ui.flash.classList.remove('go');
    void ui.flash.offsetWidth;
    ui.flash.classList.add('go');

    const CW = 1000, CH = 740, PX = 40, PY = 40, PW = 920, PH = 540;
    const card = document.createElement('canvas');
    card.width = CW;
    card.height = CH;
    const g = card.getContext('2d');

    g.fillStyle = '#ece5d5';
    g.fillRect(0, 0, CW, CH);
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(90,70,40,0.05)' : 'rgba(255,255,255,0.12)';
      g.fillRect(Math.random() * CW, Math.random() * CH, 1.5, 1.5);
    }

    // crop the current frame to the photo shape, keeping the car in view
    const srcAspect = PW / PH;
    let sh = canvas.height * 0.62, sw = sh * srcAspect;
    if (sw > canvas.width) { sw = canvas.width; sh = sw / srcAspect; }
    let sx = carX * scale - sw * 0.36;
    sx = clamp(sx, 0, canvas.width - sw);
    const sy = clamp((info.cy - 40 + yOff) * scale - sh * 0.62, 0, canvas.height - sh);
    g.filter = 'sepia(0.16) saturate(0.88) contrast(1.05)';
    g.drawImage(canvas, sx, sy, sw, sh, PX, PY, PW, PH);
    g.filter = 'none';
    g.strokeStyle = 'rgba(40,30,20,0.25)';
    g.lineWidth = 1;
    g.strokeRect(PX + 0.5, PY + 0.5, PW - 1, PH - 1);

    const place = placeName(Math.floor(info.distM / PLACE_EVERY));
    const km = (info.distM / 1000).toFixed(1);
    const miles = (info.distM / MILE).toFixed(1);
    const when = timeLabel(state.tod);
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    g.fillStyle = '#6d6556';
    g.font = '500 15px "IBM Plex Mono", monospace';
    g.fillText('GREETINGS FROM', PX + 4, 626);
    g.fillStyle = '#2a2723';
    g.font = 'italic 54px "EB Garamond", Georgia, serif';
    g.fillText(place, PX, 680);
    g.fillStyle = '#6d6556';
    g.font = '400 14px "IBM Plex Mono", monospace';
    g.fillText(`${info.pal.name} · ${when}`, PX + 4, 712);

    // postmark
    const mx = 880, my = 660;
    g.save();
    g.translate(mx, my);
    g.rotate(-0.18);
    g.strokeStyle = 'rgba(70,55,45,0.45)';
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, 50, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, 43, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(70,55,45,0.55)';
    g.textAlign = 'center';
    g.font = '500 11px "IBM Plex Mono", monospace';
    g.fillText('LOST ROADS', 0, -16);
    g.font = '500 17px "IBM Plex Mono", monospace';
    g.fillText(`MILE ${miles}`, 0, 6);
    g.font = '400 11px "IBM Plex Mono", monospace';
    g.fillText(date.toUpperCase(), 0, 24);
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      g.moveTo(-150, -12 + k * 9);
      g.bezierCurveTo(-120, -20 + k * 9, -90, -4 + k * 9, -58, -12 + k * 9);
    }
    g.stroke();
    g.restore();

    let img;
    try { img = card.toDataURL('image/jpeg', 0.84); } catch (e) { toast('Could not take that photo.'); return; }
    const cards = LR.getCards();
    cards.unshift({ id: Date.now(), img, place, region: info.pal.name, km, miles, when, date });
    if (!LR.saveCards(cards)) {
      toast('Your album is full. Remove a few postcards to make room.');
      return;
    }
    updateAlbumLink();
    for (const sp of spots) {
      if (sp.kind === 'view' && !state.done.has(sp.id) && Math.abs(sp.m * PXM - (state.cam + carX)) < 320) {
        state.done.add(sp.id);
        setTimeout(() => earn(6, 'A gallery in town buys the postcard from the viewpoint for \u00a36.'), 1400);
      }
    }
    if (navigator.vibrate) navigator.vibrate(12);
    Account.pushCard(cards[0]);
    toast(`Postcard from ${place} added to your album`);
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------
  function step(dt) {
    state.time += dt;
    if (!state.paused) state.tod = (state.tod + dt / DAY_SECONDS) % 1;

    const carW = state.cam + carX;
    let throttle = 0;

    const busy = Minigames.isOpen || garageOpen();
    if (state.started && !state.paused && !state.over && !busy) {
      readGamepad();
      const goNow = input.go || pad.go, brakeNow = input.brake || pad.brake;
      const canDrive = state.fuel > 0 && !state.dead;
      if (goNow && canDrive) {
        throttle = 1;
        state.cruise = false;
      }
      if (brakeNow) state.cruise = false;

      if (throttle) state.v += 5.5 * (1 - state.v / (MAX_V * 1.05)) * dt;
      else if (state.cruise && canDrive) state.v += clamp(state.cruiseV - state.v, -2, 2) * dt;
      if (brakeNow) state.v -= 11 * dt;
      if (state.flat) state.v = Math.min(state.v, 4);
      if (state.mucky) state.v = Math.min(state.v, 7);   // you can barely see
      if (state.stuck != null) {
        state.v = 0;
        if (throttle && Math.random() < dt * 30) {
          particles.push({ x: carW - 34 + (Math.random() - 0.5) * 10, y: roadY(carW - 34) - 4, vx: -60 - Math.random() * 80, vy: -60 - Math.random() * 60, r: 2.5, age: 0, life: 0.6, mud: true });
        }
      }

      const slope = (roadY(carW + 30) - roadY(carW - 30)) / 60;
      if (!state.cruise || !canDrive) state.v -= (0.18 + state.v * 0.012) * dt;
      if (!throttle && !state.cruise) state.v += slope * 2.2 * dt;
      state.v = clamp(state.v, 0, MAX_V);

      const moved = state.v * dt;
      state.cam += moved * PXM;
      // fuel only burns while the accelerator is down (cruise control holds it down for you, gently)
      const burn = throttle ? 1.25 : state.cruise ? 0.7 : 0;
      if (canDrive && burn) state.fuel = Math.max(0, state.fuel - (moved / FUEL_RANGE) * 100 * burn);
      stats.metres += moved;
      state.trip += moved;

      updateJourney(dt, state.cam + carX);

      // out of fuel: use a jerry can if there is one, otherwise the journey ends
      if (state.fuel <= 0) {
        if (!state.cans.includes(true) && state.v < 0.3 && !atOpenStation(state.cam + carX)) {
          state.emptyT += dt;
          if (state.emptyT > 1.6) gameOver();
        }
      } else {
        state.emptyT = 0;
      }

      // storms
      const rainHere = clamp((noise(((state.cam + carX) / PXM) * 0.0009, 77) * 0.5 + 0.5) * 2.2 - 1.45, 0, 1);
      if (rainHere > 0.55 && Math.random() < dt / 9) {
        state.flash = 0.6 + Math.random() * 0.4;
        RoadAudio.thunder(0.5 + Math.random() * 1.8);
      }

      // exhaust puffs
      const rate = 3 + throttle * 16 + state.v * 0.2;
      if (Math.random() < rate * dt) {
        const yb = roadY(carW - 34);
        particles.push({ x: carW - 62, y: yb - 14, vx: -12 - Math.random() * 10, vy: -8 - Math.random() * 8, r: 2, age: 0, life: 1.6 + Math.random() });
      }
    }

    for (const p of particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += 7 * dt;
    }
    particles = particles.filter((p) => p.age < p.life);

    const rainNow = clamp((noise(((state.cam + carX) / PXM) * 0.0009, 77) * 0.5 + 0.5) * 2.2 - 1.45, 0, 1);
    RoadAudio.update(state.v / MAX_V, throttle, rainNow, state.started && !state.paused);
  }

  let saveTimer = 0;
  let freezeSaves = false;   // set while we reload with progress downloaded from the account
  function persist(force) {
    if (freezeSaves) return;
    saveTimer -= 1;
    if (!force && saveTimer > 0) return;
    saveTimer = 300;
    LR.save(LR.KEYS.journey, {
      cam: state.cam, trip: state.trip, tod: state.tod, fuel: state.fuel, seed: state.seed, money: state.money, cans: state.cans,
      passengers: state.passengers, seats: state.seats, stuck: state.stuck, flat: state.flat, dead: state.dead, mucky: state.mucky,
      done: [...state.done].slice(-200), carried: state.carried, earned: state.earned
    });
    LR.save(LR.KEYS.stats, stats);
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------
  let last = performance.now();
  let lastInfo = null;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    lastInfo = draw(dt);
    updateHud(lastInfo, dt);
    updateGauges(dt);
    persist(false);
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function begin() {
    if (state.started) return;
    state.started = true;
    document.body.classList.add('driving');
    RoadAudio.start();
    applyAudioSettings();
    keepAwake();
    if (IS_TOUCH && innerHeight > innerWidth * 1.15) setTimeout(() => toast('Tip: turn your phone sideways for a wider view'), 1500);
  }

  function saveSettings() { LR.save(LR.KEYS.settings, settings); }

  function applyAudioSettings() {
    RoadAudio.setMuted(settings.muted);
    RoadAudio.setRainStyle(settings.rainStyle);
    RoadAudio.setRainVolume(settings.rainVol);
    RoadAudio.setEngine(settings.engine);
    RoadAudio.setEngineVolume(settings.engineVol);
    RoadAudio.setRadioVolume(settings.radioVol);
    applyRadio();
  }

  // The radio has an on/off switch (R) and a source: the built-in car radio or Spotify
  function applyRadio() {
    const on = settings.radio;
    const spotify = settings.radioSource === 'spotify' && settings.spotifyUri;
    const account = settings.radioSource === 'account';
    RoadAudio.setRadio(on && !spotify && !account && state.started);
    if (account) {
      ui.dock.classList.remove('show');
      SpotifyRadio.pause();
      if (state.started && SpotifyAccount.connected) {
        if (on) SpotifyAccount.resume(); else SpotifyAccount.pause();
      }
      syncButtons();
      return;
    }
    if (SpotifyAccount.connected) SpotifyAccount.pause();
    ui.dock.classList.toggle('show', !!(on && spotify));
    if (on && spotify && state.started) {
      SpotifyRadio.load(settings.spotifyUri, ui.embed, spotifyFailed);
      SpotifyRadio.play();
    } else {
      SpotifyRadio.pause();
    }
    syncButtons();
  }

  function spotifyFailed() {
    ui.spotifyError.textContent = 'Spotify’s player couldn’t load. Check your connection, or try turning off any content blocker for this site.';
  }

  function toggleSound() {
    settings.muted = !settings.muted;
    RoadAudio.setMuted(settings.muted);
    saveSettings();
    syncButtons();
  }

  function toggleRadio() {
    if (settings.radioSource === 'account' && SpotifyAccount.connected) SpotifyAccount.refresh();
    settings.radio = !settings.radio;
    if (settings.radio && settings.radioSource === 'spotify' && !settings.spotifyUri) {
      settings.radioSource = 'builtin';
    }
    RoadAudio.start();
    applyRadio();
    saveSettings();
  }

  function radioValue() {
    if (!settings.radio) return 'off';
    if (settings.radioSource === 'account') return 'account';
    return settings.radioSource === 'spotify' ? 'spotify' : 'builtin';
  }

  function syncButtons() {
    ui.soundBtn.textContent = settings.muted ? 'Sound off' : 'Sound on';
    const src = (settings.radioSource === 'spotify' && settings.spotifyUri) || settings.radioSource === 'account' ? 'Spotify' : 'Radio';
    ui.radioBtn.textContent = settings.radio ? `${src} on` : 'Radio off';
    // reflect state in the settings panel
    document.querySelectorAll('input[name="engine"]').forEach((el) => (el.checked = el.value === settings.engine));
    document.querySelectorAll('input[name="radio"]').forEach((el) => (el.checked = el.value === radioValue()));
    ui.engineVol.value = settings.engineVol;
    document.querySelectorAll('input[name="rain"]').forEach((el) => (el.checked = el.value === settings.rainStyle));
    document.getElementById('rainVol').value = settings.rainVol;
    ui.radioVol.value = settings.radioVol;
    ui.soundAll.checked = !settings.muted;
    ui.lowPower.checked = !!settings.lowPower;
    ui.fullscreen.checked = !!document.fullscreenElement;
    const spotifyChosen = radioValue() === 'spotify' || (settings.radioSource === 'spotify' && !settings.spotifyUri && pendingSpotify);
    ui.spotifyBox.classList.toggle('show', spotifyChosen);
    ui.radioVolRow.style.display = radioValue() === 'builtin' ? '' : 'none';
    ui.accountRadioBox.classList.toggle('show', radioValue() === 'account' || settings.radioSource === 'account');
    ui.spDisconnect.hidden = !SpotifyAccount.connected;
    ui.spAcctText.textContent = !SpotifyAccount.configured
      ? 'Spotify sign-in hasn\u2019t been switched on for this site yet (see the README). You can still use a Spotify link.'
      : SpotifyAccount.connected
        ? 'Spotify is connected. Open the car screen (N, or Music at the top) to choose what to play.'
        : 'Open the car screen and tap Connect Spotify. Needs Spotify Premium.';
    if (settings.spotifyUri && !ui.spotifyLink.value) ui.spotifyLink.value = uriToLink(settings.spotifyUri);
  }

  let pendingSpotify = false;
  const uriToLink = (uri) => { const [, type, id] = uri.split(':'); return `https://open.spotify.com/${type}/${id}`; };

  function openSettings() {
    state.paused = true;
    input.go = input.brake = false;
    begin();
    syncButtons();
    ui.settings.classList.add('open');
    ui.settings.setAttribute('aria-hidden', 'false');
  }

  function closeSettings() {
    state.paused = false;
    ui.settings.classList.remove('open');
    ui.settings.setAttribute('aria-hidden', 'true');
    if (document.activeElement) document.activeElement.blur();
  }

  const settingsOpen = () => ui.settings.classList.contains('open');

  document.querySelectorAll('input[name="engine"]').forEach((el) => el.addEventListener('change', () => {
    settings.engine = el.value;
    RoadAudio.start();
    RoadAudio.setEngine(settings.engine);
    RoadAudio.preview();
    saveSettings();
  }));

  document.querySelectorAll('input[name="radio"]').forEach((el) => el.addEventListener('change', () => {
    ui.spotifyError.textContent = '';
    if (el.value === 'off') {
      settings.radio = false;
      pendingSpotify = false;
    } else if (el.value === 'builtin') {
      settings.radio = true;
      settings.radioSource = 'builtin';
      pendingSpotify = false;
    } else if (el.value === 'account') {
      settings.radioSource = 'account';
      settings.radio = true;
      pendingSpotify = false;
      if (SpotifyAccount.configured && !SpotifyAccount.connected) {
        saveSettings();
        closeSettings();
        CarScreen.open('connect');
        return;
      }
    } else {
      settings.radioSource = 'spotify';
      if (settings.spotifyUri) settings.radio = true;
      else { pendingSpotify = true; settings.radio = false; setTimeout(() => ui.spotifyLink.focus(), 50); }
    }
    RoadAudio.start();
    applyRadio();
    saveSettings();
  }));

  function loadSpotifyLink() {
    const uri = SpotifyRadio.parse(ui.spotifyLink.value);
    if (!uri) {
      ui.spotifyError.textContent = 'That doesn’t look like a Spotify link. It should start with https://open.spotify.com/';
      return;
    }
    ui.spotifyError.textContent = '';
    settings.spotifyUri = uri;
    settings.radioSource = 'spotify';
    settings.radio = true;
    pendingSpotify = false;
    RoadAudio.start();
    applyRadio();
    saveSettings();
    toast('Loading your Spotify into the radio…');
  }

  document.querySelectorAll('input[name="rain"]').forEach((el) => el.addEventListener('change', () => {
    settings.rainStyle = el.value;
    RoadAudio.start();
    RoadAudio.setRainStyle(settings.rainStyle);
    RoadAudio.setRainVolume(settings.rainVol);
    RoadAudio.previewRain();
    saveSettings();
  }));
  document.getElementById('rainVol').addEventListener('input', (e) => {
    settings.rainVol = parseFloat(e.target.value);
    RoadAudio.setRainVolume(settings.rainVol);
    saveSettings();
  });
  document.getElementById('rainVol').addEventListener('change', () => RoadAudio.previewRain());
  ui.spotifyLoad.addEventListener('click', loadSpotifyLink);
  ui.spotifyLink.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSpotifyLink(); });
  ui.engineVol.addEventListener('input', () => { settings.engineVol = parseFloat(ui.engineVol.value); RoadAudio.setEngineVolume(settings.engineVol); saveSettings(); });
  ui.engineVol.addEventListener('change', () => RoadAudio.preview());
  ui.radioVol.addEventListener('input', () => { settings.radioVol = parseFloat(ui.radioVol.value); RoadAudio.setRadioVolume(settings.radioVol); saveSettings(); });
  ui.soundAll.addEventListener('change', () => { settings.muted = !ui.soundAll.checked; RoadAudio.start(); RoadAudio.setMuted(settings.muted); saveSettings(); syncButtons(); });
  ui.settingsBtn.addEventListener('click', (e) => { e.currentTarget.blur(); openSettings(); });
  ui.closeSettings.addEventListener('click', closeSettings);
  const feedbackBtn = document.getElementById('feedbackBtn');
  if (feedbackBtn) feedbackBtn.addEventListener('click', () => { if (window.jtFeedback) window.jtFeedback(); });
  ui.settings.addEventListener('pointerdown', (e) => { if (e.target === ui.settings) closeSettings(); });
  ui.dockHide.addEventListener('click', () => {
    const tucked = ui.dock.classList.toggle('tucked');
    ui.dockHide.textContent = tucked ? 'Show' : 'Hide';
  });
  SpotifyRadio.onPlaybackChange(() => syncButtons());

  // ---------------------------------------------------------------------------
  // Phone and computer extras
  // ---------------------------------------------------------------------------
  const pad = { go: false, brake: false, prev: [] };
  function readGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    pad.go = pad.brake = false;
    for (const gp of pads) {
      if (!gp) continue;
      const b = (i) => gp.buttons[i] || { value: 0, pressed: false };
      pad.go = b(7).value > 0.15 || b(0).pressed || (gp.axes[1] || 0) < -0.5;
      pad.brake = b(6).value > 0.15 || b(1).pressed || (gp.axes[1] || 0) > 0.5;
      const pressed = (i) => b(i).pressed && !pad.prev[i];
      if (pressed(2) && lastInfo) takePostcard(lastInfo);
      if (pressed(3)) toggleCruise();
      if (pressed(9)) openSettings();
      if (pressed(8)) toggleRadio();
      pad.prev = gp.buttons.map((x) => x.pressed);
      break;
    }
  }
  addEventListener('gamepadconnected', () => { begin(); toast('Controller connected. Right trigger drives, left trigger brakes.'); });

  function toggleCruise() {
    state.cruise = !state.cruise && state.v > 2;
    state.cruiseV = state.v;
    if (state.cruise) toast(`Cruise control set at ${Math.round(state.v * MPH)} mph`);
    const btn = document.querySelector('#touch [data-act="cruise"]');
    if (btn) btn.classList.toggle('on', state.cruise);
  }

  // keep the screen on while driving on a phone
  let wakeLock = null;
  async function keepAwake() {
    if (!IS_TOUCH || !('wakeLock' in navigator) || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { /* not allowed right now */ }
  }

  function toggleFullscreen(on) {
    if (!document.fullscreenEnabled) return;
    const want = on === undefined ? !document.fullscreenElement : on;
    if (want && !document.fullscreenElement) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        if (IS_TOUCH && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      }).catch(() => {});
    } else if (!want && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }
  document.addEventListener('fullscreenchange', () => { ui.fullscreen.checked = !!document.fullscreenElement; });

  // on a computer, hide the mouse pointer while you're just driving
  let cursorTimer = 0;
  if (!IS_TOUCH) {
    addEventListener('mousemove', () => {
      document.body.classList.remove('hide-cursor');
      clearTimeout(cursorTimer);
      cursorTimer = setTimeout(() => { if (state.started && !settingsOpen()) document.body.classList.add('hide-cursor'); }, 2500);
    });
  }

  // ---------------------------------------------------------------------------
  // Account
  // ---------------------------------------------------------------------------
  function syncAccountUi() {
    document.body.classList.toggle('signed-in', Account.signedIn);
    ui.acctName.textContent = Account.username;
    if (!Account.configured && !Account.signedIn) ui.acctError.textContent = 'Accounts aren\u2019t switched on for this site yet.';
    if (Account.status) ui.acctStatus.textContent = Account.status;
    else if (Account.lastSaved) ui.acctStatus.textContent = `Your progress saves to your account automatically. Last saved at ${new Date(Account.lastSaved).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`;
    else ui.acctStatus.textContent = 'Your progress saves to your account automatically.';
    ui.introAcct.innerHTML = '';
    if (Account.signedIn) {
      ui.introAcct.textContent = `Signed in as ${Account.username}.`;
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Sign in';
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); openSettings(); setTimeout(() => ui.acctUser.focus(), 300); });
      ui.introAcct.append(b, ' to save your progress to an account.');
    }
  }
  Account.onChange(syncAccountUi);

  async function accountEnter(create) {
    const username = ui.acctUser.value.trim();
    const password = ui.acctPass.value;
    ui.acctError.textContent = '';
    if (!username || !password) { ui.acctError.textContent = 'Type a username and password first.'; return; }
    if (create && password.length < 8) { ui.acctError.textContent = 'Passwords need at least 8 characters.'; return; }
    ui.acctSignIn.disabled = ui.acctCreate.disabled = true;
    persist(true);
    try {
      const replaced = await Account.enter(username, password, create);
      ui.acctPass.value = '';
      Account.submitBest(Math.max(stats.best || 0, (state.cam + carX) / PXM / 1000));
      if (replaced) {
        freezeSaves = true;
        toast('Loading your saved journey…');
        setTimeout(() => location.reload(), 900);
      } else {
        toast(create ? `Welcome, ${Account.username}. Your progress is now saved to your account.` : `Signed in as ${Account.username}`);
        updateAlbumLink();
      }
    } catch (err) {
      ui.acctError.textContent = err.message;
    } finally {
      ui.acctSignIn.disabled = ui.acctCreate.disabled = false;
    }
  }

  ui.acctForm.addEventListener('submit', (e) => { e.preventDefault(); accountEnter(false); });
  ui.acctCreate.addEventListener('click', () => accountEnter(true));
  ui.acctSave.addEventListener('click', async () => { persist(true); await Account.pushSave(true); syncAccountUi(); });
  ui.acctSignOut.addEventListener('click', async () => {
    persist(true);
    await Account.signOut();
    toast('Signed out. Your progress is still on this device too.');
  });
  ui.fullscreen.addEventListener('change', () => toggleFullscreen(ui.fullscreen.checked));
  ui.lowPower.addEventListener('change', () => { settings.lowPower = ui.lowPower.checked; saveSettings(); resize(); buildDrops(); });

  // ---------------------------------------------------------------------------
  // Car screen (Spotify account)
  // ---------------------------------------------------------------------------
  CarScreen.init({
    apps: () => {
      const carW = state.cam + carX;
      const radioOn = settings.radio;
      const src = settings.radioSource === 'account' ? 'Spotify' : settings.radioSource === 'spotify' && settings.spotifyUri ? 'Spotify link' : 'Car radio';
      const garageHere = atOpenStation(carW) && state.v < 0.5;
      return [
        { id: 'music', label: 'Music', icon: 'note', colour: '#1f6e48', sub: SpotifyAccount.connected ? 'Spotify' : 'Connect Spotify', view: 'now', run: () => CarScreen.open('now') },
        { id: 'radio', label: 'Radio', icon: 'radio', colour: '#8a4b2f', on: radioOn, sub: radioOn ? `${src} on` : 'Off', run: () => { begin(); toggleRadio(); } },
        { id: 'photo', label: 'Photo', icon: 'camera', colour: '#4a5568', sub: 'Take a postcard', closes: true, run: () => setTimeout(() => lastInfo && takePostcard(lastInfo), 250) },
        { id: 'cruise', label: 'Cruise', icon: 'gauge', colour: '#3b5b6e', on: state.cruise, sub: state.cruise ? `${Math.round(state.cruiseV * MPH)} mph` : (state.v > 2 ? 'Hold this speed' : 'Drive first'), run: toggleCruise },
        { id: 'horn', label: 'Horn', icon: 'horn', colour: '#6e5a2a', sub: 'Beep', run: honk },
        { id: 'board', label: 'Leaderboard', icon: 'trophy', colour: '#7a6326', sub: 'Furthest journeys', run: () => CarScreen.open('board') },
        { id: 'album', label: 'Album', icon: 'album', colour: '#5b3a4e', sub: `${LR.getCards().length} postcards`, closes: true, run: () => { persist(true); location.href = 'album.html'; } },
        { id: 'garage', label: 'Garage', icon: 'wrench', colour: '#2f4a3a', disabled: !garageHere, sub: garageHere ? 'Open now' : 'At fuel stations', closes: true, run: openGarage },
        { id: 'settings', label: 'Settings', icon: 'cog', colour: '#3a3f46', sub: 'Engine, account\u2026', closes: true, run: openSettings },
        { id: 'sound', label: 'Sound', icon: settings.muted ? 'mute' : 'speaker', colour: '#3a3f46', on: !settings.muted, sub: settings.muted ? 'Off' : 'On', run: () => { begin(); toggleSound(); } }
      ];
    },
    getClock: () => clockText(state.tod),
    beforeLeave: () => { persist(true); Account.pushSaveOnExit(); },
    onPlay: () => {
      begin();
      settings.radioSource = 'account';
      settings.radio = true;
      RoadAudio.setRadio(false);
      SpotifyRadio.pause();
      ui.dock.classList.remove('show');
      saveSettings();
      syncButtons();
    }
  });
  SpotifyAccount.onChange(syncButtons);
  ui.screenBtn.addEventListener('click', (e) => { e.currentTarget.blur(); begin(); CarScreen.toggle(); });
  document.getElementById('carplayBtn').addEventListener('click', (e) => { e.currentTarget.blur(); begin(); CarScreen.toggle(); });
  document.getElementById('carplayBtn').addEventListener('pointerdown', (e) => e.stopPropagation());
  ui.spOpenScreen.addEventListener('click', () => { closeSettings(); CarScreen.open(); });
  ui.spDisconnect.addEventListener('click', () => {
    SpotifyAccount.disconnect();
    if (settings.radioSource === 'account') { settings.radioSource = 'builtin'; settings.radio = false; saveSettings(); }
    syncButtons();
    toast('Spotify disconnected');
  });
  SpotifyAccount.handleRedirect().then((result) => {
    if (result === 'connected') {
      settings.radioSource = 'account';
      settings.radio = true;
      saveSettings();
      syncButtons();
      toast('Spotify connected. Pick something to play.');
      CarScreen.open('playlists');
    } else if (result === 'denied') {
      toast('Spotify wasn\u2019t connected.');
    } else if (result === 'failed') {
      toast('Spotify sign-in didn\u2019t work. Try again from the car screen.');
    }
  });

  // ---------------------------------------------------------------------------
  // End of the road
  // ---------------------------------------------------------------------------
  function gameOver() {
    if (state.over) return;
    state.over = true;
    state.v = 0;
    state.cruise = false;
    input.go = input.brake = false;
    const km = (state.cam + carX) / PXM / 1000;
    stats.best = Math.max(stats.best || 0, km);
    stats.journeys = (stats.journeys || 0) + 1;
    track('game_over', km);
    const place = placeName(Math.floor((state.cam + carX) / PXM / PLACE_EVERY));
    ui.overText.textContent = `You ran dry near ${place}, with no fuel left in the tank and nothing in the jerry cans.`;
    ui.overStats.innerHTML = '';
    const rows = [
      ['Distance', `${(km * 1000 / MILE).toFixed(1)} miles`],
      ['Best journey', `${(stats.best * 1000 / MILE).toFixed(1)} miles`],
      ['Hitchhikers carried', String(state.carried)],
      ['Money earned', `\u00a3${state.earned}`]
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      ui.overStats.append(dt, dd);
    }
    ui.gameover.classList.add('open');
    persist(true);
    Account.pushSave(true);
    Account.submitBest(stats.best);
    ui.overBoard.textContent = Account.signedIn ? 'See the leaderboard' : 'See the leaderboard (sign in to get on it)';
  }

  function newJourney() {
    state.cam = 0;
    state.trip = 0;
    lastTenth = -1;
    state.v = 0;
    state.fuel = 100;
    state.tod = 0.235;
    state.seed = (Math.random() * 1e6) | 0;
    state.money = 5;
    state.cans = [];
    state.passengers = [];
    state.seats = 1;
    state.stuck = null;
    state.flat = false;
    state.dead = false;
    state.mucky = false;
    state.done = new Set();
    state.carried = 0;
    state.earned = 0;
    state.emptyT = 0;
    state.over = false;
    state.lastPlace = -1;
    particles = [];
    for (const k in ev) delete ev[k];
    ui.gameover.classList.remove('open');
    persist(true);
    Account.pushSave(true);
    toast('A new road. Good luck.');
  }



  const GO = ['ArrowUp', 'ArrowRight', 'KeyW', 'KeyD'];
  const BRAKE = ['ArrowDown', 'ArrowLeft', 'KeyS', 'KeyA'];

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (settingsOpen()) { if (e.code === 'Escape') closeSettings(); return; }
    if (Minigames.isOpen) { if (['Space', 'Enter'].includes(e.code)) e.preventDefault(); if (!e.repeat) Minigames.key(e.code); return; }
    if (garageOpen()) { if (e.code === 'Escape' || e.code === 'KeyE') closeGarage(); return; }
    if (state.over) { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); newJourney(); } return; }
    if (CarScreen.isOpen && e.code === 'Escape') { CarScreen.close(); return; }
    if (e.code === 'KeyN' && !e.repeat) { begin(); CarScreen.toggle(); return; }
    if (e.code === 'Escape' || e.code === 'KeyO') { e.preventDefault(); openSettings(); return; }
    if (!state.started) { begin(); if (!GO.includes(e.code)) return; }
    if (GO.includes(e.code)) { input.go = true; e.preventDefault(); }
    else if (BRAKE.includes(e.code)) { input.brake = true; e.preventDefault(); }
    else if (e.code === 'KeyC' && !e.repeat) toggleCruise();
    else if (e.code === 'KeyF' && !e.repeat) toggleFullscreen();
    else if ((e.code === 'KeyP' || e.code === 'Space') && !e.repeat) { e.preventDefault(); if (lastInfo) takePostcard(lastInfo); }
    else if (e.code === 'KeyR' && !e.repeat) toggleRadio();
    else if (e.code === 'KeyM' && !e.repeat) toggleSound();
    else if (e.code === 'KeyE' && !e.repeat) { if (action) action.run(); }
    else if (e.code === 'KeyJ' && !e.repeat) useCan();
    else if (e.code === 'KeyG' && !e.repeat) openGarage();
    else if (e.code === 'KeyH' && !e.repeat) honk();
  });

  addEventListener('keyup', (e) => {
    if (Minigames.isOpen) { Minigames.keyUp(e.code); return; }
    if (GO.includes(e.code)) input.go = false;
    if (BRAKE.includes(e.code)) input.brake = false;
  });

  addEventListener('blur', () => { input.go = input.brake = false; persist(true); });
  addEventListener('pagehide', () => { persist(true); Account.pushSaveOnExit(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { persist(true); Account.pushSaveOnExit(); }
    else if (state.started) keepAwake();
  });
  // copy progress to the account once a minute while signed in
  setInterval(() => {
    if (Account.signedIn && state.started) {
      persist(true);
      Account.pushSave();
      Account.submitBest(Math.max(stats.best || 0, (state.cam + carX) / PXM / 1000));
    }
  }, 60000);

  ui.intro.addEventListener('pointerdown', begin);
  canvas.addEventListener('pointerdown', begin);
  ui.soundBtn.addEventListener('click', (e) => { e.currentTarget.blur(); toggleSound(); });
  ui.radioBtn.addEventListener('click', (e) => { e.currentTarget.blur(); toggleRadio(); });
  ui.radioBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); openSettings(); });
  ui.albumLink.addEventListener('click', () => persist(true));

  document.querySelectorAll('#touch button').forEach((b) => {
    const act = b.dataset.act;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      begin();
      if (act === 'go') input.go = true;
      if (act === 'brake') input.brake = true;
      if (act === 'photo' && lastInfo) takePostcard(lastInfo);
      if (act === 'cruise') toggleCruise();
      if (navigator.vibrate && (act === 'go' || act === 'brake')) navigator.vibrate(6);
      if (act === 'action') runAction();
      if (act === 'action2') runAction2();
      if (act === 'horn') honk();
    });
    const release = () => {
      if (act === 'go') input.go = false;
      if (act === 'brake') input.brake = false;
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointerleave', release);
    b.addEventListener('pointercancel', release);
  });

  addEventListener('resize', resize);

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  buildFogSprite();
  buildGrain();
  buildStars();
  resize();
  buildDrops();
  ui.restart.addEventListener('click', newJourney);
  ui.garageClose.addEventListener('click', closeGarage);
  ui.garage.addEventListener('pointerdown', (e) => { if (e.target === ui.garage) closeGarage(); });
  syncButtons();
  syncAccountUi();
  updateAlbumLink();
  if (saved && saved.cam > 0) {
    const n = Math.floor((saved.cam + carX) / PXM / PLACE_EVERY);
    const cards = LR.getCards().length;
    ui.resume.textContent = `Picking up the road near ${placeName(n)}. ${(stats.metres / MILE).toFixed(1)} miles driven so far${cards ? `, ${cards} postcard${cards === 1 ? '' : 's'} in the album` : ''}.`;
  }
  if (document.fonts && document.fonts.load) {
    document.fonts.load('italic 54px "EB Garamond"').catch(() => {});
    document.fonts.load('500 15px "IBM Plex Mono"').catch(() => {});
  }

  // handy for testing: ?t=0.8 sets the time of day, ?km=5 jumps ahead
  const qs = new URLSearchParams(location.search);
  if (qs.has('t')) state.tod = parseFloat(qs.get('t')) % 1;
  if (qs.has('km')) state.cam = parseFloat(qs.get('km')) * 1000 * PXM;

  if (qs.has('debug')) {
    window.__lr = { stats,
      state, ev, input,
      get spots() { return spots; },
      ensureSpots, ensureStations,
      get stations() { return stationList; },
      biomeIndex, BIOMES, PXM, SEG, PLACE_EVERY,
      carX: () => carX,
      newJourney
    };
  }

  requestAnimationFrame(frame);
})();
