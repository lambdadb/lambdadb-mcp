import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/publish.yaml', import.meta.url), 'utf8');
const nextDevWorkflow = readFileSync(new URL('../.github/workflows/next-dev-version.yaml', import.meta.url), 'utf8');
const step = name => {
  const start = workflow.indexOf(`- name: ${name}\n`);
  assert.ok(start >= 0, `Missing step ${name}`);
  const end = workflow.indexOf('\n      - name: ', start + 1);
  return workflow.slice(start, end < 0 ? undefined : end);
};

test('CI and publication trigger on main and GitHub Releases only', () => {
  assert.match(workflow, /\non:\n {2}pull_request:\n {4}branches: \[main\]\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:\n {2}release:\n {4}types: \[published\]\n/);
  assert.doesNotMatch(workflow, /\bdevelop\b/);
  assert.ok(workflow.includes(`(github.event_name == 'release' ||\n       (github.event_name == 'push' && github.ref == 'refs/heads/main'))`));
  assert.match(workflow, /group: npm-publication\n\s+cancel-in-progress: false/);
});

test('each run mode selects its preparation, and verification never publishes', () => {
  assert.match(step('Select the run mode'), /run: node scripts\/version\.mjs mode$/);
  assert.match(step('Prepare deterministic development version'), /if: steps\.mode\.outputs\.mode == 'dev'\n/);
  assert.match(step('Verify committed release metadata and main ancestry without publication'),
    /if: steps\.mode\.outputs\.mode == 'verify'\n\s+run: node scripts\/release\.mjs verify$/);
  assert.match(step('Verify explicit release metadata and main ancestry'), /if: steps\.mode\.outputs\.mode == 'release'\n/);
  assert.match(step('Pack once and test the exact publication artifact'),
    /if: steps\.mode\.outputs\.mode != 'dev' \|\| steps\.dev\.outputs\.ready == 'true'\n/);
  // Dev publication keeps the explicit repository Variable gate.
  assert.match(step('Publish development version and verify registry state'),
    /steps\.mode\.outputs\.mode == 'dev' && steps\.dev\.outputs\.ready == 'true' &&\n\s+vars\.NPM_DEV_PUBLISH_ENABLED == 'true'\n/);
  assert.match(step('Publish explicit release using npm Trusted Publishing'), /if: steps\.mode\.outputs\.mode == 'release'\n/);
  const publishSteps = workflow.match(/run: node scripts\/(dev-release|release)\.mjs publish/g);
  assert.equal(publishSteps.length, 2);
});

