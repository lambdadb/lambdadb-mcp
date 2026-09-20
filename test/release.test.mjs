import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkMetadata } from '../scripts/check-release.mjs';
import { compareVersions, publicationPlan, publishPackage } from '../scripts/dev-release.mjs';

function fixture(version) {
  const pkg = { name: '@functional-systems/lambdadb-mcp', version, private: false, license: 'Apache-2.0', repository: { url: 'git+https://github.com/lambdadb/lambdadb-mcp.git' } };
  const lock = { name: pkg.name, version, packages: { '': { name: pkg.name, version } } };
  return { pkg, lock };
}

test('release validation maps canonical stable, dev and rc versions to separate channels', () => {
  for (const [version, channel] of [['1.2.3', 'latest'], ['0.1.0-dev.0', 'dev'], ['0.1.0-rc.2', 'rc']]) {
    const { pkg, lock } = fixture(version);
    assert.deepEqual(checkMetadata(pkg, lock, { tag: `v${version}`, prerelease: channel !== 'latest' }), { version, channel });
  }
});

test('release validation blocks drift, malformed versions, wrong tags, prerelease promotion and unprepared publication', () => {
  for (const version of ['01.2.3', '1.2', '1.2.3-beta.1', '1.2.3-dev.01', '1.2.3+build']) {
    const { pkg, lock } = fixture(version);
    assert.throws(() => checkMetadata(pkg, lock), /Version/);
  }
  for (const mutate of [
    f => { f.lock.version = '1.2.4'; },
    f => { f.lock.packages[''].version = '1.2.4'; },
    f => { f.pkg.repository.url = 'git+https://github.com/lambdadb/other.git'; },
    f => { f.pkg.private = true; },
    f => { delete f.pkg.license; },
  ]) {
    const f = fixture('1.2.3');
    mutate(f);
    assert.throws(() => checkMetadata(f.pkg, f.lock, { tag: 'v1.2.3', prerelease: false }));
  }
  const { pkg, lock } = fixture('1.2.3-rc.1');
  assert.throws(() => checkMetadata(pkg, lock, { tag: 'v1.2.3-rc.1', prerelease: false }), /prerelease/);
  assert.throws(() => checkMetadata(pkg, lock, { tag: 'v1.2.3', prerelease: true }), /tag/);
  pkg.private = true;
  assert.equal(checkMetadata(pkg, lock).channel, 'rc', 'private development remains valid');
});

for (const [version, channel, previous] of [['1.2.3-rc.2', 'rc', '1.2.3-rc.1'], ['1.2.3', 'latest', '1.2.3-dev.1']]) {
  test(`${channel} publishes the exact artifact once, tolerates independent propagation and skips reruns`, async () => {
    const name = '@functional-systems/lambdadb-mcp', sha = 'a'.repeat(40), integrity = 'sha512-tested';
    const manifest = { name, version, gitHead: sha, dist: { integrity } };
    let published = false, time = 0;
    const calls = [];
    const run = args => {
      calls.push(args);
      if (args[0] === 'publish') { published = true; return { status: 0 }; }
      if (args[2] === 'dist-tags') return { status: 0, stdout: JSON.stringify({ [channel]: published && time >= 180000 ? version : previous }) };
      return published && time >= 60000 ? { status: 0, stdout: JSON.stringify(manifest) }
        : { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) };
    };
    const artifact = { name, version, channel, sha, integrity, tarball: '/tmp/tested-release.tgz' };
    const api = { run, head: () => sha, now: () => time, pause: async ms => { time += ms; }, report: () => {} };
    assert.equal(await publishPackage(artifact, api), 'published');
    assert.equal(await publishPackage(artifact, api), 'already-published');
    assert.deepEqual(calls.filter(args => args[0] === 'publish'), [
      ['publish', artifact.tarball, '--access', 'public', '--tag', channel, '--provenance'],
    ]);
    await assert.rejects(publishPackage({ ...artifact, channel: 'dev' }, api), /disagree/);
    assert.equal(publicationPlan({ version, channel, sha, integrity, branchHead: sha, taggedVersion: '9.0.0' }), 'superseded');
    assert.throws(() => publicationPlan({ version, channel, sha, integrity, branchHead: sha, taggedVersion: version, existing: { ...manifest, gitHead: 'wrong' } }), /differs/);
  });
}

test('release ordering compares numbers and promotes dev to rc to stable', () => {
  for (const [a, b] of [['1.2.3', '1.2.3-rc.10'], ['1.2.3-rc.1', '1.2.3-dev.100'], ['1.2.3-rc.10', '1.2.3-rc.2'], ['2.0.0-dev.1', '1.99.99']]) {
    assert.equal(compareVersions(a, b), 1);
    assert.equal(compareVersions(b, a), -1);
  }
});
