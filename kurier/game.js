/* НОЧНОЙ КУРЬЕР — неоновая аркада про доставку.
   Чистый JS, без сборщиков. Управление: клавиатура (WASD/стрелки) и палец (виртуальный стик).
   Арт: assets/*.png сгенерированы через Polza API (см. tools/gen_assets.sh). */
'use strict';

/* ============================ утилиты ============================ */
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
function angLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function store(key, val) {
  try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); }
  catch (e) { return null; }
}

/* ============================ константы ============================ */
const COL = {
  neon: '#ff2f8e', cyan: '#35f2ff', amber: '#ffd166', violet: '#a45cff', mint: '#66ffb2',
  road: '#0a0b16', walk: '#141726', bld: '#05060e', white: '#ffffff'
};
const SIGNS = [COL.neon, COL.cyan, COL.amber, COL.violet, COL.mint];

// где в сгенерированной картинке улицы лежат проезжая часть и тротуары (доли ширины)
const ART = { street: [0.17, 0.83], walkL: [0.005, 0.16], walkR: [0.84, 0.995] };

const CFG = {
  startTime: 60,      // секунд на смену
  timePerDelivery: 6, // прибавка за доставку
  timePerCrash: 3,    // штраф за столкновение
  capacity: 3,        // посылок в фургоне
  scorePerParcel: 100,
  pickupScore: 20,
  packagesOnMap: 4,
  maxCars: 9
};

/* ============================ ассеты ============================ */
const SRC = {
  splash: 'assets/splash.png',
  road: 'assets/bg_road.png',
  skyline: 'assets/skyline.png',
  van: 'assets/van_cut.png'
};
const IMG = {};

/* ============================ звук ============================ */
const Audio_ = {
  muted: false, ready: false, wanted: 'menu', current: null, menu: null, game: null,
  init() {
    this.menu = new Audio('assets/music_menu.mp3');
    this.game = new Audio('assets/music_loop.mp3');
    for (const t of [this.menu, this.game]) { t.loop = true; t.volume = 0; t.preload = 'auto'; }
    this.game.volume = 0.55;
    this.menu.volume = 0.4;
  },
  // какую дорожку хотим слышать; реально заиграет после первого жеста пользователя
  request(which) { this.wanted = which; if (this.ready) this.sync(); },
  unlock() { this.ready = true; this.sync(); },
  sync() {
    const t = this.wanted === 'game' ? this.game : this.menu;
    if (!t) return;
    if (this.current && this.current !== t) this.current.pause();
    this.current = t;
    if (this.muted) { t.pause(); return; }
    const p = t.play(); if (p && p.catch) p.catch(() => {});
  },
  pauseMusic() { if (this.current) this.current.pause(); },
  toggle() {
    this.muted = !this.muted;
    if (this.muted) this.pauseMusic(); else this.sync();
    return this.muted;
  }
};

