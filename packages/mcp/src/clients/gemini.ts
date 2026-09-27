import { homedir } from "node:os";
import { join } from "node:path";
import { mcpUrl } from "../api.js";
import { type Doc, exists, onPath } from "../fsutil.js";
import { header, jsonClient, setServer, unsetServer } from "./json.js";
import type { Ctx } from "./types.js";

export const entry = ({ url, key }: Ctx): Doc => ({
  httpUrl: mcpUrl(url),
  headers: { "X-API-Key": key },
});

export const merge = (doc: Doc | undefined, ctx: Ctx) => setServer(doc, "mcpServers", entry(ctx));
export const unmerge = (doc: Doc | undefined) => unsetServer(doc, "mcpServers");

export const gemini = jsonClient({
  id: "gemini",
  label: "Gemini CLI",
  project: true,
  root: "mcpServers",
  entry,
  key: header,
  paths: (dir) => [join(dir ?? homedir(), ".gemini", "settings.json")],
  detect: async () => (await onPath("gemini")) || (await exists(join(homedir(), ".gemini"))),
  restart: "Gemini CLI",
});
