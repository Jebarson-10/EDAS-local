/**
 * Choose which D1 staging:raise should bind to Pages preview.
 *
 * A claimed temporary account often has exactly one database named
 * `erode-exam-duty` (already restored). Creating `erode-exam-duty-preview`
 * fails on the one-D1 limit. When the operator pastes a dashboard token,
 * credentials look like `client-env` — still reuse that D1 if it belongs
 * to the same account as the cached temporary toml.
 *
 * A separate client org with no matching toml gets a new preview D1.
 */

export type ListedD1 = { name: string; id: string };

export type PreviewD1Decision =
  | { action: "reuse"; name: string; id: string; reason: string }
  | { action: "create"; name: string; reason: string };

export function selectPreviewD1(input: {
  previewName: string;
  givenId?: string;
  listed: ListedD1[];
  accountId: string;
  temporary?: { name: string; id: string; accountId: string } | null;
}): PreviewD1Decision {
  if (input.givenId) {
    return {
      action: "reuse",
      name: input.previewName,
      id: input.givenId,
      reason: "CF_D1_PREVIEW_ID",
    };
  }

  const byName = (name: string) => input.listed.find((d) => d.name === name);
  const preview = byName(input.previewName);
  if (preview) {
    return {
      action: "reuse",
      name: preview.name,
      id: preview.id,
      reason: "listed-preview-name",
    };
  }

  const tmp = input.temporary;
  if (tmp && tmp.accountId === input.accountId) {
    const live =
      input.listed.find((d) => d.id === tmp.id) ?? byName(tmp.name);
    if (live) {
      return {
        action: "reuse",
        name: live.name,
        id: live.id,
        reason: "temporary-same-account",
      };
    }
  }

  return {
    action: "create",
    name: input.previewName,
    reason: "no-matching-d1",
  };
}
