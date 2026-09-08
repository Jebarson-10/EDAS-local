import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "./backupCrypto.js";

describe("backupCrypto (OQ-015)", () => {
  it("round-trips JSON with a passphrase", async () => {
    const payload = { teachers: [{ employeeCode: "SYN-1", name: "A" }], n: 1 };
    const sealed = await encryptJson(payload, "test-passphrase-strong");
    expect(sealed.byteLength).toBeGreaterThan(28);
    const opened = (await decryptJson(sealed, "test-passphrase-strong")) as {
      teachers: unknown[];
      n: number;
    };
    expect(opened.n).toBe(1);
    expect(opened.teachers).toHaveLength(1);
  });

  it("rejects empty passphrase and wrong passphrase", async () => {
    await expect(encryptJson({ a: 1 }, "  ")).rejects.toThrow(/Passphrase/);
    const sealed = await encryptJson({ a: 1 }, "correct-horse");
    await expect(decryptJson(sealed, "wrong-battery")).rejects.toThrow();
  });
});
