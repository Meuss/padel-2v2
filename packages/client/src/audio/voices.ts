/**
 * Sound design: pure parameter functions (unit tested) and the Web Audio voice builders
 * that turn them into node graphs. Every builder starts at time `t`, routes into `out`
 * and returns the sources it started, all stopped by the returned `end` time.
 */
import type { ContactSurface, MatchEventKind, ShotKind, Timing } from "@padel/shared";
import { isStale } from "../events.js";

/**
 * Synthesis parameters for one sound. `freq` is the voice's characteristic frequency: the
 * tone of a pop or ping, or the filter cutoff/centre of a noise voice. `noise` is the
 * noise share of the mix (0 = pure tone, 1 = pure noise); `q` is the filter's Q.
 */
export interface VoiceParams {
  gain: number;
  freq: number;
  decay: number;
  noise: number;
  q: number;
}

/** Contacts slower than this (m/s) are inaudible: it filters the settling ball's dribble. */
const MIN_AUDIBLE_SPEED = 1.5;
/** Contacts at or above this speed (m/s) are at full loudness and brightness. */
const FULL_SPEED = 20;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 0…1 impact strength from ball speed. */
function impactStrength(speed: number): number {
  return clamp01((speed - MIN_AUDIBLE_SPEED) / (FULL_SPEED - MIN_AUDIBLE_SPEED));
}

/** Synthesis parameters per sound. speed in m/s scales loudness/brightness. Pure. */
export function contactVoice(surface: ContactSurface, speed: number): VoiceParams | null {
  if (!(speed >= MIN_AUDIBLE_SPEED)) return null;
  const s = impactStrength(speed);
  // Loudness rises fast at first, then flattens: a soft bounce is still clearly audible.
  const loud = 0.15 + 0.85 * Math.pow(s, 0.7);
  switch (surface) {
    case "floor": // turf thud: lowpassed noise around 300 Hz with a low knock under it
      return { gain: 0.75 * loud, freq: 300 * (0.8 + 0.5 * s), decay: 0.04, noise: 0.65, q: 0.9 };
    case "glass": // resonant ping around 1.1 kHz over a short noise body
      return { gain: 0.4 * loud, freq: 1080 + 40 * s, decay: 0.35, noise: 0.3, q: 1 };
    case "fence": // metallic rattle: band-passed noise bursts
      return { gain: 0.25 * loud, freq: 2400 + 800 * s, decay: 0.25, noise: 1, q: 4 };
    case "net": // soft lowpassed swish into the mesh
      return { gain: 0.4 * loud, freq: 500 + 400 * s, decay: 0.18, noise: 1, q: 0.7 };
  }
}

const SHOT_BASE: Record<ShotKind, VoiceParams> = {
  drive: { gain: 0.6, freq: 520, decay: 0.06, noise: 0.45, q: 2 },
  serve: { gain: 0.6, freq: 520, decay: 0.06, noise: 0.45, q: 2 },
  lob: { gain: 0.45, freq: 520, decay: 0.06, noise: 0.45, q: 2 },
  // Louder and lower, with a longer tail.
  smash: { gain: 0.9, freq: 380, decay: 0.12, noise: 0.5, q: 2 },
};
/** Early or late contact is off the sweet spot: a duller, quieter pop. */
const OFF_TIMING_GAIN = 0.75;

/** The racket pop for a shot. Pure. */
export function shotVoice(kind: ShotKind, timing: Timing): VoiceParams {
  const base = SHOT_BASE[kind];
  return { ...base, gain: timing === "perfect" ? base.gain : base.gain * OFF_TIMING_GAIN };
}

/** Centre (Hz) of the racket pop's click band: perfect Timing is brighter. Pure. */
export function shotClickHz(timing: Timing): number {
  return timing === "perfect" ? 2400 : 1800;
}

/** Crowd ambience level from rally length (shots in the current rally). Pure. */
export function crowdLevel(rallyShots: number): number {
  const t = clamp01((rallyShots - 2) / 10);
  return 0.15 + 0.45 * t * t * (3 - 2 * t); // smoothstep from 2 to 12 shots
}

/** Sounds firing later than this behind their event are dropped: they would sound off. */
export const SOUND_STALE_MS = 200;

/** Drop stale events (age > 200 ms). Pure. */
export function shouldPlay(eventServerTime: number, nowServerTime: number): boolean {
  return !isStale(eventServerTime, nowServerTime, SOUND_STALE_MS);
}

