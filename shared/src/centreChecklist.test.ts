import { describe, expect, it } from "vitest";
import { parseCentreChecklist, schoolReferenceKey } from "./centreChecklist.js";

describe("official centre checklist", () => {
  it("keeps school strengths, continuing centres across pages", () => {
    const parsed = parseCentreChecklist([
      "SSLC - MARCH 2026 (CENTRE AND SCHOOL CHECK LIST REGULAR)\nCentre Code : 990001 Centre Name : SYNTHETIC SCHOOL\n990 990ABCD0001 SYNTHETIC SCHOOL 0 0 101",
      "SSLC - MARCH 2026\n990 990ABCD0002 SECOND SCHOOL 0 0 75",
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.standard).toBe("10");
    expect(parsed.rows.map(r => r.studentCount)).toEqual([101, 75]);
    expect(parsed.rows[1]?.centreCode).toBe("990001");
    expect(schoolReferenceKey("990ABCD0001")).toBe("ABCD0001");
  });
  it("does not invent unreadable counts or silently drop unreadable school rows", () => {
    const parsed = parseCentreChecklist(["Centre Code : 990001 Centre Name : SCHOOL\n990 990ABCD0001 SCHOOL 0 0 o7\n990 broken row"]);
    expect(parsed.rows[0]?.studentCount).toBeNull();
    expect(parsed.errors).toHaveLength(1);
  });
});
