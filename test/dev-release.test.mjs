import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { developmentVersion, compareDevelopmentVersions, npmJson, publicationPlan, publishPackage } from '../scripts/dev-release.mjs';

const name = '@functional-systems/lambdadb-mcp';
const version = '0.1.0-dev.12';
const sha = 'a'.repeat(40);
const integrity = 'sha512-test-artifact';
const artifact = { name, version, sha, integrity, tarball: '/tmp/tested-package.tgz' };
const manifest = { name, version, gitHead: sha, dist: { integrity } };
const state = { version, sha, integrity, branchHead: sha, taggedVersion: '0.1.0-dev.11' };

test('development numbering replaces the dev.0 placeholder, guards regressions and compares numerically', () => {
  assert.equal(developmentVersion('0.1.0-dev.0', '12'), version);
  assert.equal(developmentVersion('0.1.0-dev.0', '12', 'v0.0.9'), version);
  assert.equal(developmentVersion('0.2.0-dev.0', '13', 'v0.1.5'), '0.2.0-dev.13');
  for (const bad of ['0.1.0', '0.1.0-rc.1', '0.1.0-dev.01', '0.1.0-dev.1', version]) {
    assert.throws(() => developmentVersion(bad, 12), /committed X\.Y\.Z-dev\.0/);
  }
  for (const bad of ['0', '-1', '01', '1.5', 'NaN']) assert.throws(() => developmentVersion('0.1.0-dev.0', bad));
  for (const tag of ['v0.1.0', 'v0.1.1', 'v1.0.0']) {
    assert.throws(() => developmentVersion('0.1.0-dev.0', 12, tag), /must be newer than the latest stable release/);
  }
  assert.equal(compareDevelopmentVersions('0.1.0-dev.10', '0.1.0-dev.2'), 1);
  assert.equal(compareDevelopmentVersions('0.2.0-dev.1', '0.1.0-dev.999'), 1);
  assert.equal(compareDevelopmentVersions(version, version), 0);
  assert.throws(() => compareDevelopmentVersions('0.1.0', version));
});

test('only a structured npm E404 can be treated as an unpublished version', () => {
  const run = (status, value) => () => ({ status, stdout: JSON.stringify(value) });
  assert.equal(npmJson([], { allowMissing: true, run: run(1, { error: { code: 'E404' } }) }), undefined);
  assert.throws(() => npmJson([], { run: run(1, { error: { code: 'E404' } }) }));
  for (const code of ['E401', 'E403', 'E500', 'ENOTFOUND']) {
    assert.throws(() => npmJson([], { allowMissing: true, run: run(1, { error: { code } }) }));
  }
  assert.throws(() => npmJson([], { run: () => ({ status: 1, stdout: 'timeout' }) }));
  for (const bad of [null, [], 'unexpected', { error: { code: 'E404' } }]) {
    assert.throws(() => npmJson([], { run: run(0, bad) }));
  }
});

test('stale jobs cannot publish or move dev backward, and reruns verify commit and artifact', () => {
  assert.equal(publicationPlan({ ...state, branchHead: 'b'.repeat(40) }), 'stale');
  assert.equal(publicationPlan({ ...state, taggedVersion: '0.2.0-dev.1' }), 'superseded');
  assert.equal(publicationPlan(state), 'publish');
  assert.equal(publicationPlan({ ...state, existing: manifest, taggedVersion: version }), 'already-published');
  for (const different of [{ gitHead: 'b'.repeat(40) }, { dist: { integrity: 'different' } }, { version: '0.1.0-dev.1' }, { name: 'other' }]) {
    assert.throws(() => publicationPlan({ ...state, taggedVersion: version, existing: { ...manifest, ...different } }), /differs/);
  }
  assert.throws(() => publicationPlan({ ...state, taggedVersion: version }), /disagreement/);
  assert.throws(() => publicationPlan({ ...state, existing: manifest }), /points elsewhere/);
  // The same version from another commit fails even when the dev tag has moved past it.
  assert.throws(() => publicationPlan({ ...state, taggedVersion: '0.2.0-dev.1', existing: { ...manifest, gitHead: 'b'.repeat(40) } }), /differs/);
});

