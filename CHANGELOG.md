# Changelog

## Unreleased

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
  and defaults remain unchanged; no release is included.
- Describe every tool parameter for MCP clients, with query, filter, sort, and
  document shape examples drawn from the LambdaDB docs, and name the follow-up
  tool in each write description. Mark document upserts and deletes as
  destructive and creation tools as non-destructive. Move the text analyzer
  preset list from the `lambdadb_create_collection` description to its
  `indexConfigs` parameter.
- Return compact JSON from every tool, cap query/list/fetch results at
  `LAMBDADB_MCP_MAX_RESULT_BYTES` (default 65536, `0` disables) by keeping whole
  documents and reporting `truncated` counts (a truncated list page moves its
  `nextPageToken` into the marker, and documents larger than the cap are listed
  with per-field byte sizes), flatten SDK validation failures to
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
