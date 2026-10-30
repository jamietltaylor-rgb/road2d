(() => {
  'use strict';

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
  const MAX_V = 30;              // metres per second (about 108 km/h)
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
    { name: 'Rust Woods', far: '#8c8a80', mid: '#6f6853', back: '#6d5537', front: '#553f2a', ground: '#30271e', verge: '#5d452f', relief: [0.8, 0.8, 0.7], density: [0.55, 0.7], tree: 'broad' }
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
    { muted: false, radio: false, radioSource: 'builtin', engine: 'petrol', engineVol: 0.8, radioVol: 0.8, spotifyUri: '', lowPower: false },
    LR.load(LR.KEYS.settings, {})
  );

  const state = {
    cam: saved ? saved.cam : 0,
    tod: saved ? saved.tod : 0.235,
    fuel: saved ? saved.fuel : 100,
    v: 0,
    cruise: false,
    cruiseV: 0,
    started: false,
    time: 0,
    lastPlace: -1,
    paused: false
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

  function drawTreeLayer(L, pal, colour, snowColour, distM) {
    const shift = state.cam * L.p;
    const relief = pal.relief[2];
    fillRidge(L, state.cam, relief, colour, 6);

    const i0 = Math.floor((shift - 80) / L.cell);
    const i1 = Math.floor((shift + W + 80) / L.cell);
    const snowy = [];
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const sx = i * L.cell + (hash2(i, L.seed + 5) - 0.5) * L.cell * 0.8 - shift;
      const m = distM + (sx - carX) / PXM;
      const bio = biomeAt(m);
      const dens = lerp(bio.a.density[L.d], bio.b.density[L.d], bio.t);
      const clump = 0.55 + 0.75 * (noise(i * 0.09, L.seed + 9) * 0.5 + 0.5);
      if (hash2(i, L.seed + 6) > dens * clump) continue;
      const type = hash2(i, L.seed + 7) < bio.t ? bio.b.tree : bio.a.tree;
      const h = lerp(L.size[0], L.size[1], hash2(i, L.seed + 8));
      const y = ridge(L, sx + shift, relief) + 3;
      treePath(type, sx, y, h);
      if (type === 'snowpine') snowy.push([sx, y, h]);
    }
    ctx.fillStyle = rgb(colour);
    ctx.fill();
    if (snowy.length) {
      ctx.beginPath();
      snowy.forEach(([x, y, h]) => snowPath(x, y, h));
      ctx.fillStyle = rgb(snowColour);
      ctx.fill();
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

  function stationWorldX(n) { return (n * STATION_EVERY + STATION_OFFSET) * PXM; }

  function nextStationAfter(wx) {
    const n = Math.max(0, Math.ceil((wx / PXM - STATION_OFFSET) / STATION_EVERY));
    return stationWorldX(n);
  }

  function nearestStation(wx) {
    const n = Math.max(0, Math.round((wx / PXM - STATION_OFFSET) / STATION_EVERY));
    return stationWorldX(n);
  }

  function drawStations(dark, bodyColour, roofColour, lamp) {
    const n0 = Math.max(0, Math.floor((state.cam / PXM - STATION_OFFSET) / STATION_EVERY) - 1);
    const n1 = n0 + 3;
    for (let n = n0; n <= n1; n++) {
      const wx = stationWorldX(n);
      const sx = wx - state.cam;
      if (sx < -300 || sx > W + 300) continue;
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
      ctx.fillText('FUEL', sx - 110, base - 97);
      ctx.textAlign = 'left';

      if (dark > 0.2) {
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
  // The car
  // ---------------------------------------------------------------------------
  function drawCar(cx, cy, angle, wheelRot, c) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // wheel wells
    ctx.fillStyle = rgb(c.under);
    for (const wx of [-34, 34]) { ctx.beginPath(); ctx.arc(wx, 0, 13.5, 0, Math.PI * 2); ctx.fill(); }

    // body
    ctx.beginPath();
    ctx.moveTo(-55, -5);
    ctx.lineTo(-58, -19);
    ctx.quadraticCurveTo(-58, -27, -51, -27);
    ctx.lineTo(-45, -27);
    ctx.lineTo(-41, -46);
    ctx.quadraticCurveTo(-40, -50, -35, -50);
    ctx.lineTo(13, -50);
    ctx.quadraticCurveTo(18, -50, 21, -46);
    ctx.lineTo(32, -30);
    ctx.lineTo(51, -27);
    ctx.quadraticCurveTo(59, -26, 60, -19);
    ctx.lineTo(60, -10);
    ctx.quadraticCurveTo(59, -5, 54, -5);
    ctx.closePath();
    ctx.fillStyle = rgb(c.body);
    ctx.fill();

    // lower shading
    ctx.fillStyle = rgb(c.shade);
    ctx.beginPath();
    ctx.moveTo(-56, -14);
    ctx.lineTo(60, -14);
    ctx.lineTo(60, -10);
    ctx.quadraticCurveTo(59, -5, 54, -5);
    ctx.lineTo(-55, -5);
    ctx.closePath();
    ctx.fill();

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
    ctx.moveTo(-39, -30); ctx.lineTo(-36, -46); ctx.lineTo(-14, -46); ctx.lineTo(-14, -30); ctx.closePath();
    ctx.moveTo(-10, -30); ctx.lineTo(-10, -46); ctx.lineTo(12, -46); ctx.quadraticCurveTo(16, -46, 18, -43); ctx.lineTo(27, -30); ctx.closePath();
    ctx.fill();
    // soft reflection
    ctx.strokeStyle = rgb(c.trim, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-30, -44); ctx.lineTo(-34, -32);
    ctx.moveTo(4, -44); ctx.lineTo(0, -32);
    ctx.stroke();

    // trim and doors
    ctx.strokeStyle = rgb(c.trim, 0.55);
    ctx.beginPath();
    ctx.moveTo(-57, -21); ctx.lineTo(59, -21);
    ctx.stroke();
    ctx.strokeStyle = rgb(c.shade, 0.9);
    ctx.beginPath();
    ctx.moveTo(-12, -29); ctx.lineTo(-12, -8);
    ctx.moveTo(16, -29); ctx.lineTo(16, -8);
    ctx.stroke();

    // bumpers
    ctx.fillStyle = rgb(c.trim);
    ctx.fillRect(-61, -11, 7, 3);
    ctx.fillRect(56, -11, 7, 3);

    // roof rack and luggage
    ctx.fillStyle = rgb(c.under);
    ctx.fillRect(-36, -53, 48, 1.6);
    ctx.fillRect(-33, -53, 1.6, 3);
    ctx.fillRect(8, -53, 1.6, 3);
    ctx.fillStyle = rgb(c.case);
    ctx.fillRect(-30, -63, 24, 10);
    ctx.fillRect(-4, -60, 12, 7);
    ctx.fillStyle = rgb(c.under, 0.6);
    ctx.fillRect(-19, -63, 2, 10);

    // lamps
    ctx.fillStyle = rgb(c.head);
    ctx.beginPath(); ctx.arc(57, -21, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgb(c.tail);
    ctx.fillRect(-59, -24, 2.5, 6);

    // wheels
    for (const wx of [-34, 34]) {
      ctx.fillStyle = rgb(c.tyre);
      ctx.beginPath(); ctx.arc(wx, 0, 11, 0, Math.PI * 2); ctx.fill();
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

    const snowCol = shade(mix(hex('#dfe3e4'), fog, 0.3));
    drawTreeLayer(LAYERS.back, pal, shade(pal.back), snowCol, distM);
    fogWash(fog, 0.38 * density, 380);
    fogBanks(0.4, 505, 0.95, 0.6 * density, 400, 5);
    drawTreeLayer(LAYERS.front, pal, shade(pal.front), snowCol, distM);
    fogWash(fog, 0.3 * density, 420);
    fogBanks(0.7, 540, 0.9, 0.55 * density, 500, 4);

    // near layer: poles, signs, fuel stops, road
    const near = shade(mix(pal.front, NIGHT, 0.25));
    drawPoles(mix(near, fog, 0.25));
    drawSigns(dark, near, shade(hex('#e4ddcc'), -0.15), shade(hex('#2d2b28')));
    drawStations(dark, shade(hex('#b9b1a2')), shade(hex('#3b3a37')), LAMP);
    drawMarkerPosts(shade(hex('#d8d4ca'), -0.1));

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
      ctx.fillStyle = rgb(mix(fog, hex('#ffffff'), 0.2), a);
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
    screenBtn: $('screenBtn'), accountRadioBox: $('accountRadioBox'), spAcctText: $('spAcctText'),
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
    ui.km.textContent = `${(info.distM / 1000).toFixed(1)} km`;
    ui.speed.textContent = `${Math.round(state.v * 3.6)} km/h`;
    ui.speedLabel.textContent = state.cruise ? 'Cruise' : 'Speed';
    const cb = document.querySelector('#touch [data-act="cruise"]');
    if (cb) cb.classList.toggle('on', state.cruise);
    ui.fuel.style.width = `${state.fuel}%`;
    ui.fuel.classList.toggle('low', state.fuel < 15);

    let msg = '';
    const st = nearestStation(info.carW);
    const gap = (st - info.carW) / PXM;
    if (state.fuel <= 0 && state.v < 0.5) msg = 'Out of fuel. Press T to wait for a tow.';
    else if (Math.abs(st - info.carW) < 90 && state.v < 1.5 && state.fuel < 99.5) msg = `Filling up… ${Math.round(state.fuel)}%`;
    else if (Math.abs(st - info.carW) < 90 && state.fuel < 99.5) msg = 'Stop here to fill up';
    else if (gap > 0 && gap < 260 && state.fuel < 80) msg = 'Fuel stop ahead';
    else if (state.fuel < 15) msg = 'Running low on fuel';
    ui.prompt.textContent = msg;
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
    g.fillText(`KM ${km}`, 0, 6);
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
    cards.unshift({ id: Date.now(), img, place, region: info.pal.name, km, when, date });
    if (!LR.saveCards(cards)) {
      toast('Your album is full. Remove a few postcards to make room.');
      return;
    }
    updateAlbumLink();
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

    if (state.started && !state.paused) {
      readGamepad();
      const goNow = input.go || pad.go, brakeNow = input.brake || pad.brake;
      const canDrive = state.fuel > 0;
      if (goNow && canDrive) {
        throttle = 1;
        state.cruise = false;
      }
      if (brakeNow) state.cruise = false;

      if (throttle) state.v += 5.5 * (1 - state.v / (MAX_V * 1.05)) * dt;
      else if (state.cruise && canDrive) state.v += clamp(state.cruiseV - state.v, -2, 2) * dt;
      if (brakeNow) state.v -= 11 * dt;

      const slope = (roadY(carW + 30) - roadY(carW - 30)) / 60;
      if (!state.cruise || !canDrive) state.v -= (0.18 + state.v * 0.012) * dt;
      if (!throttle && !state.cruise) state.v += slope * 2.2 * dt;
      state.v = clamp(state.v, 0, MAX_V);

      const moved = state.v * dt;
      state.cam += moved * PXM;
      if (canDrive) state.fuel = Math.max(0, state.fuel - (moved / FUEL_RANGE) * 100 * (throttle ? 1.25 : 0.9));
      stats.metres += moved;

      const st = nearestStation(carW);
      if (Math.abs(st - carW) < 90 && state.v < 1.5) state.fuel = Math.min(100, state.fuel + 22 * dt);

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
    LR.save(LR.KEYS.journey, { cam: state.cam, tod: state.tod, fuel: state.fuel });
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

  ui.spotifyLoad.addEventListener('click', loadSpotifyLink);
  ui.spotifyLink.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSpotifyLink(); });
  ui.engineVol.addEventListener('input', () => { settings.engineVol = parseFloat(ui.engineVol.value); RoadAudio.setEngineVolume(settings.engineVol); saveSettings(); });
  ui.engineVol.addEventListener('change', () => RoadAudio.preview());
  ui.radioVol.addEventListener('input', () => { settings.radioVol = parseFloat(ui.radioVol.value); RoadAudio.setRadioVolume(settings.radioVol); saveSettings(); });
  ui.soundAll.addEventListener('change', () => { settings.muted = !ui.soundAll.checked; RoadAudio.start(); RoadAudio.setMuted(settings.muted); saveSettings(); syncButtons(); });
  ui.settingsBtn.addEventListener('click', (e) => { e.currentTarget.blur(); openSettings(); });
  ui.closeSettings.addEventListener('click', closeSettings);
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
    if (state.cruise) toast(`Cruise control set at ${Math.round(state.v * 3.6)} km/h`);
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

  function tow() {
    if (state.fuel > 0 || state.v > 0.5) return;
    const st = nextStationAfter(state.cam + carX + 1);
    state.cam = st - carX - 260;
    state.fuel = 12;
    particles = [];
    toast('A farmer towed you to the next fuel stop.');
  }

  const GO = ['ArrowUp', 'ArrowRight', 'KeyW', 'KeyD'];
  const BRAKE = ['ArrowDown', 'ArrowLeft', 'KeyS', 'KeyA'];

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (settingsOpen()) { if (e.code === 'Escape') closeSettings(); return; }
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
    else if (e.code === 'KeyT' && !e.repeat) tow();
  });

  addEventListener('keyup', (e) => {
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
  setInterval(() => { if (Account.signedIn && state.started) { persist(true); Account.pushSave(); } }, 60000);

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
      if (act === 'go' && state.fuel <= 0) tow();
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
  syncButtons();
  syncAccountUi();
  updateAlbumLink();
  if (saved && saved.cam > 0) {
    const n = Math.floor((saved.cam + carX) / PXM / PLACE_EVERY);
    const cards = LR.getCards().length;
    ui.resume.textContent = `Picking up the road near ${placeName(n)}. ${(stats.metres / 1000).toFixed(1)} km driven so far${cards ? `, ${cards} postcard${cards === 1 ? '' : 's'} in the album` : ''}.`;
  }
  if (document.fonts && document.fonts.load) {
    document.fonts.load('italic 54px "EB Garamond"').catch(() => {});
    document.fonts.load('500 15px "IBM Plex Mono"').catch(() => {});
  }

  // handy for testing: ?t=0.8 sets the time of day, ?km=5 jumps ahead
  const qs = new URLSearchParams(location.search);
  if (qs.has('t')) state.tod = parseFloat(qs.get('t')) % 1;
  if (qs.has('km')) state.cam = parseFloat(qs.get('km')) * 1000 * PXM;

  requestAnimationFrame(frame);
})();
