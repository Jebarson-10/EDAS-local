/**
 * Fail CI when Worker and local API route surfaces drift from the inventory.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { API_ROUTES } from "../worker/src/apiRoutes.ts";

const root = resolve(import.meta.dirname, "..");
const surfaces = [
  { name: "worker", file: resolve(root, "worker/src/index.ts") },
  { name: "local-api", file: resolve(root, "scripts/local-api-server.ts") },
];

function assertRoutePresent(
  source: string,
  route: (typeof API_ROUTES)[number],
): boolean {
  if ("matchSnippet" in route && route.matchSnippet) {
    return source.includes(route.matchSnippet);
  }
  return (
    source.includes(`"${route.path}"`) || source.includes(`'${route.path}'`)
  );
}

let failed = false;
for (const surface of surfaces) {
  const src = readFileSync(surface.file, "utf8");
  const missing = API_ROUTES.filter((r) => !assertRoutePresent(src, r));
  if (missing.length) {
    failed = true;
    console.error(`\n[${surface.name}] missing routes in ${surface.file}:`);
    for (const m of missing) {
      console.error(`  - ${m.method} ${m.path}`);
    }
  } else {
    console.log(
      `[${surface.name}] OK — ${API_ROUTES.length} inventory routes present`,
    );
  }
}

if (failed) {
  console.error(
    "\nRoute parity check failed. Update worker/src/index.ts and scripts/local-api-server.ts together, then worker/src/apiRoutes.ts.",
  );
  process.exit(1);
}

console.log("\nRoute parity OK.");
