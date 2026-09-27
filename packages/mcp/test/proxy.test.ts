import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { clientTag } from "../src/api.js";
import { proxy } from "../src/proxy.js";
import { type Fake, fake, goodKey } from "./fake.js";

function start(url: string, key: string) {
  const input = new PassThrough();
  const output = new PassThrough();
  const done = proxy(url, key, input, output);
  const lines = createInterface({ input: output })[Symbol.asyncIterator]();

  return {
    done,
    async call(id: number, method: string, params: object = {}) {
      input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      const { value } = await lines.next();
      return JSON.parse(String(value));
    },
    notify(method: string) {
      input.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
    },
    end: () => input.end(),
  };
}

const init = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test", version: "0" },
};

describe("stdio proxy", () => {
  let srv: Fake;
  beforeAll(async () => {
    srv = await fake();
  });
  afterAll(() => srv.close());

  it("forwards both ways with the key and client tag, and ends with stdin", async () => {
    const p = start(srv.url, goodKey);

    const res = await p.call(1, "initialize", init);
    expect(res).toMatchObject({ id: 1, result: { serverInfo: { name: "fake" } } });
    p.notify("notifications/initialized");

    const tools = await p.call(2, "tools/list");
    expect(tools.result.tools).toEqual([expect.objectContaining({ name: "get_balance" })]);

    const call = await p.call(3, "tools/call", { name: "get_balance", arguments: {} });
    expect(call.result.content[0].text).toBe("called get_balance");

    const posts = srv.seen.filter((h) => h["content-type"] === "application/json");
    expect(posts.length).toBeGreaterThanOrEqual(4);
    for (const h of posts) {
      expect(h["x-api-key"]).toBe(goodKey);
      expect(h["x-datafuel-client"]).toBe(`${clientTag}/stdio`);
    }
    expect(posts.at(-1)?.["mcp-protocol-version"]).toBe("2025-06-18");

    p.end();
    await expect(p.done).resolves.toBeUndefined();
  });

  it("answers a request with a JSON-RPC error when the server rejects it", async () => {
    const p = start(srv.url, "df_key_wrong_000000000000009999");
    const res = await p.call(7, "initialize", init);
    expect(res.id).toBe(7);
    expect(res.error.message).toMatch(/401/);
    expect(res.error.message).not.toContain("df_key_wrong");
    p.end();
    await p.done;
  });
});
