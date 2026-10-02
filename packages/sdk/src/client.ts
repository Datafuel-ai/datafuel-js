/** The client. It only moves bytes; `core` decides what goes on the wire. */

import * as core from "./core.js";
import type { AskOptions, CrawlOptions, MapOptions, SearchOptions } from "./core.js";
import { apiError, DataFuelError, NoApiKey, TransportError, WaitTimeout } from "./errors.js";
import type {
  AIProvider,
  Analytics,
  AnalyticsOptions,
  BalanceSplit,
  CallOptions,
  CancelResult,
  Capability,
  CrawlResult,
  CrawlResultsPage,
  CrawlStatus,
  Health,
  JobResults,
  JobsPage,
  JobStatus,
  JobSummary,
  JsInstruction,
  ListOptions,
  ListTasksOptions,
  Profile,
  ProtectionCheck,
  ProxyCountry,
  ProxyLocation,
  ScrapeOptions,
  SiteMap,
  TasksPage,
  TaskSummary,
  TransactionsOptions,
  TransactionsPage,
} from "./models.js";
import { Capabilities, CrawlPage, isDone, Result } from "./models.js";

/** How to build the client. */
export interface ClientOptions {
  /** Falls back to `process.env.DATAFUEL_API_KEY`. */
  apiKey?: string;
  baseUrl?: string;
  /** Milliseconds. `null` disables the bound; scrape blocks until the page is ready. */
  timeoutMs?: number | null;
  /** Retries after a network error or a 429/502/503/504 answer. Default 2. */
  maxRetries?: number;
  /** How often `waitJob` and `waitCrawl` poll. Default 2000ms. */
  pollIntervalMs?: number;
  /** Prefixes the SDK User-Agent with your application's. */
  userAgent?: string;
  /** Swap the fetch implementation, e.g. in tests. */
  fetch?: typeof globalThis.fetch;
}

type Send = CallOptions & { timeoutMs?: number; signal?: AbortSignal };

/**
 * Client for the DataFuel scraping API.
 *
 * ```ts
 * const df = new DataFuel();                       // reads DATAFUEL_API_KEY
 * const markdown = await df.markdown("https://example.com");
 * ```
 *
 * Pick the call by the shape of the work: one URL is {@link scrape}, a site's
 * URL list is {@link map}, many pages from a start URL is {@link crawl}, a list
 * of known URLs is {@link runJob}, a question for an AI engine is {@link ask}, a
 * Google search is {@link search}.
 *
 * Every write carries an `Idempotency-Key`, generated per request, so a retry
 * attaches to the task already running instead of charging twice.
 */
