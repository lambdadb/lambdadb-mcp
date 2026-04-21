# lambdadb-mcp

MCP server for LambdaDB using the official TypeScript MCP SDK and the official LambdaDB TypeScript client.

## Scope

- Directly calls the LambdaDB data plane
- Uses a single project-scoped API key from environment variables
- Defaults to read-only tools
- Optionally exposes write tools via an environment flag

## Project Structure

```text
src/
├─ config/
│  └─ env.ts
├─ lambdadb/
│  ├─ client.ts
│  └─ errors.ts
├─ server/
│  └─ createServer.ts
├─ tools/
│  ├─ index.ts
│  ├─ shared.ts
│  ├─ read.ts
│  └─ write.ts
└─ index.ts
```

## Environment Variables

```bash
LAMBDADB_BASE_URL=https://aws-ap-northeast-2.lambdadb.ai
LAMBDADB_PROJECT_NAME=my-project
LAMBDADB_PROJECT_API_KEY=replace-me
LAMBDADB_MCP_ENABLE_WRITE_TOOLS=false
```

## Available Tools

Read-only:

- `lambdadb_list_collections`
- `lambdadb_get_collection`
- `lambdadb_query_collection`
- `lambdadb_list_docs`
- `lambdadb_fetch_docs`

Optional write tools:

- `lambdadb_create_collection`
- `lambdadb_upsert_docs`
- `lambdadb_delete_docs`

## Run

If you use `nix-direnv`, this repo can provision Node automatically:

```bash
direnv allow
```

Or enter the shell directly:

```bash
nix develop
```

Then install and build:

```bash
npm install
npm run build
```

For local development, create a `.env` file first:

```bash
cp .env.example .env
```

For local stdio execution:

```bash
LAMBDADB_BASE_URL=...
LAMBDADB_PROJECT_NAME=...
LAMBDADB_PROJECT_API_KEY=...
npm run start
```

Or use the local `.env` file directly:

```bash
npm run start:env
```

To inspect the server in the official MCP Inspector:

```bash
npm run inspect
```

This script reads `.env`, launches `dist/index.js` through the official Inspector, and opens the web UI for interactive tool testing.

## Claude Desktop Example

```json
{
  "mcpServers": {
    "lambdadb": {
      "command": "node",
      "args": ["/absolute/path/to/lambdadb-mcp/dist/index.js"],
      "env": {
        "LAMBDADB_BASE_URL": "https://aws-ap-northeast-2.lambdadb.ai",
        "LAMBDADB_PROJECT_NAME": "my-project",
        "LAMBDADB_PROJECT_API_KEY": "replace-me",
        "LAMBDADB_MCP_ENABLE_WRITE_TOOLS": "false"
      }
    }
  }
}
```

## Development Notes

- This repo currently assumes `stdio` transport first for local MCP clients.
- The server is scoped to one configured LambdaDB project per process.
- Write tools are intentionally disabled by default.
- `npm run inspect` is the fastest way to validate tool registration, schemas, and live LambdaDB responses during development.

## Documentation Strategy

Recommended split:

- `lambdadb-mcp`: implementation-oriented source of truth
- `docs`: user-facing setup, examples, supported tools, troubleshooting

That keeps operational details close to code while avoiding product docs drift.
