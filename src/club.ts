import * as THREE from 'three';
import { toon } from './dancer';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const NEON = ['#ff3fb4', '#2ff5e6', '#ffd23f', '#9b5cff', '#ff7a1a', '#5cff6a'];

// ------------------------------------------------------------------ procedural textures
function concrete(ctx: CanvasRenderingContext2D, w: number, h: number, base: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${rand(0.01, 0.05)})`;
    ctx.beginPath();
    ctx.arc(rand(0, w), rand(0, h), rand(1, 14), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  for (let x = 0; x < w; x += w / 6) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
}

function wildstyle(ctx: CanvasRenderingContext2D, word: string, x: number, y: number, size: number) {
  const c1 = pick(NEON), c2 = pick(NEON);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rand(-0.12, 0.08));
  ctx.transform(1, 0, rand(-0.35, 0.1), 1, 0, 0);
  ctx.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  // 3D extrude
  for (let i = 10; i > 0; i--) { ctx.fillStyle = '#0a0812'; ctx.fillText(word, i * 1.4, i * 1.4); }
  ctx.lineWidth = size * 0.16; ctx.strokeStyle = '#0a0812'; ctx.strokeText(word, 0, 0);
  ctx.lineWidth = size * 0.07; ctx.strokeStyle = '#f4f1ea'; ctx.strokeText(word, 0, 0);
  const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillText(word, 0, 0);
  // highlights + drips
  const wpx = ctx.measureText(word).width;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 6; i++) ctx.fillRect(rand(0, wpx), rand(-size * 0.35, -size * 0.2), rand(6, 18), 4);
  ctx.fillStyle = c2;
  for (let i = 0; i < 7; i++) { const dx = rand(0, wpx); const len = rand(15, 70); ctx.fillRect(dx, size * 0.3, 5, len); ctx.beginPath(); ctx.arc(dx + 2.5, size * 0.3 + len, 5, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function graffitiWall(seed: string[], w = 2048, h = 640): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  concrete(ctx, w, h, '#2b2d3d');
  // posters
  for (let i = 0; i < 7; i++) {
    const px = rand(0, w), py = rand(h * 0.15, h * 0.6), pw = rand(70, 120), ph = pw * 1.35;
    ctx.save(); ctx.translate(px, py); ctx.rotate(rand(-0.1, 0.1));
    ctx.fillStyle = '#d9d2c0'; ctx.fillRect(0, 0, pw, ph);
    ctx.fillStyle = '#1a1820'; ctx.fillRect(pw * 0.15, ph * 0.12, pw * 0.7, ph * 0.45);
    ctx.fillStyle = pick(NEON); ctx.fillRect(pw * 0.15, ph * 0.66, pw * 0.7, ph * 0.08);
    ctx.restore();
  }
  // background tags
  ctx.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = pick(['#d8d8e8', '#ff3fb4', '#2ff5e6', '#111', '#ffd23f']);
    ctx.globalAlpha = rand(0.35, 0.8);
    ctx.lineWidth = rand(2, 5);
    ctx.beginPath();
    let x = rand(0, w), y = rand(20, h - 20);
    ctx.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += rand(6, 22); y += rand(-18, 18); ctx.quadraticCurveTo(x - 10, y - rand(-25, 25), x, y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // big pieces
  let x = rand(20, 120);
  for (const word of seed) {
    const size = rand(120, 190);
    wildstyle(ctx, word, x, rand(h * 0.35, h * 0.6), size);
    x += size * word.length * 0.72 + rand(40, 140);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function floorTex(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1024;
  const ctx = cv.getContext('2d')!;
  concrete(ctx, 1024, 1024, '#1e1f2b');
  for (let i = 0; i < 18; i++) { // paint splats
    ctx.fillStyle = pick(NEON); ctx.globalAlpha = rand(0.05, 0.15);
    ctx.beginPath(); ctx.arc(rand(0, 1024), rand(0, 1024), rand(10, 60), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

// ------------------------------------------------------------------ club
export class Club {
  group = new THREE.Group();
  private ringTiles: THREE.Mesh[] = [];
  private cones: THREE.Mesh[] = [];
  private neonLights: { light: THREE.PointLight; base: number }[] = [];
  private beams: THREE.Mesh[] = [];
  spot: THREE.SpotLight;
  crowd: Crowd;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    scene.background = new THREE.Color(0x07060c);
    scene.fog = new THREE.Fog(0x07060c, 26, 60);

    this.group.add(new THREE.HemisphereLight(0x6a6fb0, 0x140c18, 1.1));
    const key = new THREE.DirectionalLight(0xffe2c4, 1.2);
    key.position.set(4, 10, 6);
    this.group.add(key);
    this.spot = new THREE.SpotLight(0xffb8e6, 60, 18, 0.45, 0.6, 1.2);
    this.spot.position.set(0, 9, 1.5);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.target.position.set(0, 0, 0);
    this.group.add(this.spot, this.spot.target);

    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshToonMaterial({ map: floorTex() }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // LED dance ring (as in the key art)
    const segs = 16;
    for (let i = 0; i < segs; i++) {
      const g = new THREE.RingGeometry(2.25, 2.9, 6, 1, (i / segs) * Math.PI * 2 + 0.03, (Math.PI * 2) / segs - 0.06);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: NEON[i % NEON.length], toneMapped: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.012;
      this.group.add(m);
      this.ringTiles.push(m);
    }
    const inner = new THREE.Mesh(new THREE.CircleGeometry(2.25, 48), new THREE.MeshToonMaterial({ color: 0x1b1d33 }));
    inner.rotation.x = -Math.PI / 2; inner.position.y = 0.008; inner.receiveShadow = true;
    this.group.add(inner);

    // walls
    const wallMat = (words: string[]) => new THREE.MeshToonMaterial({ map: graffitiWall(words) });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(26, 8), wallMat(['DANCING', 'BRO', 'CYPHER']));
    back.position.set(0, 4, -10);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(22, 8), wallMat(['HYPE', 'BREAK', 'DNB']));
    left.position.set(-13, 4, 1); left.rotation.y = Math.PI / 2;
    const right = new THREE.Mesh(new THREE.PlaneGeometry(22, 8), wallMat(['FUNK', 'STEP', 'BASS']));
    right.position.set(13, 4, 1); right.rotation.y = -Math.PI / 2;
    this.group.add(back, left, right);

    // ceiling beams
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 0.6), toon(0x15141c));
      b.position.set(0, 7.6, -9 + i * 3);
      this.group.add(b);
    }

    // neon tubes + coloured lights
    const tube = (color: number, pos: THREE.Vector3, rotY: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 10), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      m.rotation.z = Math.PI / 2; m.rotation.y = rotY;
      m.position.copy(pos);
      const l = new THREE.PointLight(color, 25, 14, 1.4);
      l.position.copy(pos).add(new THREE.Vector3(0, -0.3, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY));
      this.group.add(m, l);
      this.neonLights.push({ light: l, base: 25 });
    };
    tube(0xff3fb4, new THREE.Vector3(-7, 6, -9.8), 0);
    tube(0xffd23f, new THREE.Vector3(0, 6.6, -9.8), 0);
    tube(0x2ff5e6, new THREE.Vector3(4.5, 5.6, -9.8), 0);
    tube(0xffd23f, new THREE.Vector3(-12.9, 6, -4), Math.PI / 2);
    tube(0x9b5cff, new THREE.Vector3(12.9, 6, -4), Math.PI / 2);

    // speaker stacks
    for (const sx of [-5.2, 5.2]) {
      for (let k = 0; k < 2; k++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2.2, 1.4), toon(0x18171f));
        box.position.set(sx, 1.1 + k * 2.25, -7.6);
        box.castShadow = true;
        this.group.add(box);
        for (const cy of [-0.45, 0.5]) {
          const cone = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), toon(0x2a2836));
          cone.position.set(sx, box.position.y + cy, -6.89);
          const rim = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 24), toon(0x050507));
          rim.position.copy(cone.position).setZ(-6.885);
          const dust = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), toon(0x0d0c12));
          dust.position.set(0, 0, 0.01);
          cone.add(dust);
          this.group.add(cone, rim);
          this.cones.push(cone);
        }
      }
    }

    // haze light beams
    for (const [x, c] of [[-2.5, 0xff3fb4], [2.5, 0x2ff5e6], [0, 0xfff0d0]] as [number, number][]) {
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(2.4, 7.5, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      beam.position.set(x, 3.75, 0);
      this.group.add(beam);
      this.beams.push(beam);
    }

    this.crowd = new Crowd(this.group);
  }

  update(t: number, beatPhase: number, beatIndex: number, kick: number, hype: number, flash: THREE.Color | null) {
    const pulse = Math.pow(1 - beatPhase, 3);
    this.ringTiles.forEach((m, i) => {
      const mat = m.material as THREE.MeshBasicMaterial;
      const chase = (i + beatIndex * 2) % this.ringTiles.length < 4 ? 1 : 0;
      const base = new THREE.Color(NEON[(i + beatIndex) % NEON.length]);
      if (flash) base.lerp(flash, 0.6);
      mat.color.copy(base).multiplyScalar(0.25 + 0.5 * pulse + 0.9 * chase * (0.4 + hype));
    });
    for (const c of this.cones) c.scale.setScalar(1 + kick * 0.18);
    for (const n of this.neonLights) n.light.intensity = n.base * (0.6 + 0.6 * pulse + hype * 0.6);
    this.beams.forEach((b, i) => {
      b.rotation.z = Math.sin(t * 0.4 + i * 2) * 0.25;
      (b.material as THREE.MeshBasicMaterial).opacity = 0.03 + 0.05 * pulse * (0.5 + hype);
    });
    this.spot.intensity = 50 + 40 * pulse + kick * 40;
  }
}

// ------------------------------------------------------------------ crowd
interface Person { pos: THREE.Vector3; face: number; exc: number; pending: { at: number; amt: number }[]; taste: number; phase: number; scale: number; filming: boolean }

export class Crowd {
  private people: Person[] = [];
  private body: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private arm: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private phone: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();

  constructor(parent: THREE.Object3D, n = 42) {
    const clothes = [0xf06a1d, 0x2b2f6b, 0x7a2b6b, 0x2f6b4f, 0x1d1b20, 0xb8b2a6, 0x9b5cff, 0x3a7bd5, 0xc23b3b, 0xe0c341];
    const skins = [0x8d5a3b, 0xc98a64, 0xe7b08a, 0x5b3a26, 0xf1c9a5, 0xa8714a];
    this.body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.24, 0.5, 4, 10), toon(0xffffff), n);
    this.head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.19, 14, 10), toon(0xffffff), n);
    const armG = new THREE.CapsuleGeometry(0.065, 0.42, 4, 8); armG.translate(0, -0.26, 0);
    this.arm = new THREE.InstancedMesh(armG, toon(0xffffff), n * 2);
    this.legs = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.55, 4, 8), toon(0x24232c), n);
    this.phone = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.18, 0.02), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, toneMapped: false }), n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      // arc behind and to the sides of the dancer; the camera side stays open. Avoid the speaker stacks.
      let pos: THREE.Vector3;
      do {
        const a = rand(-Math.PI - 0.55, 0.55), r = rand(4.6, 7.8);
        pos = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      } while (Math.abs(pos.x) > 3.9 && Math.abs(pos.x) < 6.5 && pos.z < -6.2);
      const clothesC = pick(clothes);
      this.people.push({ pos, face: Math.atan2(-pos.x, -pos.z), exc: 0, pending: [], taste: rand(0.5, 1.5), phase: rand(-0.1, 0.1), scale: rand(0.9, 1.12), filming: Math.random() < 0.18 });
      this.body.setColorAt(i, c.setHex(clothesC));
      this.head.setColorAt(i, c.setHex(pick(skins)));
      this.arm.setColorAt(i * 2, c.setHex(clothesC));
      this.arm.setColorAt(i * 2 + 1, c.setHex(clothesC));
    }
    for (const m of [this.body, this.head, this.arm, this.legs, this.phone]) { m.castShadow = true; parent.add(m); }
  }

  /** amount 0..1; ripples through the crowd with per-person delay and taste. */
  cheer(amount: number, now: number) {
    for (const p of this.people) p.pending.push({ at: now + rand(0, 0.45), amt: amount * p.taste });
  }

  update(now: number, dt: number, beatPhase: number, hype: number) {
    const d = this.dummy;
    const q = new THREE.Quaternion(), qa = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
    this.people.forEach((p, i) => {
      p.pending = p.pending.filter((e) => { if (now >= e.at) { p.exc = Math.min(1.3, p.exc + e.amt); return false; } return true; });
      p.exc = Math.max(hype * 0.35, p.exc - dt * 0.55);
      const e = Math.min(1, p.exc);
      const ph = (beatPhase + p.phase + 1) % 1;
      const nod = 0.5 + 0.5 * Math.cos(2 * Math.PI * ph);
      const jump = e > 0.55 ? Math.abs(Math.sin(Math.PI * ph)) * 0.35 * (e - 0.4) : 0;
      const y = jump - nod * 0.03 * (0.4 + e);
      q.setFromAxisAngle(Y, p.face);
      const s = p.scale;

      d.position.set(p.pos.x, (0.45 + y) * s, p.pos.z); d.quaternion.copy(q); d.scale.setScalar(s); d.updateMatrix();
      this.legs.setMatrixAt(i, d.matrix);
      d.position.set(p.pos.x, (1.15 + y) * s, p.pos.z); d.updateMatrix();
      this.body.setMatrixAt(i, d.matrix);
      const headTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), nod * 0.25);
      d.position.set(p.pos.x, (1.72 + y - nod * 0.02) * s, p.pos.z); d.quaternion.copy(q).multiply(headTilt); d.updateMatrix();
      this.head.setMatrixAt(i, d.matrix);

      for (const side of [1, -1]) {
        const filmingArm = p.filming && side === 1 && e < 0.7;
        const pump = e > 0.3 ? Math.sin(2 * Math.PI * ph) * 0.35 * e : 0;
        const ang = filmingArm ? 1.9 : 0.15 + e * 2.6 + pump;
        const off = new THREE.Vector3(0.3 * side, (1.42 + y) * s, 0).applyQuaternion(q);
        d.position.set(p.pos.x + off.x, off.y, p.pos.z + off.z);
        qa.setFromAxisAngle(Z, ang * side);
        if (filmingArm) qa.multiply(new THREE.Quaternion().setFromAxisAngle(Y, -0.9 * side)).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.0));
        d.quaternion.copy(q).multiply(qa); d.updateMatrix();
        this.arm.setMatrixAt(i * 2 + (side > 0 ? 0 : 1), d.matrix);
        if (side === 1) {
          const ph2 = new THREE.Vector3(0, -0.55, 0.05).applyQuaternion(d.quaternion).add(d.position);
          d.position.copy(ph2); d.scale.setScalar(p.filming && e < 0.7 ? s : 0.0001); d.updateMatrix();
          this.phone.setMatrixAt(i, d.matrix);
          d.scale.setScalar(s);
        }
      }
    });
    for (const m of [this.body, this.head, this.arm, this.legs, this.phone]) m.instanceMatrix.needsUpdate = true;
  }
}
