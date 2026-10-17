import JSZip from "jszip";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ExcelJS recognises unprefixed SpreadsheetML tags and r:id. Some valid
 * producers prefix those tags instead. Change namespace spelling, never values. */
export function normalizeSpreadsheetXml(xml: string, date1904 = false): string {
  const declarations = [
    ...xml.matchAll(/xmlns:([A-Za-z_][\w.-]*)\s*=\s*(["'])([^"']+)\2/g),
  ];
  for (const declaration of declarations) {
    const [, prefix, , uri] = declaration;
    const p = escaped(prefix!);
    if (uri === MAIN || uri === PACKAGE) {
      xml = xml.replace(new RegExp(`(<\\/?)${p}:`, "g"), "$1");
      // These formats require the root to remain in the original namespace.
      const root = xml.match(/<(?!!|\?)[^>]+>/)?.[0] ?? "";
      if (!/\sxmlns\s*=/.test(root))
        xml = xml.replace(declaration[0], `xmlns="${uri}"`);
    } else if (uri === OFFICE && prefix !== "r") {
      xml = xml.replace(
        new RegExp(`\\s${p}:([A-Za-z_][\\w.-]*)=`, "g"),
        " r:$1=",
      );
      if (!/xmlns:r\s*=/.test(xml))
        xml = xml.replace(declaration[0], `xmlns:r="${OFFICE}"`);
    }
  }
  // ISO-date cells are valid OOXML too, but ExcelJS otherwise reads only the
  // year as a number (2026 becomes a date in 1905). Preserve the actual instant.
  return xml.replace(
    /<c\b([^>]*\bt\s*=\s*(["'])d\2[^>]*)>([\s\S]*?)<\/c>/g,
    (cell, attributes: string, _quote: string, body: string) => {
      const value = body.match(/<v>([^<]+)<\/v>/)?.[1];
      if (!value) return cell;
      const instant = Date.parse(value);
      if (!Number.isFinite(instant))
        throw new Error(
          `An Excel date is invalid: ${value}. Correct it in the workbook.`,
        );
      const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
      const serial =
        (instant - epoch) / 86400000 +
        (!date1904 && instant >= Date.UTC(1900, 2, 1) ? 1 : 0);
      return `<c${attributes.replace(/\bt\s*=\s*(["'])d\1/, 't="n"')}>${body.replace(/<v>[^<]+<\/v>/, `<v>${serial}</v>`)}</c>`;
    },
  );
}

export async function compatibleXlsxBuffer(
  data: ArrayBuffer,
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(data);
  const workbook = zip.file("xl/workbook.xml");
  if (!workbook)
    throw new Error(
      "This file is not a readable .xlsx workbook. Open it in Excel and save as .xlsx.",
    );
  const root = await workbook.async("string");
  const date1904 = /\bdate1904\s*=\s*["'](?:1|true)["']/.test(root);
  let changed = false;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/(\.xml|\.rels)$/.test(entry.name)) continue;
    const before = await entry.async("string"),
      after = normalizeSpreadsheetXml(before, date1904);
    if (after !== before) {
      zip.file(entry.name, after);
      changed = true;
    }
  }
  return changed
    ? zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })
    : data;
}
