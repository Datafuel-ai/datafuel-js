import { homedir } from "node:os";
import { join } from "node:path";
import { mcpUrl } from "../api.js";
import { type Doc, exists } from "../fsutil.js";
import { header, jsonClient, setServer, unsetServer } from "./json.js";
import type { Ctx } from "./types.js";

export const entry = ({ url, key }: Ctx): Doc => ({
  url: mcpUrl(url),
  headers: { "X-API-Key": key },
});

export const merge = (doc: Doc | undefined, ctx: Ctx) => setServer(doc, "mcpServers", entry(ctx));
export const unmerge = (doc: Doc | undefined) => unsetServer(doc, "mcpServers");

export const cursor = jsonClient({
  id: "cursor",
  label: "Cursor",
  root: "mcpServers",
  entry,
  key: header,
  paths: () => [join(homedir(), ".cursor", "mcp.json")],
  detect: () => exists(join(homedir(), ".cursor")),
  restart: "Cursor",
});
