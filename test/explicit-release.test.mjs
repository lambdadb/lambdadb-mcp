import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('explicit release preflight rejects untrusted events, wrong metadata, missing notes and commits outside main', t => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release test'); git('config', 'user.email', 'test@example.invalid');
  const source = JSON.parse(readFileSync('package.json', 'utf8'));
  const metadata = version => {
    const pkg = { ...source, version };
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: pkg.name, version, packages: { '': { name: pkg.name, version } } }));
    writeFileSync(join(root, 'CHANGELOG.md'), `## [${version}] - 2026-09-19\n`);
  };
  metadata('1.0.0-rc.1');
  git('add', '.'); git('commit', '-m', 'release');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD'); git('tag', 'v1.0.0-rc.1');
  const script = resolve('scripts/release.mjs');
  const env = { PATH: process.env.PATH, GITHUB_REPOSITORY: 'lambdadb/lambdadb-mcp', GITHUB_EVENT_NAME: 'release', GITHUB_SHA: git('rev-parse', 'HEAD'), RELEASE_TAG: 'v1.0.0-rc.1', RELEASE_PRERELEASE: 'true' };
  const run = overrides => spawnSync(process.execPath, [script, 'prepare'], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' });
  assert.equal(run().status, 0);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).gitHead, git('rev-parse', 'HEAD'));
  for (const overrides of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_SHA: 'b'.repeat(40) }, { GITHUB_REPOSITORY: 'fork/repo' }, { RELEASE_TAG: 'v1.0.0' }, { RELEASE_PRERELEASE: 'false' }]) assert.notEqual(run(overrides).status, 0);
  writeFileSync(join(root, 'CHANGELOG.md'), '# Unreleased\n');
  assert.match(run().stderr, /dated changelog/);
  metadata('1.0.0'); git('add', '.'); git('commit', '-m', 'outside main'); git('tag', 'v1.0.0');
  env.GITHUB_SHA = git('rev-parse', 'HEAD');
  assert.notEqual(run({ RELEASE_TAG: 'v1.0.0', RELEASE_PRERELEASE: 'false' }).status, 0);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.equal(run({ RELEASE_TAG: 'v1.0.0', RELEASE_PRERELEASE: 'false' }).status, 0);
  metadata('1.1.0-dev.1');
  assert.match(run({ RELEASE_TAG: 'v1.1.0-dev.1' }).stderr, /publish automatically from main pushes/);
});

test('release verification checks a committed RC/stable version on a main push without publication', t => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-verify-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release test'); git('config', 'user.email', 'test@example.invalid');
  const source = JSON.parse(readFileSync('package.json', 'utf8'));
  const commit = (version, changelog = `## [${version}] - 2026-10-29\n`) => {
    const pkg = { ...source, version };
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: pkg.name, version, packages: { '': { name: pkg.name, version } } }));
    writeFileSync(join(root, 'CHANGELOG.md'), changelog);
    git('add', '.'); git('commit', '-m', version);
    return git('rev-parse', 'HEAD');
  };
  const script = resolve('scripts/release.mjs');
  const env = { PATH: process.env.PATH, GITHUB_REPOSITORY: 'lambdadb/lambdadb-mcp', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_OUTPUT: join(root, '.output') };
  const verify = (sha, overrides) => spawnSync(process.execPath, [script, 'verify'], { cwd: root, env: { ...env, GITHUB_SHA: sha, ...overrides }, encoding: 'utf8' });
  for (const [version, channel] of [['1.0.0-rc.1', 'rc'], ['1.0.0', 'latest']]) {
    const sha = commit(version);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const before = readFileSync(join(root, 'package.json'), 'utf8');
    const result = verify(sha);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`channel=${channel}`));
    assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), before, 'verification never prepares publication metadata');
    for (const overrides of [{ GITHUB_EVENT_NAME: 'release' }, { GITHUB_REF: 'refs/heads/develop' }, { GITHUB_SHA: 'b'.repeat(40) }, { GITHUB_REPOSITORY: 'fork/repo' }]) {
      assert.notEqual(verify(sha, overrides).status, 0);
    }
  }
  let sha = commit('1.0.1', '# Unreleased\n');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.match(verify(sha).stderr, /dated changelog/);
  sha = commit('1.1.0-dev.0');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.match(verify(sha).stderr, /publish automatically from main pushes/);
  git('checkout', '-q', '-b', 'feature');
  sha = commit('1.1.0');
  assert.notEqual(verify(sha).status, 0, 'a commit outside origin/main fails');
});
