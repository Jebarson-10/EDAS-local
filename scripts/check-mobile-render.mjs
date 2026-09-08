/**
 * Responsive render check: the bento dashboard must render real tiles (not the
 * loading skeleton) at mobile, tablet and desktop widths.
 *   node scripts/check-mobile-render.mjs
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, "../frontend/package.json"));
const { chromium } = require("playwright");

const base = process.env.APP_URL ?? "http://127.0.0.1:43123";

const viewports = [
  { name: "mobile", width: 420, height: 900 },
  { name: "tablet", width: 820, height: 1000 },
  { name: "desktop", width: 1440, height: 900 },
];

const browser = await chromium.launch({ headless: true });
let failed = 0;

for (const vp of viewports) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base, { waitUntil: "domcontentloaded" });

  try {
    // Real content, not the skeleton: stat tiles + pipeline + provenance.
    await page.getByTestId("dashboard-hydrate").waitFor({ timeout: 20_000 });
    await page.getByText("Allocation pipeline").waitFor({ timeout: 20_000 });
    await page.getByText("Data provenance").waitFor({ timeout: 20_000 });

    // Navigation must be reachable at every width.
    const navSelector =
      vp.width < 768 ? "nav-mobile-theory" : "nav-theory";
    await page.getByTestId(navSelector).click({ timeout: 10_000 });
    await page.getByText("Theory examination duty").waitFor({ timeout: 20_000 });

    // No horizontal overflow of the document at any width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (overflow > 2) {
      throw new Error(`horizontal overflow ${overflow}px`);
    }

    if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
    console.log(`PASS ${vp.name} (${vp.width}px)`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${vp.name} (${vp.width}px): ${e.message}`);
  }
  await page.close();
}

await browser.close();
if (failed) {
  console.error(`RESPONSIVE_FAIL ${failed}/${viewports.length}`);
  process.exit(1);
}
console.log(`RESPONSIVE_OK ${viewports.length}/${viewports.length}`);
