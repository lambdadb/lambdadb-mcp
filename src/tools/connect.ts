import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ConnectionManager } from "../connect/manager.js";
import { ConnectError } from "../connect/oauth.js";

const attemptId = z.string().uuid().describe("attempt_id returned by lambdadb_connect.");

function result(title: string, data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: `${title}\n\n${JSON.stringify(data)}` }] };
}

async function run(title: string, action: () => Promise<Record<string, unknown>>) {
  try {
    return result(title, await action());
  } catch (error) {
    const e = error instanceof ConnectError ? error : new ConnectError("connect_failed", "Connect did not start. Retry later.");
    return { ...result("Connect failed.", { error: e.code, message: e.message.replace(/^[a-z_]+: /, "") }), isError: true };
  }
}

/** Connection tools; results never contain a project key, token or device code. */
export function registerConnectTools(server: McpServer, connection: ConnectionManager): void {
  server.registerTool(
    "lambdadb_connect",
    {
      title: "Connect LambdaDB Project",
      description: "Start connecting this server to one LambdaDB project through browser approval; only when the user asks to connect. Returns promptly with verification_uri, user_code and attempt_id: show the link and code to the user, who signs in and selects the project in LambdaDB. This server then saves a project key in the OS credential store. Check progress with lambdadb_connection_status. Calling again while an attempt is pending returns that attempt. Connecting again later switches the saved project after approval.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.strictObject({})
    },
    () => run("Approval requested.", () => connection.connect())
  );

  server.registerTool(
    "lambdadb_connection_status",
    {
      title: "LambdaDB Connection Status",
      description: "Report a Connect attempt (pending, issuing, connected, region_requested, canceled, expired or failed) and the saved connection. Omit attempt_id to see only the saved connection.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.strictObject({ attempt_id: attemptId.optional() })
    },
    ({ attempt_id }) => run("Connection status.", () => connection.status(attempt_id))
  );

  server.registerTool(
    "lambdadb_cancel_connection",
    {
      title: "Cancel LambdaDB Connect",
      description: "Stop a pending Connect attempt; its approval code then has no effect here. A key claim already in progress cannot be canceled. The saved connection is unchanged.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.strictObject({ attempt_id: attemptId })
    },
    ({ attempt_id }) => run("Connect attempt.", () => connection.cancel(attempt_id))
  );
}
