/**
 * Product "staging" is Cloudflare Pages [env.preview].
 * Pages only supports preview + production; [env.staging] is ignored/rejected.
 */

export type WranglerEnv = "preview" | "production";

export function wranglerEnvFor(productEnv: string | null | undefined): WranglerEnv {
  if (!productEnv) {
    throw new Error("Missing --env (use staging|preview|production)");
  }
  if (productEnv === "staging" || productEnv === "preview") return "preview";
  if (productEnv === "production") return "production";
  throw new Error(`Unknown --env ${productEnv} (use staging|preview|production)`);
}

export function envMarker(wranglerEnv: WranglerEnv): string {
  return `[env.${wranglerEnv}]`;
}

export function extractEnvSection(
  toml: string,
  wranglerEnv: WranglerEnv,
): string | null {
  const marker = envMarker(wranglerEnv);
  const start = toml.indexOf(marker);
  if (start < 0) return null;
  const nextEnv = toml.indexOf("\n[env.", start + marker.length);
  return toml.slice(start, nextEnv < 0 ? undefined : nextEnv);
}

export function uncommentedD1Present(section: string): boolean {
  return /^\s*\[\[env\.[^\]]+\.d1_databases\]\]/m.test(section);
}

export function hasReplaceMe(text: string): boolean {
  return /REPLACE_ME[A-Z0-9_]*/.test(text);
}

export function uncommentedD1DatabaseName(section: string): string | null {
  const m = section.match(/^\s*database_name\s*=\s*"([^"]+)"/m);
  return m?.[1] ?? null;
}

export function uncommentedD1DatabaseId(section: string): string | null {
  const m = section.match(/^\s*database_id\s*=\s*"([^"]+)"/m);
  return m?.[1] ?? null;
}

export function isD1BindingReady(section: string): boolean {
  if (!uncommentedD1Present(section)) return false;
  const id = uncommentedD1DatabaseId(section);
  if (!id || hasReplaceMe(id)) return false;
  // Commented leftover REPLACE_ME on R2/other lines must not fail D1-ready.
  const liveLines = section
    .split("\n")
    .filter((l) => !/^\s*#/.test(l) && l.trim().length > 0)
    .join("\n");
  return !hasReplaceMe(liveLines);
}

export function uncommentedR2Present(section: string): boolean {
  return /^\s*\[\[env\.[^\]]+\.r2_buckets\]\]/m.test(section);
}

export function applyR2Binding(
  toml: string,
  wranglerEnv: WranglerEnv,
  r2: { bucket: string },
): string {
  const marker = envMarker(wranglerEnv);
  const start = toml.indexOf(marker);
  if (start < 0) {
    throw new Error(`missing ${marker}`);
  }
  const nextEnv = toml.indexOf("\n[env.", start + marker.length);
  const end = nextEnv < 0 ? toml.length : nextEnv;
  let section = toml.slice(start, end);
  const live = [
    `[[env.${wranglerEnv}.r2_buckets]]`,
    `binding = "FILES"`,
    `bucket_name = "${r2.bucket}"`,
  ].join("\n");

  const commented = section.match(
    /#\s*\[\[env\.[^\]]+\.r2_buckets\]\]\s*\n#\s*binding = "FILES"\s*\n#\s*bucket_name = "[^"]*"/,
  );
  if (commented) {
    section = section.replace(commented[0], live);
  } else if (uncommentedR2Present(section)) {
    section = section.replace(
      /^\s*bucket_name = "[^"]*"/m,
      `bucket_name = "${r2.bucket}"`,
    );
  } else {
    section = section.replace(/vars = \{[^}]+\}/, (m) => `${m}\n${live}`);
  }
  return toml.slice(0, start) + section + toml.slice(end);
}

export function applyD1Binding(
  toml: string,
  wranglerEnv: WranglerEnv,
  d1: { name: string; id: string },
): string {
  const marker = envMarker(wranglerEnv);
  const start = toml.indexOf(marker);
  if (start < 0) {
    throw new Error(`missing ${marker}`);
  }
  const nextEnv = toml.indexOf("\n[env.", start + marker.length);
  const end = nextEnv < 0 ? toml.length : nextEnv;
  let section = toml.slice(start, end);
  const live = [
    `[[env.${wranglerEnv}.d1_databases]]`,
    `binding = "DB"`,
    `database_name = "${d1.name}"`,
    `database_id = "${d1.id}"`,
  ].join("\n");

  const commented = section.match(
    /#\s*\[\[env\.[^\]]+\.d1_databases\]\]\s*\n#\s*binding = "DB"\s*\n#\s*database_name = "[^"]*"\s*\n#\s*database_id = "[^"]*"/,
  );
  if (commented) {
    section = section.replace(commented[0], live);
  } else if (uncommentedD1Present(section)) {
    section = section
      .replace(/^\s*database_name = "[^"]*"/m, `database_name = "${d1.name}"`)
      .replace(/^\s*database_id = "[^"]*"/m, `database_id = "${d1.id}"`);
  } else {
    section = section.replace(/vars = \{[^}]+\}/, (m) => `${m}\n${live}`);
  }
  return toml.slice(0, start) + section + toml.slice(end);
}

export function assertPagesTomlHasNoStagingEnv(toml: string): void {
  if (/\[env\.staging\]/.test(toml)) {
    throw new Error(
      "Pages wrangler.toml must not use [env.staging]; Cloudflare Pages only applies [env.preview] and [env.production].",
    );
  }
}
