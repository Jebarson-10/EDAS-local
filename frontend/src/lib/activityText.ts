/** Plain display text only; the full saved audit record remains unchanged. */
export function activityAction(action: string): string {
  return ({ CREATE:"Added", UPDATE:"Updated", IMPORT:"Imported", EXPORT:"Downloaded", LOGIN:"App opened", PUBLISH:"Published", RESTORE:"Backup restored", GENERATE_ALLOCATION:"Duty list created", OVERRIDE:"Teacher replaced" } as Record<string,string>)[action] ?? action.replaceAll("_", " ").toLowerCase();
}

export function activityDescription(section: string | null, value?: string | null): string {
  const label = (section ?? "Saved change").replace(/^master_/, "").replaceAll("_", " ");
  if (value) {
    try {
      const data = JSON.parse(value) as Record<string, unknown>;
      const name = data.name ?? data.schoolName ?? data.blockName ?? data.centreName ?? data.filename;
      if (typeof name === "string") return `${label}: ${name}`;
    } catch { /* Older entries may not have structured details. */ }
  }
  return label;
}
