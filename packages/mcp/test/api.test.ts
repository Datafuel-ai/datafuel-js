import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkKey, clientTag } from "../src/api.js";
import { type Fake, fake, goodKey, inactiveKey } from "./fake.js";

async function serve(reply: (res: ServerResponse) => void) {
  const http = createServer((_, res) => reply(res));
  await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => http.close(() => done())),
  };
}

describe("checkKey", () => {
  let srv: Fake;
  beforeAll(async () => {
    srv = await fake();
  });
  afterAll(() => srv.close());

  it("returns credits and tags the request", async () => {
    expect(await checkKey(srv.url, goodKey)).toEqual({ ok: true, credits: 12480 });
    const h = srv.seen.at(-1);
    expect(h?.["x-api-key"]).toBe(goodKey);
    expect(h?.["x-datafuel-client"]).toBe(clientTag);
    expect(h?.["user-agent"]).toBe(clientTag);
  });

  it("returns the status for rejected and inactive keys", async () => {
    expect(await checkKey(srv.url, "df_key_wrong")).toEqual({ ok: false, status: 401 });
    expect(await checkKey(srv.url, inactiveKey)).toEqual({ ok: false, status: 403 });
  });

  it("does not follow redirects, so the key never reaches another host", async () => {
    const other = await fake();
    const hop = await serve((res) => {
      res.writeHead(302, { location: `${other.url}/api/v1/users/@me/balance` });
      res.end();
    });
    try {
      expect(await checkKey(hop.url, goodKey)).toEqual({ ok: false, status: 302 });
      expect(other.seen).toEqual([]);
    } finally {
      await hop.close();
      await other.close();
    }
  });

  it("rejects an answer without a numeric balance", async () => {
    const odd = await serve((res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>maintenance</html>");
    });
    try {
      await expect(checkKey(odd.url, goodKey)).rejects.toThrow(
        `unexpected answer from ${odd.url}/api/v1/users/@me/balance`,
      );
    } finally {
      await odd.close();
    }
  });

  it("names the url on network errors", async () => {
    await expect(checkKey("http://127.0.0.1:1", goodKey)).rejects.toThrow(
      "could not reach http://127.0.0.1:1/api/v1/users/@me/balance",
    );
  });
});
