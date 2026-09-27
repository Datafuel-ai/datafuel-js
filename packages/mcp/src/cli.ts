import { parseArgs } from "node:util";
import { defaultUrl } from "./api.js";
import { clients } from "./clients/index.js";
import type { Client } from "./clients/types.js";

type Command = "init" | "remove" | "doctor" | "proxy" | "help" | "version";

export type Opts = {
  command: Command;
  url: string;
  apiKey: string | undefined;
  clients: Client[] | undefined;
  project: boolean;
  skill: boolean | undefined;
  yes: boolean;
};

export const usage = `Usage:
  npx -y @datafuel/mcp init   [--api-key KEY] [--client a,b] [--project] [--skill|--no-skill] [-y]
  npx -y @datafuel/mcp remove [--client a,b] [--project]
  npx -y @datafuel/mcp doctor [--api-key KEY] [--client a,b] [--project]
  npx -y @datafuel/mcp            stdio proxy to the DataFuel MCP server, reads DATAFUEL_API_KEY

Clients: ${clients.map((c) => c.id).join(", ")}
--project writes to the current directory (${clients
  .filter((c) => !c.project)
  .map((c) => c.id)
  .join(", ")} have user scope only).`;

const commands = new Set(["init", "remove", "doctor"]);

export function parse(argv: string[], env: NodeJS.ProcessEnv = process.env): Opts {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "api-key": { type: "string" },
      client: { type: "string" },
      project: { type: "boolean", default: false },
      skill: { type: "boolean" },
      "no-skill": { type: "boolean" },
      yes: { type: "boolean", short: "y", default: false },
      url: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (positionals.length > 1) throw new Error(`unexpected argument: ${positionals[1]}`);
  const [cmd] = positionals;
  if (cmd !== undefined && !commands.has(cmd)) throw new Error(`unknown command: ${cmd}`);

  const command: Command = values.help
    ? "help"
    : values.version
      ? "version"
      : ((cmd as Command | undefined) ?? "proxy");
  const url = values.url ?? env.DATAFUEL_URL ?? defaultUrl;
  if (!/^https?:\/\//.test(url)) throw new Error(`invalid --url: ${url}`);
  if (values.skill && values["no-skill"]) throw new Error("--skill and --no-skill conflict");

  const chosen = values.client === undefined ? undefined : pick(values.client);
  const userOnly = chosen?.filter((c) => !c.project) ?? [];
  if (values.project && userOnly.length)
    throw new Error(`--project: no project scope for ${userOnly.map((c) => c.id).join(", ")}`);

  return {
    command,
    url,
    apiKey: values["api-key"]?.trim() || undefined,
    clients: chosen,
    project: values.project,
    skill: values.skill ? true : values["no-skill"] ? false : undefined,
    yes: values.yes,
  };
}

function pick(list: string): Client[] {
  const ids = list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) throw new Error("--client needs at least one client");
  return [...new Set(ids)].map((id) => {
    const c = clients.find((c) => c.id === id);
    if (!c)
      throw new Error(`unknown client: ${id} (one of ${clients.map((c) => c.id).join(", ")})`);
    return c;
  });
}