let actx = null;
// создаём AudioContext только внутри настоящего жеста пользователя —
// иначе браузер ругается в консоль и звук всё равно не запускается
function unlockAudio() {
  const C = window.AudioContext || window.webkitAudioContext;
  if (C) {
    try {
      if (!actx) actx = new C();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
  }
  Audio_.unlock();
}
function audioCtx() { return actx && actx.state === 'running' ? actx : null; }
function tone(freq, dur, type, vol, glide) {
  if (Audio_.muted) return;
  const a = audioCtx(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(40, glide), a.currentTime + dur);
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.exponentialRampToValueAtTime(vol || 0.07, a.currentTime + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start(); o.stop(a.currentTime + dur + 0.02);
}
function noise(dur, vol) {
  if (Audio_.muted) return;
  const a = audioCtx(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource(); s.buffer = buf;
  const g = a.createGain(); g.gain.value = vol || 0.22;
  const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
  s.connect(f).connect(g).connect(a.destination);
  s.start();
}
function sfx(name) {
  if (Audio_.muted) return;
  switch (name) {
    case 'pickup': tone(660, 0.09, 'square', 0.06, 1180); break;
    case 'full': tone(420, 0.12, 'triangle', 0.06, 320); break;
    case 'deliver':
      tone(523, 0.12, 'square', 0.06);
      setTimeout(() => tone(784, 0.13, 'square', 0.055), 90);
      setTimeout(() => tone(1046, 0.2, 'square', 0.05), 185);
      break;
    case 'crash': noise(0.32, 0.3); tone(150, 0.3, 'sawtooth', 0.09, 60); break;
    case 'over': tone(330, 0.5, 'sawtooth', 0.07, 90); setTimeout(() => tone(220, 0.7, 'triangle', 0.06, 70), 220); break;
    case 'ui': tone(880, 0.06, 'square', 0.045); break;
  }
}

/* ============================ холст и раскладка ============================ */
const cv = $('#cv');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;

const L = {           // вычисляемая раскладка мира
  streetW: 0, streetX0: 0, streetX1: 0, walkW: 0, bldLeft: 0, bldRight: 0,
  laneDownX: 0, laneUpX: 0, doorW: 0, S: 1,
  vanLen: 120, vanWid: 58, carW: 92, carLen: 150, pkgR: 26
};

function computeLayout() {
  const portrait = H > W;
  L.streetW = clamp(W * (portrait ? 0.54 : 0.58), 190, 680);
  L.streetX0 = Math.round((W - L.streetW) / 2);
  L.streetX1 = L.streetX0 + L.streetW;
  const sideSpace = (W - L.streetW) / 2;
  L.walkW = clamp(Math.min(sideSpace * 0.66, L.streetW * 0.3), 16, 280);
  L.bldRight = L.streetX0 - L.walkW;   // правый край левого массива домов
  L.bldLeft = L.streetX1 + L.walkW;    // левый край правого массива домов
  L.laneDownX = L.streetX0 + L.streetW * 0.26;   // левая полоса — вниз
  L.laneUpX = L.streetX0 + L.streetW * 0.74;     // правая полоса — вверх
  // масштаб техники: по короткой стороне экрана, но с оглядкой на ширину улицы
  L.S = clamp(Math.min(W, H) / 620, 0.5, 1.3);
  L.S = Math.min(L.S, L.streetW / 400);
  L.vanLen = Math.max(28, 132 * L.S);
  L.vanWid = L.vanLen * 0.486;
  L.carW = Math.max(20, 94 * L.S);
  L.carLen = Math.max(34, 152 * L.S);
  L.pkgR = Math.max(7, 27 * L.S);
  L.doorW = Math.max(26, Math.min(L.walkW * 0.9, L.streetW * 0.26));
  L.doorH = Math.max(46, Math.min(H * 0.17, L.vanLen * 1.35));
}

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const r = $('#game').getBoundingClientRect();
  W = Math.max(260, Math.round(r.width));
  H = Math.max(300, Math.round(r.height));
  cv.width = Math.round(W * DPR);
  cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px';
  cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  computeLayout();
  if (G.state === 'playing' || G.state === 'paused') relayoutWorld();
  buildRain();
}

/* ============================ игровое состояние ============================ */
const G = {
  state: 'loading',   // loading | splash | playing | paused | over
  score: 0, best: 0, bestDeliv: 0, time: CFG.startTime, deliveries: 0, combo: 0, elapsed: 0,
  van: null, cars: [], pkgs: [], parts: [], pops: [], houses: [], target: null,
  shake: 0, flash: 0, carTimer: 1, pkgTimer: 0, rain: [], lastCount: 0
};
G.best = parseInt(store('kurier_best') || '0', 10) || 0;
G.bestDeliv = parseInt(store('kurier_best_deliv') || '0', 10) || 0;

function makeVan() {
  return {
    x: W / 2, y: H * 0.82, vx: 0, vy: 0, angle: -Math.PI / 2,
    invuln: 0, carry: 0, hit: 0
  };
}

function buildHouses() {
  const list = [];
  const fracs = [0.26, 0.72];
  const cols = [COL.cyan, COL.neon, COL.mint, COL.amber];
  let ci = 0;
  for (const side of ['left', 'right']) {
    for (const f of fracs) {
      const cy = H * f;
      const h = L.doorH;
      const door = side === 'left'
        ? { x: L.bldRight, y: cy - h / 2, w: L.doorW, h: h }
        : { x: L.bldLeft - L.doorW, y: cy - h / 2, w: L.doorW, h: h };
      const bodyW = Math.min(side === 'left' ? L.bldRight : W - L.bldLeft, Math.max(60, W * 0.16));
      const body = side === 'left'
        ? { x: Math.max(0, L.bldRight - bodyW), y: cy - h * 1.15, w: bodyW, h: h * 2.3 }
        : { x: L.bldLeft, y: cy - h * 1.15, w: bodyW, h: h * 2.3 };
      list.push({ side: side, cy: cy, door: door, body: body, color: cols[ci % cols.length], idx: ci, phase: rand(0, 6.28) });
      ci++;
    }
  }
  return list;
}

function pickTarget(exclude) {
  const pool = G.houses.filter(h => h !== exclude);
  G.target = pool[Math.floor(Math.random() * pool.length)] || G.houses[0];
}

function spawnPkg() {
  if (G.pkgs.length >= CFG.packagesOnMap) return;
  for (let i = 0; i < 24; i++) {
    const x = rand(L.bldRight + L.pkgR + 6, L.bldLeft - L.pkgR - 6);
    const y = rand(L.pkgR + 10, H - L.pkgR - 10);
    if (Math.hypot(x - G.van.x, y - G.van.y) < L.vanLen * 1.3) continue;
    let bad = false;
    for (const p of G.pkgs) if (Math.hypot(x - p.x, y - p.y) < L.pkgR * 3) bad = true;
    if (bad) continue;
    G.pkgs.push({ x: x, y: y, r: L.pkgR, t: rand(0, 6.28), born: 0 });
    return;
  }
}

function spawnCar() {
  if (G.cars.length >= CFG.maxCars) return;
  const down = Math.random() < 0.5;               // левая полоса — вниз, правая — вверх
  const lane = down ? L.laneDownX : L.laneUpX;
  const speed = rand(120, 190) * L.S * (1 + Math.min(0.85, G.elapsed * 0.012));
  const x = lane + rand(-L.streetW * 0.06, L.streetW * 0.06);
  const y = down ? -L.carLen - 20 : H + L.carLen + 20;
  G.cars.push({
    x: x, y: y, dir: down ? 1 : -1, speed: speed,
    w: L.carW * rand(0.92, 1.08), len: L.carLen * rand(0.85, 1.15),
    hue: Math.random() < 0.5 ? COL.neon : COL.cyan
  });
}

function burst(x, y, n, color, spread, spd) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, 6.28), s = rand(0.25, 1) * (spd || 260);
    G.parts.push({
      x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.25, 0.7), max: 0.7, color: color, size: rand(3, 9) * L.S * spread
    });
  }
  if (G.parts.length > 220) G.parts.splice(0, G.parts.length - 220);
}
function pop(x, y, text, color) {
  G.pops.push({ x: x, y: y, text: text, color: color, life: 1.1, max: 1.1 });
  if (G.pops.length > 12) G.pops.shift();
}

/* ============================ старт / конец смены ============================ */
function resetWorld() {
  G.score = 0; G.time = CFG.startTime; G.deliveries = 0; G.combo = 0; G.elapsed = 0;
  G.cars = []; G.pkgs = []; G.parts = []; G.pops = [];
  G.shake = 0; G.flash = 0; G.carTimer = 0.8; G.pkgTimer = 0;
  G.houses = buildHouses();
  G.van = makeVan();
  pickTarget(null);
  for (let i = 0; i < CFG.packagesOnMap; i++) spawnPkg();
  syncHud();
}
function relayoutWorld() {
  const rx = G.van.x / (W || 1), ry = G.van.y / (H || 1);
  computeLayout();
  G.van.x = clamp(rx * W, L.bldRight + L.vanWid, L.bldLeft - L.vanWid);
  G.van.y = clamp(ry * H, 20, H - 20);
  G.houses = buildHouses();
  G.cars = []; G.pkgs = [];
  pickTarget(null);
  for (let i = 0; i < CFG.packagesOnMap; i++) spawnPkg();
  buildRain();
}

