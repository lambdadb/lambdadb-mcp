# Contributing

## Branches and validation

Create a focused `feat/*` or `fix/*` branch from current `develop`; open PRs with
`develop` explicitly selected as the base. Keep local credentials and unrelated
changes outside the PR. Use a dedicated worktree when another checkout is in use.

Use Node.js 22.14.0 or newer. CI verifies the exact minimum 22.14.0 and current
22.x and 24.x LTS releases. Node 20 is end-of-life and is no longer supported.
The runtime dependencies permit older Node versions (MCP SDK 1.29.0 declares
Node >=18), but that is not a promise to support end-of-life runtimes. The
22.14.0 floor also aligns with the CLI and npm's OIDC publishing runtime floor.
See the [Node release schedule](https://nodejs.org/en/about/previous-releases)
and [npm requirements](https://docs.npmjs.com/trusted-publishers/).

```sh
npm ci
npm run check
npm run test:package
```

`check` validates package/lock versions, type-checks, builds, and runs local tests.
`test:package` packs once, checks the actual file inventory, installs without
lifecycle scripts in a temporary consumer directory, and runs the MCP contracts
against the installed executable over stdio. An optional tarball argument tests
an already packed file without rebuilding it. Fixtures use loopback HTTP and
synthetic credentials; they never call a LambdaDB service. Live verification is
separate and requires explicit designation of a development project.

The `CI` workflow in `.github/workflows/publish.yaml` runs for PRs and pushes to
`develop`/`main`, manual validation and published GitHub Releases. Require the
`Node.js 22.14.0`, `Node.js 22` and `Node.js 24` checks in branch protection;
replace any old `Node 20*` / `Node 22` / `Node 24` check requirements when adopting
this workflow. Branch protection is an administrator setup step, not configured
by this change. Validation has read-only permissions and no service credentials.

## Releases and compatibility

Keep develop's reviewed base in `X.Y.Z-dev.N` form. Automatic dev publication
requires separate bootstrap, package-specific npm trust and an explicit repository
variable. Setup is complete and `NPM_DEV_PUBLISH_ENABLED=true` as verified on
2026-09-20 (KST); merging into develop can publish a new dev version after CI
succeeds. PRs and manual workflow runs cannot publish.
Follow [RELEASING.md](RELEASING.md) for every publication action.

Prepare rc/stable metadata on a release branch and review it into `main`. Promote
with merge commits to preserve main/develop ancestry. When synchronizing main
back into develop through a PR, include the next dev base. Do not leave stable
metadata on develop, where automatic version generation requires a dev version.
Tags, GitHub Releases and bootstrap publication are explicit maintainer actions.

Treat environment variables, tool names/schemas, read-only defaults, ref semantics,
error handling and supported runtimes as public contracts. Document incompatible
changes and validate the installed artifact. Update package.json and both root
package-lock.json versions together with `npm version VERSION --no-git-tag-version`.
Do not use prerelease channels as implicit write opt-in. Pin workflow actions to
reviewed commit SHAs. Never commit keys, `.env` files or signed URLs.
