#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { getEnvConfig } from "./config/env.js";
import { createServer } from "./server/createServer.js";

async function main(): Promise<void> {
  const config = getEnvConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // A disconnected stdio client owns no further work in this process.
  const shutdown = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.stdin.once("end", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