/** Stereo pan (−0.8…0.8) from an on-screen x position. Pure. */
export function screenPan(x: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(1, Math.max(-1, (x / width) * 2 - 1)) * 0.8;
}

export type CrowdReaction = { kind: "cheer"; intensity: number } | { kind: "ooh" };

/** How the crowd reacts to a match event, from its kind: cheer a point, game or set; "ooh" at a Fault. Pure. */
export function crowdReaction(kind: MatchEventKind | null): CrowdReaction | null {
  switch (kind) {
    case "point":
      return { kind: "cheer", intensity: 0.5 };
    case "game":
    case "set":
      return { kind: "cheer", intensity: 1 };
    case "fault":
      return { kind: "ooh" };
    default:
      return null;
  }
}

// ── Voice builders ───────────────────────────────────────────────────────────

export interface Voice {
  sources: AudioScheduledSourceNode[];
  /** Context time by which every source has stopped. */
  end: number;
}

/** Floor for exponential ramps (they cannot reach 0). */
const SILENT = 0.0001;
/** Filtering white noise down to a narrow band loses most of its energy: make it up. */
const NARROW_NOISE_BOOST = 4;

/** A looping white-noise source started at a random point, so overlapping voices differ. */
function noiseSource(ctx: BaseAudioContext, noise: AudioBuffer, t: number, end: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.start(t, Math.random() * noise.duration);
  src.stop(end);
  return src;
}

/** A gain node that rises to `peak` over `attack` s, then decays exponentially over `decay` s. */
function envelope(ctx: BaseAudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(Math.max(peak, SILENT), t + attack);
  g.gain.exponentialRampToValueAtTime(SILENT, t + attack + decay);
  g.gain.setValueAtTime(0, t + attack + decay);
  return g;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** A sine whose pitch sags slightly as it decays, which reads as an impact rather than a beep. */
function knock(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, peak: number, decay: number, end: number) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.88, t + decay);
  osc.connect(envelope(ctx, t, peak, 0.001, decay)).connect(out);
  osc.start(t);
  osc.stop(end);
  return osc;
}

/** Racket pop: a 6 ms noise click through a bandpass at `clickHz`, plus a decaying tone. */
export function buildShot(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, t: number, p: VoiceParams, clickHz: number): Voice {
  const end = t + p.decay + 0.03;
  const click = noiseSource(ctx, noise, t, end);
  click
    .connect(filter(ctx, "bandpass", clickHz, p.q))
    .connect(envelope(ctx, t, p.gain * p.noise * NARROW_NOISE_BOOST, 0.0005, 0.006))
    .connect(out);
  const tone = knock(ctx, out, t, p.freq, p.gain * (1 - p.noise), p.decay, end);
  return { sources: [click, tone], end };
}

/** Turf bounce: a lowpassed noise thud with a low knock under it. */
export function buildThud(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, t: number, p: VoiceParams): Voice {
  const end = t + p.decay + 0.03;
  const src = noiseSource(ctx, noise, t, end);
  src
    .connect(filter(ctx, "lowpass", p.freq, p.q))
    .connect(envelope(ctx, t, p.gain * p.noise * NARROW_NOISE_BOOST, 0.002, p.decay))
    .connect(out);
  const tone = knock(ctx, out, t, p.freq * 0.45, p.gain * (1 - p.noise), p.decay, end);
  return { sources: [src, tone], end };
}

/** Glass: two detuned sines (a slow beat), a faint plate overtone and a short noise body. */
export function buildGlass(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, t: number, p: VoiceParams): Voice {
  const end = t + p.decay + 0.03;
  const ring = p.gain * (1 - p.noise);
  const sources: AudioScheduledSourceNode[] = [
    knock(ctx, out, t, p.freq * 0.99, ring * 0.5, p.decay, end),
    knock(ctx, out, t, p.freq * 1.013, ring * 0.5, p.decay, end),
    knock(ctx, out, t, p.freq * 2.71, ring * 0.15, p.decay * 0.4, end),
  ];
  const body = noiseSource(ctx, noise, t, end);
  body
    .connect(filter(ctx, "lowpass", 1500, p.q))
    .connect(envelope(ctx, t, p.gain * p.noise * NARROW_NOISE_BOOST * 0.5, 0.001, 0.06))
    .connect(out);
  sources.push(body);
  return { sources, end };
}

