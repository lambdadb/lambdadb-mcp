import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { ResourceNotFoundError } from "@functional-systems/lambdadb";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getEnvConfig } from "../../dist/config/env.js";
import { createLambdaDBClient } from "../../dist/lambdadb/client.js";
import { createServer } from "../../dist/server/createServer.js";

async function eventually(operation, label, timeoutMs = 300_000) {
  const started = Date.now();
  while (!(await operation())) {
    assert.ok(Date.now() - started < timeoutMs, `Timed out: ${label}`);
    await delay(2_000);
  }
  console.info(`[live] ${label}: PASS (${Math.round((Date.now() - started) / 1000)}s)`);
}

// Explicitly invoked only. Creates one owned collection and deletes it in finally.
// No environment values, presigned URLs, or document payloads are logged.
test("live MCP metadata, writes, refs, docsUrl arrays, and cleanup", { timeout: 900_000 }, async () => {
  assert.equal(process.env.LAMBDADB_RUN_LIVE_TESTS, "1", "Live smoke requires explicit opt-in");
  const config = getEnvConfig();
  assert.equal(process.env.LAMBDADB_LIVE_CONFIRM_PROJECT, config.projectName,
    "Explicitly confirm the designated development project before live writes");
  assert.equal(config.enableWriteTools, true, "Live smoke requires LAMBDADB_MCP_ENABLE_WRITE_TOOLS=true");
  const collectionName = `mcp-smoke-${randomUUID()}`;
  const sdk = createLambdaDBClient(config);
  const collection = sdk.collection(collectionName);
  const server = createServer(config);
  const client = new Client({ name: "mcp-live-smoke", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  let created = false;
  let trace = [];
  let docsUrl;
  let downloadCount = 0;
  const originalFetch = globalThis.fetch;

  // Observe real HTTP without injecting a separate client into production tools.
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const isDownload = docsUrl !== undefined && request.url === docsUrl;
    if (isDownload) {
      assert.equal(request.method, "GET");
      for (const header of ["x-api-key", "authorization"]) {
        assert.ok(!request.headers.has(header), `Download must not forward ${header}`);
      }
    }
    const response = await originalFetch(request, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)])
    });
    if (isDownload) {
      assert.equal(response.status, 200);
      assert.ok(Array.isArray(await response.clone().json()), "docsUrl must return a top-level array");
      downloadCount++;
    } else {
      const path = new URL(request.url).pathname;
      trace.push({ method: request.method, status: response.status, path });
      if (request.method === "POST" && path.endsWith("/collections") && response.status === 201) created = true;
      if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const body = await response.clone().json();
        if (body.isDocsInline === false && body.docsUrl) docsUrl = body.docsUrl;
      }
    }
    return response;
  };

  async function call(name, args = {}) {
    trace = [];
    docsUrl = undefined;
    downloadCount = 0;
    const result = await client.callTool({ name: `lambdadb_${name}`, arguments: args }, undefined, { timeout: 60_000 });
    assert.notEqual(result.isError, true, `MCP tool ${name} must succeed`);
    return JSON.parse(result.content[0].text.split("\n\n").slice(1).join("\n\n"));
  }
  const scoped = (name, args = {}) => call(name, { collectionName, ...args });
  const fields = { include: ["id", "marker"] };
  const query = { query: { queryString: { query: "*:*" } }, size: 2 };
  const ids = ["offload-1", "offload-2"];
  const payload = "x".repeat(3 * 1024 * 1024);
  const digest = (value) => createHash("sha256").update(value).digest("hex");

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    assert.equal((await client.listTools()).tools.length, 8);
    await call("list_collections", { size: 1 });
    console.info("[live] Project List and write opt-in: PASS");
    const made = await scoped("create_collection", {
      indexConfigs: { marker: { type: "keyword" } }, description: "MCP live contract smoke",
      tags: { purpose: "mcp-smoke" }, snapshotRetentionInDays: 1
    });
    assert.ok(trace.some((entry) => entry.status === 201));
    assert.equal(made.collection.collectionName, collectionName);
    assert.equal(made.collection.defaultBranchName, "main");
    assert.ok(Number.isFinite(Date.parse(made.collection.createdAt)));
    console.info(`[live] Created ${collectionName}; HTTP 201: PASS`);
    const metadata = await scoped("get_collection");
    assert.equal(metadata.collection.tags.purpose, "mcp-smoke");
    assert.equal(metadata.collection.snapshotRetentionInDays, 1);
    let pageToken;
    let found = false;
    do {
      const page = await call("list_collections", { size: 100, ...(pageToken ? { pageToken } : {}) });
      found = page.collections.some((item) => item.collectionName === collectionName);
      pageToken = page.nextPageToken;
    } while (!found && pageToken);
    assert.ok(found, "Created collection must appear in List");
    console.info("[live] List/Get metadata and ISO timestamps: PASS");

    // Each write is below the request limit; combined results exceed the offload threshold.
    for (const id of ids) {
      await scoped("upsert_docs", { docs: [{ id, marker: "offload", payload }] });
      assert.ok(trace.some((entry) => entry.status === 202));
    }
    await eventually(async () => {
      const result = await scoped("fetch_docs", { ids, fields, consistentRead: true });
      return result.docs.length === 2;
    }, "main pending-write Fetch", 90_000);
    await eventually(async () => {
      const result = await scoped("list_docs", { size: 2, fields });
      return result.docs.length === 2;
    }, "main committed List");

    for (const [name, args] of [
      ["query_collection", query], ["fetch_docs", { ids }],
      ["list_docs", { size: 2 }], ["list_docs", { size: 2, fields: { include: ["id", "payload"] } }]
    ]) {
      const result = await scoped(name, args);
      assert.ok(docsUrl !== undefined, `${name} must actually offload`);
      assert.equal(downloadCount, 1);
      assert.equal(result.isDocsInline, true);
      assert.equal(result.total, 2);
      assert.deepEqual(result.docs.map(({ doc }) => doc.id).sort(), ids);
      for (const { doc } of result.docs) {
        assert.equal(doc.payload.length, payload.length);
        assert.equal(digest(doc.payload), digest(payload));
      }
      console.info(`[live] ${name}${args.fields ? " extended" : ""}: docsUrl array, full payload, credential isolation PASS`);
    }
    const firstPage = await scoped("list_docs", { size: 1, fields });
    assert.ok(firstPage.nextPageToken);
    const secondPage = await scoped("list_docs", { size: 1, fields, pageToken: firstPage.nextPageToken });
    assert.deepEqual([...firstPage.docs, ...secondPage.docs].map(({ doc }) => doc.id).sort(), ids);
    await scoped("list_docs", { fields, filter: { queryString: { query: "marker:offload" } } });
    await scoped("query_collection", { ...query, fields, sort: [{ marker: "ASC" }] });
    console.info("[live] Pagination, queryString filter, uppercase sort: PASS");

    await collection.branches.create({ branchName: "candidate" });
    await collection.tags.create({ tagName: "release" });
    await collection.aliases.create({ aliasName: "current", target: { kind: "tag", name: "release" } });
    for (const ref of [
      { kind: "branch", name: "candidate" }, { kind: "tag", name: "release" }, { kind: "alias", name: "current" }
    ]) {
      for (const [name, args] of [["query_collection", query], ["fetch_docs", { ids }], ["list_docs", { size: 2 }]]) {
        const result = await scoped(name, { ...args, fields, ref });
        assert.deepEqual(result.docs.map(({ doc }) => doc.id).sort(), ids);
      }
      // Ref-only List exercises the SDK GET path rather than the extended POST path.
      const page = await scoped("list_docs", { size: 1, ref });
      assert.equal(page.docs.length, 1);
      assert.equal(trace[0].method, "GET");
    }
    console.info("[live] Branch/Tag/Alias Query, Fetch, and both List paths: PASS");
    await scoped("upsert_docs", { branch: "candidate", docs: [{ id: "branch-only", marker: "branch" }] });
    await eventually(async () => {
      const result = await scoped("fetch_docs", { ids: ["branch-only"], ref: { kind: "branch", name: "candidate" }, consistentRead: true });
      return result.docs.length === 1;
    }, "branch write visibility", 90_000);
    const main = await scoped("fetch_docs", { ids: ["branch-only"], consistentRead: true });
    assert.equal(main.docs.length, 0);
    await scoped("delete_docs", { branch: "candidate", ids: ["branch-only"] });
    await eventually(async () => {
      const result = await scoped("fetch_docs", { ids: ["branch-only"], ref: { kind: "branch", name: "candidate" }, consistentRead: true });
      return result.docs.length === 0;
    }, "branch delete visibility", 90_000);
    await scoped("delete_docs", { branch: "main", filter: { queryString: { query: "marker:offload" } } });
    assert.ok(trace.some((entry) => entry.status === 202));
    console.info("[live] Branch write isolation, delete by IDs, delete by filter HTTP 202: PASS");
  } finally {
    try {
      if (created) {
        await collection.delete({ timeoutMs: 30_000 });
        await eventually(async () => {
          const result = await collection.getSafe({ timeoutMs: 30_000 });
          if (result.ok) return false;
          if (!(result.error instanceof ResourceNotFoundError)) throw result.error;
          return true;
        }, "collection absence after cleanup", 60_000);
        console.info(`[live] Deleted ${collectionName}; absence verified`);
      }
    } finally {
      globalThis.fetch = originalFetch;
      await client.close();
      await server.close();
    }
  }
});
