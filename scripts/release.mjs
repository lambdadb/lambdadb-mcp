import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkMetadata } from './check-release.mjs';
import { git, output, publishPackage } from './dev-release.mjs';

try {
  const command = process.argv[2];
  if (process.argv.length !== 3 || !['prepare', 'publish', 'verify'].includes(command)) throw new Error('Usage: node scripts/release.mjs prepare|publish|verify');
  // verify: a release pull request merged into main is checked like a release, without publication.
  const verify = command === 'verify';
  if (process.env.GITHUB_REPOSITORY !== 'lambdadb/lambdadb-mcp') throw new Error('Release checks require this repository.');
  if (verify && (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/main')) throw new Error('Release verification requires this repository’s main push.');
  if (!verify && process.env.GITHUB_EVENT_NAME !== 'release') throw new Error('Explicit publication requires this repository’s GitHub Release event.');
  if (!verify && !['true', 'false'].includes(process.env.RELEASE_PRERELEASE)) throw new Error('RELEASE_PRERELEASE must be true or false.');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const tag = verify ? `v${pkg.version}` : process.env.RELEASE_TAG;
  const prerelease = verify ? checkMetadata(pkg, lock).channel !== 'latest' : process.env.RELEASE_PRERELEASE === 'true';
  const { channel } = checkMetadata(pkg, lock, { tag, prerelease });
  if (channel === 'dev') throw new Error('Development versions publish automatically from main pushes, not GitHub Releases.');
  if (!readFileSync('CHANGELOG.md', 'utf8').includes(`## [${pkg.version}] - `)) throw new Error('Add a dated changelog entry for the release version.');
  const sha = git('rev-parse', 'HEAD');
  if (sha !== process.env.GITHUB_SHA) throw new Error('Checkout must match the triggering release commit.');
  if (!verify && sha !== git('rev-parse', '--verify', `refs/tags/${process.env.RELEASE_TAG}^{commit}`)) throw new Error('Checkout must match the release tag.');
  git('merge-base', '--is-ancestor', sha, 'origin/main');
  if (verify) {
    output('channel', channel);
  } else if (command === 'prepare') {
    pkg.gitHead = sha;
    writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    output('channel', channel);
  } else {
    if (pkg.gitHead !== sha) throw new Error('Release metadata must identify this source commit.');
    const tarball = process.env.MCP_TARBALL;
    const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    // Explicit releases use the same artifact identity and bounded registry reads as dev.
    output('result', await publishPackage({ name: pkg.name, version: pkg.version, sha, integrity, tarball, channel }, { head: () => sha }));
  }
} catch (error) {
  if (error.code === 'REGISTRY_VERIFICATION_PENDING') output('result', 'published-verification-pending');
  console.error(error.message);
  process.exitCode = 1;
}
