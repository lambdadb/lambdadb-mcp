# Releasing LambdaDB MCP

## Release model

Releases are trunk-based: `main` is the only long-lived branch and the default
branch. Every change reaches `main` through a pull request; feature and fix pull
requests are merged with **Squash and merge**. The organization ruleset
`protect-main` requires a pull request with one approval (the `dev` team may
bypass the approval) and blocks deletion and force pushes. There are no
`develop`, release or hotfix branches; maintenance releases are cut from `main`,
and anything merged into `main` ships in the next release.

| Channel | Committed version | Published version | Trigger | Git tag | npm dist-tag |
| --- | --- | --- | --- | --- | --- |
| Development | Last released `X.Y.Z` or `X.Y.Z-rc.M` (tagged) | `X.Y.(Z+1)-dev.N` after stable, `X.Y.Z-dev.N` after an RC (N ≥ 1, assigned by CI) | `main` push, explicitly enabled | None | dev |
| Release candidate | `X.Y.Z-rc.N` | `X.Y.Z-rc.N` | Published GitHub prerelease `vX.Y.Z-rc.N` | `vX.Y.Z-rc.N` | rc |
| Stable | `X.Y.Z` | `X.Y.Z` | Published GitHub release `vX.Y.Z` | `vX.Y.Z` | latest |

The committed version is always an RC or stable version: the most recently
released version, whose tag `v<version>` exists, or the next version set by a
merged release pull request that is not tagged yet. A development version is
never committed; CI derives it from tags (see "Automatic dev publication"). Only
a release pull request changes the committed version, and that exact merge commit
on `main` is tagged. Published version, committed version and tag agree. Only
these canonical forms are accepted, without leading zeroes or build suffixes.
`package.json` and both root lockfile versions must match. MCP initialize reads
its version from the installed package.json; there is no second version
constant. The repository URL must identify this exact public GitHub repository.

Change every version source at once with the version script. It keeps each
file's formatting, accepts only committed forms (`X.Y.Z-rc.N`, `X.Y.Z`) and
fails unless all sources agree afterwards. `npm run check` also rejects a
committed development version:

```sh
node scripts/version.mjs get               # print the committed version
node scripts/version.mjs set 0.2.0-rc.1    # release pull request
```

The `CI` workflow (`.github/workflows/publish.yaml`) selects one run mode:

- Pull requests into `main` and manual runs: validation only, no credentials
  and no live tests.
- `main` push whose committed version is already tagged (`v<version>` exists on
  `origin`): validation, the deployed live smoke against the dev environment,
  then an automatic dev build (see below).
- `main` push whose committed `X.Y.Z-rc.N` or `X.Y.Z` is not tagged yet (a
  release pull request merge): validation plus the publication job's release
  metadata, changelog, ancestry, pack and installed-package checks and the
  deployed live smoke against production, with no publication. Tag only after
  it passes. A committed development version fails the run.
- Published GitHub Release: the same checks against the tag, including the
  production live smoke, then publication of its RC or stable version.

