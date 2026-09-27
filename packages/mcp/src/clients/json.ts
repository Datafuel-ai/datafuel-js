import { type Doc, isObject, readJson, saved, tilde, writeJson } from "../fsutil.js";
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
): Promise<string | undefined> {
  const prev = await readJson(path);
  let doc: Doc | undefined;
  try {
    doc = next(prev);
  } catch (err) {
    throw new Error(`${tilde(path)}: ${(err as Error).message}, left untouched`, { cause: err });
  }
  if (!doc) return undefined;
  return saved(path, await writeJson(path, doc, !!prev && !getServer(prev, root)));
}

export const found = (path: string, key: unknown): Found => ({
  path,
  key: typeof key === "string" ? key : undefined,
});

export const header = (e: Doc) => (isObject(e.headers) ? e.headers["X-API-Key"] : undefined);

type Spec = Pick<Client, "id" | "label" | "detect" | "restart"> & {
  root: string;
  entry: (ctx: Ctx, path: string) => Doc;
  key: (entry: Doc) => unknown;
  paths: () => string[];
};

export function jsonClient({ root, entry, key, paths, ...rest }: Spec): Client {
  return {
    ...rest,
    path: () => paths()[0]!,
    async configured() {
      for (const p of paths()) {
        const e = getServer(await readJson(p), root);
        if (e) return found(p, key(e));
      }
      return undefined;
    },
    async install(ctx) {
      const p = paths()[0]!;
      return (await update(p, root, (doc) => setServer(doc, root, entry(ctx, p))))!;
    },
    async remove() {
      const done: string[] = [];
      for (const p of paths()) {
        const where = await update(p, root, (doc) => unsetServer(doc, root));
        if (where) done.push(where);
      }
      return done.join(", ") || undefined;
    },
  };
}
