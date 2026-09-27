import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaultUrl } from "../api.js";
import { appData, type Doc, exists, readJson, xdgConfig } from "../fsutil.js";
import { getServer, setServer, unsetServer, update } from "./json.js";
import type { Client, Ctx } from "./types.js";

export const entry = ({ url, key }: Ctx): Doc => ({
  command: "npx",
  args: ["-y", "@datafuel/mcp"],
  env: { DATAFUEL_API_KEY: key, ...(url !== defaultUrl && { DATAFUEL_URL: url }) },
});

export const merge = (doc: Doc | undefined, ctx: Ctx) => setServer(doc, "mcpServers", entry(ctx));
export const unmerge = (doc: Doc | undefined) => unsetServer(doc, "mcpServers");

function path(): string {
  const file = "claude_desktop_config.json";
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", "Claude", file);
  if (process.platform === "win32") return join(appData(), "Claude", file);
  return join(xdgConfig(), "Claude", file);
}

export const claudeDesktop: Client = {
  id: "claude-desktop",
  label: "Claude Desktop",
  path,
  detect: () => exists(dirname(path())),
  configured: async () => !!getServer(await readJson(path()), "mcpServers"),
  install: (ctx) => update(path(), "mcpServers", (doc) => merge(doc, ctx)) as Promise<string>,
  remove: () => update(path(), "mcpServers", unmerge),
  restart: "Claude Desktop",
};
