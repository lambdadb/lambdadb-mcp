# Changelog

## Unreleased

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
