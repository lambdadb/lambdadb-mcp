# Changelog

## Unreleased

- Pin the LambdaDB SDK to 0.15.0, aligned with the public OpenAPI contract
  `reference/api/openapi.json` (`info.version` 1.3.0) in lambdadb/docs at commit
  `9a1f563b9b53bc29e5278105f8fc8c25a17e0cb8` (SHA-256
  `269590b8addc8e25785c222938b84e737a9f9dee0a5e8b45c0dde4779bde1b6d`), synced
  from lambdadb/lambdadb commit `16c6e46854b13cebd20c501e541bb030b33ca805`.
- Add the write tool `lambdadb_rollback_branch` (`branchName`, `tag`), which
  restores a branch's data and index schema from a tag in the same collection
  and returns `branchId` and `headSnapshot`. It is annotated destructive, asks
  for user confirmation and is never retried: a repeated rollback can undo
  writes made after the first. When the tag has no published snapshot yet,
  `headSnapshot` is `null`; the result text then says that the branch head is
  empty and that `consistentRead` reads the inherited writes until a build
  publishes them.
- `lambdadb_list_docs` accepts `sort` (1–4 objects, each mapping one field to
  `"asc"` or `"desc"`; an empty array fails before any request) and
  `consistentRead`, with the same ref rule as Query and Fetch: a tag ref
  rejects `true` before any request. Its description states that a branch
  listing reads the published snapshot unless `consistentRead` is set, that a
  tag listing includes the tag's pending writes, that a large pending payload
  can return HTTP 429, and that a page token must be repeated with identical
  arguments, since the server returns HTTP 400 when a request condition changes.
- Tag results can carry `snapshotId`, `snapshotCommittedAt` and `dataUpdatedAt`
  as `null` (with `numDocs: 0`) for a tag created before its first snapshot.
  `lambdadb_create_tag`, `lambdadb_get_tag` and `lambdadb_list_tags` describe
  this state, and tag creation no longer claims that a source without a
  snapshot fails: only a source with neither a snapshot nor pending writes does.
- Server instructions name branch rollback among the operations to confirm
  with the user. README no longer says that List lacks `consistentRead`.
- The live suite rolls a branch back to a tag, lists sorted pages with
  `consistentRead`, lists a branch's pending write with `consistentRead`, and
  checks that a page token repeated with another sort fails.

## [0.6.0] - 2026-11-18

- Pin the LambdaDB SDK to 0.13.0, aligned with the public OpenAPI contract
  `reference/api/openapi.json` (`info.version` 1.3.0) in lambdadb/docs at commit
  `7be299af9cac4195b75feb6e38b5cd7f8989f5a0` (SHA-256
  `ec499bb6ad4fd7359c1854359e9ecfd4cd8609420f440f7dcbf75566ccda8f32`), synced
  from lambdadb/lambdadb commit `f9aa63c79cbac2ac477a76ec45e5015ce665afd1`.
  The SDK requires the new response fields, so this build needs a server that
  serves this contract.
- Add the read tools `lambdadb_get_branch`, `lambdadb_get_tag` and
  `lambdadb_get_alias`. Each returns one ref with its `indexConfigs`; branches
  and tags also carry `numDocs` and `dataUpdatedAt` (`null` for an empty
  branch), and a dangling alias is returned with `indexConfigs: null`. The same
  fields appear in create, retarget and list results.
- Add the write tool `lambdadb_update_branch`, which changes the index schema of
  one branch with the same additive rule and `indexConfigs` field schema as the
  collection update. Updating `main` also changes the collection's
  `indexConfigs`; a tag or alias name fails with HTTP 400. `indexConfigs` on
  `lambdadb_update_collection` is deprecated in favour of it and keeps working.
- **Changed:** `lambdadb_list_branches`, `lambdadb_list_tags` and
  `lambdadb_list_aliases` return one page per call, like
  `lambdadb_list_collections`. They accept `size` (1–100, server default 10) and
  `pageToken` and return `nextPageToken` when more entries follow; a collection
  with more than ten refs of a kind no longer appears in a single result.
- `lambdadb_create_branch` accepts a tag source as well as a branch source;
  `asOf` stays valid only with a branch source, and alias sources are rejected.
  A branch created from a tag has `parentBranch: null`.
