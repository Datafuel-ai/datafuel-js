import { basename } from "node:path";
import { type Doc, isObject, readJson, tilde, writeJson } from "../fsutil.js";

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
  const backup = await writeJson(path, doc, !!prev && !getServer(prev, root));
  return backup ? `${tilde(path)} (backup: ${basename(backup)})` : tilde(path);
}
