import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { EnvConfig } from "../config/env.js";
import { registerTools } from "../tools/index.js";

export function createServer(config: EnvConfig): McpServer {
  const server = new McpServer(
    {
      name: "lambdadb-mcp",
      version: JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version
    },
    {
      instructions:
        "This server exposes LambdaDB data plane tools for a single configured project. Prefer read-only tools unless write tools are explicitly enabled by the server operator."
    }
  );

  registerTools(server, config);

  return server;
}

