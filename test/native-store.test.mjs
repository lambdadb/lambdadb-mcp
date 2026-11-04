import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Opt-in only: writes one uniquely named synthetic OS credential and removes it.
test(
  "a connection saved in the OS credential store serves a fresh server process",
  { skip: process.env.LAMBDADB_TEST_NATIVE_CREDENTIALS !== "1", timeout: 120_000 },
  async (t) => {
    const { identity, nativeVault, stateFile, writeState } = await import("../dist/connect/store.js");
    const apiUrl = "https://api.invalid";
    const instance = `native-test-${randomUUID()}`;
    const vault = nativeVault(`ai.lambdadb.mcp.v1:${identity(apiUrl, instance)}`);
    const store = await vault.probe();
    if (process.env.LAMBDADB_TEST_EXPECT_STORE) assert.equal(store, process.env.LAMBDADB_TEST_EXPECT_STORE);

    const credentialId = randomUUID();
    const secret = `synthetic-${randomUUID()}`;
    await vault.save(store, credentialId, secret);
    let removed = false;
    t.after(async () => { if (!removed) await vault.remove(store, credentialId).catch(() => {}); });
    await assert.rejects(vault.save(store, credentialId, "another-value"), "an existing entry is never overwritten");

    const keys = [];
    const api = createServer((req, res) => {
      keys.push(req.headers["x-api-key"]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ collections: [] }));
    });
    await new Promise((done) => api.listen(0, "127.0.0.1", done));
    t.after(() => new Promise((done) => { api.closeAllConnections(); api.close(done); }));

    const dir = await mkdtemp(join(tmpdir(), "lambdadb-mcp-native-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await writeState(stateFile(dir, apiUrl, instance), {
      connected: {
        endpoint: `http://127.0.0.1:${api.address().port}`, projectName: "native-test",
        projectId: randomUUID(), keyId: "synthetic-key", connectionId: randomUUID(),
        credentialStore: store, credentialId
      }
    });

    // A new server process restores the key from the store with no other input.
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("LAMBDADB_")));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/index.js")],
      env: { ...env, LAMBDADB_API_URL: apiUrl, LAMBDADB_MCP_INSTANCE: instance, LAMBDADB_MCP_STATE_DIR: dir },
      stderr: "pipe"
    });
    let stderr = "";
    transport.stderr.on("data", (chunk) => { stderr += chunk; });
    const client = new Client({ name: "native-store-test", version: "1.0.0" });
    await client.connect(transport);
    t.after(() => client.close());
    const status = await client.callTool({ name: "lambdadb_connection_status", arguments: {} });
    assert.match(status.content[0].text, /"status":"connected"/);
    const listed = await client.callTool({ name: "lambdadb_list_collections", arguments: {} });
    assert.notEqual(listed.isError, true, listed.content[0].text);
    assert.deepEqual(keys, [secret]);
    for (const text of [status.content[0].text, listed.content[0].text, stderr]) assert.ok(!text.includes(secret));

    await vault.remove(store, credentialId);
    removed = true;
    await assert.rejects(vault.read(store, credentialId));
  }
);
