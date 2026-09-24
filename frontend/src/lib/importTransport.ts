/** Retry only a rate-limit rejection: this response has not written the batch. */
export async function postImportBatch(url: string, init: RequestInit, dependencies = {
  fetch: globalThis.fetch.bind(globalThis),
  wait: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
}) {
  for (let attempt = 0; ; attempt++) {
    const response = await dependencies.fetch(url, init);
    if (response.status !== 429 || attempt >= 3) return response;
    const body = await response.clone().json().catch(() => ({})) as {retryAfterSec?: number};
    const seconds = Number(body.retryAfterSec ?? response.headers.get("retry-after") ?? 1);
    await dependencies.wait((Number.isFinite(seconds) ? Math.min(60, Math.max(1, seconds)) : 1) * 1000 + 100);
  }
}

export function teacherImportBatchSize(environment?: string) {
  // SQLite is not subject to the hosted database's per-request query quota.
  return environment === "local-sqlite" ? 250 : 6;
}
