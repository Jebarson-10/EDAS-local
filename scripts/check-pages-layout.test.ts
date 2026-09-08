import { describe, expect, it } from "vitest";
import { checkPagesLayout } from "./check-pages-layout.ts";

const good = {
  pagesToml: 'name = "erode-exam-duty"\npages_build_output_dir = "frontend/dist"\n',
  functionCatchAll: 'export { onRequest } from "../../worker/src/index";\n',
  routesJson: '{ "version": 1, "include": ["/api/*"], "exclude": [] }',
  deployScript:
    "npm run pages:build && npx wrangler pages deploy --project-name erode-exam-duty --branch preview",
};

describe("checkPagesLayout", () => {
  it("passes on the shipped layout", () => {
    expect(checkPagesLayout(good)).toEqual([]);
  });

  it("rejects a positional assets directory that would bypass wrangler.toml", () => {
    const problems = checkPagesLayout({
      ...good,
      deployScript:
        "npm run pages:build && npx wrangler pages deploy frontend/dist --project-name erode-exam-duty",
    });
    expect(problems.join(" ")).toMatch(/positional assets directory/);
  });

  it("flags a missing api catch-all function", () => {
    const problems = checkPagesLayout({ ...good, functionCatchAll: null });
    expect(problems.join(" ")).toMatch(/functions\/api\/\[\[path\]\]\.ts is missing/);
  });

  it("flags routes that do not include /api/*", () => {
    const problems = checkPagesLayout({
      ...good,
      routesJson: '{ "version": 1, "include": ["/"], "exclude": [] }',
    });
    expect(problems.join(" ")).toMatch(/must include "\/api\/\*"/);
  });

  it("flags a missing pages_build_output_dir", () => {
    const problems = checkPagesLayout({ ...good, pagesToml: 'name = "x"\n' });
    expect(problems.join(" ")).toMatch(/pages_build_output_dir/);
  });
});
