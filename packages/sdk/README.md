# @datafuel/sdk

TypeScript client for the [DataFuel](https://datafuel.ai) scraping API. No runtime dependencies, Node 20.3+.

```bash
npm install @datafuel/sdk
```

```ts
import { DataFuel } from "@datafuel/sdk";

const df = new DataFuel(); // or new DataFuel("df_key_..."); reads DATAFUEL_API_KEY

const markdown = await df.markdown("https://example.com");
```

## Pick the call

| You have                     | Call                                                    | Waits?        |
| ---------------------------- | ------------------------------------------------------- | ------------- |
| One URL                      | `scrape` / `markdown`                                   | yes           |
| A site, need its URL list    | `map`                                                   | yes           |
| A start URL, need many pages | `crawl`, or `startCrawl` + `waitCrawl` + `crawlPages`   | `crawl` does  |
| A list of known URLs         | `runJob`, or `createJob` + `waitJob` + `jobResults`     | `runJob` does |
| A question for an AI engine  | `ask`                                                   | yes           |
| A Google search              | `search`                                                | yes           |
| Many prompts or searches     | `runAskJob` / `runSearchJob`                            | yes           |
| Earlier jobs, tasks, usage   | `listJobs` / `listTasks` / `analytics` / `transactions` | yes           |

Start with plain `scrape`. Turn on `jsRendering` only when the page comes back empty: it is slower and costs five times the credits on a Basic proxy. `map` a section before you `crawl` it, it costs one credit and tells you how big it is.

## Scrape

```ts
import { DataFuel, Blocked } from "@datafuel/sdk";

const df = new DataFuel();

try {
  const res = await df.scrape("https://shop.example.com/p/42", {
    proxy: { type: "Premium", country: "US" },
    jsRendering: true,
    waitFor: "#price",
    extract: { title: "h1", price: "#price" },
  });
  console.log(res.data); // { title: [...], price: [...] }
} catch (error) {
  if (error instanceof Blocked) {
    // 403/429/503 or an anti-bot wall. Refunded. error.protection names the vendor.
  }
  throw error;
}
```

`Result` carries the metadata next to the content. Read it first:

| Field                    | Meaning                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| `statusCode`             | What the target answered. A 404 still completes and bills.        |
| `finalUrl`, `redirected` | Where the page really came from.                                  |
| `blocked`, `protection`  | The target refused the request. The task failed and was refunded. |
| `creditsUsed`            | Charged for this task, 0 when it failed.                          |

`res.text` returns html or markdown, `res.data` structured output, `res.image` screenshot bytes.

Page options, shared by `scrape`, jobs and crawls: `format` (`html`, `markdown`, `json`, `png`, `jpeg`), `jsRendering`, `waitFor`, `waitForTimeoutMs`, `jsInstructions` (an object keyed by action, e.g. `{ click: "#more" }`; `df.jsInstructions()` lists the actions), `blockResource`, `mainContentOnly`, `includeImages`, `extract`, `extractRegex`, `template`, `method`, `body`, `contentType`, `headers`, `headerOrder`, `cookies`, `userAgent`, `userAgentType`, `ai`.

`proxy` takes `type`, `country`, `city`, `state`, `asn`, and a sticky `sessionId` with `ttl` (seconds) on `scrape`, `map`, URL jobs and crawls. `df.proxyLocations()` and `df.proxyAsns(country)` list what a proxy type can exit from.

## AI after the scrape

Point the page at an LLM with your own key and get structured data back:

```ts
const res = await df.scrape(url, {
  ai: {
    prompt: "extract the product name and its price",
    format: { name: "string", price: "number" },
    provider: "openai", // openai, anthropic, google
    model: "gpt-4o-mini",
    apiKey: process.env.OPENAI_API_KEY,
  },
});
res.data; // { name: "...", price: ... }
```

Works on `scrape` and on URL jobs. Crawls reject it; the SDK says so before sending. `provider`, `model` and `apiKey` must be given together — a half-filled key would be spent on a scrape whose AI step then fails.

## Crawl

```ts
const id = await df.startCrawl("https://example.com/docs", {
  maxPages: 200,
  excludePaths: ["\\.pdf$"],
  format: "markdown",
});
const status = await df.waitCrawl(id); // status.stop_reason: max_pages, max_depth_exhausted, ...

for await (const page of df.crawlPages(id)) {
  if (page.pending || !page.ok) continue; // still running, or a failed page (refunded)
  console.log(page.url, page.depth, page.text.length);
}
```

`df.crawl(url, options)` does all three in one call:

```ts
const crawl = await df.crawl("https://example.com/docs", { maxPages: 200 });
console.log(crawl.status.stop_reason, crawl.status.total_cost, crawl.pages.length);
```

Check `stop_reason`: `insufficient_credits` means the crawl ended early. If the wait times out, `WaitTimeout.id` still holds the crawl id — it keeps running and billing server side, so pick it up again with `waitCrawl` and `crawlPages`.

Unset limits use the API defaults: 100 pages, depth 3, 5 pages in flight.

`df.cancelCrawl(id)` stops a crawl: queued pages are refunded, pages in flight finish and bill. `df.cancelJob(id)` does the same for a job. Both throw `JobNotCancellable` once the work has finished.

## Jobs

```ts
const results = await df.runJob(urls, { format: "markdown" });
for (const task of results.tasks) {
  if (!task.ok) continue; // this URL failed, the others did not
  console.log(task.text);
}
```

`sequential: true` runs the URLs one after the other; the default runs them concurrently, bounded by your account's concurrency limit. `runAskJob(prompts, { engine })` and `runSearchJob(queries)` do the same for a batch of prompts or Google searches. A job needs at least two targets.

## Ask and search

```ts
const answer = await df.ask("best CRM for a 10-person team", {
  engine: "perplexity", // openai, gemini, google_ai_mode, perplexity, copilot
  websearch: true,
  country: "us",
});
console.log(answer.text);

const serp = await df.search("best crm", { country: "us", language: "en", page: 1 });
console.log(serp.data); // parsed results page; format "html" or "markdown" for the raw page
```

`search` also takes `location` (or `uule`, or `lat`/`lon` with `radius`), `googleDomain`, `tbs`, `safe`, `cr`, `lr`, `nfpr`, `filter` and `proxyCountry`.

## Map

```ts
const site = await df.map("https://example.com", { search: "blog", limit: 500 });
for (const link of site.links) console.log(link.url);
```

An empty `site.links` comes with a `site.reason`. `no_links_on_page` usually means the navigation is rendered client-side.

## Usage and history

```ts
const usage = await df.analytics({ startDate: "2026-09-01", endDate: "2026-09-30" });
console.log(usage.summary.success_rate, usage.summary.avg_credits_per_request);

const { jobs, nextCursor } = await df.listJobs({ type: "crawl", limit: 20 });
const failed = await df.listTasks({ jobId: jobs[0]!.id, status: "failed" });
const history = await df.transactions({ operation: "refund", limit: 50 });
```

`listJobs` and `listTasks` run newest first; pass `nextCursor` back as `cursor` until it is absent. Task items carry no result: call `getTask(id)` for it. Dates are `YYYY-MM-DD` in UTC (a `Date` is sent as its UTC day) and `endDate` is inclusive. `transactions` pages with `page` and `limit`, and its `sums` total each operation over the whole range. In `analytics`, `status_code` 0 means the target never answered (timeout, DNS).

## Errors

```ts
import * as datafuel from "@datafuel/sdk";

try {
  await df.scrape(url);
} catch (error) {
  if (error instanceof datafuel.Blocked) {
    /* subclass of TaskFailed */
  }
  if (error instanceof datafuel.InsufficientCredits) {
    /* top up */
  }
  throw error;
}
```

- `NoApiKey`: no key was passed and `DATAFUEL_API_KEY` is empty. Thrown before any request.
- `APIError`: the API refused the request. `.code` holds the API's error code (typed as `ErrorCode`). Subclasses: `Unauthorized`, `Forbidden`, `InsufficientCredits`, `RateLimited`, `NotFound`, `InvalidAttributes`, `IdempotencyKeyReused`, `JobNotCancellable`.
- `ModuleUnavailable`, `EngineUnavailable`: an operator switched a task type or LLM engine off, e.g. during a provider outage. The reason is in the message, nothing is charged, and the SDK does not retry. `df.capabilities()` lists what is on.
- `TaskFailed`, and `Blocked` when the target refused: the API accepted the task but the page could not be scraped. The error carries `.result`, so the envelope is still readable. Failed tasks are refunded.
- `WaitTimeout`: a wait ran out of time. `.id` picks the work back up.

Tasks inside a job or a crawl never throw on their own — check `task.ok`, or call `task.raiseForStatus()`.

## Retries and idempotency

Every write carries an `Idempotency-Key`, generated per request unless you pass `idempotencyKey`. That makes retries safe: network errors and 429/502/503/504 answers are retried with backoff, reusing the key, so a retry attaches to the task already running instead of charging twice. Other 4xx errors are never retried, and neither is an aborted request.

The same key is how a synchronous task survives a slow page: when the API answers "still processing", the SDK re-sends the identical request under the identical key until the result is ready or the call's timeout is reached.

A key replays its stored result, failures included. To run a failed scrape again, send a new request rather than the same key.

## Options

```ts
const df = new DataFuel({
  apiKey,
  baseUrl: "https://scraping-api.staging.datafuel.ai/api/v1",
  timeoutMs: 300_000, // null disables the bound
  maxRetries: 4,
  pollIntervalMs: 5_000, // waitJob / waitCrawl
  userAgent: "my-app/1.2",
  fetch: myFetch,
});
```

Keep `timeoutMs` generous: `scrape` waits until the page is ready, which can take minutes with `jsRendering`. Every call also takes its own `timeoutMs` and an `AbortSignal` as `signal`.

If you pass your own `fetch`, leave redirects off. fetch keeps custom headers across a redirect, so a redirect to another host would carry your `X-API-Key` to it. This SDK sends `redirect: "manual"`.

Full API reference: https://scraping-api.datafuel.ai/docs

## MCP

To use DataFuel from Claude Code, Cursor, VS Code and other MCP clients instead of from code, run `npx -y @datafuel/mcp init`. See [@datafuel/mcp](https://www.npmjs.com/package/@datafuel/mcp).

## License

MIT, see [LICENSE](LICENSE).
