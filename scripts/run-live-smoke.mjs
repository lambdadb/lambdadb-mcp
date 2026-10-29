import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REQUIRED = ['LAMBDADB_BASE_URL', 'LAMBDADB_PROJECT_NAME', 'LAMBDADB_SMOKE_SECRET_ARN'];

/**
 * Read the dedicated smoke project's API key from Secrets Manager and run every live suite with it.
 * The key is masked in GitHub Actions and exists only in the test child process environment.
 */
export function runLiveSmoke(env, execute = execFileSync, spawn = spawnSync, mask = console.log) {
  for (const name of REQUIRED) {
    if (!env[name]?.trim()) throw new Error(`Missing smoke configuration: ${name}`);
  }
  let key;
  try {
    key = execute('aws', ['secretsmanager', 'get-secret-value', '--region', 'ap-northeast-2',
      '--secret-id', env.LAMBDADB_SMOKE_SECRET_ARN.trim(), '--query', 'SecretString', '--output', 'text'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }).trim();
  } catch {
    // Do not include AWS command output or credentials in errors.
    throw new Error('Unable to read the dedicated smoke project key from Secrets Manager');
  }
  if (!key || key === 'None' || /[\r\n]/.test(key)) throw new Error('Expected a single project API key in SecretString');
  // A workflow command outside GitHub Actions would print the key instead of masking it.
  if (env.GITHUB_ACTIONS === 'true') {
    mask(`::add-mask::${key.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
  }
  // Keep the key out of files, command arguments and the rest of the publication job. Every
  // opt-in is set so no suite can skip; the empty env file keeps local dotenv files out of the run.
  const result = spawn('npm', ['run', 'test:live:all'], {
    stdio: 'inherit',
    env: {
      ...env,
      LAMBDADB_ENV_FILE: '/dev/null',
      LAMBDADB_RUN_LIVE_TESTS: '1',
      LAMBDADB_RUN_LIVE_RERANK_TESTS: '1',
      LAMBDADB_MCP_ENABLE_WRITE_TOOLS: 'true',
      LAMBDADB_LIVE_CONFIRM_PROJECT: env.LAMBDADB_PROJECT_NAME.trim(),
      LAMBDADB_PROJECT_API_KEY: key,
    },
  });
  if (result.error || result.status !== 0) throw new Error('Deployed live smoke failed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runLiveSmoke(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
