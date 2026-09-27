import * as p from "@clack/prompts";
import { reason, version } from "./api.js";
import { parse, usage } from "./cli.js";
import { doctor } from "./doctor.js";
import { init } from "./init.js";
import { proxy } from "./proxy.js";
import { remove } from "./remove.js";

async function main(): Promise<number> {
  let opts;
  try {
    opts = parse(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`datafuel-mcp: ${reason(err)}\n\n${usage}\n`);
    return 2;
  }

  switch (opts.command) {
    case "help":
      process.stdout.write(`${usage}\n`);
      return 0;
    case "version":
      process.stdout.write(`${version}\n`);
      return 0;
    case "proxy": {
      const key = process.env.DATAFUEL_API_KEY?.trim();
      if (!key) {
        process.stderr.write(`datafuel-mcp: DATAFUEL_API_KEY is not set\n\n${usage}\n`);
        return 1;
      }
      await proxy(opts.url, key);
      return 0;
    }
  }

  try {
    const run = { init, remove, doctor }[opts.command];
    return (await run(opts)) ? 0 : 1;
  } catch (err) {
    p.cancel(reason(err));
    return 1;
  }
}

process.exitCode = await main();
