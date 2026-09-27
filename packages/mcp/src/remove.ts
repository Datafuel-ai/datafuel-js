import * as p from "@clack/prompts";
import { reason } from "./api.js";
import type { Opts } from "./cli.js";
import { claudeCode } from "./clients/claude-code.js";
import { clients } from "./clients/index.js";
import { removeSkill } from "./skill.js";
import { row } from "./ui.js";

export async function remove(opts: Opts): Promise<boolean> {
  p.intro("Remove DataFuel MCP");
  const dir = opts.project ? process.cwd() : undefined;
  const chosen = opts.clients ?? clients.filter((c) => c.project || !dir);
  let ok = true;
  for (const c of chosen) {
    try {
      const where = await c.remove(dir);
      if (where) p.log.success(row(c.label, `removed from ${where}`));
      else p.log.info(row(c.label, "not configured"));
    } catch (err) {
      ok = false;
      p.log.error(row(c.label, reason(err)));
    }
  }
  if (!dir && chosen.includes(claudeCode)) {
    try {
      const where = await removeSkill();
      if (where) p.log.success(row("Skill", `removed ${where}`));
    } catch (err) {
      ok = false;
      p.log.error(row("Skill", reason(err)));
    }
  }
  p.outro(ok ? "Done. Restart the affected clients." : "Some clients failed.");
  return ok;
}
