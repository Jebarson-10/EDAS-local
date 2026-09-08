/**
 * DbClient over the Cloudflare D1 HTTP API (not workers.dev).
 * Used to run the same countMaster SQL as GET /api/health when the
 * workers.dev hostname is bot-challenged from this network.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { DbClient, DbStatement } from "../worker/src/db/client.ts";
import {
  extractEnvSection,
  hasReplaceMe,
  uncommentedD1DatabaseId,
} from "./wrangler-env.ts";

type QueryResult = {
  success?: boolean;
  results?: Array<Record<string, unknown>>;
  error?: string;
};

export function createD1HttpClient(opts: {
  accountId: string;
  databaseId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
}): DbClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/d1/database/${opts.databaseId}/query`;

  async function query(sql: string, params: unknown[]): Promise<QueryResult> {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    });
    const body = (await res.json()) as {
      success?: boolean;
      errors?: Array<{ message?: string }>;
      result?: QueryResult[];
    };
    if (!res.ok || body.success === false) {
      const detail = body.errors?.map((e) => e.message).join("; ") ?? res.statusText;
      throw new Error(`D1 HTTP ${res.status}: ${detail}`);
    }
    const first = body.result?.[0];
    if (!first) throw new Error("D1 HTTP returned no result frames");
    return first;
  }

  return {
    prepare(sql: string): DbStatement {
      let bound: unknown[] = [];
      const self: DbStatement = {
        bind(...params: unknown[]) {
          bound = params;
          return self;
        },
        async first<T>() {
          const frame = await query(sql, bound);
          return (frame.results?.[0] as T) ?? null;
        },
        async all<T>() {
          const frame = await query(sql, bound);
          return { results: (frame.results ?? []) as T[] };
        },
        async run() {
          await query(sql, bound);
          return { success: true };
        },
      };
      return self;
    },
    async batch(statements: DbStatement[]) {
      const out: unknown[] = [];
      for (const s of statements) {
        out.push(await s.run());
      }
      return out;
    },
    async exec(sql: string) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params: [] }),
      });
      const body = (await res.json()) as {
        success?: boolean;
        errors?: Array<{ message?: string }>;
        result?: Array<{ success?: boolean; error?: string }>;
      };
      if (!res.ok || body.success === false) {
        const detail =
          body.errors?.map((e) => e.message).join("; ") ?? res.statusText;
        throw new Error(`D1 HTTP ${res.status}: ${detail}`);
      }
      for (const frame of body.result ?? []) {
        if (frame.success === false) {
          throw new Error(
            `D1 HTTP statement failed: ${frame.error ?? "unknown"}`,
          );
        }
      }
    },
  };
}

export type D1HttpTarget = {
  accountId: string;
  databaseId: string;
  apiToken: string;
  source: "client-env" | "temporary";
};

/**
 * Client Pages D1 when CLOUDFLARE_* + a preview database_id are set.
 * Otherwise the 60-minute temporary Worker+D1 from staging:temporary.
 */
export function resolveD1HttpTarget(opts?: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  readFile?: (path: string) => string;
  temporaryAccountFile?: string;
}): D1HttpTarget {
  const env = opts?.env ?? process.env;
  const cwd = opts?.cwd ?? process.cwd();
  const read = opts?.readFile ?? ((p) => readFileSync(p, "utf8"));

  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  let databaseId = env.CF_D1_PREVIEW_ID?.trim();
  if (!databaseId) {
    try {
      const preview = extractEnvSection(read(join(cwd, "wrangler.toml")), "preview");
      const id = preview ? uncommentedD1DatabaseId(preview) : null;
      if (id && !hasReplaceMe(id)) databaseId = id;
    } catch {
      // wrangler.toml may be absent in unit tests
    }
  }
  if (token && accountId && databaseId) {
    return { accountId, databaseId, apiToken: token, source: "client-env" };
  }

  const acct = readTemporaryAccount(opts?.temporaryAccountFile);
  let tmpToml: string;
  try {
    tmpToml = read(join(cwd, ".data/wrangler.temporary.toml"));
  } catch {
    throw new Error(
      "No D1 target. Set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID + CF_D1_PREVIEW_ID (or fill [env.preview] database_id), or run npm run staging:temporary.",
    );
  }
  const tmpId = databaseIdFromWranglerToml(tmpToml);
  if (!tmpId) {
    throw new Error("temporary wrangler.toml has no database_id");
  }
  return {
    accountId: acct.accountId,
    databaseId: tmpId,
    apiToken: acct.apiToken,
    source: "temporary",
  };
}

export function canonicalBackupCandidates(cwd = process.cwd()): string[] {
  return [
    process.env.CANONICAL_BACKUP,
    join(cwd, ".data/uat-temporary-canonical.json"),
    join(cwd, "fixtures/staging-canonical-d1.json"),
    join(cwd, "fixtures/staging-canonical-d1.json.gz"),
    join(cwd, "fixtures/staging-canonical-d1.json.gz.b64"),
  ].filter((p): p is string => Boolean(p));
}

export function findCanonicalBackup(cwd = process.cwd()): string | null {
  for (const p of canonicalBackupCandidates(cwd)) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** JSON, gzip JSON, or gzip+base64 JSON (MCP-sized fixture on GitHub). */
export function readCanonicalBackupText(path: string): string {
  if (path.endsWith(".gz.b64")) {
    const b64 = readFileSync(path, "utf8").replace(/\s+/g, "");
    return gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
  }
  if (path.endsWith(".gz")) {
    return gunzipSync(readFileSync(path)).toString("utf8");
  }
  return readFileSync(path, "utf8");
}

export function readTemporaryAccount(
  file = join(homedir(), ".config/.wrangler/wrangler-temporary-account.toml"),
): { accountId: string; apiToken: string } {
  const text = readFileSync(file, "utf8");
  const accountId = text.match(/^id\s*=\s*"([^"]+)"/m)?.[1];
  const apiToken = text.match(/^apiToken\s*=\s*"([^"]+)"/m)?.[1];
  if (!accountId || !apiToken) {
    throw new Error("temporary account id or apiToken missing");
  }
  return { accountId, apiToken };
}

export function databaseIdFromWranglerToml(toml: string): string | null {
  return toml.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i)?.[1] ?? null;
}
