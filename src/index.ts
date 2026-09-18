/**
 * TypeScript client for the DataFuel scraping API.
 *
 * ```ts
 * import { DataFuel } from "datafuel";
 *
 * const df = new DataFuel();                      // reads DATAFUEL_API_KEY
 * console.log(await df.markdown("https://example.com"));
 * ```
 *
 * Pick the call by the shape of the work:
 *
 * | You have | Call | Waits? |
 * |---|---|---|
 * | One URL | `scrape` / `markdown` | yes |
 * | A site, need its URL list | `map` | yes |
 * | A start URL, many pages | `crawl` / `startCrawl` | `crawl` does |
 * | A list of known URLs | `runJob` / `createJob` | `runJob` does |
 * | A question for an AI engine | `ask` | yes |
 *
 * Start with plain `scrape`. Turn on `jsRendering` only when the page comes
 * back empty: it is slower and costs five times the credits on a Basic proxy.
 * `map` a section before you `crawl` it — one credit, and it tells you how big
 * the section is.
 */

export { DataFuel } from "./client.js";
export type { ClientOptions } from "./client.js";
export { DEFAULT_BASE_URL, VERSION } from "./core.js";
export type { AskOptions, CrawlOptions, MapOptions } from "./core.js";
export {
  APIError,
  Blocked,
  DataFuelError,
  EngineUnavailable,
  IdempotencyKeyReused,
  InsufficientCredits,
  InvalidAttributes,
  ModuleUnavailable,
  NoApiKey,
  NotFound,
  RateLimited,
  TaskFailed,
  TransportError,
  Unauthorized,
  Unavailable,
  WaitTimeout,
} from "./errors.js";
export { Capabilities, CrawlPage, isDone, Result } from "./models.js";
export type {
  AI,
  CallOptions,
  Capability,
  CrawlResult,
  CrawlResultsPage,
  CrawlStatus,
  Engine,
  Format,
  JobResults,
  JobStatus,
  Link,
  Payload,
  Profile,
  Proxy,
  ProxyType,
  ScrapeOptions,
  SiteMap,
  Status,
} from "./models.js";
