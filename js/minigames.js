// Roadside jobs: small hands-on minigames that pop up when something blocks the road.
// Each one works with a mouse, a finger or the keyboard.
window.Minigames = (() => {
  const root = document.getElementById('minigame');
  root.innerHTML = `
    <div class="mg-card" role="dialog" aria-modal="true" aria-labelledby="mgTitle">
      <header class="mg-head">
        <div>
          <p class="kicker" id="mgKicker"></p>
          <h2 id="mgTitle"></h2>
        </div>
        <button type="button" class="mg-close" id="mgClose">Not now</button>
      </header>
      <p class="mg-hint" id="mgHint"></p>
      <div class="mg-stage" id="mgStage">
        <canvas id="mgCanvas"></canvas>
        <button type="button" class="mg-tap" id="mgTap" hidden></button>
      </div>
      <footer class="mg-foot">
        <div class="mg-progress"><i id="mgBar"></i></div>
        <button type="button" class="mg-pay" id="mgPay"></button>
      </footer>
    </div>`;

  const $ = (id) => document.getElementById(id);
  const ui = { kicker: $('mgKicker'), title: $('mgTitle'), hint: $('mgHint'), canvas: $('mgCanvas'), tap: $('mgTap'), bar: $('mgBar'), pay: $('mgPay'), close: $('mgClose'), stage: $('mgStage') };
  const g = ui.canvas.getContext('2d');
  const GW = 800, GH = 440;
  let game = null, opts = null, raf = 0, last = 0, scale = 1, finished = false;

  // ---------------------------------------------------------------------------
  // Shared drawing bits
  // ---------------------------------------------------------------------------
  const C = {
    field: '#4f5b42', field2: '#46523a', road: '#3a3c40', line: '#d9d6cc', bark: '#5a4532', barkDark: '#3e3023', wood: '#c9a777', ring: '#a9875a',
    leaf: '#3c4c35', rock: '#7d7d77', rockDark: '#5e5f5a', wool: '#e6e1d4', ink: '#22201d', mud: '#5b4630', mud2: '#4a3826', metal: '#9a9c98', tyre: '#1b1c1d',
    paint: '#7a3e30', paintDark: '#5a2c23', orange: '#d0662f', sky: '#9fb0b8'
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const ROAD_TOP = 120, ROAD_BOT = 360;

  function drawRoadScene() {
    g.fillStyle = C.field;
    g.fillRect(0, 0, GW, GH);
    // grass texture
    g.strokeStyle = C.field2;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 260; i++) {
      const x = (i * 97) % GW, y = (i * 53) % GH;
      if (y > ROAD_TOP - 6 && y < ROAD_BOT + 6) continue;
      g.moveTo(x, y); g.lineTo(x + 3, y - 7);
    }
    g.stroke();
    g.fillStyle = C.road;
    g.fillRect(0, ROAD_TOP, GW, ROAD_BOT - ROAD_TOP);
    g.fillStyle = C.line;
    g.fillRect(0, ROAD_TOP + 8, GW, 3);
    g.fillRect(0, ROAD_BOT - 11, GW, 3);
    for (let x = 10; x < GW; x += 70) g.fillRect(x, (ROAD_TOP + ROAD_BOT) / 2 - 2, 36, 4);
    // verge labels
    g.fillStyle = 'rgba(239,234,224,0.45)';
    g.font = '500 11px "IBM Plex Mono", monospace';
    g.fillText('VERGE', 16, 24);
    g.fillText('VERGE', 16, GH - 14);
  }

  function roundRect(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  const offRoad = (y) => y < ROAD_TOP - 4 || y > ROAD_BOT + 4;

  // ---------------------------------------------------------------------------
  // 1. Fallen tree: cut it with a chainsaw, then drag the pieces away
  // ---------------------------------------------------------------------------
  function treeGame() {
    const log = { x: 90, y: 205, w: 620, h: 58 };
    const cuts = [245, 400, 555].map((x) => ({ x, p: 0 }));
    let phase = 'cut', pieces = [], drag = null, dust = [], sawOn = false;
    const ptr = { x: 400, y: 120, down: false };
    return {
      kicker: 'Roadside job', title: 'Clear the fallen tree',
      pay: { label: 'Wait for a farmer', cost: 10 },
      get hint() { return phase === 'cut' ? 'Hold the chainsaw on each marked line until it cuts right through.' : 'Now drag each piece of trunk off the road onto the verge.'; },
      get progress() {
        return phase === 'cut' ? (cuts.reduce((a, c) => a + c.p, 0) / cuts.length) * 0.6 : 0.6 + 0.4 * (pieces.filter((p) => p.cleared).length / pieces.length);
      },
      step(dt) {
        sawOn = false;
        if (phase === 'cut' && ptr.down) {
          for (const c of cuts) {
            if (c.p < 1 && Math.abs(ptr.x - c.x) < 30 && ptr.y > log.y - 50 && ptr.y < log.y + log.h + 50) {
              c.p = Math.min(1, c.p + dt / 1.2);
              sawOn = true;
              for (let k = 0; k < 3; k++) dust.push({ x: c.x + rand(-4, 4), y: log.y + log.h * c.p, vx: rand(-90, 90), vy: rand(-140, -30), life: rand(0.4, 0.9), age: 0 });
            }
          }
          if (cuts.every((c) => c.p >= 1)) {
            phase = 'move';
            const edges = [log.x, ...cuts.map((c) => c.x), log.x + log.w];
            pieces = edges.slice(0, -1).map((x0, i) => ({ x: x0 + 3, y: log.y, w: edges[i + 1] - x0 - 6, h: log.h, cleared: false, leafy: i === edges.length - 2 }));
            RoadAudio.saw(false);
          }
        }
        RoadAudio.saw(sawOn);
        for (const d of dust) { d.age += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 300 * dt; }
        dust = dust.filter((d) => d.age < d.life);
        return phase === 'move' && pieces.every((p) => p.cleared);
      },
      draw() {
        drawRoadScene();
        if (phase === 'cut') {
          // trunk
          g.fillStyle = C.bark;
          roundRect(log.x, log.y, log.w, log.h, 22);
          g.fill();
          g.strokeStyle = C.barkDark;
          g.lineWidth = 2;
          g.beginPath();
          for (let x = log.x + 20; x < log.x + log.w - 10; x += 34) { g.moveTo(x, log.y + 10); g.lineTo(x + 18, log.y + 22); g.moveTo(x + 6, log.y + 36); g.lineTo(x + 26, log.y + 46); }
          g.stroke();
          // leafy crown at one end
          g.fillStyle = C.leaf;
          g.beginPath();
          for (const [cx, cy, r] of [[log.x + log.w + 10, log.y + 10, 46], [log.x + log.w + 40, log.y + 50, 38], [log.x + log.w - 20, log.y + 60, 34]]) { g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, Math.PI * 2); }
          g.fill();
          for (const c of cuts) {
            g.setLineDash([6, 6]);
            g.strokeStyle = c.p >= 1 ? 'rgba(232,227,214,0.25)' : '#efe7d6';
            g.lineWidth = 2;
            g.beginPath(); g.moveTo(c.x, log.y - 16); g.lineTo(c.x, log.y + log.h + 16); g.stroke();
            g.setLineDash([]);
            if (c.p > 0) {
              g.fillStyle = C.wood;
              g.fillRect(c.x - 3, log.y, 6, log.h * c.p);
            }
          }
        } else {
          for (const p of pieces) {
            g.fillStyle = p.cleared ? '#4a3a2b' : C.bark;
            roundRect(p.x, p.y, p.w, p.h, 14);
            g.fill();
            // cut ends show the rings
            g.fillStyle = C.wood;
            g.fillRect(p.x, p.y + 4, 8, p.h - 8);
            g.fillRect(p.x + p.w - 8, p.y + 4, 8, p.h - 8);
            if (p.leafy) {
              g.fillStyle = C.leaf;
              g.beginPath(); g.arc(p.x + p.w + 14, p.y + 24, 30, 0, Math.PI * 2); g.fill();
            }
          }
        }
        g.fillStyle = 'rgba(214,190,140,0.9)';
        for (const d of dust) g.fillRect(d.x, d.y, 3, 3);
        // the chainsaw follows your pointer while cutting
        if (phase === 'cut') {
          const j = sawOn ? rand(-2, 2) : 0;
          g.save();
          g.translate(ptr.x + j, ptr.y + j);
          g.fillStyle = C.metal;
          roundRect(-6, -2, 12, 70, 5); g.fill();
          g.fillStyle = C.orange;
          roundRect(-22, -48, 44, 46, 8); g.fill();
          g.fillStyle = C.ink;
          g.fillRect(-16, -60, 32, 10);
          g.restore();
        }
      },
      down(x, y) {
        ptr.down = true; ptr.x = x; ptr.y = y;
        if (phase === 'move') {
          const p = pieces.find((q) => !q.cleared && x > q.x - 10 && x < q.x + q.w + 10 && y > q.y - 10 && y < q.y + q.h + 10);
          if (p) drag = { p, ox: x - p.x, oy: y - p.y };
        }
      },
      move(x, y) { ptr.x = x; ptr.y = y; if (drag) { drag.p.x = x - drag.ox; drag.p.y = y - drag.oy; } },
      up() {
        ptr.down = false;
        if (drag) {
          const p = drag.p;
          if (offRoad(p.y + p.h / 2)) { p.cleared = true; RoadAudio.thud(); }
          drag = null;
        }
      },
      end() { RoadAudio.saw(false); }
    };
  }

  // ---------------------------------------------------------------------------
  // 2. Rockfall: drag the boulders off the road (big ones are heavy)
  // ---------------------------------------------------------------------------
  function rocksGame() {
    const rocks = [];
    for (let i = 0; i < 6; i++) {
      const r = rand(20, 46);
      rocks.push({ x: 110 + i * 110 + rand(-20, 20), y: rand(ROAD_TOP + r + 10, ROAD_BOT - r - 10), r, tx: 0, ty: 0, cleared: false, seed: Math.random() * 10 });
    }
    let drag = null;
    return {
      kicker: 'Roadside job', title: 'Rockfall',
      pay: { label: 'Wait for a farmer', cost: 10 },
      hint: 'Some rocks have come down from the hillside. Drag each one onto the verge. The big ones are heavy.',
      get progress() { return rocks.filter((r) => r.cleared).length / rocks.length; },
      step(dt) {
        if (drag) {
          const k = Math.min(1, dt * (900 / (drag.r * drag.r)) * 1.4);
          drag.x += (drag.tx - drag.x) * k;
          drag.y += (drag.ty - drag.y) * k;
        }
        return rocks.every((r) => r.cleared);
      },
      draw() {
        drawRoadScene();
        for (const r of rocks) {
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.beginPath(); g.ellipse(r.x + 4, r.y + r.r * 0.6, r.r, r.r * 0.35, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = r.cleared ? C.rockDark : C.rock;
          g.beginPath();
          for (let a = 0; a <= 8; a++) {
            const ang = (a / 8) * Math.PI * 2;
            const rr = r.r * (0.82 + 0.18 * Math.sin(ang * 3 + r.seed));
            const px = r.x + Math.cos(ang) * rr, py = r.y + Math.sin(ang) * rr * 0.85;
            if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.12)';
          g.beginPath(); g.ellipse(r.x - r.r * 0.3, r.y - r.r * 0.3, r.r * 0.35, r.r * 0.2, -0.5, 0, Math.PI * 2); g.fill();
        }
      },
      down(x, y) {
        const r = rocks.find((q) => !q.cleared && Math.hypot(q.x - x, q.y - y) < q.r + 12);
        if (r) { drag = r; r.tx = x; r.ty = y; }
      },
      move(x, y) { if (drag) { drag.tx = x; drag.ty = y; } },
      up() {
        if (drag) {
          if (offRoad(drag.y)) { drag.cleared = true; RoadAudio.thud(); }
          drag = null;
        }
      }
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Sheep: shoo every sheep off the road (some wander back)
  // ---------------------------------------------------------------------------
  function sheepGame() {
    const sheep = [];
    const n = 7 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) sheep.push({ x: rand(80, 720), y: rand(ROAD_TOP + 25, ROAD_BOT - 25), dir: Math.random() < 0.5 ? -1 : 1, vx: 0, vy: 0, flee: 0, t: Math.random() * 5 });
    let backTimer = 3.5, returns = 0;
    return {
      kicker: 'Roadside job', title: 'Sheep on the road',
      pay: { label: 'Wait for the farmer', cost: 5 },
      hint: 'Tap each sheep to shoo it off the road. Watch out, some wander back.',
      get progress() { return sheep.filter((s) => offRoad(s.y)).length / sheep.length; },
      step(dt) {
        for (const s of sheep) {
          s.t += dt;
          if (s.flee > 0) {
            s.flee -= dt;
            s.x += s.vx * dt; s.y += s.vy * dt;
          } else {
            // amble about
            s.x += Math.sin(s.t * 0.7) * 10 * dt * s.dir;
            s.y += Math.cos(s.t * 0.5) * 6 * dt;
          }
          s.x = clamp(s.x, 30, GW - 30);
          s.y = clamp(s.y, 30, GH - 26);
        }
        backTimer -= dt;
        if (backTimer <= 0 && returns < 3) {
          backTimer = rand(3, 5);
          const off = sheep.filter((s) => offRoad(s.y) && s.flee <= 0);
          if (off.length && sheep.some((s) => !offRoad(s.y))) {
            const s = off[Math.floor(Math.random() * off.length)];
            const target = rand(ROAD_TOP + 40, ROAD_BOT - 40);
            s.vy = (target - s.y) / 2.2; s.vx = rand(-20, 20); s.flee = 2.2;
            returns++;
          }
        }
        return sheep.every((s) => offRoad(s.y) && s.flee <= 0);
      },
      draw() {
        drawRoadScene();
        for (const s of sheep) {
          const fx = s.vx !== 0 && s.flee > 0 ? Math.sign(s.vx) || s.dir : s.dir;
          g.fillStyle = 'rgba(0,0,0,0.2)';
          g.beginPath(); g.ellipse(s.x + 3, s.y + 12, 20, 6, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = C.wool;
          g.beginPath();
          for (const [ox, oy, r] of [[-8, 0, 12], [6, -2, 13], [0, 6, 11], [-2, -6, 10]]) { g.moveTo(s.x + ox + r, s.y + oy); g.arc(s.x + ox, s.y + oy, r, 0, Math.PI * 2); }
          g.fill();
          g.fillStyle = C.ink;
          g.beginPath(); g.ellipse(s.x + fx * 20, s.y - 2, 7, 5.5, 0, 0, Math.PI * 2); g.fill();
        }
      },
      down(x, y) {
        const s = sheep.filter((q) => Math.hypot(q.x - x, q.y - y) < 32).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
        if (!s) return;
        const up = s.y < (ROAD_TOP + ROAD_BOT) / 2;
        const target = up ? rand(40, ROAD_TOP - 30) : rand(ROAD_BOT + 30, GH - 30);
        s.vx = (s.x - x) * 2 + rand(-40, 40);
        s.vy = (target - s.y) / 0.9;
        s.flee = 0.9;
        RoadAudio.baa();
      },
      move() {},
      up() {}
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Stuck in the mud: rev at the right moment to rock the car free
  // ---------------------------------------------------------------------------
  function mudGame() {
    let angle = 0, speed = 1.5, zone = rand(-0.5, 0.5), width = 0.5, hits = 0, carX = 0, splash = [], shake = 0, flash = 0;
    const NEED = 4;
    const needle = () => Math.sin(angle) * 1.1;
    return {
      kicker: 'Stuck', title: 'Stuck in the mud',
      pay: { label: 'Call a tractor', cost: 15 },
      tap: 'Rev',
      hint: 'Tap Rev (or press Space) when the needle is in the green. Get it right four times to rock the car free.',
      get progress() { return hits / NEED; },
      step(dt) {
        angle += dt * speed;
        for (const s of splash) { s.age += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 500 * dt; }
        splash = splash.filter((s) => s.age < 0.8);
        shake = Math.max(0, shake - dt * 3);
        flash = Math.max(0, flash - dt * 2);
        return hits >= NEED && shake <= 0.05;
      },
      press() {
        const ok = Math.abs(needle() - zone) < width / 2;
        RoadAudio.rev(ok);
        for (let i = 0; i < (ok ? 26 : 12); i++) splash.push({ x: 300 + carX + rand(-30, 10), y: 330, vx: rand(-260, -40), vy: rand(-320, -120), age: 0 });
        if (ok) {
          hits++;
          carX += 34;
          shake = 0.6;
          speed += 0.3;
          width = Math.max(0.3, width - 0.04);
          zone = rand(-0.7, 0.7);
        } else {
          shake = 0.25;
          flash = 1;
        }
      },
      draw() {
        g.fillStyle = C.sky; g.fillRect(0, 0, GW, GH);
        g.fillStyle = '#6f7b6a'; g.fillRect(0, 250, GW, 60);
        g.fillStyle = C.mud; g.fillRect(0, 300, GW, GH - 300);
        g.fillStyle = C.mud2;
        for (let i = 0; i < 18; i++) { g.beginPath(); g.ellipse((i * 67) % GW, 330 + (i % 3) * 30, 40, 7, 0, 0, Math.PI * 2); g.fill(); }
        // the back end of the car, half sunk
        const sx = 300 + carX + (shake > 0 ? rand(-3, 3) * shake : 0), sy = 300 + (shake > 0 ? rand(-2, 2) * shake : 0);
        g.fillStyle = C.paint;
        roundRect(sx - 180, sy - 120, 300, 90, 16); g.fill();
        g.fillStyle = C.paintDark; g.fillRect(sx - 180, sy - 50, 300, 20);
        g.fillStyle = '#252d31'; g.fillRect(sx - 150, sy - 170, 210, 52);
        g.fillStyle = C.paint; g.fillRect(sx - 160, sy - 176, 230, 10);
        g.fillStyle = C.tyre; g.beginPath(); g.arc(sx - 90, sy - 20, 46, 0, Math.PI * 2); g.fill();
        g.fillStyle = C.metal; g.beginPath(); g.arc(sx - 90, sy - 20, 20, 0, Math.PI * 2); g.fill();
        g.fillStyle = C.mud; g.fillRect(0, sy + 4, GW, 30);
        g.fillStyle = 'rgba(80,60,40,0.95)';
        for (const s of splash) g.fillRect(s.x, s.y, 5, 5);
        // rev gauge
        const gx = 600, gy = 160, R = 110;
        g.lineWidth = 16;
        g.strokeStyle = 'rgba(20,20,20,0.35)';
        g.beginPath(); g.arc(gx, gy, R, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
        const toAng = (v) => Math.PI * 1.5 + v * 0.36 * Math.PI / 1.1 * 1.1;
        g.strokeStyle = '#7fae6b';
        g.beginPath(); g.arc(gx, gy, R, toAng(zone - width / 2), toAng(zone + width / 2)); g.stroke();
        g.strokeStyle = flash > 0 ? '#e0805f' : '#efe7d6';
        g.lineWidth = 5;
        const a = toAng(needle());
        g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + Math.cos(a) * (R + 6), gy + Math.sin(a) * (R + 6)); g.stroke();
        g.fillStyle = '#efe7d6'; g.beginPath(); g.arc(gx, gy, 8, 0, Math.PI * 2); g.fill();
        g.font = '500 12px "IBM Plex Mono", monospace';
        g.fillText('REVS', gx - 16, gy + 30);
        g.font = 'italic 22px "EB Garamond", Georgia, serif';
        g.fillText(`${hits} / ${NEED}`, gx - 18, gy + 60);
      },
      down() { this.press(); },
      move() {},
      up() {},
      key(code) { if (code === 'Space' || code === 'KeyE' || code === 'Enter') this.press(); }
    };
  }

  // ---------------------------------------------------------------------------
  // 5. Puncture: jack up the car, take the nuts off, swap the wheel, tighten up
  // ---------------------------------------------------------------------------
  function tyreGame() {
    let phase = 'jack', lift = 0, holding = null, swapT = 0, wheelSwap = 0;
    const nuts = [];
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i / 5) * Math.PI * 2; nuts.push({ a, off: 0, on: 1, spin: 0 }); }
    const cx = 400, cy = 250;
    const nutPos = (n) => [cx + Math.cos(n.a) * 52, cy + Math.sin(n.a) * 52];
    const ptr = { x: 0, y: 0, down: false };
    return {
      kicker: 'Breakdown', title: 'Change the tyre',
      pay: { label: 'Call roadside recovery', cost: 20 },
      tap: 'Pump',
      get hint() {
        return phase === 'jack' ? 'Tap Pump (or press Space) quickly to jack the car up.'
          : phase === 'undo' ? 'Hold on each wheel nut until it spins off.'
          : phase === 'swap' ? 'Swapping the flat for the spare…'
          : 'Now hold on each nut to tighten the spare on.';
      },
      get progress() {
        if (phase === 'jack') return lift * 0.25;
        if (phase === 'undo') return 0.25 + 0.3 * (nuts.filter((n) => n.on <= 0).length / 5);
        if (phase === 'swap') return 0.55 + 0.1 * swapT;
        return 0.65 + 0.35 * (nuts.filter((n) => n.on >= 1).length / 5);
      },
      step(dt) {
        if (phase === 'jack') {
          if (lift >= 1) { phase = 'undo'; ui.tap.hidden = true; }
          else lift = Math.max(0, lift - dt * 0.12);
        } else if (phase === 'undo' || phase === 'tight') {
          holding = null;
          if (ptr.down) {
            for (const n of nuts) {
              const [nx, ny] = nutPos(n);
              if (Math.hypot(ptr.x - nx, ptr.y - ny) < 30) holding = n;
            }
          }
          if (holding) {
            holding.spin += dt * 14;
            if (phase === 'undo' && holding.on > 0) { holding.on = Math.max(0, holding.on - dt / 0.6); RoadAudio.ratchet(); }
            if (phase === 'tight' && holding.on < 1) { holding.on = Math.min(1, holding.on + dt / 0.5); RoadAudio.ratchet(); }
          }
          if (phase === 'undo' && nuts.every((n) => n.on <= 0)) { phase = 'swap'; swapT = 0; }
          if (phase === 'tight' && nuts.every((n) => n.on >= 1)) return true;
        } else if (phase === 'swap') {
          swapT += dt / 1.6;
          wheelSwap = swapT;
          if (swapT >= 1) { phase = 'tight'; wheelSwap = 1; }
        }
        return false;
      },
      press() { if (phase === 'jack') { lift = Math.min(1, lift + 0.11); RoadAudio.ratchet(); } },
      draw() {
        g.fillStyle = C.sky; g.fillRect(0, 0, GW, GH);
        g.fillStyle = C.field; g.fillRect(0, 330, GW, GH - 330);
        g.fillStyle = C.road; g.fillRect(0, 360, GW, 40);
        const up = (phase === 'jack' ? lift : 1) * 26;
        // car body
        g.fillStyle = C.paint;
        roundRect(80, 120 - up, 640, 110, 18); g.fill();
        g.fillStyle = C.paintDark; g.fillRect(80, 200 - up, 640, 30);
        g.fillStyle = '#252d31'; g.fillRect(150, 60 - up, 420, 56);
        g.fillStyle = C.paint; g.fillRect(140, 52 - up, 440, 10);
        // arch
        g.fillStyle = '#18191a';
        g.beginPath(); g.arc(cx, cy - up + 6, 104, Math.PI, 0); g.fill();
        // jack
        g.fillStyle = C.metal;
        g.fillRect(560, 330 - up - 10, 18, up + 20);
        g.fillRect(540, 330, 58, 10);
        // wheel(s)
        const drawWheel = (x, y, flat) => {
          g.fillStyle = C.tyre;
          g.beginPath();
          if (flat) g.ellipse(x, y + 8, 98, 90, 0, 0, Math.PI * 2); else g.arc(x, y, 96, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = C.metal; g.beginPath(); g.arc(x, y, 64, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#7f817d'; g.beginPath(); g.arc(x, y, 22, 0, Math.PI * 2); g.fill();
        };
        if (phase === 'swap') {
          drawWheel(cx - wheelSwap * 520, cy - up, true);
          drawWheel(cx + (1 - wheelSwap) * 520, cy - up, false);
        } else {
          drawWheel(cx, cy - up, phase === 'jack' || phase === 'undo');
        }
        if (phase !== 'swap') {
          for (const n of nuts) {
            const [nx, ny] = nutPos(n);
            if (phase === 'undo' && n.on <= 0) continue;
            if (phase === 'tight' && n.on <= 0 && holding !== n) {
              g.strokeStyle = 'rgba(239,231,214,0.7)'; g.lineWidth = 2;
              g.beginPath(); g.arc(nx, ny - up, 12, 0, Math.PI * 2); g.stroke();
              continue;
            }
            g.save();
            g.translate(nx, ny - up);
            g.rotate(n.spin);
            g.fillStyle = holding === n ? '#efe7d6' : '#cfd0cc';
            g.beginPath();
            for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; g.lineTo(Math.cos(a) * 12, Math.sin(a) * 12); }
            g.closePath(); g.fill();
            g.restore();
          }
        }
        if (phase === 'jack') {
          g.fillStyle = 'rgba(20,20,20,0.35)'; g.fillRect(620, 160, 22, 160);
          g.fillStyle = '#7fae6b'; g.fillRect(620, 320 - lift * 160, 22, lift * 160);
        }
      },
      down(x, y) { ptr.down = true; ptr.x = x; ptr.y = y; if (phase === 'jack') this.press(); },
      move(x, y) { ptr.x = x; ptr.y = y; },
      up() { ptr.down = false; },
      key(code) { if (code === 'Space' || code === 'KeyE' || code === 'Enter') this.press(); }
    };
  }

  // ---------------------------------------------------------------------------
  // 6. Fill up at the pump: hold to pump, let go right at the top
  // ---------------------------------------------------------------------------
  function pumpGame(data) {
    let fuel = clamp((data && data.fuel) || 0, 0, 100);
    const start = fuel;
    let holding = false, ramp = 0, spilled = false, spill = [], finishedAt = -1, clickT = 0, spillT = 0;
    const TARGET = 92;
    return {
      kicker: 'Fuel station', title: 'Fill up the tank',
      tap: 'Hold',
      get hint() {
        if (spilled && holding) return 'Whoops, it’s overflowing! Let go.';
        if (fuel >= TARGET && !holding) return spilled ? 'Full, with a bit down the side. Done.' : 'Full. Nicely done.';
        if (fuel >= 84) return 'Nearly full. The pump slows down here. Let go when the needle is in the green.';
        if (!holding && fuel > start + 1) return 'Hold again to keep pumping, or tap Not now to drive off with what you’ve got.';
        return 'Hold the Hold button (or hold Space) to pump. Let go when the needle reaches the green part of the gauge.';
      },
      get progress() { return clamp((fuel - start) / Math.max(1, TARGET - start), 0, 1); },
      hold(on) { holding = on; if (!on) ramp = 0; },
      step(dt) {
        if (holding) {
          ramp = Math.min(1, ramp + dt / 1.2);
          let flow = 5 + 13 * ramp;             // up to 18% a second
          if (fuel > 84) flow *= 0.4;           // the nozzle slows near the top
          fuel += flow * dt;
          clickT -= dt;
          if (clickT <= 0) { RoadAudio.glug(); clickT = 0.5; }
          if (fuel > 100) {
            fuel = 100;
            spilled = true;
            spillT -= dt;
            if (spillT <= 0) { spillT = 0.05; for (let i = 0; i < 3; i++) spill.push({ x: 540 + rand(-6, 6), y: 214, vx: rand(-80, 80), vy: rand(-60, 20), age: 0 }); }
          }
        }
        for (const d of spill) { d.age += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 420 * dt; }
        spill = spill.filter((d) => d.age < 1.2);
        if (!holding && fuel >= TARGET) {
          if (finishedAt < 0) finishedAt = 0;
          finishedAt += dt;
          return finishedAt > 0.5;
        }
        finishedAt = -1;
        return false;
      },
      result() { return { fuel: Math.min(100, fuel), spilled }; },
      draw() {
        g.fillStyle = '#b7bfbf'; g.fillRect(0, 0, GW, GH);
        g.fillStyle = '#9ca4a4'; g.fillRect(0, 330, GW, GH - 330);
        // pump
        g.fillStyle = '#c9c1b0'; roundRect(70, 60, 170, 300, 10); g.fill();
        g.fillStyle = C.paint; g.fillRect(70, 60, 170, 46);
        g.fillStyle = '#efe7d6'; g.font = '500 18px "IBM Plex Mono", monospace'; g.fillText('FUEL', 128, 90);
        g.fillStyle = '#20241f'; g.fillRect(92, 124, 126, 54);
        g.fillStyle = '#a6d08d'; g.font = '500 24px "IBM Plex Mono", monospace';
        g.fillText(`${Math.round(fuel)}%`, 112, 160);
        // hose
        g.strokeStyle = '#1d1e1f'; g.lineWidth = 10; g.lineCap = 'round';
        g.beginPath(); g.moveTo(240, 220); g.bezierCurveTo(330, 330, 420, 330, 500, 220); g.stroke();
        g.lineCap = 'butt';
        // car side with the filler flap
        g.fillStyle = C.paint; roundRect(470, 150, 330, 170, 20); g.fill();
        g.fillStyle = C.paintDark; g.fillRect(470, 270, 330, 50);
        g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(560, 214, 16, 0, Math.PI * 2); g.fill();
        // nozzle
        g.save(); g.translate(512, 206); g.rotate(holding ? 0.05 : 0);
        g.fillStyle = '#2b2d2e'; roundRect(-30, -16, 46, 30, 6); g.fill();
        g.fillStyle = '#4f5a3a'; g.fillRect(14, -6, 36, 10);
        g.fillStyle = holding ? '#efe7d6' : '#6d6f6c'; g.fillRect(-24, 12, 18, 14);
        g.restore();
        g.fillStyle = 'rgba(160,140,60,0.85)';
        for (const d of spill) g.fillRect(d.x, d.y, 4, 4);
        // fuel gauge
        const gx = 650, gy = 110, R = 70;
        g.lineWidth = 12;
        g.strokeStyle = 'rgba(20,20,20,0.3)';
        g.beginPath(); g.arc(gx, gy, R, Math.PI, 0); g.stroke();
        const ang = (v) => Math.PI + (v / 100) * Math.PI;
        g.strokeStyle = '#7fae6b';
        g.beginPath(); g.arc(gx, gy, R, ang(TARGET), ang(100)); g.stroke();
        g.strokeStyle = '#c0533a';
        g.beginPath(); g.arc(gx, gy, R, ang(99.5), ang(100) + 0.08); g.stroke();
        g.strokeStyle = spilled ? '#e0805f' : '#efe7d6';
        g.lineWidth = 4;
        g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + Math.cos(ang(fuel)) * (R + 4), gy + Math.sin(ang(fuel)) * (R + 4)); g.stroke();
        g.fillStyle = '#efe7d6';
        g.font = '500 12px "IBM Plex Mono", monospace';
        g.fillText('E', gx - R - 18, gy + 4);
        g.fillText('F', gx + R + 10, gy + 4);
      },
      down() { this.hold(true); },
      move() {},
      up() { this.hold(false); },
      key(code) { if (code === 'Space' || code === 'KeyE' || code === 'Enter') this.hold(true); },
      keyUp(code) { if (code === 'Space' || code === 'KeyE' || code === 'Enter') this.hold(false); }
    };
  }

  // ---------------------------------------------------------------------------
  // 7. Jerry can: pour into the funnel without letting it overflow
  // ---------------------------------------------------------------------------
  function canGame(data) {
    let left = (data && data.amount) || 60;
    const total = left;
    let tank = clamp((data && data.fuel) || 0, 0, 100);
    let funnel = 0, holding = false, tilt = 0, spilled = 0, added = 0, drips = [], glugT = 0;
    const FUNNEL = 12, POUR = 15, DRAIN = 11;
    return {
      kicker: 'By the roadside', title: 'Pour in the jerry can',
      tap: 'Pour',
      get hint() {
        if (funnel > FUNNEL * 0.85) return 'The funnel’s nearly overflowing. Let go!';
        if (tank >= 99.9) return 'The tank’s full.';
        return 'Hold Pour (or hold Space) to tip the can. Let go when the funnel gets near the red line, then pour again.';
      },
      get progress() { return 1 - left / total; },
      hold(on) { holding = on; },
      step(dt) {
        tilt += ((holding && left > 0 ? 1 : 0) - tilt) * Math.min(1, dt * 7);
        const pour = tilt > 0.6 ? Math.min(left, POUR * dt * tilt) : 0;
        left -= pour;
        funnel += pour;
        if (pour > 0) { glugT -= dt; if (glugT <= 0) { RoadAudio.glug(); glugT = 0.45; } }
        if (funnel > FUNNEL) {
          const over = funnel - FUNNEL;
          spilled += over;
          funnel = FUNNEL;
          for (let i = 0; i < 3; i++) drips.push({ x: 430 + rand(-40, 40), y: 250, vx: rand(-60, 60), vy: rand(-40, 30), age: 0 });
        }
        const d = Math.min(funnel, DRAIN * dt);
        funnel -= d;
        const room = Math.max(0, 100 - tank);
        const into = Math.min(room, d);
        tank += into;
        added += into;
        spilled += d - into;
        for (const q of drips) { q.age += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 420 * dt; }
        drips = drips.filter((q) => q.age < 1);
        if (tank >= 99.9 && funnel <= 0.01) { holding = false; return true; }
        return left <= 0.01 && funnel <= 0.01;
      },
      result() { return { added, spilled }; },
      draw() {
        g.fillStyle = C.sky; g.fillRect(0, 0, GW, GH);
        g.fillStyle = C.field; g.fillRect(0, 340, GW, GH - 340);
        // car side
        g.fillStyle = C.paint; roundRect(300, 290, 500, 120, 18); g.fill();
        g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(430, 300, 12, 0, Math.PI * 2); g.fill();
        // funnel
        g.fillStyle = '#c8c8c0';
        g.beginPath(); g.moveTo(380, 210); g.lineTo(480, 210); g.lineTo(440, 280); g.lineTo(440, 300); g.lineTo(420, 300); g.lineTo(420, 280); g.closePath(); g.fill();
        const lvl = funnel / FUNNEL;
        if (lvl > 0) {
          const y = 280 - lvl * 70, half = 10 + (280 - y) * (50 / 70);
          g.fillStyle = lvl > 0.85 ? '#c0533a' : '#b49a43';
          g.beginPath(); g.moveTo(430 - half, y); g.lineTo(430 + half, y); g.lineTo(440, 280); g.lineTo(420, 280); g.closePath(); g.fill();
        }
        g.strokeStyle = '#c0533a'; g.lineWidth = 2; g.setLineDash([5, 4]);
        g.beginPath(); g.moveTo(374, 216); g.lineTo(486, 216); g.stroke(); g.setLineDash([]);
        // the can, tipping
        g.save();
        g.translate(300, 150);
        g.rotate(tilt * 1.1);
        g.fillStyle = '#c0533a'; roundRect(-70, -60, 120, 150, 10); g.fill();
        g.fillStyle = '#9d3f2b'; g.fillRect(-60, -40, 100, 10); g.fillRect(-60, 60, 100, 10);
        g.fillStyle = '#2b2d2e'; g.fillRect(-40, -78, 50, 18);
        g.fillStyle = '#d7d2c4'; g.fillRect(40, -66, 50, 14);
        g.restore();
        if (tilt > 0.6 && left > 0) {
          g.strokeStyle = '#b49a43'; g.lineWidth = 6;
          g.beginPath(); g.moveTo(370, 150 + 40 * tilt); g.quadraticCurveTo(420, 170, 428, 214); g.stroke();
        }
        g.fillStyle = 'rgba(180,154,67,0.9)';
        for (const q of drips) g.fillRect(q.x, q.y, 4, 4);
        // can level and tank gauge
        g.fillStyle = 'rgba(20,20,20,0.3)'; g.fillRect(620, 70, 24, 200); g.fillRect(690, 70, 24, 200);
        g.fillStyle = '#c0533a'; g.fillRect(620, 70 + 200 * (1 - left / total), 24, 200 * (left / total));
        g.fillStyle = '#7fae6b'; g.fillRect(690, 70 + 200 * (1 - tank / 100), 24, 200 * (tank / 100));
        g.fillStyle = '#26231f'; g.font = '500 11px "IBM Plex Mono", monospace';
        g.fillText('CAN', 620, 290); g.fillText('TANK', 686, 290);
        if (spilled > 0.5) g.fillText(`spilt ${spilled.toFixed(0)}%`, 600, 312);
      },
      down() { this.hold(true); },
      move() {},
      up() { this.hold(false); },
      key(code) { if (code === 'Space' || code === 'KeyE' || code === 'Enter') this.hold(true); },
      keyUp(code) { if (code === 'Space' || code === 'KeyE' || code === 'Enter') this.hold(false); }
    };
  }

  const GAMES = { tree: treeGame, rocks: rocksGame, sheep: sheepGame, mud: mudGame, tyre: tyreGame, pump: pumpGame, can: canGame };

  // ---------------------------------------------------------------------------
  // Running a game
  // ---------------------------------------------------------------------------
  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = ui.stage.clientWidth;
    scale = w / GW;
    ui.canvas.width = Math.round(GW * scale * dpr);
    ui.canvas.height = Math.round(GH * scale * dpr);
    ui.canvas.style.width = `${GW * scale}px`;
    ui.canvas.style.height = `${GH * scale}px`;
    g.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }

  function toGame(e) {
    const r = ui.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  }

  function loop(now) {
    if (!game) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const won = game.step(dt);
    game.draw();
    ui.hint.textContent = game.hint;
    ui.bar.style.width = `${Math.round(game.progress * 100)}%`;
    if (won && !finished) {
      finished = true;
      RoadAudio.chime();
      ui.hint.textContent = 'Done!';
      setTimeout(() => finish('won'), 700);
    }
    raf = requestAnimationFrame(loop);
  }

  function finish(result) {
    if (!game) return;
    if (game.end) game.end();
    cancelAnimationFrame(raf);
    const o = opts;
    const cost = game.pay ? game.pay.cost : 0;
    const res = game.result ? game.result() : null;
    game = null;
    opts = null;
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    if (result === 'won' && o.onWin) o.onWin(res);
    if (result === 'paid' && o.onPay) o.onPay(cost);
    if (result === 'cancel' && o.onCancel) o.onCancel(res);
  }

  function open(kind, options) {
    if (game) return;
    opts = options || {};
    game = GAMES[kind](opts.data);
    finished = false;
    ui.kicker.textContent = game.kicker;
    ui.title.textContent = game.title;
    ui.hint.textContent = game.hint;
    ui.tap.hidden = !game.tap;
    ui.tap.textContent = game.tap || '';
    const money = opts.money || 0;
    ui.pay.hidden = !game.pay;
    if (game.pay) {
      ui.pay.textContent = `${game.pay.label} (£${game.pay.cost})`;
      ui.pay.disabled = money < game.pay.cost;
      ui.pay.title = ui.pay.disabled ? 'You don’t have enough money' : '';
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => { fit(); last = performance.now(); raf = requestAnimationFrame(loop); });
  }

  ui.canvas.addEventListener('pointerdown', (e) => { if (!game) return; e.preventDefault(); ui.canvas.setPointerCapture(e.pointerId); const [x, y] = toGame(e); game.down(x, y); game.move(x, y); });
  ui.canvas.addEventListener('pointermove', (e) => { if (!game) return; const [x, y] = toGame(e); game.move(x, y); });
  const release = () => { if (game) game.up(); };
  ui.canvas.addEventListener('pointerup', release);
  ui.canvas.addEventListener('pointercancel', release);
  ui.tap.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!game) return;
    if (game.hold) { ui.tap.setPointerCapture(e.pointerId); game.hold(true); } else if (game.press) game.press();
  });
  const tapUp = () => { if (game && game.hold) game.hold(false); };
  ui.tap.addEventListener('pointerup', tapUp);
  ui.tap.addEventListener('pointercancel', tapUp);
  // stop phones treating a long hold as text selection or a long-press menu, which cancels the hold
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  [ui.tap, ui.canvas].forEach((el) => el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false }));
  addEventListener('blur', () => { if (game) { if (game.hold) game.hold(false); else game.up(); } });
  ui.close.addEventListener('click', () => finish('cancel'));
  ui.pay.addEventListener('click', () => { if (opts && game && game.pay && (opts.money || 0) >= game.pay.cost) finish('paid'); });
  addEventListener('resize', () => { if (game) fit(); });

  return {
    open,
    key(code) {
      if (!game) return;
      if (code === 'Escape') { finish('cancel'); return; }
      if (game.key) game.key(code);
    },
    keyUp(code) { if (game && game.keyUp) game.keyUp(code); },
    get isOpen() { return !!game; }
  };
})();
