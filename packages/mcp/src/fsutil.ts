import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, sep } from "node:path";

export type Doc = Record<string, unknown>;

export const isObject = (v: unknown): v is Doc =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export async function readJson(path: string): Promise<Doc | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  if (!text.trim()) return undefined;

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `${tilde(path)} is not valid JSON, left untouched (${(err as Error).message})`,
      {
        cause: err,
      },
    );
  }
  if (!isObject(doc)) throw new Error(`${tilde(path)} is not a JSON object, left untouched`);
  return doc;
}

export async function writeJson(path: string, doc: Doc): Promise<string | undefined> {
  const target = await realpath(path).catch(() => path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });

  let backup: string | undefined;
  if (await exists(target)) {
    backup = `${target}.bak`;
    await copyFile(target, backup);
    await chmod(backup, 0o600);
  }

  const tmp = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(doc, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return backup;
}

export function tilde(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + sep) ? "~" + path.slice(home.length) : path;
}

export function appData(): string {
  return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
}

export function xdgConfig(): string {
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}

export async function onPath(cmd: string): Promise<boolean> {
  const exts =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const s = await stat(join(dir, cmd + ext)).catch(() => undefined);
      if (s?.isFile()) return true;
    }
  }
  return false;
}