- `lambdadb_create_collection` returns the full collection metadata, as
  `lambdadb_get_collection` does.
- Server instructions, tool descriptions and README state that each branch owns
  its index schema, and follow the contract on what branch and tag creation
  capture: without `asOf`, the source snapshot plus the writes already accepted
  on it; with `asOf`, a retained committed snapshot only.
- The live suite calls the new tools against a deployed server: single ref
  reads, one-page ref listings with `pageToken`, a branch schema update that
  leaves `main` unchanged, and a branch created from a tag.

## [0.5.0] - 2026-11-06

- Pin the LambdaDB SDK to 0.12.0, aligned with the public OpenAPI contract
  `reference/api/openapi.json` in lambdadb/docs at commit
  `1714009a2659a18b26cb68193dd7a071fd6efb42`. Index fields accept an optional
  `description` of at most 255 characters, including nested `objectIndexConfigs`
  children; `lambdadb_create_collection` and `lambdadb_update_collection` publish
  it in their `indexConfigs` schemas, and `lambdadb_get_collection` returns it
  when set. Creation sends a description only when given; an update sends `""`
  to clear and `null` to keep the stored one, and a description is the only
  setting of an existing field that an update may change. The server-managed
  `id` field rejects one.
- `consistentRead: true` is forwarded for an alias ref as well as a branch ref;
  the server resolves the alias, and an alias that targets a tag fails with
  HTTP 400. Only a tag ref is rejected before any request. Server instructions
  and the query/fetch descriptions state this rule.
- Write results state what happened and name the read-back step: document
  upserts, updates and deletes end with the `lambdadb_fetch_docs` call that uses
  `consistentRead` on the written branch, and a bulk import says that its
  documents become visible after indexing completes. Collection creation and
  updates report plainly. `lambdadb_list_collections` names the project in its
  result title. Response payloads are unchanged.
- Server instructions and tool descriptions state one rule for reading writes
  back, to use `consistentRead` on the branch, with bulk imports appearing after
  indexing, instead of repeating readiness caveats in each tool. The
  `consistentRead` parameter description on query and fetch is shortened to that
  rule.

## [0.4.0] - 2026-11-04

- Check each OS credential store Connect supports in CI: a synthetic value is
  saved, served to a fresh server process and removed in macOS Keychain, Windows
  Credential Manager, Linux Secret Service and kernel keyutils on GitHub-hosted
  runners. `npm run test:native` runs the same opt-in check locally.
- Add LambdaDB Connect for configurations without a project key. The server
  starts disconnected and adds `lambdadb_connect`, `lambdadb_connection_status`
  and `lambdadb_cancel_connection`: Connect returns a verification link and user
  code, polls OAuth Device Authorization as the public client `lambdadb-mcp`,
  claims one project key, saves it in the OS credential store and revokes the
  setup token. Saved connections survive restarts; data tools report
  `not_connected` until a project is connected. Uncertain or unsaved deliveries
  keep a recovery reference for the same project. Explicit
  `LAMBDADB_BASE_URL`/`LAMBDADB_PROJECT_NAME`/`LAMBDADB_PROJECT_API_KEY`
  configuration is unchanged; starting with none of them no longer fails.
  Adds the `@napi-rs/keyring` dependency.

## [0.3.0] - 2026-10-31

- Read the deployed live smoke's project API key from the GitHub Environment
  secret `LAMBDADB_PROJECT_API_KEY` instead of Secrets Manager through an AWS
  OIDC role. A new `mode` job selects the run mode and its Environment (`dev` for
  dev builds, `prod` for release verification and Releases), and the publication
  job runs in it. The runner still fails on a missing or multi-line key.
- Add read-only Branch/Tag/Alias list tools and write-gated lifecycle tools for
  creation, deletion and alias retargeting. Preserve source/target restrictions,
  committed snapshot semantics, SDK metadata and service errors.
- Add write-gated document partial updates, bulk upsert orchestration, collection
  setting updates (`null` clears description, tags or retention) and collection
  deletion. Bulk inputs remain subject to the MCP transport limit; accepted
  mutations do not establish committed search visibility. Existing tool inputs
  and defaults remain unchanged.
