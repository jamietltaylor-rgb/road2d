// Everything you hear is generated in the browser: no audio files needed.
window.RoadAudio = (() => {
  let ctx = null;
  let master, engGain, engFilter, osc1, osc2, amGain, lfo, lfoDepth, roadGain, rainGain, padBus, radioGain;
  let muted = false;
  let radioOn = false;
  let radioVol = 0.8;
  let engineVol = 0.8;
  let engineName = 'petrol';
  let previewUntil = 0;
  let nextChord = 0;
  let chordIndex = 0;

  // Each engine is a recipe for the same little synth: two oscillators, a filter
  // and a "rattle" (a wobble in the volume that follows the revs).
  const ENGINES = {
    petrol:    { a: 'sawtooth', b: 'triangle', idle: 34, range: 62,  ratio: 0.5, cut: 180,  cutRange: 420,  q: 3,   level: 0.035, levelRange: 0.05,  rattle: 0.15, rattleRatio: 0.5, idleLevel: 1 },
    diesel:    { a: 'square',   b: 'sawtooth', idle: 24, range: 30,  ratio: 0.5, cut: 160,  cutRange: 260,  q: 1.6, level: 0.03,  levelRange: 0.035, rattle: 0.65, rattleRatio: 1,   idleLevel: 1 },
    twostroke: { a: 'sawtooth', b: 'square',   idle: 68, range: 170, ratio: 1.01, cut: 700, cutRange: 1700, q: 5,   level: 0.016, levelRange: 0.03,  rattle: 0.35, rattleRatio: 0.5, idleLevel: 0.8 },
    electric:  { a: 'sine',     b: 'triangle', idle: 140, range: 560, ratio: 1.5, cut: 1800, cutRange: 1500, q: 1,   level: 0.0,   levelRange: 0.03,  rattle: 0,    rattleRatio: 1,   idleLevel: 0 },
    off:       null
  };

  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  // A slow, slightly melancholy loop: Am9, Fmaj7, Cmaj7, G6
  const CHORDS = [
    [45, 57, 60, 64, 71],
    [41, 57, 60, 64, 69],
    [48, 55, 59, 64, 67],
    [43, 55, 59, 62, 64]
  ];
  const MELODY = [69, 72, 74, 76, 79, 81];

  function noiseBuffer(type) {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        d[i] = w * 0.5;
      }
    }
    return buf;
  }

  function loopNoise(type, filterType, freq, q) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(type);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    return g;
  }

  function applyEngineShape() {
    if (!ctx) return;
    const e = ENGINES[engineName];
    if (!e) return;
    osc1.type = e.a;
    osc2.type = e.b;
    engFilter.Q.setTargetAtTime(e.q, ctx.currentTime, 0.05);
    amGain.gain.setTargetAtTime(1 - e.rattle * 0.5, ctx.currentTime, 0.05);
    lfoDepth.gain.setTargetAtTime(e.rattle * 0.5, ctx.currentTime, 0.05);
  }

  function start() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);

    // Engine: two oscillators -> filter -> rattle -> level
    osc1 = ctx.createOscillator();
    osc2 = ctx.createOscillator();
    engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 260;
    amGain = ctx.createGain();
    lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfoDepth = ctx.createGain();
    lfo.connect(lfoDepth).connect(amGain.gain);
    engGain = ctx.createGain();
    engGain.gain.value = 0;
    osc1.connect(engFilter);
    osc2.connect(engFilter);
    engFilter.connect(amGain).connect(engGain).connect(master);
    osc1.start();
    osc2.start();
    lfo.start();
    applyEngineShape();

    roadGain = loopNoise('brown', 'lowpass', 420, 0.7);
    rainGain = loopNoise('white', 'highpass', 2200, 0.5);

    // Car radio: soft pads into a feedback delay so they smear into the fog
    padBus = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.46;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    radioGain = ctx.createGain();
    radioGain.gain.value = 0;
    padBus.connect(lp);
    lp.connect(radioGain);
    lp.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(radioGain);
    radioGain.connect(master);
    nextChord = ctx.currentTime + 0.2;
  }

  function note(freq, at, dur, vol, type) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = (Math.random() - 0.5) * 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + dur * 0.35);
    g.gain.linearRampToValueAtTime(vol * 0.7, at + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(g).connect(padBus);
    o.start(at);
    o.stop(at + dur + 0.1);
  }

  function scheduleRadio() {
    if (!radioOn) return;
    while (nextChord < ctx.currentTime + 1) {
      const chord = CHORDS[chordIndex % CHORDS.length];
      chord.forEach((n, i) => note(midi(n), nextChord, 9, i === 0 ? 0.05 : 0.028, i === 0 ? 'sine' : 'triangle'));
      if (Math.random() < 0.6) {
        const m = MELODY[Math.floor(Math.random() * MELODY.length)];
        note(midi(m), nextChord + 2 + Math.random() * 3, 3.5, 0.02, 'sine');
      }
      chordIndex++;
      nextChord += 7.5;
    }
  }

  function update(speedNorm, throttle, rain, running) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t < previewUntil) {
      // a short rev so you can hear the engine you just picked
      const k = 1 - (previewUntil - t) / 1.6;
      running = true;
      throttle = k < 0.6 ? 1 : 0;
      speedNorm = Math.max(speedNorm, Math.sin(Math.min(k, 1) * Math.PI) * 0.55);
    }
    const e = ENGINES[engineName];
    if (e) {
      const on = running ? 1 : 0;
      const f = e.idle + speedNorm * e.range + throttle * e.range * 0.12;
      osc1.frequency.setTargetAtTime(f, t, 0.15);
      osc2.frequency.setTargetAtTime(f * e.ratio, t, 0.15);
      lfo.frequency.setTargetAtTime(Math.max(1, f * e.rattleRatio), t, 0.15);
      engFilter.frequency.setTargetAtTime(e.cut + speedNorm * e.cutRange + throttle * e.cutRange * 0.5, t, 0.2);
      const level = e.level * e.idleLevel + speedNorm * e.levelRange + throttle * 0.02;
      engGain.gain.setTargetAtTime(on * level * engineVol * 1.25, t, 0.25);
    } else {
      engGain.gain.setTargetAtTime(0, t, 0.2);
    }
    roadGain.gain.setTargetAtTime((running ? 1 : 0) * speedNorm * 0.11, t, 0.3);
    rainGain.gain.setTargetAtTime(rain * 0.07, t, 0.8);
    scheduleRadio();
  }

  function shutter() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    [0, 0.07].forEach((off) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer('white');
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 3200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t + off);
      g.gain.exponentialRampToValueAtTime(0.001, t + off + 0.05);
      src.connect(f).connect(g).connect(master);
      src.start(t + off);
      src.stop(t + off + 0.08);
    });
  }

  // little sound effects
  function tone(freq, start, dur, vol, type = 'sine', dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, start + dur);
    o.connect(g).connect(dest || master);
    o.start(start);
    o.stop(start + dur + 0.05);
  }
  function chime() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    tone(midi(79), t, 0.5, 0.06);
    tone(midi(86), t + 0.09, 0.7, 0.05);
  }
  function horn() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    f.connect(master);
    for (const fr of [370, 466]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = fr;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.02);
      g.gain.setValueAtTime(0.05, t + 0.38);
      g.gain.linearRampToValueAtTime(0, t + 0.45);
      o.connect(g).connect(f);
      o.start(t);
      o.stop(t + 0.5);
    }
  }
  function burst(at, dur, vol, freq, type) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(type || 'brown');
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + Math.min(0.08, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    src.connect(f).connect(g).connect(master);
    src.start(at);
    src.stop(at + dur + 0.1);
  }
  function thunder(delay) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + delay;
    burst(t, 3.2, 0.5, 180);
    burst(t + 0.25, 2.4, 0.3, 90);
  }
  function bump() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    burst(t, 0.35, 0.6, 400);
    tone(70, t, 0.3, 0.12, 'sine');
  }
  function glug() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 6; i++) tone(180 + Math.random() * 120, t + i * 0.13, 0.12, 0.05, 'sine');
  }

  function setMuted(m) {
    muted = m;
    if (ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.1);
  }

  function setRadio(on) {
    radioOn = on;
    if (!ctx) return;
    radioGain.gain.setTargetAtTime(on ? radioVol * 1.25 : 0, ctx.currentTime, 0.8);
    if (on) nextChord = Math.max(nextChord, ctx.currentTime + 0.1);
  }

  function setRadioVolume(v) {
    radioVol = v;
    if (ctx && radioOn) radioGain.gain.setTargetAtTime(v * 1.25, ctx.currentTime, 0.2);
  }

  function setEngine(name) {
    if (!(name in ENGINES)) name = 'petrol';
    engineName = name;
    applyEngineShape();
  }

  function setEngineVolume(v) { engineVol = v; }

  function preview() {
    if (!ctx || !ENGINES[engineName]) return;
    previewUntil = ctx.currentTime + 1.6;
  }

  return {
    start,
    update,
    shutter,
    setMuted,
    setRadio,
    setRadioVolume,
    setEngine,
    setEngineVolume,
    preview,
    chime,
    horn,
    thunder,
    bump,
    glug,
    get muted() { return muted; },
    get radioOn() { return radioOn; }
  };
})();