/** Fence: a fading train of band-passed noise bursts at irregular intervals, the mesh rattling. */
export function buildFence(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, t: number, p: VoiceParams): Voice {
  const end = t + p.decay + 0.03;
  const src = noiseSource(ctx, noise, t, end);
  const bursts = ctx.createGain();
  bursts.gain.setValueAtTime(0, t);
  const peak = p.gain * p.noise * NARROW_NOISE_BOOST;
  let bt = t;
  while (bt < t + p.decay - 0.015) {
    const amp = peak * Math.pow(1 - (bt - t) / p.decay, 1.5) * (0.6 + 0.4 * Math.random());
    bursts.gain.setValueAtTime(Math.max(amp, SILENT), bt);
    bursts.gain.exponentialRampToValueAtTime(SILENT, bt + 0.012);
    bt += 0.018 + Math.random() * 0.022;
  }
  bursts.gain.setValueAtTime(0, t + p.decay);
  // Two bands a non-harmonic ratio apart sound metallic rather than hissy.
  src.connect(filter(ctx, "bandpass", p.freq, p.q)).connect(bursts);
  src.connect(filter(ctx, "bandpass", p.freq * 1.63, p.q)).connect(bursts);
  bursts.connect(out);
  return { sources: [src], end };
}

/** Net: a soft lowpassed swish with a gentle attack. */
export function buildNet(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, t: number, p: VoiceParams): Voice {
  const end = t + p.decay + 0.03;
  const src = noiseSource(ctx, noise, t, end);
  src
    .connect(filter(ctx, "lowpass", p.freq, p.q))
    .connect(envelope(ctx, t, p.gain * p.noise * NARROW_NOISE_BOOST * 0.5, 0.015, p.decay))
    .connect(out);
  return { sources: [src], end };
}

/** Crowd "ooh": a chorus of detuned saws whose pitch falls, through an "oo" vowel formant. */
export function buildOoh(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, t: number, gain: number): Voice {
  const dur = 1.1;
  const end = t + dur + 0.05;
  const vowel = filter(ctx, "lowpass", 520, 1.2);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.18);
  env.gain.setValueAtTime(gain, t + 0.4);
  env.gain.exponentialRampToValueAtTime(SILENT, t + dur);
  vowel.connect(env).connect(out);
  const sources: AudioScheduledSourceNode[] = [];
  const VOICES = 6;
  for (let i = 0; i < VOICES; i++) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const f0 = 200 * (0.93 + 0.14 * Math.random());
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.72, t + dur);
    const level = ctx.createGain();
    level.gain.value = 0.9 / VOICES;
    osc.connect(level).connect(vowel);
    osc.start(t + Math.random() * 0.06);
    osc.stop(end);
    sources.push(osc);
  }
  // Breath: many people, not one choir.
  const breath = noiseSource(ctx, noise, t, end);
  const breathLevel = ctx.createGain();
  breathLevel.gain.value = 0.6;
  breath.connect(filter(ctx, "bandpass", 380, 1)).connect(breathLevel).connect(vowel);
  sources.push(breath);
  return { sources, end };
}

/** Applause: 20 short noise bursts at random times and stereo positions, rendered to one buffer. */
export function buildClaps(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number): Voice {
  const dur = 2.2;
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(2, Math.ceil(dur * rate), rate);
  const left = buf.getChannelData(0);
  const right = buf.getChannelData(1);
  const CLAPS = 20;
  const clapLen = Math.ceil(0.03 * rate);
  for (let c = 0; c < CLAPS; c++) {
    // Denser at the start, thinning out as the cheer dies down.
    const at = 0.05 + 1.9 * Math.pow(Math.random(), 1.4);
    const amp = (0.4 + 0.6 * Math.random()) * (1 - at / (dur + 0.4));
    const pan = (Math.random() * 2 - 1) * 0.7;
    const l = amp * Math.cos(((pan + 1) * Math.PI) / 4);
    const r = amp * Math.sin(((pan + 1) * Math.PI) / 4);
    const start = Math.floor(at * rate);
    for (let i = 0; i < clapLen && start + i < left.length; i++) {
      const v = (Math.random() * 2 - 1) * Math.exp(-i / (0.005 * rate));
      left[start + i]! += v * l;
      right[start + i]! += v * r;
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const level = ctx.createGain();
  level.gain.value = gain;
  src.connect(filter(ctx, "bandpass", 1500, 0.7)).connect(level).connect(out);
  src.start(t);
  return { sources: [src], end: t + dur };
}