function startGame() {
  resetWorld();
  G.state = 'playing';
  show('#splash', false); show('#over', false); show('#pause', false); show('#hud', true); show('#loading', false);
  Audio_.request('game');
}
function gameOver() {
  G.state = 'over';
  sfx('over');
  Audio_.request('menu');
  const isBest = G.score > G.best;
  if (isBest) { G.best = G.score; store('kurier_best', String(G.best)); }
  if (G.deliveries > G.bestDeliv) { G.bestDeliv = G.deliveries; store('kurier_best_deliv', String(G.bestDeliv)); }
  $('#overScore').textContent = G.score;
  $('#overDeliv').textContent = G.deliveries;
  $('#overBest').textContent = G.best;
  $('#overReason').textContent = 'Время вышло. Успел доставить ' + G.deliveries + ' ' + plural(G.deliveries, 'посылку', 'посылки', 'посылок') + '.';
  show('#newBest', !!isBest);
  show('#hud', false);
  show('#over', true);
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
function show(sel, on) {
  const el = $(sel); if (!el) return;
  el.classList.toggle('hidden', !on);
}
function togglePause(force) {
  if (G.state === 'playing' && force !== false) {
    G.state = 'paused'; show('#pause', true); Audio_.pauseMusic();
  } else if (G.state === 'paused') {
    G.state = 'playing'; show('#pause', false); Audio_.sync();
  }
}

/* ============================ управление ============================ */
const keys = { up: false, down: false, left: false, right: false };
const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right'
};
window.addEventListener('keydown', e => {
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); return; }
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (G.state === 'splash' || G.state === 'over') { sfx('ui'); startGame(); }
    else if (G.state === 'paused') togglePause();
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); togglePause(); return; }
  if (e.code === 'KeyM') { setMuted(Audio_.toggle()); }
});
window.addEventListener('keyup', e => {
  const k = KEYMAP[e.code];
  if (k) { keys[k] = false; e.preventDefault(); }
});
window.addEventListener('blur', () => { keys.up = keys.down = keys.left = keys.right = false; if (G.state === 'playing') togglePause(); });

const joy = { on: false, id: null, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0, mag: 0 };
function joyRadius() { return clamp(Math.min(W, H) * 0.17, 48, 130); }
function joySet(e) {
  const dx = e.offsetX - joy.ox, dy = e.offsetY - joy.oy;
  const len = Math.hypot(dx, dy), r = joyRadius();
  const m = Math.min(1, len / r);
  joy.mag = m < 0.14 ? 0 : m;
  joy.dx = len > 0.001 ? dx / len : 0;
  joy.dy = len > 0.001 ? dy / len : 0;
  joy.x = e.offsetX; joy.y = e.offsetY;
}
cv.addEventListener('pointerdown', e => {
  if (G.state !== 'playing') return;
  if (joy.on) return;
  joy.on = true; joy.id = e.pointerId;
  joy.ox = e.offsetX; joy.oy = e.offsetY; joy.x = e.offsetX; joy.y = e.offsetY;
  joy.dx = joy.dy = joy.mag = 0;
  if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (err) {} }
  e.preventDefault();
}, { passive: false });
cv.addEventListener('pointermove', e => {
  if (!joy.on || e.pointerId !== joy.id) return;
  joySet(e); e.preventDefault();
}, { passive: false });
function joyEnd(e) {
  if (!joy.on || (e && e.pointerId !== joy.id)) return;
  joy.on = false; joy.id = null; joy.mag = 0; joy.dx = joy.dy = 0;
}
cv.addEventListener('pointerup', joyEnd);
cv.addEventListener('pointercancel', joyEnd);
cv.addEventListener('pointerleave', joyEnd);
window.addEventListener('contextmenu', e => { if (e.target === cv) e.preventDefault(); });

function inputVec() {
  let x = 0, y = 0;
  if (keys.left) x -= 1;
  if (keys.right) x += 1;
  if (keys.up) y -= 1;
  if (keys.down) y += 1;
  if (joy.mag > 0) { x += joy.dx * joy.mag; y += joy.dy * joy.mag; }
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  return { x: x, y: y, len: Math.min(1, len) };
}

