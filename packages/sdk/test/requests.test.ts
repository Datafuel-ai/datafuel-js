/** What the SDK puts on the wire: envelopes, attributes, option mapping. */

import { describe, expect, it } from "vitest";

import { client, completed, Recorder } from "./helpers.js";

describe("request building", () => {
  it("sends the envelope and decodes the result", async () => {
    const api = new Recorder(completed());
    const res = await client(api).scrape("https://example.com/p/1", {
      proxy: { type: "Premium", country: "US" },
      format: "markdown",
      jsRendering: true,
      waitFor: "#price",
      extract: { title: "h1", links: "a @href" },
    });

    expect(api.requests[0]!.url.pathname).toBe("/api/v1/task");
    expect(api.header("X-API-Key")).toBe("df_key_test");
    expect(api.body).toEqual({
      type: "unlocker",
      proxy_type: "Premium",
      proxy_country: "US",
      attributes: {
        result_format: "markdown",
        js_rendering: true,
        wait_for_selector: "#price",
        extract_selector: '{"title":"h1","links":"a @href"}',
        url: "https://example.com/p/1",
      },
    });
    expect(res.text).toBe("<html>hi</html>");
    expect(res.ok).toBe(true);
  });

  it("leaves unset options out of the body", async () => {
    const api = new Recorder(completed());
    await client(api).scrape("https://example.com");
    expect(api.body.attributes).toEqual({ url: "https://example.com" });
  });

  it("sends the sticky session in attributes, the rest in the envelope", async () => {
    const api = new Recorder(completed());
    await client(api).scrape("https://example.com", {
      proxy: { type: "Basic", sessionId: "s1", ttl: 600 },
    });
    expect(api.body.proxy_type).toBe("Basic");
    expect(api.body).not.toHaveProperty("proxy_session_id");
    expect(api.body.attributes).toMatchObject({ proxy_session_id: "s1", proxy_ttl: 600 });
  });

  it("expands ai into the unlocker attributes", async () => {
    const api = new Recorder(completed({ name: "Widget", price: 9.99 }));
    const res = await client(api).scrape("https://example.com", {
      ai: {
        prompt: "extract name and price",
        format: { name: "string" },
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-secret",
      },
    });
    expect(api.body.attributes).toEqual({
      url: "https://example.com",
      result_use_ai: true,
      result_ai_prompt: "extract name and price",
      result_ai_format: { name: "string" },
      ai_provider: "openai",
      ai_model: "gpt-4o-mini",
      ai_api_key: "sk-secret",
    });
    expect(res.data).toEqual({ name: "Widget", price: 9.99 });
  });

  it("refuses ai on a crawl before sending", async () => {
    const api = new Recorder(completed());
    await expect(
      client(api).startCrawl("https://example.com", { ai: { prompt: "x" } }),
    ).rejects.toThrow(/result_use_ai/);
    expect(api.requests).toHaveLength(0);
  });

  it("sends prompt and engine for ask", async () => {
    const api = new Recorder(completed("the answer"));
    await client(api).ask("best CRM 2026", {
      engine: "perplexity",
      websearch: true,
      country: "us",
    });
    expect(api.body).toEqual({
      type: "llm_scraping",
      attributes: {
        prompt: "best CRM 2026",
        engine: "perplexity",
        websearch: true,
        proxy_country: "us",
      },
    });
  });

  it("drops images for markdown()", async () => {
    const api = new Recorder(completed("# Title"));
    await expect(client(api).markdown("https://example.com")).resolves.toBe("# Title");
    expect(api.body.attributes).toMatchObject({ result_format: "markdown", include_images: false });
  });

  it("splits crawl options from page options", async () => {
    const api = new Recorder({ job_id: "crawl-1" });
    await client(api).startCrawl("https://example.com/docs", {
      maxPages: 200,
      excludePaths: ["\\.pdf$"],
      format: "markdown",
    });
    expect(api.body.attributes).toEqual({
      result_format: "markdown",
      url: "https://example.com/docs",
      max_pages: 200,
      exclude_paths: ["\\.pdf$"],
    });
  });

  it("sends location for ask", async () => {
    const api = new Recorder(completed("the answer"));
    await client(api).ask("best CRM 2026", { engine: "google_ai_mode", location: "Berlin" });
    expect(api.body.attributes).toEqual({
      prompt: "best CRM 2026",
      engine: "google_ai_mode",
      location: "Berlin",
    });
  });

  it("sends the sticky session on a crawl", async () => {
    const api = new Recorder({ job_id: "crawl-1" });
    await client(api).startCrawl("https://example.com/docs", {
      proxy: { type: "Premium", sessionId: "s1", ttl: 300 },
    });
    expect(api.body.proxy_type).toBe("Premium");
    expect(api.body.attributes).toEqual({
      url: "https://example.com/docs",
      proxy_session_id: "s1",
      proxy_ttl: 300,
    });
  });

  it("sends the sticky session on a URL job", async () => {
    const api = new Recorder({ id: "job-1" });
    await client(api).createJob(["https://a.test", "https://b.test"], {
      format: "pdf",
      proxy: { sessionId: "s1" },
    });
    expect(api.body.attributes).toEqual({
      result_format: "pdf",
      urls: ["https://a.test", "https://b.test"],
      proxy_session_id: "s1",
    });
  });

  it("inverts sequential into multithreaded", async () => {
    const api = new Recorder({ id: "job-1" });
    await client(api).createJob(["https://a.test", "https://b.test"], { sequential: true });
    expect(api.body.multithreaded).toBe(false);
    expect(api.body.attributes).toMatchObject({ urls: ["https://a.test", "https://b.test"] });
  });
});
