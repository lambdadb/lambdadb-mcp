# Changelog

## Unreleased

- Prepare `@functional-systems/lambdadb-mcp` and the `lambdadb-mcp` executable for npm/npx distribution under Apache-2.0.
- Add gated OIDC publishing for develop, rc and stable channels with exact tarball consumer checks.
- Derive the MCP server version from package metadata and close the process on stdio disconnect or termination.
- Raise the supported Node.js floor to 22.14.0; verify the minimum and current Node 22/24 LTS.
- Preserve the existing environment variables, read-only default and explicit write opt-in.
- Require explicit development-project confirmation before running the optional live smoke.
- Refresh compatible locked dependencies; the audited dependency tree has no known advisories at validation time.
