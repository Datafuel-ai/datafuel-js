import type { Readable, Writable } from "node:stream";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ErrorCode,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import { clientTag, mcpUrl, reason } from "./api.js";

function explain(err: unknown): string {
  if (!(err instanceof StreamableHTTPError)) return reason(err);
  if (err.code === 401) return "DataFuel rejected the API key (HTTP 401), check DATAFUEL_API_KEY";
  if (err.code === 403) return "DataFuel account inactive (HTTP 403)";
  return `DataFuel MCP answered HTTP ${err.code}: ${reason(err)}`;
}

export async function proxy(
  url: string,
  key: string,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Promise<void> {
  const remote = new StreamableHTTPClientTransport(new URL(mcpUrl(url)), {
    requestInit: { headers: { "X-API-Key": key, "X-DataFuel-Client": `${clientTag}/stdio` } },
  });
  const local = new StdioServerTransport(input, output);
  let initId: RequestId | undefined;

  const log = (msg: string) => process.stderr.write(`datafuel-mcp: ${msg}\n`);

  local.onmessage = (msg: JSONRPCMessage) => {
    if (isJSONRPCRequest(msg) && msg.method === "initialize") initId = msg.id;
    remote.send(msg).catch((err) => {
      if (!isJSONRPCRequest(msg)) return;
      const message = explain(err);
      local
        .send({ jsonrpc: "2.0", id: msg.id, error: { code: ErrorCode.InternalError, message } })
        .catch(() => {});
    });
  };

  remote.onmessage = (msg: JSONRPCMessage) => {
    if (initId !== undefined && isJSONRPCResultResponse(msg) && msg.id === initId) {
      const v = msg.result.protocolVersion;
      if (typeof v === "string") remote.setProtocolVersion(v);
    }
    local.send(msg).catch((err) => log(reason(err)));
  };

  remote.onerror = (err) => log(explain(err));
  local.onerror = (err) => log(reason(err));

  await remote.start();
  await local.start();

  await new Promise<void>((resolve) => {
    input.once("end", resolve);
    input.once("close", resolve);
  });
  await local.close();
  await remote.close();
}
