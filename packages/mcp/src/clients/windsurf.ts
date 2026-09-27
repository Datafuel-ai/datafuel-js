import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mcpUrl } from "../api.js";
import { appData, type Doc, exists, xdgConfig } from "../fsutil.js";
import { header, jsonClient, setServer, unsetServer } from "./json.js";
import type { Ctx } from "./types.js";

export const entry = ({ url, key }: Ctx, legacy = false): Doc => ({
  [legacy ? "serverUrl" : "url"]: mcpUrl(url),
  headers: { "X-API-Key": key },
});

export const merge = (doc: Doc | undefined, ctx: Ctx, legacy = false) =>
  setServer(doc, "mcpServers", entry(ctx, legacy));
export const unmerge = (doc: Doc | undefined) => unsetServer(doc, "mcpServers");

const devinDir = () => join(process.platform === "win32" ? appData() : xdgConfig(), "devin");
const codeiumDir = () => join(homedir(), ".codeium", "windsurf");
const legacyFile = () => join(codeiumDir(), "mcp_config.json");

export const windsurf = jsonClient({
  id: "windsurf",
  label: "Windsurf",
  root: "mcpServers",
  entry: (ctx, path) => entry(ctx, path === legacyFile()),
  key: header,
  paths: () => {
    const devin = join(devinDir(), "mcp_config.json");
    return existsSync(devinDir()) ? [devin, legacyFile()] : [legacyFile(), devin];
  },
  detect: async () => (await exists(devinDir())) || (await exists(codeiumDir())),
  restart: "Windsurf (Devin Desktop)",
});
