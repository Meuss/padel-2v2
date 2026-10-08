import { describe, expect, it } from "vitest";
import { NO_DEV_PARAMS, readDevParams } from "../src/dev.js";

describe("readDevParams", () => {
  it("reads nothing from an empty query", () => {
    expect(readDevParams("")).toEqual(NO_DEV_PARAMS);
  });

  it("reads the shoot tool's join, bots and auto-serve", () => {
    const p = readDevParams("?join=Shooter&bots=3&autoserve=1&quality=low");
    expect(p).toMatchObject({ join: "Shooter", bots: 3, autoServe: true, quality: "low" });
    expect(readDevParams("?join=A&bots=9").bots).toBe(3);
    // Bots and the auto-serve only come with a join.
    expect(readDevParams("?bots=2&autoserve=1")).toMatchObject({ bots: 0, autoServe: false });
  });

  it("reads the samples, and ignores values it does not know", () => {
    const p = readDevParams("?vote=rematch&finalCard=1&banner=golden&fault=net&faultAt=600&roomStatus=3,1&joinView=outdated&tray=1");
    expect(p).toMatchObject({ vote: "rematch", finalCard: true, tray: true, joinView: "outdated", roomStatus: { playing: 3, watching: 1 } });
    expect(p.banner).not.toBeNull();
    expect(p.fault).toMatchObject({ highlight: { kind: "net" }, freezeMs: 600 });
    expect(readDevParams("?vote=maybe&quality=ultra&fault=nope&joinView=x")).toEqual(NO_DEV_PARAMS);
  });
});
