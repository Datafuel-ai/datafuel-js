/**
 * Request building and answer classification. Pure functions, no I/O.
 *
 * Every decision lives here — which envelope a module needs, where the sticky
 * session keys go, how `ai` expands, whether an answer is retryable — so the
 * client only moves bytes.
 */

import { APIError, Unavailable } from "./errors.js";
import type {
  AI,
  AnalyticsOptions,
  Engine,
  ListOptions,
  ListTasksOptions,
  Proxy,
  ScrapeOptions,
  TransactionsOptions,
} from "./models.js";

export const DEFAULT_BASE_URL = "https://scraping-api.datafuel.ai/api/v1";

/** Kept in step with package.json by a test; see test/hardening.test.ts. */
export const VERSION = "0.3.0";

/** How long a synchronous call waits for a result before giving up. */
export const DEFAULT_TIMEOUT_MS = 180_000;
/** Gap between two attempts at a task the API is still processing. */
export const STILL_PROCESSING_DELAY_MS = 2_000;
export const STILL_PROCESSING = "TASK_STILL_PROCESSING";
/** The API rejects a longer key with 400; catching it here saves the round trip. */
export const MAX_IDEMPOTENCY_KEY = 255;

/** One HTTP call, ready for the client to send. */
export class Request {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly params?: Record<string, string>,
    readonly body?: Record<string, unknown>,
    readonly idempotencyKey?: string,
    readonly auth: boolean = true,
  ) {}

  /** GETs are safe by nature, writes because they carry an idempotency key. */
  get retryable(): boolean {
    return this.method === "GET" || this.idempotencyKey !== undefined;
  }

  /**
   * Method and path only. The body can hold an LLM key or a cookie header, so
   * neither logging nor JSON.stringify may spill it.
   */
  toString(): string {
    return `<Request ${this.method} ${this.path}>`;
  }

  toJSON(): string {
    return this.toString();
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}

/**
 * Escape an id before it becomes part of a URL path.
 *
 * An id is caller data. Unescaped, a stray `/` or `?` in one would move the
 * request to a different endpoint.
 */
export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** The headers every call carries. The idempotency key sits beside the API key. */
export function headers(
  apiKey: string,
  userAgent: string,
  request: Request,
): Record<string, string> {
  const out: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": userAgent,
  };
  if (apiKey) out["X-API-Key"] = apiKey;
  if (request.body !== undefined) out["Content-Type"] = "application/json";
  if (request.idempotencyKey !== undefined) out["Idempotency-Key"] = request.idempotencyKey;
  return out;
}

/** The API takes multi-field extractors as a JSON object string. */
function selector(value: string | Record<string, string>): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function aiAttributes(ai: AI): Record<string, unknown> {
  const out: Record<string, unknown> = { result_use_ai: true };
  if (ai.prompt) out.result_ai_prompt = ai.prompt;
  if (ai.format !== undefined) out.result_ai_format = ai.format;
  if (ai.provider) out.ai_provider = ai.provider;
  if (ai.model) out.ai_model = ai.model;
  if (ai.apiKey) out.ai_api_key = ai.apiKey;
  return out;
}

/**
 * Catch a half-filled AI key before it costs a request. The API does not check
 * these, so a missing one would be spent on a scrape whose AI step then fails.
 */
export function validateAI(ai: AI): void {
  const given = {
    provider: ai.provider !== undefined,
    model: ai.model !== undefined,
    apiKey: ai.apiKey !== undefined,
  };
  const present = Object.values(given).filter(Boolean).length;
  if (present > 0 && present < 3) {
    const missing = Object.entries(given)
      .filter(([, ok]) => !ok)
      .map(([name]) => name)
      .join(", ");
    throw new TypeError(`ai needs provider, model and apiKey together; missing: ${missing}`);
  }
}

/**
 * Flatten the page options into the API's `attributes` object.
 *
 * Unset options are left out of the body entirely, never sent as null.
 */