/* ============================ обновление мира ============================ */
function update(dt) {
  if (G.state !== 'playing') { updateFx(dt); return; }
  G.elapsed += dt;
  const v = G.van;

  /* --- физика фургона --- */
  const inp = inputVec();
  const accel = 1500 * L.S;
  if (inp.len > 0.01) { v.vx += inp.x * accel * dt; v.vy += inp.y * accel * dt; }
  const drag = inp.len > 0.01 ? 0.7 : 3.4;
  const f = Math.exp(-drag * dt);
  v.vx *= f; v.vy *= f;
  const maxS = 470 * L.S;
  const sp = Math.hypot(v.vx, v.vy);
  if (sp > maxS) { v.vx *= maxS / sp; v.vy *= maxS / sp; }
  v.x += v.vx * dt; v.y += v.vy * dt;
  if (sp > 40 * L.S) v.angle = angLerp(v.angle, Math.atan2(v.vy, v.vx), 1 - Math.exp(-10 * dt));
  if (v.invuln > 0) v.invuln -= dt;
  if (v.hit > 0) v.hit -= dt;

  /* --- стены: массивы домов по бокам --- */
  const padX = L.vanWid * 0.55;
  if (v.x < L.bldRight + padX) { v.x = L.bldRight + padX; v.vx = Math.abs(v.vx) * 0.25; }
  if (v.x > L.bldLeft - padX) { v.x = L.bldLeft - padX; v.vx = -Math.abs(v.vx) * 0.25; }
  if (v.y < L.vanLen * 0.5) { v.y = L.vanLen * 0.5; v.vy = Math.abs(v.vy) * 0.25; }
  if (v.y > H - L.vanLen * 0.5) { v.y = H - L.vanLen * 0.5; v.vy = -Math.abs(v.vy) * 0.25; }

  /* --- спавн машин и посылок --- */
  G.carTimer -= dt;
  if (G.carTimer <= 0) {
    spawnCar();
    G.carTimer = clamp(2.0 - G.elapsed * 0.022, 0.72, 2.0) * rand(0.75, 1.25);
  }
  G.pkgTimer -= dt;
  if (G.pkgTimer <= 0) { spawnPkg(); G.pkgTimer = 1.2; }

  /* --- машины --- */
  for (let i = G.cars.length - 1; i >= 0; i--) {
    const c = G.cars[i];
    c.y += c.dir * c.speed * dt;
    if (c.y < -L.carLen * 2.4 || c.y > H + L.carLen * 2.4) { G.cars.splice(i, 1); continue; }
    if (v.invuln <= 0 && carHitsVan(c, v)) crash(c);
  }

  /* --- посылки --- */
  for (let i = G.pkgs.length - 1; i >= 0; i--) {
    const p = G.pkgs[i];
    p.t += dt; p.born = Math.min(1, p.born + dt * 3);
    if (Math.hypot(p.x - v.x, p.y - v.y) < L.vanLen * 0.55 + p.r * 0.7) {
      if (v.carry < CFG.capacity) {
        v.carry++;
        G.score += CFG.pickupScore;
        burst(p.x, p.y, 10, COL.amber, 1, 200);
        pop(p.x, p.y - p.r * 1.4, '+' + CFG.pickupScore, COL.amber);
        sfx(v.carry >= CFG.capacity ? 'full' : 'pickup');
        G.pkgs.splice(i, 1);
        syncHud();
      }
    }
  }

  /* --- доставка --- */
  if (v.carry > 0 && G.target) {
    const d = G.target.door;
    const cx = clamp(v.x, d.x, d.x + d.w), cy = clamp(v.y, d.y, d.y + d.h);
    if (Math.hypot(v.x - cx, v.y - cy) < L.vanWid * 0.6) deliver();
  }

  /* --- таймер --- */
  G.time -= dt;
  if (G.time <= 0) { G.time = 0; gameOver(); return; }

  updateFx(dt);
  syncHud();
}

function carHitsVan(c, v) {
  // круг фургона против прямоугольника машины (машины едут строго по полосе)
  const dx = v.x - c.x, dy = v.y - c.y;
  const hw = c.w / 2, hl = c.len / 2;
  const lx = clamp(dx, -hw, hw);
  const ly = clamp(dy, -hl, hl);
  const d = Math.hypot(dx - lx, dy - ly);
  return d < L.vanWid * 0.62;
}

function crash(c) {
  const v = G.van;
  G.time = Math.max(0, G.time - CFG.timePerCrash);
  G.combo = 0;
  v.invuln = 1.6; v.hit = 0.35;
  G.shake = 16 * L.S + 6; G.flash = 1;
  // отбрасываем фургон в сторону от машины
  const nx = v.x - c.x, ny = v.y - c.y;
  const len = Math.hypot(nx, ny) || 1;
  v.vx = (nx / len) * 300 * L.S; v.vy = (ny / len) * 300 * L.S;
  v.x += (nx / len) * 10; v.y += (ny / len) * 10;
  burst(v.x, v.y, 26, COL.neon, 1.3, 330);
  burst(v.x, v.y, 12, COL.amber, 1.1, 240);
  pop(v.x, v.y - L.vanLen * 0.6, '-' + CFG.timePerCrash + ' сек', COL.neon);
  sfx('crash');
  if (G.time <= 0) gameOver();
  syncHud();
}

function deliver() {
  const v = G.van;
  const n = v.carry;
  G.combo++;
  const mult = Math.min(5, 1 + (G.combo - 1) * 0.5);
  const gained = Math.round(n * CFG.scorePerParcel * mult);
  G.score += gained;
  G.deliveries += n;
  G.time += CFG.timePerDelivery;
  v.carry = 0;
  const d = G.target.door;
  burst(d.x + d.w / 2, d.y + d.h / 2, 26, G.target.color, 1.4, 300);
  burst(d.x + d.w / 2, d.y + d.h / 2, 14, COL.white, 1, 200);
  pop(d.x + d.w / 2, d.y + d.h / 2 - 14, '+' + gained + (mult > 1 ? '  x' + mult : ''), G.target.color);
  sfx('deliver');
  pickTarget(G.target);
  syncHud();
}

function updateFx(dt) {
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    p.life -= dt;
    if (p.life <= 0) { G.parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.94; p.vy *= 0.94;
  }
  for (let i = G.pops.length - 1; i >= 0; i--) {
    const p = G.pops[i];
    p.life -= dt; p.y -= 34 * dt;
    if (p.life <= 0) G.pops.splice(i, 1);
  }
  for (const d of G.rain) {
    d.y += d.sp * dt; d.x += d.sp * 0.22 * dt;
    if (d.y > H + 20) { d.y = -20; d.x = rand(-40, W); }
    if (d.x > W + 40) d.x = -30;
  }
  G.shake *= Math.exp(-6 * dt);
  if (G.shake < 0.2) G.shake = 0;
  G.flash *= Math.exp(-4 * dt);
  if (G.flash < 0.01) G.flash = 0;
}

function buildRain() {
  G.rain = [];
  const n = Math.round(clamp(W * H / 9000, 60, 190));
  for (let i = 0; i < n; i++) {
    G.rain.push({ x: rand(-40, W), y: rand(-H, H), len: rand(10, 30), sp: rand(420, 760) });
  }
}

