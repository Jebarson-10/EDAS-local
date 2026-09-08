/**
 * Live D1 for §107 must be a current Cloudflare list, not a stale restore
 * JSON from a deleted preview account.
 */
export function liveD1Gate(opts: {
  listStatus: number | null;
  listed: { name?: string; id: string }[];
}): { status: "proven" | "missing"; evidence: string } {
  if (opts.listStatus === null) {
    return {
      status: "missing",
      evidence:
        "No Cloudflare credentials — cannot confirm live D1. Stale .data restore files are not live evidence.",
    };
  }
  if (opts.listStatus === 200 && opts.listed.length > 0) {
    const names = opts.listed
      .map((d) => `${d.name ?? "d1"} ${d.id}`)
      .join(", ");
    return {
      status: "proven",
      evidence: `D1 list HTTP 200 (${names}). Temporary D1 is not client Pages preview until staging:raise.`,
    };
  }
  return {
    status: "missing",
    evidence: `D1 list HTTP ${opts.listStatus}. Stale uat-restore / uat-temporary JSON does not prove a live database.`,
  };
}

/**
 * Live R2 for §107 is a current bucket list, not an unbound FILES stored:false
 * path. Temporary cfat_ tokens 403; a dashboard token must create/list a bucket.
 */
export function liveR2Gate(opts: {
  listStatus: number | null;
  buckets: { name: string }[];
}): { status: "proven" | "missing"; evidence: string } {
  if (opts.listStatus === null) {
    return {
      status: "missing",
      evidence:
        "No Cloudflare credentials — cannot confirm live R2. Unbound FILES (stored:false) is honest runtime, not a live binding.",
    };
  }
  if (opts.listStatus === 200 && opts.buckets.length > 0) {
    const names = opts.buckets.map((b) => b.name).join(", ");
    return {
      status: "proven",
      evidence: `R2 list HTTP 200 (${names}).`,
    };
  }
  if (opts.listStatus === 200) {
    return {
      status: "missing",
      evidence:
        "R2 API HTTP 200 but no buckets. npm run staging:raise creates erode-exam-duty-files-preview when the dashboard token has Workers R2 Storage Edit.",
    };
  }
  if (opts.listStatus === 403) {
    return {
      status: "missing",
      evidence:
        "R2 API HTTP 403. Add Workers R2 Storage Edit to the dashboard token so staging:raise can bind FILES. Preview cfat_ tokens cannot list R2.",
    };
  }
  return {
    status: "missing",
    evidence: `R2 list HTTP ${opts.listStatus}. Stale notes about stored:false do not prove a live bucket.`,
  };
}

/** Cloudflare R2 list JSON is either `{ result: { buckets } }` or `{ result: [] }`. */
export function r2BucketsFromListJson(json: unknown): { name: string }[] {
  if (!json || typeof json !== "object") return [];
  const result = (json as { result?: unknown }).result;
  const rows = Array.isArray(result)
    ? result
    : result &&
        typeof result === "object" &&
        Array.isArray((result as { buckets?: unknown }).buckets)
      ? (result as { buckets: unknown[] }).buckets
      : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const name = (row as { name?: unknown }).name;
      return typeof name === "string" && name.length > 0 ? { name } : null;
    })
    .filter((row): row is { name: string } => row != null);
}

/**
 * Cloudflare Pages preview URLs are the §107 staging UAT target.
 * Temporary workers.dev hosts are live D1 evidence, not Pages UAT.
 */
export function pagesPreviewUatError(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "STAGING_URL is not a valid URL.";
  }
  if (host.endsWith(".pages.dev")) return null;
  if (process.env.UAT_ALLOW_NON_PAGES === "1") return null;
  if (host.endsWith(".workers.dev")) {
    return "STAGING_URL is a workers.dev host. Temporary Worker+D1 is live D1 evidence, not Cloudflare Pages staging UAT. Raise Pages with npm run staging:raise, then pass the *.pages.dev URL.";
  }
  return "STAGING_URL must be a Cloudflare Pages preview (*.pages.dev) for §107 staging UAT.";
}

function stripHealth(url: string): string {
  return url.trim().replace(/\/api\/health$/i, "");
}

/** Prefer env STAGING_URL, then a file URL, but only if it is *.pages.dev. */
export function pagesStagingUatTarget(
  envUrl: string,
  fileUrl: string,
): string | null {
  for (const raw of [envUrl, fileUrl]) {
    const url = stripHealth(raw);
    if (!url) continue;
    if (!pagesPreviewUatError(url)) return url;
  }
  return null;
}

export function pagesStagingUatGate(opts: {
  envUrl: string;
  fileUrl: string;
  fileOk: boolean;
  dbOk: boolean;
  r2Ok?: boolean;
  allowUnboundR2?: boolean;
}): { status: "proven" | "missing"; evidence: string } {
  const target = pagesStagingUatTarget(opts.envUrl, opts.fileUrl);
  if (!target) {
    return {
      status: "missing",
      evidence:
        "No *.pages.dev STAGING_URL. Stale workers.dev uat files do not count. Run STAGING_URL=https://<preview>.pages.dev npm run uat:staging",
    };
  }
  const fileTarget = pagesStagingUatTarget("", opts.fileUrl);
  if (fileTarget !== target || !opts.fileOk || !opts.dbOk) {
    return {
      status: "missing",
      evidence: `Pages preview target ${target} — run STAGING_URL=${target} npm run uat:staging (need dbOk).`,
    };
  }
  if (!opts.r2Ok && !opts.allowUnboundR2) {
    return {
      status: "missing",
      evidence: `Pages preview ${target} dbOk is true but r2Ok is not. Bind FILES (dashboard token with R2 Storage Edit, npm run staging:raise) or set UAT_ALLOW_UNBOUND_R2=1 only for an explicit unbound exception.`,
    };
  }
  return {
    status: "proven",
    evidence: opts.r2Ok
      ? `uat:staging dbOk and r2Ok on ${target}`
      : `uat:staging dbOk on ${target} (UAT_ALLOW_UNBOUND_R2=1)`,
  };
}

/** First *.pages.dev URL in wrangler pages deploy output. Prefers a deployment host. */
export function pagesPreviewUrlFromText(text: string): string | null {
  const found = [
    ...text.matchAll(/https:\/\/[a-z0-9][a-z0-9.-]*\.pages\.dev/gi),
  ].map((m) => m[0].replace(/\/+$/, "").toLowerCase());
  const unique = [...new Set(found)];
  if (unique.length === 0) return null;
  const deployment = unique.find((u) => {
    try {
      return new URL(u).hostname.split(".").length > 3;
    } catch {
      return false;
    }
  });
  return deployment ?? unique[0] ?? null;
}

const PLACEHOLDER_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.gov.in",
]);

/** Docs samples use these domains. A live OQ-010 map must use real officer emails. */
export function placeholderRoleMapError(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "ACCESS_EMAIL_ROLE_MAP is not valid JSON.";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "ACCESS_EMAIL_ROLE_MAP must be a JSON object of email→role.";
  }
  const emails = Object.keys(parsed as Record<string, unknown>);
  if (emails.length === 0) {
    return "ACCESS_EMAIL_ROLE_MAP is empty.";
  }
  const placeholders = emails.filter((email) => {
    const domain = email.trim().toLowerCase().split("@")[1] ?? "";
    return PLACEHOLDER_DOMAINS.has(domain);
  });
  if (placeholders.length === emails.length) {
    return "ACCESS_EMAIL_ROLE_MAP uses documentation placeholder domains (example.com / example.gov.in). Set real officer emails from OQ-010; do not invent them.";
  }
  return null;
}
