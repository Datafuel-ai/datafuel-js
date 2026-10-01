/** The long-running endpoints: map, jobs, crawls, and the account reads. */

import { describe, expect, it } from "vitest";

import * as datafuel from "../src/index.js";
import { client, completed, errorResponse, Router } from "./helpers.js";

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
      "GET /users/@me/balance": [{ balance: 4200, plan_balance: 3200, payg_balance: 1000 }],
      "GET /users/@me": [
        {
          email: "a@b.test",
          credit_balance: 4200,
          plan_credit_balance: 3200,
          payg_credit_balance: 1000,
        },
      ],
    });
    const df = client(api);
    const caps = await df.capabilities();
    expect(api.requests.at(-1)!.url.pathname).toBe("/api/v1/config/capabilities");
    expect(caps.moduleEnabled("crawl")).toBe(true);
    expect(caps.engineEnabled("copilot")).toBe(false);
    expect(caps.engineEnabled("nope")).toBe(false);
    await expect(df.balance()).resolves.toBe(4200);
    await expect(df.balanceSplit()).resolves.toEqual({
      balance: 4200,
      plan_balance: 3200,
      payg_balance: 1000,
    });
    expect(api.requests.at(-1)!.url.pathname).toBe("/api/v1/users/@me/balance");
    await expect(df.me()).resolves.toMatchObject({
      email: "a@b.test",
      plan_credit_balance: 3200,
      payg_credit_balance: 1000,
    });
  });
});

describe("search", () => {
  it("sends a serp task and returns the parsed page", async () => {
    const api = new Router({ "POST /task": [completed({ organic_results: [] })] });
    const res = await client(api).search("best crm", {
      country: "de",
      language: "de",
      page: 2,
      googleDomain: "google.de",
      lat: 52.5,
      lon: 13.4,
      radius: 500,
      safe: "off",
      nfpr: false,
      proxyCountry: "DE",
    });
    expect(api.body).toEqual({
      type: "serp",
      attributes: {
        query: "best crm",
        country: "de",
        language: "de",
        google_domain: "google.de",
        safe: "off",
        proxy_country: "DE",
        page: 2,
        radius: 500,
        lat: 52.5,
        lon: 13.4,
        nfpr: false,
      },
    });
    expect(api.header("Idempotency-Key")).toBeTruthy();
    expect(res.data).toEqual({ organic_results: [] });
  });

  it("runs a search job over queries", async () => {
    const api = new Router({
      "POST /job": [{ id: "job-s" }],
      "GET /job/*/results": [
        { tasks_count: 2, tasks_complete: 2, tasks_failed: 0, tasks_result: [completed()] },
      ],
      "GET /job/*": [{ status: "completed", tasks_count: 2, tasks_done: 2 }],
    });
    const results = await client(api).runSearchJob(["a", "b"], { format: "markdown" });
    expect(api.bodies()[0]).toEqual({
      type: "serp",
      multithreaded: true,
      attributes: { queries: ["a", "b"], result_format: "markdown" },
    });
    expect(results.id).toBe("job-s");
  });
});

describe("cancel", () => {
  const cancelled = {
    status: "cancelled",
    tasks_count: 10,
    tasks_done: 4,
    tasks_remaining: 0,
    total_cost: 10,
    refunded_tasks: 6,
    refunded_credits: 6,
  };

  it("cancels a job", async () => {
    const api = new Router({ "POST /job/*/cancel": [cancelled] });
    const result = await client(api).cancelJob("job-1");
    expect(api.requests[0]!.url.pathname).toBe("/api/v1/job/job-1/cancel");
    expect(result).toMatchObject({ status: "cancelled", done: true, refunded_credits: 6 });
  });

  it("cancels a crawl", async () => {
    const api = new Router({ "POST /crawl/*/cancel": [cancelled] });
    const result = await client(api).cancelCrawl("crawl-1");
    expect(api.requests[0]!.url.pathname).toBe("/api/v1/crawl/crawl-1/cancel");
    expect(result.refunded_tasks).toBe(6);
  });

  it("throws JobNotCancellable on a finished job", async () => {
    const api = new Router({
      "POST /job/*/cancel": [errorResponse(409, "JOB_NOT_CANCELLABLE")],
    });
    await expect(client(api).cancelJob("job-1")).rejects.toBeInstanceOf(datafuel.JobNotCancellable);
  });
});

describe("crawl status", () => {
  it("keeps the timestamps", async () => {
    const api = new Router({
      "GET /crawl/*": [
        {
          status: "processing",
          stop_reason: null,
          created_at: "2026-09-28T10:00:00Z",
          updated_at: "2026-09-28T10:01:00Z",
        },
      ],
    });
    const status = await client(api).getCrawl("crawl-1");
    expect(status.created_at).toBe("2026-09-28T10:00:00Z");
    expect(status.updated_at).toBe("2026-09-28T10:01:00Z");
    expect(status.done).toBe(false);
  });
});

