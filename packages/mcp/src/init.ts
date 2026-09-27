import * as p from "@clack/prompts";
import { checkKey, mcpUrl, reason } from "./api.js";
import type { Opts } from "./cli.js";
import { clients } from "./clients/index.js";
import type { Client } from "./clients/types.js";
import { mask, row } from "./ui.js";

function answer<T>(v: T): Exclude<T, symbol> {
  if (p.isCancel(v)) throw new Error("cancelled");
  return v as Exclude<T, symbol>;
}

const plain = {
  start: () => {},
  stop: (msg: string, code = 0) => (code ? p.log.error(msg) : p.log.success(msg)),
};

async function askKey(opts: Opts, interactive: boolean): Promise<string> {
  let key = opts.apiKey ?? process.env.DATAFUEL_API_KEY?.trim();
  for (;;) {
    if (!key) {
      if (!interactive) throw new Error("no API key: pass --api-key or set DATAFUEL_API_KEY");
      key = answer(
        await p.password({
          message: "API key",
          mask: "•",
          validate: (v) => (v?.trim() ? undefined : "required"),
        }),
      ).trim();
    }

    const s = process.stdout.isTTY ? p.spinner() : plain;
    s.start(`Checking ${mask(key)}`);
    let res;
    try {
      res = await checkKey(opts.url, key);
    } catch (err) {
      s.stop("Check failed", 2);
      throw err;
    }

    if (res.ok) {
      s.stop(`API key ${mask(key)} valid (${res.credits.toLocaleString("en-US")} credits)`);
      return key;
    }
    if (res.status === 403) {
      s.stop(`API key ${mask(key)} belongs to an inactive account`, 2);
      throw new Error("account inactive");
    }
    if (res.status !== 401) {
      s.stop(`Unexpected HTTP ${res.status} from ${opts.url}`, 2);
      throw new Error(`unexpected HTTP ${res.status}`);
    }
    s.stop(`API key ${mask(key)} was rejected`, 2);
    if (!interactive) throw new Error("invalid API key");
    key = undefined;
  }
}

async function askClients(opts: Opts, interactive: boolean): Promise<Client[]> {
  if (opts.clients) return opts.clients;

  const found = await Promise.all(clients.map((c) => c.detect()));
  const detected = clients.filter((_, i) => found[i]);
  if (!interactive) {
    if (!detected.length) throw new Error("no MCP clients detected: pass --client");
    return detected;
  }

  const ids = answer(
    await p.multiselect({
      message: "Install for which clients?",
      options: clients.map((c, i) => ({
        value: c.id,
        label: c.label,
        hint: found[i] ? "detected" : "not found",
      })),
      initialValues: detected.map((c) => c.id),
      required: true,
    }),
  );
  return clients.filter((c) => ids.includes(c.id));
}

export async function init(opts: Opts): Promise<boolean> {
  const interactive = !opts.yes && !!process.stdin.isTTY;
  p.intro("DataFuel MCP setup");

  const key = await askKey(opts, interactive);
  const chosen = await askClients(opts, interactive);

  let ok = true;
  for (const c of chosen) {
    try {
      p.log.success(row(c.label, await c.install({ url: opts.url, key })));
    } catch (err) {
      ok = false;
      p.log.error(row(c.label, reason(err)));
    }
  }

  const restart = chosen.map((c) => c.restart).join(", ");
  p.outro(
    ok
      ? `Restart ${restart}. Try: "scrape https://example.com as markdown"`
      : `Some clients failed. Endpoint: ${mcpUrl(opts.url)}`,
  );
  return ok;
}
