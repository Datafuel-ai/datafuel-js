import { homedir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse, stringify, TomlError } from "smol-toml";
import { mcpUrl, reason } from "../api.js";
import {
  type Doc,
  exists,
  isObject,
  onPath,
  readText,
  saved,
  shown,
  writeText,
} from "../fsutil.js";
import { found, name } from "./json.js";
import type { Client, Ctx } from "./types.js";

export const entry = ({ url, key }: Ctx): Doc => ({
  url: mcpUrl(url),
  http_headers: { "X-API-Key": key },
});

const section = (e: Doc) => stringify({ mcp_servers: { [name]: e } }).trim();

const header = /^\s*\[/;
const ours =
  /^\s*\[\s*mcp_servers\s*\.\s*(?:datafuel|"datafuel"|'datafuel')\s*(?:\.[^\]]*)?\]\s*(?:#.*)?\r?$/;
const filler = /^\s*(?:#.*)?\r?$/;

function load(text: string | undefined): Doc {
  if (!text?.trim()) return {};
  let line: number | undefined;
  try {
    return structuredClone(parse(text)) as Doc;
  } catch (err) {
    line = err instanceof TomlError ? err.line : 0;
  }
  throw new Error(`not valid TOML${line ? ` (line ${line})` : ""}`);
}

function servers(doc: Doc): Doc {
  const s = doc.mcp_servers;
  if (s === undefined) return {};
  if (!isObject(s)) throw new Error(`"mcp_servers" is not a table`);
  return s;
}

const getServer = (doc: Doc) => {
  const e = servers(doc)[name];
  return isObject(e) ? e : undefined;
};

function without(doc: Doc): Doc {
  const rest = { ...servers(doc) };
  delete rest[name];
  const top = { ...doc };
  delete top.mcp_servers;
  return Object.keys(rest).length ? { ...top, mcp_servers: rest } : top;
}

function strip(text: string): string {
  const out: string[] = [];
  let skip = false;
  let held: string[] = [];
  for (const line of text.split("\n")) {
    if (header.test(line)) {
      const next = ours.test(line);
      while (held[0]?.trim() === "") held.shift();
      if (skip && !next) out.push(...held);
      held = [];
      skip = next;
    } else if (skip) {
      held = filler.test(line) ? [...held, line] : [];
    }
    if (!skip) out.push(line);
  }
  return out.join("\n").trimEnd();
}

function checked(before: Doc, next: string, e: Doc | undefined): string {
  const unsafe = new Error("uses a layout this tool cannot edit safely");
  let after: Doc;
  try {
    after = load(next);
  } catch {
    throw unsafe;
  }
  if (!isDeepStrictEqual(without(after), without(before))) throw unsafe;
  if (!isDeepStrictEqual(getServer(after), e)) throw unsafe;
  return next;
}

const eol = (text: string | undefined) => (text?.includes("\r\n") ? "\r\n" : "\n");

export function merge(text: string | undefined, ctx: Ctx): string {
  const before = load(text);
  servers(before);
  const nl = eol(text);
  const body = strip(text ?? "");
  const e = entry(ctx);
  const block = section(e).replaceAll("\n", nl);
  return checked(before, `${body ? `${body}${nl}${nl}` : ""}${block}${nl}`, e);
}

export function unmerge(text: string | undefined): string | undefined {
  const before = load(text);
  if (!getServer(before)) return undefined;
  const body = strip(text ?? "");
  return checked(before, body ? `${body}${eol(text)}` : "", undefined);
}

const home = () => process.env.CODEX_HOME || join(homedir(), ".codex");
const path = (dir?: string) => join(dir ? join(dir, ".codex") : home(), "config.toml");

async function read(file: string, dir?: string): Promise<Doc | undefined> {
  try {
    return getServer(load(await readText(file)));
  } catch (err) {
    throw new Error(`${shown(file, dir)} ${(err as Error).message}, left untouched`, {
      cause: err,
    });
  }
}

async function update(
  file: string,
  next: (text: string | undefined) => string | undefined,
  dir?: string,
): Promise<string | undefined> {
  const prev = await readText(file);
  let text: string | undefined;
  try {
    text = next(prev);
  } catch (err) {
    throw new Error(`${shown(file, dir)} ${(err as Error).message}, left untouched`, {
      cause: err,
    });
  }
  if (text === undefined) return undefined;
  const keep = prev !== undefined && !(await read(file, dir));
  return saved(file, await writeText(file, text, keep), dir);
}

const snippet = (url: string) =>
  section({ url: mcpUrl(url), env_http_headers: { "X-API-Key": "DATAFUEL_API_KEY" } });

export const codex: Client = {
  id: "codex",
  label: "Codex CLI",
  project: true,
  keyOnDisk: true,
  path,
  detect: async () => (await onPath("codex")) || (await exists(home())),
  configured: async (dir) => {
    const e = await read(path(dir), dir);
    const key = isObject(e?.http_headers) ? e.http_headers["X-API-Key"] : undefined;
    return e ? [found(path(dir), key)] : [];
  },
  install: async (ctx, dir) => {
    try {
      const where = (await update(path(dir), (text) => merge(text, ctx), dir))!;
      return dir ? `${where}, the project must be trusted in Codex` : where;
    } catch (err) {
      throw new Error(
        `${reason(err)}\nAdd this to it by hand and export DATAFUEL_API_KEY:\n${snippet(ctx.url)}`,
        { cause: err },
      );
    }
  },
  remove: (dir) => update(path(dir), unmerge, dir),
  restart: "Codex",
};
