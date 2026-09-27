import * as p from "@clack/prompts";
import { reason } from "./api.js";
import type { Opts } from "./cli.js";
import { clients } from "./clients/index.js";
import { row } from "./ui.js";

export async function remove(opts: Opts): Promise<boolean> {
  p.intro("Remove DataFuel MCP");
  let ok = true;
  for (const c of opts.clients ?? clients) {
    try {
      const where = await c.remove();
      if (where) p.log.success(row(c.label, `removed from ${where}`));
      else p.log.info(row(c.label, "not configured"));
    } catch (err) {
      ok = false;
      p.log.error(row(c.label, reason(err)));
    }
  }
  p.outro(ok ? "Done. Restart the affected clients." : "Some clients failed.");
  return ok;
}