/* ============================ HUD ============================ */
function syncHud() {
  $('#score').textContent = G.score;
  $('#best').textContent = G.best;
  const t = Math.ceil(G.time);
  const te = $('#time');
  te.textContent = t;
  te.classList.toggle('low', t <= 10);
  $('#tfill').style.width = clamp(G.time / CFG.startTime, 0, 1) * 100 + '%';
  const slots = document.querySelectorAll('#slots .slot');
  for (let i = 0; i < slots.length; i++) slots[i].classList.toggle('on', i < (G.van ? G.van.carry : 0));
  show('#hint', G.elapsed < 7);
  const cb = $('#combo');
  const mult = Math.min(5, 1 + Math.max(0, G.combo - 1) * 0.5);
  if (G.combo > 1) { cb.textContent = 'доставка ×' + mult; show('#combo', true); }
  else show('#combo', false);
}
function setMuted(m) {
  $('#btnSound').classList.toggle('off', m);
  $('#btnSound').textContent = m ? '♪̶' : '♪';
}

/* ============================ отрисовка ============================ */
const glowCache = {};
function glow(color, size) {
  const key = color + size;
  if (glowCache[key]) return glowCache[key];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, rgba(color, 0.95));
  grd.addColorStop(0.28, rgba(color, 0.42));
  grd.addColorStop(0.62, rgba(color, 0.13));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  glowCache[key] = c;
  return c;
}
function drawGlow(x, y, color, size, alpha) {
  const s = glow(color, 128);
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  ctx.drawImage(s, x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = 1;
}
function roundRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function render() {
  ctx.save();
  if (G.shake > 0) ctx.translate(rand(-G.shake, G.shake), rand(-G.shake, G.shake));
  ctx.fillStyle = '#03040a';
  ctx.fillRect(-40, -40, W + 80, H + 80);

  drawGround();
  drawBuildings();
  drawHouses();
  drawRoute();
  drawPackages();
  drawCars();
  drawVan();
  drawParticles();
  drawRain();
  drawPops();
  drawJoy();
  ctx.restore();

  if (G.flash > 0) {
    ctx.fillStyle = rgba(COL.neon, 0.3 * G.flash);
    ctx.fillRect(0, 0, W, H);
  }
}

function drawGround() {
  const img = IMG.road;
  // тротуары из боковых полос той же картинки
  if (img && img.naturalWidth) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const wl = ART.walkL, wr = ART.walkR;
    const lx = Math.max(0, L.bldRight - L.walkW * 0.15);
    ctx.drawImage(img, wl[0] * iw, 0, (wl[1] - wl[0]) * iw, ih, lx, 0, L.streetX0 - lx + 1, H);
    const rx = L.streetX1;
    const rw = Math.min(W - rx, L.walkW * 1.15);
    if (rw > 0) ctx.drawImage(img, wr[0] * iw, 0, (wr[1] - wr[0]) * iw, ih, rx, 0, rw, H);
  } else {
    ctx.fillStyle = COL.walk;
    ctx.fillRect(0, 0, L.bldRight, H);
    ctx.fillRect(L.bldLeft, 0, W - L.bldLeft, H);
  }
  ctx.fillStyle = 'rgba(4,6,16,0.45)';
  ctx.fillRect(0, 0, W, H);

  // проезжая часть — центральная полоса сгенерированной улицы
  const img2 = IMG.road;
  if (img2 && img2.naturalWidth) {
    const iw = img2.naturalWidth, ih = img2.naturalHeight, st = ART.street;
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.streetX0, 0, L.streetW, H);
    ctx.clip();
    ctx.drawImage(img2, st[0] * iw, 0, (st[1] - st[0]) * iw, ih, L.streetX0, 0, L.streetW, H);
    ctx.fillStyle = 'rgba(6,8,22,0.30)';
    ctx.fillRect(L.streetX0, 0, L.streetW, H);
    ctx.restore();
  } else {
    ctx.fillStyle = COL.road;
    ctx.fillRect(L.streetX0, 0, L.streetW, H);
  }

  // разметка: центр + края
  ctx.save();
  ctx.strokeStyle = 'rgba(230,240,255,0.20)';
  ctx.lineWidth = Math.max(2, 3 * L.S);
  ctx.setLineDash([Math.max(14, 34 * L.S), Math.max(14, 34 * L.S)]);
  ctx.lineDashOffset = -(G.elapsed * 40) % 1000;
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.restore();

  // неоновые бордюры
  for (const [x, col] of [[L.streetX0, COL.cyan], [L.streetX1, COL.neon]]) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(col, 0.14);
    ctx.fillRect(x - 10, 0, 20, H);
    ctx.fillStyle = rgba(col, 0.5);
    ctx.fillRect(x - 1.5, 0, 3, H);
    ctx.restore();
  }
}

function drawBuildings() {
  // тёмные массивы домов по краям
  ctx.fillStyle = COL.bld;
  ctx.fillRect(0, 0, Math.max(0, L.bldRight), H);
  ctx.fillRect(L.bldLeft, 0, Math.max(0, W - L.bldLeft), H);
  // сетка окон
  const gw = Math.max(10, L.S * 26), gh = Math.max(12, L.S * 30);
  const t = G.elapsed;
  for (let side = 0; side < 2; side++) {
    const x0 = side === 0 ? 0 : L.bldLeft;
    const x1 = side === 0 ? L.bldRight : W;
    for (let y = 8; y < H - 8; y += gh) {
      for (let x = x0 + 6; x + gw < x1; x += gw) {
        const s = Math.sin((x * 12.9898 + y * 78.233) * 0.017) * 43758.5453;
        const r = s - Math.floor(s);
        if (r < 0.42) continue;
        const col = r < 0.62 ? COL.cyan : (r < 0.78 ? COL.neon : COL.amber);
        const flick = 0.5 + 0.5 * Math.sin(t * 1.5 + r * 30);
        ctx.fillStyle = rgba(col, 0.07 + 0.16 * flick * (0.4 + r * 0.6));
        ctx.fillRect(x, y, gw * 0.62, gh * 0.5);
      }
    }
  }
  // неоновая кромка домов
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rgba(COL.violet, 0.18);
  ctx.fillRect(L.bldRight - 8, 0, 16, H);
  ctx.fillRect(L.bldLeft - 8, 0, 16, H);
  ctx.restore();
}

