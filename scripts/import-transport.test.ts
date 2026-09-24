import {describe, it, expect, vi} from "vitest";
import {postImportBatch, teacherImportBatchSize} from "../frontend/src/lib/importTransport";

describe("large staff workbook transport", () => {
  it("fits a district workbook into fewer than thirty local requests", () => {
    expect(Math.ceil(4500 / teacherImportBatchSize("local-sqlite"))).toBeLessThan(30);
    expect(teacherImportBatchSize("production")).toBe(6);
    expect(teacherImportBatchSize()).toBe(6);
  });
  it("respects the retry delay and sends the same batch after a rejection", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({retryAfterSec: 2}), {status:429})).mockResolvedValueOnce(new Response("{}", {status:200}));
    const wait = vi.fn().mockResolvedValue(undefined);
    const init = {method:"POST", body:"same batch"};
    expect((await postImportBatch("http://test.invalid", init, {fetch,wait})).status).toBe(200);
    expect(wait).toHaveBeenCalledWith(2100);
    expect(fetch).toHaveBeenNthCalledWith(2,"http://test.invalid",init);
  });
  it("does not retry a write failure that may already have changed data", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", {status:500}));
    const wait = vi.fn();
    expect((await postImportBatch("http://test.invalid", {}, {fetch,wait})).status).toBe(500);
    expect(fetch).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
  });
  it("stops after bounded retries", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response("{}", {status:429}));
    const wait = vi.fn();
    expect((await postImportBatch("http://test.invalid", {}, {fetch,wait})).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