describe("config", () => {
  it("reads capabilities and js instructions without a key", async () => {
    const api = new Router({
      "GET /config/capabilities": [{ modules: [{ name: "serp", enabled: true }], engines: [] }],
      "GET /config/js-instructions": [
        {
          instructions: [
            {
              action: "click",
              description: "Click.",
              value: "scalar",
              args: [{ name: "selector", type: "string", required: true }],
              iframe: true,
              example: { click: "#more" },
            },
          ],
        },
      ],
    });
    const bare = new datafuel.DataFuel({ apiKey: "", fetch: api.fetch });
    await expect(bare.capabilities()).resolves.toMatchObject({
      modules: [{ name: "serp", enabled: true }],
    });
    const actions = await bare.jsInstructions();
    expect(actions.map((item) => item.action)).toEqual(["click"]);
    expect(api.requests[1]!.url.pathname).toBe("/api/v1/config/js-instructions");
    expect(api.header("X-API-Key")).toBeUndefined();
    await expect(bare.balance()).rejects.toBeInstanceOf(datafuel.NoApiKey);
  });

  it("reads proxy locations and ASNs", async () => {
    const api = new Router({
      "GET /config/proxy/locations": [[{ code: "us", name: "United States", regions: [] }]],
      "GET /config/proxy/asn": [[{ code: "7922", name: "Comcast" }]],
    });
    const df = client(api);
    const countries = await df.proxyLocations({ proxyType: "Premium" });
    expect(countries[0]!.code).toBe("us");
    expect(api.requests[0]!.url.searchParams.get("proxy_type")).toBe("Premium");
    const asns = await df.proxyAsns("US");
    expect(asns).toEqual([{ code: "7922", name: "Comcast" }]);
    expect(api.requests[1]!.url.searchParams.get("country")).toBe("US");
    expect(api.requests[1]!.url.searchParams.has("proxy_type")).toBe(false);
    expect(api.header("X-API-Key")).toBe("df_key_test");
  });
});

describe("usage", () => {
  it("lists jobs with filters and a cursor", async () => {
    const api = new Router({
      "GET /job": [
        {
          jobs: [
            {
              id: "job-1",
              type: "crawl",
              status: "completed",
              tasks_count: 3,
              tasks_done: 3,
              tasks_remaining: 0,
              total_cost: 3,
              created_at: "2026-09-29T10:00:00Z",
              updated_at: "2026-09-29T10:04:31Z",
            },
          ],
          next_cursor: "c2",
        },
      ],
    });
    const page = await client(api).listJobs({
      type: "crawl",
      status: "completed",
      startDate: new Date("2026-09-01T23:30:00Z"),
      endDate: "2026-09-30",
      limit: 20,
    });
    expect(Object.fromEntries(api.requests[0]!.url.searchParams)).toEqual({
      type: "crawl",
      status: "completed",
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      limit: "20",
    });
    expect(page.nextCursor).toBe("c2");
    expect(page.jobs[0]).toMatchObject({ id: "job-1", type: "crawl", done: true, total_cost: 3 });
  });

  it("lists tasks of a job and omits next_cursor on the last page", async () => {
    const api = new Router({
      "GET /task": [
        {
          tasks: [
            {
              id: "t1",
              job_id: "job-1",
              type: "unlocker",
              status: "failed",
              url: "https://a.test",
              credit_cost: 1,
              created_at: "2026-09-29T10:00:00Z",
              failed_at: "2026-09-29T10:00:04Z",
            },
            { id: "t2", type: "llm_scraping", status: "completed", credit_cost: 100 },
          ],
        },
      ],
    });
    const page = await client(api).listTasks({ jobId: "job-1", status: "failed", cursor: "c1" });
    const params = api.requests[0]!.url.searchParams;
    expect(params.get("job_id")).toBe("job-1");
    expect(params.get("cursor")).toBe("c1");
    expect(page.nextCursor).toBeUndefined();
    expect(page.tasks.map((task) => task.job_id)).toEqual(["job-1", null]);
  });

  it("reads transactions and analytics", async () => {
    const api = new Router({
      "GET /users/@me/transactions": [
        {
          transactions: [
            {
              id: 1,
              amount: 100,
              plan_amount: 60,
              operation: "refund",
              reference_type: "task_id",
              reference_id: "t1",
              balance_after: 4820,
              created_at: "2026-09-29T09:58:40Z",
            },
          ],
          total_count: 1,
          sums: [{ operation: "refund", total: 100, count: 1 }],
        },
      ],
      "GET /task/analytics/dashboard": [
        {
          summary: { total_tasks: 2, credits_used: 1, avg_credits_per_request: 0.5 },
          by_status_code: [{ status_code: 0, count: 1, failed: 1 }],
        },
      ],
    });
    const df = client(api);
    const history = await df.transactions({ operation: "refund", page: 2, limit: 50 });
    expect(Object.fromEntries(api.requests[0]!.url.searchParams)).toEqual({
      operation: "refund",
      page: "2",
      limit: "50",
    });
    expect(history.transactions[0]!.balance_after).toBe(4820);
    expect(history.transactions[0]!.plan_amount).toBe(60);
    expect(history.sums).toEqual([{ operation: "refund", total: 100, count: 1 }]);

    const usage = await df.analytics({ interval: "weekly", module: "unlocker" });
    expect(api.requests[1]!.url.search).toBe("?interval=weekly&module=unlocker");
    expect(usage.summary.avg_credits_per_request).toBe(0.5);
    expect(usage.by_status_code[0]!.status_code).toBe(0);
    expect(usage.timeseries).toEqual([]);
  });

  it("surfaces INVALID_QUERY_PARAM", async () => {
    const api = new Router({
      "GET /task": [errorResponse(400, "INVALID_QUERY_PARAM")],
    });
    const error = await client(api)
      .listTasks({ limit: -1 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(datafuel.APIError);
    expect((error as datafuel.APIError).code).toBe("INVALID_QUERY_PARAM");
  });
});
