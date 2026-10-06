import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { ResourceNotFoundError } from "@functional-systems/lambdadb";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getEnvConfig } from "../../dist/config/env.js";
import { createLambdaDBClient } from "../../dist/lambdadb/client.js";
import { createServer } from "../../dist/server/createServer.js";

// Separate from credential-free CI. Never print SDK errors or signed URLs.
test("live MCP Bayesian, native/legacy embeddings, rerank downloads and cleanup", { timeout: 600_000 }, async () => {
  assert.equal(process.env.LAMBDADB_RUN_LIVE_TESTS, "1", "Live smoke requires explicit opt-in");
  assert.equal(process.env.LAMBDADB_RUN_LIVE_RERANK_TESTS, "1", "Embedding and rerank inference require opt-in");
  const config = getEnvConfig();
  assert.equal(process.env.LAMBDADB_LIVE_CONFIRM_PROJECT, config.projectName,
    "Confirm the designated development project");
  assert.equal(config.enableWriteTools, true);
  const collectionName = `mcp-bayesian-${randomUUID()}`;
  const collection = createLambdaDBClient(config).collection(collectionName);
  const server = createServer(config);
  const client = new Client({ name: "mcp-bayesian-live", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const originalFetch = globalThis.fetch;
  let created = false;
  let wire, docsUrl, downloaded, lastStatus;
  let downloads = 0;
  let stage = "setup";
  const fields = { include: ["id", "body"] };
  const lexical = { queryString: { query: "body:restore" } };
  const vector = { knn: { field: "raw", queryVector: [1, 0], k: 30 } };
  const query = { bayesian: [lexical, vector] };
  const rerank = { provider: "typesafe", model: "jev-1.13.0", queryText: "How do I restore a version?", fields: ["body"] };
  const embedding = { provider: "openai", model: "text-embedding-3-small", sourceField: "body" };
  const payload = "x".repeat(3 * 1024 * 1024);

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const download = docsUrl !== undefined && request.url === docsUrl;
    if (download) for (const header of ["x-api-key", "authorization"]) {
      assert.ok(!request.headers.has(header), `Download must not forward ${header}`);
    }
    const response = await originalFetch(request, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(90_000)])
    });
    lastStatus = response.status;
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path.endsWith("/collections") && response.status === 201) created = true;
    if (download) {
      downloads++;
      downloaded = await response.clone().json();
      assert.ok(Array.isArray(downloaded));
    } else if (path.endsWith("/query") && response.ok) {
      wire = await response.clone().json();
      docsUrl = wire.docsUrl;
    }
    return response;
  };
  async function call(name, args = {}, expectedStatus) {
    wire = docsUrl = downloaded = lastStatus = undefined;
    downloads = 0;
    const result = await client.callTool({ name: `lambdadb_${name}`, arguments: { collectionName, ...args } },
      undefined, { timeout: 120_000 });
    if (expectedStatus) {
      assert.equal(result.isError, true);
      assert.equal(lastStatus, expectedStatus, "Expected a server rejection, not local validation");
      return;
    }
    assert.ok(result.isError !== true, `${stage}: ${name} failed; HTTP ${lastStatus ?? "unavailable"}`);
    return JSON.parse(result.content[0].text.split("\n\n").slice(1).join("\n\n"));
  }
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    stage = "native and legacy create";
    await call("create_collection", { indexConfigs: {
      body: { type: "text" }, raw: { type: "vector", dimensions: 2, similarity: "cosine" },
      native: { type: "vector", embedding: { ...embedding, dimensions: 512, similarity: "cosine" } },
      legacy: { type: "vector", managedEmbedding: true, embedding }
    }, tags: { purpose: "mcp-bayesian-smoke" }, snapshotRetentionInDays: 1 });
    console.info(`[live:bayesian] Created ${collectionName}`);
    const metadata = (await call("get_collection")).collection.indexConfigs;
    for (const name of ["native", "legacy"]) {
      assert.equal(metadata[name].managedEmbedding, true);
      assert.equal(metadata[name].embedding.model, embedding.model);
    }
    assert.equal(metadata.native.embedding.dimensions, 512);
    stage = "actual document embeddings";
    for (const [i, body] of ["Restore a saved collection version using a branch.", "Restore documents from a saved snapshot."].entries()) {
      await call("upsert_docs", { docs: [{ id: `doc-${i}`, body, raw: [1, i], payload }] });
    }
    const deadline = Date.now() + 300_000;
    while ((await call("list_docs", { size: 2, fields })).docs.length !== 2) {
      assert.ok(Date.now() < deadline, "Timed out waiting for committed documents");
      await delay(2_000);
    }
    for (const name of ["native", "legacy"]) {
      const nativeQuery = { knn: { field: name, queryText: "restore a version", k: 30 } };
      assert.equal((await call("query_collection", { query: nativeQuery, size: 2, fields })).docs.length, 2);
      assert.equal((await call("query_collection", { query: { bayesian: [lexical, nativeQuery] }, size: 2, candidateSize: 30, fields })).docs.length, 2);
    }
    console.info("[live:bayesian] Native/legacy metadata, document embeddings, ordinary KNN and Bayesian queryText: PASS");
    stage = "Bayesian budgets and existing fusion";
    const input = { query, size: 2, candidateSize: 30, fields };
    const baseline = await call("query_collection", input);
    assert.equal(baseline.docs.length, 2);
    for (const options of [{ consistentRead: true }, { rerank: null }, { query: { bayesian: [{ bool: [lexical] }, vector] } }]) {
      assert.deepEqual((await call("query_collection", { ...input, ...options })).docs, baseline.docs);
    }
    assert.deepEqual((await call("query_collection", { ...input, size: 1 })).docs, baseline.docs.slice(0, 1));
    for (const method of ["rrf", "mm", "l2"]) {
      assert.equal((await call("query_collection", { query: { [method]: [lexical, vector] }, size: 2, fields })).docs.length, 2);
    }
    stage = "server contract rejections";
    const invalid = [
      { query: { bayesian: [lexical] } }, { query: { bayesian: [lexical, vector, lexical] } },
      { query: { bayesian: [{ ...lexical, boost: 1 }, vector] } },
      { query: { bayesian: [{ bool: [{ bool: [{ ...lexical, boost: 1 }] }] }, vector] } },
      ...["bayesian", "rrf", "mm", "l2"].map(method => ({ query: { bayesian: [{ [method]: [lexical, vector] }, vector] } })),
      { query: { bool: [query] } },
      { candidateSize: undefined }, { candidateSize: 0 }, { candidateSize: 1 }, { candidateSize: 101 },
      { rerank }, { query: lexical }, { query: vector },
      ...["rrf", "mm", "l2"].map(method => ({ query: { [method]: [lexical, vector] } }))
    ];
    for (const patch of invalid) {
      await delay(250);
      await call("query_collection", { ...input, ...patch }, 400);
    }
    console.info(`[live:bayesian] Budgets, Boolean signal, consistent reads, legacy fusion and ${invalid.length} server HTTP 400 rejections: PASS`);
    stage = "Bayesian rerank inline and docsUrl";
    const retrieval = new Map(baseline.docs.map(hit => [hit.doc.id, hit.score]));
    for (const offload of [false, true]) {
      const result = await call("query_collection", { query, size: 2,
        ...(offload ? {} : { fields }), rerank: offload ? { ...rerank, candidateSize: 30 } : rerank });
      assert.equal(result.rerank?.status, "applied");
      assert.equal(result.rerank.candidateCount, 2);
      assert.equal(result.rerank.scoredCount, 2);
      assert.deepEqual(result.rerank, wire.rerank);
      assert.equal(result.docs.length, 2);
      assert.deepEqual(result.docs, downloaded ?? wire.docs);
      for (const hit of result.docs) {
        assert.equal(hit.retrievalScore, retrieval.get(hit.doc.id));
        assert.ok(Number.isFinite(hit.score) && hit.score >= 0 && hit.score <= 1);
        if (offload) assert.equal(hit.doc.payload, payload);
      }
      assert.equal(downloads, offload ? 1 : 0);
      assert.equal(result.isDocsInline, true);
    }
    console.info("[live:bayesian] Applied rerank, unchanged default budget, retrievalScore, metadata and one credential-free docsUrl download: PASS");
  } catch (error) {
    // Assertions can contain payloads; report only the stage, type and HTTP status.
    throw new Error(`${stage}: ${error?.name ?? "Error"}; HTTP ${error?.statusCode ?? lastStatus ?? "unavailable"}`);
  } finally {
    try {
      if (created) {
        const options = { timeoutMs: 30_000, retries: { strategy: "none" } };
        for (let attempt = 0; ; attempt++) {
          try {
            const removed = await collection.deleteSafe(options);
            if (!removed.ok && !(removed.error instanceof ResourceNotFoundError)) throw removed.error;
            const result = await collection.getSafe(options);
            if (result.ok) throw new Error("Collection still exists");
            if (!(result.error instanceof ResourceNotFoundError)) throw result.error;
            console.info(`[live:bayesian] Deleted ${collectionName}; absence verified (404)`);
            break;
          } catch (error) {
            if (attempt >= 2 || ![429, 503].includes(error?.statusCode)) throw new Error(`Cleanup failed for ${collectionName}`);
            await delay(2_000);
          }
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
      await client.close();
      await server.close();
    }
  }
});
