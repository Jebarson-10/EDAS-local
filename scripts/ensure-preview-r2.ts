/**
 * Resolve whether staging:raise should bind FILES.
 * Cloudflare API calls stay in the caller so this module is unit-testable.
 *
 * After Pages API succeeds we have a dashboard token. If that token can list
 * R2, reuse or create the preview bucket. If R2 is 403, leave FILES unbound
 * (honest stored:false). An explicit CF_R2_PREVIEW_BUCKET with 403 is an error.
 */
export type EnsurePreviewR2Result =
  | { bound: false; bucket: null; created: false; reason: "skipped" | "forbidden" }
  | { bound: true; bucket: string; created: boolean; reason: "reused" | "created" };

export const DEFAULT_PREVIEW_R2_BUCKET = "erode-exam-duty-files-preview";

export function isCloudflareForbidden(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Cloudflare API 403\b/.test(msg) || /\bHTTP 403\b/.test(msg);
}

export function previewR2BucketName(requested: string | undefined): string {
  const trimmed = requested?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_PREVIEW_R2_BUCKET;
}

export async function ensurePreviewR2(input: {
  requestedBucket?: string;
  skip?: boolean;
  listBuckets: () => Promise<{ name: string }[]>;
  createBucket: (name: string) => Promise<void>;
}): Promise<EnsurePreviewR2Result> {
  if (input.skip) {
    return { bound: false, bucket: null, created: false, reason: "skipped" };
  }

  const required = Boolean(input.requestedBucket?.trim());
  const bucket = previewR2BucketName(input.requestedBucket);

  let listed: { name: string }[];
  try {
    listed = await input.listBuckets();
  } catch (err) {
    if (isCloudflareForbidden(err)) {
      if (required) {
        throw new Error(
          `CF_R2_PREVIEW_BUCKET=${bucket} but R2 API returned 403. Add Account / Workers R2 Storage / Edit to the dashboard token, or unset the variable to leave FILES unbound (stored:false).`,
        );
      }
      return { bound: false, bucket: null, created: false, reason: "forbidden" };
    }
    throw err;
  }

  if (listed.some((row) => row.name === bucket)) {
    return { bound: true, bucket, created: false, reason: "reused" };
  }

  try {
    await input.createBucket(bucket);
  } catch (err) {
    if (isCloudflareForbidden(err) && !required) {
      return { bound: false, bucket: null, created: false, reason: "forbidden" };
    }
    throw err;
  }
  return { bound: true, bucket, created: true, reason: "created" };
}
