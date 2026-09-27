/** Shared fakes. Every test runs against a stub fetch: no network, no credits. */

import { DataFuel } from "../src/client.js";
import type { ClientOptions } from "../src/client.js";

export const API_KEY = "df_key_test";

/** A client that does not wait in real time between attempts. */
class TestClient extends DataFuel {
  protected override sleep(): Promise<void> {
    return Promise.resolve();
  }
}

export type Answer = Response | Record<string, unknown> | unknown[];

function toResponse(answer: Answer): Response {
  return answer instanceof Response
    ? answer
    : new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
}

/** A fake API. Feed it answers, read back what the SDK sent. */
export class Recorder {
  readonly requests: { url: URL; init: RequestInit }[] = [];
  private readonly queued: Answer[];

  constructor(...answers: Answer[]) {
    this.queued = [...answers];
  }

  readonly fetch: typeof globalThis.fetch = (input, init) => {
    this.requests.push({ url: new URL(String(input)), init: init ?? {} });
    const answer = this.queued.length > 1 ? this.queued.shift()! : this.queued[0]!;
    return Promise.resolve(toResponse(answer));
  };

  /** The JSON body of the last request. */
  get body(): Record<string, unknown> {
    return this.bodies().at(-1) as Record<string, unknown>;
  }

  bodies(): unknown[] {
    return this.requests.map(({ init }) =>
      typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    );
  }

  header(name: string, index = -1): string | undefined {
    const headers = this.requests.at(index)?.init.headers as Record<string, string> | undefined;
    return headers?.[name];
  }

  keys(): (string | undefined)[] {
    return this.requests.map(
      ({ init }) => (init.headers as Record<string, string> | undefined)?.["Idempotency-Key"],
    );
  }
}

/** Answers by "METHOD /path" pattern, most specific first, a queue per route. */
export class Router extends Recorder {
  constructor(private readonly routes: Record<string, Answer[]>) {
    super();
  }

  override readonly fetch: typeof globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    this.requests.push({ url, init: init ?? {} });
    const route = `${init?.method ?? "GET"} ${url.pathname.replace("/api/v1", "")}`;
    for (const [pattern, queue] of Object.entries(this.routes)) {
      if (matches(route, pattern)) {
        const answer = queue.length > 1 ? queue.shift()! : queue[0]!;
        return Promise.resolve(toResponse(answer));
      }
    }
    throw new Error(`no route for ${route}`);
  };
}

function matches(route: string, pattern: string): boolean {
  const expression = pattern.split("*").map(escape).join("[^?]*");
  return new RegExp(`^${expression}$`).test(route);
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function client(api: Recorder, options: ClientOptions = {}): DataFuel {
  return new TestClient({ apiKey: API_KEY, fetch: api.fetch, ...options });
}

export function completed(
  data: unknown = "<html>hi</html>",
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "task-1",
    status: "completed",
    status_code: 200,
    credits_used: 1,
    result: { data },
    ...extra,
  };
}

export function errorResponse(status: number, code: string, message = "nope"): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