export function scrapeAttributes(options: ScrapeOptions = {}): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  if (options.format) attrs.result_format = options.format;
  if (options.jsRendering) attrs.js_rendering = true;
  if (options.waitFor) attrs.wait_for_selector = options.waitFor;
  if (options.waitForTimeoutMs) attrs.wait_for_selector_timeout_ms = options.waitForTimeoutMs;
  if (options.jsInstructions) attrs.js_instructions = options.jsInstructions;
  if (options.blockResource) attrs.block_resource = options.blockResource;
  if (options.mainContentOnly) attrs.main_content_only = true;
  if (options.includeImages !== undefined) attrs.include_images = options.includeImages;
  if (options.extract) attrs.extract_selector = selector(options.extract);
  if (options.extractRegex) attrs.extract_regex = selector(options.extractRegex);
  if (options.template) attrs.result_template = options.template;
  if (options.method) attrs.method = options.method;
  if (options.body) attrs.body = options.body;
  if (options.contentType) attrs.content_type = options.contentType;
  if (options.headers) attrs.headers = options.headers;
  if (options.headerOrder) attrs.header_order = options.headerOrder;
  if (options.cookies) attrs.cookie_string = options.cookies;
  if (options.userAgent) attrs.user_agent = options.userAgent;
  if (options.userAgentType) attrs.user_agent_type = options.userAgentType;
  if (options.ai) {
    validateAI(options.ai);
    Object.assign(attrs, aiAttributes(options.ai));
  }
  return attrs;
}

/** The proxy fields that travel in the request envelope. */
export function proxyEnvelope(proxy: Proxy | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!proxy) return out;
  if (proxy.type) out.proxy_type = proxy.type;
  if (proxy.country) out.proxy_country = proxy.country;
  if (proxy.city) out.proxy_city = proxy.city;
  if (proxy.state) out.proxy_state = proxy.state;
  if (proxy.asn) out.proxy_asn = proxy.asn;
  return out;
}

/** The sticky-session fields, which travel in `attributes`. */
export function proxySession(proxy: Proxy | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!proxy) return out;
  if (proxy.sessionId) out.proxy_session_id = proxy.sessionId;
  if (proxy.ttl) out.proxy_ttl = proxy.ttl;
  return out;
}

/** The body every write shares. */
export function envelope(
  taskType: string,
  attributes: Record<string, unknown>,
  extra: { proxy?: Proxy | undefined; multithreaded?: boolean | undefined } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = { type: taskType, ...proxyEnvelope(extra.proxy) };
  if (extra.multithreaded !== undefined) body.multithreaded = extra.multithreaded;
  body.attributes = attributes;
  return body;
}

export function key(explicit: string | undefined): string {
  if (explicit !== undefined && explicit.length > MAX_IDEMPOTENCY_KEY) {
    throw new TypeError(`idempotencyKey is longer than ${MAX_IDEMPOTENCY_KEY} characters`);
  }
  return explicit ?? newIdempotencyKey();
}

export function buildScrape(
  url: string,
  options: ScrapeOptions,
  proxy: Proxy | undefined,
  idempotencyKey: string,
): Request {
  const attrs = { ...scrapeAttributes(options), url, ...proxySession(proxy) };
  return new Request(
    "POST",
    "/task",
    undefined,
    envelope("unlocker", attrs, { proxy }),
    idempotencyKey,
  );
}

export function buildJob(
  urls: string[],
  options: ScrapeOptions,
  proxy: Proxy | undefined,
  sequential: boolean,
  idempotencyKey: string,
): Request {
  const attrs = { ...scrapeAttributes(options), urls: [...urls], ...proxySession(proxy) };
  return new Request(
    "POST",
    "/job",
    undefined,
    envelope("unlocker", attrs, { proxy, multithreaded: !sequential }),
    idempotencyKey,
  );
}

/** Options for the llm_scraping module, which reads its proxy country here. */
export interface AskOptions {
  engine: Engine | string;
  websearch?: boolean;
  followUp?: string;
  country?: string;
  location?: string;
  format?: string;
}

export function askAttributes(
  promptField: string,
  prompt: string | string[],
  options: AskOptions,
): Record<string, unknown> {
  const attrs: Record<string, unknown> = { [promptField]: prompt, engine: options.engine };
  if (options.websearch) attrs.websearch = true;
  if (options.followUp) attrs.follow_up_prompt = options.followUp;
  if (options.country) attrs.proxy_country = options.country;
  if (options.location) attrs.location = options.location;
  if (options.format) attrs.result_format = options.format;
  return attrs;
}

export function buildAsk(prompt: string, options: AskOptions, idempotencyKey: string): Request {
  const attrs = askAttributes("prompt", prompt, options);
  return new Request("POST", "/task", undefined, envelope("llm_scraping", attrs), idempotencyKey);
}

export function buildAskJob(
  prompts: string[],
  options: AskOptions,
  sequential: boolean,
  idempotencyKey: string,
): Request {
  const attrs = askAttributes("prompts", [...prompts], options);
  return new Request(
    "POST",
    "/job",
    undefined,
    envelope("llm_scraping", attrs, { multithreaded: !sequential }),
    idempotencyKey,
  );
}

