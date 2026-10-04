# Changelog

## Unreleased

## [0.1.2] - 2026-10-04

- Pin the LambdaDB TypeScript SDK to 0.7.0 and expose all 49 fixed lowercase
  analyzer presets in collection-tool guidance; preserve analyzer serialization.
- Add optional per-query managed reranking to the MCP schema and SDK request path,
  preserving omission/null, distinct sizes, custom criteria, envelope scores and
  status metadata, including document downloads. Retain SDK validation and errors.
- Extend local and installed-package contracts for analyzer expansion and reranking;
  update the opt-in live analyzer check to cover all 49 names.
- Add a separate opt-in managed-reranking live suite for real default/custom
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
