# Contributing

## Branches and validation

Create a focused `feat/*` or `fix/*` branch from current `main` and open the PR
against `main`; maintainers merge it with **Squash and merge**. `main` is the only
long-lived branch: there are no `develop`, release or hotfix branches. Keep local
credentials and unrelated changes outside the PR. Use a dedicated worktree when
another checkout is in use.

Use Node.js 22.14.0 or newer. CI verifies the exact minimum 22.14.0 and current
22.x and 24.x LTS releases. Node 20 is end-of-life and is no longer supported.
The runtime dependencies permit older Node versions (MCP SDK 1.32.2 declares
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
separate and requires explicit designation of a project. `npm run test:live:all`
runs every live suite sequentially; the publication job runs it as a deployed
smoke gate (dev environment for dev builds, production for release verification
and releases) before any registry write. See RELEASING.md for the gates and how
to run them locally.

The `CI` workflow in `.github/workflows/publish.yaml` runs for PRs into and pushes
to `main`, manual validation and published GitHub Releases. Require the
`Node.js 22.14.0`, `Node.js 22` and `Node.js 24` checks in branch protection;
replace any old `Node 20*` / `Node 22` / `Node 24` check requirements when adopting
this workflow. Branch protection is an administrator setup step, not configured
by this change. Validation has read-only permissions and no service credentials;
only the publication job on `main` pushes and GitHub Releases reads a dedicated
smoke project key.

## Releases and compatibility

The committed version is always the last released RC/stable version (or the next
one set by a release pull request); CI derives development versions from tags and
never commits them. Automatic dev publication
requires separate bootstrap, package-specific npm trust and an explicit repository
variable. Setup is complete and `NPM_DEV_PUBLISH_ENABLED=true` as verified on
2026-09-20 (KST); merging into `main` can publish a new dev version after CI
succeeds. PRs and manual workflow runs cannot publish.
Follow [RELEASING.md](RELEASING.md) for every publication action.

A release pull request into `main` sets the rc/stable version and a dated
changelog entry; its merge is verified without publication. Maintenance releases
are cut from `main`. Tags, GitHub Releases and bootstrap publication are explicit
maintainer actions. No version change follows a release: once its tag exists,
later `main` pushes build the next development version.

Treat environment variables, tool names/schemas, read-only defaults, ref semantics,
error handling and supported runtimes as public contracts. Document incompatible
changes and validate the installed artifact. Update package.json and both root
package-lock.json versions together with `node scripts/version.mjs set VERSION`.
Do not use prerelease channels as implicit write opt-in. Pin workflow actions to
reviewed commit SHAs. Never commit keys, `.env` files or signed URLs.
