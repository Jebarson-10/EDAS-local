/**
 * Thin DB adapter so the same SQL repositories run on D1 (Workers) and
 * better-sqlite3 (local API).
 */
export interface DbStatement {
  bind(...params: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface DbClient {
  prepare(sql: string): DbStatement;
  /** Atomic multi-statement execution (D1 batch / local SQLite transaction). */
  batch?(statements: DbStatement[]): Promise<unknown[]>;
  exec?(sql: string): Promise<void>;
}

/** better-sqlite3 wrapper matching the D1-like interface. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSqliteClient(db: any): DbClient {
  const client: DbClient = {
    prepare(sql: string): DbStatement {
      const stmt = db.prepare(sql);
      let bound: unknown[] = [];
      const self: DbStatement = {
        bind(...params: unknown[]) {
          bound = params;
          return self;
        },
        async first<T>() {
          return (stmt.get(...bound) as T) ?? null;
        },
        async all<T>() {
          return { results: stmt.all(...bound) as T[] };
        },
        async run() {
          const info = stmt.run(...bound);
          return { success: true, meta: { changes: info.changes } };
        },
      };
      return self;
    },
    async batch(statements: DbStatement[]) {
      db.exec("BEGIN IMMEDIATE;");
      try {
        const out: unknown[] = [];
        for (const s of statements) {
          out.push(await s.run());
        }
        db.exec("COMMIT;");
        return out;
      } catch (e) {
        try {
          db.exec("ROLLBACK;");
        } catch {
          // ignore
        }
        throw e;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
    },
  };
  return client;
}

/**
 * Run statements atomically: prefer `batch` (D1 / sqlite wrapper), else BEGIN/COMMIT.
 */
export async function runAtomic(
  db: DbClient,
  statements: DbStatement[],
): Promise<void> {
  if (db.batch) {
    await db.batch(statements);
    return;
  }
  await db.exec?.("BEGIN IMMEDIATE;");
  try {
    for (const s of statements) {
      await s.run();
    }
    await db.exec?.("COMMIT;");
  } catch (e) {
    try {
      await db.exec?.("ROLLBACK;");
    } catch {
      // ignore
    }
    throw e;
  }
}
