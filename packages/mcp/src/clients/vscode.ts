import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mcpUrl } from "../api.js";
import { appData, type Doc, exists, onPath, readJson, xdgConfig } from "../fsutil.js";
import { getServer, setServer, unsetServer, update } from "./json.js";
import type { Client } from "./types.js";

const inputId = "datafuel-api-key";

export const entry = (url: string): Doc => ({
  type: "http",
  url: mcpUrl(url),
  headers: { "X-API-Key": `\${input:${inputId}}` },
});

const input = {
  type: "promptString",
  id: inputId,
  description: "DataFuel API key",
  password: true,
};

function inputs(doc: Doc | undefined): unknown[] {
  const i = doc?.inputs;
  if (i === undefined) return [];
  if (!Array.isArray(i)) throw new Error(`"inputs" is not an array`);
  return i.filter((x) => (x as Doc | null)?.id !== inputId);
}

export const merge = (doc: Doc | undefined, url: string): Doc => ({
  ...setServer(doc, "servers", entry(url)),
  inputs: [...inputs(doc), input],
});

export function unmerge(doc: Doc | undefined): Doc | undefined {
  const next = unsetServer(doc, "servers");
  if (!next) return undefined;
  const rest = inputs(doc);
  if (rest.length) return { ...next, inputs: rest };
  delete next.inputs;
  return next;
}

function path(): string {
  const user =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "Code", "User")
      : process.platform === "win32"
        ? join(appData(), "Code", "User")
        : join(xdgConfig(), "Code", "User");
  return join(user, "mcp.json");
}

export const vscode: Client = {
  id: "vscode",
  label: "VS Code",
  path,
  detect: async () => (await onPath("code")) || (await exists(dirname(path()))),
  configured: async () => !!getServer(await readJson(path()), "servers"),
  install: async ({ url }) =>
    `${await update(path(), (doc) => merge(doc, url))}, asks for the key on first start`,
  remove: () => update(path(), unmerge),
  restart: "VS Code",
};