export class DataFuel {
  readonly baseUrl: string;
  readonly timeoutMs: number | null;
  readonly maxRetries: number;
  readonly pollIntervalMs: number;
  readonly userAgent: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: ClientOptions | string = {}) {
    const opts: ClientOptions = typeof options === "string" ? { apiKey: options } : options;
    this.apiKey = opts.apiKey ?? envApiKey() ?? "";
    this.baseUrl = (opts.baseUrl ?? core.DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs === undefined ? core.DEFAULT_TIMEOUT_MS : opts.timeoutMs;
    this.maxRetries = Math.max(opts.maxRetries ?? 2, 0);
    // A non-positive interval would poll in a tight loop against the API.
    this.pollIntervalMs =
      opts.pollIntervalMs !== undefined && opts.pollIntervalMs > 0 ? opts.pollIntervalMs : 2_000;
    const sdk = `datafuel-js/${core.VERSION}`;
    this.userAgent = opts.userAgent ? `${opts.userAgent} ${sdk}` : sdk;
    // Bound: a detached fetch throws "Illegal invocation" in browsers and
    // workers, even though Node tolerates it.
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // --- transport ---------------------------------------------------------

  /** Pause between attempts. Overridable so tests need not wait in real time. */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async send(request: core.Request, opts: Send = {}): Promise<unknown> {
    if (!this.apiKey && request.auth) {
      throw new NoApiKey("no API key: pass one to the client or set DATAFUEL_API_KEY");
    }
    const url = new URL(this.baseUrl + request.path);
    for (const [name, value] of Object.entries(request.params ?? {})) {
      url.searchParams.set(name, value);
    }
    const init: RequestInit = {
      method: request.method,
      headers: core.headers(this.apiKey, this.userAgent, request),
      // Redirects stay off: a redirect to another host would carry X-API-Key
      // to it, since fetch does not strip custom headers.
      redirect: "manual",
    };
    if (request.body !== undefined) init.body = JSON.stringify(request.body);

    for (let attempt = 0; ; attempt++) {
      let error: unknown;
      try {
        const signal = this.signalFor(opts);
        // Detached on purpose: calling `this.fetchImpl(...)` would invoke it as
        // a method of the client, and a fetch bound to another receiver (or
        // none) throws "Illegal invocation".
        const send = this.fetchImpl;
        const response = await send(url, signal ? { ...init, signal } : init);
        return await parse(response, request.degradedOk);
      } catch (caught) {
        if (isAbort(caught)) {
          throw new TransportError("the request was aborted or timed out", { cause: caught });
        }
        error =
          caught instanceof DataFuelError
            ? caught
            : new TransportError(String(caught), {
                cause: caught,
              });
      }
      const retryAfter =
        error instanceof Object && "retryAfter" in error ? Number(error.retryAfter) : 0;
      if (attempt >= this.maxRetries || !request.retryable || !core.shouldRetry(error)) throw error;
      await this.sleep(core.backoff(attempt, retryAfter));
    }
  }

  private signalFor(opts: Send): AbortSignal | undefined {
    const budget = opts.timeoutMs ?? this.timeoutMs;
    const timeout =
      budget === null || budget === undefined ? undefined : AbortSignal.timeout(budget);
    if (timeout && opts.signal) return AbortSignal.any([timeout, opts.signal]);
    return timeout ?? opts.signal;
  }

  /**
   * Send a task and wait for its result.
   *
   * On a 202 the API is still working: the identical request goes out again
   * under the identical idempotency key, so it attaches to the running task
   * rather than starting a second one.
   */
  private async runTask(request: core.Request, opts: Send): Promise<Result> {
    const budget = opts.timeoutMs ?? this.timeoutMs ?? core.DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + budget;
    let body: unknown;
    for (let attempt = 0; ; attempt++) {
      body = await this.send(request, opts);
      if (!core.stillProcessing(body)) break;
      const delay = core.pollDelay(attempt);
      if (Date.now() + delay >= deadline) {
        throw new WaitTimeout(
          "the task is still processing; re-send under the same idempotency key to pick it up",
          request.idempotencyKey,
        );
      }
      await this.sleep(delay);
    }
    const result = new Result(record(body));
    result.raiseForStatus();
    return result;
  }

  // --- pages -------------------------------------------------------------

  /**
   * Fetch one URL and wait for the result.
   *
   * Throws {@link Blocked} when the target refused the request and
   * {@link TaskFailed} otherwise; both carry `.result`.
   */
  async scrape(url: string, options: ScrapeOptions & CallOptions = {}): Promise<Result> {
    const request = core.buildScrape(url, options, options.proxy, core.key(options.idempotencyKey));
    return this.runTask(request, options);
  }

  /** The one-liner: the page as LLM-ready markdown, images dropped. */
  async markdown(url: string, options: ScrapeOptions & CallOptions = {}): Promise<string> {
    const result = await this.scrape(url, { ...options, format: "markdown", includeImages: false });
    return result.text;
  }

  /**
   * Return a task by id, e.g. one created by a job or a crawl.
   *
   * A task that is still running comes back with `pending` true.
   */
  async getTask(taskId: string, options: CallOptions = {}): Promise<Result> {
    const body = await this.send(
      new core.Request("GET", `/task/${core.pathSegment(taskId)}`),
      options,
    );
    if (core.stillProcessing(body)) return new Result({ id: taskId, status: "processing" });
    const result = new Result(record(body));
    result.raiseForStatus();
    return result;
  }

  /**
   * Poll a task until it is done. Without `timeoutMs` it waits indefinitely.
   * Throws {@link TaskFailed} or {@link Blocked} when the task failed.
   */
  async waitTask(taskId: string, options: CallOptions = {}): Promise<Result> {
    // The timeout bounds the whole wait, not each poll.
    const { timeoutMs, ...perPoll } = options;
    const deadline = timeoutMs === undefined ? null : Date.now() + timeoutMs;
    for (;;) {
      const result = await this.getTask(taskId, perPoll);
      if (!result.pending) return result;
      if (deadline !== null && Date.now() + this.pollIntervalMs >= deadline) {
        throw new WaitTimeout(`task ${taskId} is still running`, taskId, result);
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  /** Send a prompt to an AI engine and return its answer. */
  async ask(prompt: string, options: AskOptions & CallOptions): Promise<Result> {
    const request = core.buildAsk(prompt, options, core.key(options.idempotencyKey));
    return this.runTask(request, options);
  }

  /** Run a Google search and return the results page, parsed to JSON by default. */
  async search(query: string, options: SearchOptions & CallOptions = {}): Promise<Result> {
    const request = core.buildSearch(query, options, core.key(options.idempotencyKey));
    return this.runTask(request, options);
  }

  /**
   * List the URLs of a site without scraping them.
   *
   * One credit per call on a Basic proxy, however many links come back. Use it
   * before a crawl to see how big a section is.
   */
  async map(url: string, options: MapOptions & CallOptions = {}): Promise<SiteMap> {
    const request = core.buildMap(url, options, options.proxy, core.key(options.idempotencyKey));
    const task = await this.runTask(request, options);
    const data = record(task.requireData()) as unknown as SiteMap;
    return { ...data, links: data.links ?? [], sitemaps: data.sitemaps ?? [], task };
  }

  // --- crawl -------------------------------------------------------------

  /**
   * Queue a crawl and return its id immediately.
   *
   * Follows links from the start URL and scrapes every page. Pages are charged
   * like single scrapes when they are queued; failed and blocked pages are
   * refunded. Unset limits use the API defaults: 100 pages, depth 3, 5 in flight.
   */
  async startCrawl(url: string, options: CrawlOptions & CallOptions = {}): Promise<string> {
    const request = core.buildCrawl(url, options, options.proxy, core.key(options.idempotencyKey));
    return strField(await this.send(request, options), "job_id");
  }

  /**
   * Stop a crawl. Queued pages are refunded, pages in flight finish and bill.
   * Throws {@link JobNotCancellable} when it already finished.
   */
  async cancelCrawl(crawlId: string, options: CallOptions = {}): Promise<CancelResult> {
    return cancelResult(await this.send(core.cancelRequest("crawl", crawlId), options));
  }

  /** Return the progress of a crawl. */
  async getCrawl(crawlId: string, options: CallOptions = {}): Promise<CrawlStatus> {
    const body = record(
      await this.send(new core.Request("GET", `/crawl/${core.pathSegment(crawlId)}`), options),
    );
    const raw = body as unknown as Partial<CrawlStatus>;
    return {
      ...raw,
      status: raw.status as CrawlStatus["status"],
      // Counters the caller reads unconditionally must exist even on a thin answer.
      pages: {
        discovered: 0,
        enqueued: 0,
        done: 0,
        failed: 0,
        skipped: 0,
        ...(raw.pages ?? {}),
      },
      depth_reached: raw.depth_reached ?? 0,
      total_cost: raw.total_cost ?? 0,
      done: isDone(raw.status),
    };
  }

  /** One page of results, in discovery order. `limit` unset uses the API default. */
  async crawlResults(
    crawlId: string,
    options: CallOptions & { cursor?: string; limit?: number } = {},
  ): Promise<CrawlResultsPage> {
    const body = record(
      await this.send(core.crawlResultsRequest(crawlId, options.cursor, options.limit), options),
    );
    const pages = Array.isArray(body.pages) ? body.pages : [];
    const next = typeof body.next_cursor === "string" ? body.next_cursor : undefined;
    return {
      pages: pages.map((page) => new CrawlPage(record(page))),
      ...(next ? { nextCursor: next } : {}),
    };
  }

  /**
   * Walk every page of a crawl, fetching result pages as needed.
   *
   * Readable while the crawl runs; unfinished pages report `pending`.
   */
  async *crawlPages(
    crawlId: string,
    options: CallOptions & { limit?: number } = {},
  ): AsyncGenerator<CrawlPage> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (;;) {
      const batch = await this.crawlResults(crawlId, { ...options, ...(cursor ? { cursor } : {}) });
      yield* batch.pages;
      cursor = batch.nextCursor;
      if (!cursor) return;
      if (seen.has(cursor)) {
        throw new DataFuelError("the API repeated a crawl cursor; stopping to avoid a loop");
      }
      seen.add(cursor);
    }
  }

  /** Poll until the crawl is done. Without `timeoutMs` it waits indefinitely. */
  async waitCrawl(crawlId: string, options: CallOptions = {}): Promise<CrawlStatus> {
    // The timeout bounds the whole wait, not each poll.
    const { timeoutMs, ...perPoll } = options;
    const deadline = timeoutMs === undefined ? null : Date.now() + timeoutMs;
    for (;;) {
      const status = await this.getCrawl(crawlId, perPoll);
      if (status.done) return status;
      if (deadline !== null && Date.now() + this.pollIntervalMs >= deadline) {
        throw new WaitTimeout(`crawl ${crawlId} is still running`, crawlId, status);
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  /**
   * Start a crawl, wait for it, and return every page.
   *
   * Check `stop_reason`: `insufficient_credits` means it ended early. For large
   * crawls prefer {@link startCrawl} + {@link waitCrawl} + {@link crawlPages},
   * which stream instead of holding every page in memory. On {@link WaitTimeout}
   * the error carries the id: the crawl keeps running and billing.
   */
  async crawl(url: string, options: CrawlOptions & CallOptions = {}): Promise<CrawlResult> {
    const id = await this.startCrawl(url, options);
    const status = await this.waitCrawl(id, options);
    const pages: CrawlPage[] = [];
    for await (const page of this.crawlPages(id, options)) pages.push(page);
    return { id, status, pages };
  }

  // --- jobs --------------------------------------------------------------

  /**
   * Queue a batch of known URLs and return the job id.
   *
   * Cheaper and more predictable than a crawl when you already have the URLs.
   * `sequential` runs them one after the other; the default runs them
   * concurrently, bounded by the account's concurrency limit.
   */
  async createJob(
    urls: string[],
    options: ScrapeOptions & CallOptions & { sequential?: boolean } = {},
  ): Promise<string> {
    const request = core.buildJob(
      urls,
      options,
      options.proxy,
      options.sequential ?? false,
      core.key(options.idempotencyKey),
    );
    return strField(await this.send(request, options), "id");
  }

  /** Queue a batch of prompts for an AI engine and return the job id. */
  async createAskJob(
    prompts: string[],
    options: AskOptions & CallOptions & { sequential?: boolean },
  ): Promise<string> {
    const request = core.buildAskJob(
      prompts,
      options,
      options.sequential ?? false,
      core.key(options.idempotencyKey),
    );
    return strField(await this.send(request, options), "id");
  }

  /** Queue a batch of Google searches and return the job id. */
  async createSearchJob(
    queries: string[],
    options: SearchOptions & CallOptions & { sequential?: boolean } = {},
  ): Promise<string> {
    const request = core.buildSearchJob(
      queries,
      options,
      options.sequential ?? false,
      core.key(options.idempotencyKey),
    );
    return strField(await this.send(request, options), "id");
  }

  /** Return the progress of a job. */
  async getJob(jobId: string, options: CallOptions = {}): Promise<JobStatus> {
    return jobStatus(
      await this.send(new core.Request("GET", `/job/${core.pathSegment(jobId)}`), options),
    );
  }

  /**
   * Stop a job. Queued tasks are refunded, tasks in flight finish and bill.
   * Throws {@link JobNotCancellable} when it already finished.
   */
  async cancelJob(jobId: string, options: CallOptions = {}): Promise<CancelResult> {
    return cancelResult(await this.send(core.cancelRequest("job", jobId), options));
  }

  /**
   * Return the per-task results of a job.
   *
   * A job completes even when some of its tasks failed: check `task.ok` or call
   * `task.raiseForStatus()` per task.
   */
  async jobResults(jobId: string, options: CallOptions = {}): Promise<JobResults> {
    const body = record(
      await this.send(new core.Request("GET", `/job/${core.pathSegment(jobId)}/results`), options),
    );
    const tasks = Array.isArray(body.tasks_result) ? body.tasks_result : [];
    return {
      id: jobId,
      tasks_count: Number(body.tasks_count ?? 0),
      tasks_failed: Number(body.tasks_failed ?? 0),
      tasks_complete: Number(body.tasks_complete ?? 0),
      tasks: tasks.map((task) => new Result(record(task))),
    };
  }

  /** One page of your jobs and crawls, newest first. Pass `nextCursor` back as `cursor`. */
  async listJobs(options: ListOptions & CallOptions = {}): Promise<JobsPage> {
    const body = record(await this.send(core.listJobsRequest(options), options));
    const next = typeof body.next_cursor === "string" ? body.next_cursor : undefined;
    return {
      jobs: array(body.jobs).map((raw) => {
        const job = record(raw) as unknown as JobSummary;
        return { ...job, ...jobStatus(job) };
      }),
      ...(next ? { nextCursor: next } : {}),
    };
  }

  /**
   * One page of your tasks, newest first, including those of jobs and crawls.
   * Items carry no result: fetch it with {@link getTask}.
   */
  async listTasks(options: ListTasksOptions & CallOptions = {}): Promise<TasksPage> {
    const body = record(await this.send(core.listTasksRequest(options), options));
    const next = typeof body.next_cursor === "string" ? body.next_cursor : undefined;
    return {
      tasks: array(body.tasks).map((raw) => {
        const task = record(raw) as unknown as TaskSummary;
        return { ...task, job_id: task.job_id ?? null };
      }),
      ...(next ? { nextCursor: next } : {}),
    };
  }

  /** Poll until the job is done. Without `timeoutMs` it waits indefinitely. */
  async waitJob(jobId: string, options: CallOptions = {}): Promise<JobStatus> {
    // The timeout bounds the whole wait, not each poll.
    const { timeoutMs, ...perPoll } = options;
    const deadline = timeoutMs === undefined ? null : Date.now() + timeoutMs;
    for (;;) {
      const status = await this.getJob(jobId, perPoll);
      if (status.done) return status;
      if (deadline !== null && Date.now() + this.pollIntervalMs >= deadline) {
        throw new WaitTimeout(`job ${jobId} is still running`, jobId, status);
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  /** Create a job, wait for it, and return its results. */
  async runJob(
    urls: string[],
    options: ScrapeOptions & CallOptions & { sequential?: boolean } = {},
  ): Promise<JobResults> {
    const id = await this.createJob(urls, options);
    await this.waitJob(id, options);
    return this.jobResults(id, options);
  }

  /** Create a prompt job, wait for it, and return its results. */
  async runAskJob(
    prompts: string[],
    options: AskOptions & CallOptions & { sequential?: boolean },
  ): Promise<JobResults> {
    const id = await this.createAskJob(prompts, options);
    await this.waitJob(id, options);
    return this.jobResults(id, options);
  }

  /** Create a search job, wait for it, and return its results. */
  async runSearchJob(
    queries: string[],
    options: SearchOptions & CallOptions & { sequential?: boolean } = {},
  ): Promise<JobResults> {
    const id = await this.createSearchJob(queries, options);
    await this.waitJob(id, options);
    return this.jobResults(id, options);
  }

  // --- account -----------------------------------------------------------

  /** Which task types and LLM engines are switched on right now. Needs no key. */
  async capabilities(options: CallOptions = {}): Promise<Capabilities> {
    const request = new core.Request(
      "GET",
      "/config/capabilities",
      undefined,
      undefined,
      undefined,
      false,
    );
    return new Capabilities(record(await this.send(request, options)));
  }

  /** The browser actions `jsInstructions` accepts, with their arguments. Needs no key. */
  async jsInstructions(options: CallOptions = {}): Promise<JsInstruction[]> {
    const request = new core.Request(
      "GET",
      "/config/js-instructions",
      undefined,
      undefined,
      undefined,
      false,
    );
    const body = record(await this.send(request, options));
    return Array.isArray(body.instructions) ? (body.instructions as JsInstruction[]) : [];
  }

  /** The LLM providers and models `ai` accepts. Needs no key. */
  async aiProviders(options: CallOptions = {}): Promise<AIProvider[]> {
    const request = new core.Request(
      "GET",
      "/config/ai-providers",
      undefined,
      undefined,
      undefined,
      false,
    );
    const body = record(await this.send(request, options));
    return Array.isArray(body.providers) ? (body.providers as AIProvider[]) : [];
  }

  /**
   * Whether the API is up. `deep` also checks the dependencies it needs to
   * serve scrapes. A degraded report is returned, not thrown: read `ok`.
   * Needs no key.
   */
  async health(options: CallOptions & { deep?: boolean } = {}): Promise<Health> {
    const body = record(await this.send(core.healthRequest(options.deep ?? false), options));
    return { ...(body as unknown as Health), ok: body.status === "ok" };
  }

  /**
   * Which anti-bot protection sits in front of each URL. Nothing is scraped
   * and nothing is charged; invalid URLs are skipped.
   */
  async checkProtection(urls: string[], options: CallOptions = {}): Promise<ProtectionCheck[]> {
    return list(
      await this.send(new core.Request("POST", "/filter/check", undefined, [...urls]), options),
    ) as ProtectionCheck[];
  }

  /** Countries, regions and cities a proxy type can exit from. */
  async proxyLocations(
    options: CallOptions & { proxyType?: string } = {},
  ): Promise<ProxyCountry[]> {
    const params = options.proxyType ? { proxy_type: options.proxyType } : undefined;
    return list(
      await this.send(new core.Request("GET", "/config/proxy/locations", params), options),
    ) as ProxyCountry[];
  }

  /** ASNs a proxy type can exit from in one country (ISO 3166-1 alpha-2). */
  async proxyAsns(
    country: string,
    options: CallOptions & { proxyType?: string } = {},
  ): Promise<ProxyLocation[]> {
    const params: Record<string, string> = { country };
    if (options.proxyType) params.proxy_type = options.proxyType;
    return list(
      await this.send(new core.Request("GET", "/config/proxy/asn", params), options),
    ) as ProxyLocation[];
  }

  /** Remaining credits: plan and pay-as-you-go together. */
  async balance(options: CallOptions = {}): Promise<number> {
    const body = await this.send(new core.Request("GET", "/users/@me/balance"), options);
    return intField(body, "balance");
  }

  /** Remaining credits by pool: plan credits (spent first) and pay-as-you-go credits. */
  async balanceSplit(options: CallOptions = {}): Promise<BalanceSplit> {
    const body = await this.send(new core.Request("GET", "/users/@me/balance"), options);
    return {
      balance: intField(body, "balance"),
      plan_balance: intField(body, "plan_balance"),
      payg_balance: intField(body, "payg_balance"),
    };
  }

  /**
   * Credit movements, newest first: plan assignments, credit pack purchases, usage, refunds, expiry.
   * `sums` totals each operation over the whole range, not just this page.
   */
  async transactions(options: TransactionsOptions & CallOptions = {}): Promise<TransactionsPage> {
    const body = record(await this.send(core.transactionsRequest(options), options));
    return {
      transactions: array(body.transactions) as TransactionsPage["transactions"],
      total_count: Number(body.total_count ?? 0),
      sums: array(body.sums) as TransactionsPage["sums"],
    };
  }

  /** Usage over a date range: totals, a time series and breakdowns. Default: the last 30 days. */
  async analytics(options: AnalyticsOptions & CallOptions = {}): Promise<Analytics> {
    const body = record(await this.send(core.analyticsRequest(options), options));
    return {
      ...(body as unknown as Analytics),
      timeseries: array(body.timeseries) as Analytics["timeseries"],
      by_module: array(body.by_module) as Analytics["by_module"],
      top_targets: array(body.top_targets) as Analytics["top_targets"],
      by_status_code: array(body.by_status_code) as Analytics["by_status_code"],
    };
  }

  /** The account behind the API key. */
  async me(options: CallOptions = {}): Promise<Profile> {
    const body = await this.send(new core.Request("GET", "/users/@me"), options);
    return record(body) as unknown as Profile;
  }

  /**
   * Revoke the current key and return the new one.
   *
   * This is the only time the new key is shown. The client keeps using the
   * revoked one: store the new key and build a new client with it.
   */
  async resetApiKey(options: CallOptions = {}): Promise<string> {
    const body = await this.send(new core.Request("POST", "/users/@me/api-key/reset"), options);
    return strField(body, "api_key");
  }
}

export type { Capability };

/** The API key from the environment, on runtimes that have one. */
function envApiKey(): string | undefined {
  return typeof process !== "undefined" ? process.env?.DATAFUEL_API_KEY : undefined;
}

async function parse(response: Response, degradedOk = false): Promise<unknown> {
  const text = await response.text();
  let body: unknown;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (degradedOk && response.status === 503 && isHealthReport(body)) return body;
  if (!response.ok) {
    const header = response.headers.get("Retry-After");
    const retryAfter = header !== null && !Number.isNaN(Number(header)) ? Number(header) : 0;
    throw apiError(response.status, body, retryAfter);
  }
  return body;
}

function isHealthReport(body: unknown): boolean {
  return body !== null && typeof body === "object" && "status" in body;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/** Turn a surprise answer into a DataFuelError rather than a TypeError later. */
function record(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new DataFuelError(`unexpected answer from the API: ${JSON.stringify(body) ?? "empty"}`);
  }
  return body as Record<string, unknown>;
}

function list(body: unknown): unknown[] {
  if (!Array.isArray(body)) {
    throw new DataFuelError(`unexpected answer from the API: ${JSON.stringify(body) ?? "empty"}`);
  }
  return body;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function jobStatus(body: unknown): JobStatus {
  const raw = record(body) as unknown as Partial<JobStatus>;
  return {
    status: raw.status as JobStatus["status"],
    tasks_count: raw.tasks_count ?? 0,
    tasks_done: raw.tasks_done ?? 0,
    tasks_remaining: raw.tasks_remaining ?? 0,
    total_cost: raw.total_cost ?? 0,
    done: isDone(raw.status),
  };
}

function cancelResult(body: unknown): CancelResult {
  const raw = record(body) as unknown as Partial<CancelResult>;
  return {
    ...jobStatus(body),
    refunded_tasks: raw.refunded_tasks ?? 0,
    refunded_credits: raw.refunded_credits ?? 0,
  };
}

function field(body: unknown, name: string): unknown {
  const value = record(body)[name];
  if (value === undefined || value === null) {
    throw new DataFuelError(`unexpected answer from the API: no ${name} field`);
  }
  return value;
}

function strField(body: unknown, name: string): string {
  return String(field(body, name));
}

function intField(body: unknown, name: string): number {
  const value = Number(field(body, name));
  if (Number.isNaN(value)) {
    throw new DataFuelError(`unexpected answer from the API: ${name} is not a number`);
  }
  return value;
}
