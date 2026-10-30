import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REQUIRED = ['LAMBDADB_BASE_URL', 'LAMBDADB_PROJECT_NAME', 'LAMBDADB_PROJECT_API_KEY'];

/**
 * Run every live suite against the dedicated smoke project. In GitHub Actions the project API key
 * comes from the selected GitHub Environment's secret, which Actions masks in logs.
 */
export function runLiveSmoke(env, spawn = spawnSync) {
  for (const name of REQUIRED) {
    if (!env[name]?.trim()) throw new Error(`Missing smoke configuration: ${name}`);
  }
  const key = env.LAMBDADB_PROJECT_API_KEY.trim();
  if (/[\r\n]/.test(key)) throw new Error('Expected a single project API key');
  // Keep the key out of files and command arguments. Every opt-in is set so no suite can skip;
  // the empty env file keeps local dotenv files out of the run.
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
