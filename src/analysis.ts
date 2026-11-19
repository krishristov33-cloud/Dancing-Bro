// Offline beat analysis: works on any song, no beatmap.
// Multi-band onset envelopes -> tempo (autocorrelation + prior) -> beat grid (dynamic programming, Ellis 2007)
// -> downbeat phase (kick on 1, snare on 2/4) -> drop detection (low-band energy jumps on phrase boundaries).

export interface BeatGrid {
  bpm: number;
  feltBpm: number; // what you dance to (DnB 172 -> 86)
  beats: number[]; // seconds
  downbeatPhase: number; // index offset of first downbeat in beats[]
  confidence: number; // 0..1
  fps: number; // envelope frames per second
  env: Float32Array; // combined onset envelope
  low: Float32Array; // kick-band envelope (normalised 0..1-ish)
  drops: number[]; // seconds
  genre: string;
  candidates: { bpm: number; score: number }[]; // debug: top tempo candidates
}

const SR = 22050;
const HOP = 256;

async function bandLogEnergy(buf: AudioBuffer, type: BiquadFilterType | null, freq: number): Promise<Float32Array> {
  const len = Math.ceil(buf.duration * SR);
  const ctx = new OfflineAudioContext(1, len, SR);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  let node: AudioNode = src;
  if (type) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = type === 'bandpass' ? 0.6 : 0.707;
    src.connect(f);
    node = f;
    if (type === 'lowpass') {
      // steeper kick isolation
      const f2 = ctx.createBiquadFilter();
      f2.type = 'lowpass';
      f2.frequency.value = freq;
      f.connect(f2);
      node = f2;
    }
  }
  node.connect(ctx.destination);
  src.start();
  const out = (await ctx.startRendering()).getChannelData(0);
  const n = Math.floor(out.length / HOP);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const o = i * HOP;
    for (let j = 0; j < HOP; j++) {
      const v = out[o + j];
      s += v * v;
    }
    e[i] = Math.log(1e-7 + s / HOP);
  }
  return e;
}

function flux(e: Float32Array, fps: number): Float32Array {
  const n = e.length;
  const d = new Float32Array(n);
  for (let i = 1; i < n; i++) d[i] = Math.max(0, e[i] - e[i - 1]);
  // subtract local mean (~0.4 s) to keep only transients
  const w = Math.round(fps * 0.2);
  const out = new Float32Array(n);
  let acc = 0;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + d[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
    out[i] = Math.max(0, d[i] - (pre[b] - pre[a]) / (b - a));
    acc += out[i] * out[i];
  }
  const std = Math.sqrt(acc / n) || 1;
  for (let i = 0; i < n; i++) out[i] /= std;
  return out;
}

function smooth(x: Float32Array, r: number): Float32Array {
  const n = x.length, out = new Float32Array(n);
  const k: number[] = [];
  let ks = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-0.5 * (i / (r / 2 || 1)) ** 2); k.push(v); ks += v; }
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) { const t = i + j; if (t >= 0 && t < n) s += x[t] * k[j + r]; }
    out[i] = s / ks;
  }
  return out;
}

function estimateTempo(env: Float32Array, fps: number): { lag: number; confidence: number; candidates: { bpm: number; score: number }[] } {
  const n = env.length;
  const minLag = Math.floor((fps * 60) / 200), maxLag = Math.ceil((fps * 60) / 55);
  const ac = new Float32Array(maxLag * 2 + 2);
  for (let lag = minLag; lag <= Math.min(maxLag * 2, n - 1); lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    ac[lag] = s / (n - lag);
  }
  let best = minLag, bestScore = -1;
  const scores = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.8) ** 2);
    const s = (ac[lag] + 0.5 * ac[lag * 2]) * prior;
    scores[lag] = s;
    if (s > bestScore) { bestScore = s; best = lag; }
  }
  // parabolic refinement
  let lag = best;
  if (best > minLag && best < maxLag) {
    const a = scores[best - 1], b = scores[best], c = scores[best + 1];
    const den = a - 2 * b + c;
    if (den !== 0) lag = best + (0.5 * (a - c)) / den;
  }
  // confidence = how much the winning periodicity stands out from the median one
  const vals = Array.from(scores.slice(minLag, maxLag + 1)).sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)] || 1e-9;
  const ratio = bestScore / med;
  const candidates: { bpm: number; score: number }[] = [];
  for (let l = minLag + 1; l < maxLag; l++) if (scores[l] > scores[l - 1] && scores[l] >= scores[l + 1]) candidates.push({ bpm: +((60 * fps) / l).toFixed(1), score: +scores[l].toFixed(3) });
  candidates.sort((a, b) => b.score - a.score);
  return { lag, confidence: Math.max(0, Math.min(1, (ratio - 1.15) / 2.5)), candidates: candidates.slice(0, 6) };
}

