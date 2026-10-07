import { describe, expect, it } from "vitest";
import type { ContactSurface, ShotKind, Timing } from "@padel/shared";
import { AudioEngine } from "../src/audio/engine.js";
import {
  SOUND_STALE_MS,
  contactVoice,
  crowdLevel,
  crowdReaction,
  screenPan,
  shotClickHz,
  shotVoice,
  shouldPlay,
} from "../src/audio/voices.js";

const SURFACES: ContactSurface[] = ["floor", "glass", "fence", "net"];
const KINDS: ShotKind[] = ["drive", "lob", "smash", "serve"];
const TIMINGS: Timing[] = ["early", "perfect", "late"];

describe("contactVoice", () => {
  it("is silent (null) below 1.5 m/s", () => {
    for (const s of SURFACES) {
      expect(contactVoice(s, 0)).toBeNull();
      expect(contactVoice(s, 1.49)).toBeNull();
      expect(contactVoice(s, 1.5)).not.toBeNull();
    }
  });

  it("gets louder, and never quieter, with speed", () => {
    for (const s of SURFACES) {
      let prev = 0;
      for (let v = 1.5; v <= 40; v += 0.5) {
        const g = contactVoice(s, v)!.gain;
        expect(g).toBeGreaterThanOrEqual(prev);
        prev = g;
      }
      expect(contactVoice(s, 20)!.gain).toBeGreaterThan(contactVoice(s, 3)!.gain);
    }
  });

  it("keeps every voice within a sane range", () => {
    for (const s of SURFACES) {
      for (const v of [1.5, 5, 15, 60]) {
        const p = contactVoice(s, v)!;
        expect(p.gain).toBeGreaterThan(0);
        expect(p.gain).toBeLessThanOrEqual(1);
        expect(p.freq).toBeGreaterThan(20);
        expect(p.decay).toBeGreaterThan(0);
        expect(p.decay).toBeLessThan(1);
        expect(p.noise).toBeGreaterThanOrEqual(0);
        expect(p.noise).toBeLessThanOrEqual(1);
        expect(p.q).toBeGreaterThan(0);
      }
    }
  });

  it("uses the brief's timbres: 40 ms turf thud, ~0.35 s glass ping around 1.1 kHz, 0.25 s fence, 180 ms net", () => {
    expect(contactVoice("floor", 8)!.decay).toBeCloseTo(0.04);
    expect(contactVoice("glass", 8)!.decay).toBeCloseTo(0.35);
    expect(contactVoice("glass", 8)!.freq).toBeGreaterThan(1000);
    expect(contactVoice("glass", 8)!.freq).toBeLessThan(1200);
    expect(contactVoice("fence", 8)!.decay).toBeCloseTo(0.25);
    expect(contactVoice("net", 8)!.decay).toBeCloseTo(0.18);
  });
});

describe("shotVoice", () => {
  it("makes a Smash louder, lower and longer than a Drive", () => {
    for (const t of TIMINGS) {
      const smash = shotVoice("smash", t);
      const drive = shotVoice("drive", t);
      expect(smash.gain).toBeGreaterThan(drive.gain);
      expect(smash.freq).toBeLessThan(drive.freq);
      expect(smash.decay).toBeGreaterThan(drive.decay);
    }
    // Even a mistimed Smash outweighs a perfect Drive.
    expect(shotVoice("smash", "early").gain).toBeGreaterThan(shotVoice("drive", "perfect").gain);
  });

  it("pops at 520 Hz over 60 ms for a Drive and at 380 Hz for a Smash", () => {
    expect(shotVoice("drive", "perfect").freq).toBe(520);
    expect(shotVoice("drive", "perfect").decay).toBeCloseTo(0.06);
    expect(shotVoice("smash", "perfect").freq).toBe(380);
  });

  it("is louder for perfect Timing than for early or late", () => {
    for (const k of KINDS) {
      expect(shotVoice(k, "perfect").gain).toBeGreaterThan(shotVoice(k, "early").gain);
      expect(shotVoice(k, "perfect").gain).toBeGreaterThan(shotVoice(k, "late").gain);
      expect(shotVoice(k, "perfect").gain).toBeLessThanOrEqual(1);
    }
  });

  it("brightens the click band for perfect Timing", () => {
    expect(shotClickHz("perfect")).toBe(2400);
    expect(shotClickHz("early")).toBe(1800);
    expect(shotClickHz("late")).toBe(1800);
  });
});