function registry({ publishFailure = false, lag = false, manifestDelayMs = 0, tagDelayMs = 0 } = {}) {
  let published = false;
  let elapsed = 0;
  const calls = [];
  const pauses = [], reports = [], timeouts = [];
  const run = (args, options) => {
    calls.push(args);
    timeouts.push(options?.timeoutMs);
    if (args[0] === 'publish') {
      published = true;
      return { status: publishFailure ? 1 : 0, stdout: '' };
    }
    const visible = published && !lag;
    if (args[2] === 'dist-tags') return { status: 0, stdout: JSON.stringify({ dev: visible && elapsed >= tagDelayMs ? version : '0.1.0-dev.11', latest: '0.0.1' }) };
    return visible && elapsed >= manifestDelayMs
      ? { status: 0, stdout: JSON.stringify(manifest) }
      : { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) };
  };
  return { calls, run, timeouts, pauses, reports, head: () => sha, now: () => elapsed,
    advance: ms => { elapsed += ms; },
    pause: async ms => { pauses.push(ms); elapsed += ms; },
    report: message => reports.push(message),
  };
}

test('publishes the tested artifact once on dev and skips an identical rerun', async () => {
  const api = registry();
  assert.equal(await publishPackage(artifact, api), 'published');
  assert.equal(await publishPackage(artifact, api), 'already-published');
  assert.deepEqual(api.calls[0], ['view', `${name}@dev`, 'dist-tags', '--json'], 'Lookup must not require a latest release.');
  assert.deepEqual(api.calls.filter(args => args[0] === 'publish'), [
    ['publish', artifact.tarball, '--access', 'public', '--tag', 'dev', '--provenance'],
  ]);
});

test('publish failures and verification lag never retry the registry write', async () => {
  for (const options of [{ publishFailure: true }, { lag: true }]) {
    const api = registry(options);
    await assert.rejects(publishPackage(artifact, api));
    assert.equal(api.calls.filter(args => args[0] === 'publish').length, 1);
  }
  const stale = registry();
  stale.head = () => 'b'.repeat(40);
  assert.equal(await publishPackage(artifact, stale), 'stale');
  assert.equal(stale.calls.filter(args => args[0] === 'publish').length, 0);
  const missingPackage = registry();
  missingPackage.run = () => ({ status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) });
  await assert.rejects(publishPackage(artifact, missingPackage), /lookup failed/);
});

test('publication verification tolerates independently delayed metadata and dev tags beyond 25 seconds', async () => {
  for (const options of [{ manifestDelayMs: 150000 }, { tagDelayMs: 180000 }]) {
    const api = registry(options);
    assert.equal(await publishPackage(artifact, api), 'published');
    assert.ok(api.now() >= 150000);
    assert.equal(api.calls.filter(args => args[0] === 'publish').length, 1);
    const reads = api.calls.slice(3);
    assert.ok(reads.every(args => args.includes('--prefer-online') && args.includes('--fetch-retries=0') && args.includes('--fetch-timeout=15000')));
    assert.match(api.reports[0], /npm publish succeeded/);
  }
});

test('publication verification distinguishes five-minute propagation timeout from a failed write', async () => {
  const api = registry({ lag: true });
  await assert.rejects(publishPackage(artifact, api), error => {
    assert.equal(error.code, 'REGISTRY_VERIFICATION_PENDING');
    assert.match(error.message, /npm publish succeeded.*pending after 300 seconds/);
    return true;
  });
  assert.equal(api.now(), 300000);
  assert.equal(api.pauses.length, 30);
  assert.equal(api.calls.filter(args => args[0] === 'publish').length, 1);
});

