/** Request options and response shapes. */

import { Blocked, DataFuelError, TaskFailed } from "./errors.js";

/** State of a task, job or crawl. Unknown states are treated as not final. */
export type Status =
  | "created"
  | "pending"
  | "processing"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "cancelled";

const TERMINAL = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

/** Whether a state is final. */
export function isDone(status: string | undefined): boolean {
  return status !== undefined && TERMINAL.has(status);
}

/**
 * Shape of the scraped content.
 *
 * `html` raw page (API default), `markdown` cleaned text (best for LLMs),
 * `json` schema.org / JSON-LD, `png` / `jpeg` full-page screenshot.
 */
export type Format = "html" | "markdown" | "json" | "png" | "jpeg";

/** AI assistant `ask` can query. Engines can be switched off at runtime. */
export type Engine = "openai" | "gemini" | "google_ai_mode" | "perplexity" | "copilot";

/** Proxy plan. Matched case-insensitively; deployments may define others. */
export type ProxyType = "Basic" | "Premium" | (string & {});

/** The exit the request leaves from. Every field optional: the account default. */
export interface Proxy {
  type?: ProxyType;
  /** ISO 3166-1 alpha-2, e.g. "US". */
  country?: string;
  city?: string;
  state?: string;
  asn?: string;
  /**
   * Sticky session: the same exit across requests, `ttl` in seconds. Read by
   * `scrape`, `map`, URL jobs and crawls, and sent in attributes rather than
   * the envelope.
   */
  sessionId?: string;
  ttl?: number;
}

/**
 * Post-process the page with an LLM, using your own key.
 *
 * Not supported on crawls: the API rejects `result_use_ai` there.
 */
export interface AI {
  /** What to extract. */
  prompt?: string;
  /** Example JSON object the output must follow. */
  format?: unknown;
  provider?: "openai" | "anthropic" | "google";
  model?: string;
  apiKey?: string;
}

/** Page options, shared by `scrape`, jobs and crawls. */
export interface ScrapeOptions {
  format?: Format;
  /**
   * Render the page in a real browser: slower, five times the credits on a
   * Basic proxy. Leave it off unless the page comes back empty without it.
   */
  jsRendering?: boolean;
  waitFor?: string;
  waitForTimeoutMs?: number;
  /** An object keyed by action, e.g. `{ click: "#more" }`. `df.jsInstructions()` lists them. */
  jsInstructions?: unknown;
  blockResource?: string;
  /** Markdown only: always render just the `<main>` / `<article>` container. */
  mainContentOnly?: boolean;
  /** Markdown only: `false` drops images and saves tokens. */
  includeImages?: boolean;
  /**
   * Extract only matching elements: field name to CSS selector. Append
   * ` @attr` to read an attribute, e.g. `{ links: "a @href" }`.
   */
  extract?: string | Record<string, string>;
  /** The same with RE2 patterns on the raw HTML. */
  extractRegex?: string | Record<string, string>;
  /**
   * Built-in extractors, comma separated: images, links, headings,
   * phone_numbers, emails, meta_tags, tables, schema_org, all.
   */
  template?: string;
  method?: string;
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
  headerOrder?: string[];
  cookies?: string;
  userAgent?: string;
  /** chrome, firefox, safari, edge. */
  userAgentType?: string;
  ai?: AI;
}

/** Options every call accepts. */
export interface CallOptions {
  proxy?: Proxy;
  /** Generated per request when omitted. Max 255 characters. */
  idempotencyKey?: string;
  /** Overrides the client's timeout for this call. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** The raw `result` object of a task. */
export interface Payload {
  data?: unknown;
  status?: Status;
  error_detail?: string;
  status_code?: number;
}

/**
 * One scraped target with its metadata.
 *
 * Read the metadata before the content: a 200 can be an error page,
 * `redirected` means `finalUrl` is not what you asked for, and a 404 still
 * completes and bills.
 */
export class Result {
  readonly id: string | undefined;
  readonly status: Status | undefined;
  /** HTTP status the target answered. */
  readonly statusCode: number | undefined;
  readonly finalUrl: string | undefined;
  readonly redirected: boolean;
  /** Charged for this task, 0 when it failed. */
  readonly creditsUsed: number;
  readonly durationMs: number | undefined;
  readonly blocked: boolean;
  /** Anti-bot vendor recognised when blocked. */
  readonly protection: string | undefined;
  readonly error: string | undefined;
  /** The raw `result` object. Prefer `text`, `data` and `image`. */
  readonly payload: Payload | undefined;
  /** Everything the API sent, including fields this SDK does not know yet. */
  readonly raw: Record<string, unknown>;

