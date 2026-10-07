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
  console.info(`[live:rerank] ${label}: PASS`);
}

// Separate opt-in: real inference can incur cost and requires a native reranking model enabled by LambdaDB.
test("live MCP native reranking, custom criteria, empty results, downloads and cleanup", { timeout: 900_000 }, async () => {
  assert.equal(process.env.LAMBDADB_RUN_LIVE_TESTS, "1", "Live smoke requires explicit opt-in");
  assert.equal(process.env.LAMBDADB_RUN_LIVE_RERANK_TESTS, "1", "Managed inference requires explicit opt-in");
  const config = getEnvConfig();
  assert.ok(process.env.LAMBDADB_LIVE_CONFIRM_PROJECT === config.projectName,
    "Explicitly confirm the designated development project before live writes");
  assert.equal(config.enableWriteTools, true, "Live smoke requires write opt-in");
  const collectionName = `mcp-rerank-${randomUUID()}`;
  const collection = createLambdaDBClient(config).collection(collectionName);
  const server = createServer(config);
  const client = new Client({ name: "mcp-rerank-live-smoke", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const originalFetch = globalThis.fetch;
  let created = false;
  let wire;
  let docsUrl;
  let downloadedDocs;
  let lastStatus;
  const payload = "x".repeat(3 * 1024 * 1024);
  const digest = value => createHash("sha256").update(value).digest("hex");
  const ids = ["restore-one", "restore-two"];
  const fields = { include: ["id", "title", "body"] };
  const query = { queryString: { query: "title:restore" } };
  const rerank = { provider: "typesafe", model: "jev-1.13.0", queryText: "How do I restore a collection?", fields: ["title", "body"], candidateSize: 2 };

  // Observe the wire envelope and actual download without printing credentials or URLs.
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
      assert.equal(response.status, 200);
      downloadedDocs = await response.clone().json();
      assert.ok(Array.isArray(downloadedDocs), "docsUrl must return a document array");
    } else if (path.endsWith("/query") && response.ok) {
      wire = await response.clone().json();
      docsUrl = wire.docsUrl;
    }
    return response;
  };

  async function call(name, args = {}) {
    wire = undefined;
    docsUrl = undefined;
    downloadedDocs = undefined;
    lastStatus = undefined;
    const result = await client.callTool({ name: `lambdadb_${name}`, arguments: { collectionName, ...args } }, undefined, { timeout: 120_000 });
    // Do not include tool error bodies: SDK diagnostics can contain authenticated requests.
    assert.ok(result.isError !== true, `MCP ${name} must succeed; HTTP ${lastStatus ?? "unavailable"}`);
    return JSON.parse(result.content[0].text.split("\n\n").slice(1).join("\n\n"));
  }

  function assertApplied(result, criteriaVersion, size, retrieval) {
    const metadata = result.rerank;
    assert.equal(metadata?.status, "applied", "Inference must apply; fallback is not a passing smoke");
    assert.equal(metadata.provider, rerank.provider);
    assert.equal(metadata.model, rerank.model);
    assert.equal(metadata.criteriaVersion, criteriaVersion);
    assert.equal(metadata.candidateCount, 2);
    assert.equal(metadata.scoredCount, 2);
    assert.ok(Number.isInteger(metadata.took) && metadata.took >= 0);
    assert.equal(metadata.reason, undefined);
    assert.equal(result.docs.length, size);
    assert.equal(result.total, size);
    for (const hit of result.docs) {
      assert.ok(Number.isFinite(hit.score) && hit.score >= 0 && hit.score <= 1);
      assert.ok(Number.isFinite(hit.retrievalScore));
      assert.equal(hit.retrievalScore, retrieval.get(hit.doc.id));
    }
    assert.equal(result.maxScore, Math.max(...result.docs.map(hit => hit.score)));
    // Compare with this exact response, not another inference or fixed model output.
    assert.deepEqual(result.rerank, wire.rerank);
    assert.equal(result.maxScore, wire.maxScore);
    assert.deepEqual(result.docs, downloadedDocs ?? wire.docs);
  }

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await call("create_collection", {
      indexConfigs: { title: { type: "text" }, body: { type: "text" } },
      description: "MCP native reranking live contract smoke",
      tags: { purpose: "mcp-rerank-smoke" }, snapshotRetentionInDays: 1
    });
    console.info(`[live:rerank] Created ${collectionName}`);
    for (const [index, id] of ids.entries()) {
      await call("upsert_docs", { docs: [{ id, title: "Restore a collection", body: index === 0
        ? "Select a previous collection version and restore it to recover documents."
        : "Collection version history lists previous versions for inspection.", payload }] });
    }
    await eventually(async () => (await call("list_docs", { size: 2, fields })).docs.length === 2,
      "committed candidate visibility");
    const input = { query, size: 2, fields };
    const baseline = await call("query_collection", input);
    assert.equal(baseline.docs.length, 2);
    const original = await call("query_collection", { ...input, rerank: null });
    assert.deepEqual(original.docs, baseline.docs);
    for (const result of [baseline, original]) {
      assert.equal(result.rerank, undefined);
      assert.ok(result.docs.every(hit => hit.retrievalScore === undefined));
    }
    const retrieval = new Map(baseline.docs.map(hit => [hit.doc.id, hit.score]));
    console.info("[live:rerank] Omitted/null retrieval behavior: PASS");

    const defaults = await call("query_collection", { ...input, size: 1, rerank });
    assertApplied(defaults, "default-relevance-v1", 1, retrieval);
    assert.equal(docsUrl, undefined, "Projected result must be inline");
    console.info("[live:rerank] Default criteria, final size and inline envelopes: PASS");

    const custom = await call("query_collection", { query, size: 2, rerank: { ...rerank, criteria: [
      "Does not explain restoring a collection.",
      "Explains how to restore a previous collection version."
    ] } });
    assertApplied(custom, "custom", 2, retrieval);
    assert.ok(docsUrl !== undefined && downloadedDocs !== undefined, "Large projection must actually download");
    for (const { doc } of custom.docs) assert.equal(digest(doc.payload), digest(payload));
    assert.deepEqual(custom.docs.map(hit => hit.doc.id).sort(), ids);
    console.info("[live:rerank] Custom criteria, docsUrl envelopes, payload integrity and credential isolation: PASS");

    const empty = await call("query_collection", { ...input, query: { queryString: { query: "title:nonexistenttoken" } }, rerank });
    assert.deepEqual(empty.docs, []);
    assert.equal(empty.total, 0);
    assert.equal(empty.maxScore, undefined);
    assert.equal(empty.rerank?.status, "skipped");
    assert.equal(empty.rerank.reason, "noCandidates");
    assert.equal(empty.rerank.candidateCount, 0);
    assert.equal(empty.rerank.scoredCount, 0);
    assert.equal(empty.rerank.criteriaVersion, undefined);
    console.info("[live:rerank] Empty candidates: PASS");
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    throw new Error(`Live rerank failed: ${error?.name ?? "Error"}; HTTP ${error?.statusCode ?? lastStatus ?? "unavailable"}`);
  } finally {
    try {
      if (created) {
        await collection.delete({ timeoutMs: 30_000 });
        await eventually(async () => {
          const result = await collection.getSafe({ timeoutMs: 30_000 });
          if (result.ok) return false;
          if (!(result.error instanceof ResourceNotFoundError)) throw new Error("Cleanup verification failed");
          return true;
        }, "collection absence after cleanup", 60_000);
        console.info(`[live:rerank] Deleted ${collectionName}; absence verified`);
      }
    } catch {
      throw new Error(`Cleanup failed for owned collection ${collectionName}`);
    } finally {
      globalThis.fetch = originalFetch;
      await client.close();
      await server.close();
    }
  }
});
