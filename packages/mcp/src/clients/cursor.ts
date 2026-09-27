import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mcpUrl } from "../api.js";
import { type Doc, exists, readJson } from "../fsutil.js";
import { getServer, setServer, unsetServer, update } from "./json.js";
import type { Client, Ctx } from "./types.js";

export const entry = ({ url, key }: Ctx): Doc => ({
  url: mcpUrl(url),
  headers: { "X-API-Key": key },
});

export const merge = (doc: Doc | undefined, ctx: Ctx) => setServer(doc, "mcpServers", entry(ctx));
export const unmerge = (doc: Doc | undefined) => unsetServer(doc, "mcpServers");

const path = () => join(homedir(), ".cursor", "mcp.json");

export const cursor: Client = {
  id: "cursor",
  label: "Cursor",
  path,
  detect: () => exists(dirname(path())),
  configured: async () => !!getServer(await readJson(path()), "mcpServers"),
  install: (ctx) => update(path(), "mcpServers", (doc) => merge(doc, ctx)) as Promise<string>,
  remove: () => update(path(), "mcpServers", unmerge),
  restart: "Cursor",
};
