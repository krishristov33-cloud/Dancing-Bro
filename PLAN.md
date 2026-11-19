# DANCING BRO — Game Plan (v0.1, 2026-11-19)

Three.js rhythm-dance game: dance to endless radio music, land moves on the beat, chain combos,
grow a personal style tree, hype up an underground club crowd.

---

## 0. Findings that shape the plan

| Fact (checked today) | Consequence |
|---|---|
| jetsetradio.live has no stream API. It plays **whole MP3 files**: `radio/stations/<station>/<Artist - Title>.mp3`, track lists in `radio/stations/<station>/~list.js` (≈25 stations: classic, future, garage, turntablism, liquid, lofi, rapid99…). | We can download the **entire track before it plays** and analyse it offline. Much more accurate than live beat detection: a full beat grid, downbeats, drops and sections up front. |
| The MP3s send **no CORS headers**. | Web Audio can't read cross-origin audio without CORS; the analyser just returns silence. → A **same-origin proxy** is required (Vite dev-server proxy locally; a tiny edge function if deployed). |
| JSR.live is a fan site hosting copyrighted music. | Fine for personal/local play. For a public release, the music source must be **pluggable**: radio proxy, local folder / drag & drop, tab-audio capture, or our own tracks. Visual style stays **our own**, not a copy of Jet Set Radio's look. |
| LMB/RMB/MMB/scroll are dance inputs. | **They conflict with mouse orbit.** Orbit moves to a modifier (see §5). |

---

## 1. Tech stack

- **Vite + TypeScript + three.js** (r17x), `postprocessing` (bloom, outline, chromatic pulse, film grain).
- **Web Audio API** for playback and scheduling. Every gameplay clock reads `AudioContext.currentTime − outputLatency − calibrationOffset`.
- **Web Worker** for track analysis (decode → DSP → beat grid), so the render loop never stalls.
- **three-vrm/spring bones or custom verlet** for secondary motion (hoodie strings, chains, dreads).
- **Zustand-style store** for game state. **IndexedDB** for saves: style tree, signature moves, analysed-track cache.
- Assets: **GLB** characters on one shared humanoid skeleton (Mixamo bone names), so every animation works on every future character.

---

## 2. Music & beat engine (the core: works on any song with no beatmap)

### 2.1 Sources (one interface: `MusicSource → AudioBuffer | MediaStream`)
1. **JSR Radio**: fetch station lists, shuffle, prefetch the next track during the current one, crossfade with the JSR "bump" jingles.
2. **Local files**: drag & drop / folder picker.
3. **Tab/system capture** via `getDisplayMedia({audio})` (Spotify web, YouTube…), using live mode (2.3).
4. Later: our own generated DnB / hip-hop loops.

### 2.2 Offline analysis (full track, in a Worker, about 0.5–1.5 s per track)
1. Downmix, resample to 22 kHz, STFT (1024 / hop 256).
2. **Multi-band spectral flux** onset envelopes: *low* (kick, 30–150 Hz), *mid* (snare, 150–2.5 kHz), *high* (hats). Kept separately because gameplay uses them.
3. **Tempo**: autocorrelation plus a comb-filter bank over 60–190 BPM, with a log-Gaussian prior around 120. Returns the top 2 candidates.
4. **Beat tracking**: dynamic programming (Ellis 2007), which gives a beat grid that follows tempo drift and survives breakdowns.
5. **Downbeats / bar phase**: score the 4 phase offsets by kick energy on beat 1+3 vs snare on 2+4. → bar numbers, 4/8/16-bar **phrases**.
6. **Sections**: novelty curve on RMS + spectral centroid → intro / build / **drop** / breakdown labels. A drop is a big low-band energy jump on a phrase boundary.
7. **Confidence score**. A low score (ambient, rubato, the JSR talk bumps) switches on **Freestyle mode**: no timing judgement, just style and crowd.
8. Results cached in IndexedDB by URL hash.

**Tempo-octave rule (important for DnB):** a 172 BPM DnB track is *danced* at 86 (half-time). The engine stores the raw grid and also a **"felt tempo"**: if BPM > 140, the main pulse is half-time and steps may hit 8ths. Genre bands drive move suggestions:
- 70–100: hip-hop / boom-bap
- 100–118: funk / breaks
- 118–135: house / techno
- 135–150: garage / UKG
- 160–180: DnB / jungle

*Option:* compare against essentia.js `RhythmExtractor2013` during development. It's AGPL, so use it as a benchmark only and don't ship it.

### 2.3 Live mode (tab capture / mic)
Real-time onset detection plus a **phase-locked loop** tempo tracker that locks after about 4 bars and shows a "LOCKING…" HUD. Wider timing windows.

### 2.4 Timing judgement
Windows scale slightly with tempo:
- **PERFECT** ±40 ms
- **GREAT** ±80 ms
- **GOOD** ±130 ms
- **MISS**

