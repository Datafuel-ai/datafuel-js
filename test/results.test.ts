/** Reading a Result: state, helpers, and what they refuse to do. */

import { describe, expect, it } from "vitest";

import * as datafuel from "../src/index.js";
import { isDone, Result } from "../src/models.js";
import { client, completed, Recorder } from "./helpers.js";

describe("Result", () => {
  it("decodes a screenshot", async () => {
    const api = new Recorder(completed(Buffer.from("PNGDATA").toString("base64")));
    const res = await client(api).scrape("https://example.com");
    expect(Buffer.from(res.image).toString()).toBe("PNGDATA");
    expect(res.pending).toBe(false);
  });

  it("refuses to decode a page into noise", async () => {
    const api = new Recorder(completed("<html>not a screenshot</html>"));
    const res = await client(api).scrape("https://example.com");
    expect(() => res.image).toThrow(/not a png or jpeg/);
  });

  it("exposes structured data as text and data", () => {
    const structured = new Result(completed({ a: 1 }));
    expect(structured.data).toEqual({ a: 1 });
    expect(structured.text).toBe('{"a":1}');
    expect(structured.requireData()).toEqual({ a: 1 });
  });

  it("treats a running stub as pending", () => {
    const stub = new Result({ result: { status: "pending" } });
    expect(stub.pending).toBe(true);
    expect(stub.ok).toBe(false);
    expect(() => stub.requireData()).toThrow(datafuel.DataFuelError);
  });

  it.each([
    ["completed", true],
    ["completed_with_errors", true],
    ["failed", true],
    ["cancelled", true],
    ["processing", false],
    ["pending", false],
    ["something_new", false],
  ])("treats %s as terminal=%s", (status, done) => {
    expect(isDone(status)).toBe(done);
  });
});
