import { createServer, type RequestListener } from "node:http";
import { mkdtemp, readFile, realpath, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { installSkill, removeSkill } from "../src/skill.js";
import { type Fake, fake, skill } from "./fake.js";

let home: string;
let srv: Fake;

beforeAll(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "datafuel-skill-")));
  vi.stubEnv("HOME", home);
  srv = await fake();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await srv.close();
});

async function serve(handler: RequestListener, run: (url: string) => Promise<void>) {
  const http = createServer(handler);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(http.address() as AddressInfo).port}`);
  } finally {
    http.close();
  }
}

const dir = () => join(home, ".claude", "skills", "datafuel");

describe("skill", () => {
  it("downloads SKILL.md with the client tag and removes it again", async () => {
    const path = join(dir(), "SKILL.md");
    expect(await installSkill(srv.url)).toBe("~/.claude/skills/datafuel/SKILL.md");
    expect(await readFile(path, "utf8")).toBe(skill);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(srv.seen.at(-1)?.["x-datafuel-client"]).toMatch(/^mcp-cli\//);

    expect(await removeSkill()).toBe("~/.claude/skills/datafuel");
    await expect(stat(dir())).rejects.toThrow();
    expect(await removeSkill()).toBeUndefined();
  });

  it("refuses error pages, redirects, oversized bodies and unreachable hosts", async () => {
    await serve(
      (_, res) => res.end("<html>maintenance</html>"),
      (url) => expect(installSkill(url)).rejects.toThrow(/not a skill file/),
    );
    await serve(
      (_, res) => res.writeHead(302, { location: `${srv.url}/skill.md` }).end(),
      (url) => expect(installSkill(url)).rejects.toThrow(/could not fetch/),
    );
    await serve(
      (_, res) => res.end(`---\n${"x".repeat(300 * 1024)}`),
      (url) => expect(installSkill(url)).rejects.toThrow(/larger than 256 KB/),
    );
    await expect(installSkill("http://127.0.0.1:1")).rejects.toThrow(/could not fetch/);
    await expect(stat(dir())).rejects.toThrow();
  });
});
