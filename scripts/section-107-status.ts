/**
 * Machine-readable §107 evidence matrix. Exit 0 only when every required
 * gate is proven from current files / env / live APIs. Temporary Worker+D1
 * never counts as Pages staging UAT.
 *
 *   npm run section:107
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pagesPreviewUatError, placeholderRoleMapError } from "./section-107-guards.ts";

const ROOT = process.cwd();
const OUT = join(ROOT, ".data/section-107-latest.json");

type Gate = {
  id: string;
  required: boolean;
  status: "proven" | "missing" | "blocked" | "optional-unbound";
  evidence: string;
};

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function oqAnswersFilled(): boolean {
  const text = readFileSync(join(ROOT, "docs/client-inputs-checklist.md"), "utf8");
  const rows = [...text.matchAll(/^\| OQ-\d{3} \|[^|]+\|([^|]*)\|/gm)];
  if (rows.length < 10) return false;
  return rows.every((m) => m[1]!.trim().length > 0);
}

function promoteSigned(): boolean {
  const text = readFileSync(join(ROOT, "docs/production-promote.md"), "utf8");
  return /\|\s*Decision\s*\|\s*approved\s*\|/i.test(text);
}

async function cfProbe(
  token: string,
  accountId: string,
  path: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { ok: res.ok, status: res.status };
}

async function main() {
  const gates: Gate[] = [];
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const map = process.env.ACCESS_EMAIL_ROLE_MAP?.trim();

  const tmp = readJson(join(ROOT, ".data/uat-temporary-latest.json"));
  const restore = readJson(join(ROOT, ".data/uat-restore-latest.json"));
  const liveD1 =
    restore?.ok === true ||
    tmp?.d1Ok === true ||
    (typeof tmp?.databaseId === "string" && tmp.databaseId.length > 0);
  gates.push({
    id: "live-d1",
    required: true,
    status: liveD1 ? "proven" : "missing",
    evidence: liveD1
      ? "Temporary or restored D1 exists (.data/uat-temporary-latest.json / uat-restore-latest.json). Client preview D1 still needs staging:raise."
      : "No live D1 evidence file.",
  });

  let r2Status: Gate["status"] = "missing";
  let r2Evidence =
    "No CLOUDFLARE_API_TOKEN — cannot list R2. Temporary accounts 403 R2.";
  let pagesStatus: Gate["status"] = "missing";
  let pagesEvidence =
    "No CLOUDFLARE_API_TOKEN — cannot create Pages. Temporary accounts 403 Pages.";
  if (token && accountId) {
    const r2 = await cfProbe(token, accountId, "/r2/buckets");
    if (r2.ok) {
      r2Status = "proven";
      r2Evidence = "R2 API reachable with the client token.";
    } else if (r2.status === 403) {
      r2Status = "optional-unbound";
      r2Evidence =
        "R2 API 403. Backups may stay stored:false. Bind FILES when the client creates a bucket.";
    } else {
      r2Evidence = `R2 API HTTP ${r2.status}`;
    }
    const pages = await cfProbe(token, accountId, "/pages/projects");
    if (pages.ok) {
      pagesStatus = "proven";
      pagesEvidence = "Pages API reachable.";
    } else {
      pagesEvidence = `Pages API HTTP ${pages.status}`;
    }
  }
  gates.push({
    id: "live-r2",
    required: false,
    status: r2Status,
    evidence: r2Evidence,
  });
  gates.push({
    id: "pages-api",
    required: true,
    status: pagesStatus,
    evidence: pagesEvidence,
  });

  let accessStatus: Gate["status"] = "missing";
  let accessEvidence = "ACCESS_EMAIL_ROLE_MAP unset (OQ-010). Not inventing officers.";
  if (map) {
    const err = placeholderRoleMapError(map);
    if (err) {
      accessEvidence = err;
    } else {
      accessStatus = "proven";
      accessEvidence = "ACCESS_EMAIL_ROLE_MAP is set and is not the documentation sample.";
    }
  }
  gates.push({
    id: "access-oq-010",
    required: true,
    status: accessStatus,
    evidence: accessEvidence,
  });

  const staging = readJson(join(ROOT, ".data/uat-staging-latest.json"));
  const stagingUrl = String(staging?.url ?? process.env.STAGING_URL ?? "");
  const pagesUatError = stagingUrl ? pagesPreviewUatError(stagingUrl.replace(/\/api\/health$/, "")) : "No STAGING_URL / uat-staging-latest.json.";
  const stagingOk =
    staging?.ok === true &&
    !pagesUatError &&
    (staging.health as { dbOk?: boolean } | undefined)?.dbOk === true;
  gates.push({
    id: "pages-staging-uat",
    required: true,
    status: stagingOk ? "proven" : "missing",
    evidence: stagingOk
      ? `uat:staging dbOk on ${stagingUrl}`
      : pagesUatError || "Run STAGING_URL=https://<preview>.pages.dev npm run uat:staging",
  });

  gates.push({
    id: "client-oq-answers",
    required: true,
    status: oqAnswersFilled() ? "proven" : "missing",
    evidence: oqAnswersFilled()
      ? "docs/client-inputs-checklist.md OQ table has answers."
      : "OQ-001–019 answer column is still empty. Do not invent answers.",
  });

  gates.push({
    id: "human-prod-promote",
    required: true,
    status: promoteSigned() ? "proven" : "missing",
    evidence: promoteSigned()
      ? "docs/production-promote.md Decision is approved."
      : "docs/production-promote.md is unsigned. Agents must not promote.",
  });

  const required = gates.filter((g) => g.required);
  const ok = required.every((g) => g.status === "proven");
  const evidence = {
    checkedAt: new Date().toISOString(),
    ok,
    kind: "section-107-status",
    gates,
    note: ok
      ? "All required §107 gates proven."
      : "§107 incomplete. Temporary Worker+D1 is not Pages UAT. Do not invent OQ-010 or promote production.",
  };
  mkdirSync(join(ROOT, ".data"), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  console.log("Evidence:", OUT);
  if (!ok) process.exit(1);
}

void main();