test('publication verification includes read time, caps remaining I/O and sleep, and rejects a late success', async () => {
  const api = registry({ lag: true });
  const run = api.run;
  api.run = (args, options) => {
    const result = run(args, options);
    if (args.includes('--prefer-online')) api.advance(args[2] === 'dist-tags' ? 1000 : 294000);
    return result;
  };
  await assert.rejects(publishPackage(artifact, api), { code: 'REGISTRY_VERIFICATION_PENDING' });
  assert.equal(api.now(), 300000);
  assert.deepEqual(api.pauses, [5000]);
  assert.equal(api.timeouts.at(-1), 6000);
  assert.ok(api.calls.at(-1).includes('--fetch-timeout=6000'));

  const late = registry();
  const lateRun = late.run;
  late.run = (args, options) => {
    const result = lateRun(args, options);
    if (args.includes('--prefer-online')) late.advance(300000);
    return result;
  };
  await assert.rejects(publishPackage(artifact, late), { code: 'REGISTRY_VERIFICATION_PENDING' });
  assert.equal(late.calls.length, 4, 'A late manifest must not start a tag lookup.');
  assert.deepEqual(late.pauses, []);
});

test('only post-publication reads retry transient registry and subprocess failures', async () => {
  for (const failure of [
    { status: 1, stdout: JSON.stringify({ error: { code: 'E503' } }) },
    { status: 1, stdout: JSON.stringify({ error: { code: 'E429' } }) },
    { status: 1, stdout: JSON.stringify({ error: { code: 'ECONNRESET' } }) },
    { status: null, stdout: '', error: { code: 'ETIMEDOUT' } },
  ]) {
    const api = registry();
    const run = api.run;
    let failures = 0;
    api.run = (args, options) => {
      const result = run(args, options);
      if (args.includes('--prefer-online') && failures++ === 0) return failure;
      return result;
    };
    assert.equal(await publishPackage(artifact, api), 'published');
    assert.equal(api.now(), 10000);
    assert.equal(api.calls.filter(args => args[0] === 'publish').length, 1);
    const before = registry();
    before.run = args => { before.calls.push(args); return failure; };
    await assert.rejects(publishPackage(artifact, before), /lookup failed/);
    assert.equal(before.calls.filter(args => args[0] === 'publish').length, 0);
  }
});

test('post-publication authentication, schema and artifact failures remain fatal', async () => {
  for (const failure of [
    { status: 1, stdout: JSON.stringify({ error: { code: 'E401' } }) },
    { status: 1, stdout: JSON.stringify({ error: { code: 'E403' } }) },
    { status: 0, stdout: 'invalid JSON' },
    { status: 0, stdout: '[]' },
    { status: 0, stdout: JSON.stringify({ ...manifest, gitHead: 'other-commit' }) },
    { status: 0, stdout: JSON.stringify({ ...manifest, dist: { integrity: 'different' } }) },
  ]) {
    const api = registry({ tagDelayMs: 100000 });
    const run = api.run;
    api.run = (args, options) => {
      const result = run(args, options);
      return args.includes('--prefer-online') ? failure : result;
    };
    await assert.rejects(publishPackage(artifact, api), /npm publish succeeded, but registry verification failed/);
    assert.deepEqual(api.pauses, []);
    assert.equal(api.calls.filter(args => args[0] === 'publish').length, 1);
  }
  for (const dev of [123, 'not-a-development-version']) {
    const api = registry();
    const run = api.run;
    api.run = (args, options) => {
      const result = run(args, options);
      return args.includes('--prefer-online') && args[2] === 'dist-tags'
        ? { status: 0, stdout: JSON.stringify({ dev }) } : result;
    };
    await assert.rejects(publishPackage(artifact, api), /verification failed/);
    assert.deepEqual(api.pauses, []);
  }
});

test('missing post-publication tag metadata is retried without treating preflight as optional', async () => {
  const api = registry();
  const run = api.run;
  let missing = true;
  api.run = (args, options) => {
    const result = run(args, options);
    if (missing && args.includes('--prefer-online') && args[2] === 'dist-tags') {
      missing = false;
      return { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) };
    }
    return result;
  };
  assert.equal(await publishPackage(artifact, api), 'published');
  assert.deepEqual(api.pauses, [10000]);
  assert.equal(api.calls.filter(args => args[0] === 'publish').length, 1);
});

