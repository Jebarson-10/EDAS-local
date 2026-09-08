/**
 * Gate the Cloudflare Pages layout so a deploy actually ships the API.
 *
 * Two silent failure modes this catches:
 *  - `wrangler pages deploy <dir>` with a positional directory makes Wrangler
 *    ignore wrangler.toml entirely, so functions/ and the D1 binding vanish
 *    while the deploy still reports success.
 *  - a missing functions/api/[[path]].ts or /api/* route rule serves the SPA
 *    shell for API calls, which looks like a 200 with HTML.
 *
 * Usage: npm run check:pages
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface PagesLayoutInput {
  pagesToml: string;
  functionCatchAll: string | null;
  routesJson: string | null;
  deployScript: string | null;
}

export function checkPagesLayout(input: PagesLayoutInput): string[] {
  const problems: string[] = [];

  if (!/^\s*pages_build_output_dir\s*=\s*"frontend\/dist"/m.test(input.pagesToml)) {
    problems.push(
      'wrangler.toml must set pages_build_output_dir = "frontend/dist" so deploys need no positional directory.',
    );
  }

  if (input.functionCatchAll === null) {
    problems.push(
      "functions/api/[[path]].ts is missing — Pages would serve the SPA for /api/* instead of the Worker.",
    );
  } else if (!/onRequest/.test(input.functionCatchAll)) {
    problems.push(
      "functions/api/[[path]].ts must export an onRequest handler backed by worker/src/index.ts.",
    );
  }

  if (input.routesJson === null) {
    problems.push("frontend/public/_routes.json is missing.");
  } else {
    let include: unknown;
    try {
      include = (JSON.parse(input.routesJson) as { include?: unknown }).include;
    } catch {
      problems.push("frontend/public/_routes.json is not valid JSON.");
    }
    if (include !== undefined && !(Array.isArray(include) && include.includes("/api/*"))) {
      problems.push('frontend/public/_routes.json must include "/api/*".');
    }
  }

  const deploy = input.deployScript ?? "";
  if (!deploy) {
    problems.push("package.json is missing the pages:deploy:preview script.");
  } else if (/wrangler pages deploy\s+[^\-\s][^\s]*/.test(deploy)) {
    problems.push(
      "pages:deploy:preview passes a positional assets directory; drop it so wrangler.toml bindings and functions/ are applied.",
    );
  }

  return problems;
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).endsWith("check-pages-layout.ts");

if (isDirectRun) {
  const root = resolve(import.meta.dirname, "..");
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const problems = checkPagesLayout({
    pagesToml: readFileSync(resolve(root, "wrangler.toml"), "utf8"),
    functionCatchAll: readOrNull(resolve(root, "functions/api/[[path]].ts")),
    routesJson: readOrNull(resolve(root, "frontend/public/_routes.json")),
    deployScript: pkg.scripts?.["pages:deploy:preview"] ?? null,
  });

  if (problems.length) {
    console.error("check:pages FAILED — a Pages deploy would not serve /api:");
    for (const p of problems) console.error(` - ${p}`);
    process.exit(1);
  }
  console.log(
    "check:pages OK — wrangler.toml drives the deploy, functions/api/[[path]].ts and /api/* routing are in place.",
  );
}
