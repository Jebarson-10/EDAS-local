/**
 * Resolve which D1 staging:raise should migrate, restore, and bind to Pages.
 * Cloudflare API calls stay in the caller so this module is unit-testable.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { previewD1FromTemporaryToml } from "./cloudflare-credentials.ts";
import { readTemporaryAccount } from "./d1-http-client.ts";
import { selectPreviewD1, type ListedD1 } from "./select-preview-d1.ts";

export type D1ListRow = { uuid?: string; id?: string; name: string };

export type EnsurePreviewD1Result = {
  name: string;
  id: string;
  created: boolean;
  fromTemporary: boolean;
};

export function temporaryD1ForAccount(
  accountId: string,
  dataDir: string,
  readAccount: typeof readTemporaryAccount = readTemporaryAccount,
): { name: string; id: string; accountId: string } | null {
  try {
    const acct = readAccount();
    if (acct.accountId !== accountId) return null;
    const tomlPath = join(dataDir, "wrangler.temporary.toml");
    if (!existsSync(tomlPath)) return null;
    const existing = previewD1FromTemporaryToml(readFileSync(tomlPath, "utf8"));
    if (!existing) return null;
    return { ...existing, accountId: acct.accountId };
  } catch {
    return null;
  }
}

function listedD1s(rows: D1ListRow[]): ListedD1[] {
  return rows
    .map((d) => {
      const id = d.uuid ?? d.id;
      return id ? { name: d.name, id } : null;
    })
    .filter((d): d is ListedD1 => d != null);
}

export async function ensurePreviewD1(input: {
  accountId: string;
  previewName: string;
  givenId?: string;
  dataDir: string;
  listDatabases: () => Promise<D1ListRow[]>;
  createDatabase: (name: string) => Promise<D1ListRow>;
  readAccount?: typeof readTemporaryAccount;
}): Promise<EnsurePreviewD1Result> {
  if (input.givenId) {
    return {
      name: input.previewName,
      id: input.givenId,
      created: false,
      fromTemporary: false,
    };
  }

  const listed = listedD1s(await input.listDatabases());
  const decision = selectPreviewD1({
    previewName: input.previewName,
    listed,
    accountId: input.accountId,
    temporary: temporaryD1ForAccount(
      input.accountId,
      input.dataDir,
      input.readAccount,
    ),
  });
  if (decision.action === "reuse") {
    return {
      name: decision.name,
      id: decision.id,
      created: false,
      fromTemporary: decision.reason === "temporary-same-account",
    };
  }

  const created = await input.createDatabase(decision.name);
  const id = created.uuid ?? created.id;
  if (!id) throw new Error("D1 create response missing uuid");
  return {
    name: created.name ?? decision.name,
    id,
    created: true,
    fromTemporary: false,
  };
}