Inputs can also land on 8ths ("double-time"), which is worth more but harder. A **calibration screen** (tap along to a click) sets the audio/input offset.

**Debug view (milestone 1):** scrolling waveform, beat ticks, downbeats, section colours, live metronome click. This proves the detector by ear before any gameplay is built.

---

## 3. Input grammar & combo system

### 3.1 Inputs (each one is a "note")
| Input | Role |
|---|---|
| **WASD** | Footwork direction: step / slide / kick toward a direction |
| **LMB** | Arm move left-side / "hit" (pop) |
| **RMB** | Arm move right-side / wave |
| **MMB** | Head / torso accent (nod, chest pop, isolation) |
| **Scroll ↑ / ↓** | Body level & spin: rise/roll up, dip/body-wave down; fast flicks = spin |
| **Space** | Jump / air move (lands on next beat) |
| **C** | Duck → floorwork / freezes (hold C = go to floor) |
| **Hold vs tap** | Hold over a beat = sustained move (glide, freeze, wave) |
| **Chords** | Simultaneous inputs = different move (`A + LMB` ≠ `LMB`) |

`contextmenu` and middle-click autoscroll are blocked; pointer lock is optional.

### 3.2 Combos
- Every on-beat input is pushed into a **beat-quantised input buffer**.
- A **trie of move sequences** matches the buffer, fighting-game style:
  `D, D, LMB` → *Running Man → Arm Swing*; `C(hold), Scroll↓, Space` → *Floor sweep → Kip-up*.
- **Levels:** Step (1 beat) → Move (2 beats) → Combo (4 beats) → Routine (8 beats / 2 bars) → **Phrase finish** (lands exactly on a 4- or 8-bar boundary, for a big bonus).
- **Transition rules:** stance graph (STANDING / LOW / FLOOR / AIR). Moves need and produce stances, so combos read physically believable (no headspin from a jump).
- **Variety decay:** spamming the same move drains hype. Musicality rewards variety.

### 3.3 Musicality bonuses (what makes it feel *musical*, not just timed)
- **Kick/snare matching:** steps on kicks, hits/pops on snares. The engine knows which band fired.
- **Drop hit:** a freeze or power move landing on the drop downbeat → slow-mo, camera punch, crowd eruption.
- **Breakdown flow:** during low-energy sections, sustained flow moves (waves, glides) score more than stomps.
- **Silence/stop:** when the music cuts out, a held freeze = "stop on a dime" bonus.
- **Hat-rolls:** fast 16th footwork (shuffle / DnB step) during high-hat-density parts.

### 3.4 Scoring loop
**Timing** × **Combo multiplier** × **Style (variety + musicality)** → **Hype meter**.
Hype drives the crowd, the lights and the XP gained. Misses trigger a stumble/recover animation (which can also be stylised: an "intentional fall" in the tree, a breaking reference).

---

## 4. Animation system (biggest content risk, designed for many moves)

### 4.1 Layers per character
1. **Groove layer (procedural, always on):** hip bounce, head nod, shoulder rock, phase-locked to the beat. Bounce style differs by genre: hip-hop down-bounce, house up-bounce, DnB fast skank. The character is never dead between moves.
2. **Move layer (clips):** the actual steps and tricks.
3. **Additive overlays:** arm styles, attitude (lean, chest out), from the style tree.
4. **IK:** foot planting (stops sliding), look-at the camera/crowd.
5. **Secondary motion:** spring bones on clothes and accessories.

### 4.2 Beat-warping (key trick)
Each clip stores **beat markers** in its metadata (e.g. `hits: [0, 0.5, 1.0]` in beats). At runtime:
`playbackRate = clipBeatLength / currentBeatLength`
and time-warping between markers makes the clip's "hit" frames land exactly on the music's beats at *any* BPM. One clip works at 85 BPM and 174 BPM. Crossfades are quantised to beat boundaries.

### 4.3 Move library target
- **v1:** ≈60 clips
- **v2:** 120+
- Each one also gets a mirror variant for free.

| Family | Examples |
|---|---|
| Hip-hop toprock / grooves | Bounce, Rock, Bop, Kick-step, Indian step, Harlem Shake, Wop, Smurf, Bart Simpson, Running Man, Roger Rabbit |
| Popping / locking / flow | Hits, Waves, Tutting, Robot, Lock & point, Wrist rolls, Gliding/Moonwalk |
| Breaking | 6-step, CC's, Windmill, Flare, Headspin, Baby/Chair/Air freeze, Kip-up, Swipes |
| DnB / jungle | Skank (DnB step), Liquid footwork, Jungle shuffle, Rolling step, Half-time stomp |
| Techno / house | Melbourne Shuffle (T-step, Running man variant), Cutting Shapes, Jacking, Loose legs, Heel-toe |
| Krump / energy | Stomps, Chest pops, Arm swings, Jabs |
| Utility | Idle-groove sets per genre, transitions (stand↔low↔floor), stumble/recover, celebration, taunts |

