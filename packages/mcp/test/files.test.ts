import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { clients } from "../src/clients/index.js";
import { readJson, writeJson } from "../src/fsutil.js";

const ctx = { url: "https://scraping-api.datafuel.ai", key: "df_key_test_fake_0000000000001234" };
const mode = async (p: string) => (await stat(p)).mode & 0o777;
const json = async (p: string) => JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;

let home: string;

beforeAll(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "datafuel-mcp-")));
  vi.stubEnv("HOME", home);
  vi.stubEnv("PATH", "");
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

  it("creates new files 600 without a backup", async () => {
    const p = join(home, "new", "a.json");
    expect(await writeJson(p, { a: 1 })).toBeUndefined();
    expect(await mode(p)).toBe(0o600);
    expect(await json(p)).toEqual({ a: 1 });
  });

  it("backs up existing files and tightens them to 600", async () => {
    const p = join(home, "existing.json");
    await writeFile(p, '{"old":true}', { mode: 0o644 });
    expect(await writeJson(p, { new: true })).toBe(p + ".bak");
    expect(await mode(p)).toBe(0o600);
    expect(await mode(p + ".bak")).toBe(0o600);
    expect(await json(p + ".bak")).toEqual({ old: true });
    expect(await json(p)).toEqual({ new: true });
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
    const theirs = { url: "x" };
    await writeFile(
      p,
      JSON.stringify({ keep: 1, mcpServers: { other: theirs }, servers: { other: theirs } }),
    );

    expect(await c.configured()).toBe(false);
    await c.install(ctx);
    await c.install(ctx);
    expect(await c.configured()).toBe(true);

    const doc = await json(p);
    expect(doc.keep).toBe(1);
    expect(doc.mcpServers).toMatchObject({ other: theirs });
    expect(doc.servers).toMatchObject({ other: theirs });
    expect(await json(p + ".bak")).toMatchObject({ keep: 1 });

    expect(await c.remove()).toBeTruthy();
    expect(await c.configured()).toBe(false);
    expect(await c.remove()).toBeUndefined();
  });

  it("leaves a broken file alone", async () => {
    const p = c.path();
    await writeFile(p, "{ broken");
    await expect(c.install(ctx)).rejects.toThrow(/not valid JSON/);
    expect(await readFile(p, "utf8")).toBe("{ broken");
  });
});
