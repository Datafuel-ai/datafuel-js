/** Leaks, injection and hangs. Every test here stands for a fixed bug. */

import { readFileSync } from "node:fs";
import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { Request, VERSION } from "../src/core.js";
import * as datafuel from "../src/index.js";
import { client, completed, Recorder, Router } from "./helpers.js";

describe("leaks", () => {
  it("keeps the body out of a printed Request", () => {
    const request = new Request(
      "POST",
      "/task",
      undefined,
      { attributes: { ai_api_key: "sk-secret", cookie_string: "session=abc" } },
      "k1",
    );
    for (const printed of [String(request), inspect(request), JSON.stringify(request)]) {
      expect(printed).not.toContain("sk-secret");
      expect(printed).not.toContain("session=abc");
      expect(printed).toContain("<Request POST /task>");
    }
  });

  it("does not follow redirects", async () => {
    // fetch keeps custom headers across a cross-host redirect, so X-API-Key
    // would follow the target. Redirects must stay off.
    const api = new Recorder(completed());
    await client(api).scrape("https://example.com");
    expect(api.requests[0]!.init.redirect).toBe("manual");
  });
});

describe("injection", () => {
  it("does not let an id walk out of its endpoint", async () => {
    const api = new Recorder(completed());
    await client(api).getTask("../users/@me");
    expect(api.requests[0]!.url.pathname).toBe("/api/v1/task/..%2Fusers%2F%40me");
  });

  it("keeps an id with a query string in the path", async () => {
    const api = new Router({ "GET /job/*": [{ status: "completed" }] });
    await client(api).getJob("job-1?admin=true");
    expect(api.requests[0]!.url.searchParams.get("admin")).toBeNull();
  });
});

describe("surprising answers", () => {
  it.each([[{}], [{ id: null }], ["not json at all"], [null], [[]]])(
    "turns %s into a DataFuelError",
    async (body) => {
      const api = new Recorder(
        new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 }),
      );
      await expect(client(api).createJob(["https://a.test"])).rejects.toBeInstanceOf(
        datafuel.DataFuelError,
      );
    },
  );

  it("rejects a balance that is not a number", async () => {
    const api = new Recorder({ balance: "plenty" });
    await expect(client(api).balance()).rejects.toThrow(/not a number/);
  });

  it("rejects a balance split without the pools", async () => {
    const api = new Recorder({ balance: 10 });
    await expect(client(api).balanceSplit()).rejects.toThrow(/no plan_balance field/);
  });

  it("rejects a garbage task body", async () => {
    const api = new Recorder(new Response(JSON.stringify(["not", "a", "task"]), { status: 200 }));
    await expect(client(api).scrape("https://example.com")).rejects.toThrow(/unexpected answer/);
  });
});

describe("hangs", () => {
  it("stops instead of looping on a repeated cursor", async () => {
    const api = new Router({
      "GET /crawl/*/results": [
        { pages: [{ ...completed(), url: "https://a.test" }], next_cursor: "same" },
      ],
    });
    const pages = client(api).crawlPages("crawl-1");
    await expect(
      (async () => {
        for await (const _page of pages) void _page;
      })(),
    ).rejects.toThrow(/repeated a crawl cursor/);
  });

  it("cannot busy-loop on a non-positive poll interval", () => {
    const api = new Recorder(completed());
    expect(client(api, { pollIntervalMs: 0 }).pollIntervalMs).toBe(2_000);
    expect(client(api, { pollIntervalMs: -5 }).pollIntervalMs).toBe(2_000);
  });

  it("does not retry an aborted request", async () => {
    let calls = 0;
    const aborting: typeof globalThis.fetch = () => {
      calls += 1;
      const error = new Error("aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    };
    const api = new Recorder(completed());
    await expect(
      client(api, { fetch: aborting }).scrape("https://example.com"),
    ).rejects.toBeInstanceOf(datafuel.TransportError);
    expect(calls).toBe(1);
  });
});

describe("misconfiguration", () => {
  it("requires an ai provider and nothing else", async () => {
    const api = new Recorder(completed());
    await expect(client(api).scrape("https://x.test", { ai: { prompt: "x" } })).rejects.toThrow(
      /provider/,
    );
    await expect(
      client(api).scrape("https://x.test", { ai: { prompt: "x", model: "gpt-4o", apiKey: "sk" } }),
    ).rejects.toThrow(/provider/);
    expect(api.requests).toHaveLength(0);
    await expect(
      client(api).scrape("https://x.test", { ai: { prompt: "x", provider: "openai" } }),
    ).resolves.toBeTruthy();
    await expect(
      client(api).scrape("https://x.test", {
        ai: { prompt: "x", provider: "openai", model: "gpt-4o", apiKey: "sk" },
      }),
    ).resolves.toBeTruthy();
  });

  it("keeps VERSION in step with package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});

describe("portability", () => {
  it("survives a runtime without process", async () => {
    // Bundled into a browser or a worker, `process` does not exist. Reading the
    // env var must not throw at construction.
    const original = globalThis.process;
    try {
      // @ts-expect-error deleting a global for the length of this test
      delete globalThis.process;
      const api = new Recorder(completed());
      const df = new datafuel.DataFuel({ apiKey: "df_key_test", fetch: api.fetch });
      await expect(df.scrape("https://example.com")).resolves.toMatchObject({ ok: true });
    } finally {
      globalThis.process = original;
    }
  });

  it("calls fetch unbound from the client", async () => {
    // A detached fetch throws "Illegal invocation" in browsers; the client must
    // never invoke it with itself as the receiver.
    const api = new Recorder(completed());
    const receivers: unknown[] = [];
    const probing = function (
      this: unknown,
      ...args: Parameters<typeof globalThis.fetch>
    ): Promise<Response> {
      receivers.push(this);
      return api.fetch(...args);
    };
    const df = new datafuel.DataFuel({ apiKey: "df_key_test", fetch: probing });
    await df.scrape("https://example.com");
    expect(receivers).toHaveLength(1);
    expect(receivers[0]).not.toBeInstanceOf(datafuel.DataFuel);
  });
});

describe("thin answers", () => {
  it("fills in crawl counters the caller reads unconditionally", async () => {
    const api = new Router({ "GET /crawl/*": [{ status: "completed" }] });
    const status = await client(api).getCrawl("crawl-1");
    expect(status.pages).toEqual({ discovered: 0, enqueued: 0, done: 0, failed: 0, skipped: 0 });
    expect(status.total_cost).toBe(0);
    expect(status.done).toBe(true);
  });

  it("fills in job counters", async () => {
    const api = new Router({ "GET /job/*": [{ status: "processing" }] });
    const status = await client(api).getJob("job-1");
    expect(status.tasks_count).toBe(0);
    expect(status.done).toBe(false);
  });
});
