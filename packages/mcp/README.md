# @datafuel/mcp

Set up the [DataFuel](https://datafuel.ai) MCP server in Claude Code, Cursor, VS Code, Windsurf, Claude Desktop, Codex and Gemini CLI with one command.

```bash
npx -y @datafuel/mcp init
```

`init` asks for your API key, checks it, finds the MCP clients on your machine, and adds a `datafuel` server to each one you pick. After that the client talks to `https://scraping-api.datafuel.ai/mcp` directly; the CLI is not involved any more, except for Claude Desktop, which runs it as a local stdio proxy.

```
┌  DataFuel MCP setup
◆  API key df_key_••••1234 valid (12,480 credits)
◆  Claude Code     user scope → https://scraping-api.datafuel.ai/mcp
◆  Cursor          ~/.cursor/mcp.json (backup: mcp.json.bak)
◆  Skill           ~/.claude/skills/datafuel/SKILL.md
└  Restart Claude Code, Cursor. Try: "scrape https://example.com as markdown"
```

Restart the clients afterwards so they load the new server.

## Requirements

- Node.js 20.3 or later, on macOS, Linux or Windows.
- A DataFuel API key (`df_key_…`) from your DataFuel account.

## Clients

| `--client`       | Config written (user scope)                                                                  | `--project`             | Connects |
| ---------------- | -------------------------------------------------------------------------------------------- | ----------------------- | -------- |
| `claude-code`    | `claude mcp add --scope user`, or `~/.claude.json` when the `claude` CLI is missing or fails | `.mcp.json`             | HTTP     |
| `cursor`         | `~/.cursor/mcp.json`                                                                         | `.cursor/mcp.json`      | HTTP     |
| `vscode`         | user `mcp.json` (`~/Library/Application Support/Code/User/` on macOS, see below)             | `.vscode/mcp.json`      | HTTP     |
| `windsurf`       | `~/.config/devin/mcp_config.json`, or `~/.codeium/windsurf/mcp_config.json` (see below)      | none                    | HTTP     |
| `claude-desktop` | `claude_desktop_config.json` in Claude's app folder                                          | none                    | stdio    |
| `codex`          | `~/.codex/config.toml` (`$CODEX_HOME/config.toml` when set)                                  | `.codex/config.toml`    | HTTP     |
| `gemini`         | `~/.gemini/settings.json`                                                                    | `.gemini/settings.json` | HTTP     |

- **VS Code:** the user `mcp.json` is in `~/Library/Application Support/Code/User/` on macOS, `%APPDATA%\Code\User\` on Windows and `~/.config/Code/User/` on Linux. The key is not written to disk: VS Code asks for it when the server first starts and stores it securely itself.
- **Windsurf:** Windsurf is now Devin Desktop. When `~/.config/devin/` (`%APPDATA%\devin\` on Windows) exists, the entry goes there and any old one is removed from `~/.codeium/windsurf/`. Otherwise it goes to the legacy `~/.codeium/windsurf/mcp_config.json`.
- **Claude Desktop:** `~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows. Its local config can only start commands, so the entry runs `npx -y @datafuel/mcp` with `DATAFUEL_API_KEY` in its environment.
- **Claude Code on Windows:** `~/.claude.json` is edited directly instead of calling `claude mcp add`.
- **Codex:** a project `.codex/config.toml` is only loaded for projects you trusted in Codex.

## Commands

```
npx -y @datafuel/mcp init   [--api-key KEY] [--client a,b] [--project] [--skill|--no-skill] [-y]
npx -y @datafuel/mcp remove [--client a,b] [--project]
npx -y @datafuel/mcp doctor [--api-key KEY] [--client a,b] [--project]
npx -y @datafuel/mcp        stdio proxy, reads DATAFUEL_API_KEY
```

| Flag                     | Meaning                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `--api-key KEY`          | The API key. Otherwise `DATAFUEL_API_KEY`, otherwise a masked prompt.                          |
| `--client a,b`           | Only these clients, by the ids in the table above. Default: pick from the detected ones.       |
| `--project`              | Write the current directory's project config instead of the user config.                       |
| `--skill` / `--no-skill` | Install the DataFuel skill for Claude Code, or don't. Default: ask when Claude Code is chosen. |
| `-y`, `--yes`            | No prompts: every detected client (or `--client`), and the skill when Claude Code is chosen.   |
| `-h`, `--help`           | Usage.                                                                                         |
| `-v`, `--version`        | Version.                                                                                       |

### init

The key is checked against your balance before anything is written. A rejected key is asked for again; with `-y`, or when stdin is not a terminal, init stops instead. Without `--client` you pick from a list with the detected clients preselected; with `-y` every detected client is set up, and init fails if none is found.

Each client is written on its own. If one fails, the others still go through, the failure is printed with its reason, and init exits with code 1. Running init again replaces the `datafuel` entry, so it is also how you change the key.

### remove

Takes the `datafuel` entry out of every client, or only those in `--client`. At user scope it also deletes the skill when Claude Code is included. No key needed.

### doctor

```bash
npx -y @datafuel/mcp doctor --api-key df_key_...
```

Checks that the API is reachable and the key is valid, then reports each client as `configured` (with the file), `stale key` (the file holds a different key than the one given), `detected, not configured` or `not found` (`not configured` under `--project`). VS Code never shows a stale key, since its key is not on disk. Without a key it only reports where DataFuel is configured. It exits with code 1 on a stale key, a failed check, or when no key was given.

## Project scope

`--project` writes into the current directory, for clients that read a project config: Claude Code, Cursor, VS Code, Codex and Gemini CLI. Windsurf and Claude Desktop have no project config; naming them with `--project` is an error, and without `--client` they are not offered.

Every project file except VS Code's holds the key, so init guards against committing it:

- If git already tracks the file, init refuses that client, writes nothing to it, and exits with code 1. Use user scope instead. The same happens when git cannot be asked.
- Otherwise the file is added, as `/<path>`, to the `.gitignore` at the repository root.
- Outside a git repository init writes the file and warns you to keep it out of version control.

`.vscode/mcp.json` holds no key (VS Code prompts for it), so it is safe to commit and is left alone.

Under `--project` the skill is off unless you pass `--skill`; it still goes to your user folder. `remove --project` leaves the skill in place.

## Skill

For Claude Code, init can also install the DataFuel skill: `~/.claude/skills/datafuel/SKILL.md`, downloaded from `https://scraping-api.datafuel.ai/skill.md`. It tells the model which endpoint fits which job, what things cost and how to read results and errors. It is offered when Claude Code is among the chosen clients and installed by default with `-y`. `--no-skill` skips it, `remove` deletes it.

## Stdio proxy

Without a command, the package runs a stdio MCP server that forwards every message to `https://scraping-api.datafuel.ai/mcp`. Use it for any client that can only start a local command:

```json
{
  "mcpServers": {
    "datafuel": {
      "command": "npx",
      "args": ["-y", "@datafuel/mcp"],
      "env": { "DATAFUEL_API_KEY": "df_key_..." }
    }
  }
}
```

Clients that speak streamable HTTP should connect to the URL directly with an `X-API-Key` header; init sets them up that way.

## Security

- The key is never printed in full. Output and error messages show `df_key_••••1234`.
- Only the `datafuel` entry is touched (for VS Code also its `datafuel-api-key` input). Other servers and settings stay as they were, and the Codex TOML keeps its comments and layout.
- Writes are atomic (temporary file, then rename) and every config file and backup init writes gets mode `600`.
- When init adds DataFuel to an existing file, it first copies the file to `<file>.bak`. That happens once, while the file has no `datafuel` entry yet, so the backup is your original and never holds the key. Later runs don't overwrite it.
- A config file that cannot be parsed is left untouched and reported. For VS Code and Codex, init prints the snippet to add by hand, without the key.
- VS Code keeps the key off disk. The other clients store it in plain text in their config file.
- Claude Code: init passes the key to `claude mcp add --header`, the documented way to add a server with a header. While that command runs, the key is visible in the local process list (`ps`).
- Requests from the CLI and the proxy carry `X-DataFuel-Client: mcp-cli/<version>` (`/stdio` appended by the proxy), so DataFuel can tell them apart in its logs.

## Manual setup

To configure a client by hand, or one this tool does not know, see the [AI agents and MCP guide](https://docs.datafuel.ai/scraping-api/mcp). Full API reference and guides: https://docs.datafuel.ai

## License

MIT, see [LICENSE](LICENSE).
