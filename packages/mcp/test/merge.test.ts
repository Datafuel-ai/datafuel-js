import { describe, expect, it } from "vitest";

import * as claudeCode from "../src/clients/claude-code.js";
import * as claudeDesktop from "../src/clients/claude-desktop.js";
import * as codex from "../src/clients/codex.js";
import * as cursor from "../src/clients/cursor.js";
import * as gemini from "../src/clients/gemini.js";
import * as vscode from "../src/clients/vscode.js";
import * as windsurf from "../src/clients/windsurf.js";

const ctx = { url: "https://scraping-api.datafuel.ai", key: "df_key_test_fake_0000000000001234" };
const other = { command: "other", args: [] };

describe.each([
  ["claude-code", claudeCode],
  ["cursor", cursor],
  ["windsurf", windsurf],
  ["claude-desktop", claudeDesktop],
  ["gemini", gemini],
] as const)("%s merge", (_, c) => {
  it("creates the document when the file is empty", () => {
    expect(c.merge(undefined, ctx)).toEqual({ mcpServers: { datafuel: c.entry(ctx) } });
  });

  it("keeps other servers and top-level keys", () => {
    const doc = { theme: "dark", mcpServers: { other } };
    expect(c.merge(doc, ctx)).toEqual({
      theme: "dark",
      mcpServers: { other, datafuel: c.entry(ctx) },
    });
    expect(doc).toEqual({ theme: "dark", mcpServers: { other } });
  });

  it("replaces an existing datafuel entry", () => {
    const doc = { mcpServers: { datafuel: { url: "stale" }, other } };
    expect(c.merge(doc, ctx)).toEqual({ mcpServers: { datafuel: c.entry(ctx), other } });
  });

  it("refuses a malformed mcpServers", () => {
    expect(() => c.merge({ mcpServers: [] }, ctx)).toThrow(/not an object/);
    expect(() => c.merge({ mcpServers: "x" }, ctx)).toThrow(/not an object/);
  });

  it("removes only datafuel", () => {
    expect(c.unmerge({ a: 1, mcpServers: { datafuel: {}, other } })).toEqual({
      a: 1,
      mcpServers: { other },
    });
  });

  it("reports nothing to remove", () => {
    expect(c.unmerge(undefined)).toBeUndefined();
    expect(c.unmerge({ mcpServers: { other } })).toBeUndefined();
  });
});

describe("entries", () => {
  it("claude code uses http with the key header", () => {
    expect(claudeCode.entry(ctx)).toEqual({
      type: "http",
      url: "https://scraping-api.datafuel.ai/mcp",
      headers: { "X-API-Key": ctx.key },
    });
  });

  it("cursor uses url and headers", () => {
    expect(cursor.entry(ctx)).toEqual({
      url: "https://scraping-api.datafuel.ai/mcp",
      headers: { "X-API-Key": ctx.key },
    });
  });

  it("windsurf uses url, serverUrl only in the legacy file", () => {
    expect(windsurf.entry(ctx)).toEqual({
      url: "https://scraping-api.datafuel.ai/mcp",
      headers: { "X-API-Key": ctx.key },
    });
    expect(windsurf.entry(ctx, true)).toEqual({
      serverUrl: "https://scraping-api.datafuel.ai/mcp",
      headers: { "X-API-Key": ctx.key },
    });
  });

  it("gemini uses httpUrl and headers", () => {
    expect(gemini.entry(ctx)).toEqual({
      httpUrl: "https://scraping-api.datafuel.ai/mcp",
      headers: { "X-API-Key": ctx.key },
    });
  });

  it("claude desktop runs the stdio proxy, DATAFUEL_URL only off the default", () => {
    expect(claudeDesktop.entry(ctx)).toEqual({
      command: "npx",
      args: ["-y", "@datafuel/mcp"],
      env: { DATAFUEL_API_KEY: ctx.key },
    });
    const staging = { ...ctx, url: "https://scraping-api.staging.datafuel.ai" };
    expect(claudeDesktop.entry(staging).env).toEqual({
      DATAFUEL_API_KEY: ctx.key,
      DATAFUEL_URL: staging.url,
    });
  });
});

