import * as p from "@clack/prompts";
import { checkKey, reason, version } from "./api.js";
import type { Opts } from "./cli.js";
import { clients } from "./clients/index.js";
import { shown } from "./fsutil.js";
import { mask } from "./mask.js";
import { row } from "./ui.js";

async function endpoint(opts: Opts, key: string | undefined): Promise<boolean> {
  if (!key) {
    p.log.warn(row("API key", "not set, pass --api-key or set DATAFUEL_API_KEY to check it"));
    return false;
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
  const key = opts.apiKey ?? (process.env.DATAFUEL_API_KEY?.trim() || undefined);
  let ok = await endpoint(opts, key);
  const dir = opts.project ? process.cwd() : undefined;

  for (const c of opts.clients ?? clients.filter((c) => c.project || !dir)) {
    try {
      const all = await c.configured(dir);
      const stale = all.find((f) => key && f.key !== undefined && f.key !== key);
      if (stale) {
        ok = false;
        p.log.warn(row(c.label, `stale key (${shown(stale.path, dir)}), run init again`));
      } else if (all.length) {
        const where = all.map((f) => shown(f.path, dir)).join(", ");
        p.log.success(row(c.label, `configured (${where})`));
      } else if (!dir && (await c.detect())) p.log.warn(row(c.label, "detected, not configured"));
      else p.log.info(row(c.label, dir ? "not configured" : "not found"));
    } catch (err) {
      ok = false;
      p.log.error(row(c.label, reason(err)));
    }
  }

  p.outro(ok ? "All good." : "Problems found or not checked.");
  return ok;
}
