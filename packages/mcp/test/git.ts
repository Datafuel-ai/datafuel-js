import { execFileSync } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const bin = execFileSync("sh", ["-c", "command -v git"]).toString().trim();

const git = (cwd: string, ...args: string[]) =>
  execFileSync(bin, ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    stdio: "ignore",
  });

export async function repo(dir: string, committed: Record<string, string> = {}): Promise<void> {
  await mkdir(dir, { recursive: true });
  git(dir, "init", "-q");
  for (const [name, text] of Object.entries(committed)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), text);
    git(dir, "add", name);
  }
  if (Object.keys(committed).length) git(dir, "commit", "-q", "--no-gpg-sign", "-m", "init");
}

export async function gitOnly(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await symlink(bin, join(dir, "git"));
  return dir;
}
