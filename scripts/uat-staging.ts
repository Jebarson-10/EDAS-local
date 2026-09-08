/**
 * Probe a deployed Pages preview URL for the §107 D1 + R2 evidence.
 *
 * Usage: STAGING_URL=https://<deployment>.pages.dev npm run uat:staging
 *
 * Passing requires /api/health to answer JSON with dbOk true and r2Ok true
 * (FILES bound). Set UAT_ALLOW_UNBOUND_R2=1 only for an explicit unbound exception.
 * An HTML body means the deploy shipped the SPA without functions/ (see npm run check:pages).
 * Evidence is written to .data/uat-staging-latest.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pagesPreviewUatError } from "./section-107-guards.ts";

const root = resolve(import.meta.dirname, "..");
const url = process.env.STAGING_URL ?? process.env.PAGES_PREVIEW_URL ?? "";

if (!url) {
  console.error(
    "uat:staging needs STAGING_URL (or PAGES_PREVIEW_URL) pointing at the deployed Pages preview.",
  );
  process.exit(2);
}

const base = url.replace(/\/+$/, "");
const target = `${base}/api/health`;

function record(result: Record<string, unknown>) {
  const dir = resolve(root, ".data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "uat-staging-latest.json"),
    `${JSON.stringify({ checkedAt: new Date().toISOString(), url: target, ...result }, null, 2)}\n`,
  );
}

const previewError = pagesPreviewUatError(base);
if (previewError) {
  record({ ok: false, error: "not-pages-preview", detail: previewError });
  console.error(`uat:staging FAILED — ${previewError}`);
  process.exit(1);
}

async function main() {
  let res: Response;
  try {
    res = await fetch(target, { headers: { accept: "application/json" } });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    record({ ok: false, error: "unreachable", detail });
    console.error(`uat:staging FAILED — ${target} unreachable: ${detail}`);
    process.exit(1);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();
  const challenged = res.headers.get("cf-mitigated") === "challenge";

  if (challenged) {
    record({
      ok: false,
      status: res.status,
      contentType,
      challenged: true,
      error: "cloudflare-managed-challenge",
    });
    console.error(
      `uat:staging FAILED — ${target} returned a Cloudflare managed challenge (${res.status}).`,
    );
    console.error(
      "This is not a missing functions/ deploy. Retry from a browser, or use npm run staging:temporary D1 execute evidence when workers.dev bot-fights this network.",
    );
    process.exit(1);
  }

  if (!contentType.includes("json")) {
    record({
      ok: false,
      status: res.status,
      contentType,
      error: "non-json health",
    });
    console.error(
      `uat:staging FAILED — ${target} returned ${res.status} ${contentType || "no content-type"}.`,
    );
    console.error(
      "That is the SPA shell, not the API. Run npm run check:pages and redeploy without a positional assets directory.",
    );
    process.exit(1);
  }

  let health: Record<string, unknown>;
  try {
    health = JSON.parse(body) as Record<string, unknown>;
  } catch {
    record({ ok: false, status: res.status, error: "invalid json" });
    console.error(`uat:staging FAILED — ${target} returned invalid JSON.`);
    process.exit(1);
  }

  const dbOk = health.dbOk === true;
  const r2Ok = health.r2Ok === true;
  const allowUnboundR2 = process.env.UAT_ALLOW_UNBOUND_R2 === "1";
  const ok = dbOk && (r2Ok || allowUnboundR2);
  record({ ok, status: res.status, health, allowUnboundR2 });

  if (!dbOk) {
    console.error(
      `uat:staging FAILED — dbOk=${String(health.dbOk)} (${String(health.dbError ?? "no detail")}).`,
    );
    console.error(
      "Bind D1 to the Pages preview environment (npm run staging:raise) and redeploy.",
    );
    process.exit(1);
  }

  if (!r2Ok && !allowUnboundR2) {
    console.error(
      `uat:staging FAILED — r2Ok=${String(health.r2Ok)} (${String(health.r2Error ?? "FILES unbound")}).`,
    );
    console.error(
      "Bind FILES with a dashboard token that has Workers R2 Storage Edit (npm run staging:raise). UAT_ALLOW_UNBOUND_R2=1 is an explicit exception only.",
    );
    process.exit(1);
  }

  console.log(
    r2Ok
      ? `uat:staging OK — ${target} reports dbOk true and r2Ok true.`
      : `uat:staging OK — ${target} reports dbOk true (UAT_ALLOW_UNBOUND_R2=1; r2Ok is not true).`,
  );
  console.log(
    `environment=${String(health.environment ?? "?")} storage=${String(health.storage ?? "?")} r2Ok=${String(health.r2Ok)}`,
  );
  console.log("Evidence: .data/uat-staging-latest.json");
}

void main();
