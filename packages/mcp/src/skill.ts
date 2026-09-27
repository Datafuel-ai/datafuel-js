import { rm, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { tagged } from "./api.js";
import { exists, tilde, writeText } from "./fsutil.js";

const max = 256 * 1024;
const dir = () => join(homedir(), ".claude", "skills", "datafuel");
const path = () => join(dir(), "SKILL.md");

async function body(res: Response, src: string): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.length;
    if (size > max) throw new Error(`${src} is larger than 256 KB`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function installSkill(url: string): Promise<string> {
  const src = new URL("/skill.md", url).toString();
  let res: Response;
  try {
    res = await tagged(src, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new Error(`could not fetch ${src}`, { cause: err });
  }
  if (!res.ok) throw new Error(`${src} answered HTTP ${res.status}`);
  const text = await body(res, src);
  if (!text.startsWith("---\n")) throw new Error(`${src} is not a skill file`);
  await writeText(path(), text);
  return tilde(path());
}

export async function removeSkill(): Promise<string | undefined> {
  if (!(await exists(path()))) return undefined;
  await rm(path());
  await rmdir(dir()).catch(() => {});
  return tilde(dir());
}
