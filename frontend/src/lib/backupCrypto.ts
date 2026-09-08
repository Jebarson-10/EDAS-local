import { encryptJson, decryptJson } from "@exam-duty/shared";

/** Thin UI wrappers over shared passphrase AES-GCM (OQ-015). */
export async function encryptJsonBlob(
  payload: unknown,
  passphrase: string,
): Promise<Blob> {
  const bytes = await encryptJson(payload, passphrase);
  // Copy into a fresh ArrayBuffer-backed view for Blob typing.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: "application/octet-stream" });
}

export async function decryptJsonBuffer(
  buffer: ArrayBuffer,
  passphrase: string,
): Promise<unknown> {
  return decryptJson(buffer, passphrase);
}

export { encryptJsonBlob as encryptJson, decryptJsonBuffer as decryptJson };