function trackBeats(env: Float32Array, period: number): number[] {
  const n = env.length;
  const local = smooth(env, Math.max(1, Math.round(period / 16)));
  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const alpha = 100; // Ellis/librosa 'tightness': strongly prefers a steady tempo
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = -Infinity, bi = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const v = score[p] - alpha * Math.log((t - p) / period) ** 2;
      if (v > best) { best = v; bi = p; }
    }
    if (bi >= 0 && best > 0) { score[t] = local[t] + best; back[t] = bi; }
    else score[t] = local[t];
  }
  let end = n - 1, bs = -Infinity;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t] > bs) { bs = score[t]; end = t; }
  const frames: number[] = [];
  for (let t = end; t >= 0; t = back[t]) frames.push(t);
  frames.reverse();
  return frames;
}

function guessGenre(bpm: number): string {
  if (bpm >= 158) return 'DnB / Jungle';
  if (bpm >= 135) return 'Garage / Breaks';
  if (bpm >= 118) return 'House / Techno';
  if (bpm >= 100) return 'Funk / Breaks';
  return 'Hip-Hop';
}

export async function analyze(buf: AudioBuffer): Promise<BeatGrid> {
  const T0 = performance.now();
  const fps = SR / HOP;
  const [full, lowE, midE, highE] = await Promise.all([
    bandLogEnergy(buf, null, 0),
    bandLogEnergy(buf, 'lowpass', 150),
    bandLogEnergy(buf, 'bandpass', 1200),
    bandLogEnergy(buf, 'highpass', 6000),
  ]);
  const T1 = performance.now();
  const fF = flux(full, fps), lF = flux(lowE, fps), mF = flux(midE, fps), hF = flux(highE, fps);
  const n = fF.length;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) env[i] = 0.6 * fF[i] + 1.0 * lF[i] + 0.8 * mF[i] + 0.3 * hF[i];

  const { lag, confidence, candidates } = estimateTempo(env, fps);
  const frames = trackBeats(env, lag);
  // half-frame offset: onset is in the middle of the hop window
  const beats = frames.map((f) => (f + 0.5) / fps);
  // bpm: least-squares slope of beat time vs index (sub-frame precise; integer frame intervals are not)
  let bpm = (60 * fps) / lag;
  if (beats.length > 8) {
    const m = beats.length, mx = (m - 1) / 2, my = beats.reduce((a, b) => a + b, 0) / m;
    let sxy = 0, sxx = 0;
    beats.forEach((b, i) => { sxy += (i - mx) * (b - my); sxx += (i - mx) ** 2; });
    const slope = sxy / sxx;
    if (slope > 0.2 && slope < 1.5) bpm = 60 / slope;
  }

  // downbeat phase: kick on 1 (and 3), snare on 2 and 4
  const at = (arr: Float32Array, f: number) => { let m = 0; for (let k = -2; k <= 2; k++) m = Math.max(m, arr[f + k] || 0); return m; };
  let bestP = 0, bestS = -Infinity;
  for (let p = 0; p < 4; p++) {
    let s = 0;
    for (let k = 0; k < frames.length; k++) {
      const pos = (((k - p) % 4) + 4) % 4;
      const f = frames[k];
      if (pos === 0) s += 1.0 * at(lF, f);
      else if (pos === 2) s += 0.4 * at(lF, f);
      else s += 0.6 * at(mF, f);
    }
    if (s > bestS) { bestS = s; bestP = p; }
  }

  // kick envelope for visuals, normalised to ~0..1
  const low = new Float32Array(n);
  let mx = 0;
  for (let i = 0; i < n; i++) mx = Math.max(mx, lF[i]);
  for (let i = 0; i < n; i++) low[i] = Math.min(1, lF[i] / (mx * 0.5 || 1));

  // drops: low-band energy per bar jumps vs previous 4 bars, on 4-bar boundaries
  const drops: number[] = [];
  const barE: number[] = [];
  for (let k = bestP; k + 4 < frames.length; k += 4) {
    let s = 0;
    for (let f = frames[k]; f < frames[k + 4]; f++) s += Math.exp(lowE[f]);
    barE.push(s / (frames[k + 4] - frames[k]));
  }
  const sorted = [...barE].sort((a, b) => a - b);
  const hiThresh = sorted[Math.floor(sorted.length * 0.6)] || 0;
  for (let b = 4; b < barE.length; b++) {
    if (b % 4 !== 0) continue;
    const prev = (barE[b - 1] + barE[b - 2] + barE[b - 3] + barE[b - 4]) / 4;
    if (barE[b] > prev * 2.2 && barE[b] >= hiThresh) drops.push(beats[bestP + b * 4]);
  }

  const feltBpm = bpm > 140 ? bpm / 2 : bpm;
  console.info(`[beat] ${buf.duration.toFixed(0)}s track: render ${(T1 - T0).toFixed(0)} ms, dsp ${(performance.now() - T1).toFixed(0)} ms, ${bpm.toFixed(2)} BPM`);
  return { bpm, feltBpm, beats, downbeatPhase: bestP, confidence, fps, env, low, drops, genre: guessGenre(bpm), candidates };
}

