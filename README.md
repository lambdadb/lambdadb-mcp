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

## API contract and tool inputs

The LambdaDB SDK is pinned to `@functional-systems/lambdadb@0.5.1`.
The tool contract was checked against LambdaDB develop
[`d1a76659884a9ed09283a0b2e2989897dc799247`](https://github.com/lambdadb/lambdadb/commit/d1a76659884a9ed09283a0b2e2989897dc799247).
This source revision does not establish which API revision is deployed.

- Collection creation requires a nonempty `indexConfigs` and accepts `description`,
  metadata `tags`, `partitionConfig`, and `snapshotRetentionInDays` (1–31).
  The SDK validates individual index configurations and accepts HTTP 201 responses.
- Query, Fetch, and List accept `ref: { kind: "branch" | "tag" | "alias", name: "..." }`.
  Omitting `ref` reads from `main`. `consistentRead: true` is supported only by
  Query/Fetch with an omitted ref or a direct Branch ref. List has no `consistentRead`.
- List also accepts `filter`, `fields`, `includeVectors`, and `partitionFilter`.
  The SDK selects the extended POST endpoint when needed and preserves pagination tokens.
- Upsert/Delete accept an optional `branch`; omitting it writes to `main`.
  Delete requires exactly one of a nonempty `ids` array or `filter`.
- Unknown top-level inputs and unknown ref fields are rejected, so unsupported
  selectors cannot silently fall back to `main`.
- List/Get metadata no longer requires the removed `collectionStatus` or an absent
  `dataUpdatedAt`. Epoch-millisecond timestamps are converted by the SDK to `Date`
  and serialized as ISO strings in MCP text results.

SDK 0.5.1 already includes the
[`docsUrl` JSON-array fix](https://github.com/lambdadb/lambdadb-typescript-client/pull/26).
Query/Fetch/List download top-level document arrays and retain legacy `{ "docs": [...] }`
support without sending the project API key to the download URL. No additional SDK
patch is needed for this issue.

## Tests

```bash
npm ci
npm run check
```

`check` runs type checking, a build, and the contract tests. Tests connect an MCP
client to this server and exercise the installed SDK against a local HTTP fixture.
They cover read-only defaults, write opt-in, List/Get response validation, creation
HTTP 201, ref/branch forwarding, invalid combinations, pagination, and `docsUrl`
arrays/errors. They do not require credentials or create remote collections.

For an explicitly enabled live smoke, configure `.env.local` with the same required
variables and `LAMBDADB_MCP_ENABLE_WRITE_TOOLS=true`, then run:

```bash
npm run test:live
```

The live test creates one uniquely named temporary collection, checks real HTTP
201/202 responses, metadata, pagination, filters, sorting, and Branch/Tag/Alias
reads. It writes two 3 MiB documents to force actual `docsUrl` array downloads
through the MCP tools and checks full payload integrity and download credential
isolation. It allows up to five minutes for committed visibility, deletes its
temporary collection in cleanup, and verifies that the collection is absent.
Branch/Tag/Alias setup and collection cleanup use the SDK directly because these
operations are not exposed as MCP tools. This test is separate from `npm run check`.

If the environment file is outside the worktree, run after building:

```bash
node --env-file=/absolute/path/to/.env.local --test test/integration/live.test.mjs
```

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
