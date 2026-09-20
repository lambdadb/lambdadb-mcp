# lambdadb-mcp

MCP server for LambdaDB using the official TypeScript MCP SDK and the official LambdaDB TypeScript client.

## Scope

- Directly calls the LambdaDB data plane
- Uses a single project-scoped API key from environment variables
- Defaults to read-only tools
- Optionally exposes write tools via an environment flag

## Install and run with npm

Package: `@functional-systems/lambdadb-mcp`. Executable: `lambdadb-mcp`.
Requires Node.js >=22.14.0; CI tests the minimum and current Node 22/24 LTS.

The stable package is available on npm. As verified on 2026-09-20 (KST),
`latest` resolves to `0.1.0` and `dev` to `0.1.0-dev.5`. Use an exact version for
reproducibility or the default stable channel for initial setup. See
[release status and policy](RELEASING.md).

```sh
npx --yes @functional-systems/lambdadb-mcp
# Pin the first stable release:
npx --yes @functional-systems/lambdadb-mcp@0.1.0
# Or install globally:
npm install -g @functional-systems/lambdadb-mcp
lambdadb-mcp
# Opt into development builds explicitly:
npx --yes @functional-systems/lambdadb-mcp@dev
```

Set the environment variables below in your MCP client or securely in the parent
process. Installed execution reads the environment directly and needs no checkout,
build, shell script, or `.env.local`. It does not automatically load dotenv files.
`LAMBDADB_ENV_FILE` belongs to the repository's development launchers only. If you
prefer a file after global installation, use Node's explicit file loader:

```sh
node --env-file=/absolute/path/to/mcp.env "$(npm root -g)/@functional-systems/lambdadb-mcp/dist/index.js"
```

Exported environment values take precedence. Keep credentials out of command
arguments, source control and logs. Pin an exact published version in MCP client
configurations for reproducibility. `@dev`, `@rc` and unqualified (`latest`) resolve
different release channels; installed copies do not update themselves.

The server uses stdio: stdout contains only MCP JSON-RPC messages, diagnostics go
to stderr, and stdin closure/SIGINT/SIGTERM ends the process. Running it without an
MCP client waits for protocol input. See the [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

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
npm run test:package
```

`check` runs type checking, a build, and the contract tests. Tests connect an MCP
client to this server and exercise the installed SDK against a local HTTP fixture.
They cover read-only defaults, write opt-in, List/Get response validation, creation
HTTP 201, ref/branch forwarding, invalid combinations, pagination, and `docsUrl`
arrays/errors and local environment-file loading. They do not require credentials
or create remote collections. `test:package` additionally installs the actual
tarball in a clean consumer directory and repeats the tool contracts over real
stdio, checking version identity, config errors, stdout and process termination.
CI validates Node 22.14.0, current 22.x and 24.x on PRs and pushes to develop/main.
See [CONTRIBUTING.md](CONTRIBUTING.md) and [RELEASING.md](RELEASING.md) for checks,
release policy and the explicitly enabled automatic dev publication gate.

For a live smoke, explicitly designate a disposable **development** project and
configure its credentials in `.env.local` with `LAMBDADB_MCP_ENABLE_WRITE_TOOLS=true`.
An existing credential file alone is not permission to test. Then run:

```bash
LAMBDADB_RUN_LIVE_TESTS=1 LAMBDADB_LIVE_CONFIRM_PROJECT=YOUR_DEV_PROJECT npm run test:live
```

The live test creates one uniquely named temporary collection, checks real HTTP
201/202 responses, metadata, pagination, filters, sorting, and Branch/Tag/Alias
reads. It writes two 3 MiB documents to force actual `docsUrl` array downloads
through the MCP tools and checks full payload integrity and download credential
isolation. It allows up to five minutes for committed visibility, deletes its
temporary collection in cleanup, and verifies that the collection is absent.
Branch/Tag/Alias setup and collection cleanup use the SDK directly because these
operations are not exposed as MCP tools. This test is separate from `npm run check`.

If the environment file is outside the worktree:

```bash
LAMBDADB_ENV_FILE=/absolute/path/to/.env.local LAMBDADB_RUN_LIVE_TESTS=1 LAMBDADB_LIVE_CONFIRM_PROJECT=YOUR_DEV_PROJECT npm run test:live
```

## Run from source (development)

Use Node.js >=22.14.0. The repository's optional launchers preserve exported
environment overrides when loading dotenv files with Node's `--env-file`.

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

For local development, create a `.env.local` file first:

```bash
cp .env.example .env.local
```

For local stdio execution:

```bash
export LAMBDADB_BASE_URL=...
export LAMBDADB_PROJECT_NAME=...
export LAMBDADB_PROJECT_API_KEY=...
npm run start
```

Or load the local environment file:

```bash
npm run start:env
```

To inspect the server in the official MCP Inspector:

```bash
npm run inspect
```

`start:env`, `inspect`, and `test:live` use the same file selection:
`LAMBDADB_ENV_FILE` when set, otherwise `.env.local` if present, otherwise `.env`.
Only the selected file is loaded. For `start:env` and `test:live`, exported environment
variables take precedence. Inspector forwards `LAMBDADB_ENV_FILE` and
`LAMBDADB_MCP_ENABLE_WRITE_TOOLS`; its connection credentials come from the selected file.
Relative `LAMBDADB_ENV_FILE` paths are resolved from the repository root.
The Inspector launches `dist/index.js` through this loader and opens its web UI.
Credentials are read by Node rather than passed as Inspector command-line arguments.

To use read-only tools even when the selected file enables writes:

```bash
LAMBDADB_MCP_ENABLE_WRITE_TOOLS=false npm run inspect
```

## Codex Example

After the first dev publication, configure the stdio executable:

```toml
[mcp_servers.lambdadb]
command = "npx"
args = ["--yes", "@functional-systems/lambdadb-mcp@dev"]

[mcp_servers.lambdadb.env]
LAMBDADB_BASE_URL = "https://aws-ap-northeast-2.lambdadb.ai"
LAMBDADB_PROJECT_NAME = "my-project"
LAMBDADB_PROJECT_API_KEY = "replace-me"
LAMBDADB_MCP_ENABLE_WRITE_TOOLS = "false"
```

Use a secure local configuration or the client's environment forwarding facility
for credentials. Replace `@dev` with an exact published version when pinning.
The existing source-checkout launcher remains available as
`bash /absolute/path/to/lambdadb-mcp/scripts/with-env.sh dist/index.js`.

## Claude Desktop Example

```json
{
  "mcpServers": {
    "lambdadb": {
      "command": "npx",
      "args": ["--yes", "@functional-systems/lambdadb-mcp@dev"],
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

## License

Apache-2.0. See [LICENSE](LICENSE).
