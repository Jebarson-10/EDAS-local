import { describe, expect, it } from "vitest";
import {
  pagesPreviewUatError,
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
