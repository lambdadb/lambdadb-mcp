import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { latestStableTag, readVersion, remoteTagExists, runMode, setVersion, smokePrefix } from '../scripts/version.mjs';

function fixture(t, version = '0.1.5') {
  const root = mkdtempSync(join(tmpdir(), 'mcp-version-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const name = '@functional-systems/lambdadb-mcp';
  writeFileSync(join(root, 'package.json'),
    `{\n  "name": "${name}",\n  "version": "${version}",\n  "dependencies": {\n    "zod": "^4.6.7"\n  }\n}\n`);
  // A dependency entry with a "version" field must stay untouched; formatting is preserved.
  writeFileSync(join(root, 'package-lock.json'), `{\n  "name": "${name}",\n  "version": "${version}",\n  "lockfileVersion": 3,\n` +
    `  "packages": {\n    "": {\n      "name": "${name}",\n      "version": "${version}"\n    },\n` +
    `    "node_modules/zod": {\n      "version": "4.6.7"\n    }\n  }\n}\n`);
  const snapshot = () => ['package.json', 'package-lock.json'].map(path => readFileSync(join(root, path), 'utf8'));
  return { root, snapshot };
}

test('set-version updates package.json and both root lockfile entries, preserving formatting', t => {
  const f = fixture(t);
  const [pkgBefore, lockBefore] = f.snapshot();
  assert.equal(setVersion(f.root, '0.2.0-rc.1'), '0.2.0-rc.1');
  const [pkg, lock] = f.snapshot();
  assert.equal(pkg, pkgBefore.replace('"version": "0.1.5"', '"version": "0.2.0-rc.1"'));
  assert.equal(lock, lockBefore.replaceAll('"version": "0.1.5"', '"version": "0.2.0-rc.1"'));
  assert.equal(JSON.parse(lock).packages['node_modules/zod'].version, '4.6.7');
  assert.equal(setVersion(f.root, '0.2.0'), '0.2.0');
  assert.equal(readVersion(f.root), '0.2.0');
});

test('set-version accepts only RC and stable forms and refuses disagreeing sources without mutation', t => {
  const f = fixture(t);
  const before = f.snapshot();
  for (const version of ['0.2.0-dev.0', '0.2.0-dev.3', '0.2.0-dev', '0.2.0-beta.1', 'v0.2.0', '0.2.0-rc.0', '01.2.0', '0.2.0+build']) {
    assert.throws(() => setVersion(f.root, version), /Unsupported version/);
  }
  assert.deepEqual(f.snapshot(), before);
  const lock = JSON.parse(before[1]);
  lock.packages[''].version = '0.1.4';
  writeFileSync(join(f.root, 'package-lock.json'), JSON.stringify(lock, null, 2));
  const mismatched = f.snapshot();
  assert.throws(() => readVersion(f.root), /Version sources must agree/);
  assert.throws(() => setVersion(f.root, '0.2.0'), /Version sources must agree/);
  assert.deepEqual(f.snapshot(), mismatched);
});

test('set-version moves a committed development placeholder back to the last released version', t => {
  const f = fixture(t, '0.2.0-dev.0');
  assert.equal(setVersion(f.root, '0.1.5'), '0.1.5');
  assert.equal(readVersion(f.root), '0.1.5');
});

test('the newest stable tag ignores RC and malformed tags and compares numerically', () => {
  assert.equal(latestStableTag(['v0.1.9', 'v0.1.10', 'v0.2.0-rc.1', 'v0.1.10-rc.3', 'release', 'v01.0.0']), 'v0.1.10');
  assert.equal(latestStableTag(['v0.2.0-rc.1']), undefined);
  assert.equal(latestStableTag([]), undefined);
});

test('a main push builds a development version only when the committed version is tagged', () => {
  const queried = [];
  const push = (version, tagged) => runMode({ event: 'push', ref: 'refs/heads/main', version,
    tagExists: v => { queried.push(v); return tagged; } });
  for (const version of ['0.1.5', '0.2.0-rc.1']) {
    assert.equal(push(version, true), 'dev');
    assert.equal(push(version, false), 'verify');
  }
  assert.deepEqual(queried, ['0.1.5', '0.1.5', '0.2.0-rc.1', '0.2.0-rc.1']);
  // A development form is never committed, whether or not a tag exists.
  for (const bad of ['0.2.0-dev.0', '0.2.0-dev.3', '0.2.0-beta.1', '0.2.0-rc.0']) {
    for (const tagged of [false, true]) assert.throws(() => push(bad, tagged), /must be an RC or stable version/);
  }
  const unused = () => { throw new Error('tags are queried only for main pushes'); };
  assert.equal(runMode({ event: 'release', ref: 'refs/tags/v0.2.0', version: '0.2.0', tagExists: unused }), 'release');
  for (const [event, ref] of [['push', 'refs/heads/develop'], ['pull_request', 'refs/heads/main'], ['workflow_dispatch', 'refs/heads/main']]) {
    assert.throws(() => runMode({ event, ref, version: '0.1.5', tagExists: unused }), /only for main pushes/);
  }
});

test('dev builds smoke against the dev environment; verification and releases against production', () => {
  assert.equal(smokePrefix('dev'), 'LAMBDADB_DEV_');
  assert.equal(smokePrefix('verify'), 'LAMBDADB_PROD_');
  assert.equal(smokePrefix('release'), 'LAMBDADB_PROD_');
  for (const bad of ['', undefined, 'pull_request', 'DEV']) assert.throws(() => smokePrefix(bad), /Unknown run mode/);
});

test('the version CLI selects the run mode from tags on origin and reports it to GitHub outputs', t => {
  const f = fixture(t);
  const remote = join(f.root, 'remote.git');
  const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd: f.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '--bare', remote);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Release test'); git('config', 'user.email', 'test@example.invalid');
  git('add', 'package.json', 'package-lock.json'); git('commit', '-q', '-m', 'release 0.1.5');
  git('remote', 'add', 'origin', remote);
  git('push', '-q', 'origin', 'main');
  const output = join(f.root, 'output');
  const run = (args, env = {}) => spawnSync(process.execPath, [resolve('scripts/version.mjs'), ...args],
    { cwd: f.root, encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env } });
  const mode = () => {
    rmSync(output, { force: true });
    const result = run(['mode'], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' });
    return result.status === 0 ? readFileSync(output, 'utf8') : result.stderr;
  };
  assert.equal(run(['get']).stdout, '0.1.5\n');
  // Untagged: a merged release pull request awaiting its tag is verified against production.
  assert.equal(mode(), 'mode=verify\nsmoke_prefix=LAMBDADB_PROD_\nenvironment=prod\n');
  // Only the tag on origin counts; a local tag alone does not make a development commit.
  git('tag', 'v0.1.5');
  assert.equal(remoteTagExists('0.1.5', { cwd: f.root }), false);
  assert.equal(mode(), 'mode=verify\nsmoke_prefix=LAMBDADB_PROD_\nenvironment=prod\n');
  git('push', '-q', 'origin', 'v0.1.5');
  assert.equal(remoteTagExists('0.1.5', { cwd: f.root }), true);
  assert.equal(mode(), 'mode=dev\nsmoke_prefix=LAMBDADB_DEV_\nenvironment=dev\n');
  assert.notEqual(run(['mode'], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/develop' }).status, 0);
  assert.equal(run(['set', '0.2.0-rc.1']).stdout, '0.2.0-rc.1\n');
  assert.equal(mode(), 'mode=verify\nsmoke_prefix=LAMBDADB_PROD_\nenvironment=prod\n');
  for (const args of [[], ['set'], ['set', '0.2.0-dev.7'], ['set', '0.2.1-dev.0'], ['next-dev', '0.2.0'], ['unknown']]) {
    assert.notEqual(run(args).status, 0);
  }
  assert.equal(readVersion(f.root), '0.2.0-rc.1');
  // A committed development form fails before any tag lookup; an unreachable origin fails closed.
  setVersion(f.root, '0.2.0');
  writeFileSync(join(f.root, 'package.json'), readFileSync(join(f.root, 'package.json'), 'utf8').replace('"0.2.0"', '"0.2.0-dev.0"'));
  writeFileSync(join(f.root, 'package-lock.json'), readFileSync(join(f.root, 'package-lock.json'), 'utf8').replaceAll('"version": "0.2.0"', '"version": "0.2.0-dev.0"'));
  assert.match(mode(), /must be an RC or stable version/);
  setVersion(f.root, '0.1.5');
  git('remote', 'set-url', 'origin', join(f.root, 'missing.git'));
  assert.match(mode(), /Cannot query origin for tag v0\.1\.5/);
});
