import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { AudioEngine, JsrRadio, STATIONS, Track, fileTrack, practiceTrack, radioBase } from './audio';
import { COMBOS, Dancer, MOVES } from './dancer';
import { Club } from './club';

// ------------------------------------------------------------------ renderer / scene / camera
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const club = new Club(scene);
const dancer = new Dancer();
scene.add(dancer.root);

// approach ring (beat cue) + base ring under the dancer
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, toneMapped: false });
const baseRing = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.05, 64), ringMat);
baseRing.rotation.x = -Math.PI / 2; baseRing.position.y = 0.02;
const approachMat = new THREE.MeshBasicMaterial({ color: 0x2ff5e6, transparent: true, opacity: 0.6, toneMapped: false });
const approach = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.03, 64), approachMat);
approach.rotation.x = -Math.PI / 2; approach.position.y = 0.021;
scene.add(baseRing, approach);

const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const camState = { az: 0, azT: 0, el: 0.36, zoom: 4.6, zoomT: 4.6, punch: 0 };
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}
function updateCamera(dt: number) {
  camState.az += (camState.azT - camState.az) * (1 - Math.exp(-dt * 8));
  camState.zoom += (camState.zoomT - camState.zoom) * (1 - Math.exp(-dt * 6));
  camState.punch *= Math.exp(-dt * 5);
  const z = camState.zoom * (1 - camState.punch * 0.12);
  const aspect = innerWidth / innerHeight;
  cam.left = -z * aspect; cam.right = z * aspect; cam.top = z; cam.bottom = -z;
  cam.updateProjectionMatrix();
  const r = 40, target = new THREE.Vector3(0, 1.6, 0);
  cam.position.set(target.x + r * Math.cos(camState.el) * Math.sin(camState.az), target.y + r * Math.sin(camState.el), target.z + r * Math.cos(camState.el) * Math.cos(camState.az));
  cam.lookAt(target);
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, cam));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.55, 0.72);
composer.addPass(bloom);
composer.addPass(new OutputPass());
addEventListener('resize', resize);

// ------------------------------------------------------------------ audio
const engine = new AudioEngine();
const base = radioBase();
const radio = base ? new JsrRadio(engine, base) : null;
let mode: 'none' | 'practice' | 'file' | 'radio' = 'none';
engine.onEnded = () => { if (mode === 'radio') nextRadio(); else if (engine.track) engine.play(engine.track); };

// ------------------------------------------------------------------ HUD
const $ = (id: string) => document.getElementById(id)!;
const hud = {
  title: $('trackTitle'), info: $('trackInfo'), score: $('score'), combo: $('combo'), hype: $('hypeFill'),
  judge: $('judge'), comboName: $('comboName'), status: $('status'), calib: $('calib'), strip: $('strip') as HTMLCanvasElement,
  start: $('start'), station: $('station') as HTMLSelectElement, radioBtn: $('btnRadio') as HTMLButtonElement, history: $('history'),
};
STATIONS.forEach((s) => { const o = document.createElement('option'); o.value = o.textContent = s; hud.station.appendChild(o); });
if (!radio) {
  hud.radioBtn.disabled = true;
  hud.radioBtn.title = 'JSR radio needs a CORS proxy on the live page: add ?proxy=https://your-worker.workers.dev (see proxy/cloudflare-worker.js). Works out of the box with npm run dev.';
  $('radioNote').style.display = 'block';
}

function status(msg: string) { hud.status.textContent = msg; hud.status.style.opacity = msg ? '1' : '0'; }
function showTrack(t: Track) {
  const g = t.grid;
  hud.title.textContent = t.title;
  hud.info.textContent = `${g.bpm.toFixed(1)} BPM · felt ${g.feltBpm.toFixed(0)} · ${g.genre} · beat confidence ${(g.confidence * 100).toFixed(0)}%${g.confidence < 0.12 ? ' (FREESTYLE)' : ''} · ${g.drops.length} drops`;
  dancer.upBounce = g.feltBpm >= 115 && g.feltBpm < 140;
}
function updateCalib() { hud.calib.textContent = `offset ${(engine.calibration * 1000).toFixed(0)} ms  [ / ]  ·  metronome ${engine.metronome ? 'ON' : 'off'} (M)`; }
updateCalib();

