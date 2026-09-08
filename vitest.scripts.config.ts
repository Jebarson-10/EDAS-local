import { defineConfig } from "vitest/config";

// Script checks are executable integration tools rather than unit-test files.
// Keep this workspace hook green until a script-specific test is introduced.
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.test.ts"],
    passWithNoTests: true,
  },
});
