import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/publish.yaml', import.meta.url), 'utf8');
const step = name => {
  const start = workflow.indexOf(`- name: ${name}\n`);
  assert.ok(start >= 0, `Missing step ${name}`);
  const end = workflow.indexOf('\n      - name: ', start + 1);
  return workflow.slice(start, end < 0 ? undefined : end);
};

test('CI and publication trigger on main and GitHub Releases only', () => {
  // Development versions derive from tags; no workflow opens a next-version pull request.
  assert.deepEqual(readdirSync(new URL('../.github/workflows/', import.meta.url)), ['publish.yaml']);
  assert.match(workflow, /\non:\n {2}pull_request:\n {4}branches: \[main\]\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:\n {2}release:\n {4}types: \[published\]\n/);
  assert.doesNotMatch(workflow, /\bdevelop\b/);
  assert.ok(workflow.includes(`(github.event_name == 'release' ||\n       (github.event_name == 'push' && github.ref == 'refs/heads/main'))`));
  assert.match(workflow, /group: npm-publication\n\s+cancel-in-progress: false/);
});

test('each run mode selects its preparation, and verification never publishes', () => {
  assert.match(step('Select the run mode'), /run: node scripts\/version\.mjs mode$/);
  assert.match(step('Prepare deterministic development version'), /if: steps\.mode\.outputs\.mode == 'dev'\n/);
  assert.match(step('Verify committed release metadata and main ancestry without publication'),
    /if: steps\.mode\.outputs\.mode == 'verify'\n\s+run: node scripts\/release\.mjs verify$/);
  assert.match(step('Verify explicit release metadata and main ancestry'), /if: steps\.mode\.outputs\.mode == 'release'\n/);
  assert.match(step('Pack once and test the exact publication artifact'),
    /if: steps\.mode\.outputs\.mode != 'dev' \|\| steps\.dev\.outputs\.ready == 'true'\n/);
  // Dev publication keeps the explicit repository Variable gate.
  assert.match(step('Publish development version and verify registry state'),
    /steps\.mode\.outputs\.mode == 'dev' && steps\.dev\.outputs\.ready == 'true' &&\n\s+vars\.NPM_DEV_PUBLISH_ENABLED == 'true'\n/);
  assert.match(step('Publish explicit release using npm Trusted Publishing'), /if: steps\.mode\.outputs\.mode == 'release'\n/);
  const publishSteps = workflow.match(/run: node scripts\/(dev-release|release)\.mjs publish/g);
  assert.equal(publishSteps.length, 2);
});

test('every publication run gates on deployed live smoke tests selected by the run mode', () => {
  const ready = "if: steps.mode.outputs.mode != 'dev' || steps.dev.outputs.ready == 'true'\n";
  const auth = step('Authenticate smoke tests to AWS');
  const smoke = step('Run deployed live smoke tests');
  for (const section of [auth, smoke]) assert.ok(section.includes(ready));
  assert.match(auth, /uses: aws-actions\/configure-aws-credentials@[0-9a-f]{40} # v6\.3\.0\n/);
  // The Variable prefix comes from the run mode; a missing Variable is empty and fails, never falls back.
  assert.ok(auth.includes("role-to-assume: ${{ vars[format('{0}SMOKE_AWS_ROLE_ARN', steps.mode.outputs.smoke_prefix)] }}"));
  for (const name of ['BASE_URL', 'PROJECT_NAME', 'SMOKE_SECRET_ARN']) {
    const variable = name === 'SMOKE_SECRET_ARN' ? 'LAMBDADB_SMOKE_SECRET_ARN' : `LAMBDADB_${name}`;
    assert.ok(smoke.includes(`${variable}: \${{ vars[format('{0}${name}', steps.mode.outputs.smoke_prefix)] }}`), name);
  }
  assert.match(smoke, /run: \|\n\s+echo "Live smoke target: \$LAMBDADB_BASE_URL"\n\s+node scripts\/run-live-smoke\.mjs$/);
  assert.doesNotMatch(workflow, /LAMBDADB_PROJECT_API_KEY|secrets\./);
  // The smoke runs after the exact artifact is tested and before either publication step.
  const order = ['Pack once and test the exact publication artifact', 'Authenticate smoke tests to AWS',
    'Run deployed live smoke tests', 'Publish development version and verify registry state',
    'Publish explicit release using npm Trusted Publishing'].map(name => workflow.indexOf(`- name: ${name}\n`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(workflow, /timeout-minutes: 60\n\s+permissions:\n\s+contents: read\n\s+id-token: write\n/);
});