function drawHouses() {
  const t = G.elapsed;
  for (const h of G.houses) {
    const isT = h === G.target;
    const b = h.body;
    const r = Math.max(5, 10 * L.S);

    // корпус: тёмный, с чуть более светлой крышей кверху
    const g1 = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    g1.addColorStop(0, isT ? '#1b2249' : '#12162e');
    g1.addColorStop(0.55, isT ? '#0d1229' : '#0a0d1f');
    g1.addColorStop(1, '#05070f');
    ctx.fillStyle = g1;
    roundRect(b.x, b.y, b.w, b.h, r);
    ctx.fill();

    // окна: сетка, часть горит и мерцает
    const cols = clamp(Math.round(b.w / (30 * L.S)), 2, 4);
    const rowsN = clamp(Math.round(b.h / (38 * L.S)), 3, 8);
    const gx = b.w / (cols + 1), gy = b.h / (rowsN + 1);
    const ww = Math.max(3, Math.min(gx * 0.5, 17 * L.S));
    const wh = Math.max(4, Math.min(gy * 0.42, 21 * L.S));
    for (let i = 1; i <= cols; i++) {
      for (let j = 1; j <= rowsN; j++) {
        const seed = (h.idx * 97 + i * 31 + j * 17) % 100;
        const lit = seed > 44;
        const fl = 0.62 + 0.38 * Math.sin(t * 1.6 + seed);
        ctx.fillStyle = lit ? rgba(h.color, 0.1 + 0.24 * fl) : 'rgba(150,180,205,0.05)';
        ctx.fillRect(b.x + gx * i - ww / 2, b.y + gy * j - wh / 2, ww, wh);
      }
    }

    // козырёк крыши по неоновой кромке
    ctx.fillStyle = rgba(h.color, isT ? 0.9 : 0.42);
    ctx.fillRect(b.x + r * 0.5, b.y, b.w - r, Math.max(2, 3 * L.S));

    // неоновая вывеска у входа
    const sw = Math.max(5, 9 * L.S);
    const sx = h.side === 'left' ? b.x + b.w - sw - Math.max(2, 4 * L.S) : b.x + Math.max(2, 4 * L.S);
    const sy = b.y + b.h * 0.14, sh = b.h * 0.26;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(sx + sw / 2, sy + sh / 2, h.color, Math.max(44, b.w * 1.3), isT ? 0.5 : 0.2);
    ctx.restore();
    ctx.fillStyle = rgba(h.color, isT ? 0.95 : 0.5);
    roundRect(sx, sy, sw, sh, sw * 0.45);
    ctx.fill();
    ctx.fillStyle = 'rgba(6,8,18,0.8)';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(sx + sw * 0.28, sy + sh * (0.16 + i * 0.27), sw * 0.44, sh * 0.15);
    }

    // контур дома
    ctx.strokeStyle = rgba(h.color, isT ? 0.8 : 0.26);
    ctx.lineWidth = Math.max(1, (isT ? 2.6 : 1.4) * L.S);
    roundRect(b.x, b.y, b.w, b.h, r);
    ctx.stroke();

    // подъезд: асфальтовая площадка от дороги к двери — тротуар проезжаемый
    const d = h.door;
    const apX = h.side === 'left' ? L.bldRight : L.streetX1;
    const apW = h.side === 'left' ? L.streetX0 - L.bldRight : L.bldLeft - L.streetX1;
    if (apW > 0) {
      const left = h.side === 'left';
      const ay = d.y + d.h * 0.04, ah = d.h * 0.92;
      // светлее у дороги, темнее у стены: видно, что это съезд с дороги к двери
      const ag = ctx.createLinearGradient(apX, 0, apX + apW, 0);
      ag.addColorStop(left ? 1 : 0, 'rgba(74,82,120,0.95)');
      ag.addColorStop(left ? 0 : 1, isT ? rgba(h.color, 0.5) : 'rgba(30,35,60,0.8)');
      ctx.fillStyle = ag;
      ctx.fillRect(apX, ay, apW, ah);
      // шевроны по направлению к двери
      const dir = left ? -1 : 1;
      ctx.save();
      ctx.strokeStyle = rgba(h.color, isT ? 0.85 : 0.45);
      ctx.lineWidth = Math.max(1.5, 2.4 * L.S);
      for (let k = 0; k < 2; k++) {
        const cxk = apX + apW * (0.42 + k * 0.3);
        const s = Math.max(4, 9 * L.S);
        ctx.beginPath();
        ctx.moveTo(cxk - dir * s, ay + ah * 0.5 - s * 0.7);
        ctx.lineTo(cxk + dir * s * 0.5, ay + ah * 0.5);
        ctx.lineTo(cxk - dir * s, ay + ah * 0.5 + s * 0.7);
        ctx.stroke();
      }
      ctx.restore();
      // борта подъезда пунктиром — читается как размеченный въезд
      ctx.save();
      ctx.strokeStyle = rgba(h.color, isT ? 0.85 : 0.5);
      ctx.lineWidth = Math.max(1.2, 2.2 * L.S);
      ctx.setLineDash([Math.max(5, 10 * L.S), Math.max(4, 8 * L.S)]);
      ctx.beginPath();
      ctx.moveTo(apX, ay); ctx.lineTo(apX + apW, ay);
      ctx.moveTo(apX, ay + ah); ctx.lineTo(apX + apW, ay + ah);
      ctx.stroke();
      ctx.restore();
      // спуск бордюра у самой дороги
      ctx.fillStyle = rgba(h.color, isT ? 0.95 : 0.5);
      const cw = Math.max(3, 6 * L.S);
      const cx = left ? L.streetX0 - cw : L.streetX1;
      ctx.fillRect(cx, d.y + d.h * 0.12, cw, d.h * 0.2);
      ctx.fillRect(cx, d.y + d.h * 0.68, cw, d.h * 0.2);
    }
    const lg = ctx.createLinearGradient(
      h.side === 'left' ? d.x : d.x + d.w, 0,
      h.side === 'left' ? d.x + d.w : d.x, 0);
    lg.addColorStop(0, rgba(h.color, isT ? 0.38 : 0.12));
    lg.addColorStop(1, rgba(h.color, 0));
    ctx.fillStyle = lg;
    ctx.fillRect(d.x, d.y, d.w, d.h);

    ctx.fillStyle = rgba(h.color, isT ? 0.22 + 0.14 * Math.sin(t * 6 + h.phase) : 0.08);
    roundRect(d.x, d.y, d.w, d.h, Math.max(4, 8 * L.S));
    ctx.fill();
    ctx.strokeStyle = rgba(h.color, isT ? 0.95 : 0.38);
    ctx.lineWidth = Math.max(1.4, (isT ? 3 : 1.4) * L.S);
    if (isT) {
      ctx.setLineDash([Math.max(6, 12 * L.S), Math.max(5, 9 * L.S)]);
      ctx.lineDashOffset = -(t * 40) % 400;
    }
    roundRect(d.x, d.y, d.w, d.h, Math.max(4, 8 * L.S));
    ctx.stroke();
    ctx.setLineDash([]);

    // порог у самой стены
    ctx.fillStyle = rgba(h.color, isT ? 1 : 0.55);
    const edgeX = h.side === 'left' ? d.x : d.x + d.w;
    ctx.fillRect(edgeX - Math.max(1, 2 * L.S), d.y + d.h * 0.12, Math.max(2, 4 * L.S), d.h * 0.76);

    if (isT) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.55 + 0.45 * Math.sin(t * 5);
      drawGlow(d.x + d.w / 2, d.y + d.h / 2, h.color, L.streetW * 0.8 * (0.85 + 0.15 * pulse), 0.5 * pulse + 0.25);
      ctx.restore();
      const ax = d.x + d.w / 2, ay = d.y - 14 - 6 * Math.sin(t * 4);
      const s = Math.max(9, L.S * 16);
      ctx.fillStyle = rgba(h.color, 0.95);
      ctx.beginPath();
      ctx.moveTo(ax, ay + s * 0.7);
      ctx.lineTo(ax - s * 0.72, ay - s * 0.5);
      ctx.lineTo(ax + s * 0.72, ay - s * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawRoute() {
  const v = G.van;
  if (!G.target || !v || G.state === 'over') return;
  const d = G.target.door;
  const tx = d.x + d.w / 2, ty = d.y + d.h / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(G.target.color, v.carry > 0 ? 0.45 : 0.16);
  ctx.lineWidth = Math.max(2, 3 * L.S);
  ctx.setLineDash([Math.max(8, 16 * L.S), Math.max(10, 22 * L.S)]);
  ctx.lineDashOffset = -(G.elapsed * 60) % 1000;
  ctx.beginPath();
  ctx.moveTo(v.x, v.y);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.restore();
}

function drawPackages() {
  for (const p of G.pkgs) {
    const bob = Math.sin(p.t * 3) * 2 * L.S;
    const r = p.r * (0.6 + 0.4 * p.born);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(p.x, p.y + bob, COL.amber, r * 5.5, 0.4);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = 'rgba(2,3,10,0.45)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + bob + r * 0.75, r * 1.0, r * 0.42, 0, 0, 6.2832);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.rotate(Math.sin(p.t * 1.4) * 0.12);
    ctx.fillStyle = '#c99a3f';
    roundRect(-r * 0.78, -r * 0.78, r * 1.56, r * 1.56, r * 0.22);
    ctx.fill();
    ctx.fillStyle = '#f0c469';
    roundRect(-r * 0.78, -r * 0.78, r * 1.56, r * 0.42, r * 0.18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,235,180,0.9)';
    ctx.lineWidth = Math.max(1, 1.6 * L.S);
    roundRect(-r * 0.78, -r * 0.78, r * 1.56, r * 1.56, r * 0.22);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.5); ctx.lineTo(0, r * 0.78);
    ctx.moveTo(-r * 0.78, 0); ctx.lineTo(r * 0.78, 0);
    ctx.strokeStyle = 'rgba(120,80,20,0.65)';
    ctx.stroke();
    ctx.restore();
  }
}

function drawCars() {
  for (const c of G.cars) {
    const w = c.w, l = c.len;
    const up = c.dir < 0;
    ctx.save();
    ctx.translate(c.x, c.y);
    if (up) ctx.rotate(Math.PI);
    // тень/подсветка
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(0, l * 0.5, '#fff0d0', l * 1.5, 0.35);
    drawGlow(0, -l * 0.5, COL.neon, l * 0.9, 0.3);
    ctx.restore();
    // корпус
    ctx.fillStyle = '#0d1020';
    roundRect(-w / 2, -l / 2, w, l, w * 0.26);
    ctx.fill();
    ctx.fillStyle = '#181d33';
    roundRect(-w / 2 + w * 0.12, -l * 0.22, w * 0.76, l * 0.44, w * 0.2);
    ctx.fill();
    ctx.strokeStyle = rgba(c.hue, 0.5);
    ctx.lineWidth = Math.max(1, 1.6 * L.S);
    roundRect(-w / 2, -l / 2, w, l, w * 0.26);
    ctx.stroke();
    // фары и стопы
    ctx.fillStyle = 'rgba(255,244,214,0.95)';
    ctx.fillRect(-w * 0.42, l * 0.36, w * 0.26, l * 0.07);
    ctx.fillRect(w * 0.16, l * 0.36, w * 0.26, l * 0.07);
    ctx.fillStyle = rgba(COL.neon, 0.95);
    ctx.fillRect(-w * 0.42, -l * 0.43, w * 0.26, l * 0.06);
    ctx.fillRect(w * 0.16, -l * 0.43, w * 0.26, l * 0.06);
    ctx.restore();
  }
}

function drawVan() {
  const v = G.van;
  if (!v) return;
  const blink = v.invuln > 0 && Math.floor(G.elapsed * 14) % 2 === 0;
  ctx.save();
  ctx.translate(v.x, v.y);

  // пятно света под фургоном
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(0, 0, COL.cyan, L.vanLen * 2.1, 0.32);
  ctx.restore();

  ctx.rotate(v.angle);
  // конусы фар
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const cl = L.vanLen * 2.5, cw = L.vanWid * 1.5;
  const grd = ctx.createLinearGradient(L.vanLen * 0.3, 0, cl, 0);
  grd.addColorStop(0, 'rgba(255,240,215,0.34)');
  grd.addColorStop(1, 'rgba(255,240,215,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(L.vanLen * 0.3, -L.vanWid * 0.34);
  ctx.lineTo(cl, -cw);
  ctx.lineTo(cl, cw);
  ctx.lineTo(L.vanLen * 0.3, L.vanWid * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (blink) ctx.globalAlpha = 0.45;
  const img = IMG.van;
  if (img && img.naturalWidth) {
    const w = L.vanLen, h = w * img.naturalHeight / img.naturalWidth;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  } else {
    ctx.fillStyle = '#2a2f45';
    roundRect(-L.vanLen / 2, -L.vanWid / 2, L.vanLen, L.vanWid, L.vanWid * 0.25);
    ctx.fill();
    ctx.fillStyle = rgba(COL.cyan, 0.9);
    ctx.fillRect(-L.vanLen * 0.1, -L.vanWid * 0.5, L.vanLen * 0.14, L.vanWid);
  }
  ctx.globalAlpha = 1;
  // вспышка при ударе
  if (v.hit > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(0, 0, COL.neon, L.vanLen * 1.8, v.hit * 2.2);
    ctx.restore();
  }
  ctx.restore();

  // посылки в кузове — светящиеся точки над фургоном
  for (let i = 0; i < v.carry; i++) {
    const a = v.angle + Math.PI;
    const ox = Math.cos(a) * L.vanLen * 0.22 + Math.cos(a + 1.57) * (i - (v.carry - 1) / 2) * L.vanWid * 0.5;
    const oy = Math.sin(a) * L.vanLen * 0.22 + Math.sin(a + 1.57) * (i - (v.carry - 1) / 2) * L.vanWid * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(v.x + ox, v.y + oy, COL.amber, L.vanWid * 0.9, 0.7);
    ctx.restore();
  }
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of G.parts) {
    const k = clamp(p.life / p.max, 0, 1);
    drawGlow(p.x, p.y, p.color, p.size * 6 * k + 4, 0.75 * k);
  }
  ctx.restore();
}

function drawRain() {
  ctx.save();
  ctx.strokeStyle = 'rgba(165,205,255,0.16)';
  ctx.lineWidth = Math.max(1, 1.3 * L.S);
  ctx.beginPath();
  for (const d of G.rain) {
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x - d.len * 0.22, d.y - d.len);
  }
  ctx.stroke();
  ctx.restore();
}

function drawPops() {
  const fs = Math.max(12, L.S * 22);
  ctx.save();
  ctx.font = '800 ' + fs + 'px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of G.pops) {
    const k = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = k;
    ctx.lineWidth = Math.max(2, fs * 0.18);
    ctx.strokeStyle = 'rgba(3,4,12,0.85)';
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawJoy() {
  if (!joy.on || G.state !== 'playing') return;
  const r = joyRadius();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(COL.cyan, 0.5);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(joy.ox, joy.oy, r, 0, 6.2832); ctx.stroke();
  ctx.fillStyle = rgba(COL.cyan, 0.08);
  ctx.fill();
  const kx = joy.ox + joy.dx * joy.mag * r, ky = joy.oy + joy.dy * joy.mag * r;
  ctx.fillStyle = rgba(COL.neon, 0.55);
  ctx.beginPath(); ctx.arc(kx, ky, r * 0.34, 0, 6.2832); ctx.fill();
  ctx.restore();
}

/* ============================ цикл ============================ */
let last = 0;
function frame(now) {
  if (!last) last = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

/* ============================ запуск ============================ */
function boot() {
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'playing') togglePause(); });

  // разблокируем звук на первом жесте (политика автозапуска в браузерах)
  window.addEventListener('pointerdown', unlockAudio, true);
  window.addEventListener('keydown', unlockAudio, true);
  window.addEventListener('touchstart', unlockAudio, { capture: true, passive: true });

  const click = (sel, fn) => $(sel).addEventListener('click', () => { unlockAudio(); sfx('ui'); fn(); });
  click('#btnPlay', startGame);
  click('#btnAgain', startGame);
  click('#btnResume', () => togglePause());
  click('#btnPause', () => togglePause());
  click('#btnQuit', () => {
    G.state = 'splash';
    show('#pause', false); show('#hud', false); show('#splash', true);
    $('#bestSplash').textContent = G.best; $('#bestSplashDeliv').textContent = G.bestDeliv;
    Audio_.request('menu');
  });
  $('#btnSound').addEventListener('click', () => { unlockAudio(); setMuted(Audio_.toggle()); sfx('ui'); });

  Audio_.init();
  setMuted(false);
  $('#bestSplash').textContent = G.best;
  $('#bestSplashDeliv').textContent = G.bestDeliv;
  buildRain();

  const names = Object.keys(SRC);
  Promise.all(names.map(k => new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => { IMG[k] = i; res(); };
    i.onerror = () => rej(new Error('не загрузилось: ' + SRC[k]));
    i.src = SRC[k];
  }))).then(() => {
    show('#loading', false);
    const auto = /(\?|&)auto/.test(location.search);
    if (auto) { startGame(); return; }
    show('#splash', true);
    G.state = 'splash';
    Audio_.request('menu');
  }).catch(err => {
    $('#loading').innerHTML = '<div class="boot">Не удалось загрузить картинки.<br>' + err.message + '</div>';
    console.error(err);
  });

  requestAnimationFrame(frame);
}

/* отладочный доступ для автотестов */
window.__kurier = G;
window.__kurierCfg = CFG;
window.__kurierL = L;
window.__kurierAssets = IMG;
window.__kurierJoy = joy;
window.__kurierAudio = Audio_;
window.__kurierStart = startGame;

boot();
