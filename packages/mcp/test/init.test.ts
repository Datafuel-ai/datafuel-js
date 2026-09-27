import { mkdir, mkdtemp, readdir, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parse } from "../src/cli.js";
import { init } from "../src/init.js";
import { remove } from "../src/remove.js";
import { type Fake, fake, goodKey } from "./fake.js";
import { gitOnly, repo } from "./git.js";

let srv: Fake;
let home: string;
let out: string[];

async function keyFiles(dir: string): Promise<string[]> {
  const hits: string[] = [];
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const p = join(e.parentPath, e.name);
    if (e.isFile() && (await readFile(p, "utf8")).includes(goodKey)) hits.push(p);
  }
  return hits;
}

beforeAll(async () => {
  srv = await fake();
  home = await realpath(await mkdtemp(join(tmpdir(), "datafuel-init-")));
  vi.stubEnv("HOME", home);
  vi.stubEnv("PATH", await gitOnly(join(home, "bin")));
  vi.stubEnv("CODEX_HOME", "");
  vi.stubEnv("XDG_CONFIG_HOME", "");
  vi.stubEnv("DATAFUEL_API_KEY", "");
});

beforeEach(() => {
  out = [];
  vi.restoreAllMocks();
  vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    out.push(String(c));
    return true;
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await srv.close();
});

const args = (...a: string[]) => parse([...a, "--url", srv.url], {});
const text = () => out.join("");
const inDir = (dir: string) => vi.spyOn(process, "cwd").mockReturnValue(dir);

describe("init -y", () => {
  it("installs every client at user scope, and remove leaves no key behind", async () => {
    const all = "claude-code,cursor,vscode,windsurf,claude-desktop,codex,gemini";
    expect(await init(args("init", "-y", "--api-key", goodKey, "--client", all))).toBe(true);
    expect(await init(args("init", "-y", "--api-key", goodKey, "--client", all))).toBe(true);
    expect(text()).toContain("~/.cursor/mcp.json");
    expect(text()).not.toContain(goodKey);
    expect((await keyFiles(home)).length).toBe(6);

    expect(await remove(args("remove"))).toBe(true);
    expect(await keyFiles(home)).toEqual([]);
  });

  it("writes project files and lists the ones holding the key in .gitignore", async () => {
    const root = join(home, "repo");
    await repo(root);
    inDir(root);

    const chosen = "claude-code,cursor,vscode,codex,gemini";
    const opts = args("init", "-y", "--project", "--api-key", goodKey, "--client", chosen);
    expect(await init(opts)).toBe(true);
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(
      "/.mcp.json\n/.cursor/mcp.json\n/.codex/config.toml\n/.gemini/settings.json\n",
    );
    expect(text()).toMatch(/Cursor\s+\.cursor\/mcp\.json\n/);
    expect(text()).toMatch(/Cursor\s+ignored by \.gitignore/);
    expect(text()).not.toMatch(/VS Code\s+ignored/);
    expect((await keyFiles(root)).length).toBe(4);

    expect(await remove(args("remove", "--project"))).toBe(true);
    expect(await keyFiles(home)).toEqual([]);
  });

  it("refuses a project file git already tracks and writes nothing into it", async () => {
    const root = join(home, "tracked");
    await repo(root, { ".mcp.json": '{ "mcpServers": {} }\n' });
    const app = join(root, "app");
    await mkdir(app);
    inDir(root);

    const project = (clients: string) =>
      args("init", "-y", "--project", "--api-key", goodKey, "--client", clients);
    expect(await init(project("claude-code,cursor"))).toBe(false);
    expect(await readFile(join(root, ".mcp.json"), "utf8")).toBe('{ "mcpServers": {} }\n');
    expect(text()).toMatch(/Claude Code\s+\.mcp\.json is tracked by git, not writing the key/);
    expect(text()).toContain("without --project to use user scope");
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe("/.cursor/mcp.json\n");

    out.length = 0;
    inDir(app);
    expect(await init(project("gemini"))).toBe(true);
    expect(text()).toMatch(/Gemini CLI\s+ignored by \.\.\/\.gitignore/);
    expect(await remove(args("remove", "--project"))).toBe(true);
    inDir(root);
    expect(await remove(args("remove", "--project"))).toBe(true);
    expect(await keyFiles(home)).toEqual([]);
  });

  it("warns outside a git repo", async () => {
    const dir = join(home, "plain");
    await mkdir(dir);
    inDir(dir);
    const opts = args("init", "-y", "--project", "--api-key", goodKey, "--client", "cursor");
    expect(await init(opts)).toBe(true);
    expect(text()).toMatch(/Cursor\s+not a git repository, keep it out of version control/);
    expect(await remove(args("remove", "--project"))).toBe(true);
  });

  it("fails without a key instead of prompting", async () => {
    await expect(init(args("init", "-y"))).rejects.toThrow(/no API key/);
  });
});
