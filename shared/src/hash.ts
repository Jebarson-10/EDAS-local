/** Stable FNV-1a style hash for snapshot reproducibility metadata. */
export function hashString(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** SHA-256 hex digest (Workers / Node 18+ via Web Crypto). */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const raw =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const bytes = new Uint8Array(raw);
  const dig = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(dig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
