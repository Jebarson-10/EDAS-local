import { describe, expect, it } from "vitest";
import { normalizeSubject } from "./subjects.js";

describe("normalizeSubject", () => {
  it("treats underscore, hyphen and spaced aliases as the same subject", () => {
    expect(normalizeSubject("COMPUTER_SCIENCE").code).toBe("CS");
    expect(normalizeSubject("computer-science").code).toBe("CS");
    expect(normalizeSubject("Physics").code).toBe("PHY");
    expect(normalizeSubject("MATHEMATICS").code).toBe("MAT");
  });
});
