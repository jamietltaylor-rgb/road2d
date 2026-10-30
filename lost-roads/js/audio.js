// Everything you hear is generated in the browser: no audio files needed.
window.RoadAudio = (() => {
  let ctx = null;
  let master, engGain, engFilter, osc1, osc2, roadGain, rainGain, padBus, radioGain;
  let muted = false;
  let radioOn = false;
  let nextChord = 0;
  let chordIndex = 0;

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

    // Engine: two detuned oscillators through a low-pass filter
    osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 260;
    engFilter.Q.value = 3;
    engGain = ctx.createGain();
    engGain.gain.value = 0;
    osc1.connect(engFilter);
    osc2.connect(engFilter);
    engFilter.connect(engGain).connect(master);
    osc1.start();
    osc2.start();

    roadGain = loopNoise('brown', 'lowpass', 420, 0.7);
    rainGain = loopNoise('white', 'highpass', 2200, 0.5);

    // Radio: soft pads into a feedback delay so they smear into the fog
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
    const on = running ? 1 : 0;
    const f = 34 + speedNorm * 62 + throttle * 9;
    osc1.frequency.setTargetAtTime(f, t, 0.15);
    osc2.frequency.setTargetAtTime(f * 0.5, t, 0.15);
    engFilter.frequency.setTargetAtTime(180 + speedNorm * 420 + throttle * 260, t, 0.2);
    engGain.gain.setTargetAtTime(on * (0.035 + speedNorm * 0.05 + throttle * 0.025), t, 0.25);
    roadGain.gain.setTargetAtTime(on * speedNorm * 0.11, t, 0.3);
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

  function setMuted(m) {
    muted = m;
    if (ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.1);
  }

  function setRadio(on) {
    radioOn = on;
    if (!ctx) return;
    radioGain.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.8);
    if (on) nextChord = Math.max(nextChord, ctx.currentTime + 0.1);
  }

  return {
    start,
    update,
    shutter,
    setMuted,
    setRadio,
    get muted() { return muted; },
    get radioOn() { return radioOn; }
  };
})();
