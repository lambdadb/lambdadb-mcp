import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerReadTools } from "./read.js";
import type { ToolContext } from "./shared.js";
import { registerVersioningReadTools, registerVersioningWriteTools } from "./versioning.js";
import { registerWriteTools } from "./write.js";

export function registerTools(server: McpServer, config: ToolContext): void {
  registerReadTools(server, config);
  registerVersioningReadTools(server, config);

  if (config.enableWriteTools) {
    registerWriteTools(server, config);
    registerVersioningWriteTools(server, config);
  }
}