describe("crowdLevel", () => {
  it("idles at 0.15 for the first shots and tops out at 0.6 from 12", () => {
    expect(crowdLevel(0)).toBeCloseTo(0.15);
    expect(crowdLevel(2)).toBeCloseTo(0.15);
    expect(crowdLevel(12)).toBeCloseTo(0.6);
    expect(crowdLevel(40)).toBeCloseTo(0.6);
  });

  it("rises monotonically and smoothly in between", () => {
    let prev = crowdLevel(0);
    for (let n = 0; n <= 20; n += 0.25) {
      const l = crowdLevel(n);
      expect(l).toBeGreaterThanOrEqual(prev);
      expect(l - prev).toBeLessThan(0.05); // no jumps
      prev = l;
    }
    expect(crowdLevel(7)).toBeGreaterThan(0.15);
    expect(crowdLevel(7)).toBeLessThan(0.6);
  });
});

describe("shouldPlay", () => {
  it("drops events more than 200 ms old", () => {
    expect(SOUND_STALE_MS).toBe(200);
    expect(shouldPlay(1000, 1000)).toBe(true);
    expect(shouldPlay(1000, 1200)).toBe(true);
    expect(shouldPlay(1000, 1201)).toBe(false);
    expect(shouldPlay(1000, 5000)).toBe(false);
  });

  it("plays events that are not due yet", () => {
    expect(shouldPlay(1000, 900)).toBe(true);
  });
});

describe("screenPan", () => {
  it("maps the screen's x to -0.8…0.8", () => {
    expect(screenPan(0, 1000)).toBeCloseTo(-0.8);
    expect(screenPan(500, 1000)).toBeCloseTo(0);
    expect(screenPan(1000, 1000)).toBeCloseTo(0.8);
    expect(screenPan(-400, 1000)).toBeCloseTo(-0.8);
    expect(screenPan(3000, 1000)).toBeCloseTo(0.8);
    expect(screenPan(10, 0)).toBe(0);
  });
});

describe("crowdReaction", () => {
  it("cheers points, games and the match, louder for games and the match", () => {
    expect(crowdReaction("point")).toEqual({ kind: "cheer", intensity: 0.5 });
    expect(crowdReaction("game")).toEqual({ kind: "cheer", intensity: 1 });
    expect(crowdReaction("set")).toEqual({ kind: "cheer", intensity: 1 });
  });

  it("goes 'ooh' on a Fault and stays quiet otherwise", () => {
    expect(crowdReaction("fault")).toEqual({ kind: "ooh" });
    expect(crowdReaction("let")).toBeNull();
    expect(crowdReaction("reset")).toBeNull();
    expect(crowdReaction("start")).toBeNull();
    expect(crowdReaction(null)).toBeNull();
  });
});

describe("AudioEngine without Web Audio", () => {
  it("constructs and ignores every call", () => {
    const a = new AudioEngine();
    expect(() => {
      a.unlock();
      a.shot("smash", "perfect", 0.3);
      a.contact("glass", 10, -0.5);
      a.crowd(0.4);
      a.cheer(1);
      a.ooh();
      a.setMuted(true);
    }).not.toThrow();
    expect(a.muted).toBe(true);
    a.setMuted(false);
    expect(a.muted).toBe(false);
    expect(Object.values(a.stats).every((n) => n === 0)).toBe(true);
  });
});