let judgeTimer = 0;
function popJudge(text: string, color: string, sub = '') {
  hud.judge.innerHTML = `${text}<small>${sub}</small>`;
  hud.judge.style.color = color;
  hud.judge.classList.remove('pop'); void hud.judge.offsetWidth; hud.judge.classList.add('pop');
  judgeTimer = 0.6;
}
function popCombo(text: string) {
  hud.comboName.textContent = text;
  hud.comboName.classList.remove('pop'); void hud.comboName.offsetWidth; hud.comboName.classList.add('pop');
}

// ------------------------------------------------------------------ game state
const game = { score: 0, streak: 0, best: 0, hype: 0.1, history: [] as { code: string; beat: number }[], recent: [] as string[], flash: null as THREE.Color | null, flashT: 0, nextDrop: 0 };
const JUDGE = [
  { name: 'PERFECT', win: 0.045, pts: 300, hype: 0.045, color: '#2ff5e6' },
  { name: 'GREAT', win: 0.09, pts: 200, hype: 0.025, color: '#9dff5c' },
  { name: 'GOOD', win: 0.14, pts: 100, hype: 0.01, color: '#ffd23f' },
];

/** Returns beat clock info for the current moment. Falls back to a 90 BPM idle clock without music. */
function clock(now: number) {
  const t = engine.track;
  if (!t || !engine.playing) {
    const bl = 60 / 90, b = now / bl;
    return { t: now, beatLen: bl, beatIdx: Math.floor(b), beatPhase: b % 1, barPhase: (b / 4) % 1, live: false };
  }
  const st = engine.time, beats = t.grid.beats;
  let lo = 0, hi = beats.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (beats[m] <= st) lo = m; else hi = m - 1; }
  const i = lo, b0 = beats[i] ?? 0, b1 = beats[i + 1] ?? b0 + 0.5;
  const beatLen = Math.max(0.2, b1 - b0);
  let ph = st < b0 ? 0 : (st - b0) / beatLen;
  ph = Math.min(0.999, ph);
  // groove on felt tempo (DnB: half time)
  const half = t.grid.bpm > 140;
  const fi = half ? Math.floor(i / 2) : i;
  const fph = half ? ((i % 2) + ph) / 2 : ph;
  const bar = (((i - t.grid.downbeatPhase) % 4) + 4) % 4;
  return { t: st, beatLen: half ? beatLen * 2 : beatLen, beatIdx: fi, beatPhase: fph, barPhase: (bar + ph) / 4, live: true, rawIdx: i, rawPhase: ph, rawLen: beatLen };
}

