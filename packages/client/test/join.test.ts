import { describe, expect, it } from "vitest";
import { capName, countsLine, nameCount, parseStatus, roomLine, statusUrl } from "../src/hud/join.js";

const human = { isBot: false };
const bot = { isBot: true };

describe("roomLine", () => {
  it("counts the seated people and the watchers", () => {
    expect(roomLine({ players: [human, human, human], spectatorCount: 1 })).toBe("3 playing · 1 watching");
  });

  it("leaves the bots out of the playing count: a bot's seat can be taken", () => {
    expect(roomLine({ players: [human, bot, bot, bot], spectatorCount: 0 })).toBe("1 playing · 0 watching");
  });

  it("says the court is free when nobody is there", () => {
    expect(roomLine({ players: [bot, bot], spectatorCount: 0 })).toBe("Court is free");
  });

  it("invents nothing before the room is known", () => {
    expect(roomLine(null)).toBe("First four play · the rest watch");
  });
});

describe("nameCount", () => {
  it("counts against the 16-character cap", () => {
    expect(nameCount("")).toBe("0/16");
    expect(nameCount("Shooter")).toBe("7/16");
    expect(nameCount("ABCDEFGHIJKLMNOP")).toBe("16/16");
  });

  it("counts an emoji once, as the server's cap does", () => {
    expect(nameCount("Ana 🎾")).toBe("5/16");
  });
});

describe("capName", () => {
  it("keeps a name of 16 code points or fewer as typed", () => {
    expect(capName("Shooter")).toBe("Shooter");
    expect(capName("ABCDEFGHIJKLMNOP")).toBe("ABCDEFGHIJKLMNOP");
  });

  it("cuts at 16 code points", () => {
    expect(capName("ABCDEFGHIJKLMNOPQR")).toBe("ABCDEFGHIJKLMNOP");
  });

  it("allows 16 emoji (32 UTF-16 units) and never splits one", () => {
    const sixteen = "🎾".repeat(16);
    expect(capName(sixteen + "🎾")).toBe(sixteen);
    expect(nameCount(capName(sixteen + "🎾"))).toBe("16/16");
  });
});

describe("statusUrl", () => {
  it("reads the server's /status over http(s) from its ws(s) address", () => {
    expect(statusUrl("ws://localhost:8080")).toBe("http://localhost:8080/status");
    expect(statusUrl("wss://padel.onrender.com")).toBe("https://padel.onrender.com/status");
    expect(statusUrl("wss://padel.onrender.com/socket?x=1")).toBe("https://padel.onrender.com/status");
  });

  it("is null for an address it cannot read", () => {
    expect(statusUrl("not a url")).toBeNull();
    expect(statusUrl("ftp://example.com")).toBeNull();
  });
});

describe("countsLine and parseStatus", () => {
  it("formats the counts the server reports", () => {
    expect(countsLine({ playing: 2, watching: 5 })).toBe("2 playing · 5 watching");
    expect(countsLine({ playing: 0, watching: 0 })).toBe("Court is free");
  });

  it("accepts only two non-negative whole counts", () => {
    expect(parseStatus({ playing: 1, watching: 0 })).toEqual({ playing: 1, watching: 0 });
    expect(parseStatus({ playing: -1, watching: 0 })).toBeNull();
    expect(parseStatus({ playing: "1", watching: 0 })).toBeNull();
    expect(parseStatus(null)).toBeNull();
  });
});