/** Options for `map`. */
export interface MapOptions {
  /** Keep only links whose URL or title contains this. */
  search?: string;
  /** Map only this sitemap, from a previous `SiteMap.sitemaps`. */
  sitemap?: string;
  /** Default 5000, capped at 10000. */
  limit?: number;
  includeSubdomains?: boolean;
  ignoreSitemap?: boolean;
  sitemapOnly?: boolean;
  userAgent?: string;
  userAgentType?: string;
}

export function buildMap(
  url: string,
  options: MapOptions,
  proxy: Proxy | undefined,
  idempotencyKey: string,
): Request {
  const attrs: Record<string, unknown> = { url };
  if (options.search) attrs.search = options.search;
  if (options.sitemap) attrs.sitemap = options.sitemap;
  if (options.limit) attrs.limit = options.limit;
  if (options.includeSubdomains) attrs.include_subdomains = true;
  if (options.ignoreSitemap) attrs.ignore_sitemap = true;
  if (options.sitemapOnly) attrs.sitemap_only = true;
  if (options.userAgent) attrs.user_agent = options.userAgent;
  if (options.userAgentType) attrs.user_agent_type = options.userAgentType;
  Object.assign(attrs, proxySession(proxy));
  return new Request("POST", "/map", undefined, envelope("map", attrs, { proxy }), idempotencyKey);
}

/** Options for `crawl`, on top of the page options applied to every page. */
export interface CrawlOptions extends ScrapeOptions {
  /** Default 100, max 10000. The hard budget of the crawl. */
  maxPages?: number;
  /** Default 3, max 10. The start URL is depth 0. */
  maxDepth?: number;
  /** RE2 on path?query; when set only matches are followed. */
  includePaths?: string[];
  /** RE2 on path?query; exclude wins. */
  excludePaths?: string[];
  includeSubdomains?: boolean;
  allowBackwardLinks?: boolean;
  /** Pages in flight, default 5. */
  concurrency?: number;
}

export function buildCrawl(
  url: string,
  options: CrawlOptions,
  proxy: Proxy | undefined,
  idempotencyKey: string,
): Request {
  if (options.ai) {
    throw new TypeError("crawl does not support ai: the API rejects result_use_ai on crawls");
  }
  const attrs: Record<string, unknown> = { ...scrapeAttributes(options), url };
  if (options.maxPages) attrs.max_pages = options.maxPages;
  if (options.maxDepth) attrs.max_depth = options.maxDepth;
  if (options.concurrency) attrs.concurrency = options.concurrency;
  if (options.includePaths?.length) attrs.include_paths = [...options.includePaths];
  if (options.excludePaths?.length) attrs.exclude_paths = [...options.excludePaths];
  if (options.includeSubdomains) attrs.include_subdomains = true;
  if (options.allowBackwardLinks) attrs.allow_backward_links = true;
  Object.assign(attrs, proxySession(proxy));
  return new Request(
    "POST",
    "/crawl",
    undefined,
    envelope("crawl", attrs, { proxy }),
    idempotencyKey,
  );
}

/** Options for `search`, the Google SERP module. Proxy type is not used. */
export interface SearchOptions {
  /** Google `gl`, e.g. "us". */
  country?: string;
  /** Google `hl`, e.g. "en". */
  language?: string;
  /** Canonical location name. Give at most one of location, uule, lat/lon. */
  location?: string;
  /** 1-based, default 1. */
  page?: number;
  /** e.g. "google.de". */
  googleDomain?: string;
  uule?: string;
  lat?: number;
  lon?: number;
  /** Metres around lat/lon or location, max 1000. */
  radius?: number;
  cr?: string;
  lr?: string;
  tbs?: string;
  safe?: "active" | "off";
  nfpr?: boolean;
  filter?: boolean;
  uds?: string;
  kgmid?: string;
  si?: string;
  ludocid?: string;
  lsig?: string;
  ibp?: string;
  /** Exit country of the request. */
  proxyCountry?: string;
  /** Default json. */
  format?: "json" | "html" | "markdown";
}

