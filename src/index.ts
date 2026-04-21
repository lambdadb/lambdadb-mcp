import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { getEnvConfig } from "./config/env.js";
import { createServer } from "./server/createServer.js";

async function main(): Promise<void> {
  const config = getEnvConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