/** Built-in practice beat so the game works without any music source.
 *  Renders three short sections (intro / groove / breakdown) and tiles them into a full arrangement. */
export async function makePracticeBeat(bpm = 92): Promise<AudioBuffer> {
  const sr = 44100, spb = 60 / bpm, barLen = 4 * spb;
  const section = async (bars: number, kind: 'intro' | 'main' | 'break'): Promise<Float32Array[]> => {
    const ctx = new OfflineAudioContext(2, Math.round(bars * barLen * sr), sr);
    renderBars(ctx, bars, kind, spb);
    const b = await ctx.startRendering();
    return [b.getChannelData(0), b.getChannelData(1)];
  };
  const [intro, main, brk] = await Promise.all([section(4, 'intro'), section(8, 'main'), section(4, 'break')]);
  const order = [intro, intro, main, main, main, main, brk, brk, main, main, main, main, main, main];
  const total = order.reduce((n, sct) => n + sct[0].length, 0);
  const out = new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate: sr });
  let off = 0;
  for (const sct of order) { out.getChannelData(0).set(sct[0], off); out.getChannelData(1).set(sct[1], off); off += sct[0].length; }
  return out;
}

function renderBars(ctx: OfflineAudioContext, bars: number, kind: 'intro' | 'main' | 'break', spb: number) {
  const sr = ctx.sampleRate;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  const noise = ctx.createBuffer(1, sr, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const kick = (t: number, v = 1) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.5);
  };
  const snare = (t: number, v = 0.9) => {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + 0.25);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.value = 190; og.gain.setValueAtTime(v * 0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(master); o.start(t); o.stop(t + 0.12);
  };
  const hat = (t: number, v: number) => {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + 0.06);
  };
  const bass = (t: number, freq: number, len: number) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = 380;
    g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.01); g.gain.setTargetAtTime(0, t + len * 0.8, 0.04);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + len + 0.2);
  };
  const chord = [55, 55, 65.4, 49];
  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * 4 * spb;
    for (let s = 0; s < 16; s++) {
      const t = t0 + (s * spb) / 4 + (s % 2 === 1 ? spb * 0.06 : 0);
      if (kind !== 'break' && (s === 0 || s === 8 || (s === 10 && bar % 2 === 1))) kick(t, s === 10 ? 0.6 : 1);
      if (kind === 'main' && (s === 4 || s === 12)) snare(t);
      if (s % 2 === 0 || (bar % 4 === 3 && s > 11)) hat(t, s % 4 === 0 ? 0.12 : 0.07);
    }
    if (kind !== 'intro') {
      const root = chord[Math.floor(bar / 2) % 4];
      bass(t0, root, spb * 1.5);
      bass(t0 + spb * 2.5, root * 1.5, spb * 0.5);
      bass(t0 + spb * 3, root, spb * 0.8);
    }
  }
}
