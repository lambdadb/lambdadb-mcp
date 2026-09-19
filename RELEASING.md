# Releasing LambdaDB MCP

## Status and policy

As verified on **2026-09-20 (KST)**:

- Public package: [`@functional-systems/lambdadb-mcp`](https://www.npmjs.com/package/@functional-systems/lambdadb-mcp).
- Manual bootstrap `0.1.0-dev.1` is complete. Organization publication rights were
  confirmed during bootstrap; do not repeat first publication.
- Package-specific Trusted Publishing is working: GitHub Actions published
  `0.1.0-dev.4` with OIDC and provenance in
  [run 35434355648, attempt 2](https://github.com/lambdadb/lambdadb-mcp/actions/runs/35434355648/attempts/2).
- Automatic dev publication is enabled (`NPM_DEV_PUBLISH_ENABLED=true`). Eligible
  develop pushes publish after validation; a documentation-only merge can also
  produce a new dev version.
- `dev=0.1.0-dev.4`; `latest=0.1.0-dev.1` is still the bootstrap prerelease.
  There is no rc/stable release or GitHub Release yet. Prefer `@dev` or an exact
  published version until stable is available.
- main still needs the publishing workflow and reviewed release metadata before
  rc/stable publication. See [explicit rc/stable publication](#explicit-rcstable-publication).
- See the [validation record](https://github.com/lambdadb/lambdadb-mcp/blob/develop/docs/validation/2026-09-20-npm.md) for package,
  provenance, and live-service evidence and their separate scopes.

These are dated observations, not fixed channel values. Recheck the registry and
repository variable before the next release. The bootstrap and trust sections
below describe setup and recovery; they are not outstanding setup tasks.

| Source | Version | Trigger | npm dist-tag |
| --- | --- | --- | --- |
| develop | `X.Y.Z-dev.N` | Successful push validation, explicitly enabled | dev |
| reviewed main history | `X.Y.Z-rc.N` | Published GitHub prerelease `vX.Y.Z-rc.N` | rc |
| reviewed main history | `X.Y.Z` | Published GitHub release `vX.Y.Z` | latest |

Only these canonical forms are accepted, without leading zeroes or build suffixes.
`package.json` and both root lockfile versions must match. MCP initialize reads
its version from the installed package.json; there is no second version constant.
The repository URL must identify this exact public GitHub repository.

## Validation and the publication artifact

From a clean checkout of the reviewed candidate with Node >=22.14.0:

```sh
npm ci
npm run check
# Use an output directory outside the checkout.
mkdir -p /tmp/lambdadb-mcp-release
npm pack --json --pack-destination /tmp/lambdadb-mcp-release
# Substitute the exact filename returned by npm pack.
npm run test:package -- /tmp/lambdadb-mcp-release/functional-systems-lambdadb-mcp-VERSION.tgz
```

Keep that tarball: publish the same file, never a newly packed directory. The
workflow performs exactly one pack in its publishing job, validates inventory,
installs that file without install scripts into a clean temporary directory,
and tests the installed `lambdadb-mcp` bin. Its hash must remain unchanged during
testing. Validation matrix jobs also test their own packages; those are not the
publication artifact. Only compiled JavaScript, package metadata, README,
CHANGELOG, contribution/release guides and LICENSE are allowed in the actual tarball. The build cleans dist
first so stale compiled files cannot survive a normal pack.

Consumer tests exercise MCP initialize, tools/list and tools/call with loopback
HTTP fixtures: read-only defaults, write opt-in, ref/branch forwarding, SDK errors,
docsUrl downloads and credential isolation, version identity, configuration
failures, protocol-only stdout and termination. They do not prove production
service behavior or every MCP client UI. Installed dependencies are resolved by
npm (the package's development lockfile is not a consumer dependency lock).

Live tests are optional for PR validation, but release owners must explicitly
record performed or not performed. They require a designated development project,
not merely the presence of an existing `.env.local` or credential. See README
for `LAMBDADB_RUN_LIVE_TESTS=1` and project confirmation. Do not load production
credentials into package/CI tests. Authorized development-project live tests have
passed; the [validation record](https://github.com/lambdadb/lambdadb-mcp/blob/develop/docs/validation/2026-09-20-npm.md) identifies the
tested source and installed package. These results do not automatically validate
a future release candidate.

## First package publication: separate manual bootstrap

npm trust configuration requires an existing package. See the official
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).
The TypeScript SDK's or CLI's trust settings do not cover this package.

1. Review and merge preparation, validate a clean reviewed develop candidate,
   and confirm its version is the real bootstrap prerelease `0.1.0-dev.1`.
2. Obtain authorization for first publication. An authorized npm
   `functional-systems` organization owner uses interactive `npm login` with MFA,
   then verifies `npm whoami` and `npm org ls functional-systems`. Do not add a
   long-lived npm token to GitHub or the repository.
3. Pack once and test the resulting file using the commands above. Publish that
   exact verified file with the interactive account:

   ```sh
   npm publish /absolute/path/to/functional-systems-lambdadb-mcp-0.1.0-dev.1.tgz --access public --tag dev
   ```

4. Verify version, tarball integrity, dist-tags and a clean consumer install.
   Bootstrap does not carry GitHub Actions provenance. npm can also assign
   `latest` during first publication even with `--tag dev`; inspect actual tags
   and document that state. Until a stable release exists, use an explicit dev
   version/tag and do not advertise unqualified npx as stable. Do not repeat
   bootstrap or republish a used version to fix registry lag.

## Configure package-specific Trusted Publishing

After bootstrap, open the npm package's **Settings → Trusted Publisher**:

| Setting | Value |
| --- | --- |
| Package | `@functional-systems/lambdadb-mcp` |
| Provider | GitHub Actions |
| Organization or user | `lambdadb` |
| Repository | `lambdadb-mcp` |
| Workflow filename | `publish.yaml` (filename only) |
| Environment | Empty; the job declares no GitHub Environment |
| Allowed actions | Enable direct `npm publish` |

New trust configurations may default to staged publishing only; that does not
authorize this workflow's direct publish. If an Environment is added later,
configure its exact name in npm too. Restrict traditional publishing tokens in
package settings after setup. Saving trust settings does not validate OIDC;
only an authorized successful publication does.

The workflow uses a GitHub-hosted runner, Node 24, npm >=11.5.1,
`id-token: write` only in the publication job, public access and provenance.
It has no npm token secret. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

## Enable automatic dev publication: a separate authorization

Leave repository variable `NPM_DEV_PUBLISH_ENABLED` unset or false through
bootstrap and trust setup. Only after authorizing ongoing develop publication,
set it to `true` in GitHub **Settings → Secrets and variables → Actions → Variables**.
This repository completed that activation; the variable was verified as `true` on
2026-09-20 (KST). The next eligible develop push, or a rerun of its existing push
workflow, can publish. `workflow_dispatch`, PRs and main
pushes validate only. Disable the variable to stop future automatic publication;
do not cancel an in-progress registry write as rollback.

The generator reuses the CLI's first-parent strategy: for a reviewed base
`X.Y.Z-dev.N`, set N to `git rev-list --first-parent --count HEAD` from a full
checkout. Numbers can have gaps; reruns of the same commit generate the same
version. Disable force pushes/history rewrites. Generated package/lock versions
and gitHead exist only in the runner; no version commits, tags or GitHub Releases
are created for dev builds. Review a new base when starting another release line.

Remote develop HEAD is checked before preparation and immediately before the
write. Stale jobs and versions older than the current channel are skipped.
All publication jobs share non-cancelling concurrency so registry writes do not
race. A newer pending job can replace an older pending job; this does not promise
a package for every rapid merge. Re-run an explicit release if it was superseded
in the pending queue and still needs publication.

## Explicit rc/stable publication

1. Prepare matching package/lock metadata and a dated
   `## [VERSION] - YYYY-MM-DD` changelog entry on a release branch. Review into
   main and retain validation/live-test status for the candidate.
2. Ensure `publish.yaml` exists on the default branch (`main`). The dev push
   path does not require that promotion, but GitHub Release handling does.
3. Obtain authorization, tag the verified main commit as `vVERSION`, and publish
   the GitHub Release with `prerelease: true` for rc or `false` for stable.
   Draft releases do not publish. Do not create a dev GitHub Release.
4. The workflow validates the release tag, package versions, prerelease flag,
   changelog and ancestry in origin/main; it packs/tests once and publishes the
   exact file to rc/latest with OIDC and provenance. A successful CI run alone
   is not publication evidence. Verify npm and synchronize release changes into
   develop with its next dev base via PR.

## Duplicate prevention, registry lag and recovery

Dev, rc and stable use the CLI-derived registry verification path. Before a write,
only a structured E404 means an absent version; authentication, malformed responses
and transport failures fail closed. Existing versions must match package name,
version, gitHead and tarball SHA-512 integrity and already own the selected tag.
Identical reruns report `already-published`; conflicts or unexpected tag state
require investigation. Older channel candidates report `superseded` without
changing tags. rc/dev never intentionally update latest.

There is at most one publish request per invocation, with no automatic write
retry. After an accepted write, read requests share a five-minute monotonic budget,
15-second maximum request timeouts, no nested npm fetch retries and sleeps of at
most ten seconds. E404, HTTP 429/5xx and recognized transient connection errors
are retried only during post-publication reads. Metadata and tags can propagate
separately. Artifact conflicts, authentication errors and malformed responses fail.

`published-verification-pending` means the write succeeded but reads did not
converge in the budget. A failed publish request is an uncertain write. In either
case inspect and retry registry reads first, never immediately republish:

```sh
npm view @functional-systems/lambdadb-mcp@VERSION version gitHead dist.integrity dist.attestations --json
npm view @functional-systems/lambdadb-mcp@dev dist-tags --json
```

Once metadata agrees, an identical rerun skips the write. Verify provenance's
repository and commit and run a clean consumer smoke. Do not move immutable tags,
republish a used version, or automatically change dist-tags to recover. Prepare a
new reviewed patch for a bad release; deprecation and tag changes are explicit
maintainer actions. No Homebrew, MCP Registry or HTTP hosting is part of this flow.
