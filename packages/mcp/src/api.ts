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
  const endpoint = new URL("/api/v1/users/@me/balance", url).toString();
  let res: Response;
  try {
    res = await tagged(endpoint, {
      headers: { "X-API-Key": key, Accept: "application/json", "User-Agent": clientTag },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(`could not reach ${endpoint}`, { cause: err });
  }
  if (!res.ok) return { ok: false, status: res.status };
  const body = (await res.json().catch(() => undefined)) as { balance?: unknown } | undefined;
  const credits = Number(body?.balance);
  if (Number.isNaN(credits)) throw new Error(`unexpected answer from ${endpoint}`);
  return { ok: true, credits };
}

export function reason(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  let root: Error = err;
  while (root.cause instanceof Error) root = root.cause;
  return err.message.includes(root.message) ? err.message : `${err.message}: ${root.message}`;
}
