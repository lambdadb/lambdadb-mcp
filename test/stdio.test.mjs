import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const bin = process.env.MCP_TEST_BIN ?? resolve('dist/index.js');
const version = process.env.MCP_TEST_VERSION ?? JSON.parse(readFileSync('package.json', 'utf8')).version;
const configured = { LAMBDADB_BASE_URL: 'http://127.0.0.1:1', LAMBDADB_PROJECT_NAME: 'test', LAMBDADB_PROJECT_API_KEY: 'synthetic-secret' };
function start(t, env, viaNpm = false) {
  const child = spawn(viaNpm ? 'npm' : process.platform === 'win32' ? process.execPath : bin,
    viaNpm ? ['exec', '--offline', '--', 'lambdadb-mcp'] : process.platform === 'win32' ? [bin] : [], {
      cwd: process.env.MCP_TEST_CWD, env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
    });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  const closed = once(child, 'close');
  return { child, closed, output: () => ({ stdout, stderr }) };
}
for (const missing of Object.keys(configured)) {
  test(`stdio fails on missing ${missing} using only stderr`, { timeout: 10000 }, async t => {
    const env = { ...configured }; delete env[missing];
    const h = start(t, env);
    const [code] = await h.closed;
    assert.equal(code, 1);
    assert.equal(h.output().stdout, '');
    assert.match(h.output().stderr, new RegExp(`Missing required environment variable: ${missing}`));
    assert.ok(!h.output().stderr.includes('synthetic-secret'));
  });
}
test('invalid write opt-in fails closed', { timeout: 10000 }, async t => {
  const h = start(t, { ...configured, LAMBDADB_MCP_ENABLE_WRITE_TOOLS: 'invalid' });
  assert.equal((await h.closed)[0], 1);
  assert.equal(h.output().stdout, '');
  assert.match(h.output().stderr, /Invalid boolean/);
});
for (const termination of ['EOF', 'SIGTERM', 'SIGINT']) {
  test(`stdio initialize reports package version, stdout is protocol only, and ${termination} exits`, { timeout: 10000 }, async t => {
    const h = start(t, configured);
    h.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'package-test', version: '1' },
    } }) + '\n');
    // Wait for a complete response before closing the connection.
    let buffer = '';
    await new Promise((resolve, reject) => {
      h.child.once('error', reject);
      h.child.stdout.on('data', chunk => { buffer += chunk; if (buffer.includes('\n')) resolve(); });
    });
    if (termination === 'EOF') h.child.stdin.end(); else h.child.kill(termination);
    assert.equal((await h.closed)[0], 0);
    const { stdout, stderr } = h.output();
    assert.equal(stderr, '');
    const messages = stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(messages.every(message => message.jsonrpc === '2.0'));
    assert.equal(messages[0].result.serverInfo.version, version);
    assert.equal(messages[0].result.serverInfo.name, 'lambdadb-mcp');
  });
}

if (process.env.MCP_TEST_CWD) {
  test('npm exec resolves the installed bin without a source checkout or network', { timeout: 10000 }, async t => {
    const h = start(t, {}, true);
    assert.equal((await h.closed)[0], 1);
    assert.equal(h.output().stdout, '');
    assert.match(h.output().stderr, /Missing required environment variable: LAMBDADB_BASE_URL/);
  });
}
