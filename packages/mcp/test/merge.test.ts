import { describe, expect, it } from "vitest";

import * as claudeCode from "../src/clients/claude-code.js";
import * as claudeDesktop from "../src/clients/claude-desktop.js";
import * as cursor from "../src/clients/cursor.js";
import * as vscode from "../src/clients/vscode.js";

const ctx = { url: "https://scraping-api.datafuel.ai", key: "df_key_test_fake_0000000000001234" };
const other = { command: "other", args: [] };

describe.each([
  ["claude-code", claudeCode],
  ["cursor", cursor],
  ["claude-desktop", claudeDesktop],
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
