import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@exam-duty/shared": path.resolve(__dirname, "../shared/src/index.ts"),
      "@exam-duty/allocation-engine": path.resolve(
        __dirname,
        "../allocation-engine/src/index.ts",
      ),
      "@exam-duty/validator": path.resolve(__dirname, "../validator/src/index.ts"),
    },
  },
  server: {
    // Dual-stack (::) so 127.0.0.1 and [::1]/localhost both reach the preview.
    host: "::",
    port: 43123,
    strictPort: true,
    // Cursor / cloud preview proxies send a Host that is not localhost.
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:43124",
        changeOrigin: true,
      },
    },
  },
  worker: {
    format: "es",
  },
});
