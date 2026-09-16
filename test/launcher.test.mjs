import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "lambdadb-env-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  const script = join(root, "scripts", "with-env.sh");
  await copyFile(new URL("../scripts/with-env.sh", import.meta.url), script);
  return {
    root,
    write: (name, value) => writeFile(join(root, name), value),
    run: (env = {}) => spawnSync("bash", [script, "-e", "console.log(JSON.stringify({ project: process.env.LAMBDADB_PROJECT_NAME, write: process.env.LAMBDADB_MCP_ENABLE_WRITE_TOOLS }))"], {
      cwd: tmpdir(), env: { PATH: process.env.PATH, ...env }, encoding: "utf8"
    })
  };
}

test("launcher prefers .env.local, falls back to .env, and preserves exported overrides", async (t) => {
  const f = await fixture(t);
  await f.write(".env", "LAMBDADB_PROJECT_NAME=legacy\n");
  assert.equal(JSON.parse(f.run().stdout).project, "legacy");
  await f.write(".env.local", "LAMBDADB_PROJECT_NAME=local\nLAMBDADB_MCP_ENABLE_WRITE_TOOLS=true\n");
  assert.deepEqual(JSON.parse(f.run().stdout), { project: "local", write: "true" });
  assert.deepEqual(JSON.parse(f.run({ LAMBDADB_MCP_ENABLE_WRITE_TOOLS: "false" }).stdout), { project: "local", write: "false" });
});

test("launcher resolves an explicit file from the repo root and does not execute dotenv content", async (t) => {
  const f = await fixture(t);
  await f.write(".env.local", "LAMBDADB_PROJECT_NAME=local\n");
  await f.write("custom.env", 'LAMBDADB_PROJECT_NAME="$(echo executed) `echo expanded`"\n');
  const result = f.run({ LAMBDADB_ENV_FILE: "custom.env" });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).project, "$(echo executed) `echo expanded`");
});

test("launcher fails for a missing selected file instead of silently using another environment", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run().status, 1);
  await f.write(".env.local", "LAMBDADB_PROJECT_NAME=local\n");
  const result = f.run({ LAMBDADB_ENV_FILE: "missing.env" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing environment file: missing.env/);
});

test("Inspector forwards the file and read-only overrides without putting credentials in arguments", async (t) => {
  const f = await fixture(t);
  const script = join(f.root, "scripts", "inspect.sh");
  await copyFile(new URL("../scripts/inspect.sh", import.meta.url), script);
  await mkdir(join(f.root, "bin"));
  await writeFile(join(f.root, "bin", "npx"),
    `#!/usr/bin/env bash
exec node -e 'console.log(JSON.stringify(process.argv.slice(1)))' "$@"
`, { mode: 0o755 });
  const result = spawnSync("bash", [script, "--cli", "--method", "tools/list"], {
    cwd: tmpdir(), encoding: "utf8", env: {
      PATH: `${join(f.root, "bin")}:${process.env.PATH}`,
      LAMBDADB_ENV_FILE: "custom.env", LAMBDADB_MCP_ENABLE_WRITE_TOOLS: "false",
      LAMBDADB_PROJECT_API_KEY: "test-only-secret"
    }
  });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), [
    "@modelcontextprotocol/inspector", "--cli", "bash", "./scripts/with-env.sh", "dist/index.js",
    "-e", "LAMBDADB_ENV_FILE=custom.env", "-e", "LAMBDADB_MCP_ENABLE_WRITE_TOOLS=false",
    "--method", "tools/list"
  ]);
});
