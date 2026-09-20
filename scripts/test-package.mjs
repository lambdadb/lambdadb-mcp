import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const temp = mkdtempSync(join(tmpdir(), 'lambdadb-mcp-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const tarball = process.argv[2] ? resolve(process.argv[2]) : join(temp,
    JSON.parse(execFileSync(npm, ['pack', '--json', '--pack-destination', temp], { encoding: 'utf8' }))[0].filename);
  const digest = () => createHash('sha512').update(readFileSync(tarball)).digest('base64');
  const before = digest();
  const inventory = JSON.parse(execFileSync(npm, ['pack', tarball, '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' }))[0];
  assert.equal(inventory.name, pkg.name);
  assert.equal(inventory.version, pkg.version);
  for (const required of ['dist/index.js', 'package.json', 'LICENSE', 'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'RELEASING.md']) {
    assert.ok(inventory.files.some(file => file.path === required), `Missing ${required}`);
  }
  for (const { path } of inventory.files) {
    assert.match(path, /^(?:dist\/(?:[\w-]+\/)*[\w-]+\.js|package\.json|LICENSE|README\.md|CHANGELOG\.md|CONTRIBUTING\.md|RELEASING\.md)$/, `Unexpected package file: ${path}`);
  }
  const consumer = join(temp, 'consumer');
  execFileSync(npm, ['install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', tarball], { stdio: 'inherit' });
  const installedRoot = join(consumer, 'node_modules', pkg.name);
  const installed = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
  assert.equal(installed.license, 'Apache-2.0');
  assert.equal(installed.version, pkg.version);
  assert.equal(installed.gitHead, pkg.gitHead);
  assert.deepEqual(installed.bin, { 'lambdadb-mcp': 'dist/index.js' });
  assert.match(readFileSync(join(installedRoot, 'dist/index.js'), 'utf8'), /^#!\/usr\/bin\/env node\n/);
  // An installed server must ignore ambient dotenv files, including a write opt-in.
  writeFileSync(join(consumer, '.env.local'), 'LAMBDADB_MCP_ENABLE_WRITE_TOOLS=true\nLAMBDADB_PROJECT_NAME=wrong\n');
  const bin = process.platform === 'win32' ? join(installedRoot, 'dist/index.js') : join(consumer, 'node_modules/.bin/lambdadb-mcp');
  execFileSync(process.execPath, ['--test', 'test/contract.test.mjs', 'test/stdio.test.mjs'], {
    stdio: 'inherit', env: { ...process.env, MCP_TEST_BIN: bin, MCP_TEST_ROOT: installedRoot, MCP_TEST_CWD: consumer, MCP_TEST_VERSION: pkg.version },
  });
  assert.equal(digest(), before, 'The tested publication artifact must not change');
  console.log(`Verified ${pkg.name}@${pkg.version}: ${inventory.files.length} files, sha512-${before}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