- Describe every tool parameter for MCP clients, with query, filter, sort, and
  document shape examples drawn from the LambdaDB docs, and name the follow-up
  tool in each write description. Mark document upserts and deletes as
  destructive and creation tools as non-destructive. Move the text analyzer
  preset list from the `lambdadb_create_collection` description to its
  `indexConfigs` parameter.
- Return compact JSON from every tool, flatten SDK validation failures to
  one `path: message` line per issue with only the matching index type branch,
  add the list tool to use after a not-found error, name the accepted values in
  name, tag and sort direction errors, and describe the read and write workflows
  in the server instructions.
- Pin the LambdaDB SDK to 0.11.1. Its only runtime change is that `LAMBDADB_DEBUG`
  enables the SDK debug logger only for `true` or `1`; the server still removes the
  variable at startup. Tool inputs and outputs are unchanged.

## [0.2.1] - 2026-10-30

- Ignore `LAMBDADB_DEBUG`. The LambdaDB SDK's debug logger prints every request,
  including the `x-api-key` header, to stdout, which is the MCP transport. SDK
  0.11.0 and earlier enable it for any non-empty value, including `false`, which
  the CLI 0.1.5–0.1.6 MCP bridge sets. The server now removes the variable at
  startup, so stdout carries only MCP messages and never the key.

## [0.2.0] - 2026-10-30

- Pin the LambdaDB SDK to 0.11.0. `lambdadb_query_collection` rerank now accepts
  `cohere` with `rerank-v5.0-pro` or `rerank-v5.0-fast` (criteria omitted or null)
  besides `typesafe` / `jev-1.13.0`; mixed provider/model pairs and Cohere criteria
  fail before HTTP, and applied Cohere results report `cohere-relevance-v1`.
  Collection creation forwards the `cohere` embedding provider and ordered
  `embedding.sources` (exactly one non-null `sourceField` or `sources`), and
  `lambdadb_get_collection` accepts stored configurations that use `sources`, which
  failed SDK 0.10.0 response validation. Tool descriptions and the README document
  `knn.queryInputs`, direct vectors on native fields, and the server-managed `id`
  field that may be sent back unchanged. The rerank and Bayesian live suites now
  cover Cohere reranking, Cohere `sources` embeddings and `queryInputs`.

- Derive development versions from tags instead of a committed placeholder. The
  committed version is always the last released RC/stable version, and only a
  release pull request changes it; the "Open next development version" workflow
  and the `-dev.0` placeholder described below are removed. A `main` push whose
  committed version is tagged on `origin` builds `X.Y.(Z+1)-dev.N` after a stable
  release or `X.Y.Z-dev.N` after an RC (N as before); an untagged RC/stable
  version is verified without publication; a committed development version
  fails. A version below the `dev` dist-tag is skipped with a notice. Transition:
  the committed version returns from `0.2.0-dev.0` to `0.1.5`, so `main` pushes
  derive `0.1.6-dev.N`, below the published `0.2.0-dev.2`, and skip publication
  until a release pull request sets `0.2.0-rc.1` or `0.2.0` and it is tagged.

- Gate every publication run on the deployed live smoke: dev builds run all live
  suites against the dev environment before publication, and release
  verification and GitHub Releases run them against production. The project key
  is read from Secrets Manager through a GitHub OIDC role and passed only to the
  test process. `npm run test:live:all` runs every live suite sequentially.

- Move releases to trunk-based `main`; `develop` is retired. `main` carries the
  next version as `X.Y.Z-dev.0` (now `0.2.0-dev.0`), and each eligible merge
  publishes `X.Y.Z-dev.N`, where N counts first-parent commits since the newest
  stable tag and restarts after each stable release. A merge that sets an RC or
  stable version is verified without publication, and its GitHub Release
  publishes it. After publication, a workflow opens the next development version
  pull request. `scripts/version.mjs` updates every version source.

- Pin the LambdaDB SDK to 0.10.0. Expand Query/Fetch/List and rerank limits to
  1000 on supporting servers, retaining facet and collection-list limits of 100.
  Vector dimensions now require integers from 64 to 4096 and similarity accepts
  only cosine/euclidean; invalid requests and existing out-of-contract collection
  metadata fail SDK validation. Update vector fixtures and native source guidance.

## [0.1.5] - 2026-10-25

