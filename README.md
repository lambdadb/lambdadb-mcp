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

As verified on 2026-10-07 (KST), npm `latest` resolves to `0.1.4` and `dev` to
`0.1.4-dev.15`. Use an exact version for reproducibility or the stable channel for
initial setup. See [release status and policy](RELEASING.md).

[MCP 0.1.4](https://github.com/lambdadb/lambdadb-mcp/releases/tag/v0.1.4) is published
with LambdaDB SDK `0.8.1`, native embedding and native reranking terminology, and
MCP SDK `1.31.0`. The MCP SDK update includes a 10 MiB stdio receive-buffer limit
and revised schema-validation error formatting. Existing tool names, wire fields
and read-only defaults remain unchanged. This checkout starts the next
`0.1.5-dev.1` source base; check npm for the current published dev version.
Existing installations need an MCP release containing these changes; upgrading
the SDK separately does not update them.

```sh
npx --yes @functional-systems/lambdadb-mcp
# Pin the stable release:
npx --yes @functional-systems/lambdadb-mcp@0.1.4
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
to stderr, and stdin closure/SIGINT/SIGTERM ends the process. The MCP SDK limits
the stdio receive buffer to 10 MiB and closes the transport if that limit is
exceeded; keep incoming JSON-RPC messages below it. Running it without an
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

The LambdaDB SDK is pinned to `@functional-systems/lambdadb@0.8.1`, checked against
the published package and [v0.8.1 release](https://github.com/lambdadb/lambdadb-typescript-client/releases/tag/v0.8.1).
This dependency update applies to builds containing this change. Publishing the SDK
alone does not update previously published or installed MCP packages.

- Collection creation requires a nonempty `indexConfigs` and accepts `description`,
  metadata `tags`, `partitionConfig`, and `snapshotRetentionInDays` (1–31).
  The SDK validates individual index configurations and accepts HTTP 201 responses.
- Query, Fetch, and List accept `ref: { kind: "branch" | "tag" | "alias", name: "..." }`.
  Omitting `ref` reads from `main`. `consistentRead: true` is supported only by
  Query/Fetch with an omitted ref or a direct Branch ref. List has no `consistentRead`.
- Query may omit `query` for match-all and accepts `facets` for keyword bucket counts
  across all matches. Document `size` is 1–100, or 0 when at least one facet is supplied.
  Up to five facet fields (including dotted paths) are allowed. Each field's options
  accept only `size`: an integer from 1–100, omitted, or `null`. Omitted/null bucket
  size uses the server default of 10; MCP forwards it unchanged. Empty `facets: {}`
  is accepted except with `size: 0`. Facet results survive inline and `docsUrl` responses.
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

### Query examples

Arguments for `lambdadb_query_collection`, returning only facets across all documents:

```json
{
  "collectionName": "products",
  "size": 0,
  "facets": { "category": {}, "metadata.brand": { "size": null } }
}
```

Return matching documents and facets together:

```json
{
  "collectionName": "products",
  "query": { "queryString": { "query": "title:coffee" } },
  "size": 10,
  "facets": { "category": { "size": 5 } },
  "fields": { "include": ["id", "title", "category"] }
}
```

For match-all documents without facets, use `{ "collectionName": "products", "size": 10 }`.
MCP returns JSON in its text content, with `docs`, `total`, `took`, and (when returned
by the service) `facets`, for example `"facets": { "category": { "buckets": [
{ "value": "drinks", "count": 42 } ] } }`. Bucket counts cover all matching
documents, independently of document `size`; duplicate keyword array values count
once per document. `total` counts returned documents (0 for facet-only requests),
not all matching documents. Counts use JavaScript Number and may lose integer precision
above `Number.MAX_SAFE_INTEGER`.

Facets require a supporting server deployment and newly built keyword indexes.
This MCP update does not migrate existing Collections or indexes. Partial updates,
segment merging, and old Tags do not upgrade old indexes. If migration is needed,
plan and authorize reinsertion into a new Collection separately.

### Bayesian hybrid search

Arguments for `lambdadb_query_collection` using an existing two-dimensional
caller-provided vector field `embedding` and text field `body`:

```json
{
  "collectionName": "articles",
  "query": {
    "bayesian": [
      { "queryString": { "query": "body:restore" } },
      { "knn": { "field": "embedding", "queryVector": [1, 0], "k": 30 } }
    ]
  },
  "size": 10,
  "candidateSize": 30
}
```

Bayesian requires exactly two signals. Boolean subqueries may combine clauses
within a signal, but explicit boosts (even `1`) on either signal or its Boolean
descendants and nested rank-fusion queries are unsupported. Do not supply fusion
weights. Without rerank, top-level `candidateSize` is required and must satisfy
`1 <= size <= candidateSize <= 100`; omitted `size` retains the server default of
10. The budget is per signal, independent of final output size and `knn.k`.

With rerank, omit top-level `candidateSize` and use `rerank.candidateSize`:

```json
{
  "collectionName": "articles",
  "query": {
    "bayesian": [
      { "queryString": { "query": "body:restore" } },
      { "knn": { "field": "embedding", "queryVector": [1, 0], "k": 30 } }
    ]
  },
  "size": 10,
  "rerank": {
    "provider": "typesafe",
    "model": "jev-1.13.0",
    "queryText": "How do I restore a previous version?",
    "fields": ["body"],
    "candidateSize": 30
  }
}
```

Omitted/null `rerank.candidateSize` retains `max(50, size)`; omitted/null `rerank`
requires the top-level Bayesian budget. Ordinary text/KNN/RRF/Min-Max/L2 queries
must omit top-level `candidateSize`. MCP preserves free-form queries, passes
integer candidate budgets unchanged, and leaves Bayesian structure, bounds and
cross-field validation to the server, retaining service errors. No query defaults,
weights or candidate counts are inserted by MCP. Bayesian scores are heuristic
fusion scores; applied reranking preserves them in `retrievalScore` and retains
all rerank status metadata, including when the SDK downloads documents from `docsUrl`.

The [Bayesian contract](https://github.com/lambdadb/lambdadb-typescript-client/blob/v0.8.0/docs/bayesian-search.md)
and native embedding additions below are pinned to backend
`9072a1bc8925954369a887f558f1eaf387b7ea0e`. A source pin does not establish deployment
in another environment. Existing fusion methods and tool names remain unchanged.

### Native embedding configuration

With write tools enabled, call `lambdadb_create_collection` with:

```json
{
  "collectionName": "native-articles",
  "indexConfigs": {
    "body": { "type": "text" },
    "embedding": {
      "type": "vector",
      "embedding": {
        "provider": "openai",
        "model": "text-embedding-3-small",
        "sourceField": "body",
        "dimensions": 512,
        "similarity": "cosine"
      }
    }
  }
}
```

Then call `lambdadb_upsert_docs` with
`{"collectionName":"native-articles","docs":[{"id":"one","body":"Restore a saved version."}]}`.
The source must be a text field; omit the generated vector from documents.
Use `knn.queryText` instead of `queryVector` for this field, including in either
Bayesian example above. For example, call `lambdadb_query_collection` with:

```json
{
  "collectionName": "native-articles",
  "query": { "knn": { "field": "embedding", "queryText": "Restore a version", "k": 30 } },
  "size": 10
}
```

Native embedding dimensions and similarity are optional and belong inside `embedding`.
MCP does not infer a flag, provider, model or native embedding dimensions/similarity default.
The SDK rejects `managedEmbedding: false` with `embedding`, and native embedding
with top-level dimensions/similarity. Caller-provided vectors continue to use
top-level dimensions/similarity. Free-form nested object configurations retain
server validation. For older servers, explicitly add `managedEmbedding: true`
beside `type`; it is preserved. Normalized collection metadata may still contain
that true flag. See the [native embedding contract](https://github.com/lambdadb/lambdadb-typescript-client/blob/v0.8.0/docs/native-embeddings.md).

<a id="optional-managed-reranking"></a>

### Optional native reranking

`lambdadb_query_collection` accepts per-query `rerank`; omission or `null`
preserves existing searches. Collection creation has no rerank setting.
LambdaDB supplies provider credentials; only the existing project API key is needed.
See the [native reranking contract](https://github.com/lambdadb/lambdadb-typescript-client/blob/v0.7.0/docs/managed-reranking.md).

```json
{
  "collectionName": "articles",
  "size": 10,
  "query": { "knn": { "field": "bodyEmbedding", "queryText": "Restore a collection", "k": 50 } },
  "fields": { "include": ["id", "title"] },
  "rerank": {
    "provider": "typesafe",
    "model": "jev-1.13.0",
    "queryText": "Restore a collection",
    "fields": ["title", "body"],
    "candidateSize": 50,
    "onFailure": "error"
  }
}
```

Provider/model are fixed. `queryText` is required nonblank text, at most 8 KiB
UTF-8, even with raw vectors. Rerank `fields` selects 1–8 unique stored scalar
text paths in input order, independently of returned document projection.
Optional `criteria` replaces the default with 2–10 distinct nonblank descriptions
ordered from lowest to highest relevance (2 KiB each, 8 KiB total UTF-8).
Omitted/null criteria uses defaults; text, order, nulls and omission are preserved.

Final `size`, vector-leg `knn.k`, and merged `rerank.candidateSize` are separate.
Require `1 <= size <= candidateSize <= 100`; omitted/null candidateSize defaults
on the server to `max(50, size)`, with final size defaulting to 10. MCP never
increases `k`. Reranking requires a scoring retrieval query, forbids `sort`,
match-all and filter-only Boolean requests, and preserves ref/consistentRead
restrictions. It does not enable vector/hybrid facets; supported lexical facets
still count all matches. Field types, candidate text and model availability
remain server validations.

Results retain server order, precision and zero. Applied envelope `score` is the
final evaluation score in [0,1], not a probability; envelope `retrievalScore`
retains the search score. Top-level `rerank` retains status (`applied`, `skipped`,
`fallback`), provider/model, optional resolvedModel, counts, stage took, optional
criteriaVersion and reason. Applied criteriaVersion is `default-relevance-v1`
or `custom`; `custom` is not a unique rubric identity. `maxScore` retains zero;
empty results omit it and report skipped/noCandidates with zero counts.
Without reranking, rerank metadata and retrievalScore are absent. Metadata and
scores survive `docsUrl` downloads.

Omitted/null `onFailure` defaults to `error`. `returnOriginal` applies only to
provider timeout, rateLimit, unavailable, invalidResponse and credentials failures.
Fallback retains retrieval order/scores for the first size documents, discards
partial evaluation scores and omits retrievalScore/criteriaVersion. Invalid
input/candidates, disabled models, authorization, retrieval/hydration/ref, quota
and capacity failures remain errors; cancellation or an exhausted deadline does
not trigger fallback. A hybrid fallback can differ from a separate query with
a smaller candidate cap. No extra client fallback is implemented.

SDK publication and local fixtures do not establish deployment to an endpoint,
search quality, load/failure coverage or billing readiness. Backend feature/model
availability and operational verification remain separate dependencies.

### Text analyzers in collection creation

With write tools explicitly enabled, `lambdadb_create_collection` accepts:

```json
{
  "collectionName": "products",
  "indexConfigs": {
    "title": { "type": "text", "analyzers": ["english", "chinese", "french"] },
    "category": { "type": "keyword" },
    "metadata": { "type": "object", "objectIndexConfigs": { "brand": { "type": "keyword" } } }
  }
}
```

Supported lowercase names: `standard`, `english`, `korean`, `japanese`, `chinese`,
`cjk`, `arabic`, `french`, `german`, `hindi`, `indonesian`, `italian`, `portuguese`,
`russian`, `spanish`, `turkish`, `armenian`, `basque`, `bengali`, `brazilian`,
`bulgarian`, `catalan`, `czech`, `danish`, `dutch`, `estonian`, `finnish`, `galician`,
`greek`, `hungarian`, `irish`, `latvian`, `lithuanian`, `norwegian`, `persian`,
`romanian`, `serbian`, `sorani`, `swedish`, `thai`, `simple`, `whitespace`, `stop`,
`keyword`, `pattern`, `fingerprint`, `nepali`, `tamil`, `telugu` (49 total).
Omitting `analyzers` uses the server default
`["standard"]`; an empty list is passed through and does not select that default.
Analyzers run independently without automatic language detection. Lists are sent
unchanged; avoid duplicate names, which the server rejects. Index configuration
validation remains in the SDK. Write tools remain disabled by default.

These are fixed presets with backend default settings; custom pipelines/options
are unsupported. The `keyword` analyzer keeps text in one token and is distinct
from the `keyword` field type used for sorting/facets. Nepali, Tamil and Telugu
are Lucene extensions, not common Elasticsearch/OpenSearch support. New presets
require a supporting backend deployment. See the [analyzer contract](https://github.com/lambdadb/lambdadb-typescript-client/blob/v0.7.0/docs/models/analyzer.md).

This repository uses the native SDK only and has no Qdrant payload-schema mapping.
The SDK's [Qdrant adapter](https://github.com/lambdadb/lambdadb-typescript-client/blob/v0.7.0/docs/compatibility/qdrant.md)
now rejects extra schema options with `UnsupportedQdrantFeatureError`. Its mapping
remains type-only; text omits analyzers for the standard default. Migration callers
must reject or explicitly resolve unsupported options rather than discard them.

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
arrays/errors and local environment-file loading. Facet tests validate the published
MCP JSON Schema and actual tool-to-SDK HTTP path, including match-all, facet-only,
document+facet, omitted/null/default bucket options, boundaries, invalid requests,
and all 49 analyzers. Rerank tests cover JSON Schema, request preservation,
local bounds/UTF-8 rejection, score envelopes, skipped/fallback results and
metadata downloads. Bayesian tests cover untouched free-form requests, candidate
budgets, server errors, native/legacy configurations and contradictory inputs.
They do not require credentials
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
reads. It also checks all 49 analyzers in collection metadata, match-all, facet-only
and document+facet results, default/null bucket size, keyword arrays, dotted paths,
and facet preservation across refs and `docsUrl` downloads. The designated server
must support these features. It writes two 3 MiB documents to force actual `docsUrl` array downloads
through the MCP tools and checks full payload integrity and download credential
isolation. It allows up to five minutes for committed visibility, deletes its
temporary collection in cleanup, and verifies that the collection is absent.
Branch/Tag/Alias setup and collection cleanup use the SDK directly because these
operations are not exposed as MCP tools. This test is separate from `npm run check`.

Native reranking has a separate live suite because it requires an enabled
`typesafe` / `jev-1.13.0` model and can incur inference cost. Use the same explicitly
authorized development project and write opt-in, with an additional inference opt-in:

```bash
LAMBDADB_RUN_LIVE_TESTS=1 LAMBDADB_RUN_LIVE_RERANK_TESTS=1 LAMBDADB_LIVE_CONFIRM_PROJECT=YOUR_DEV_PROJECT npm run test:live:rerank
```

It creates one temporary collection and two synthetic documents. It verifies
omitted/null retrieval behavior, applied default and custom criteria, final size
versus candidate count, envelope evaluation/retrieval scores, inline and actual
`docsUrl` order/precision/metadata preservation, download credential isolation,
and empty `skipped` results. Only short stored text is sent for evaluation; the
large synthetic payload forces document offload without enlarging model input.
Cleanup deletes the collection and verifies its absence even after a failed check.
It does not assert fixed model scores or relevance rankings, and a fallback result
does not pass as applied inference. Provider failures remain fixture tests; this
suite does not deliberately induce failures or verify search quality, load,
production deployment or billing readiness. These live suites are outside default
checks and credential-free CI.

Bayesian/native embedding verification also requires explicit inference
opt-in for native embedding with OpenAI and native reranking with TypeSafe:

```bash
LAMBDADB_RUN_LIVE_TESTS=1 LAMBDADB_RUN_LIVE_RERANK_TESTS=1 LAMBDADB_LIVE_CONFIRM_PROJECT=YOUR_DEV_PROJECT npm run test:live:bayesian
```

This suite creates one owned collection with native, legacy and caller-provided
vector fields. It checks real embedding generation and text queries, Bayesian
budgets and server rejections, existing fusion methods, applied reranking with
retrieval scores and actual docsUrl hydration, then deletes and verifies absence.
These live suites are outside default checks and credential-free CI. Verify the
target's deployment provenance before running; the source pin alone is insufficient.

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
