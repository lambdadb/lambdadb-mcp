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

test('the next development version workflow runs only after a successful release publication', () => {
  assert.match(nextDevWorkflow, /workflow_run:\n\s+workflows: \["CI"\]\n\s+types: \[completed\]/);
  assert.match(workflow, /^(?:#.*\n)*name: CI\n/);
  assert.ok(nextDevWorkflow.includes(
    "github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'release'"));
  assert.match(nextDevWorkflow, /node scripts\/version\.mjs next-dev "\$RELEASED"/);
  assert.match(nextDevWorkflow, /node scripts\/version\.mjs set "\$NEXT"/);
  assert.match(nextDevWorkflow, /gh pr create --base main/);
  assert.match(nextDevWorkflow, /ref: main\n\s+fetch-depth: 0\n/);
  assert.doesNotMatch(nextDevWorkflow, /npm publish|id-token/);
});

test('the next development version step is rerun-safe and recreates partial or stale branches', t => {
  const script = nextDevWorkflow.match(/run: \|\n([\s\S]*)$/)[1].replace(/^ {10}/gm, '');
  const temp = mkdtempSync(join(tmpdir(), 'mcp-next-dev-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const remote = join(temp, 'remote.git'), seed = join(temp, 'seed'), bin = join(temp, 'bin');
  const gitEnv = { ...process.env, GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/dev/null' };
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Release test', '-c', 'user.email=test@example.invalid', ...args],
    { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // gh stub: `pr list` prints the number of open pull requests; `pr create` is logged.
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nif [ "$2" = list ]; then echo "$OPEN_PRS"; exit 0; fi\necho "$@" >> "$GH_LOG"\n');
  chmodSync(join(bin, 'gh'), 0o755);
  git(temp, 'init', '-q', '--bare', remote);
  git(temp, 'init', '-q', '-b', 'main', seed);
  mkdirSync(join(seed, 'scripts'));
  copyFileSync(new URL('../scripts/version.mjs', import.meta.url), join(seed, 'scripts/version.mjs'));
  const setVersion = (cwd, version) => {
    writeFileSync(join(cwd, 'package.json'), `{\n  "name": "pkg",\n  "version": "${version}"\n}\n`);
    writeFileSync(join(cwd, 'package-lock.json'), `{\n  "name": "pkg",\n  "version": "${version}",\n  "packages": {\n    "": {\n      "version": "${version}"\n    }\n  }\n}\n`);
  };
  setVersion(seed, '0.2.0');
  git(seed, 'add', '.'); git(seed, 'commit', '-q', '-m', 'release 0.2.0');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', '-q', 'origin', 'main');
  const branch = 'refs/heads/chore/next-dev-0.2.1-dev.0';
  const run = (openPrs, tag = 'v0.2.0') => {
    const checkout = join(temp, `checkout-${Math.random().toString(16).slice(2)}`);
    git(temp, 'clone', '-q', '-b', 'main', remote, checkout);
    const log = join(temp, 'gh.log');
    rmSync(log, { force: true });
    const result = spawnSync('bash', ['-e', '-c', script], { cwd: checkout, encoding: 'utf8', env: {
      ...gitEnv, PATH: `${bin}:${process.env.PATH}`, RELEASE_TAG: tag, OPEN_PRS: String(openPrs), GH_LOG: log,
    } });
    assert.equal(result.status, 0, result.stderr);
    return { skipped: /nothing to do/.test(result.stdout), created: existsSync(log) && /^pr create --base main --head chore\/next-dev-0\.2\.1-dev\.0 /.test(readFileSync(log, 'utf8')),
      head: spawnSync('git', ['rev-parse', '--verify', '-q', branch], { cwd: remote, encoding: 'utf8' }).stdout.trim() };
  };
  const branchVersion = () => JSON.parse(git(remote, 'show', `${branch}:package.json`)).version;

  // First run creates the branch and the pull request.
  let state = run(0);
  assert.equal(state.created, true);
  assert.equal(branchVersion(), '0.2.1-dev.0');
  const first = state.head;
  // A rerun with the pull request open on a branch that contains main does nothing.
  assert.deepEqual(run(1), { skipped: true, created: false, head: first });
  // A branch left without a pull request (e.g. `gh pr create` failed) is recreated and gets one.
  state = run(0);
  assert.equal(state.skipped, false);
  assert.equal(state.created, true);
  assert.equal(git(remote, 'rev-parse', `${branch}^`), git(remote, 'rev-parse', 'main'));
  // An open pull request whose branch no longer contains main is refreshed without a duplicate.
  git(seed, 'commit', '-q', '--allow-empty', '-m', 'newer main');
  git(seed, 'push', '-q', 'origin', 'main');
  state = run(1);
  assert.equal(state.skipped, false);
  assert.equal(state.created, false);
  assert.equal(git(remote, 'rev-parse', `${branch}^`), git(remote, 'rev-parse', 'main'));
  assert.equal(branchVersion(), '0.2.1-dev.0');
  // A main that has moved past the released version is left alone.
  const head = state.head;
  assert.deepEqual(run(0, 'v0.1.9'), { skipped: true, created: false, head });
});
