import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptDirectory);
const viteCli = join(root, "node_modules", "vite", "bin", "vite.js");

const result = spawnSync(
  process.execPath,
  [viteCli, "build", "--outDir", "../desktop/ui", "--emptyOutDir"],
  {
    cwd: join(root, "frontend"),
    env: { ...process.env, VITE_DESKTOP: "1" },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
