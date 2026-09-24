import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Ship scan reading with the app; never fetch government documents or OCR code from a CDN. */
export function offlineOcrAssets(): Plugin {
  const modules = path.resolve(__dirname, "../node_modules");
  const files = new Map<string, string>([
    ["worker.min.js", path.join(modules, "tesseract.js/dist/worker.min.js")],
    ["eng.traineddata.gz", path.join(modules, "@tesseract.js-data/eng/4.0.0/eng.traineddata.gz")],
  ]);
  for (const name of readdirSync(path.join(modules, "tesseract.js-core"))) {
    if (name.endsWith(".wasm.js")) files.set(name, path.join(modules, "tesseract.js-core", name));
  }
  return {
    name: "offline-checklist-reader",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = req.url?.split("?")[0]?.replace(/^\/ocr\//, "");
        const file = key && files.get(key);
        if (!req.url?.startsWith("/ocr/") || !file) return next();
        res.setHeader("Content-Type", key!.endsWith(".js") ? "application/javascript" : "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of files) this.emitFile({ type: "asset", fileName: `ocr/${name}`, source: readFileSync(file) });
    },
  };
}