function judgeInput(code: string) {
  const now = performance.now() / 1000;
  const c = clock(now);
  const label = MOVES[code]?.name ?? code;
  dancer.trigger(code, now, c.beatLen * (MOVES[code]?.channel === 'full' ? 1 : 1));
  if (!c.live || !engine.track) { popJudge(label, '#ffffff'); return; }
  if (engine.track.grid.confidence < 0.12) { // freestyle: no timing judgement
    addHype(0.01); game.score += 50; popJudge(label, '#ff3fb4', 'freestyle'); afterHit(code, c.rawIdx ?? 0); return;
  }
  // nearest beat (also 8ths for slow tracks: double-time footwork)
  const beats = engine.track.grid.beats, i = c.rawIdx ?? 0, st = c.t;
  const cands: { time: number; idx: number; off: boolean }[] = [];
  for (const k of [i - 1, i, i + 1]) if (beats[k] !== undefined) cands.push({ time: beats[k], idx: k, off: false });
  if (engine.track.grid.bpm < 110 && beats[i + 1] !== undefined) cands.push({ time: (beats[i] + beats[i + 1]) / 2, idx: i, off: true });
  let best = cands[0], bd = Infinity;
  for (const cd of cands) { const d = Math.abs(st - cd.time); if (d < bd) { bd = d; best = cd; } }
  const delta = st - best.time;
  const j = JUDGE.find((x) => Math.abs(delta) <= x.win * (best.off ? 0.8 : 1));
  if (!j) {
    game.streak = 0; addHype(-0.06); engine.sfx('miss');
    popJudge('MISS', '#ff4d6d', delta < 0 ? 'early' : 'late');
    game.history = [];
    club.crowd.cheer(-0.2, now);
    game.flash = new THREE.Color('#ff2244'); game.flashT = 0.25;
    return;
  }
  game.streak++;
  game.best = Math.max(game.best, game.streak);
  // Style: variety over the last 8 moves
  game.recent.push(code); if (game.recent.length > 8) game.recent.shift();
  const variety = new Set(game.recent).size;
  const style = 0.7 + variety * 0.1;
  const mult = 1 + Math.floor(game.streak / 8) * 0.5;
  // musicality: footwork on kicks
  const f = Math.floor(best.time * engine.track.grid.fps);
  const kick = engine.track.grid.low[f] ?? 0;
  const onKick = ['W', 'A', 'S', 'D', 'SP'].includes(code) && kick > 0.4;
  const pts = Math.round(j.pts * mult * style * (onKick ? 1.25 : 1) * (best.off ? 1.3 : 1));
  game.score += pts;
  addHype(j.hype * (variety > 4 ? 1.3 : variety < 3 ? 0.5 : 1));
  if (j.name === 'PERFECT') engine.sfx('perfect');
  const ms = Math.round(delta * 1000);
  popJudge(j.name, j.color, `${best.off ? 'off-beat · ' : ''}${onKick ? 'on the kick · ' : ''}${ms > 0 ? '+' : ''}${ms} ms`);
  game.flash = new THREE.Color(j.color); game.flashT = 0.15;
  if (game.streak % 16 === 0) club.crowd.cheer(0.5, now);
  afterHit(code, best.idx);
}

function afterHit(code: string, beat: number) {
  const now = performance.now() / 1000;
  game.history.push({ code, beat });
  if (game.history.length > 6) game.history.shift();
  renderHistory();
  for (const cb of COMBOS) {
    const n = cb.seq.length;
    if (game.history.length < n) continue;
    const tail = game.history.slice(-n);
    if (!tail.every((h, k) => h.code === cb.seq[k])) continue;
    if (tail[n - 1].beat - tail[0].beat > n * 2) continue; // must be tight (≤ 2 beats apart on average)
    const c = clock(now);
    dancer.trigger(cb.move, now, c.beatLen);
    const bonus = Math.round(cb.bonus * (1 + game.hype));
    game.score += bonus;
    addHype(0.15);
    popCombo(`${MOVES[cb.move].name}!  +${bonus}`);
    engine.sfx('combo');
    club.crowd.cheer(0.9, now);
    camState.punch = 1;
    game.history = [];
    renderHistory();
    break;
  }
}

function renderHistory() {
  const sym: Record<string, string> = { W: 'W', A: 'A', S: 'S', D: 'D', L: '◐', R: '◑', M: '●', SU: '⤒', SD: '⤓', SP: '␣', C: 'C' };
  hud.history.innerHTML = game.history.map((h) => `<span>${sym[h.code] ?? h.code}</span>`).join('');
}

function addHype(v: number) { game.hype = Math.max(0, Math.min(1, game.hype + v)); }