- Pin MCP SDK 1.32.2, raise the Zod minimum to 4.6.7, and refresh the affected
  transitive dependencies to clear six npm audit findings. Keep the LambdaDB
  SDK, Node.js floor, tool schemas and read-only defaults unchanged. The new SDK
  input-element cap remains unset; omitted tool arguments now behave as an empty
  object while required inputs still fail validation.

- Replace the query tool's top-level `allOf` with equivalent conditionals so
  Claude through Kiro/Bedrock can accept the tool inventory. Preserve facet and
  rerank schema constraints, runtime validation and read-only defaults.

## [0.1.4] - 2026-10-07

- Standardize feature guidance as native embedding and native reranking; pin the
  LambdaDB TypeScript SDK to 0.8.1. Preserve public identifiers, legacy wire fields,
  application error strings, existing behavior tests and pinned source links.
- Update the MCP SDK to 1.31.0 for GHSA-6qxp-vccf-f47h. The advisory concerns HTTP
  OAuth clients; this stdio server does not use the affected OAuth path.
- Document upstream compatibility differences: the MCP SDK limits the stdio receive
  buffer to 10 MiB and closes the transport on overflow, and formats schema
  validation errors with field paths. Application tool names, schemas and defaults
  remain unchanged.

## [0.1.3] - 2026-10-06

- Pin the stable LambdaDB SDK to 0.8.0; expose Bayesian candidate budgets and
  native embedding configuration in MCP guidance while preserving free-form
  queries, SDK/server validation, rerank defaults, errors and response metadata.
- Retain legacy `managedEmbedding: true` and existing tool names/inputs. Native
  embedding-only requests require a supporting server; no defaults are promoted.
- Add Bayesian/native contract tests, installed-package coverage, practical MCP
  examples and an opt-in live suite with verified temporary-collection cleanup.

## [0.1.2] - 2026-10-04

- Pin the LambdaDB TypeScript SDK to 0.7.0 and expose all 49 fixed lowercase
  analyzer presets in collection-tool guidance; preserve analyzer serialization.
- Add optional per-query native reranking to the MCP schema and SDK request path,
  preserving omission/null, distinct sizes, custom criteria, envelope scores and
  status metadata, including document downloads. Retain SDK validation and errors.
- Extend local and installed-package contracts for analyzer expansion and reranking;
  update the opt-in live analyzer check to cover all 49 names.
- Add a separate opt-in native reranking live suite for real default/custom
  inference, empty candidates, omitted/null behavior and docsUrl envelope
  preservation, with owned-resource cleanup and no fixed relevance expectations.
- Native SDK usage is unchanged; no Qdrant mapping exists in this server. Supporting
  backend deployment/model availability remains required; existing MCP installations
  require a version containing these changes.

## [0.1.1] - 2026-09-29

- Pin the LambdaDB TypeScript SDK to 0.6.0, including all 16 text analyzers.
- Add keyword facets, query omission for match-all, and facet-only `size: 0` to
  `lambdadb_query_collection`. Preserve omitted/null bucket sizes and facet results,
  including automatic document downloads; retain existing search options and refs.
- Expose facet limits and the `size: 0` condition in MCP JSON Schema and validate
  them through tool calls, SDK HTTP contracts, installed-package tests, and the
  opt-in live suite. Read-only defaults and explicit write opt-in are unchanged.
- Facets require a supporting server and newly built keyword indexes. Existing
  Collections are not migrated, and existing MCP installations require an update
  to a separately published MCP version containing this change.

## [0.1.0] - 2026-09-20

- Package `@functional-systems/lambdadb-mcp` and the `lambdadb-mcp` executable for npm/npx distribution under Apache-2.0.
- Add OIDC publishing for develop, rc and stable channels with exact tarball consumer checks; automatic dev publishing is enabled.
- Derive the MCP server version from package metadata and close the process on stdio disconnect or termination.
- Raise the supported Node.js floor to 22.14.0; verify the minimum and current Node 22/24 LTS.
- Preserve the existing environment variables, read-only default and explicit write opt-in.
- Require explicit development-project confirmation before running the optional live smoke.
- Refresh compatible locked dependencies; the audited dependency tree has no known advisories at validation time.
- Record successful npm-installed stdio and authorized development-service validation of the dev distribution.
