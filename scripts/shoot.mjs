// Headless screenshot + render stats tool.
// Usage: pnpm shoot [--out dir] [--wait ms] [--spectator] [--width n --height n] [--url u] [--quality high|low]
// --quality pins the renderer level (default high): SwiftShader is far too slow for the
// automatic fallback, which would otherwise always drop to "low" mid-shot.
import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const { values: o } = parseArgs({
  options: {
    out: { type: "string", default: ".shots" },
    wait: { type: "string", default: "4000" },
    spectator: { type: "boolean", default: false },
    width: { type: "string", default: "1440" },
    height: { type: "string", default: "900" },
    url: { type: "string", default: "http://localhost:5173" },
    quality: { type: "string", default: "high" },
  },
});
if (o.quality !== "high" && o.quality !== "low") throw new Error(`--quality must be high or low, got ${o.quality}`);
const wait = Number(o.wait);
const width = Number(o.width);
const height = Number(o.height);
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function shoot(browser, path, file, expectTags) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  await page.goto(`${o.url}/${path}&quality=${o.quality}`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(
      (n) => window.__padelScene && document.querySelectorAll(".nametag").length >= n,
      { timeout: 20000 },
      expectTags,
    );
  } catch {
    throw new Error(`Timed out waiting for scene and ${expectTags} nametags at ${path}`);
  }
  await new Promise((r) => setTimeout(r, wait));
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 >= 2000) resolve(Math.round((n * 1000) / (performance.now() - t0) * 10) / 10);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  const stats = await page.evaluate(() => window.__padelScene.stats());
  await page.screenshot({ path: join(o.out, file) });
  return { ...stats, fps };
}

let browser;
try {
  await mkdir(o.out, { recursive: true });
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-first-run"],
    defaultViewport: { width, height, deviceScaleFactor: 1 },
  });
  const result = {};
  result.player = await shoot(browser, "?join=Shooter&bots=3", "player.png", 4);
  if (o.spectator) result.spectator = await shoot(browser, "?join=Watcher", "spectator.png", 4);
  const json = JSON.stringify(result, null, 2);
  await writeFile(join(o.out, "stats.json"), json + "\n");
  console.log(json);
} catch (e) {
  console.error(`shoot failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