test('preparation counts first-parent commits since the newest stable tag on main and rejects stale or untrusted runs', t => {
  const temp = mkdtempSync(join(tmpdir(), 'mcp-dev-release-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const remote = join(temp, 'remote.git'), repo = join(temp, 'repo');
  const runGit = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  runGit(temp, 'init', '--bare', remote);
  runGit(temp, 'clone', remote, repo);
  runGit(repo, 'checkout', '-b', 'main');
  runGit(repo, 'config', 'user.name', 'Release test');
  runGit(repo, 'config', 'user.email', 'test@example.invalid');
  const source = JSON.parse(readFileSync('package.json', 'utf8'));
  const commit = (version, message) => {
    if (version) {
      writeFileSync(join(repo, 'package.json'), JSON.stringify({ ...source, version }));
      writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({ name: source.name, version, packages: { '': { name: source.name, version } } }));
    }
    runGit(repo, 'add', '.');
    runGit(repo, 'commit', '--allow-empty', '-m', message);
    runGit(repo, 'push', '-q', 'origin', 'main');
    return runGit(repo, 'rev-parse', 'HEAD');
  };
  const script = resolve('scripts/dev-release.mjs');
  const env = { ...process.env, GITHUB_REPOSITORY: 'lambdadb/lambdadb-mcp', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_OUTPUT: join(temp, 'output') };
  const prepare = (sha, overrides) => execFileSync(process.execPath, [script, 'prepare'], { cwd: repo, env: { ...env, GITHUB_SHA: sha, ...overrides }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const reset = () => runGit(repo, 'checkout', '-q', '--', 'package.json', 'package-lock.json');
  const prepared = () => JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));

  // Without a stable tag the count starts at the root commit.
  commit('0.1.0-dev.0', 'initial');
  let head = commit(undefined, 'second');
  assert.throws(() => prepare(head, { GITHUB_EVENT_NAME: 'pull_request' }));
  assert.throws(() => prepare(head, { GITHUB_REF: 'refs/heads/develop' }));
  assert.throws(() => prepare('b'.repeat(40)));
  assert.match(prepare(head), /version=0\.1\.0-dev\.2\nready=true/);
  const lock = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8'));
  assert.equal(prepared().gitHead, head);
  assert.equal(lock.version, '0.1.0-dev.2');
  assert.equal(lock.packages[''].version, '0.1.0-dev.2');
  assert.equal(runGit(repo, 'rev-parse', 'HEAD'), head, 'preparation must not create commits');
  reset();
  assert.match(prepare(head), /version=0\.1\.0-dev\.2\n/, 'the same commit maps to the same version');
  reset();

  // A stable tag resets the count; RC tags do not. Merge commits count once on the first-parent path.
  commit('0.1.0', 'release 0.1.0');
  runGit(repo, 'tag', 'v0.1.0');
  head = commit('0.1.0-dev.0', 'forgot the next version');
  assert.throws(() => prepare(head), /must be newer than the latest stable release v0\.1\.0/);
  commit('0.1.1-dev.0', 'next development version');
  runGit(repo, 'checkout', '-q', '-b', 'feature');
  commit(undefined, 'feature one');
  commit(undefined, 'feature two');
  runGit(repo, 'checkout', '-q', 'main');
  runGit(repo, 'merge', '--no-ff', '-q', '-m', 'merge feature', 'feature');
  runGit(repo, 'push', '-q', 'origin', 'main');
  assert.match(prepare(runGit(repo, 'rev-parse', 'HEAD')), /version=0\.1\.1-dev\.3\n/);
  reset();
  commit('0.1.1-rc.1', 'release 0.1.1-rc.1');
  runGit(repo, 'tag', 'v0.1.1-rc.1');
  assert.throws(() => prepare(runGit(repo, 'rev-parse', 'HEAD')), /require a committed X\.Y\.Z-dev\.0/);
  head = commit('0.1.1-dev.0', 'back to development');
  assert.match(prepare(head), /version=0\.1\.1-dev\.5\n/);
  reset();

  // A superseded commit reports not ready and leaves the checkout untouched.
  commit(undefined, 'newer main head');
  runGit(repo, 'checkout', '-q', '--detach', head);
  const before = readFileSync(join(repo, 'package.json'), 'utf8');
  assert.match(prepare(head), /ready=false/);
  assert.equal(readFileSync(join(repo, 'package.json'), 'utf8'), before);
});
