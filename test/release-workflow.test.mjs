import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/publish.yaml', import.meta.url), 'utf8');
const nextDevWorkflow = readFileSync(new URL('../.github/workflows/next-dev-version.yaml', import.meta.url), 'utf8');
const step = name => {
  const start = workflow.indexOf(`- name: ${name}\n`);
  assert.ok(start >= 0, `Missing step ${name}`);
  const end = workflow.indexOf('\n      - name: ', start + 1);
  return workflow.slice(start, end < 0 ? undefined : end);
};

test('CI and publication trigger on main and GitHub Releases only', () => {
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

test('the next development version workflow runs only after a successful release publication', () => {
  assert.match(nextDevWorkflow, /workflow_run:\n\s+workflows: \["CI"\]\n\s+types: \[completed\]/);
  assert.match(workflow, /^(?:#.*\n)*name: CI\n/);
  assert.ok(nextDevWorkflow.includes(
    "github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'release'"));
  assert.match(nextDevWorkflow, /node scripts\/version\.mjs next-dev "\$RELEASED"/);
  assert.match(nextDevWorkflow, /node scripts\/version\.mjs set "\$NEXT"/);
  assert.match(nextDevWorkflow, /gh pr create --base main/);
  assert.doesNotMatch(nextDevWorkflow, /npm publish|id-token/);
});