export function searchAttributes(
  queryField: string,
  query: string | string[],
  options: SearchOptions,
): Record<string, unknown> {
  const attrs: Record<string, unknown> = { [queryField]: query };
  const strings: [keyof SearchOptions, string][] = [
    ["country", "country"],
    ["language", "language"],
    ["location", "location"],
    ["googleDomain", "google_domain"],
    ["uule", "uule"],
    ["cr", "cr"],
    ["lr", "lr"],
    ["tbs", "tbs"],
    ["safe", "safe"],
    ["uds", "uds"],
    ["kgmid", "kgmid"],
    ["si", "si"],
    ["ludocid", "ludocid"],
    ["lsig", "lsig"],
    ["ibp", "ibp"],
    ["proxyCountry", "proxy_country"],
    ["format", "result_format"],
  ];
  for (const [option, attribute] of strings) {
    if (options[option]) attrs[attribute] = options[option];
  }
  if (options.page) attrs.page = options.page;
  if (options.radius) attrs.radius = options.radius;
  if (options.lat !== undefined) attrs.lat = options.lat;
  if (options.lon !== undefined) attrs.lon = options.lon;
  if (options.nfpr !== undefined) attrs.nfpr = options.nfpr;
  if (options.filter !== undefined) attrs.filter = options.filter;
  return attrs;
}

export function buildSearch(
  query: string,
  options: SearchOptions,
  idempotencyKey: string,
): Request {
  const attrs = searchAttributes("query", query, options);
  return new Request("POST", "/task", undefined, envelope("serp", attrs), idempotencyKey);
}

export function buildSearchJob(
  queries: string[],
  options: SearchOptions,
  sequential: boolean,
  idempotencyKey: string,
): Request {
  const attrs = searchAttributes("queries", [...queries], options);
  return new Request(
    "POST",
    "/job",
    undefined,
    envelope("serp", attrs, { multithreaded: !sequential }),
    idempotencyKey,
  );
}

export function crawlResultsRequest(crawlId: string, cursor?: string, limit?: number): Request {
  const params: Record<string, string> = {};
  if (cursor) params.cursor = cursor;
  if (limit) params.limit = String(limit);
  return new Request(
    "GET",
    `/crawl/${pathSegment(crawlId)}/results`,
    Object.keys(params).length > 0 ? params : undefined,
  );
}

/** A Date as its UTC day, which is what the API's date filters take. */
export function day(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

function query(
  entries: [string, string | number | Date | undefined][],
): Record<string, string> | undefined {
  const params: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (value === undefined || value === "") continue;
    params[name] = value instanceof Date ? day(value) : String(value);
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

function listRequest(path: string, options: ListOptions, jobId?: string): Request {
  const params = query([
    ["status", options.status],
    ["type", options.type],
    ["job_id", jobId],
    ["start_date", options.startDate],
    ["end_date", options.endDate],
    ["limit", options.limit],
    ["cursor", options.cursor],
  ]);
  return new Request("GET", path, params);
}

export function listJobsRequest(options: ListOptions): Request {
  return listRequest("/job", options);
}

export function listTasksRequest(options: ListTasksOptions): Request {
  return listRequest("/task", options, options.jobId);
}

export function transactionsRequest(options: TransactionsOptions): Request {
  const params = query([
    ["operation", options.operation],
    ["start_date", options.startDate],
    ["end_date", options.endDate],
    ["page", options.page],
    ["limit", options.limit],
  ]);
  return new Request("GET", "/users/@me/transactions", params);
}

export function analyticsRequest(options: AnalyticsOptions): Request {
  const params = query([
    ["start_date", options.startDate],
    ["end_date", options.endDate],
    ["interval", options.interval],
    ["module", options.module],
  ]);
  return new Request("GET", "/task/analytics/dashboard", params);
}

/** Whether the API answered "the task is still running" instead of a result. */
export function stillProcessing(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === "object" &&
    (body as Record<string, unknown>).code === STILL_PROCESSING
  );
}

/** Go's retry policy: transport errors, 429, 502, 503, 504 — nothing else. */
export function shouldRetry(error: unknown): boolean {
  if (error instanceof Unavailable) {
    // A deliberate switch-off is a 503 too, but retrying it only adds load: it
    // stays off until an operator turns it back on.
    if (error.code === "MODULE_UNAVAILABLE" || error.code === "ENGINE_UNAVAILABLE") return false;
  }
  if (error instanceof APIError) return [429, 502, 503, 504].includes(error.status);
  return true; // transport error
}

/** 500ms, 1s, 2s, 4s, then 8s flat — halved and randomized. Retry-After wins. */
export function backoff(attempt: number, retryAfterSeconds = 0): number {
  if (retryAfterSeconds > 0) return Math.min(retryAfterSeconds * 1000, 30_000);
  const base = 500 * 2 ** Math.min(attempt, 4);
  return base / 2 + Math.random() * (base / 2);
}

/** Gap before re-sending a task the API is still processing. */
export function pollDelay(attempt: number): number {
  return Math.max(STILL_PROCESSING_DELAY_MS, backoff(attempt));
}
