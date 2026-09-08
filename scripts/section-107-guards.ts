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
