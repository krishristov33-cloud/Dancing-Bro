import * as THREE from 'three';

// Procedural toon dancer (placeholder until the rigged GLB hero from docs/style_character.jpg exists).
// Same joint names we will map to the Mixamo skeleton later, so the move layer carries over.

export type Joint = 'hips' | 'spine' | 'chest' | 'head' | 'uaL' | 'faL' | 'uaR' | 'faR' | 'thL' | 'shL' | 'thR' | 'shR' | 'ftL' | 'ftR';
type V3 = [number, number, number];
export interface Pose { j: Partial<Record<Joint, V3>>; root?: { x?: number; y?: number; z?: number; ry?: number } }
export type Channel = 'legs' | 'armL' | 'armR' | 'torso' | 'root' | 'full';

export interface MoveDef {
  name: string;
  channel: Channel;
  beats: number;
  hold?: boolean;
  pose: (p: number, side: number, t: number) => Pose;
}

const JOINTS: Joint[] = ['hips', 'spine', 'chest', 'head', 'uaL', 'faL', 'uaR', 'faR', 'thL', 'shL', 'thR', 'shR', 'ftL', 'ftR'];

// ------------------------------------------------------------------ materials
function gradientMap(): THREE.DataTexture {
  const d = new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
export const GRADIENT = gradientMap();
export const toon = (color: number, emissive = 0) =>
  new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT, emissive, emissiveIntensity: emissive ? 1 : 0 });
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x07060a, side: THREE.BackSide });

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3, outline = 1.07, rot?: V3) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  parent.add(m);
  if (outline) {
    const o = new THREE.Mesh(geo, OUTLINE);
    o.scale.setScalar(outline);
    m.add(o);
  }
  return m;
}
const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 6, 12);

