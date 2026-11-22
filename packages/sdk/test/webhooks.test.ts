import { describe, expect, it } from "vitest";

import { Result, ResultExpired } from "../src/index.js";
import { client, completed, errorResponse, Recorder, Router } from "./helpers.js";

const endpoint = {
  id: "e1",
  url: "https://hooks.test/df",
  description: "",
  event_types: ["crawl.*"],
  enabled: true,
  created_at: "2026-11-17T10:00:00Z",
  updated_at: "2026-11-17T10:00:00Z",
};
const delivery = {
  id: "d1",
  event_id: "ev1",
  event_type: "webhook.test",
  url: "https://hooks.test/df",
  status: "pending",
  attempts: 0,
  created_at: "2026-11-17T10:00:00Z",
  updated_at: "2026-11-17T10:00:00Z",
};
const secret = { secret: "whsec_abc", created_at: "2026-11-17T10:00:00Z" };

describe("job results", () => {
  it("follows every page", async () => {
    const api = new Recorder(
      {
        tasks_count: 3,
        tasks_complete: 3,
        tasks_failed: 0,
        tasks_result: [completed(), completed()],
        next_cursor: "n1",
      },
      { tasks_count: 3, tasks_complete: 3, tasks_failed: 0, tasks_result: [completed()] },
    );
    const results = await client(api).jobResults("j1");
    expect(results.tasks).toHaveLength(3);
    expect(results.tasks_count).toBe(3);
    expect(api.requests[0]!.url.searchParams.get("limit")).toBe("100");
    expect(api.requests[1]!.url.searchParams.get("cursor")).toBe("n1");
  });

  it("stops on a repeated cursor", async () => {
    const api = new Recorder({ tasks_count: 1, tasks_result: [completed()], next_cursor: "same" });
    await expect(client(api).jobResults("j1")).rejects.toThrow(/repeated/);
  });

  it("reads one page with a cursor and limit", async () => {
    const api = new Recorder({ tasks_count: 9, tasks_result: [completed()], next_cursor: "c2" });
    const page = await client(api).jobResultsPage("j1", { cursor: "c1", limit: 25 });
    expect(page.nextCursor).toBe("c2");
    expect(page.tasks_count).toBe(9);
    expect(api.requests[0]!.url.search).toContain("cursor=c1");
    expect(api.requests[0]!.url.search).toContain("limit=25");
  });
});

describe("expired results", () => {
  it("is neither ok nor pending", () => {
    const result = new Result({
      id: "t1",
      status: "completed",
      credits_used: 1,
      result: { status: "expired", error_detail: "gone" },
    });
    expect(result.expired).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.pending).toBe(false);
  });

  it("maps 410 to ResultExpired", async () => {
    const api = new Recorder(errorResponse(410, "RESULT_EXPIRED"));
    await expect(client(api).getTask("t1")).rejects.toBeInstanceOf(ResultExpired);
  });

  it("throws ResultExpired from raiseForStatus and requireData", () => {
    const result = new Result({
      id: "t1",
      status: "completed",
      credits_used: 1,
      result: { status: "expired", error_detail: "body deleted" },
    });
    for (const guard of [() => result.raiseForStatus(), () => result.requireData()]) {
      let thrown: unknown;
      try {
        guard();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ResultExpired);
      expect(thrown).toMatchObject({ status: 410, code: "RESULT_EXPIRED" });
      expect((thrown as Error).message).toContain("body deleted");
    }
  });
});

