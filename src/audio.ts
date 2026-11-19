import { analyze, BeatGrid, makePracticeBeat } from './analysis';

export interface Track {
  title: string;
  buffer: AudioBuffer;
  grid: BeatGrid;
}

export const STATIONS = [
  'classic', 'future', 'garage', 'turntablism', 'liquid', 'ultraremixes', 'rapid99', 'ggs',
  'poisonjam', 'noisetanks', 'loveshockers', 'immortals', 'doomriders', 'goldenrhinos', 'lofi', 'retroremix',
];

/** Where JSR files come from. Dev: Vite proxy. Live: a CORS proxy given via ?proxy=... (see proxy/cloudflare-worker.js). */
export function radioBase(): string | null {
  const q = new URLSearchParams(location.search).get('proxy');
  if (q) { try { localStorage.setItem('jsrProxy', q); } catch { /* ignore */ } return q.replace(/\/$/, ''); }
  let saved: string | null = null;
  try { saved = localStorage.getItem('jsrProxy'); } catch { /* ignore */ }
  if (saved) return saved.replace(/\/$/, '');
  return import.meta.env.DEV ? '/jsr' : null;
}

export class AudioEngine {
  ctx = new AudioContext({ latencyHint: 'interactive' });
  master = this.ctx.createGain();
  private src: AudioBufferSourceNode | null = null;
  startTime = 0;
  track: Track | null = null;
  calibration = 0; // seconds, user offset
  metronome = false;
  private nextClick = 0;
  onEnded: (() => void) | null = null;

  constructor() {
    this.master.connect(this.ctx.destination);
    try { this.calibration = Number(localStorage.getItem('calib') || 0); } catch { /* ignore */ }
  }

  setCalibration(v: number) {
    this.calibration = v;
    try { localStorage.setItem('calib', String(v)); } catch { /* ignore */ }
  }

  /** Song time as heard by the player (output latency + calibration compensated). */
  get time(): number {
    if (!this.track) return 0;
    const lat = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency || this.ctx.baseLatency || 0;
    return this.ctx.currentTime - this.startTime - lat - this.calibration;
  }

  get playing() { return !!this.src; }

  async load(title: string, data: ArrayBuffer | AudioBuffer): Promise<Track> {
    const buffer = data instanceof AudioBuffer ? data : await this.ctx.decodeAudioData(data);
    const grid = await analyze(buffer);
    return { title, buffer, grid };
  }

  play(t: Track) {
    this.stop();
    this.track = t;
    const s = this.ctx.createBufferSource();
    s.buffer = t.buffer;
    s.connect(this.master);
    this.startTime = this.ctx.currentTime + 0.1;
    s.start(this.startTime);
    s.onended = () => { if (this.src === s) { this.src = null; this.onEnded?.(); } };
    this.src = s;
    this.nextClick = 0;
  }

  stop() {
    if (this.src) { const s = this.src; this.src = null; try { s.stop(); } catch { /* ignore */ } }
  }

  /** Schedules metronome clicks on detected beats (verifies the beat detector by ear). */
  tick() {
    if (!this.metronome || !this.track || !this.src) return;
    const beats = this.track.grid.beats;
    const songNow = this.ctx.currentTime - this.startTime;
    while (this.nextClick < beats.length && beats[this.nextClick] < songNow) this.nextClick++;
    while (this.nextClick < beats.length && beats[this.nextClick] < songNow + 0.15) {
      const i = this.nextClick;
      const at = this.startTime + beats[i];
      const down = (i - this.track.grid.downbeatPhase) % 4 === 0;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.value = down ? 1760 : 1100;
      g.gain.setValueAtTime(0.25, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      o.connect(g).connect(this.ctx.destination);
      o.start(at); o.stop(at + 0.06);
      this.nextClick++;
    }
  }

  sfx(kind: 'perfect' | 'combo' | 'miss') {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    if (kind === 'combo') {
      o.type = 'square';
      o.frequency.setValueAtTime(440, t); o.frequency.exponentialRampToValueAtTime(1320, t + 0.25);
      g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    } else if (kind === 'miss') {
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.15);
      g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    } else {
      o.type = 'triangle'; o.frequency.value = 2093;
      g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    }
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + 0.4);
  }
}

// ---------------- Sources ----------------

export async function practiceTrack(engine: AudioEngine): Promise<Track> {
  return engine.load('Practice Beat (built-in, 92 BPM)', await makePracticeBeat(92));
}

export async function fileTrack(engine: AudioEngine, file: File): Promise<Track> {
  return engine.load(file.name.replace(/\.[^.]+$/, ''), await file.arrayBuffer());
}

export class JsrRadio {
  private lists = new Map<string, string[]>();
  station = STATIONS[0];
  private prefetch: Promise<Track> | null = null;

  constructor(private engine: AudioEngine, private base: string) {}

  private async tracks(station: string): Promise<string[]> {
    if (this.lists.has(station)) return this.lists.get(station)!;
    const r = await fetch(`${this.base}/radio/stations/${station}/~list.js`);
    if (!r.ok) throw new Error(`station list ${r.status}`);
    const txt = await r.text();
    const names = [...txt.matchAll(/_tracks'\]\.length\]\s*=\s*"(.*?)";/g)].map((m) => m[1]);
    if (!names.length) throw new Error('empty station');
    this.lists.set(station, names);
    return names;
  }

  private async fetchRandom(): Promise<Track> {
    const names = await this.tracks(this.station);
    const name = names[Math.floor(Math.random() * names.length)];
    const url = `${this.base}/radio/stations/${this.station}/${encodeURIComponent(name)}.mp3`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`track ${r.status}`);
    return this.engine.load(`${name}  ·  JSR/${this.station}`, await r.arrayBuffer());
  }

  setStation(s: string) { this.station = s; this.prefetch = null; }

  async next(): Promise<Track> {
    let t: Track | null = null;
    for (let attempt = 0; attempt < 4 && !t; attempt++) { // some JSR files intermittently fail (CDN 52x): try another track
      try { t = await (attempt === 0 && this.prefetch ? this.prefetch : this.fetchRandom()); }
      catch (e) { if (attempt === 3) throw e; }
    }
    if (!t) throw new Error('radio unavailable');
    this.prefetch = this.fetchRandom();
    this.prefetch.catch(() => { this.prefetch = null; });
    return t;
  }
}
