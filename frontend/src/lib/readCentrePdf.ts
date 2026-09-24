import { parseCentreChecklist } from "@exam-duty/shared";

export async function readCentrePdf(file: File, progress: (message: string) => void) {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  let ocr: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | undefined;
  const pages: string[] = [];
  let scanned = false;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      progress(`Reading page ${n} of ${doc.numPages}…`);
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is import("pdfjs-dist/types/src/display/api").TextItem => "str" in item);
      // Text objects are not necessarily returned in reading order.
      const lines = new Map<number, typeof items>();
      for (const item of items) {
        const y = Math.round(item.transform[5] / 3) * 3;
        const line = lines.get(y) ?? []; line.push(item); lines.set(y, line);
      }
      let text = [...lines.entries()].sort(([a],[b]) => b-a).map(([,line]) => line.sort((a,b) => a.transform[4]-b.transform[4]).map(i => i.str).join(" ")).join("\n");
      if (text.trim().length < 80) {
        scanned = true;
        if (!ocr) {
          progress("Preparing the scan reader. The file stays on this device…");
          const { createWorker, PSM } = await import("tesseract.js");
          const base = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.origin).href;
          ocr = await createWorker("eng", 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base, cacheMethod: "none" });
          await ocr.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
        }
        progress(`Reading scanned page ${n} of ${doc.numPages}…`);
        const viewport = page.getViewport({scale:2.5});
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
        text = (await ocr.recognize(canvas)).data.text;
        canvas.width = 0; canvas.height = 0;
      }
      pages.push(text); page.cleanup();
    }
    return { ...parseCentreChecklist(pages), pages, scanned };
  } finally { await ocr?.terminate(); await doc.destroy(); }
}
