import { describe, expect, it } from "vitest";
import {
  emptyExamWorkspace,
  type ExamWorkspace,
  type WorkspaceStaff,
} from "@exam-duty/shared";
import { allocateWorkspace } from "./workspace.js";

export function exampleWorkspace(standard: "10" | "12" = "12"): ExamWorkspace {
  const w = emptyExamWorkspace("example", "Synthetic exam");
  w.settings = {
    ...w.settings,
    confirmed: true,
    custodianPost12: "DEO",
    practical10SameRules: true,
    retainHistory: false,
  };
  w.schools = ["source", "centre", "point"].map((udise, i) => ({
    udise,
    name: `Synthetic ${udise}`,
    block: `Block ${i}`,
    educationalDistrict: "District A",
    level: standard === "12" ? "HIGHER_SECONDARY" : "HIGH",
    management: "GOVERNMENT",
    latitude: 11.3 + i * 0.003,
    longitude: 77.7,
    raw: {},
  }));
  w.centres = [
    { standard, code: "100", udise: "centre", students: 200, clubbedUdise: [] },
  ];
  w.timetable = ["2027-03-01", "2027-03-02"].map((date) => ({
    standard,
    date,
    session: "MORNING",
    subject: "MAT",
    centreCode: "",
  }));
  w.points = [
    {
      standard,
      id: "p",
      kind: "CUSTODIAN",
      name: "Point",
      udise: "point",
      centreCodes: ["100"],
    },
  ];
  const teacher = (staffId: string, post: string, i = 0): WorkspaceStaff => ({
    staffId,
    post,
    originalPost: post,
    name: `Synthetic ${staffId}`,
    udise: "source",
    category: ["JA", "OA", "RC"].includes(post) ? "NON_TEACHING" : "TEACHING",
    appointedSubject: "PHY",
    handlingSubjects: ["PHY"],
    standards: [standard],
    serviceDate: "2000-01-01",
    postDate: `${2001 + (i % 20)}-01-01`,
    raw: {},
  });
  w.staff = [
    teacher("deo", "DEO"),
    teacher("hm1", standard === "12" ? "HM_HSS" : "HM_HS"),
    teacher("hm2", standard === "12" ? "HM_HSS" : "HM_HS"),
    teacher("ja", "JA"),
    teacher("oa", "OA"),
    teacher("rc", "RC"),
    ...Array.from({ length: 70 }, (_, i) =>
      teacher(`assistant${i}`, standard === "12" ? "PG" : "BT", i),
    ),
  ];
  return w;
}
describe("new standard-specific theory rules", () => {
  it("rejects a separate SSLC Physics practical paper instead of assigning Science teachers to it", () => {
    const w = exampleWorkspace("10");
    w.practical = [{ id: "wrong-paper", standard: "10", udise: "source", subject: "PHY", students: 30,
      cohort: "A", centreUdise: "source", allowedCentreUdise: [], halls: 1, dates: ["2027-03-01"] }];
    const run = allocateWorkspace(w, "10", "PRACTICAL", "paper-check");
    expect(run.assignments).toEqual([]);
    expect(run.errors.some((e) => e.includes("one Science practical paper"))).toBe(true);
  });
  it.each([9, 10, 10.001])(
    "enforces the inclusive 10 km boundary at %s km",
    (distance) => {
      const w = exampleWorkspace();
      // Along a meridian: angular distance is distance / Earth's radius.
      // Both destinations are placed at the same known distance from staff.
      const latitude =
        w.schools[0]!.latitude! + ((distance / 6371) * 180) / Math.PI;
      w.schools[1]!.latitude = latitude;
      w.schools[2]!.latitude = latitude;
      const run = allocateWorkspace(w, "12", "THEORY", "radius-boundary");
      expect(run.errors).toEqual([]);
      if (distance <= 10) {
        expect(run.shortages).toEqual([]);
        expect(run.assignments.length).toBeGreaterThan(0);
      } else {
        expect(run.assignments).toEqual([]);
        expect(
          run.shortages.some((s) => (s.reasons["Beyond 10 km"] ?? 0) > 0),
        ).toBe(true);
      }
    },
  );
  it("uses 10 km across blocks, fixed chief, 12 halls and 3 backup staff for 200 students", () => {
    const w = exampleWorkspace();
    const r = allocateWorkspace(w, "12", "THEORY", "seed");
    expect(r.errors).toEqual([]);
    expect(r.shortages).toEqual([]);
    for (const date of ["2027-03-01", "2027-03-02"]) {
      const duties = r.assignments.filter((a) => a.date === date);
      expect(duties.filter((a) => a.role === "INVIGILATOR")).toHaveLength(12);
      expect(duties.filter((a) => a.role === "BACKUP")).toHaveLength(3);
      expect(duties.filter((a) => a.role === "SQUAD")).toHaveLength(2);
    }
    expect(
      new Set(
        r.assignments.filter((a) => a.role === "CHIEF").map((a) => a.staffId),
      ).size,
    ).toBe(1);
    expect(allocateWorkspace(w, "12", "THEORY", "seed")).toEqual(r);
  });
  it("requires two departmental officers only above 500", () => {
    for (const [students, count] of [
      [500, 1],
      [501, 2],
    ]) {
      const w = exampleWorkspace();
      w.centres[0]!.students = students!;
      const r = allocateWorkspace(w, "12", "THEORY", "seed");
      expect(
        r.assignments.filter(
          (a) => a.role === "DEPARTMENT" && a.date === "2027-03-01",
        ),
      ).toHaveLength(count!);
    }
  });
  it("uses senior assistants as chief fallback and RC only for the OA slot", () => {
    const w = exampleWorkspace();
    w.staff = w.staff.filter((t) => !["hm2", "oa"].includes(t.staffId));
    const r = allocateWorkspace(w, "12", "THEORY", "seed");
    expect(r.assignments.find((a) => a.role === "CHIEF")?.fallback).toBe(true);
    expect(
      r.assignments.find((a) => a.role === "OFFICE_ASSISTANT")?.staffId,
    ).toBe("rc");
    expect(
      r.assignments.find((a) => a.role === "JUNIOR_ASSISTANT")?.staffId,
    ).toBe("ja");
  });
  it("never substitutes teaching staff for missing Junior Assistants", () => {
    const w = exampleWorkspace();
    w.staff = w.staff.filter((t) => t.post !== "JA");
    const r = allocateWorkspace(w, "12", "THEORY", "seed");
    expect(r.shortages.some((s) => s.role === "JUNIOR_ASSISTANT")).toBe(true);
    expect(r.assignments.some((a) => a.role === "JUNIOR_ASSISTANT")).toBe(
      false,
    );
  });
  it("blocks distant / missing coordinates, own-centre HMs and previous destinations", () => {
    const w = exampleWorkspace();
    w.schools[0]!.latitude = 12;
    let r = allocateWorkspace(w, "12", "THEORY", "seed");
    expect(r.assignments).toEqual([]);
    expect(r.shortages[0]!.reasons["Beyond 10 km"]).toBeGreaterThan(0);
    w.schools[0]!.latitude = null;
    r = allocateWorkspace(w, "12", "THEORY", "seed");
    expect(r.shortages[0]!.reasons["Coordinates missing"]).toBeGreaterThan(0);
    w.schools[0]!.latitude = 11.3;
    w.history = [
      {
        staffId: "hm2",
        centreUdise: "centre",
        date: "2026-03-01",
        role: "CHIEF",
      },
    ];
    w.centres[0]!.clubbedUdise = ["source"];
    r = allocateWorkspace(w, "12", "THEORY", "seed");
    expect(
      r.assignments
        .filter((a) => a.role === "CHIEF")
        .every((a) => a.staffId.startsWith("assistant")),
    ).toBe(true);
  });
  it("allows Tamil/English exceptions but excludes other examined subjects from active and backup duty", () => {
    const w = exampleWorkspace();
    w.timetable[0]!.subject = "PHY";
    let r = allocateWorkspace(w, "12", "THEORY", "seed");
    expect(
      r.assignments.filter(
        (a) =>
          a.date === "2027-03-01" && ["INVIGILATOR", "BACKUP"].includes(a.role),
      ),
    ).toEqual([]);
    w.staff
      .filter((t) => t.post === "PG")
      .forEach((t) => {
        t.appointedSubject = "ENG";
        t.handlingSubjects = ["ENG"];
      });
    w.timetable[0]!.subject = "ENG";
    r = allocateWorkspace(w, "12", "THEORY", "seed");
    expect(
      r.assignments.filter(
        (a) =>
          a.date === "2027-03-01" && ["INVIGILATOR", "BACKUP"].includes(a.role),
      ),
    ).toHaveLength(15);
  });
  it("10th uses HS HMs and BT only, with no DEO", () => {
    const w = exampleWorkspace("10");
    const r = allocateWorkspace(w, "10", "THEORY", "seed");
    expect(r.shortages).toEqual([]);
    expect(r.assignments.some((a) => a.staffId === "deo")).toBe(false);
    expect(
      r.assignments
        .filter((a) =>
          [
            "DEPARTMENT",
            "SQUAD",
            "INVIGILATOR",
            "BACKUP",
            "SECONDARY_CUSTODIAN",
          ].includes(a.role),
        )
        .every(
          (a) => w.staff.find((t) => t.staffId === a.staffId)?.post === "BT",
        ),
    ).toBe(true);
  });
  it("squad remains in its educational district and routes cannot leave their point", () => {
    const w = exampleWorkspace();
    w.schools[0]!.educationalDistrict = "Other";
    let r = allocateWorkspace(w, "12", "THEORY", "seed");
    expect(r.shortages.some((s) => s.role === "SQUAD")).toBe(true);
    w.routes = [
      { id: "r", standard: "12", pointId: "p", centreCodes: ["wrong"] },
    ];
    r = allocateWorkspace(w, "12", "THEORY", "seed");
    expect(r.errors.some((e) => e.includes("belonging"))).toBe(true);
  });
});
describe("new practical rules", () => {
  function practical() {
    const w = exampleWorkspace();
    w.staff.push({
      ...w.staff[6]!,
      staffId: "internal",
      name: "Synthetic internal",
      udise: "centre",
    });
    w.practical = [
      {
        id: "phy",
        standard: "12",
        udise: "centre",
        subject: "PHY",
        students: 60,
        cohort: "A",
        centreUdise: "centre",
        allowedCentreUdise: [],
        halls: 1,
        dates: ["2027-03-05", "2027-03-06"],
      },
    ];
    return w;
  }
  it("uses 30-student batches and a local internal with a government external for private centres", () => {
    const w = practical();
    w.schools[1]!.management = "PRIVATE";
    const r = allocateWorkspace(w, "12", "PRACTICAL", "seed");
    expect(r.errors).toEqual([]);
    expect(r.shortages).toEqual([]);
    expect(
      r.assignments.filter((a) => a.role === "EXTERNAL").map((a) => a.students),
    ).toEqual([30, 30]);
    expect(
      r.assignments
        .filter((a) => a.role === "INTERNAL")
        .every((a) => a.staffId === "internal"),
    ).toBe(true);
  });
  it("keeps private-school externals and teachers required as internals out", () => {
    const w = practical();
    w.schools[1]!.management = "PRIVATE";
    w.schools[0]!.management = "PRIVATE";
    const r = allocateWorkspace(w, "12", "PRACTICAL", "seed");
    expect(r.assignments).toEqual([]);
    expect(
      r.shortages[0]!.reasons[
        "Private centre needs Government / aided external"
      ],
    ).toBeGreaterThan(0);
  });
  it("does not give one student group two practicals on the same day", () => {
    const w = practical();
    const che = {
      ...w.staff.at(-1)!,
      staffId: "internal-che",
      appointedSubject: "CHE",
      handlingSubjects: ["CHE"],
    };
    w.staff.push(che, {
      ...w.staff[6]!,
      staffId: "external-che",
      appointedSubject: "CHE",
      handlingSubjects: ["CHE"],
    });
    w.practical.push({ ...w.practical[0]!, id: "che", subject: "CHE" });
    const r = allocateWorkspace(w, "12", "PRACTICAL", "seed");
    expect(r.shortages).toEqual([]);
    for (const batch of [1, 2])
      expect(
        new Set(
          r.assignments
            .filter((a) => a.batch === batch && a.role === "EXTERNAL")
            .map((a) => a.date),
        ).size,
      ).toBe(2);
  });
  it("requires manual clubbing below 15 and genuine Science handling for 10th", () => {
    const w = practical();
    w.practical[0]!.students = 14;
    expect(allocateWorkspace(w, "12", "PRACTICAL", "seed").errors[0]).toContain(
      "fewer than 15",
    );
    const ten = exampleWorkspace("10");
    ten.practical = [
      { ...w.practical[0]!, standard: "10", subject: "SCI", students: 30 },
    ];
    const r = allocateWorkspace(ten, "10", "PRACTICAL", "seed");
    expect(r.assignments).toEqual([]);
    expect(r.shortages.length).toBe(1);
  });
});
