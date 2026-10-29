import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runLiveSmoke } from '../scripts/run-live-smoke.mjs';

const env = {
  LAMBDADB_BASE_URL: 'https://test.example', LAMBDADB_PROJECT_NAME: 'mcp-smoke',
  LAMBDADB_SMOKE_SECRET_ARN: 'arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:smoke-key',
  GITHUB_ACTIONS: 'true', PATH: '/bin',
};
const readKey = (key = 'synthetic-key') => () => key;
const unexpected = () => assert.fail('Must not start the smoke');

test('the key is read through AWS, masked, and passed only to the test child environment with every opt-in', () => {
  const calls = [];
  runLiveSmoke(env, (command, args, options) => {
    calls.push('read');
    assert.equal(command, 'aws');
    assert.deepEqual(args, ['secretsmanager', 'get-secret-value', '--region', 'ap-northeast-2',
      '--secret-id', env.LAMBDADB_SMOKE_SECRET_ARN, '--query', 'SecretString', '--output', 'text']);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(options.env.LAMBDADB_PROJECT_API_KEY, undefined);
    return 'synthetic%test-key\n';
  }, (command, args, options) => {
    calls.push('test');
    assert.equal(command, 'npm');
    assert.deepEqual(args, ['run', 'test:live:all']);
    assert.ok(!args.join(' ').includes('synthetic'), 'The key must not appear in arguments');
    assert.equal(options.stdio, 'inherit');
    assert.deepEqual(options.env, { ...env, LAMBDADB_ENV_FILE: '/dev/null', LAMBDADB_RUN_LIVE_TESTS: '1',
      LAMBDADB_RUN_LIVE_RERANK_TESTS: '1', LAMBDADB_MCP_ENABLE_WRITE_TOOLS: 'true',
      LAMBDADB_LIVE_CONFIRM_PROJECT: 'mcp-smoke', LAMBDADB_PROJECT_API_KEY: 'synthetic%test-key' });
    return { status: 0 };
  }, value => { calls.push('mask'); assert.equal(value, '::add-mask::synthetic%25test-key'); });
  assert.deepEqual(calls, ['read', 'mask', 'test']);
  assert.equal(env.LAMBDADB_PROJECT_API_KEY, undefined);
});

test('outside GitHub Actions the key is never printed as a mask command', () => {
  const { GITHUB_ACTIONS, ...local } = env;
  let ran = false;
  runLiveSmoke(local, readKey(), () => { ran = true; return { status: 0 }; }, () => assert.fail('Must not print the key'));
  assert.ok(ran);
});

test('missing configuration, secret read failures and invalid keys fail before starting the smoke', () => {
  for (const name of ['LAMBDADB_BASE_URL', 'LAMBDADB_PROJECT_NAME', 'LAMBDADB_SMOKE_SECRET_ARN']) {
    for (const value of [undefined, '', '  ']) {
      assert.throws(() => runLiveSmoke({ ...env, [name]: value }, unexpected, unexpected, unexpected),
        { message: `Missing smoke configuration: ${name}` });
    }
  }
  assert.throws(() => runLiveSmoke(env, () => { throw new Error('sensitive output'); }, unexpected, unexpected),
    { message: 'Unable to read the dedicated smoke project key from Secrets Manager' });
  for (const key of ['', '\n', 'None', 'key\nother-key', 'key\rother-key']) {
    assert.throws(() => runLiveSmoke(env, readKey(key), unexpected, unexpected), /single project API key/);
  }
});

test('live smoke failures propagate so nothing is published', () => {
  for (const result of [{ status: 1 }, { status: null, signal: 'SIGTERM' }, { error: new Error('spawn failed') }]) {
    assert.throws(() => runLiveSmoke(env, readKey(), () => result, () => {}), { message: 'Deployed live smoke failed' });
  }
});
