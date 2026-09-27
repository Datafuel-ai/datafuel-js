import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "smol-toml";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { reason } from "../src/api.js";
import { clients } from "../src/clients/index.js";
import type { Client } from "../src/clients/types.js";
import { readJson, writeJson } from "../src/fsutil.js";

const ctx = { url: "https://scraping-api.datafuel.ai", key: "df_key_test_fake_0000000000001234" };
async function filesWith(dir: string, needle: string): Promise<string[]> {
  const hits: string[] = [];
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const p = join(e.parentPath, e.name);
    if ((await readFile(p, "utf8")).includes(needle)) hits.push(p);
  }
  return hits;
}

const mode = async (p: string) => (await stat(p)).mode & 0o777;
const json = async (p: string) => JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
const doc = async (p: string) =>
  p.endsWith(".toml") || p.endsWith(".toml.bak")
    ? (structuredClone(parse(await readFile(p, "utf8"))) as Record<string, unknown>)
    : json(p);

const theirs = { url: "x" };
const seed = (c: Client) =>
  c.id === "codex"
    ? `# my codex config\nkeep = 1\n\n[mcp_servers.other]\nurl = "x" # theirs\n`
    : JSON.stringify({ keep: 1, mcpServers: { other: theirs }, servers: { other: theirs } });
const root = (c: Client) =>
  c.id === "codex" ? "mcp_servers" : c.id === "vscode" ? "servers" : "mcpServers";

let home: string;

beforeAll(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "datafuel-mcp-")));
  vi.stubEnv("HOME", home);
  vi.stubEnv("PATH", "");
  vi.stubEnv("CODEX_HOME", "");
  vi.stubEnv("XDG_CONFIG_HOME", "");
  vi.stubEnv("APPDATA", "");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("fsutil", () => {
  it("treats a missing or blank file as empty", async () => {
    expect(await readJson(join(home, "missing.json"))).toBeUndefined();
    await writeFile(join(home, "blank.json"), "\n");
    expect(await readJson(join(home, "blank.json"))).toBeUndefined();
  });

  it("refuses unparseable and non-object files", async () => {
    await writeFile(join(home, "bad.json"), "{ nope");
    await expect(readJson(join(home, "bad.json"))).rejects.toThrow(/not valid JSON/);
    await writeFile(join(home, "arr.json"), "[]");
    await expect(readJson(join(home, "arr.json"))).rejects.toThrow(/not a JSON object/);
  });

  it("does not echo file content in parse errors", async () => {
    await writeFile(join(home, "leak.json"), `{"k": ${ctx.key}}`);
    const err = await readJson(join(home, "leak.json")).catch((e: unknown) => e as Error);
    expect(reason(err)).toMatch(/not valid JSON/);
    expect(reason(err)).not.toContain("df_key_");
    await rm(join(home, "leak.json"));
  });

  it("creates new files 600 without a backup", async () => {
    const p = join(home, "new", "a.json");
    expect(await writeJson(p, { a: 1 })).toBeUndefined();
    expect(await mode(p)).toBe(0o600);
    expect(await json(p)).toEqual({ a: 1 });
  });

  it("keeps the original as .bak, never overwrites it, and tightens to 600", async () => {
    const p = join(home, "existing.json");
    await writeFile(p, '{"old":true}', { mode: 0o644 });
    expect(await writeJson(p, { new: true }, true)).toBe(p + ".bak");
    expect(await mode(p)).toBe(0o600);
    expect(await mode(p + ".bak")).toBe(0o600);
    expect(await json(p + ".bak")).toEqual({ old: true });
    expect(await json(p)).toEqual({ new: true });

    expect(await writeJson(p, { newer: true }, true)).toBeUndefined();
    expect(await json(p + ".bak")).toEqual({ old: true });
  });

  it("skips the backup unless asked", async () => {
    const p = join(home, "nobak.json");
    await writeFile(p, "{}");
    expect(await writeJson(p, { a: 1 })).toBeUndefined();
    await expect(stat(p + ".bak")).rejects.toThrow();
  });

  it("writes through symlinks", async () => {
    const real = join(home, "real.json");
    const link = join(home, "link.json");
    await writeFile(real, "{}");
    await symlink(real, link);
    await writeJson(link, { x: 1 });
    expect(await json(real)).toEqual({ x: 1 });
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
  });
});

