import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const goodKey = "df_key_test_fake_0000000000001234";
export const inactiveKey = "df_key_test_inactive_00000005678";
export const skill = "---\nname: datafuel\n---\n\nUse DataFuel.\n";

export interface Fake {
  url: string;
  seen: IncomingHttpHeaders[];
  close(): Promise<void>;
}

type Rpc = { id?: number | string; method: string; params?: { name?: string } };

function answer(msg: Rpc): unknown {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fake", version: "0.0.0" },
      };
    case "tools/list":
      return { tools: [{ name: "get_balance", inputSchema: { type: "object" } }] };
    case "tools/call":
      return { content: [{ type: "text", text: `called ${msg.params?.name}` }] };
  }
  return {};
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

export async function fake(): Promise<Fake> {
  const seen: IncomingHttpHeaders[] = [];
  const http = createServer((req, res) => {
    seen.push(req.headers);
    if (req.url === "/skill.md") return void res.end(skill);
    const key = req.headers["x-api-key"];
    if (key === inactiveKey) return send(res, 403, { code: "FORBIDDEN", message: "forbidden" });
    if (key !== goodKey) return send(res, 401, { code: "INVALID_API_KEY", message: "invalid" });

    if (req.url === "/api/v1/users/@me/balance") return send(res, 200, { balance: 12480 });
    if (req.url !== "/mcp") return send(res, 404);
    if (req.method !== "POST") return send(res, 405);

    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const msg = JSON.parse(raw) as Rpc;
      if (msg.id === undefined) return send(res, 202);
      send(res, 200, { jsonrpc: "2.0", id: msg.id, result: answer(msg) });
    });
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((resolve) => http.close(() => resolve())),
  };
}
