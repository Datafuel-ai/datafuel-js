/** The long-running endpoints: map, jobs, crawls, and the account reads. */

import { describe, expect, it } from "vitest";

import * as datafuel from "../src/index.js";
import { client, completed, Router } from "./helpers.js";

describe("map", () => {
  it("decodes links", async () => {
    const api = new Router({
      "POST /map": [
        completed({
          url: "https://example.com",
          links: [{ url: "https://example.com/blog", source: "sitemap" }],
          total: 1,
          credits: 1,
        }),
      ],
    });
    const site = await client(api).map("https://example.com", { search: "blog", limit: 500 });
    expect(api.body.type).toBe("map");
    expect(api.body.attributes).toEqual({
      url: "https://example.com",
      search: "blog",
      limit: 500,
    });
    expect(site.links.map((link) => link.url)).toEqual(["https://example.com/blog"]);
    expect(site.task.id).toBe("task-1");
  });
});

describe("jobs", () => {
  it("polls until done and returns every task", async () => {
    const api = new Router({
      "POST /job": [{ id: "job-1" }],
      "GET /job/*/results": [
        {
          tasks_count: 2,
          tasks_complete: 1,
          tasks_failed: 1,
          tasks_result: [completed(), { status: "failed", error: "timeout" }],
        },
      ],
      "GET /job/*": [
        { status: "processing", tasks_count: 2, tasks_done: 1 },
        { status: "completed", tasks_count: 2, tasks_done: 2, total_cost: 2 },
      ],
    });
    const results = await client(api).runJob(["https://a.test", "https://b.test"]);
    expect(results.id).toBe("job-1");
    expect(results.tasks_count).toBe(2);
    expect(results.tasks[0]!.ok).toBe(true);
    expect(results.tasks[1]!.ok).toBe(false);
    expect(() => results.tasks[1]!.raiseForStatus()).toThrow(datafuel.TaskFailed);
  });

  it("keeps the id when the wait times out", async () => {
    const api = new Router({
      "POST /job": [{ id: "job-1" }],
      "GET /job/*": [{ status: "processing" }],
    });
    const error = await client(api)
      .runJob(["https://a.test"], { timeoutMs: 1 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(datafuel.WaitTimeout);
    expect((error as datafuel.WaitTimeout).id).toBe("job-1");
  });
});

describe("crawls", () => {
  it("follows cursors to the last page", async () => {
    const api = new Router({
      "POST /crawl": [{ job_id: "crawl-1" }],
      "GET /crawl/*/results": [
        {
          pages: [{ ...completed(), url: "https://example.com/a", depth: 0 }],
          next_cursor: "c2",
        },
        { pages: [{ ...completed(), url: "https://example.com/b", depth: 1 }] },
      ],
      "GET /crawl/*": [{ status: "completed", pages: { done: 2 } }],
    });
    const result = await client(api).crawl("https://example.com");
    expect(result.id).toBe("crawl-1");
    expect(result.pages.map((page) => page.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(result.pages[1]!.depth).toBe(1);
    expect(api.requests.at(-1)!.url.searchParams.get("cursor")).toBe("c2");
  });
});

describe("account", () => {
  it("reads capabilities, balance and profile", async () => {
    const api = new Router({
      "GET /config/capabilities": [
        {
          modules: [{ name: "crawl", enabled: true }],
          engines: [{ name: "copilot", enabled: false, reason: "outage" }],
        },
      ],
      "GET /users/@me/balance": [{ balance: 4200 }],
      "GET /users/@me": [{ email: "a@b.test", credit_balance: 4200 }],
    });
    const df = client(api);
    const caps = await df.capabilities();
    expect(api.requests.at(-1)!.url.pathname).toBe("/api/v1/config/capabilities");
    expect(caps.moduleEnabled("crawl")).toBe(true);
    expect(caps.engineEnabled("copilot")).toBe(false);
    expect(caps.engineEnabled("nope")).toBe(false);
    await expect(df.balance()).resolves.toBe(4200);
    await expect(df.me()).resolves.toMatchObject({ email: "a@b.test" });
  });
});
