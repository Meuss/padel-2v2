/**
 * The Web Audio graph: per-voice panners → sfx bus, and the crowd bed → crowd bus, both
 * into a compressor and the master (mute) gain. Nothing is created before `unlock()`,
 * which must run on a user gesture (browser autoplay rules). Without Web Audio (tests,
 * old browsers) every method is a no-op.
 */
import type { ContactSurface, ShotKind, Timing } from "@padel/shared";
import {
  buildClaps,
  buildFence,
  buildGlass,
  buildNet,
  buildOoh,
  buildShot,
  buildThud,
  contactVoice,
  shotClickHz,
  shotVoice,
  type Voice,
} from "./voices.js";

/** Sound types, plus bookkeeping: `crowd` level changes, `stolen` voices, `late` events skipped. */
export type SoundType = "shot" | ContactSurface | "cheer" | "ooh" | "crowd" | "stolen" | "late";

/** A rally can trigger several sounds a second; beyond this the oldest voice is cut. */
const MAX_VOICES = 12;
const MASTER_GAIN = 0.85;
/** Crowd bed gain per unit of `crowdLevel`. */
const CROWD_GAIN = 1;
/** Seconds for the bed to settle ~63% of the way to a new crowd level. */
const CROWD_RAMP_S = 0.6;
/** A cheer boosts the bed by up to this factor (at intensity 1). */
const CHEER_BOOST = 3;
const CHEER_RISE_S = 0.3;
/** Time constant of the cheer's decay: ~2 s to die away. */
const CHEER_FALL_TC = 0.55;
const CLAP_GAIN = 0.9;
const OOH_GAIN = 0.32;
/** Cutting a stolen voice this fast avoids a click without letting it linger. */
const STEAL_FADE_S = 0.008;
const NOISE_SECONDS = 2;

interface Graph {
  noise: AudioBuffer;
  sfx: GainNode;
  master: GainNode;
  bedLevel: GainNode;
  cheerBoost: GainNode;
}

interface ActiveVoice extends Voice {
  out: GainNode;
}

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const tabHidden = () => typeof document !== "undefined" && document.hidden;

export class AudioEngine {
  /** Sounds played, by type (dev stats: the shoot tool reads them). */
  readonly stats: Record<SoundType, number> = {
    shot: 0,
    floor: 0,
    glass: 0,
    fence: 0,
    net: 0,
    cheer: 0,
    ooh: 0,
    crowd: 0,
    stolen: 0,
    late: 0,
  };
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private _muted = false;
  private crowdTarget = 0;
  private voices: ActiveVoice[] = [];

  get muted(): boolean {
    return this._muted;
  }

  /** Create/resume the AudioContext. Call from a user gesture (pointerdown, keydown). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = audioContextCtor();
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
        this.graph = this.build(this.ctx);
      } catch {
        this.ctx = null;
        this.graph = null;
        return;
      }
      // A hidden tab goes quiet; nothing queues up meanwhile (voices need a running context).
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) void this.ctx?.suspend().catch(() => {});
        else this.resume();
      });
    }
    this.resume();
  }

  setMuted(m: boolean): void {
    this._muted = m;
    const ctx = this.ctx;
    if (ctx && this.graph) this.graph.master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, ctx.currentTime, 0.03);
  }

  shot(kind: ShotKind, timing: Timing, pan: number): void {
    const p = shotVoice(kind, timing);
    const click = shotClickHz(timing);
    this.play("shot", pan, (ctx, g, out, t) => buildShot(ctx, g.noise, out, t, p, click));
  }

  contact(surface: ContactSurface, speed: number, pan: number): void {
    const p = contactVoice(surface, speed);
    if (!p) return;
    const build =
      surface === "floor" ? buildThud : surface === "glass" ? buildGlass : surface === "fence" ? buildFence : buildNet;
    this.play(surface, pan, (ctx, g, out, t) => build(ctx, g.noise, out, t, p));
  }

  /** Count `n` events not voiced because they arrived too late (see `shouldPlay`). */
  skipLate(n: number): void {
    this.stats.late += n;
  }

  /** Smoothly ramp the ambience bed to `level` (from `crowdLevel`). */
  crowd(level: number): void {
    if (level === this.crowdTarget) return;
    this.crowdTarget = level;
    const ctx = this.ctx;
    if (!ctx || !this.graph) return;
    this.graph.bedLevel.gain.setTargetAtTime(level * CROWD_GAIN, ctx.currentTime, CROWD_RAMP_S);
    this.stats.crowd++;
  }

