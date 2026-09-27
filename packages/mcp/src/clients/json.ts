import { type Doc, isObject, readJson, saved, shown, writeJson } from "../fsutil.js";
import type { Client, Ctx, Found } from "./types.js";

export const name = "datafuel";

function servers(doc: Doc | undefined, root: string): Doc {
  const s = doc?.[root];
  if (s === undefined) return {};
  if (!isObject(s)) throw new Error(`"${root}" is not an object`);
  return s;
}

export function setServer(doc: Doc | undefined, root: string, entry: Doc): Doc {
  return { ...doc, [root]: { ...servers(doc, root), [name]: entry } };
}

export function unsetServer(doc: Doc | undefined, root: string): Doc | undefined {
  const s = servers(doc, root);
  if (!(name in s)) return undefined;
  const rest = { ...s };
  delete rest[name];
  return { ...doc, [root]: rest };
}

export function getServer(doc: Doc | undefined, root: string): Doc | undefined {
  const e = servers(doc, root)[name];
  return isObject(e) ? e : undefined;
}

export async function update(
  path: string,
  root: string,
  next: (doc: Doc | undefined) => Doc | undefined,
  dir?: string,
): Promise<string | undefined> {
  const prev = await readJson(path, dir);
  let doc: Doc | undefined;
  try {
    doc = next(prev);
  } catch (err) {
    throw new Error(`${shown(path, dir)}: ${(err as Error).message}, left untouched`, {
      cause: err,
    });
  }
  if (!doc) return undefined;
  return saved(path, await writeJson(path, doc, !!prev && !getServer(prev, root)), dir);
}

export const found = (path: string, key: unknown): Found => ({
  path,
  key: typeof key === "string" ? key : undefined,
});

export const header = (e: Doc) => (isObject(e.headers) ? e.headers["X-API-Key"] : undefined);

type Spec = Pick<Client, "id" | "label" | "project" | "detect" | "restart"> & {
  root: string;
  entry: (ctx: Ctx, path: string) => Doc;
  key: (entry: Doc) => unknown;
  paths: (dir?: string) => string[];
};

export function jsonClient({ root, entry, key, paths, ...rest }: Spec): Client {
  return {
    ...rest,
    keyOnDisk: true,
    path: (dir) => paths(dir)[0]!,
    async configured(dir) {
      const all: Found[] = [];
      for (const p of paths(dir)) {
        const e = getServer(await readJson(p, dir), root);
        if (e) all.push(found(p, key(e)));
      }
      return all;
    },
    async install(ctx, dir) {
      const [p, ...others] = paths(dir);
      const set = (doc: Doc | undefined) => setServer(doc, root, entry(ctx, p!));
      const where = (await update(p!, root, set, dir))!;
      const moved: string[] = [];
      for (const o of others) {
        const from = await update(o, root, (doc) => unsetServer(doc, root), dir);
        if (from) moved.push(from);
      }
      return moved.length ? `${where}, removed from ${moved.join(", ")}` : where;
    },
    async remove(dir) {
      const done: string[] = [];
      for (const p of paths(dir)) {
        const where = await update(p, root, (doc) => unsetServer(doc, root), dir);
        if (where) done.push(where);
      }
      return done.join(", ") || undefined;
    },
  };
}
