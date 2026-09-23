import { describe, expect, it } from "vitest";
import { normalizeSubject, teachesSubject } from "./subjects.js";

describe("normalizeSubject", () => {
  it("treats underscore, hyphen and spaced aliases as the same subject", () => {
    expect(normalizeSubject("COMPUTER_SCIENCE").code).toBe("CS");
    expect(normalizeSubject("computer-science").code).toBe("CS");
    expect(normalizeSubject("Physics").code).toBe("PHY");
    expect(normalizeSubject("MATHEMATICS").code).toBe("MAT");
  });

  it("matches any separately listed official handling subject", () => {
    expect(teachesSubject("Maths, Statistics", "MATHEMATICS")).toBe(true);
    expect(teachesSubject("Computer Science / Computer Applications", "CS")).toBe(true);
    expect(teachesSubject("Physics", "Chemistry")).toBe(false);
  });
});
