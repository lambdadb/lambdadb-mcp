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
  assert.match(run({ RELEASE_TAG: 'v1.1.0-dev.1' }).stderr, /Development versions require/);
});
