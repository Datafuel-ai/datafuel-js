import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { exists, readText } from "./fsutil.js";

const run = promisify(execFile);

export async function gitRoot(dir: string): Promise<string | undefined> {
  for (let d = dir; ; d = dirname(d)) {
    if (await exists(join(d, ".git"))) return d;
    if (dirname(d) === d) return undefined;
  }
}

export async function tracked(root: string, file: string): Promise<boolean> {
  try {
    await run("git", ["ls-files", "--error-unmatch", "--", file], { cwd: root, timeout: 10_000 });
    return true;
  } catch (err) {
    if ((err as { code?: unknown }).code === 1) return false;
    throw new Error("could not ask git whether it tracks the file", { cause: err });
  }
}

export async function ignore(root: string, file: string): Promise<string> {
  const rel = relative(root, file).split(sep).join("/");
  const path = join(root, ".gitignore");
  const text = (await readText(path)) ?? "";
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (!lines.includes(rel) && !lines.includes(`/${rel}`))
    await appendFile(path, `${text && !text.endsWith("\n") ? "\n" : ""}/${rel}\n`);
  return path;
}
