/**
 * Live smoke tests against the real API. These spend credits.
 *
 * Excluded from `npm test`. Run them on purpose:
 *
 *     DATAFUEL_API_KEY=df_key_... npm run test:live
 *
 * Roughly 120 credits on a Premium-default account. Every test is read-only
 * towards the account: nothing here rotates the API key.
 */

import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import * as datafuel from "../src/index.js";

const TARGET = "https://example.com";
const live = process.env.DATAFUEL_API_KEY ? describe : describe.skip;

live("live API", () => {
  let df: datafuel.DataFuel;

  beforeAll(() => {
    df = new datafuel.DataFuel();
  });

  it("agrees between balance and profile", async () => {
    const profile = await df.me();
    expect(profile.email).toBeTruthy();
    expect(profile.concurrency_limit).toBeGreaterThan(0);
    await expect(df.balance()).resolves.toBe(profile.credit_balance);
  });

  it("lists capabilities", async () => {
    try {
      const caps = await df.capabilities();
      expect(caps.modules.length).toBeGreaterThan(0);
    } catch (error) {
      if (error instanceof datafuel.NotFound) return; // not deployed here yet
      throw error;
    }
  });

  it("scrapes markdown with a full envelope", async () => {
    const res = await df.scrape(TARGET, { format: "markdown" });
    expect(res.ok).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.redirected).toBe(false);
    expect(res.creditsUsed).toBeGreaterThan(0);
    expect(res.text).toContain("Example Domain");
  });

  it("extracts structured fields", async () => {
    const res = await df.scrape(TARGET, { extract: { heading: "h1", links: "a @href" } });
    expect(res.data).toMatchObject({ heading: ["Example Domain"] });
  });

  it("replays a finished task by id", async () => {
    const res = await df.scrape(TARGET);
    const again = await df.getTask(res.id!);
    expect(again.id).toBe(res.id);
    expect(again.state).toBe("completed");
  });

  it("maps a site", async () => {
    const site = await df.map(TARGET, { limit: 10 });
    expect(site.credits).toBeGreaterThan(0);
    // example.com links out only, so an empty list must come with a reason.
    expect(site.links.length > 0 || Boolean(site.reason)).toBe(true);
  });

  it("charges nothing for a replayed idempotency key", async () => {
    const idempotencyKey = randomUUID();
    const before = await df.balance();
    const first = await df.scrape(TARGET, { idempotencyKey });
    const charged = before - (await df.balance());

    const replay = await df.scrape(TARGET, { idempotencyKey });
    expect(replay.id).toBe(first.id);
    expect(charged).toBeGreaterThan(0);
    expect(before - (await df.balance())).toBe(charged);
  });

  it("refuses a key reused for a different request", async () => {
    const idempotencyKey = randomUUID();
    await df.scrape(TARGET, { idempotencyKey });
    await expect(df.scrape("https://example.org", { idempotencyKey })).rejects.toBeInstanceOf(
      datafuel.IdempotencyKeyReused,
    );
  });

  it("completes every url of a job", async () => {
    const results = await df.runJob([TARGET, "https://example.org"], { format: "markdown" });
    expect(results.tasks_count).toBe(2);
    expect(results.tasks.map((task) => task.ok)).toEqual([true, true]);
  });

  it("walks a site and pages the results", async () => {
    const id = await df.startCrawl("https://www.iana.org/", { maxPages: 2, maxDepth: 1 });
    const status = await df.waitCrawl(id, { timeoutMs: 240_000 });
    expect(status.done).toBe(true);
    expect(status.stop_reason).toBeTruthy();
    // limit 1 forces the cursor to be followed rather than one big answer.
    const pages: datafuel.CrawlPage[] = [];
    for await (const page of df.crawlPages(id, { limit: 1 })) pages.push(page);
    expect(pages).toHaveLength(status.pages.done);
    expect(pages.every((page) => page.url)).toBe(true);
  });

  it("rejects a bad key", async () => {
    const bad = new datafuel.DataFuel("df_key_definitely_not_valid");
    await expect(bad.balance()).rejects.toBeInstanceOf(datafuel.Unauthorized);
  });

  it("reports unknown ids as not found", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    await expect(df.getTask(missing)).rejects.toBeInstanceOf(datafuel.NotFound);
    await expect(df.getJob(missing)).rejects.toBeInstanceOf(datafuel.NotFound);
  });

  it("does not let an id reach another endpoint", async () => {
    // Escaped, the server sees one unknown path segment. Unescaped, this would
    // have resolved to /users/@me.
    await expect(df.getTask("../users/@me")).rejects.toBeInstanceOf(datafuel.NotFound);
  });

  it("refunds a failed task", async () => {
    const before = await df.balance();
    await expect(df.scrape("https://this-host-does-not-exist-xyz.invalid")).rejects.toBeInstanceOf(
      datafuel.TaskFailed,
    );
    await expect(df.balance()).resolves.toBe(before);
  });

  it("scrapes concurrently", async () => {
    const results = await Promise.all([
      df.scrape(TARGET, { format: "markdown" }),
      df.scrape("https://example.org", { format: "markdown" }),
    ]);
    expect(results.every((res) => res.ok && res.statusCode === 200)).toBe(true);
  });
});
