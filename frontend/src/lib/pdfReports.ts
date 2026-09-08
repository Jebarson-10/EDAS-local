import type { jsPDF } from "jspdf";

export interface PdfReportMeta {
  title: string;
  examCycle: string;
  ruleVersion: string;
  runId: string;
  officer: string;
  generatedAt: string;
}

export async function buildTeacherDutyPdf(
  meta: PdfReportMeta,
  rows: Array<{
    employeeCode: string;
    name: string;
    centre: string;
    date: string;
    session: string;
    role: string;
  }>,
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Erode Exam Duty Allotment", 40, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(meta.title, 40, 54);
  doc.text(`Cycle: ${meta.examCycle}`, 40, 70);
  doc.text(
    `Rule ${meta.ruleVersion} · Run ${meta.runId} · Officer ${meta.officer}`,
    40,
    86,
  );
  doc.text(`Generated: ${meta.generatedAt}`, 40, 102);
  doc.text(
    "For office printing / signing / archival — home coordinates omitted",
    40,
    118,
  );

  autoTable(doc as unknown as jsPDF, {
    startY: 130,
    head: [["Employee", "Name", "Centre", "Date", "Session", "Role"]],
    body: rows.map((r) => [
      r.employeeCode,
      r.name,
      r.centre,
      r.date,
      r.date,
      r.session,
      r.role,
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [27, 58, 75] },
  });

  return doc.output("blob");
}