  constructor(raw: Record<string, unknown>) {
    this.raw = raw;
    this.id = str(raw.id);
    this.status = str(raw.status) as Status | undefined;
    this.statusCode = num(raw.status_code);
    this.finalUrl = str(raw.final_url);
    this.redirected = raw.redirected === true;
    this.creditsUsed = num(raw.credits_used) ?? 0;
    this.durationMs = num(raw.duration_ms);
    this.blocked = raw.blocked === true;
    this.protection = str(raw.protection);
    this.error = str(raw.error);
    this.payload =
      raw.result !== null && typeof raw.result === "object" ? (raw.result as Payload) : undefined;
  }

  /** Effective state: the envelope's, else the payload's, else inferred. */
  get state(): string {
    if (this.status) return this.status;
    if (this.payload?.status) return this.payload.status;
    if (this.payload?.data !== undefined && this.payload.data !== null) return "completed";
    return "pending";
  }

  /** Whether the task has not finished yet (job and crawl results list stubs). */
  get pending(): boolean {
    return !isDone(this.state);
  }

  /** Whether the task completed and the target was not blocked. */
  get ok(): boolean {
    return this.state === "completed" && !this.blocked;
  }

  /** The structured output: format json, extract, template, AI. */
  get data(): unknown {
    return this.payload?.data;
  }

  /** Content of an html or markdown result; the raw JSON for structured ones. */
  get text(): string {
    const value = this.data;
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  /** Bytes of a png or jpeg screenshot. Throws when the result is not one. */
  get image(): Uint8Array {
    try {
      return Uint8Array.from(atob(this.text), (char) => char.charCodeAt(0));
    } catch (cause) {
      throw new DataFuelError("result is not a png or jpeg screenshot", { cause });
    }
  }

  /** `data`, or throw when the task carried none. */
  requireData(): unknown {
    if (this.data === undefined || this.data === null) {
      throw new DataFuelError(`result has no data (status ${this.state})`);
    }
    return this.data;
  }

  /** Throw TaskFailed, or Blocked, when this task failed. Refunded either way. */
  raiseForStatus(): void {
    if (this.state === "failed") {
      throw this.blocked ? new Blocked(this) : new TaskFailed(this);
    }
  }
}

/** One crawled page: where it was found, plus the scrape result. */
export class CrawlPage extends Result {
  readonly url: string;
  readonly depth: number;
  readonly taskId: string | undefined;

