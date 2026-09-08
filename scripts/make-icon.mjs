/**
 * Rasterise desktop/build/icon.svg to the 1024px PNG electron-builder needs
 * for AppImage / NSIS / dmg icons.
 *
 * Usage: node scripts/make-icon.mjs
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, "../frontend/package.json"));
const { chromium } = require("playwright");

const root = join(__dirname, "..");
const svgPath = join(root, "desktop/build/icon.svg");
const outPath = join(root, "desktop/build/icon.png");
const size = 1024;

const svg = readFileSync(svgPath, "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: size, height: size },
  deviceScaleFactor: 1,
});
await page.setContent(
  `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
);
await page.locator("svg").screenshot({ path: outPath, omitBackground: true });
await browser.close();
console.log(`Wrote ${outPath} (${size}x${size})`);
