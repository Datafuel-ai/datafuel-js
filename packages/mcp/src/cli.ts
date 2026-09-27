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
  yes: boolean;
};

export const usage = `Usage:
  npx -y @datafuel/mcp init   [--api-key KEY] [--client ${clients.map((c) => c.id).join(",")}] [-y]
  npx -y @datafuel/mcp remove [--client ...]
  npx -y @datafuel/mcp doctor
  npx -y @datafuel/mcp            stdio proxy to the DataFuel MCP server, reads DATAFUEL_API_KEY`;

const commands = new Set(["init", "remove", "doctor"]);

export function parse(argv: string[], env: NodeJS.ProcessEnv = process.env): Opts {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "api-key": { type: "string" },
      client: { type: "string" },
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

  return {
    command,
    url,
    apiKey: values["api-key"]?.trim() || undefined,
    clients: values.client === undefined ? undefined : pick(values.client),
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