  constructor(raw: Record<string, unknown>) {
    super(raw);
    this.url = str(raw.url) ?? "";
    this.depth = num(raw.depth) ?? 0;
    this.taskId = str(raw.task_id);
  }
}

/** One discovered URL. */
export interface Link {
  url: string;
  /** "sitemap" or "page". */
  source: string;
  /** Page links only. */
  title?: string;
  /** Sitemap links only. */
  lastmod?: string;
}

/**
 * What `map` found.
 *
 * `reason` says why `links` is empty: page_blocked, page_error,
 * page_unreachable, no_links_on_page (try scrape with jsRendering), no_sitemap,
 * sitemap_no_entries, search_no_match.
 */
export interface SiteMap {
  url: string;
  links: Link[];
  total: number;
  /** `limit` or the time budget cut the list. */
  truncated: boolean;
  sitemaps: string[];
  page_status_code: number;
  reason?: string;
  credits: number;
  /** Envelope of the underlying task. */
  task: Result;
}

/** Progress of a crawl. */
export interface CrawlStatus {
  status: Status;
  /** Empty while the crawl still grows: max_pages, max_depth_exhausted, insufficient_credits, cancelled. */
  stop_reason?: string;
  pages: { discovered: number; enqueued: number; done: number; failed: number; skipped: number };
  depth_reached: number;
  /**
   * Charged at queue time; refunds of failed pages are not subtracted. Sum
   * `creditsUsed` over the pages for the net figure.
   */
  total_cost: number;
  /** Whether the crawl reached a final state. */
  done: boolean;
  /** RFC 3339. */
  created_at?: string;
  updated_at?: string;
}

/** One page of crawl results. */
export interface CrawlResultsPage {
  pages: CrawlPage[];
  /** Absent on the last page. */
  nextCursor?: string;
}

/** A finished crawl: why it stopped and what it found. */
export interface CrawlResult {
  id: string;
  status: CrawlStatus;
  pages: CrawlPage[];
}

/** Progress of a job. */
export interface JobStatus {
  status: Status;
  tasks_count: number;
  tasks_done: number;
  tasks_remaining: number;
  total_cost: number;
  done: boolean;
}

/** A cancelled job or crawl: its final progress and what was refunded. */
export interface CancelResult extends JobStatus {
  refunded_tasks: number;
  refunded_credits: number;
}

/** Every task of a job. A job completes even when some of its tasks failed. */
export interface JobResults {
  id: string;
  tasks_count: number;
  tasks_failed: number;
  tasks_complete: number;
  tasks: Result[];
}

/** A task type, as the list and analytics filters take it. */
export type TaskType = "unlocker" | "llm_scraping" | "serp" | "map" | "crawl" | (string & {});

/** Filters shared by {@link DataFuel.listJobs} and {@link DataFuel.listTasks}. */
export interface ListOptions {
  status?: Status;
  type?: TaskType;
  /** Created on or after this day (UTC). A Date is sent as its UTC day. */
  startDate?: string | Date;
  /** Created on or before this day (UTC, inclusive). */
  endDate?: string | Date;
  /** Items per page. API default 50, max 200. */
  limit?: number;
  /** `nextCursor` of the previous page. */
  cursor?: string;
}

/** {@link ListOptions} plus the job or crawl the tasks belong to. */
export interface ListTasksOptions extends ListOptions {
  jobId?: string;
}

/** A job or crawl in a list, with the same counters as {@link JobStatus}. */
export interface JobSummary extends JobStatus {
  id: string;
  /** `crawl` for a crawl, otherwise the task type of the batch. */
  type: TaskType;
  /** RFC 3339. */
  created_at: string;
  updated_at: string;
}

/** One page of jobs, newest first. */
export interface JobsPage {
  jobs: JobSummary[];
  /** Absent on the last page. */
  nextCursor?: string;
}

/** A task in a list. It has no result: fetch that with {@link DataFuel.getTask}. */
export interface TaskSummary {
  id: string;
  /** `null` for a task created on its own rather than by a job or crawl. */
  job_id: string | null;
  type: TaskType;
  status: Status;
  /** Absent for `llm_scraping` and `serp`. */
  url?: string;
  /** Charged when queued; a failed task is refunded. */
  credit_cost: number;
  /** RFC 3339. */
  created_at: string;
  processed_at?: string;
  failed_at?: string;
}

/** One page of tasks, newest first. */
export interface TasksPage {
  tasks: TaskSummary[];
  /** Absent on the last page. */
  nextCursor?: string;
}

/** What moved credits on the account. */
export type TransactionOperation =
  | "plan_assignment"
  | "purchase"
  | "usage"
  | "refund"
  | "topup"
  | "expiry"
  | "adjustment"
  | (string & {});

/** Filters and paging for {@link DataFuel.transactions}. */
export interface TransactionsOptions {
  operation?: TransactionOperation;
  startDate?: string | Date;
  endDate?: string | Date;
  /** 1-based. API default 1. */
  page?: number;
  /** API default 10, max 200. */
  limit?: number;
}

/** One credit movement. `amount` is negative for usage and expiry. */
export interface Transaction {
  id: number;
  amount: number;
  /** The part of `amount` that moved plan credits, same sign; the rest moved pay-as-you-go credits. */
  plan_amount?: number;
  operation: TransactionOperation;
  /** What `reference_id` points to, e.g. `task_id` or `job_id`. */
  reference_type: string;
  reference_id: string;
  /** The balance right after this movement. */
  balance_after?: number;
  /** RFC 3339. */
  created_at: string;
}

/** Total of one operation over the whole filtered range, not just the page. */
export interface TransactionSum {
  operation: TransactionOperation;
  total: number;
  count: number;
}

/** One page of credit movements, newest first. */
export interface TransactionsPage {
  transactions: Transaction[];
  /** Movements matching the filters across all pages. */
  total_count: number;
  sums: TransactionSum[];
}

/** Range and grouping for {@link DataFuel.analytics}. */
export interface AnalyticsOptions {
  /** API default 30 days ago. The range may span at most 365 days. */
  startDate?: string | Date;
  /** Inclusive. API default today. */
  endDate?: string | Date;
  /** Time series bucket. API default `daily`. */
  interval?: "hourly" | "daily" | "weekly" | "monthly";
  /** Restrict to one task type. */
  module?: TaskType;
}

/** Task counts and net credits of one slice. Failed tasks are refunded and count 0 credits. */
export interface AnalyticsCounts {
  total: number;
  completed: number;
  failed: number;
  credits_used: number;
}

/** Tasks by the HTTP status the target answered. `status_code` 0 means no answer (timeout, DNS). */
export interface StatusCodeBreakdown {
  status_code: number;
  count: number;
  completed: number;
  failed: number;
  credits_used: number;
  avg_credits_per_request: number;
}

/** The same figures for the equally long period before, and the change in percent. */
export interface PreviousPeriod {
  credits_used: number;
  fulfilled_requests: number;
  failed_requests: number;
  failed_percentage: number;
  efficiency_score: number;
  credits_used_change: number;
  fulfilled_requests_change: number;
  failed_requests_change: number;
  efficiency_score_change: number;
}

/** Usage over a date range. Percentages are 0-100. */
export interface Analytics {
  summary: {
    total_tasks: number;
    credits_used: number;
    fulfilled_requests: number;
    failed_requests: number;
    failed_percentage: number;
    success_rate: number;
    efficiency_score: number;
    avg_credits_per_request: number;
    avg_duration_ms: number;
    previous_period?: PreviousPeriod | null;
  };
  timeseries: (AnalyticsCounts & { period: string })[];
  by_module: (AnalyticsCounts & {
    module: string;
    success_rate: number;
    avg_credits_per_request: number;
    avg_duration_ms: number;
    status_codes: StatusCodeBreakdown[];
  })[];
  top_targets: (AnalyticsCounts & { target: string })[];
  by_status_code: StatusCodeBreakdown[];
}

/**
 * Credits by pool. Plan credits are spent first, roll over when the plan renews and
 * expire if it is not renewed. Pay-as-you-go credits come from credit packs, are spent
 * after plan credits and never expire.
 */
export interface BalanceSplit {
  /** Total spendable credits: `plan_balance` plus `payg_balance`. */
  balance: number;
  plan_balance: number;
  payg_balance: number;
}

/** The account behind the API key. */
export interface Profile {
  email: string;
  username: string;
  current_concurrency: number;
  concurrency_limit: number;
  /** Total spendable credits: `plan_credit_balance` plus `payg_credit_balance`. */
  credit_balance: number;
  /** Spent first; expire if the plan is not renewed. */
  plan_credit_balance?: number;
  /** Spent after plan credits; never expire. */
  payg_credit_balance?: number;
  monthly_credit_limit: number;
}

/** One argument of a browser action. */
export interface JsInstructionArg {
  name: string;
  type: string;
  values?: string[];
  required: boolean;
}

/** One browser action `jsInstructions` accepts. */
export interface JsInstruction {
  action: string;
  description: string;
  /** Shape of the value: scalar, array or object. */
  value: string;
  args: JsInstructionArg[];
  /** Whether it can target an element inside an iframe. */
  iframe: boolean;
  example: unknown;
}

/** A named proxy location: a city, or an ASN. */
export interface ProxyLocation {
  code: string;
  name: string;
}

/** A proxy country with its regions and their cities. */
export interface ProxyCountry {
  code: string;
  name: string;
  regions: { code: string; name: string; cities: ProxyLocation[] }[];
}

/** One task type or LLM engine, and whether it accepts new work. */
export interface Capability {
  name: string;
  enabled: boolean;
  /** Operator's note when switched off. */
  reason?: string;
}

/** What the API accepts right now. */
export class Capabilities {
  readonly modules: Capability[];
  readonly engines: Capability[];

  constructor(raw: Record<string, unknown>) {
    this.modules = Array.isArray(raw.modules) ? (raw.modules as Capability[]) : [];
    this.engines = Array.isArray(raw.engines) ? (raw.engines as Capability[]) : [];
  }

  /** Whether a task type accepts work. Unknown names report false. */
  moduleEnabled(name: string): boolean {
    return this.modules.some((item) => item.name === name && item.enabled);
  }

  /** Whether an LLM engine accepts work. Unknown names report false. */
  engineEnabled(name: Engine | string): boolean {
    return this.engines.some((item) => item.name === name && item.enabled);
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
