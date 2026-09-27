import { describe, expect, it } from "vitest";

import { parse } from "../src/cli.js";
import { mask, redact } from "../src/mask.js";

describe("parse", () => {
  it("defaults to the proxy on the prod url", () => {
    const o = parse([], {});
    expect(o.command).toBe("proxy");
    expect(o.url).toBe("https://scraping-api.datafuel.ai");
  });

  it("reads init flags", () => {
    const o = parse(
      ["init", "--api-key", " df_key_x ", "--client", "cursor,vscode,cursor", "-y"],
      {},
    );
    expect(o.command).toBe("init");
    expect(o.apiKey).toBe("df_key_x");
    expect(o.clients?.map((c) => c.id)).toEqual(["cursor", "vscode"]);
    expect(o.yes).toBe(true);
  });

  it("takes --url over DATAFUEL_URL", () => {
    expect(parse([], { DATAFUEL_URL: "http://env" }).url).toBe("http://env");
    expect(parse(["--url", "http://flag"], { DATAFUEL_URL: "http://env" }).url).toBe("http://flag");
  });

  it("rejects unknown commands, clients, flags and urls", () => {
    expect(() => parse(["nope"], {})).toThrow(/unknown command/);
    expect(() => parse(["init", "--client", "emacs"], {})).toThrow(/unknown client: emacs/);
    expect(() => parse(["init", "--client", ","], {})).toThrow(/at least one/);
    expect(() => parse(["init", "--bogus"], {})).toThrow();
    expect(() => parse(["--url", "ftp://x"], {})).toThrow(/invalid --url/);
  });
});

describe("mask", () => {
  it("shows only the last four characters", () => {
    const key = "df_key_test_fake_0000000000001234";
    expect(mask(key)).toBe("df_key_••••1234");
    expect(mask(key)).not.toContain("fake");
  });

  it("redacts keys inside text", () => {
    expect(redact("unexpected argument: df_key_test_fake_0000000000001234")).toBe(
      "unexpected argument: df_key_••••1234",
    );
    expect(redact("invalid --url: 'df_key_ab'")).toBe("invalid --url: 'df_key_••••'");
  });

  it("hides short keys entirely", () => {
    expect(mask("df_key_ab")).toBe("df_key_••••");
  });
});
