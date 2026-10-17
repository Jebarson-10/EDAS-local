import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { compatibleXlsxBuffer } from "./xlsxCompatibility.js";

describe("valid prefixed XLSX imports", () => {
  it("reads namespace-prefixed workbooks without changing names, identifiers, counts or dates", async () => {
    const original = new ExcelJS.Workbook(),
      sheet = original.addWorksheet("Timetable");
    sheet.addRow(["UDISE", "Name", "Students", "Date"]);
    sheet.addRow([
      "00123456789",
      "Synthetic & School",
      34,
      new Date("2026-10-19T00:00:00Z"),
    ]);
    sheet.getCell("D2").numFmt = "dd/mm/yyyy";
    const zip = await JSZip.loadAsync(await original.xlsx.writeBuffer());
    for (const name of [
      "xl/workbook.xml",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]) {
      let xml = await zip.file(name)!.async("string");
      if (name === "xl/worksheets/sheet1.xml")
        xml = xml.replace(
          /<c\b([^>]*r="D2"[^>]*)><v>[^<]+<\/v><\/c>/,
          '<c$1 t="d"><v>2026-10-19T00:00:00.000Z</v></c>',
        );
      xml = xml
        .replace(
          'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
          'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        )
        .replace(/(<\/?)([A-Za-z_][\w.-]*)(?=[\s/>])/g, "$1x:$2");
      zip.file(name, xml);
    }
    const data = await zip.generateAsync({ type: "arraybuffer" });
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(await compatibleXlsxBuffer(data));
    expect(read.worksheets[0]!.name).toBe("Timetable");
    expect(read.worksheets[0]!.getCell("A2").value).toBe("00123456789");
    expect(read.worksheets[0]!.getCell("B2").value).toBe("Synthetic & School");
    expect(read.worksheets[0]!.getCell("C2").value).toBe(34);
    expect(
      (read.worksheets[0]!.getCell("D2").value as Date).toISOString(),
    ).toBe("2026-10-19T00:00:00.000Z");
  });
  it("reports a non-workbook ZIP in plain language", async () => {
    const z = new JSZip();
    z.file("note.txt", "Not a workbook");
    await expect(
      compatibleXlsxBuffer(await z.generateAsync({ type: "arraybuffer" })),
    ).rejects.toThrow("not a readable .xlsx");
  });
});
