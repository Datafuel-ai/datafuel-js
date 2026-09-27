import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parse } from "../src/cli.js";
import { cursor } from "../src/clients/cursor.js";
import { windsurf } from "../src/clients/windsurf.js";
import { doctor } from "../src/doctor.js";
import { type Fake, fake, goodKey } from "./fake.js";

let srv: Fake;
let home: string;

beforeAll(async () => {
  srv = await fake();
  home = await realpath(await mkdtemp(join(tmpdir(), "datafuel-doctor-")));
  vi.stubEnv("HOME", home);
  vi.stubEnv("PATH", "");
  vi.stubEnv("CODEX_HOME", "");
  vi.stubEnv("XDG_CONFIG_HOME", "");
  vi.stubEnv("DATAFUEL_API_KEY", "");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await srv.close();
});

async function run(...args: string[]): Promise<{ ok: boolean; out: string }> {
  const chunks: string[] = [];
  const out = vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    chunks.push(String(c));
    return true;
  });
  try {
    const ok = await doctor(parse(["doctor", "--url", srv.url, ...args], {}));
    return { ok, out: chunks.join("") };
  } finally {
    out.mockRestore();
  }
}

describe("doctor", () => {
  it("fails without a key and does not call the API", async () => {
    const before = srv.seen.length;
    const { ok, out } = await run();
    expect(ok).toBe(false);
    expect(out).toMatch(/API key\s+not set/);
    expect(out).toMatch(/Cursor\s+not found/);
    expect(srv.seen.length).toBe(before);
  });

  it("passes with a good key", async () => {
    const { ok, out } = await run("--api-key", goodKey);
    expect(ok).toBe(true);
    expect(out).toContain(`${srv.url} reachable`);
    expect(out).toContain("df_key_••••1234 valid (12,480 credits)");
    expect(out).not.toContain(goodKey);
  });

  it("fails on a rejected key without printing it", async () => {
    const bad = "df_key_test_rejected_000000009999";
    const { ok, out } = await run("--api-key", bad);
    expect(ok).toBe(false);
    expect(out).toContain("df_key_••••9999 rejected");
    expect(out).not.toContain(bad);
  });

  it("reports configured clients and stale keys without printing either key", async () => {
    const old = "df_key_test_old_00000000000004321";
    await cursor.install({ url: srv.url, key: old });

    const stale = await run("--api-key", goodKey);
    expect(stale.ok).toBe(false);
    expect(stale.out).toMatch(/Cursor\s+stale key \(~\/\.cursor\/mcp\.json\)/);
    expect(stale.out).not.toContain(old);
    expect(stale.out).not.toContain(goodKey);
    expect(stale.out).not.toContain("4321");

    await cursor.install({ url: srv.url, key: goodKey });
    const fresh = await run("--api-key", goodKey);
    expect(fresh.ok).toBe(true);
    expect(fresh.out).toMatch(/Cursor\s+configured \(~\/\.cursor\/mcp\.json\)/);
  });

  it("prints the file the entry was found in", async () => {
    await windsurf.install({ url: srv.url, key: goodKey });
    await mkdir(join(home, ".config", "devin"), { recursive: true });
    const { out } = await run("--api-key", goodKey, "--client", "windsurf");
    expect(out).toMatch(/Windsurf\s+configured \(~\/\.codeium\/windsurf\/mcp_config\.json\)/);
    await windsurf.remove();
  });

  it("reports a stale key left in any of a client's files", async () => {
    const legacy = join(home, ".codeium", "windsurf", "mcp_config.json");
    await windsurf.install({ url: srv.url, key: goodKey });
    const old = {
      mcpServers: {
        datafuel: { serverUrl: "x", headers: { "X-API-Key": "df_key_test_old_00000000000004321" } },
      },
    };
    await writeFile(legacy, JSON.stringify(old));
    const { ok, out } = await run("--api-key", goodKey, "--client", "windsurf");
    expect(ok).toBe(false);
    expect(out).toMatch(/Windsurf\s+stale key \(~\/\.codeium\/windsurf\/mcp_config\.json\)/);
    expect(out).not.toContain("4321");
    await windsurf.remove();
  });
});
