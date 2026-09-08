import { describe, expect, it } from "vitest";
import {
  pagesPreviewUatError,
  pagesPreviewUrlFromText,
  placeholderRoleMapError,
} from "./section-107-guards.ts";

describe("pagesPreviewUatError", () => {
  it("accepts a Pages preview hostname", () => {
    expect(
      pagesPreviewUatError("https://erode-exam-duty-preview.pages.dev"),
    ).toBeNull();
  });

  it("rejects workers.dev as Pages UAT", () => {
    expect(
      pagesPreviewUatError(
        "https://erode-exam-duty.peppermint-mint.workers.dev",
      ),
    ).toMatch(/not Cloudflare Pages staging UAT/);
  });

  it("rejects localhost", () => {
    expect(pagesPreviewUatError("http://127.0.0.1:43123")).toMatch(
      /\*\.pages\.dev/,
    );
  });
});

describe("pagesPreviewUrlFromText", () => {
  it("prefers a deployment host over the production project URL", () => {
    expect(
      pagesPreviewUrlFromText(`
Compiled Worker successfully
https://erode-exam-duty.pages.dev
https://abc123.erode-exam-duty.pages.dev
`),
    ).toBe("https://abc123.erode-exam-duty.pages.dev");
  });

  it("returns null when wrangler did not print a Pages URL", () => {
    expect(
      pagesPreviewUrlFromText("https://erode-exam-duty.season-driver.workers.dev"),
    ).toBeNull();
  });
});

describe("placeholderRoleMapError", () => {
  it("rejects the documentation sample map", () => {
    expect(
      placeholderRoleMapError(
        JSON.stringify({
          "ceo.erode@example.gov.in": "ADMIN",
          "officer1@example.gov.in": "OFFICER",
        }),
      ),
    ).toMatch(/placeholder domains/);
  });

  it("accepts a non-placeholder officer map", () => {
    expect(
      placeholderRoleMapError(
        JSON.stringify({ "ceo.erode@tn.gov.in": "ADMIN" }),
      ),
    ).toBeNull();
  });
});
