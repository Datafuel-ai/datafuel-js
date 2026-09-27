import * as p from "@clack/prompts";
import { checkKey, reason, version } from "./api.js";
import type { Opts } from "./cli.js";
import { clients } from "./clients/index.js";
import { tilde } from "./fsutil.js";
import { mask, row } from "./ui.js";

async function endpoint(opts: Opts): Promise<boolean> {
  const key = opts.apiKey ?? process.env.DATAFUEL_API_KEY?.trim();
  if (!key) {
    p.log.warn(row("API key", "not set, pass --api-key or set DATAFUEL_API_KEY to check it"));
    return true;
  }
  let res;
  try {
    res = await checkKey(opts.url, key);
  } catch (err) {
    p.log.error(row("Endpoint", reason(err)));
    return false;
  }
  p.log.success(row("Endpoint", `${opts.url} reachable`));
  if (res.ok) {
    p.log.success(
      row("API key", `${mask(key)} valid (${res.credits.toLocaleString("en-US")} credits)`),
    );
    return true;
  }
  const why =
    res.status === 401
      ? "rejected"
      : res.status === 403
        ? "account inactive"
        : `HTTP ${res.status}`;
  p.log.error(row("API key", `${mask(key)} ${why}`));
  return false;
}

export async function doctor(opts: Opts): Promise<boolean> {
  p.intro(`DataFuel MCP doctor (v${version}, node ${process.versions.node})`);
  let ok = await endpoint(opts);

  for (const c of opts.clients ?? clients) {
    try {
      if (await c.configured()) p.log.success(row(c.label, `configured (${tilde(c.path())})`));
      else if (await c.detect()) p.log.warn(row(c.label, "detected, not configured"));
      else p.log.info(row(c.label, "not found"));
    } catch (err) {
      ok = false;
      p.log.error(row(c.label, reason(err)));
    }
  }

  p.outro(ok ? "All good." : "Problems found.");
  return ok;
}
