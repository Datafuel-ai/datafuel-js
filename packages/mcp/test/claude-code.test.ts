import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { claudeCode } from "../src/clients/claude-code.js";

const ctx = { url: "https://scraping-api.datafuel.ai", key: "df_key_test_fake_0000000000001234" };

const script = `#!/bin/sh
for a in "$@"; do printf '%s\\037' "$a"; done >> "$CLAUDE_LOG"
echo >> "$CLAUDE_LOG"
if [ "$2" = add ] && [ -n "$CLAUDE_FAIL_ADD" ]; then
  echo "add refused for \${10}" >&2
  exit 1
fi
`;

let home: string;
let log: string;

const calls = async () =>
  (await readFile(log, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\x1f").slice(0, -1));

beforeAll(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "datafuel-claude-")));
  const bin = join(home, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "claude"), script);
  await chmod(join(bin, "claude"), 0o755);
  log = join(home, "calls.log");
  vi.stubEnv("HOME", home);
  vi.stubEnv("PATH", bin);
  vi.stubEnv("CLAUDE_LOG", log);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await rm(log, { force: true });
  await rm(join(home, ".claude.json"), { force: true });
  vi.stubEnv("CLAUDE_FAIL_ADD", "");
});

describe("claude code through the claude CLI", () => {
  it("removes, then adds at user scope with the header after name and url", async () => {
    expect(await claudeCode.install(ctx)).toBe("user scope → https://scraping-api.datafuel.ai/mcp");
    expect(await calls()).toEqual([
      ["mcp", "remove", "--scope", "user", "datafuel"],
      [
        "mcp",
        "add",
        "--scope",
        "user",
        "--transport",
        "http",
        "datafuel",
        "https://scraping-api.datafuel.ai/mcp",
        "--header",
        `X-API-Key: ${ctx.key}`,
      ],
    ]);
  });

  it("falls back to editing ~/.claude.json when add fails, without leaking the key", async () => {
    vi.stubEnv("CLAUDE_FAIL_ADD", "1");
    const lines: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      expect(await claudeCode.install(ctx)).toBe("~/.claude.json");
    } finally {
      stderr.mockRestore();
    }

    const doc = JSON.parse(await readFile(join(home, ".claude.json"), "utf8"));
    expect(doc.mcpServers.datafuel.headers["X-API-Key"]).toBe(ctx.key);

    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toMatch(
      /^datafuel-mcp: claude mcp add failed \(.*\), editing ~\/\.claude\.json\n$/,
    );
    expect(line).toContain("X-API-Key: df_key_••••1234");
    expect(line).not.toContain(ctx.key);
  });

  it("removes through the CLI when the entry exists", async () => {
    await writeFile(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { datafuel: { url: "x" } } }),
    );
    expect(await claudeCode.remove()).toBe("user scope");
    expect(await calls()).toEqual([["mcp", "remove", "--scope", "user", "datafuel"]]);
  });

  it("does not call the CLI when nothing is configured", async () => {
    expect(await claudeCode.remove()).toBeUndefined();
    expect(await calls()).toEqual([]);
  });
});
