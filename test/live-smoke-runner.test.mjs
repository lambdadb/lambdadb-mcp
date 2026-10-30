import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runLiveSmoke } from '../scripts/run-live-smoke.mjs';

const env = {
  LAMBDADB_BASE_URL: 'https://test.example', LAMBDADB_PROJECT_NAME: 'mcp-smoke',
  LAMBDADB_PROJECT_API_KEY: 'synthetic-test-key', PATH: '/bin',
};
const unexpected = () => assert.fail('Must not start the smoke');

test('the key is passed only in the test child environment with every opt-in', () => {
  const calls = [];
  runLiveSmoke({ ...env, LAMBDADB_PROJECT_API_KEY: ' synthetic-test-key\n' }, (command, args, options) => {
    calls.push([command, args]);
    assert.ok(!args.join(' ').includes('synthetic'), 'The key must not appear in arguments');
    assert.equal(options.stdio, 'inherit');
    assert.deepEqual(options.env, { ...env, LAMBDADB_ENV_FILE: '/dev/null', LAMBDADB_RUN_LIVE_TESTS: '1',
      LAMBDADB_RUN_LIVE_RERANK_TESTS: '1', LAMBDADB_MCP_ENABLE_WRITE_TOOLS: 'true',
      LAMBDADB_LIVE_CONFIRM_PROJECT: 'mcp-smoke' });
    return { status: 0 };
  });
  assert.deepEqual(calls, [['npm', ['run', 'test:live:all']]]);
});

test('missing configuration and invalid keys fail before starting the smoke', () => {
  for (const name of ['LAMBDADB_BASE_URL', 'LAMBDADB_PROJECT_NAME', 'LAMBDADB_PROJECT_API_KEY']) {
    for (const value of [undefined, '', '  ', '\n']) {
      assert.throws(() => runLiveSmoke({ ...env, [name]: value }, unexpected), { message: `Missing smoke configuration: ${name}` });
    }
  }
  for (const key of ['key\nother-key', 'key\rother-key']) {
    assert.throws(() => runLiveSmoke({ ...env, LAMBDADB_PROJECT_API_KEY: key }, unexpected), /single project API key/);
  }
});

test('live smoke failures propagate so nothing is published', () => {
  for (const result of [{ status: 1 }, { status: null, signal: 'SIGTERM' }, { error: new Error('spawn failed') }]) {
    assert.throws(() => runLiveSmoke(env, () => result), { message: 'Deployed live smoke failed' });
  }
});