### 4.4 Sourcing pipeline (in priority order)
1. **Mixamo**: free, hundreds of dance clips (Hip Hop, Breakdance, Shuffle, Flair, Robot…). Covers v1 quickly.
2. **Video-to-mocap** (Rokoko Vision free tier, DeepMotion, Move.ai) from reference dance videos you record yourself, for unique moves (DnB step, cutting shapes) that Mixamo lacks.
3. **Blender cleanup** with NLA: trim to beats, add beat markers, export as one GLB animation pack per family.
4. **Procedural generators** for parametric moves: bounce, head nod, arm waves, tutting angles.

---

## 5. Camera (orthographic + orbit)

- `OrthographicCamera`, pivoting around the dancer at ~35° elevation (isometric-club feel).
- **Orbit:** because every mouse button is a dance input, orbit uses:
  - **Q / E**: snap 45° (smoothed).
  - **Shift + mouse drag**: free orbit.
  - **Shift + scroll**: ortho zoom.
  - **Tab**: auto-cinematic mode (cuts on phrase boundaries: low hero angle on drops, wide shot on crowd eruptions, punch-zoom on freezes).
- Camera shake/punch is driven by the kick band. Slow-mo plus a slight dolly-in on drop-hits.

---

## 6. Character & visual style

### 6.1 Look (to be locked by the Higgsfield reference)
Stylised 3D, chunky proportions (slightly bigger hands, feet and head), toon/cel lighting with a soft gradient ramp, **thick ink outlines**, hand-painted textures, rim-light in neon colour. The setting is an underground club: wet concrete, layered graffiti (throw-ups, wildstyle, wheatpaste posters), sodium + neon light (magenta/cyan/acid-yellow), haze shafts, speaker stacks. **Original** design language, not a copy of any existing game.

### 6.2 Dancer pipeline
1. Higgsfield concept: front / 3-quarter / back turnaround.
2. Image-to-3D (Tripo / Meshy / Rodin), or a hand-modelled base in Blender.
3. Retopo & rig: Mixamo auto-rig or Rigify with Mixamo names.
4. **Toon material:** custom `ShaderMaterial` with ramp + rim + inverted-hull outline.
5. **Cosmetic slots** for later: head, top, bottom, shoes, accessory.

**Placeholder:** use a Mixamo character from day 1 so gameplay isn't blocked on art.

### 6.3 Multiple characters (later)
Same skeleton. Each character has a **home style bias** (e.g. a breaker vs a DnB stepper vs a popper), a unique groove layer, a signature move, and their own style tree start node.

---

## 7. Style Tree (character growth → unique moves)

**XP** comes from hype earned. The **style points** you earn go into a tree with 5 branches.

| Branch | Theme | Unlocks |
|---|---|---|
| **FOOTWORK** | DnB / jungle / shuffle | 8th-note steps, slides, the "Rolling step" chain |
| **FLOW** | popping / waving / tutting | sustained moves, hold-bonuses, glides |
| **POWER** | breaking | floor entry, power moves, freezes, drop-hit multipliers |
| **SWAGGER** | hip-hop groove / attitude | groove-layer upgrades, taunts, crowd-hype boosts |
| **SHAPES** | techno / house | cutting shapes, jacking, double-time arms |

Three mechanics make it *really* unique per player:
1. **Mutation nodes:** variants of base moves, e.g. *Running Man → "Ghost Running Man"* (half-time, low, leaning back).
2. **Style DNA (passive drift):** the game tracks what you actually do and slowly shifts procedural parameters: bounce depth, arm height, swing/laid-back timing (+5–20 ms), lean, mirroring preference. Two players with the same unlocks still dance differently.
3. **Signature moves:** after landing a strong 1–2 bar routine, you can **save it as a named signature**. Afterwards it's triggered by a short chord, and it appears in your crowd's "chant" and on the walls as your tag.

---

## 8. Crowd

- **20–60 NPCs** on the sides and back in a loose cypher arc. Low-poly toon variants (body, colour and accessory randomised).
- **Performance:** `InstancedMesh` + **vertex animation textures (VAT)** baked from a few clips, or 3–4 shared skinned meshes with LOD. They must stay cheap.
- **States:**
  - **Watch/idle:** weight shift, head-nod *to the beat*, sip drink, chat.
  - **Hype:** fist pump, jump, "ayy" hands, phone filming (screen light).
  - **Eruption:** jumping, hands up, pushing in closer.
  - **"Ooh":** on a big fail, hands on head.
