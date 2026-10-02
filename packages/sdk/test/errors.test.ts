/** Error taxonomy: which answer lands on which class. */

import { describe, expect, it } from "vitest";

import * as datafuel from "../src/index.js";
import { client, completed, errorResponse, Recorder } from "./helpers.js";

describe("errors", () => {
  it("throws Blocked and carries the result", async () => {
    const api = new Recorder({
      id: "task-1",
      status: "failed",
      status_code: 403,
      blocked: true,
      protection: "cloudflare",
      credits_used: 0,
      error: "blocked",
    });
    const error = await client(api)
      .scrape("https://example.com")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(datafuel.Blocked);
    expect(error).toBeInstanceOf(datafuel.TaskFailed);
    const blocked = error as datafuel.Blocked;
    expect(blocked.protection).toBe("cloudflare");
    expect(blocked.result.statusCode).toBe(403);
  });

  it.each([
    [401, "UNAUTHORIZED", datafuel.Unauthorized],
    [402, "INSUFFICIENT_CREDITS", datafuel.InsufficientCredits],
    [400, "INVALID_ATTRIBUTES", datafuel.InvalidAttributes],
    [403, "FORBIDDEN", datafuel.Forbidden],
    [404, "JOB_NOT_FOUND", datafuel.NotFound],
    [404, "CRAWL_NOT_FOUND", datafuel.NotFound],
    [409, "JOB_NOT_CANCELLABLE", datafuel.JobNotCancellable],
    [409, "TASK_ALREADY_EXISTS", datafuel.AlreadyExists],
    [409, "JOB_ALREADY_EXISTS", datafuel.AlreadyExists],
    [409, "SOMETHING_NEW", datafuel.APIError],
    [422, "IDEMPOTENCY_KEY_REUSED", datafuel.IdempotencyKeyReused],
    [429, "RATE_LIMIT_EXCEEDED", datafuel.RateLimited],
    [429, "CONCURRENCY_LIMIT_REACHED", datafuel.RateLimited],
    [503, "MODULE_UNAVAILABLE", datafuel.ModuleUnavailable],
    [503, "ENGINE_UNAVAILABLE", datafuel.EngineUnavailable],
    [500, "INTERNAL_ERROR", datafuel.APIError],
  ])("maps %i %s onto the right class", async (status, code, expected) => {
    const api = new Recorder(errorResponse(status, code));
    const error = await client(api, { maxRetries: 0 })
      .scrape("https://example.com")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(expected);
    expect((error as datafuel.APIError).status).toBe(status);
    expect((error as datafuel.APIError).code).toBe(code);
  });

  it("does not call a create collision a finished job", async () => {
    const api = new Recorder(errorResponse(409, "TASK_ALREADY_EXISTS"));
    const error = await client(api)
      .scrape("https://example.com")
      .catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(datafuel.JobNotCancellable);
  });

  it("fails before any request when there is no api key", async () => {
    const api = new Recorder(completed());
    const bare = new datafuel.DataFuel({ apiKey: "", fetch: api.fetch });
    await expect(bare.scrape("https://example.com")).rejects.toBeInstanceOf(datafuel.NoApiKey);
    expect(api.requests).toHaveLength(0);
  });
});
