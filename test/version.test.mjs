import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { latestStableTag, nextDevVersion, readVersion, runMode, setVersion, smokePrefix } from '../scripts/version.mjs';

function fixture(t, version = '0.2.0-dev.0') {
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
  assert.equal(pkg, pkgBefore.replace('"version": "0.2.0-dev.0"', '"version": "0.2.0-rc.1"'));
  assert.equal(lock, lockBefore.replaceAll('"version": "0.2.0-dev.0"', '"version": "0.2.0-rc.1"'));
  assert.equal(JSON.parse(lock).packages['node_modules/zod'].version, '4.6.7');
  assert.equal(setVersion(f.root, '0.2.0'), '0.2.0');
  assert.equal(setVersion(f.root, '0.2.1-dev.0'), '0.2.1-dev.0');
  assert.equal(readVersion(f.root), '0.2.1-dev.0');
});

test('set-version accepts only committed forms and refuses disagreeing sources without mutation', t => {
  const f = fixture(t);
  const before = f.snapshot();
  for (const version of ['0.2.0-dev.3', '0.2.0-dev', '0.2.0-beta.1', 'v0.2.0', '0.2.0-rc.0', '01.2.0', '0.2.0+build']) {
    assert.throws(() => setVersion(f.root, version), /Unsupported version/);
  }
  assert.deepEqual(f.snapshot(), before);
  const lock = JSON.parse(before[1]);
  lock.packages[''].version = '0.1.9-dev.0';
  writeFileSync(join(f.root, 'package-lock.json'), JSON.stringify(lock, null, 2));
  const mismatched = f.snapshot();
  assert.throws(() => readVersion(f.root), /Version sources must agree/);
  assert.throws(() => setVersion(f.root, '0.2.0'), /Version sources must agree/);
  assert.deepEqual(f.snapshot(), mismatched);
});

test('next-dev follows an RC with the same version and a stable release with the next patch', () => {
  assert.equal(nextDevVersion('0.2.0-rc.2'), '0.2.0-dev.0');
  assert.equal(nextDevVersion('0.2.0'), '0.2.1-dev.0');
  assert.equal(nextDevVersion('1.9.9'), '1.9.10-dev.0');
  for (const bad of ['0.2.0-dev.4', '0.2.0-dev.0', 'v0.2.0', '0.2.0-rc.0']) assert.throws(() => nextDevVersion(bad));
});

test('the newest stable tag ignores RC and malformed tags and compares numerically', () => {
  assert.equal(latestStableTag(['v0.1.9', 'v0.1.10', 'v0.2.0-rc.1', 'v0.1.10-rc.3', 'release', 'v01.0.0']), 'v0.1.10');
  assert.equal(latestStableTag(['v0.2.0-rc.1']), undefined);
  assert.equal(latestStableTag([]), undefined);
});

test('the run mode follows the event and the committed version on main pushes', () => {
  const push = version => runMode({ event: 'push', ref: 'refs/heads/main', version });
  assert.equal(push('0.2.0-dev.0'), 'dev');
  assert.equal(push('0.2.0-rc.1'), 'verify');
  assert.equal(push('0.2.0'), 'verify');
  assert.throws(() => push('0.2.0-dev.3'), /-dev\.0 placeholder/);
  for (const bad of ['0.2.0-beta.1', '0.2.0-rc.0']) assert.throws(() => push(bad), /Unsupported committed version/);
  assert.equal(runMode({ event: 'release', ref: 'refs/tags/v0.2.0', version: '0.2.0' }), 'release');
  for (const [event, ref] of [['push', 'refs/heads/develop'], ['pull_request', 'refs/heads/main'], ['workflow_dispatch', 'refs/heads/main']]) {
    assert.throws(() => runMode({ event, ref, version: '0.2.0-dev.0' }), /only for main pushes/);
  }
});

test('dev builds smoke against the dev environment; verification and releases against production', () => {
  assert.equal(smokePrefix('dev'), 'LAMBDADB_DEV_');
  assert.equal(smokePrefix('verify'), 'LAMBDADB_PROD_');
  assert.equal(smokePrefix('release'), 'LAMBDADB_PROD_');
  for (const bad of ['', undefined, 'pull_request', 'DEV']) assert.throws(() => smokePrefix(bad), /Unknown run mode/);
});

test('the version CLI reports the run mode to GitHub outputs', t => {
  const f = fixture(t);
  const output = join(f.root, 'output');
  const run = (args, env = {}) => spawnSync(process.execPath, [resolve('scripts/version.mjs'), ...args],
    { cwd: f.root, encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env } });
  assert.equal(run(['get']).stdout, '0.2.0-dev.0\n');
  assert.equal(run(['mode'], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' }).status, 0);
  assert.equal(readFileSync(output, 'utf8'), 'mode=dev\nsmoke_prefix=LAMBDADB_DEV_\n');
  assert.notEqual(run(['mode'], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/develop' }).status, 0);
  assert.equal(run(['set', '0.2.0-rc.1']).stdout, '0.2.0-rc.1\n');
  assert.equal(run(['next-dev', '0.2.0']).stdout, '0.2.1-dev.0\n');
  for (const args of [[], ['set'], ['set', '0.2.0-dev.7'], ['unknown']]) assert.notEqual(run(args).status, 0);
  assert.equal(readVersion(f.root), '0.2.0-rc.1');
});
