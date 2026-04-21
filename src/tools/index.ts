import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { EnvConfig } from "../config/env.js";
import { registerReadTools } from "./read.js";
import { registerWriteTools } from "./write.js";

export function registerTools(server: McpServer, config: EnvConfig): void {
  registerReadTools(server, config);

  if (config.enableWriteTools) {
    registerWriteTools(server, config);
  }
}