describe("vscode merge", () => {
  const input = {
    type: "promptString",
    id: "datafuel-api-key",
    description: "DataFuel API key",
    password: true,
  };

  it("never writes the key", () => {
    expect(JSON.stringify(vscode.merge(undefined, ctx.url))).not.toContain(ctx.key);
  });

  it("creates servers and inputs", () => {
    expect(vscode.merge(undefined, ctx.url)).toEqual({
      servers: {
        datafuel: {
          type: "http",
          url: "https://scraping-api.datafuel.ai/mcp",
          headers: { "X-API-Key": "${input:datafuel-api-key}" },
        },
      },
      inputs: [input],
    });
  });

  it("keeps other servers and inputs, replaces its own", () => {
    const theirs = { type: "promptString", id: "gh", description: "token", password: true };
    const doc = {
      servers: { other, datafuel: { url: "stale" } },
      inputs: [theirs, { ...input, description: "old" }],
    };
    const next = vscode.merge(doc, ctx.url);
    expect(next.inputs).toEqual([theirs, input]);
    expect(Object.keys(next.servers as object)).toEqual(["other", "datafuel"]);
  });

  it("refuses malformed servers or inputs", () => {
    expect(() => vscode.merge({ servers: [] }, ctx.url)).toThrow(/not an object/);
    expect(() => vscode.merge({ inputs: {} }, ctx.url)).toThrow(/not an array/);
  });

  it("removes server and input, keeps the rest", () => {
    const theirs = { id: "gh" };
    const doc = vscode.merge({ servers: { other }, inputs: [theirs] }, ctx.url);
    expect(vscode.unmerge(doc)).toEqual({ servers: { other }, inputs: [theirs] });
    expect(vscode.unmerge(vscode.merge(undefined, ctx.url))).toEqual({ servers: {} });
    expect(vscode.unmerge({ servers: { other } })).toBeUndefined();
  });
});

describe("codex merge", () => {
  const section = `[mcp_servers.datafuel]
url = "https://scraping-api.datafuel.ai/mcp"

[mcp_servers.datafuel.http_headers]
X-API-Key = "${ctx.key}"
`;
  const theirs = `# top comment
model = "o3" # inline

[mcp_servers.other]
command = "other"
args = []

[profiles.fast]
model = "mini"
`;

  it("creates the section in an empty file", () => {
    expect(codex.merge(undefined, ctx)).toBe(section);
    expect(codex.merge("\n", ctx)).toBe(section);
  });

  it("appends to the file and keeps comments and other tables verbatim", () => {
    expect(codex.merge(theirs, ctx)).toBe(`${theirs}\n${section}`);
  });

  it("replaces an existing datafuel section in place of the old one", () => {
    const old = `${theirs}
[mcp_servers.datafuel]
command = "npx"
args = ["-y", "@datafuel/mcp"] # ours

[mcp_servers.datafuel.env]
DATAFUEL_API_KEY = "df_key_old"

[tail]
x = 1
`;
    const next = codex.merge(old, ctx);
    expect(next).toBe(`${theirs}\n[tail]\nx = 1\n\n${section}`);
    expect(next).not.toContain("df_key_old");
  });

  it("keeps comments that belong to the next table", () => {
    const old = `[mcp_servers.datafuel]
url = "old"
# about datafuel? no, trailing

# about x
[mcp_servers.x]
command = "y"
`;
    expect(codex.merge(old, ctx)).toBe(
      `# about datafuel? no, trailing\n\n# about x\n[mcp_servers.x]\ncommand = "y"\n\n${section}`,
    );
    const inner = `[mcp_servers.datafuel]\nurl = "old"\n# ours\nargs = []\n\n# about x\n[x]\n`;
    expect(codex.merge(inner, ctx)).toBe(`# about x\n[x]\n\n${section}`);
  });

  it("keeps CRLF line endings", () => {
    const crlf = theirs.replaceAll("\n", "\r\n");
    const next = codex.merge(crlf, ctx);
    expect(next).toBe(`${crlf}\r\n${section.replaceAll("\n", "\r\n")}`);
    expect(next.replaceAll("\r\n", "")).not.toContain("\n");
    expect(codex.merge(`[mcp_servers.datafuel]  # old\r\nurl = "x"\r\n`, ctx)).toBe(
      section.replaceAll("\n", "\r\n"),
    );
    expect(codex.unmerge(next)).toBe(crlf);
  });

  it("refuses invalid TOML and layouts it cannot edit safely", () => {
    expect(() => codex.merge("[x", ctx)).toThrow(/not valid TOML/);
    expect(() => codex.merge('mcp_servers = "x"', ctx)).toThrow(/not a table/);
    expect(() => codex.merge('mcp_servers.datafuel.url = "old"\n', ctx)).toThrow(/cannot edit/);
    expect(() => codex.merge('[mcp_servers]\ndatafuel = { url = "old" }\n', ctx)).toThrow(
      /cannot edit/,
    );
  });

  it("removes only datafuel", () => {
    expect(codex.unmerge(codex.merge(theirs, ctx))).toBe(theirs);
    expect(codex.unmerge(section)).toBe("");
  });

  it("reports nothing to remove", () => {
    expect(codex.unmerge(undefined)).toBeUndefined();
    expect(codex.unmerge(theirs)).toBeUndefined();
  });
});