- **Reaction model:** each NPC has a "taste" (prefers power/footwork/flow) plus a random delay, so reactions **ripple** through the crowd instead of syncing like robots. Big hype raises the volume of crowd SFX (cheers, whistles, air-horns on the drop).
- **Later:** an NPC steps into the cypher for a **battle**, trading 8 bars with you.

---

## 9. Club environment (reactive to the music)

- Speaker stacks pump with the kick (scale + cone displacement); strobes on snares in drops; floor tiles/LED strips follow the beat-grid phase; haze shafts sweep on phrase changes.
- **Graffiti walls that remember:** every landed signature/routine **sprays a tag decal** onto the walls. Over a session, the club fills up with *your* graffiti, which is persistent progression you can see.
- Post FX: bloom on neon, subtle chromatic split on kicks, grain, vignette pulse.

---

## 10. Extra mechanics I suggest

1. **Cypher Battle mode:** an AI rival (using the same move system) answers your 8 bars. The crowd votes with hype.
2. **"Call & Response" prompts:** the engine sees a drop coming 4 bars ahead (from the analysis) and flashes "DROP IN 4…3…2…1" so you can set up a freeze/power move.
3. **Beat ring HUD:** a ring under the dancer's feet pulses with the beat. Incoming inputs show as notches, so there's no note highway and the eyes stay on the dancer.
4. **Freestyle zone on talk bumps:** low-confidence audio → free scoring by style only.
5. **Replay + photo mode:** record inputs (deterministic), replay with a cinematic camera, export a GIF/clip.
6. **Daily station challenge:** a fixed station + seed, with a leaderboard later.
7. **Assist options:** auto-timing assist, visual metronome, wider windows, colour-blind-safe HUD.
8. **Crew system (later):** unlocked characters dance as backup during high-hype phrases.

---

## 11. Code architecture

```
src/
  main.ts
  core/        Game loop, Clock (audio-locked), EventBus, Store, Save (IndexedDB)
  audio/       sources/ (JsrRadio, LocalFile, TabCapture), Player, Analyzer.worker.ts,
               BeatGrid, LiveTracker (PLL), Calibration
  input/       InputManager (mouse/keys/wheel), BeatQuantizer, ComboTrie, Chords
  dance/       MoveDB (json), StanceGraph, Judge, Scoring, Hype, StyleTree, StyleDNA, Signatures
  anim/        CharacterRig, GrooveLayer (procedural), MoveLayer (beat-warp), Additive, FootIK, SpringBones
  world/       Club scene, Lights (beat-reactive), GraffitiDecals, Speakers
  crowd/       CrowdSystem (instanced/VAT), CrowdBrain (taste, ripple)
  camera/      OrthoOrbit, CinematicDirector
  ui/          HUD (beat ring, combo text, hype), Menus, StyleTreeView, DebugBeatView
  render/      ToonMaterial, Outline, PostFX
public/assets/ characters/*.glb, anims/*.glb, textures/, sfx/
vite.config.ts  → proxy '/jsr' → https://jetsetradio.live
```

---

## 12. Milestones

| # | Milestone | Done when |
|---|---|---|
| **M0** | Scaffold: Vite+TS+three, JSR proxy, radio player (station picker, next track, prefetch) | Music plays in the game page and Web Audio reads non-zero samples |
| **M1** | **Beat engine + debug view** | The metronome click sits on the beat for 10 varied JSR tracks (hip-hop, DnB, garage, lo-fi); drops get flagged |
| **M2** | Placeholder dancer (Mixamo), groove layer, 12 moves, beat-warp, input→move, timing judge, calibration | Dancing on beat feels good with basic moves |
| **M3** | Combo trie, stance graph, scoring, hype, beat-ring HUD | 4- and 8-beat combos chain; musicality bonuses work |
| **M4** | Visual style pass: club scene, toon + outline shader, beat-reactive lights, post-FX, ortho orbit camera | Matches the reference image's mood |
| **M5** | Crowd: idle/watch/hype/eruption, ripple reactions | The crowd visibly reacts to big moves only |
| **M6** | Style tree + Style DNA + signature moves + saves; move library → 60 | Two play-styles produce visibly different dancers |
| **M7** | Final hero character model, rigged, spring bones | Replaces the placeholder |
| **M8** | Cinematic director, graffiti tags, drop countdown, battle mode, 2nd character | |

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| CORS / JSR availability | Proxy, analysis cache, local-file and tab-capture fallbacks |
| Beat detection on swung/broken beats | DP tracker + confidence gate → freestyle mode; M1 is a dedicated validation milestone |
| Animation volume | Mixamo first, beat-warp reuse, mirroring, procedural layers, mocap-from-video for gaps |
| Input/audio latency | Calibration, judging on the audio clock, not `performance.now` frame time |
| Mouse-button conflicts | Block the context menu and autoscroll; orbit on Shift/Q/E |
| Crowd performance | VAT + instancing, LOD, cap the number of animated NPCs |
