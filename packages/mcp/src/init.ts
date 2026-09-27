import * as p from "@clack/prompts";
import { checkKey, mcpUrl, reason } from "./api.js";
import type { Opts } from "./cli.js";
import { claudeCode } from "./clients/claude-code.js";
import { clients } from "./clients/index.js";
import type { Client, Ctx } from "./clients/types.js";
import { shown } from "./fsutil.js";
import { mask } from "./mask.js";
import { gitRoot, ignore, tracked } from "./project.js";
import { installSkill } from "./skill.js";
import { row } from "./ui.js";

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

  const offered = clients.filter((c) => c.project || !opts.project);
  const found = await Promise.all(offered.map((c) => c.detect()));
  const detected = offered.filter((_, i) => found[i]);
  if (!interactive) {
    if (!detected.length) throw new Error("no MCP clients detected: pass --client");
    return detected;
  }

  const ids = answer(
    await p.multiselect({
      message: "Install for which clients?",
      options: offered.map((c, i) => ({
        value: c.id,
        label: c.label,
        hint: found[i] ? "detected" : "not found",
      })),
      initialValues: detected.map((c) => c.id),
      required: true,
    }),
  );
  return offered.filter((c) => ids.includes(c.id));
}

async function wantSkill(opts: Opts, chosen: Client[], interactive: boolean): Promise<boolean> {
  if (opts.skill !== undefined) return opts.skill;
  if (opts.project || !chosen.includes(claudeCode)) return false;
  if (!interactive) return true;
  return answer(await p.confirm({ message: "Also install the DataFuel skill for Claude Code?" }));
}

async function installProject(c: Client, ctx: Ctx, dir: string): Promise<void> {
  const file = c.path(dir);
  const root = c.keyOnDisk ? await gitRoot(dir) : undefined;
  if (root && (await tracked(root, file)))
    throw new Error(
      `${shown(file, dir)} is tracked by git, not writing the key into it; run init without --project to use user scope`,
    );
  p.log.success(row(c.label, await c.install(ctx, dir)));
  if (!c.keyOnDisk) return;
  if (root) p.log.info(row(c.label, `ignored by ${shown(await ignore(root, file), dir)}`));
  else p.log.warn(row(c.label, "not a git repository, keep it out of version control"));
}

export async function init(opts: Opts): Promise<boolean> {
  const interactive = !opts.yes && !!process.stdin.isTTY;
  p.intro("DataFuel MCP setup");

  const key = await askKey(opts, interactive);
  const chosen = await askClients(opts, interactive);
  const skill = await wantSkill(opts, chosen, interactive);
  const dir = opts.project ? process.cwd() : undefined;
  const ctx = { url: opts.url, key };

  let ok = true;
  for (const c of chosen) {
    try {
      if (dir) await installProject(c, ctx, dir);
      else p.log.success(row(c.label, await c.install(ctx)));
    } catch (err) {
      ok = false;
      p.log.error(row(c.label, reason(err)));
    }
  }
  if (skill) {
    try {
      const where = await installSkill(opts.url);
      p.log.success(row("Skill", dir ? `${where} (user scope)` : where));
    } catch (err) {
      ok = false;
      p.log.error(row("Skill", reason(err)));
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