test('every publication run gates on deployed live smoke tests selected by the run mode', () => {
  const ready = "if: steps.mode.outputs.mode != 'dev' || steps.dev.outputs.ready == 'true'\n";
  const auth = step('Authenticate smoke tests to AWS');
  const smoke = step('Run deployed live smoke tests');
  for (const section of [auth, smoke]) assert.ok(section.includes(ready));
  assert.match(auth, /uses: aws-actions\/configure-aws-credentials@[0-9a-f]{40} # v6\.3\.0\n/);
  // The Variable prefix comes from the run mode; a missing Variable is empty and fails, never falls back.
  assert.ok(auth.includes("role-to-assume: ${{ vars[format('{0}SMOKE_AWS_ROLE_ARN', steps.mode.outputs.smoke_prefix)] }}"));
  for (const name of ['BASE_URL', 'PROJECT_NAME', 'SMOKE_SECRET_ARN']) {
    const variable = name === 'SMOKE_SECRET_ARN' ? 'LAMBDADB_SMOKE_SECRET_ARN' : `LAMBDADB_${name}`;
    assert.ok(smoke.includes(`${variable}: \${{ vars[format('{0}${name}', steps.mode.outputs.smoke_prefix)] }}`), name);
  }
  assert.match(smoke, /run: \|\n\s+echo "Live smoke target: \$LAMBDADB_BASE_URL"\n\s+node scripts\/run-live-smoke\.mjs$/);
  assert.doesNotMatch(workflow, /LAMBDADB_PROJECT_API_KEY|secrets\./);
  // The smoke runs after the exact artifact is tested and before either publication step.
  const order = ['Pack once and test the exact publication artifact', 'Authenticate smoke tests to AWS',
    'Run deployed live smoke tests', 'Publish development version and verify registry state',
    'Publish explicit release using npm Trusted Publishing'].map(name => workflow.indexOf(`- name: ${name}\n`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(workflow, /timeout-minutes: 60\n\s+permissions:\n\s+contents: read\n\s+id-token: write\n/);
});

test('the next development version workflow runs only after a successful release publication', () => {
  assert.match(nextDevWorkflow, /workflow_run:\n\s+workflows: \["CI"\]\n\s+types: \[completed\]/);
  assert.match(workflow, /^(?:#.*\n)*name: CI\n/);
  assert.ok(nextDevWorkflow.includes(
    "github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'release'"));
  assert.match(nextDevWorkflow, /node scripts\/version\.mjs next-dev "\$RELEASED"/);
  assert.match(nextDevWorkflow, /node scripts\/version\.mjs set "\$NEXT"/);
  assert.match(nextDevWorkflow, /gh pr create --base main/);
  assert.ok(nextDevWorkflow.includes('BRANCH="chore/next-dev-after-$RELEASE_TAG"'));
  assert.match(nextDevWorkflow, /gh pr list --head "\$BRANCH" --base main --state all /);
  assert.doesNotMatch(nextDevWorkflow, /npm publish|id-token/);
});

test('the next development version step is rerun-safe and opens one pull request per release tag', t => {
  const script = nextDevWorkflow.match(/run: \|\n([\s\S]*)$/)[1].replace(/^ {10}/gm, '');
  const temp = mkdtempSync(join(tmpdir(), 'mcp-next-dev-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const remote = join(temp, 'remote.git'), seed = join(temp, 'seed'), bin = join(temp, 'bin'), states = join(temp, 'states');
  const gitEnv = { ...process.env, GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/dev/null' };
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Release test', '-c', 'user.email=test@example.invalid', ...args],
    { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // gh stub: `pr list --head <branch>` prints that branch's recorded pull request state; `pr create` is logged.
  mkdirSync(bin); mkdirSync(states);
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nif [ "$2" = list ]; then f="$GH_STATES/$(echo "$4" | tr / _)"; ' +
    '[ -f "$f" ] && cat "$f"; exit 0; fi\necho "$@" >> "$GH_LOG"\n');
  chmodSync(join(bin, 'gh'), 0o755);
  const prState = (branch, state) => writeFileSync(join(states, branch.replaceAll('/', '_')), `${state}\n`);
  git(temp, 'init', '-q', '--bare', remote);
  git(temp, 'init', '-q', '-b', 'main', seed);
  mkdirSync(join(seed, 'scripts'));
  copyFileSync(new URL('../scripts/version.mjs', import.meta.url), join(seed, 'scripts/version.mjs'));
  git(seed, 'remote', 'add', 'origin', remote);
  const release = version => {
    writeFileSync(join(seed, 'package.json'), `{\n  "name": "pkg",\n  "version": "${version}"\n}\n`);
    writeFileSync(join(seed, 'package-lock.json'), `{\n  "name": "pkg",\n  "version": "${version}",\n  "packages": {\n    "": {\n      "version": "${version}"\n    }\n  }\n}\n`);
    git(seed, 'add', '.'); git(seed, 'commit', '-q', '-m', `release ${version}`);
    git(seed, 'push', '-q', 'origin', 'main');
  };
  let checkouts = 0;
  const run = tag => {
    const checkout = join(temp, `checkout-${checkouts++}`);
    git(temp, 'clone', '-q', '-b', 'main', remote, checkout);
    const log = join(temp, 'gh.log');
    rmSync(log, { force: true });
    const result = spawnSync('bash', ['-e', '-c', script], { cwd: checkout, encoding: 'utf8', env: {
      ...gitEnv, PATH: `${bin}:${process.env.PATH}`, RELEASE_TAG: tag, GH_STATES: states, GH_LOG: log,
    } });
    assert.equal(result.status, 0, result.stderr);
    return existsSync(log) ? readFileSync(log, 'utf8').match(/--head (\S+)/)[1] : undefined;
  };
  const head = branch => spawnSync('git', ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { cwd: remote, encoding: 'utf8' }).stdout.trim();
  const version = branch => JSON.parse(git(remote, 'show', `refs/heads/${branch}:package.json`)).version;

  // First RC: the branch is named after the tag and gets a pull request restoring the same version.
  release('0.2.0-rc.1');
  const rc1 = 'chore/next-dev-after-v0.2.0-rc.1';
  assert.equal(run('v0.2.0-rc.1'), rc1);
  assert.equal(version(rc1), '0.2.0-dev.0');
  const rc1Head = head(rc1);
  // A rerun reuses the branch and does not duplicate an existing pull request in any state.
  for (const state of ['OPEN', 'MERGED', 'CLOSED']) {
    prState(rc1, state);
    assert.equal(run('v0.2.0-rc.1'), undefined);
    assert.equal(head(rc1), rc1Head);
  }
  // A branch left without a pull request (e.g. `gh pr create` failed) is reused and gets one.
  rmSync(join(states, rc1.replaceAll('/', '_')));
  assert.equal(run('v0.2.0-rc.1'), rc1);
  assert.equal(head(rc1), rc1Head);
  // The next RC restores the same development version but still gets its own branch and pull request.
  prState(rc1, 'MERGED');
  release('0.2.0-rc.2');
  const rc2 = 'chore/next-dev-after-v0.2.0-rc.2';
  assert.equal(run('v0.2.0-rc.2'), rc2);
  assert.equal(version(rc2), '0.2.0-dev.0');
  // A stable release restores the next patch.
  release('0.2.0');
  assert.equal(run('v0.2.0'), 'chore/next-dev-after-v0.2.0');
  assert.equal(version('chore/next-dev-after-v0.2.0'), '0.2.1-dev.0');
  // A main that is no longer at the released version is left alone.
  assert.equal(run('v0.2.0-rc.2'), undefined);
});