// ------------------------------------------------------------------ input
const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1) e.preventDefault(); // no autoscroll
  if (e.shiftKey) { dragging = true; lastX = e.clientX; lastY = e.clientY; return; }
  if (!started) return;
  judgeInput(['L', 'M', 'R'][e.button] ?? 'L');
});
addEventListener('mouseup', () => (dragging = false));
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  camState.azT -= (e.clientX - lastX) * 0.008;
  camState.el = Math.max(0.08, Math.min(1.35, camState.el + (e.clientY - lastY) * 0.005));
  lastX = e.clientX; lastY = e.clientY;
});
let lastWheel = 0;
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.shiftKey) { camState.zoomT = Math.max(2.2, Math.min(10, camState.zoomT * (1 + Math.sign(e.deltaY || e.deltaX) * 0.1))); return; }
  const now = performance.now();
  if (!started || now - lastWheel < 110) return;
  lastWheel = now;
  judgeInput(e.deltaY < 0 ? 'SU' : 'SD');
}, { passive: false });

const held = new Set<string>();
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === ' ') e.preventDefault();
  if (e.repeat) return;
  if (k === 'q') { camState.azT += Math.PI / 4; return; }
  if (k === 'e') { camState.azT -= Math.PI / 4; return; }
  if (k === 'm') { engine.metronome = !engine.metronome; updateCalib(); return; }
  if (k === 'b') { hud.strip.style.display = hud.strip.style.display === 'block' ? 'none' : 'block'; return; }
  if (k === '[') { engine.setCalibration(engine.calibration - 0.005); updateCalib(); return; }
  if (k === ']') { engine.setCalibration(engine.calibration + 0.005); updateCalib(); return; }
  if (k === 'n' && mode === 'radio') { nextRadio(); return; }
  if (k === 't' && engine.track) { // manual fix when the detector locked half a beat off
    const b = engine.track.grid.beats;
    engine.track.grid.beats = b.slice(0, -1).map((x, i) => (x + b[i + 1]) / 2);
    popJudge('BEAT SHIFTED ½', '#ffd23f'); return;
  }
  if (!started) return;
  const code = ({ w: 'W', a: 'A', s: 'S', d: 'D', ' ': 'SP', c: 'C' } as Record<string, string>)[k];
  if (code) { held.add(code); judgeInput(code); }
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'c') { held.delete('C'); dancer.release('C', performance.now() / 1000); }
});

// ------------------------------------------------------------------ music sources
let started = false;
async function begin(kind: typeof mode, loader: () => Promise<Track>) {
  try {
    await engine.ctx.resume();
    status('Analysing beat…');
    hud.start.classList.add('hidden');
    started = true;
    const t = await loader();
    mode = kind;
    engine.play(t);
    showTrack(t);
    game.nextDrop = 0;
    status('');
  } catch (err) {
    console.error(err);
    status(`Could not load music: ${(err as Error).message}`);
  }
}
async function nextRadio() {
  if (!radio) return;
  status('Tuning in…');
  try { const t = await radio.next(); engine.play(t); showTrack(t); status(''); }
  catch (err) { status(`Radio error: ${(err as Error).message}`); }
}
$('btnPractice').onclick = () => begin('practice', () => practiceTrack(engine));
hud.radioBtn.onclick = () => { if (radio) { radio.setStation(hud.station.value); begin('radio', () => radio.next()); } };
hud.station.onchange = () => { if (radio && mode === 'radio') { radio.setStation(hud.station.value); nextRadio(); } };
$('btnNext').onclick = () => (mode === 'radio' ? nextRadio() : null);
const fileInput = $('file') as HTMLInputElement;
$('btnFile').onclick = () => fileInput.click();
$('btnLoad').onclick = () => fileInput.click();
fileInput.onchange = () => { const f = fileInput.files?.[0]; if (f) begin('file', () => fileTrack(engine, f)); };
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) begin('file', () => fileTrack(engine, f)); });

