import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { mcpUrl } from "../api.js";
import { type Doc, exists, onPath, readJson, tilde } from "../fsutil.js";
import { mask, redact } from "../mask.js";
import { found, getServer, header, name, setServer, unsetServer, update } from "./json.js";
import type { Client, Ctx } from "./types.js";

const run = promisify(execFile);

export const entry = ({ url, key }: Ctx): Doc => ({
  type: "http",
  url: mcpUrl(url),
  headers: { "X-API-Key": key },
});

export const merge = (doc: Doc | undefined, ctx: Ctx) => setServer(doc, "mcpServers", entry(ctx));
export const unmerge = (doc: Doc | undefined) => unsetServer(doc, "mcpServers");

const path = (dir?: string) => (dir ? join(dir, ".mcp.json") : join(homedir(), ".claude.json"));

// .cmd shims on Windows need a shell, which would put the key through cmd.exe quoting.
const hasCli = async () => process.platform !== "win32" && (await onPath("claude"));

async function claude(...args: string[]): Promise<string | undefined> {
  return run("claude", ["mcp", ...args], { timeout: 30_000 }).then(
    () => undefined,
    (err: { stderr?: string; code?: unknown }) =>
      err.stderr?.trim().split("\n")[0] || `exit code ${String(err.code)}`,
  );
}

async function install(ctx: Ctx, dir?: string): Promise<string> {
  const url = mcpUrl(ctx.url);
  if (!dir && (await hasCli())) {
    await claude("remove", "--scope", "user", name);
    const err = await claude(
      "add",
      "--scope",
      "user",
      "--transport",
      "http",
      name,
      url,
      "--header",
      `X-API-Key: ${ctx.key}`,
    );
    if (!err) return `user scope → ${url}`;
    process.stderr.write(
      `datafuel-mcp: claude mcp add failed (${redact(err.replaceAll(ctx.key, mask(ctx.key)))}), editing ${tilde(path())}\n`,
    );
  }
  return (await update(path(dir), "mcpServers", (doc) => merge(doc, ctx), dir))!;
}

async function remove(dir?: string): Promise<string | undefined> {
  if (!getServer(await readJson(path(dir), dir), "mcpServers")) return undefined;
  if (!dir && (await hasCli()) && !(await claude("remove", "--scope", "user", name)))
    return "user scope";
  return update(path(dir), "mcpServers", unmerge, dir);
}

export const claudeCode: Client = {
  id: "claude-code",
  label: "Claude Code",
  project: true,
  keyOnDisk: true,
  path,
  detect: async () => (await onPath("claude")) || (await exists(path())),
  configured: async (dir) => {
    const e = getServer(await readJson(path(dir), dir), "mcpServers");
    return e ? [found(path(dir), header(e))] : [];
  },
  install,
  remove,
  restart: "Claude Code",
};
