/**
 * Machine-readable §107 evidence matrix. Exit 0 only when every required
 * gate is proven from current files / env / live APIs. Temporary Worker+D1
 * never counts as Pages staging UAT.
 *
 *   npm run section:107
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  pagesForbiddenOnTemporaryAccount,
  resolveCloudflareCredentials,
} from "./cloudflare-credentials.ts";
import {
  liveD1Gate,
  liveR2Gate,
  pagesStagingUatGate,
  placeholderRoleMapError,
  r2BucketsFromListJson,
} from "./section-107-guards.ts";

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
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  let json: unknown = null;
  try {
    json = JSON.parse(await res.text());
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

async function main() {
  const gates: Gate[] = [];
  const creds = resolveCloudflareCredentials();
  const token = creds?.token;
  const accountId = creds?.accountId;
  const map =
    creds?.accessEmailRoleMap?.trim() ||
    process.env.ACCESS_EMAIL_ROLE_MAP?.trim();

  let d1ListStatus: number | null = null;
  let d1Listed: { name?: string; id: string }[] = [];
  if (token && accountId) {
    const d1 = await cfProbe(token, accountId, "/d1/database?per_page=10");
    d1ListStatus = d1.status;
    const rows = (
      d1.json as { result?: { name?: string; uuid?: string; id?: string }[] } | null
    )?.result;
    d1Listed = (rows ?? [])
      .map((row) => ({
        name: row.name,
        id: String(row.uuid ?? row.id ?? ""),
      }))
      .filter((row) => row.id.length > 0);
  }
  const d1Gate = liveD1Gate({ listStatus: d1ListStatus, listed: d1Listed });
  const waitEvidence = readJson(join(ROOT, ".data/staging-wait-claimed-latest.json"));
  const counts = waitEvidence?.d1Counts as
    | { teachers?: number; history?: number }
    | undefined;
  const d1Evidence =
    d1Gate.status === "proven" &&
    typeof counts?.teachers === "number" &&
    typeof counts?.history === "number"
      ? `${d1Gate.evidence} Waiter counts teachers=${counts.teachers} history=${counts.history}.`
      : d1Gate.evidence;
  gates.push({
    id: "live-d1",
    required: true,
    status: d1Gate.status,
    evidence: d1Evidence,
  });

  let r2ListStatus: number | null = null;
  let r2Listed: { name: string }[] = [];
  let pagesStatus: Gate["status"] = "missing";
  let pagesEvidence =
    "No Cloudflare credentials — cannot create Pages. Unclaimed temporary accounts 403 Pages until claimed.";
  if (token && accountId) {
    const src =
      creds?.source === "temporary" ? "temporary account token" : "client token";
    const r2 = await cfProbe(token, accountId, "/r2/buckets");
    r2ListStatus = r2.status;
    r2Listed = r2BucketsFromListJson(r2.json);
    const pages = await cfProbe(token, accountId, "/pages/projects");
    if (pages.ok) {
      pagesStatus = "proven";
      pagesEvidence = `Pages API reachable with the ${src}.`;
    } else if (pages.status === 403 && creds?.source === "temporary") {
      pagesEvidence = pagesForbiddenOnTemporaryAccount(creds);
    } else {
      pagesEvidence = `Pages API HTTP ${pages.status}`;
    }
  }
  const r2Gate = liveR2Gate({ listStatus: r2ListStatus, buckets: r2Listed });
  gates.push({
    id: "live-r2",
    required: true,
    status: r2Gate.status,
    evidence: r2Gate.evidence,
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
  const health = staging?.health as { dbOk?: boolean; r2Ok?: boolean } | undefined;
  const uat = pagesStagingUatGate({
    envUrl: process.env.STAGING_URL ?? "",
    fileUrl: String(staging?.url ?? ""),
    fileOk: staging?.ok === true,
    dbOk: health?.dbOk === true,
    r2Ok: health?.r2Ok === true,
    allowUnboundR2: process.env.UAT_ALLOW_UNBOUND_R2 === "1",
  });
  gates.push({
    id: "pages-staging-uat",
    required: true,
    status: uat.status,
    evidence: uat.evidence,
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
