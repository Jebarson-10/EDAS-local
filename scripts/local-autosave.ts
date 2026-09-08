/**
 * Local filesystem autosave snapshots (no Cloudflare).
 * SQLite remains the live store; these JSON files are crash copies under .data/autosave/.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export type LocalAutosaveMeta = {
  savedAt: string;
  checksum: string;
  /** Checksum of the snapshot minus its volatile `metadata` envelope. */
  contentChecksum: string;
  bytes: number;
  path: string;
  relativePath: string;
  /** True when the snapshot already matched, so no new history slot was used. */
  unchanged?: boolean;
};

const KEEP = 12;
const RELATIVE = ".data/autosave/latest.json";

export function autosaveDir(dataDir: string): string {
  return join(dataDir, "autosave");
}

export function checksumOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * The canonical backup stamps `metadata.createdAt` on every assembly, so the
 * raw checksum always differs. Compare the rows instead.
 */
export function contentChecksumOf(payload: unknown): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const { metadata: _metadata, ...rows } = payload as Record<string, unknown>;
    return checksumOf(JSON.stringify(rows));
  }
  return checksumOf(JSON.stringify(payload));
}

function pruneHistory(dir: string): void {
  const snaps = readdirSync(dir)
    .filter((f) => f.startsWith("snap-") && f.endsWith(".json"))
    .sort();
  const drop = snaps.slice(0, Math.max(0, snaps.length - KEEP));
  for (const f of drop) unlinkSync(join(dir, f));
}

export function writeLocalAutosave(
  dataDir: string,
  payload: unknown,
): LocalAutosaveMeta {
  const dir = autosaveDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const savedAt = new Date().toISOString();
  const text = JSON.stringify(payload);
  const checksum = checksumOf(text);
  const contentChecksum = contentChecksumOf(payload);
  const bytes = Buffer.byteLength(text, "utf8");
  const latestPath = join(dir, "latest.json");

  // A page reload autosaves unchanged state; rotating the history for that
  // would evict real edits from the twelve kept snapshots.
  const previous = readLocalAutosaveMeta(dataDir);
  if (previous?.contentChecksum === contentChecksum && existsSync(latestPath)) {
    return { ...previous, unchanged: true };
  }

  writeFileSync(latestPath, text);
  // The checksum suffix keeps burst saves inside one millisecond from
  // overwriting each other's history slot.
  const stamp = savedAt.replace(/[:.]/g, "-");
  writeFileSync(join(dir, `snap-${stamp}-${checksum.slice(0, 8)}.json`), text);
  pruneHistory(dir);
  const meta: LocalAutosaveMeta = {
    savedAt,
    checksum,
    contentChecksum,
    bytes,
    path: latestPath,
    relativePath: RELATIVE,
  };
  writeFileSync(join(dir, "latest.meta.json"), JSON.stringify(meta, null, 2));
  return meta;
}

export function readLocalAutosaveMeta(
  dataDir: string,
): LocalAutosaveMeta | null {
  const metaPath = join(autosaveDir(dataDir), "latest.meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as LocalAutosaveMeta;
  } catch {
    return null;
  }
}
