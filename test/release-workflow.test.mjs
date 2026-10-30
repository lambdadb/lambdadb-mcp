import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/publish.yaml', import.meta.url), 'utf8');
const step = name => {
  const start = workflow.indexOf(`- name: ${name}\n`);
  assert.ok(start >= 0, `Missing step ${name}`);
  // A step ends at the next step or at the blank line before the next job.
  const ends = ['\n      - name: ', '\n\n'].map(marker => workflow.indexOf(marker, start + 1)).filter(end => end >= 0);
  return workflow.slice(start, ends.length ? Math.min(...ends) : undefined);
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
  assert.match(step('Prepare deterministic development version'), /if: needs\.mode\.outputs\.mode == 'dev'\n/);
  assert.match(step('Verify committed release metadata and main ancestry without publication'),
    /if: needs\.mode\.outputs\.mode == 'verify'\n\s+run: node scripts\/release\.mjs verify$/);
  assert.match(step('Verify explicit release metadata and main ancestry'), /if: needs\.mode\.outputs\.mode == 'release'\n/);
  assert.match(step('Pack once and test the exact publication artifact'),
    /if: needs\.mode\.outputs\.mode != 'dev' \|\| steps\.dev\.outputs\.ready == 'true'\n/);
  // Dev publication keeps the explicit repository Variable gate.
  assert.match(step('Publish development version and verify registry state'),
    /needs\.mode\.outputs\.mode == 'dev' && steps\.dev\.outputs\.ready == 'true' &&\n\s+vars\.NPM_DEV_PUBLISH_ENABLED == 'true'\n/);
  assert.match(step('Publish explicit release using npm Trusted Publishing'), /if: needs\.mode\.outputs\.mode == 'release'\n/);
  const publishSteps = workflow.match(/run: node scripts\/(dev-release|release)\.mjs publish/g);
  assert.equal(publishSteps.length, 2);
});

test('every publication run gates on deployed live smoke tests selected by the run mode', () => {
  const smoke = step('Run deployed live smoke tests');
  assert.ok(smoke.includes("if: needs.mode.outputs.mode != 'dev' || steps.dev.outputs.ready == 'true'\n"));
  // The Variable prefix comes from the run mode; a missing Variable is empty and fails, never falls back.
  for (const name of ['BASE_URL', 'PROJECT_NAME']) {
    assert.ok(smoke.includes(`LAMBDADB_${name}: \${{ vars[format('{0}${name}', needs.mode.outputs.smoke_prefix)] }}`), name);
  }
  assert.match(smoke, /run: \|\n\s+echo "Live smoke target: \$LAMBDADB_BASE_URL"\n\s+node scripts\/run-live-smoke\.mjs$/);
  // The smoke runs after the exact artifact is tested and before either publication step.
  const order = ['Pack once and test the exact publication artifact', 'Run deployed live smoke tests',
    'Publish development version and verify registry state',
    'Publish explicit release using npm Trusted Publishing'].map(name => workflow.indexOf(`- name: ${name}\n`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('the smoke key comes only from the GitHub Environment the run mode selects', () => {
  // The mode job runs only where publication may run and exposes the Environment before publish starts.
  assert.match(workflow, /\n {2}mode:\n {4}needs: validate\n {4}if: >-\n/);
  assert.match(workflow, /\n {4}outputs:\n {6}mode: \$\{\{ steps\.mode\.outputs\.mode \}\}\n {6}smoke_prefix: \$\{\{ steps\.mode\.outputs\.smoke_prefix \}\}\n {6}environment: \$\{\{ steps\.mode\.outputs\.environment \}\}\n/);
  assert.match(step('Select the run mode'), /id: mode\n\s+run: node scripts\/version\.mjs mode$/);
  assert.match(workflow, /\n {2}publish:\n {4}needs: mode\n {4}runs-on: ubuntu-latest\n {4}environment: \$\{\{ needs\.mode\.outputs\.environment \}\}\n/);
  assert.equal(workflow.match(/secrets\./g).length, 1);
  assert.ok(step('Run deployed live smoke tests').includes('LAMBDADB_PROJECT_API_KEY: ${{ secrets.LAMBDADB_PROJECT_API_KEY }}\n'));
  assert.doesNotMatch(workflow, /SMOKE_SECRET_ARN|SMOKE_AWS_ROLE_ARN|configure-aws-credentials|aws-region/);
  // Only the mode job's outputs read the step; the publication job reads the job outputs.
  assert.equal(workflow.match(/steps\.mode\.outputs/g).length, 3);
  // Only the publication job receives an OIDC token, for npm Trusted Publishing and provenance.
  assert.equal(workflow.match(/id-token: write/g).length, 1);
  assert.match(workflow, /timeout-minutes: 60\n\s+permissions:\n\s+contents: read\n\s+# npm Trusted Publishing and provenance\.\n\s+id-token: write\n/);
});