describe.each(clients.map((c) => [c.id, c] as const))("%s on disk", (_, c) => {
  it("installs, reinstalls and removes, keeping the rest of the file", async () => {
    const p = c.path();
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, seed(c));

    expect(await c.configured()).toBeUndefined();
    await c.install(ctx);
    await c.install(ctx);
    expect(await c.configured()).toEqual({ path: p, key: c.id === "vscode" ? undefined : ctx.key });
    expect(await mode(p)).toBe(0o600);

    const d = await doc(p);
    expect(d.keep).toBe(1);
    expect(d[root(c)]).toMatchObject({ other: theirs });
    expect(await doc(p + ".bak")).toMatchObject({ keep: 1 });
    if (c.id === "codex") expect(await readFile(p, "utf8")).toContain('url = "x" # theirs');

    expect(await c.remove()).toBeTruthy();
    expect(await c.configured()).toBeUndefined();
    expect(await c.remove()).toBeUndefined();
    if (c.id === "codex") expect(await readFile(p, "utf8")).toBe(seed(c));
  });

  it("leaves a broken file alone", async () => {
    const p = c.path();
    await writeFile(p, "{ broken");
    await expect(c.install(ctx)).rejects.toThrow(/not valid (JSON|TOML)/);
    expect(await readFile(p, "utf8")).toBe("{ broken");
  });

  it("leaves no copy of the key behind after init and remove", async () => {
    const p = c.path();
    await rm(p, { force: true });
    await rm(p + ".bak", { force: true });
    await c.install(ctx);
    await c.install(ctx);
    await c.remove();
    expect(await filesWith(home, ctx.key)).toEqual([]);

    await writeFile(p, seed(c));
    await c.install(ctx);
    await c.install(ctx);
    await c.remove();
    expect(await filesWith(home, ctx.key)).toEqual([]);
    await rm(p + ".bak", { force: true });
  });
});

it("windsurf writes url to the Devin config, serverUrl to the legacy one, removes both", async () => {
  const windsurf = clients.find((c) => c.id === "windsurf")!;
  const legacy = join(home, ".codeium", "windsurf", "mcp_config.json");
  const devin = join(home, ".config", "devin", "mcp_config.json");
  const server = async (p: string) =>
    ((await json(p)).mcpServers as Record<string, Record<string, unknown>>).datafuel;
  expect(windsurf.path()).toBe(legacy);

  await windsurf.install(ctx);
  expect(Object.keys((await server(legacy))!)).toEqual(["serverUrl", "headers"]);
  await mkdir(dirname(devin), { recursive: true });
  expect(windsurf.path()).toBe(devin);
  await windsurf.install(ctx);
  expect(await filesWith(dirname(devin), ctx.key)).toEqual([devin]);
  expect(Object.keys((await server(devin))!)).toEqual(["url", "headers"]);
  expect(await windsurf.configured()).toEqual({ path: devin, key: ctx.key });

  expect(await server(legacy)).toBeUndefined();

  await writeFile(legacy, JSON.stringify({ mcpServers: { datafuel: { serverUrl: "x" } } }));
  expect(await windsurf.remove()).toContain(",");
  expect(await filesWith(home, ctx.key)).toEqual([]);
  await rm(join(home, ".config"), { recursive: true });
});

it("windsurf moves the entry to the Devin config and leaves no old key behind", async () => {
  const windsurf = clients.find((c) => c.id === "windsurf")!;
  const legacy = join(home, ".codeium", "windsurf", "mcp_config.json");
  const devin = join(home, ".config", "devin", "mcp_config.json");
  const old = { ...ctx, key: "df_key_test_old_00000000000004321" };
  await writeFile(legacy, JSON.stringify({ mcpServers: { other: theirs } }));

  await windsurf.install(old);
  await mkdir(dirname(devin), { recursive: true });
  expect(await windsurf.install(ctx)).toBe(
    "~/.config/devin/mcp_config.json, removed from ~/.codeium/windsurf/mcp_config.json",
  );
  expect(await json(legacy)).toEqual({ mcpServers: { other: theirs } });
  expect(await filesWith(home, old.key)).toEqual([]);
  expect(await windsurf.configured()).toEqual({ path: devin, key: ctx.key });

  await windsurf.remove();
  await rm(legacy);
  await rm(legacy + ".bak");
  await rm(join(home, ".config"), { recursive: true });
});

it.each(clients.map((c) => [c.id, c] as const))(
  "%s names a broken file without echoing its content",
  async (_, c) => {
    const p = c.path();
    await writeFile(p, c.id === "codex" ? `x = 1\nk = "${ctx.key}" junk\n` : `{"k": ${ctx.key}}`);
    const err = await c.install(ctx).then(
      () => new Error("installed"),
      (e: unknown) => e as Error,
    );
    expect(err.message).toMatch(/not valid (JSON|TOML)/);
    expect(reason(err)).not.toContain("df_key_");
    await rm(p);
  },
);

it("codex refuses a layout it cannot edit and prints an env-referenced snippet", async () => {
  const codex = clients.find((c) => c.id === "codex")!;
  const original = 'mcp_servers = { datafuel = { url = "old" } }\n';
  await writeFile(codex.path(), original);
  const err = await codex.install(ctx).then(
    () => new Error("installed"),
    (e: unknown) => e as Error,
  );
  expect(err.message).toMatch(/cannot edit safely/);
  expect(err.message).toContain('X-API-Key = "DATAFUEL_API_KEY"');
  expect(err.message).not.toContain(ctx.key);
  expect(await readFile(codex.path(), "utf8")).toBe(original);
});

it("vscode prints a paste-able snippet without the key when it cannot edit the file", async () => {
  const vscode = clients.find((c) => c.id === "vscode")!;
  await writeFile(vscode.path(), '{ // jsonc\n "servers": {} }');
  const err = await vscode.install(ctx).then(
    () => new Error("installed"),
    (e: unknown) => e as Error,
  );
  expect(err.message).toContain('"${input:datafuel-api-key}"');
  expect(err.message).toContain('"password": true');
  expect(err.message).not.toContain(ctx.key);
});
