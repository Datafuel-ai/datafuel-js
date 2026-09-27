import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { mcpUrl } from "../api.js";
import { type Doc, exists, onPath, readJson } from "../fsutil.js";
import { getServer, name, setServer, unsetServer, update } from "./json.js";
import type { Client, Ctx } from "./types.js";

const run = promisify(execFile);

export const entry = ({ url, key }: Ctx): Doc => ({
  type: "http",
  url: mcpUrl(url),
  headers: { "X-API-Key": key },
});

export const merge = (doc: Doc | undefined, ctx: Ctx) => setServer(doc, "mcpServers", entry(ctx));
export const unmerge = (doc: Doc | undefined) => unsetServer(doc, "mcpServers");

const path = () => join(homedir(), ".claude.json");

// .cmd shims on Windows need a shell, which would put the key through cmd.exe quoting.
const hasCli = async () => process.platform !== "win32" && (await onPath("claude"));

async function claude(...args: string[]): Promise<boolean> {
  return run("claude", ["mcp", ...args], { timeout: 30_000 }).then(
    () => true,
    () => false,
  );
}

async function install(ctx: Ctx): Promise<string> {
  const url = mcpUrl(ctx.url);
  if (await hasCli()) {
    await claude("remove", "--scope", "user", name);
    const ok = await claude(
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
    if (ok) return `user scope → ${url}`;
  }
  return (await update(path(), (doc) => merge(doc, ctx))) as string;
}

async function remove(): Promise<string | undefined> {
  if (!getServer(await readJson(path()), "mcpServers")) return undefined;
  if ((await hasCli()) && (await claude("remove", "--scope", "user", name))) return "user scope";
  return update(path(), unmerge);
}

export const claudeCode: Client = {
  id: "claude-code",
  label: "Claude Code",
  path,
  detect: async () => (await onPath("claude")) || (await exists(path())),
  configured: async () => !!getServer(await readJson(path()), "mcpServers"),
  install,
  remove,
  restart: "Claude Code",
};
