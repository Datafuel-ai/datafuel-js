import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkKey, clientTag } from "../src/api.js";
import { type Fake, fake, goodKey, inactiveKey } from "./fake.js";

describe("checkKey", () => {
  let srv: Fake;
  beforeAll(async () => {
    srv = await fake();
  });
  afterAll(() => srv.close());

  it("returns credits through the SDK and tags the request", async () => {
    expect(await checkKey(srv.url, goodKey)).toEqual({ ok: true, credits: 12480 });
    const h = srv.seen.at(-1);
    expect(h?.["x-api-key"]).toBe(goodKey);
    expect(h?.["x-datafuel-client"]).toBe(clientTag);
    expect(h?.["user-agent"]).toMatch(new RegExp(`^${clientTag} datafuel-js/`));
  });

  it("returns the status for rejected and inactive keys", async () => {
    expect(await checkKey(srv.url, "df_key_wrong")).toEqual({ ok: false, status: 401 });
    expect(await checkKey(srv.url, inactiveKey)).toEqual({ ok: false, status: 403 });
  });

  it("names the url on network errors", async () => {
    await expect(checkKey("http://127.0.0.1:1", goodKey)).rejects.toThrow(
      "could not reach http://127.0.0.1:1/api/v1/users/@me/balance",
    );
  });
});
