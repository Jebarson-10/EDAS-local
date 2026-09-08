#!/usr/bin/env node
/**
 * Reconstruct worker/src/db/repos.ts from gzip+base64 parts under
 * scripts/vendor/repos.ts.gz.b64.*. Used when GitHub MCP cannot upload
 * the 135KB source in one create_or_update_file call.
 *
 * Expected SHA-256 of the assembled UTF-8 source:
 * 60cce458deefe456a1ad0081e90a09c10e45292287c774c3d3036093759adb7f
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PART_DIR = join(ROOT, "scripts/vendor");
const OUT = join(ROOT, "worker/src/db/repos.ts");
const EXPECTED =
  "60cce458deefe456a1ad0081e90a09c10e45292287c774c3d3036093759adb7f";

const parts = existsSync(PART_DIR)
  ? readdirSync(PART_DIR)
      .filter((name) => name.startsWith("repos.ts.gz.b64."))
      .sort()
  : [];
if (parts.length === 0) {
  // This workspace already has worker/src/db/repos.ts. GitHub clones that
  // cannot upload the 135KB file keep gzip+base64 slices here instead.
  console.log(
    `assemble-repos: no parts in ${PART_DIR} (using checked-in repos.ts)`,
  );
  process.exit(0);
}
const b64 = parts
  .map((name) => readFileSync(join(PART_DIR, name), "utf8").replace(/\s+/g, ""))
  .join("");
const ts = gunzipSync(Buffer.from(b64, "base64"));
const sha = createHash("sha256").update(ts).digest("hex");
if (sha !== EXPECTED) {
  throw new Error(`assembled repos.ts sha256 ${sha} != ${EXPECTED}`);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, ts);
console.log(`assembled ${OUT} (${ts.length} bytes, sha256 ${sha})`);