Every publication-job run passes the deployed live smoke (see "Deployed live
smoke gates") before any registry write; a smoke failure stops the job.

`node scripts/version.mjs mode` selects the mode by querying tags on `origin`
(`git ls-remote`), not the local checkout, so a stale or partial checkout cannot
misclassify a commit; a failed query fails the run. Pushing the release tag is
what switches later `main` pushes from verification back to development builds;
no version change or follow-up pull request is needed after a release.

The release records that follow, through "Historical bootstrap and 0.1.0
status", are dated records from the earlier develop/main flow and are kept
unchanged.

## Current stable release: 0.1.5 (2026-10-25 KST)

[v0.1.5](https://github.com/lambdadb/lambdadb-mcp/releases/tag/v0.1.5) tags main
commit `1ae40dcbebea734e34ddde024e0991c8bf3fda64`, which merged
[release PR #27](https://github.com/lambdadb/lambdadb-mcp/pull/27) with preserved
ancestry. The user explicitly authorized the annotated tag, non-prerelease
GitHub Release and npm latest publication. The
[release workflow](https://github.com/lambdadb/lambdadb-mcp/actions/runs/40169478215)
passed Node.js 22.14.0 / 22 / 24 validation and published its exact tested artifact
with OIDC and provenance. Registry snapshot: `latest=0.1.5`, `dev=0.1.5-dev.18`.

The downloaded 15-file stable artifact matched the tagged source and registry
integrity, passed 37 installed-package tests, and had zero consumer audit
findings. `npm audit signatures` reported no invalid or missing signatures;
provenance repository, workflow, tag, commit and artifact digest matched.
Actual Kiro V2/Sonnet called the published MCP directly against a synthetic
backend without a resolver substitution. A separate actual development-service
check verified authentication and collection-list access only. No writes or
search readiness are claimed. See the
[validation record](docs/validation/2026-10-25-0.1.5.md). Do not repeat publication
or move the immutable tag.

`release/sync-0.1.5` brings this main history back into develop with the next
`0.1.6-dev.1` source base. Merge with preserved ancestry. Eligible develop merges
can publish dev versions while latest stays on 0.1.5. CLI 0.1.5 still pins MCP
0.1.4; its separate pin update/release is required for stable CLI users.

## Previous stable release: 0.1.4 (2026-10-07 KST)

[v0.1.4](https://github.com/lambdadb/lambdadb-mcp/releases/tag/v0.1.4) tags main
commit `f84038962bbdc6f5375b873727d0cf54d843c7b2`, which merged
[release PR #21](https://github.com/lambdadb/lambdadb-mcp/pull/21) with an explicitly
authorized administrator merge and preserved ancestry. The
[release workflow](https://github.com/lambdadb/lambdadb-mcp/actions/runs/37600343928)
passed Node 22.14.0 / 22 / 24 validation and published its exact tested artifact
with OIDC and provenance. Registry snapshot: `latest=0.1.4`, `dev=0.1.4-dev.15`.

LambdaDB SDK 0.8.1 standardizes native embedding and native reranking terminology.
MCP SDK 1.31.0 addresses the OAuth-client advisory; its stdio receive-buffer limit
is 10 MiB and schema-validation error formatting includes field paths. Existing
application tool contracts remain. The downloaded stable artifact matched its
registry integrity, source commit and both SDK pins, passed 35 installed-package
tests, and had zero consumer audit vulnerabilities. Provenance statement metadata
matched the release source and artifact. No new paid/state-changing live smoke
was run. See [validation evidence](docs/validation/2026-10-07-0.1.4.md).
Do not repeat publication or move the tag.

The 0.1.4 synchronization completed in
[PR #22](https://github.com/lambdadb/lambdadb-mcp/pull/22), bringing main back into
develop with the next source base `0.1.5-dev.1` and preserved ancestry.
Eligible develop merges can publish new dev versions while `latest` stays on
0.1.4. Do not merge stable version metadata directly into develop.

## Previous stable release: 0.1.3 (2026-10-06 KST)

[v0.1.3](https://github.com/lambdadb/lambdadb-mcp/releases/tag/v0.1.3) tags main
commit `159b84aace7d9352cf8e5315bc7f7192e8d65a41`, which merged
[release PR #15](https://github.com/lambdadb/lambdadb-mcp/pull/15) using an
explicitly authorized admin merge commit and preserved ancestry. The
[release workflow](https://github.com/lambdadb/lambdadb-mcp/actions/runs/37458444410)
passed Node 22.14.0 / 22 / 24 validation and published its exact tested artifact
with OIDC and provenance. Registry snapshot: `latest=0.1.3`, `dev=0.1.3-dev.11`.

SDK 0.8.0 adds Bayesian candidate budgets and native embedding configuration.
Existing tool names, free-form inputs, rerank defaults and metadata, SDK downloads,
and read-only defaults remain. Older servers still require
`managedEmbedding: true`; Bayesian/native inputs require a supporting deployment.
See `docs/validation/2026-10-06-0.1.3.md` for separate candidate, source-build live,
and published-package evidence. Do not repeat publication or move the tag.

`release/sync-0.1.3` brings main back into develop with the next source base
`0.1.4-dev.1`. Review it into develop using a merge commit to preserve ancestry.
Eligible develop merges may publish new dev versions while `latest` stays on
0.1.3. Do not merge stable version metadata directly into develop.

## Previous stable release: 0.1.2 (2026-10-04 KST)

[v0.1.2](https://github.com/lambdadb/lambdadb-mcp/releases/tag/v0.1.2) tags main
commit `627ffbb3161bc3d41d5f2a5f2a0f5289fd73de3f`, which merged
[release PR #12](https://github.com/lambdadb/lambdadb-mcp/pull/12) with preserved
ancestry. The [release workflow](https://github.com/lambdadb/lambdadb-mcp/actions/runs/37191117220)
passed Node 22.14.0 / 22 / 24 validation and published its exact tested artifact
with OIDC and provenance. Registry snapshot: `latest=0.1.2`, `dev=0.1.2-dev.9`.
A downloaded stable tarball matched registry integrity, source commit and SDK
0.7.0 and passed 31 clean-consumer stdio tests. Provenance statement repository,
workflow, tag, source commit and subject digest matched the publication.

SDK 0.7.0 adds 49 fixed text analyzer presets and optional per-query native
reranking. Read-only defaults and explicit write opt-in remain. See
`docs/validation/2026-10-04-0.1.2.md` for separate candidate, authorized
source-build live, published dev and published stable evidence. Do not repeat the
0.1.2 publication or move its tag.

The 0.1.2 synchronization is complete: PR #13 brought main back into develop
with the `0.1.3-dev.1` base. Eligible develop merges may publish new dev versions
while `latest` stays on 0.1.2 until an explicitly authorized stable release.
Do not merge stable version metadata directly into develop.

Live suites require explicit designation of a development project. Reranking
also requires native reranking inference opt-in; no Jev API key is required. Live contract
checks do not establish production deployment, search quality, load/failure
coverage or billing readiness. Supporting backend deployment/model availability
and keyword-index requirements remain; existing collections/indexes are not migrated.

## Previous stable release: 0.1.1 (2026-09-29 KST)

[v0.1.1](https://github.com/lambdadb/lambdadb-mcp/releases/tag/v0.1.1) tags main
commit `40a8afc25bb93fb14d03d23e3ab38aa1924cf060`, which merged the reviewed release
PR with preserved ancestry. The [release workflow](https://github.com/lambdadb/lambdadb-mcp/actions/runs/36557646939)
passed Node 22.14.0 / 22 / 24 validation and published the tested artifact with
OIDC and provenance. Registry snapshot: `latest=0.1.1`, `dev=0.1.1-dev.7`.
SDK 0.6.0 adds keyword facets, match-all and facet-only queries, and all 16 text
analyzers. Read-only defaults and explicit write opt-in remain.

See `docs/validation/2026-09-29-0.1.1.md` in this source for separate candidate,
development-service, and published-package evidence. Do not repeat the 0.1.1
publication or move its tag.

The 0.1.1 synchronization is complete: main was brought back into develop with
the `0.1.2-dev.1` base through PR #10. Eligible develop merges publish dev versions
while leaving `latest` on 0.1.1 until an explicitly published stable release.
Facets need a supporting server and newly built keyword indexes; this release
does not migrate existing Collections or indexes.

## Historical bootstrap and 0.1.0 status

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
- First stable release: [`v0.1.0`](https://github.com/lambdadb/lambdadb-mcp/releases/tag/v0.1.0).
  The [release workflow](https://github.com/lambdadb/lambdadb-mcp/actions/runs/35494365745)
  published `0.1.0` with OIDC and provenance; `latest=0.1.0`, `dev=0.1.0-dev.5`.
- main contains the stable release and publishing workflow. develop resumes with
  the `0.1.1-dev.1` base; CI generates its dev counter from first-parent history.
  Eligible develop pushes can publish the next dev version while leaving
  `latest` on `0.1.0`.
- See the [validation record](https://github.com/lambdadb/lambdadb-mcp/blob/main/docs/validation/2026-09-20-npm.md) for package,
  provenance, and live-service evidence and their separate scopes.

These are dated observations, not fixed channel values. Recheck the registry and
repository variable before the next release. The bootstrap and trust sections
below describe setup and recovery; they are not outstanding setup tasks.

The release model at the top of this document replaces the earlier develop-based
channel table.

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

Live tests are not part of PR validation. The publication job runs them as the
deployed live smoke gate described below. Manual live runs require a designated
project, not merely the presence of an existing `.env.local` or credential. See
README for `LAMBDADB_RUN_LIVE_TESTS=1` and project confirmation. Never load
production credentials into package tests or the validation matrix; only the
publication job's smoke reads the dedicated production smoke project key.
Authorized development-project live tests have passed; the
[validation record](https://github.com/lambdadb/lambdadb-mcp/blob/main/docs/validation/2026-09-20-npm.md) identifies the
tested source and installed package. These results do not automatically validate
a future release candidate.

## Deployed live smoke gates

| Run mode | Event | Live target | Variable prefix |
| --- | --- | --- | --- |
| None | Pull request, manual run | None (no credentials) | None |
| `dev` | `main` push, committed version tagged on `origin` | Dev environment, then dev publication | `LAMBDADB_DEV_` |
| `verify` | `main` push, committed `X.Y.Z-rc.N` or `X.Y.Z` not tagged yet | Production, verification only | `LAMBDADB_PROD_` |
| `release` | Published GitHub Release | Production, then publication | `LAMBDADB_PROD_` |

`node scripts/version.mjs mode` selects the run mode and its Variable prefix. A
dev run superseded before preparation (no longer the head of `main`), or a
rerun of the tagged stable release commit itself, skips the smoke together with
publication.

After the exact publication artifact passes its installed-package tests, the
publication job assumes the environment's AWS role through GitHub OIDC and runs
`node scripts/run-live-smoke.mjs`. The runner fails on missing configuration,
reads the project API key from Secrets Manager with the AWS CLI, masks it, and
passes it only in the environment of `npm run test:live:all`. It never puts the
key in files, command arguments, artifacts or GitHub Secrets, and loads no
dotenv file (`LAMBDADB_ENV_FILE=/dev/null`). It sets every opt-in
(`LAMBDADB_RUN_LIVE_TESTS=1`, `LAMBDADB_RUN_LIVE_RERANK_TESTS=1`,
`LAMBDADB_MCP_ENABLE_WRITE_TOOLS=true` and `LAMBDADB_LIVE_CONFIRM_PROJECT` set
to the project name), and each suite fails rather than skips without them.

`test:live:all` builds once and runs `live`, `rerank-live` and `bayesian-live`
one file at a time (`--test-concurrency=1`); concurrent bulk writes can exceed
the project's writer capacity and return HTTP 429. Each suite creates its own
temporary collection, deletes it in cleanup and verifies its absence. The rerank
and Bayesian suites incur real embedding and reranking inference. The
publication job allows 60 minutes for these suites.

Each smoke target uses these repository Variables. A missing Variable is empty
and fails the run; it never falls back to the other environment.

| Variable | Value |
| --- | --- |
| `LAMBDADB_DEV_BASE_URL` | `https://internal-dev-aws-apne2-v3-c05a2b5d492a.lambdadb.ai` |
| `LAMBDADB_DEV_PROJECT_NAME` | Dedicated MCP smoke project in `dev-aws-apne2-v3` (`mcp-ci`) |
| `LAMBDADB_DEV_SMOKE_AWS_ROLE_ARN` | Dev AWS OIDC role ARN (`lambdadb-mcp-smoke`) |
| `LAMBDADB_DEV_SMOKE_SECRET_ARN` | Exact ARN of the dev project's API key secret |
| `LAMBDADB_PROD_BASE_URL` | `https://aws-ap-northeast-2-v3.lambdadb.ai` |
| `LAMBDADB_PROD_PROJECT_NAME` | Dedicated MCP smoke project in `prod-aws-apne2-v3` (`mcp-ci`) |
| `LAMBDADB_PROD_SMOKE_AWS_ROLE_ARN` | Production AWS OIDC role ARN (`lambdadb-mcp-prod-smoke`) |
| `LAMBDADB_PROD_SMOKE_SECRET_ARN` | Exact ARN of the production project's API key secret |

Each key is a plain SecretString in `ap-northeast-2`. Each project is dedicated
to this smoke, where temporary collections may be created and deleted, with a
`rateLimit` of at least 100 requests per second. Each role trusts audience
`sts.amazonaws.com` and only these subjects; the dev role:

```text
repo:lambdadb/lambdadb-mcp:ref:refs/heads/main
```

The production role (release verification on `main`, Releases on tags):

```text
repo:lambdadb/lambdadb-mcp:ref:refs/heads/main
repo:lambdadb/lambdadb-mcp:ref:refs/tags/v*
```

Each role may only call `secretsmanager:GetSecretValue` on its own environment's
smoke secret (plus `kms:Decrypt` on the exact key if a customer-managed KMS key
is used). Do not grant the workflow an admin key, project creation, deployment
or secret write permissions. Provisioning the roles, projects, keys and
Variables is a separate environment setup step; key rotation updates the secret
without changing the workflow. A smoke failure caused by a server change not yet
deployed to production blocks verification and release; record the exact error.

To run the same suite locally against a designated project, use AWS credentials
that can read its smoke secret. Outside GitHub Actions the runner prints no mask
command, so the key is never printed:

```sh
npm ci
AWS_PROFILE=YOUR_PROFILE LAMBDADB_BASE_URL=https://... LAMBDADB_PROJECT_NAME=mcp-ci \
  LAMBDADB_SMOKE_SECRET_ARN=arn:aws:secretsmanager:... node scripts/run-live-smoke.mjs
```

With credentials in `.env.local` (including `LAMBDADB_MCP_ENABLE_WRITE_TOOLS=true`)
instead, set the opt-ins yourself:

```sh
LAMBDADB_RUN_LIVE_TESTS=1 LAMBDADB_RUN_LIVE_RERANK_TESTS=1 \
  LAMBDADB_LIVE_CONFIRM_PROJECT=YOUR_PROJECT npm run test:live:all
```

Record the environment, MCP commit, duration, outcome and cleanup result. A
source revision alone does not establish the deployed server revision.

## First package publication: separate manual bootstrap

npm trust configuration requires an existing package. See the official
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).
The TypeScript SDK's or CLI's trust settings do not cover this package.

1. Review and merge preparation, validate a clean reviewed candidate,
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

## Automatic dev publication: a separate authorization

Leave repository variable `NPM_DEV_PUBLISH_ENABLED` unset or false through
bootstrap and trust setup. Only after authorizing ongoing dev publication, set it
to `true` in GitHub **Settings → Secrets and variables → Actions → Variables**.
This repository completed that activation; the variable was verified as `true` on
2026-09-20 (KST). With it set, a reviewed `main` push whose committed version is
already tagged publishes after validation and the dev live smoke pass, and a
rerun of its existing push workflow can publish. Pull requests, manual runs and
release verification never publish. Disable the variable to stop future
automatic publication; the job then still prepares and tests the dev artifact
and runs the dev live smoke without a registry write. Do not cancel
an in-progress registry write as rollback.

The workflow checks out the exact push SHA and derives the development version
from the tagged committed version: stable `X.Y.Z` builds `X.Y.(Z+1)-dev.N`, and
RC `X.Y.Z-rc.M` builds `X.Y.Z-dev.N`, which sorts below that RC (as `-dev` sorts
below `-rc`). N is the number of first-parent commits on `main` since the newest
stable release tag (`vA.B.C`) reachable from that commit, or since the root
commit when there is none. N is the same on every rerun of a commit, restarts at
1 after each stable release, and keeps increasing across the RCs of one version.
For example, committed `0.11.0` (tagged) builds `0.11.1-dev.N`, and committed
`0.12.0-rc.1` (tagged) builds `0.12.0-dev.N`. A rerun of the stable release
commit's own `main` push after its tag exists (N would be 0) skips preparation,
the smoke and publication with a `Development publication skipped` notice and
succeeds; its GitHub Release publishes that commit. Preparation fails for a
committed development version, for any other N = 0 state, and when the derived
version is not newer than the newest stable tag. Generated package/lock versions and `gitHead` (the source commit)
exist only in the runner; no version commits, tags or GitHub Releases are
created for dev builds. Disable force pushes/history rewrites; numbers can have
gaps when pushes are superseded.

The `dev` dist-tag never moves backwards. Before the write, a derived version
lower than the current `dev` dist-tag is skipped as `superseded` with a log
notice, not a failure, and is never published, even if an earlier flow already
published that version from another commit. The dev live smoke still runs.

Transition from the placeholder model: `main` previously committed the
`0.2.0-dev.0` placeholder and published `0.2.0-dev.1` and `0.2.0-dev.2`; the
earlier develop flow published up to `0.1.6-dev.21`. The committed version
returned to `0.1.5`, the latest release, so `main` pushes derive `0.1.6-dev.N`,
which is below the `dev` dist-tag `0.2.0-dev.2` and is skipped. Dev publication
resumes once a release pull request sets `0.2.0-rc.1` (or `0.2.0`) and that
version is tagged: later pushes then derive `0.2.0-dev.N` or `0.2.1-dev.N`, above
`0.2.0-dev.2` because N keeps counting from `v0.1.5`.

Remote `main` HEAD is checked before preparation and immediately before the
write; a commit that is no longer the head of `main` is skipped. Versions older
than the current channel are skipped. A version already published from the same
commit and artifact is skipped as `already-published`; the same version from a
different commit fails. All publication jobs share non-cancelling concurrency so
registry writes do not race. A newer pending job can replace an older pending
job; this does not promise a package for every rapid merge. Re-run an explicit
release if it was superseded in the pending queue and still needs publication.

## Explicit rc/stable publication

1. Open a release pull request into `main` that sets the version with
   `node scripts/version.mjs set X.Y.Z-rc.N` (or `X.Y.Z`) and adds a dated
   `## [VERSION] - YYYY-MM-DD` changelog entry. Retain validation/live-test
   status for the candidate.
2. Merge it. That `main` push runs the publication job in verification mode:
   release metadata, changelog and ancestry checks, one pack, the
   installed-package tests and the production live smoke, with no publication. Do not merge other pull
   requests until the release is tagged, or tag the release pull request's merge
   commit explicitly.
3. After verification passes, obtain authorization, tag that exact merge commit
   on `main` as `vVERSION`, and publish the GitHub Release with
   `prerelease: true` for rc or `false` for stable. Draft releases do not
   publish. Do not create a dev GitHub Release.
4. The workflow validates the release tag, package versions, prerelease flag,
   changelog and ancestry in origin/main; it packs/tests once, runs the
   production live smoke and publishes the exact file to rc/latest with OIDC
   and provenance. A successful CI run alone
   is not publication evidence. Verify npm.
5. No follow-up version change is needed: once the tag exists, later `main`
   pushes derive development versions from it.

Address RC feedback in new pull requests into `main` and release the next RC
number. Never reuse a published version or move its tag.

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