describe("search options", () => {
  it("sends start and resolve_url", async () => {
    const api = new Recorder(completed({}));
    await client(api).search("crm", { start: 10, resolveUrl: true });
    const attrs = api.body.attributes as Record<string, unknown>;
    expect(attrs.start).toBe(10);
    expect(attrs.resolve_url).toBe(true);
  });

  it("reads a shopping product by url, without a query", async () => {
    const api = new Recorder(completed({}));
    await client(api).searchProduct("/search?ibp=oshop&prds=pid:1", { country: "us" });
    const attrs = api.body.attributes as Record<string, unknown>;
    expect(attrs).not.toHaveProperty("query");
    expect(attrs.engine).toBe("google_shopping");
    expect(attrs.url).toBe("/search?ibp=oshop&prds=pid:1");
  });

  it("sends urls on a shopping job", async () => {
    const api = new Recorder({ id: "j1" });
    await client(api).createSearchJob([], { engine: "google_shopping", urls: ["/a", "/b"] });
    const attrs = api.body.attributes as Record<string, unknown>;
    expect(attrs).not.toHaveProperty("queries");
    expect(attrs.urls).toEqual(["/a", "/b"]);
  });

  it("sends both url and query", async () => {
    const api = new Recorder(completed({}));
    await client(api).search("crm", { url: "/search?ibp=oshop&prds=pid:1" });
    const attrs = api.body.attributes as Record<string, unknown>;
    expect(attrs.query).toBe("crm");
    expect(attrs.url).toBe("/search?ibp=oshop&prds=pid:1");
  });

  it("sends both urls and queries on a job", async () => {
    const api = new Recorder({ id: "j1" });
    await client(api).createSearchJob(["a", "b"], { urls: ["/a", "/b"] });
    const attrs = api.body.attributes as Record<string, unknown>;
    expect(attrs.queries).toEqual(["a", "b"]);
    expect(attrs.urls).toEqual(["/a", "/b"]);
  });

  it("sends no empty query field for a product or a shopping job", async () => {
    const api = new Recorder(completed({}, { id: "j1" }));
    const df = client(api);
    await df.searchProduct("/search?ibp=oshop&prds=pid:1");
    await df.createSearchJob([], { engine: "google_shopping", urls: ["/a", "/b"] });
    const [product, job] = api.bodies() as { attributes: Record<string, unknown> }[];
    expect(product!.attributes).not.toHaveProperty("query");
    expect(job!.attributes).not.toHaveProperty("queries");
  });

  it("rejects urls on a single search before any request", async () => {
    const api = new Recorder(completed({}));
    await expect(client(api).search("crm", { urls: ["/a", "/b"] })).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(api.requests).toHaveLength(0);
  });

  it("rejects url on a search job before any request", async () => {
    const api = new Recorder({ id: "j1" });
    const df = client(api);
    const url = "/search?ibp=oshop&prds=pid:1";
    await expect(df.createSearchJob(["a", "b"], { url })).rejects.toBeInstanceOf(TypeError);
    await expect(df.runSearchJob([], { engine: "google_shopping", url })).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(api.requests).toHaveLength(0);
  });
});

describe("webhooks", () => {
  const hook = { url: "https://hooks.test/df", metadata: { run: "42" } };

  it("sends webhook on jobs and crawls", async () => {
    const api = new Recorder({ id: "j1", job_id: "c1" });
    const df = client(api);
    await df.createJob(["https://a.io", "https://b.io"], { webhook: hook });
    await df.createAskJob(["a", "b"], { engine: "openai", webhook: hook });
    await df.createSearchJob(["a", "b"], { webhook: hook });
    await df.startCrawl("https://a.io", { webhook: hook });
    for (const body of api.bodies()) {
      expect((body as Record<string, unknown>).webhook).toEqual(hook);
    }
  });

  it("keeps webhook_url on a job status", async () => {
    const api = new Recorder({ status: "completed", webhook_url: "https://hooks.test/df" });
    expect((await client(api).getJob("j1")).webhook_url).toBe("https://hooks.test/df");
  });

  it("covers every route", async () => {
    const api = new Router({
      "GET /webhooks/secret": [secret],
      "POST /webhooks/secret/rotate": [secret],
      "POST /webhooks/endpoints": [{ ...endpoint, secret: "whsec_ep" }],
      "GET /webhooks/endpoints": [{ endpoints: [endpoint] }],
      "GET /webhooks/endpoints/e1": [endpoint],
      "PATCH /webhooks/endpoints/e1": [endpoint],
      "DELETE /webhooks/endpoints/e1": [new Response(null, { status: 204 })],
      "POST /webhooks/endpoints/e1/secret/rotate": [secret],
      "POST /webhooks/endpoints/e1/test": [delivery],
      "GET /webhooks/deliveries": [{ deliveries: [delivery], next_cursor: "n1" }],
      "POST /webhooks/deliveries/d1/retry": [delivery],
    });
    const df = client(api);
    expect((await df.webhookSecret()).secret).toBe("whsec_abc");
    await df.rotateWebhookSecret();
    const created = await df.createWebhookEndpoint({
      url: endpoint.url,
      eventTypes: ["crawl.*"],
    });
    expect(created.secret).toBe("whsec_ep");
    expect(api.body).toEqual({ url: endpoint.url, event_types: ["crawl.*"] });
    expect(await df.listWebhookEndpoints()).toHaveLength(1);
    await df.getWebhookEndpoint("e1");
    await df.updateWebhookEndpoint("e1", { enabled: false });
    expect(api.body).toEqual({ enabled: false });
    await df.rotateWebhookEndpointSecret("e1");
    expect((await df.testWebhookEndpoint("e1")).id).toBe("d1");
    const page = await df.listWebhookDeliveries({ jobId: "j1", status: "failed", limit: 5 });
    expect(page.nextCursor).toBe("n1");
    expect(api.requests.at(-1)!.url.search).toContain("job_id=j1");
    await df.retryWebhookDelivery("d1");
    await df.deleteWebhookEndpoint("e1");
    expect(api.requests).toHaveLength(11);
  });

  it("does not retry a webhook write", async () => {
    const api = new Recorder(errorResponse(503, "WEBHOOKS_UNAVAILABLE"));
    await expect(client(api).rotateWebhookSecret()).rejects.toMatchObject({
      code: "WEBHOOKS_UNAVAILABLE",
    });
    expect(api.requests).toHaveLength(1);
  });
});
