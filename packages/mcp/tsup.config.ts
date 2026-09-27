import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsup";

async function licenses(): Promise<void> {
  const meta = JSON.parse(await readFile("dist/metafile-esm.json", "utf8")) as {
    inputs: Record<string, unknown>;
  };
  await rm("dist/metafile-esm.json");

  const dirs = new Map<string, string>();
  for (const input of Object.keys(meta.inputs)) {
    const m = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(input);
    if (m?.[1] && m[2]) dirs.set(m[2], m[1]);
  }

  const parts = ["# Third-party licenses\n\nThis bundle includes the following packages.\n"];
  for (const [name, dir] of [...dirs].sort()) {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      version: string;
      license: string;
    };
    const file = (await readdir(dir)).find((f) => /^licen[cs]e/i.test(f));
    if (!file) throw new Error(`no license file for bundled package ${name}`);
    const text = (await readFile(join(dir, file), "utf8")).trim();
    parts.push(`## ${name}@${pkg.version} (${pkg.license})\n\n\`\`\`\n${text}\n\`\`\`\n`);
  }
  await writeFile("dist/THIRD_PARTY_LICENSES.md", parts.join("\n"));
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  noExternal: [/^@modelcontextprotocol\//, "zod"],
  metafile: true,
  onSuccess: licenses,
});