  /** The bed swells ×(1 + 2·intensity) over 0.3 s and dies away over ~2 s, with applause. */
  cheer(intensity: number): void {
    const ctx = this.live();
    const g = this.graph;
    if (!ctx || !g) return;
    const now = ctx.currentTime;
    const boost = g.cheerBoost.gain;
    boost.cancelScheduledValues(now);
    boost.setValueAtTime(boost.value, now);
    boost.linearRampToValueAtTime(1 + (CHEER_BOOST - 1) * intensity, now + CHEER_RISE_S);
    boost.setTargetAtTime(1, now + CHEER_RISE_S, CHEER_FALL_TC);
    this.play("cheer", 0, (c, _g, out, t) => buildClaps(c, out, t, CLAP_GAIN * intensity));
  }

  /** A short falling crowd "ooh", for near misses. */
  ooh(): void {
    this.play("ooh", 0, (ctx, g, out, t) => buildOoh(ctx, g.noise, out, t, OOH_GAIN));
  }

  /** The context, if sound may play right now. */
  private live(): AudioContext | null {
    const ctx = this.ctx;
    return ctx && ctx.state === "running" && !this._muted && !tabHidden() ? ctx : null;
  }

  private resume(): void {
    const ctx = this.ctx;
    if (ctx && ctx.state !== "running" && !tabHidden()) void ctx.resume().catch(() => {});
  }

  /** Start one voice behind its own gain and panner, stealing the oldest beyond MAX_VOICES. */
  private play(
    type: SoundType,
    pan: number,
    build: (ctx: AudioContext, g: Graph, out: AudioNode, t: number) => Voice,
  ): void {
    const ctx = this.live();
    const g = this.graph;
    if (!ctx || !g) return;
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    while (this.voices.length >= MAX_VOICES) this.steal(this.voices.shift()!, now);

    const out = ctx.createGain();
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      out.connect(panner).connect(g.sfx);
    } else {
      out.connect(g.sfx);
    }
    const voice = build(ctx, g, out, now);
    // Every source of a voice stops by `end`; the first one's end frees the voice's nodes.
    voice.sources[0]!.onended = () => out.disconnect();
    this.voices.push({ ...voice, out });
    this.stats[type]++;
  }

  private steal(v: ActiveVoice, now: number): void {
    const gain = v.out.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + STEAL_FADE_S);
    for (const s of v.sources) {
      try {
        s.stop(now + STEAL_FADE_S + 0.002);
      } catch {
        // already stopped
      }
    }
    this.stats.stolen++;
  }

  private build(ctx: AudioContext): Graph {
    const noise = ctx.createBuffer(1, Math.ceil(NOISE_SECONDS * ctx.sampleRate), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Buses → compressor (keeps a busy rally plus a cheer from clipping) → master (mute).
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 8;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.2;
    const master = ctx.createGain();
    master.gain.value = this._muted ? 0 : MASTER_GAIN;
    compressor.connect(master).connect(ctx.destination);
    const sfx = ctx.createGain();
    sfx.connect(compressor);
    const crowdBus = ctx.createGain();
    crowdBus.connect(compressor);

    // Crowd bed: two decorrelated noise loops spread left/right, shaped pink-ish and
    // band-passed around 700 Hz (a murmur), breathing slowly so it never sounds static.
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 700;
    band.Q.value = 0.8;
    const soften = ctx.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = 2000;
    const bedLevel = ctx.createGain();
    bedLevel.gain.value = this.crowdTarget * CROWD_GAIN;
    const breathe = ctx.createGain();
    const cheerBoost = ctx.createGain();
    band.connect(soften).connect(bedLevel).connect(breathe).connect(cheerBoost).connect(crowdBus);
    for (const side of [-0.6, 0.6]) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      if (typeof ctx.createStereoPanner === "function") {
        const panner = ctx.createStereoPanner();
        panner.pan.value = side;
        src.connect(panner).connect(band);
      } else {
        src.connect(band);
      }
      src.start(0, side < 0 ? 0 : NOISE_SECONDS / 2);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const depth = ctx.createGain();
    depth.gain.value = 0.2;
    lfo.connect(depth).connect(breathe.gain);
    lfo.start();

    return { noise, sfx, master, bedLevel, cheerBoost };
  }
}
