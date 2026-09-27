import { APIError, DataFuel, TransportError } from "@datafuel/sdk";
import { version } from "../package.json";

export { version };
export const defaultUrl = "https://scraping-api.datafuel.ai";
export const clientTag = `mcp-cli/${version}`;

export const mcpUrl = (base: string) => new URL("/mcp", base).toString();

export const tagged: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("X-DataFuel-Client", clientTag);
  return fetch(input, { ...init, headers });
};

type KeyCheck = { ok: true; credits: number } | { ok: false; status: number };

export async function checkKey(url: string, key: string): Promise<KeyCheck> {
  const baseUrl = new URL("/api/v1", url).toString();
  const df = new DataFuel({
    apiKey: key,
    baseUrl,
    userAgent: clientTag,
    timeoutMs: 15_000,
    fetch: tagged,
  });
  try {
    return { ok: true, credits: await df.balance() };
  } catch (err) {
    if (err instanceof APIError) return { ok: false, status: err.status };
    if (err instanceof TransportError) {
      throw new Error(`could not reach ${baseUrl}/users/@me/balance`, { cause: err });
    }
    throw err;
  }
}

export function reason(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  let root: Error = err;
  while (root.cause instanceof Error) root = root.cause;
  return err.message.includes(root.message) ? err.message : `${err.message}: ${root.message}`;
}
