/**
 * Offline backup preflight: checksum + schema/ref validation without calling restore.
 *
 * Usage:
 *   npm run verify:backup -- path/to/backup.json
 *   npm run verify:backup -- path/to/backup.json --expect-checksum <sha256>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256Hex, type BackupPayload } from "../shared/src/index.ts";
import { validateBackupPayload } from "../worker/src/db/repos.ts";

async function main() {
  const args = process.argv.slice(2);
  if (!args[0] || args[0] === "--help") {
    console.error(
      "Usage: npm run verify:backup -- <backup.json> [--expect-checksum <sha256>]",
    );
    process.exit(2);
  }
  const path = resolve(args[0]);
  let expect: string | undefined;
  const ei = args.indexOf("--expect-checksum");
  if (ei >= 0) expect = args[ei + 1];

  const text = readFileSync(path, "utf8");
  let payload: BackupPayload;
  try {
    payload = JSON.parse(text) as BackupPayload;
  } catch {
    console.error("VERIFY_FAIL parse: not valid JSON");
    process.exit(1);
  }

  const checksum = await sha256Hex(text);
  console.log("checksum", checksum);
  if (expect && expect !== checksum) {
    console.error("VERIFY_FAIL checksum mismatch", {
      expected: expect,
      actual: checksum,
    });
    process.exit(1);
  }

  const schema = validateBackupPayload(payload);
  if (!schema.ok) {
    console.error("VERIFY_FAIL schema", schema.error);
    process.exit(1);
  }

  console.log("VERIFY_OK", {
    path,
    teachers: payload.teachers?.length ?? 0,
    schools: payload.schools?.length ?? 0,
    centres: payload.centres?.length ?? 0,
    examCycles: payload.exam_cycles?.length ?? 0,
    ruleVersions: payload.rule_versions?.length ?? 0,
    sourceImports: payload.source_imports?.length ?? 0,
    sourceImportRows: payload.source_import_rows?.length ?? 0,
    exportRecords: payload.export_records?.length ?? 0,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
