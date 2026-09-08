/**
 * Run the whole product on one local port with no Electron and no Cloudflare:
 * built UI + API + SQLite, served from http://127.0.0.1:43126.
 *
 * Usage: npm run app          (builds the UI first)
 *        APP_PORT=1234 npm run app
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const bundle = resolve(root, "desktop/dist/api-server.cjs");
const staticDir = resolve(root, "desktop/ui");
const port = process.env.APP_PORT ?? "43126";

if (!existsSync(bundle) || !existsSync(staticDir)) {
  console.error("Missing build output. Run: npm run app:build");
  process.exit(1);
}

const child = spawn(process.execPath, [bundle], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    API_PORT: port,
    API_HOST: process.env.API_HOST ?? "127.0.0.1",
    APP_STATIC_DIR: staticDir,
    APP_RESOURCE_DIR: root,
    APP_DATA_DIR: process.env.APP_DATA_DIR ?? resolve(root, ".data"),
  },
});

const stop = () => {
  if (!child.killed) child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
