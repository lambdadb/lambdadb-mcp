import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { EnvConfig } from "../config/env.js";
import { registerReadTools } from "./read.js";
import { registerVersioningReadTools, registerVersioningWriteTools } from "./versioning.js";
import { registerWriteTools } from "./write.js";

export function registerTools(server: McpServer, config: EnvConfig): void {
  registerReadTools(server, config);
  registerVersioningReadTools(server, config);

  if (config.enableWriteTools) {
    registerWriteTools(server, config);
    registerVersioningWriteTools(server, config);
  }
}