// ------------------------------------------------------------------ easing helpers
const S = (p: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
const hit = (p: number) => (p < 0.12 ? p / 0.12 : Math.max(0, 1 - (p - 0.12) / 0.88) ** 0.5); // pop: snap in, ease out
const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const wrap = (d: number) => d - Math.PI * 2 * Math.round(d / (Math.PI * 2));
const L = (s: number): 'L' | 'R' => (s > 0 ? 'L' : 'R');

// ------------------------------------------------------------------ move library
export const MOVES: Record<string, MoveDef> = {
  W: { name: 'Kick Step', channel: 'legs', beats: 1, pose: (p, s) => {
    const k = S(p), side = L(s), o = L(-s);
    return { j: { [`th${side}`]: [-1.15 * k, 0, 0], [`sh${side}`]: [1.3 * S(p * 1.6) * (1 - p) + 0.2 * k, 0, 0], [`th${o}`]: [0.15 * k, 0, 0],
      [`ua${o}`]: [-0.7 * k, 0, 0], [`ua${side}`]: [0.5 * k, 0, 0], chest: [-0.1 * k, 0, 0] } as Pose['j'] };
  } },
  S: { name: 'Back Step', channel: 'legs', beats: 1, pose: (p, s) => {
    const k = S(p), side = L(s);
    return { j: { [`th${side}`]: [0.55 * k, 0, 0], [`sh${side}`]: [1.4 * k, 0, 0], chest: [0.3 * k, 0, 0], head: [-0.2 * k, 0, 0],
      uaL: [0.6 * k, 0, 0.2 * k], uaR: [0.6 * k, 0, -0.2 * k] } as Pose['j'], root: { z: -0.15 * k } };
  } },
  A: { name: 'Side Slide', channel: 'legs', beats: 1, pose: (p) => {
    const k = S(p);
    return { j: { thR: [0, 0, -0.55 * k], shR: [0.3 * k, 0, 0], thL: [0, 0, 0.15 * k], chest: [0, 0, 0.15 * k], uaR: [0, 0, -1.1 * k], uaL: [0, 0, 0.4 * k] }, root: { x: -0.45 * k } };
  } },
  D: { name: 'Side Slide', channel: 'legs', beats: 1, pose: (p) => {
    const k = S(p);
    return { j: { thL: [0, 0, 0.55 * k], shL: [0.3 * k, 0, 0], thR: [0, 0, -0.15 * k], chest: [0, 0, -0.15 * k], uaL: [0, 0, 1.1 * k], uaR: [0, 0, -0.4 * k] }, root: { x: 0.45 * k } };
  } },
  L: { name: 'Pop Hit', channel: 'armL', beats: 1, pose: (p) => {
    const k = hit(p);
    return { j: { uaL: [-0.2 * k, 0, 1.45 * k], faL: [0, 0, 1.6 * k], chest: [0, 0.15 * k, 0], head: [0, 0.35 * k, 0] } };
  } },
  R: { name: 'Arm Wave', channel: 'armR', beats: 1, pose: (p) => {
    const k = S(p);
    return { j: { uaR: [0, 0, -1.55 * k], faR: [0, 0, -0.9 * k * Math.sin(p * Math.PI * 4)], chest: [0, 0, 0.1 * Math.sin(p * Math.PI * 4) * k], head: [0, 0, -0.15 * k] } };
  } },
  M: { name: 'Chest Pop', channel: 'torso', beats: 1, pose: (p) => {
    const k = hit(p);
    return { j: { chest: [-0.35 * k, 0, 0], head: [0.45 * k, 0, 0], uaL: [0, 0, 0.25 * k], uaR: [0, 0, -0.25 * k] } };
  } },
  SU: { name: 'Spin', channel: 'root', beats: 1, pose: (p) => ({ j: { uaL: [0, 0, 1.2 * S(p)], uaR: [0, 0, -1.2 * S(p)] }, root: { ry: Math.PI * 2 * ease(p) } }) },
  SD: { name: 'Body Wave', channel: 'torso', beats: 1, pose: (p) => {
    const w = Math.sin(p * Math.PI * 2), k = S(p);
    return { j: { chest: [0.4 * w * k, 0, 0], spine: [-0.3 * Math.sin(p * Math.PI * 2 - 0.8) * k, 0, 0], head: [-0.3 * Math.sin(p * Math.PI * 2 + 0.8) * k, 0, 0],
      uaL: [-0.5 * k, 0, 0.6 * k], uaR: [-0.5 * k, 0, -0.6 * k] }, root: { y: -0.18 * k } };
  } },
  SP: { name: 'Jump', channel: 'root', beats: 1, pose: (p) => {
    const k = S(p);
    return { j: { thL: [-0.9 * k, 0, 0.1 * k], thR: [-0.9 * k, 0, -0.1 * k], shL: [1.7 * k, 0, 0], shR: [1.7 * k, 0, 0], uaL: [0, 0, 2.4 * k], uaR: [0, 0, -2.4 * k] }, root: { y: 0.75 * k } };
  } },
  C: { name: 'Get Low', channel: 'full', beats: 1, hold: true, pose: (p, _s, t) => {
    const k = Math.min(1, p * 4), b = Math.sin(t * 6) * 0.04;
    return { j: { thL: [-1.25 * k, 0, 0.35 * k], thR: [-1.25 * k, 0, -0.35 * k], shL: [2.0 * k, 0, 0], shR: [2.0 * k, 0, 0], chest: [0.45 * k, 0, 0], head: [-0.4 * k, 0, 0],
      uaL: [-0.9 * k, 0, 0.3 * k], uaR: [-0.9 * k, 0, -0.3 * k], faL: [0, 0, 0.8 * k], faR: [0, 0, -0.8 * k] }, root: { y: (-0.42 + b) * k } };
  } },

  // ---- combo finishers (full body)
  RUNNING_MAN: { name: 'Running Man', channel: 'full', beats: 2, pose: (p) => {
    const c = Math.sin(p * Math.PI * 4), k = S(p);
    return { j: { thL: [-0.9 * Math.max(0, c) * k + 0.4 * Math.max(0, -c) * k, 0, 0], thR: [-0.9 * Math.max(0, -c) * k + 0.4 * Math.max(0, c) * k, 0, 0],
      shL: [1.2 * Math.max(0, c) * k, 0, 0], shR: [1.2 * Math.max(0, -c) * k, 0, 0], uaL: [0.8 * c * k, 0, 0], uaR: [-0.8 * c * k, 0, 0], faL: [-1 * k, 0, 0], faR: [-1 * k, 0, 0] } };
  } },
  SHUFFLE: { name: 'T-Step Shuffle', channel: 'full', beats: 2, pose: (p) => {
    const c = Math.sin(p * Math.PI * 4), k = S(p);
    return { j: { thL: [0, 0.6 * c * k, 0.3 * k], thR: [0, 0.6 * c * k, -0.3 * k], chest: [0, -0.3 * c * k, 0], uaL: [0, 0, 0.5 * k], uaR: [0, 0, -0.5 * k] }, root: { x: 0.35 * c * k } };
  } },
  ROBOT: { name: "Pop 'n' Lock", channel: 'full', beats: 2, pose: (p) => {
    const st = Math.floor(p * 4), k = S(p);
    const poses: Pose['j'][] = [
      { uaL: [-1.5, 0, 0], faL: [-1.4, 0, 0], uaR: [0, 0, -1.5] },
      { uaR: [-1.5, 0, 0], faR: [-1.4, 0, 0], uaL: [0, 0, 1.5], head: [0, 0.6, 0] },
      { uaL: [0, 0, 1.5], faL: [0, 0, 1.5], uaR: [0, 0, -1.5], faR: [0, 0, -1.5] },
      { uaL: [-2.8, 0, 0.2], uaR: [-2.8, 0, -0.2], chest: [-0.3, 0, 0] },
    ];
    const j: Pose['j'] = {};
    for (const [n, v] of Object.entries(poses[Math.min(3, st)])) j[n as Joint] = [v![0] * k, v![1] * k, v![2] * k];
    return { j };
  } },
  KIPUP: { name: 'Back Flip', channel: 'full', beats: 2, pose: (p) => {
    const k = S(p), f = ease(Math.min(1, Math.max(0, (p - 0.15) / 0.7)));
    return { j: { hips: [-Math.PI * 2 * f, 0, 0], thL: [-1.4 * k, 0, 0], thR: [-1.4 * k, 0, 0], shL: [2 * k, 0, 0], shR: [2 * k, 0, 0], uaL: [0, 0, 2.6 * k], uaR: [0, 0, -2.6 * k] }, root: { y: 1.1 * k } };
  } },
  HELICOPTER: { name: 'Helicopter', channel: 'full', beats: 2, pose: (p) => {
    const k = S(p);
    return { j: { thL: [-1.2 * k, 0, 0.3 * k], thR: [-0.2 * k, 0, -1.2 * k], shL: [1.9 * k, 0, 0], chest: [0.4 * k, 0, 0], uaL: [-1.2 * k, 0, 0], uaR: [-1.2 * k, 0, 0] }, root: { y: -0.4 * k, ry: Math.PI * 4 * ease(p) } };
  } },
  HEADBANG: { name: 'Headbanger', channel: 'full', beats: 2, pose: (p) => {
    const c = Math.abs(Math.sin(p * Math.PI * 4)), k = S(p);
    return { j: { head: [0.7 * c * k, 0, 0], chest: [0.35 * c * k, 0, 0], uaL: [-2.6 * k, 0, 0.3], uaR: [-0.3 * k, 0, -0.4 * k], faL: [0, 0, 0.3 * k] }, root: { y: -0.1 * c * k } };
  } },
  FREEZE: { name: 'Air Freeze', channel: 'full', beats: 2, pose: (p) => {
    const k = Math.min(1, p * 5) * Math.min(1, (1 - p) * 5);
    return { j: { hips: [0, 0, 1.35 * k], uaR: [0, 0, -0.2 * k], faR: [0, 0, 0], uaL: [0, 0, 2.6 * k], thL: [-1.5 * k, 0, 0.6 * k], shL: [0.4 * k, 0, 0], thR: [-0.2 * k, 0, -0.9 * k], shR: [1.5 * k, 0, 0] }, root: { y: -0.15 * k, x: -0.4 * k } };
  } },
  TORNADO: { name: 'Tornado 720', channel: 'full', beats: 2, pose: (p) => {
    const k = S(p);
    return { j: { thL: [-1.2 * k, 0, 0], shL: [1.8 * k, 0, 0], thR: [0.3 * k, 0, -0.5 * k], uaL: [0, 0, 1.4 * k], uaR: [0, 0, -1.4 * k] }, root: { y: 0.9 * k, ry: Math.PI * 4 * ease(p) } };
  } },
};

export const COMBOS: { seq: string[]; move: string; bonus: number }[] = [
  { seq: ['W', 'S', 'W', 'S'], move: 'RUNNING_MAN', bonus: 1500 },
  { seq: ['A', 'D', 'A', 'D'], move: 'SHUFFLE', bonus: 1500 },
  { seq: ['L', 'R', 'L', 'R'], move: 'ROBOT', bonus: 1500 },
  { seq: ['M', 'M', 'M', 'M'], move: 'HEADBANG', bonus: 1200 },
  { seq: ['W', 'A', 'S', 'D'], move: 'HELICOPTER', bonus: 2500 },
  { seq: ['C', 'C', 'SP'], move: 'KIPUP', bonus: 3000 },
  { seq: ['SD', 'SD', 'C'], move: 'FREEZE', bonus: 2500 },
  { seq: ['L', 'R', 'SU', 'SP'], move: 'TORNADO', bonus: 4000 },
];

// ------------------------------------------------------------------ the dancer
interface Active { def: MoveDef; start: number; dur: number; side: number; held: boolean; release: number }

export class Dancer {
  root = new THREE.Group();
  private j = {} as Record<Joint, THREE.Group>;
  private rest = {} as Record<Joint, V3>;
  private active = new Map<Channel, Active>();
  private side = 1;
  private cur = {} as Record<Joint, THREE.Euler>;
  private rootCur = { x: 0, y: 0, z: 0, ry: 0 };
  bounce = 0.06; // grows with hype (Style DNA hook)
  upBounce = false; // house/techno style

  constructor() {
    const G = (name: Joint, parent: THREE.Object3D, pos: V3, rest: V3 = [0, 0, 0]) => {
      const g = new THREE.Group();
      g.position.set(...pos);
      parent.add(g);
      this.j[name] = g;
      this.rest[name] = rest;
      this.cur[name] = new THREE.Euler(...rest);
      return g;
    };
    const ORANGE = toon(0xf06a1d), BLACK = toon(0x1d1b20), OLIVE = toon(0x5d6234), SKIN = toon(0xc98a64), WHITE = toon(0xe9f1f2),
      CYAN = toon(0x2ff5e6, 0x1bd6c8), GOLD = toon(0xf2b632, 0x6a4a00), HAT = toon(0x2a2622), GLOVE = toon(0x242128);

    const hips = G('hips', this.root, [0, 0.98, 0]);
    part(hips, cap(0.2, 0.08), OLIVE, [0, 0, 0]).scale.set(1.25, 1, 0.85);
    const spine = G('spine', hips, [0, 0.08, 0]);
    part(spine, cap(0.2, 0.12), BLACK, [0, 0.12, 0]).scale.set(1.25, 1, 0.85); // hoodie lower (black)
    const chest = G('chest', spine, [0, 0.24, 0]);
    part(chest, cap(0.23, 0.12), ORANGE, [0, 0.12, 0]).scale.set(1.25, 1, 0.82); // hoodie upper (orange)
    part(chest, new THREE.TorusGeometry(0.15, 0.06, 8, 16), ORANGE, [0, 0.3, -0.08], 1.1, [Math.PI / 2.4, 0, 0]); // hood
    part(chest, new THREE.TorusGeometry(0.09, 0.012, 6, 20, Math.PI), GOLD, [0, 0.27, 0.17], 0, [Math.PI * 1.05, 0, 0]); // chain
    for (const x of [-0.05, 0.05]) part(chest, cap(0.01, 0.12), WHITE, [x, 0.17, 0.2], 0); // drawstrings
    const head = G('head', chest, [0, 0.36, 0]);
    part(head, new THREE.SphereGeometry(0.18, 20, 16), SKIN, [0, 0.16, 0.01]).scale.set(0.95, 1.05, 1);
    for (const x of [-0.065, 0.065]) part(head, new THREE.SphereGeometry(0.028, 8, 8), BLACK, [x, 0.16, 0.165], 0);
    part(head, new THREE.CylinderGeometry(0.17, 0.2, 0.15, 20), HAT, [0, 0.29, 0]); // bucket hat crown
    part(head, new THREE.CylinderGeometry(0.29, 0.31, 0.03, 24), HAT, [0, 0.22, 0.01], 1.04, [0.08, 0, 0]); // brim

    for (const s of [1, -1]) {
      const side = s > 0 ? 'L' : 'R';
      const sh = new THREE.Group();
      sh.position.set(0.31 * s, 0.22, 0);
      chest.add(sh);
      const ua = G(`ua${side}` as Joint, sh, [0, 0, 0], [0, 0, 0.12 * s]);
      part(ua, cap(0.085, 0.18), ORANGE, [0, -0.15, 0]);
      const fa = G(`fa${side}` as Joint, ua, [0, -0.32, 0], [-0.2, 0, 0]);
      part(fa, cap(0.075, 0.14), ORANGE, [0, -0.11, 0]);
      part(fa, new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), CYAN, [0, -0.25, 0], 0); // sweatband
      part(fa, new THREE.SphereGeometry(0.075, 10, 8), GLOVE, [0, -0.32, 0.01]).scale.set(1, 1.2, 0.8); // fingerless glove

      const th = G(`th${side}` as Joint, hips, [0.12 * s, -0.04, 0]);
      part(th, cap(0.11, 0.24), OLIVE, [0, -0.2, 0]);
      part(th, new THREE.BoxGeometry(0.06, 0.12, 0.1), OLIVE, [0.11 * s, -0.24, 0.02]); // cargo pocket
      const shn = G(`sh${side}` as Joint, th, [0, -0.42, 0]);
      part(shn, cap(0.1, 0.24), OLIVE, [0, -0.18, 0]);
      const ft = G(`ft${side}` as Joint, shn, [0, -0.42, 0]);
      part(ft, new THREE.BoxGeometry(0.17, 0.14, 0.3), WHITE, [0, -0.02, 0.05]);
      part(ft, new THREE.BoxGeometry(0.175, 0.025, 0.31), CYAN, [0, -0.08, 0.05], 0); // glowing sole
    }
  }

  trigger(code: string, now: number, beatLen: number) {
    const def = MOVES[code] ?? MOVES[code.toUpperCase()];
    if (!def) return;
    if (def.channel === 'legs' || code === 'W' || code === 'S') this.side = -this.side;
    this.active.set(def.channel, { def, start: now, dur: def.beats * beatLen, side: this.side, held: !!def.hold, release: 0 });
  }

  release(code: string, now: number) {
    const def = MOVES[code];
    const a = def && this.active.get(def.channel);
    if (a && a.def === def && a.held) { a.held = false; a.release = now; }
  }

  update(now: number, dt: number, beatPhase: number, barPhase: number) {
    // target = rest + groove + moves
    const tgt = {} as Record<Joint, V3>;
    for (const n of JOINTS) tgt[n] = [...this.rest[n]] as V3;
    const root = { x: 0, y: 0, z: 0, ry: 0 };

    // groove layer: always dancing to the beat
    const down = 0.5 + 0.5 * Math.cos(2 * Math.PI * beatPhase); // 1 on the beat
    const g = this.upBounce ? 1 - down : down;
    root.y -= this.bounce * g;
    tgt.thL[0] -= 0.22 * g; tgt.thR[0] -= 0.22 * g; tgt.shL[0] += 0.42 * g; tgt.shR[0] += 0.42 * g;
    tgt.head[0] += 0.18 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (beatPhase - 0.12)));
    const sway = Math.sin(2 * Math.PI * barPhase * 2);
    tgt.chest[2] += 0.06 * sway; tgt.chest[1] += 0.1 * sway; tgt.hips[2] -= 0.04 * sway;
    tgt.uaL[0] += 0.15 * sway; tgt.uaR[0] -= 0.15 * sway; tgt.faL[0] -= 0.25; tgt.faR[0] -= 0.25;

    // move layer
    const full = this.active.get('full');
    for (const [ch, a] of this.active) {
      let p = (now - a.start) / a.dur;
      let w = 1;
      if (a.held) p = Math.min(p, 0.999);
      else if (a.def.hold) { w = Math.max(0, 1 - (now - a.release) / 0.18); p = Math.min(p, 0.999); if (w <= 0) { this.active.delete(ch); continue; } }
      else if (p >= 1) { this.active.delete(ch); continue; }
      if (full && ch !== 'full') w *= 0.25;
      const pose = a.def.pose(p, a.side, now);
      for (const [n, v] of Object.entries(pose.j)) { const t = tgt[n as Joint]; t[0] += v![0] * w; t[1] += v![1] * w; t[2] += v![2] * w; }
      if (pose.root) { root.x += (pose.root.x ?? 0) * w; root.y += (pose.root.y ?? 0) * w; root.z += (pose.root.z ?? 0) * w; root.ry += (pose.root.ry ?? 0) * w; }
    }

    const a = 1 - Math.exp(-dt * 28);
    for (const n of JOINTS) {
      const e = this.cur[n], t = tgt[n];
      e.x += wrap(t[0] - e.x) * a; e.y += wrap(t[1] - e.y) * a; e.z += wrap(t[2] - e.z) * a;
      this.j[n].rotation.copy(e);
    }
    const r = this.rootCur;
    r.x += (root.x - r.x) * a; r.y += (root.y - r.y) * a; r.z += (root.z - r.z) * a; r.ry += wrap(root.ry - r.ry) * a; // shortest path: no unwinding after spins/flips
    this.root.position.set(r.x, r.y, r.z);
    this.root.rotation.y = r.ry;
  }
}
