/** Retries, idempotency keys, and the 202 "still processing" answer. */

import { describe, expect, it } from "vitest";

import { backoff, pollDelay } from "../src/core.js";
import * as datafuel from "../src/index.js";
import { client, completed, errorResponse, Recorder } from "./helpers.js";

const stillProcessing = () =>
  new Response(JSON.stringify({ code: "TASK_STILL_PROCESSING", message: "wait" }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });

describe("idempotency", () => {
  it("gives every write a key, and never the same one twice", async () => {
    const api = new Recorder(completed());
    const df = client(api);
    await df.scrape("https://a.test");
    await df.scrape("https://b.test");
    const keys = api.keys();
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("sends no key on reads", async () => {
    const api = new Recorder({ balance: 10 });
    await client(api).balance();
    expect(api.keys()).toEqual([undefined]);
  });

  it("uses an explicit key as given", async () => {
    const api = new Recorder(completed());
    await client(api).scrape("https://example.com", { idempotencyKey: "mine-1" });
    expect(api.keys()).toEqual(["mine-1"]);
  });

  it("refuses an over-long key before the request", async () => {
    const api = new Recorder(completed());
    await expect(
      client(api).scrape("https://example.com", { idempotencyKey: "x".repeat(256) }),
    ).rejects.toThrow(/255/);
    expect(api.requests).toHaveLength(0);
  });
});

describe("retries", () => {
  it("reuses the idempotency key", async () => {
    const api = new Recorder(
      new Response(JSON.stringify({ code: "RATE_LIMIT_EXCEEDED" }), {
        status: 429,
        headers: { "Retry-After": "1" },
      }),
      completed(),
    );
    await client(api).scrape("https://example.com");
    expect(api.requests).toHaveLength(2);
    expect(api.keys()[0]).toBe(api.keys()[1]);
  });

  it("does not retry client errors", async () => {
    const api = new Recorder(errorResponse(402, "INSUFFICIENT_CREDITS"), completed());
    await expect(client(api).scrape("https://example.com")).rejects.toBeInstanceOf(
      datafuel.InsufficientCredits,
    );
    expect(api.requests).toHaveLength(1);
  });

  it("does not retry a switched-off engine", async () => {
    const api = new Recorder(
      errorResponse(503, "ENGINE_UNAVAILABLE", "provider outage"),
      completed(),
    );
    await expect(client(api).ask("hi", { engine: "copilot" })).rejects.toBeInstanceOf(
      datafuel.EngineUnavailable,
    );
    expect(api.requests).toHaveLength(1);
  });

  it("retries transport errors", async () => {
    let calls = 0;
    const api = new Recorder(completed());
    const flaky: typeof globalThis.fetch = (input, init) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("ECONNRESET"));
      return api.fetch(input, init);
    };
    const df = client(api, { fetch: flaky });
    await expect(df.scrape("https://example.com")).resolves.toMatchObject({ ok: true });
    expect(calls).toBe(2);
  });

  it("keeps backoff positive and bounded", () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const delay = backoff(attempt);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(8_000);
    }
    expect(backoff(0, 120)).toBe(30_000);
    expect(pollDelay(0)).toBeGreaterThanOrEqual(2_000);
  });
});

describe("the 202 answer", () => {
  it("re-sends the identical request under the identical key", async () => {
    const api = new Recorder(stillProcessing(), completed());
    const res = await client(api).scrape("https://example.com");
    expect(res.ok).toBe(true);
    expect(api.requests).toHaveLength(2);
    expect(api.keys()[0]).toBe(api.keys()[1]);
    expect(api.bodies()[0]).toEqual(api.bodies()[1]);
  });

  it("times out with the key when the task never finishes", async () => {
    const api = new Recorder(stillProcessing());
    const error = await client(api)
      .scrape("https://example.com", { timeoutMs: 1 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(datafuel.WaitTimeout);
    expect((error as datafuel.WaitTimeout).id).toBe(api.keys()[0]);
  });

  it("reports a running task as pending from getTask", async () => {
    const api = new Recorder(stillProcessing());
    const res = await client(api).getTask("task-9");
    expect(res.pending).toBe(true);
    expect(res.id).toBe("task-9");
  });
});