// ------------------------------------------------------------------ debug beat strip
function drawStrip() {
  const cv = hud.strip;
  if (cv.style.display !== 'block' || !engine.track) return;
  const ctx = cv.getContext('2d')!, w = (cv.width = cv.clientWidth), h = (cv.height = cv.clientHeight);
  ctx.clearRect(0, 0, w, h);
  const g = engine.track.grid, now = engine.time, span = 4;
  const x = (t: number) => ((t - now + span / 2) / span) * w;
  ctx.strokeStyle = 'rgba(47,245,230,0.8)'; ctx.beginPath();
  for (let px = 0; px < w; px += 2) { const t = now - span / 2 + (px / w) * span; const v = g.env[Math.floor(t * g.fps)] ?? 0; ctx.lineTo(px, h - Math.min(h, v * h * 0.12)); }
  ctx.stroke();
  g.beats.forEach((b, i) => {
    if (b < now - span / 2 || b > now + span / 2) return;
    const down = (i - g.downbeatPhase) % 4 === 0;
    ctx.fillStyle = down ? '#ff3fb4' : '#ffd23f';
    ctx.fillRect(x(b) - 1, 0, down ? 3 : 2, h);
  });
  g.drops.forEach((d) => { if (Math.abs(d - now) < span / 2) { ctx.fillStyle = '#fff'; ctx.fillText('DROP', x(d) + 4, 12); } });
  ctx.fillStyle = '#fff'; ctx.fillRect(w / 2, 0, 1, h);
}

// ------------------------------------------------------------------ loop
let last = performance.now() / 1000;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000, dt = Math.min(0.05, now - last);
  last = now;
  engine.tick();
  const c = clock(now);
  game.hype = Math.max(0, game.hype - dt * 0.025);
  dancer.bounce = 0.05 + game.hype * 0.05;
  dancer.update(now, dt, c.beatPhase, c.barPhase);

  // kick level for speakers
  let kick = 0;
  if (engine.track && c.live) kick = engine.track.grid.low[Math.floor(c.t * engine.track.grid.fps)] ?? 0;

  // approach ring shrinks onto the base ring exactly on each (raw) beat
  const rp = c.live ? (c.rawPhase ?? 0) : c.beatPhase;
  approach.scale.setScalar(1 + (1 - rp) * 1.2);
  approachMat.opacity = 0.15 + rp * 0.7;
  baseRing.scale.setScalar(1 + Math.pow(1 - rp, 6) * 0.15);
  if (game.flashT > 0) { game.flashT -= dt; ringMat.color.copy(game.flash!); } else { ringMat.color.set(0xffffff); game.flash = null; }

  // drop countdown + drop hit
  if (engine.track && c.live) {
    const drops = engine.track.grid.drops;
    while (game.nextDrop < drops.length && drops[game.nextDrop] < c.t - 0.2) game.nextDrop++;
    const nd = drops[game.nextDrop];
    if (nd !== undefined) {
      const beatsTo = (nd - c.t) / (c.rawLen ?? 0.5);
      if (beatsTo > 0 && beatsTo <= 4.05) popCountdown(`DROP IN ${Math.ceil(beatsTo)}`);
      else if (beatsTo <= 0 && beatsTo > -0.3) { popCountdown('DROP!'); camState.punch = 1.2; club.crowd.cheer(0.7 + game.hype, now); game.nextDrop++; }
      else popCountdown('');
    }
  }

  club.update(now, c.beatPhase, c.beatIdx, kick, game.hype, game.flash);
  club.crowd.update(now, dt, c.beatPhase, game.hype);
  updateCamera(dt);

  hud.score.textContent = game.score.toLocaleString();
  hud.combo.textContent = game.streak > 1 ? `${game.streak} streak  ×${(1 + Math.floor(game.streak / 8) * 0.5).toFixed(1)}` : '';
  hud.hype.style.width = `${(game.hype * 100).toFixed(1)}%`;
  if (judgeTimer > 0) { judgeTimer -= dt; if (judgeTimer <= 0) hud.judge.innerHTML = ''; }
  drawStrip();
  composer.render();
}
let cdText = '';
function popCountdown(t: string) { if (t === cdText) return; cdText = t; const el = $('countdown'); el.textContent = t; el.classList.remove('pop'); void el.offsetWidth; if (t) el.classList.add('pop'); }
resize();
frame();

// debug handle for tests / console tinkering
(window as unknown as { __db: unknown }).__db = { engine, game, dancer, camState };
