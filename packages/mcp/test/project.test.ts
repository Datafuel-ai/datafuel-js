import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { gitRoot, ignore, tracked } from "../src/project.js";
import { gitOnly, repo } from "./git.js";

let home: string;

beforeAll(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "datafuel-project-")));
  vi.stubEnv("HOME", home);
  vi.stubEnv("PATH", await gitOnly(join(home, "bin")));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("gitignore", () => {
  it("adds the file once to the repo root .gitignore", async () => {
    const root = join(home, "repo");
    const dir = join(root, "app");
    await repo(root);
    await mkdir(dir);
    await writeFile(join(root, ".gitignore"), "node_modules");

    expect(await gitRoot(dir)).toBe(root);
    const file = join(dir, ".cursor", "mcp.json");
    expect(await ignore(root, file)).toBe(join(root, ".gitignore"));
    expect(await ignore(root, file)).toBe(join(root, ".gitignore"));
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(
      "node_modules\n/app/.cursor/mcp.json\n",
    );
  });

  it("creates .gitignore when missing and respects an existing entry", async () => {
    const root = join(home, "fresh");
    await repo(root);
    await ignore(root, join(root, ".mcp.json"));
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe("/.mcp.json\n");

    await writeFile(join(root, ".gitignore"), ".gemini/settings.json\n");
    await ignore(root, join(root, ".gemini", "settings.json"));
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(".gemini/settings.json\n");
  });

  it("finds no root outside a git repo", async () => {
    const dir = join(home, "plain");
    await mkdir(dir);
    expect(await gitRoot(dir)).toBeUndefined();
  });
});

describe("tracked", () => {
  it("tells committed files from untracked ones", async () => {
    const root = join(home, "committed");
    await repo(root, { ".mcp.json": "{}\n", "app/.cursor/mcp.json": "{}\n" });
    expect(await tracked(root, join(root, ".mcp.json"))).toBe(true);
    expect(await tracked(root, join(root, "app", ".cursor", "mcp.json"))).toBe(true);
    expect(await tracked(root, join(root, ".gemini", "settings.json"))).toBe(false);
  });

  it("fails closed when git cannot answer", async () => {
    const fake = join(home, "fake");
    await mkdir(join(fake, ".git"), { recursive: true });
    await expect(tracked(fake, join(fake, ".mcp.json"))).rejects.toThrow(/could not ask git/);
  });
});
