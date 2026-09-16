import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getEnvConfig } from "../dist/config/env.js";
import { createServer } from "../dist/server/createServer.js";

// LambdaDB develop d1a76659884a9ed09283a0b2e2989897dc799247:
// CollectionResponse has no collectionStatus; dataUpdatedAt is absent before a commit.
const timestamp = 1789600000123;
const collection = {
  projectName: "test", collectionName: "items",
  indexConfigs: { title: { type: "text" }, category: { type: "keyword" }, metadata: { type: "object", objectIndexConfigs: { category: { type: "keyword" } } } },
  description: "Contract fixture", tags: { env: "test" },
  numPartitions: 1, numDocs: 0, defaultBranchName: "main",
  snapshotRetentionInDays: 30, createdAt: timestamp, updatedAt: timestamp
};
const created = Object.fromEntries([
  "collectionName", "description", "tags", "defaultBranchName", "snapshotRetentionInDays", "createdAt"
].map((key) => [key, collection[key]]));
const docs = [{ collection: "items", doc: { id: "one", title: "Test" }, score: 1 }];
const query = { query: { queryString: { query: "*:*" } } };

async function harness(t, { write = false, respond } = {}) {
  const requests = [];
  const api = createHttpServer(async (req, res) => {
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const request = { method: req.method, url: new URL(req.url, baseUrl), headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      requests.push(request);
      const reply = await respond?.(request) ?? { body: { message: "Success" } };
      res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      res.end(reply.raw ?? JSON.stringify(reply.body));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: String(error) }));
    }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${api.address().port}`;
  const config = getEnvConfig({
    LAMBDADB_BASE_URL: baseUrl, LAMBDADB_PROJECT_NAME: "test",
    LAMBDADB_PROJECT_API_KEY: "test-secret", ...(write ? { LAMBDADB_MCP_ENABLE_WRITE_TOOLS: "true" } : {})
  });
  const server = createServer(config);
  const client = new Client({ name: "contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
    await new Promise((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client, requests, baseUrl,
    call: (name, args = {}) => client.callTool({ name: `lambdadb_${name}`, arguments: args })
  };
}

function data(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return JSON.parse(result.content[0].text.split("\n\n").slice(1).join("\n\n"));
}

test("read-only is the default; write tools require explicit opt-in", async (t) => {
  const read = await harness(t);
  const tools = (await read.client.listTools()).tools;
  assert.equal(tools.length, 5);
  assert.ok(tools.every((tool) => tool.annotations.readOnlyHint === true));
  assert.equal((await read.call("create_collection", { collectionName: "items", indexConfigs: collection.indexConfigs })).isError, true);
  assert.equal(read.requests.length, 0);
  const write = await harness(t, { write: true });
  const enabled = (await write.client.listTools()).tools;
  assert.equal(enabled.length, 8);
  const create = enabled.find((tool) => tool.name === "lambdadb_create_collection");
  assert.ok(create.inputSchema.required.includes("indexConfigs"));
  const list = enabled.find((tool) => tool.name === "lambdadb_list_docs");
  assert.ok(list.inputSchema.properties.ref);
  assert.equal(list.inputSchema.properties.consistentRead, undefined);
});

test("list/get accept current metadata and preserve millisecond timestamps", async (t) => {
  for (const extra of [{}, { dataUpdatedAt: timestamp + 1, partitionConfig: null }]) {
    const wire = { ...collection, ...extra };
    const h = await harness(t, { respond: (req) => ({ body: req.url.pathname.endsWith("/items")
      ? { collection: wire } : { collections: [wire], nextPageToken: "next" } }) });
    const listed = data(await h.call("list_collections", { size: 2, pageToken: "previous" }));
    const fetched = data(await h.call("get_collection", { collectionName: "items" }));
    assert.deepEqual(listed.collections[0], fetched.collection);
    assert.equal(listed.nextPageToken, "next");
    assert.equal(fetched.collection.createdAt, new Date(timestamp).toISOString());
    assert.equal(fetched.collection.dataUpdatedAt, extra.dataUpdatedAt ? new Date(extra.dataUpdatedAt).toISOString() : undefined);
    assert.deepEqual(fetched.collection.indexConfigs, collection.indexConfigs);
    assert.deepEqual(fetched.collection.tags, collection.tags);
    assert.equal(fetched.collection.defaultBranchName, "main");
    assert.equal(fetched.collection.snapshotRetentionInDays, 30);
    assert.equal(h.requests[0].url.searchParams.get("pageToken"), "previous");
  }
});

test("create accepts HTTP 201 and sends metadata and retention", async (t) => {
  const h = await harness(t, { write: true, respond: () => ({ status: 201, body: { collection: created } }) });
  const input = { collectionName: "items", indexConfigs: collection.indexConfigs,
    description: "Contract fixture", tags: { env: "test" }, snapshotRetentionInDays: 30,
    partitionConfig: { fieldName: "tenant", dataType: "keyword", numPartitions: 2 } };
  const result = data(await h.call("create_collection", input));
  assert.deepEqual(result.collection, { ...created, createdAt: new Date(timestamp).toISOString() });
  assert.equal(h.requests[0].method, "POST");
  assert.deepEqual(h.requests[0].body, input);
});

for (const [name, args] of [["query_collection", { ...query, sort: [{ category: "ASC" }] }], ["fetch_docs", { ids: ["one"] }]]) {
  test(`${name} forwards refs and permits consistent reads only on direct branches`, async (t) => {
    const h = await harness(t, { respond: () => ({ body: { docs, total: 1, took: 1, isDocsInline: true } }) });
    for (const ref of [undefined, { kind: "branch", name: "dev" }, { kind: "tag", name: "release" }, { kind: "alias", name: "current" }]) {
      const consistentRead = !ref || ref.kind === "branch";
      data(await h.call(name, { collectionName: "items", ...args, ...(ref ? { ref } : {}), consistentRead }));
      assert.deepEqual(h.requests.at(-1).body.ref, ref);
      assert.equal(h.requests.at(-1).body.consistentRead, consistentRead);
      if (args.sort) assert.deepEqual(h.requests.at(-1).body.sort, args.sort);
    }
    for (const kind of ["tag", "alias"]) {
      const result = await h.call(name, { collectionName: "items", ...args, ref: { kind, name: "release" }, consistentRead: true });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /direct branch/);
    }
    assert.equal(h.requests.length, 4);
  });
}

test("published sort schema and tool calls agree on case-insensitive directions", async (t) => {
  const h = await harness(t, { respond: () => ({ body: { docs, total: 1, took: 1, isDocsInline: true } }) });
  const tools = (await h.client.listTools()).tools;
  const schema = tools.find((tool) => tool.name === "lambdadb_query_collection").inputSchema;
  const pattern = new RegExp(schema.properties.sort.items.additionalProperties.pattern);
  for (const direction of ["asc", "ASC", "aSc", "desc", "DESC", "dEsC"]) {
    assert.equal(pattern.test(direction), true, `Published schema must accept ${direction}`);
    data(await h.call("query_collection", {
      collectionName: "items", ...query, sort: [{ category: direction }]
    }));
    assert.deepEqual(h.requests.at(-1).body.sort, [{ category: direction }]);
  }
  const acceptedRequests = h.requests.length;
  for (const direction of ["", "ascending", "asc desc", " ASC"]) {
    assert.equal(pattern.test(direction), false);
    const result = await h.call("query_collection", {
      collectionName: "items", ...query, sort: [{ category: direction }]
    });
    assert.equal(result.isError, true);
  }
  assert.equal(h.requests.length, acceptedRequests);
});

test("list uses GET for simple pagination and POST for ref/filter/projection", async (t) => {
  const h = await harness(t, { respond: () => ({ body: { docs, total: 1, isDocsInline: true, nextPageToken: "next" } }) });
  data(await h.call("list_docs", { collectionName: "items", size: 1, pageToken: "previous", includeVectors: true }));
  assert.equal(h.requests[0].method, "GET");
  assert.equal(h.requests[0].url.searchParams.get("pageToken"), "previous");
  const options = { size: 1, pageToken: "next", ref: { kind: "tag", name: "release" },
    filter: { queryString: { query: "category:test" } }, fields: { include: ["title"] },
    includeVectors: false, partitionFilter: { field: "tenant", in: ["test"] } };
  data(await h.call("list_docs", { collectionName: "items", ...options }));
  assert.equal(h.requests[1].method, "POST");
  assert.ok(h.requests[1].url.pathname.endsWith("/docs/list"));
  assert.deepEqual(h.requests[1].body, options);
});

test("upsert and both delete forms preserve branch scope", async (t) => {
  const h = await harness(t, { write: true, respond: () => ({ status: 202, body: { message: "Success" } }) });
  const inputs = [
    ["upsert_docs", { docs: [{ id: "one", title: "Test" }], branch: "dev" }],
    ["delete_docs", { ids: ["one"], branch: "dev", partitionFilter: { field: "tenant", in: ["test"] } }],
    ["delete_docs", { filter: { queryString: { query: "id:one" } }, branch: "dev" }]
  ];
  for (const [name, input] of inputs) {
    data(await h.call(name, { collectionName: "items", ...input }));
    assert.deepEqual(h.requests.at(-1).body, input);
  }
});

test("invalid and unsupported inputs fail before any HTTP request", async (t) => {
  const h = await harness(t, { write: true });
  const cases = [
    ["create_collection", {}],
    ["create_collection", { indexConfigs: {} }],
    ["create_collection", { indexConfigs: collection.indexConfigs, partitionConfig: { fieldName: "tenant", dataType: "keyword", numPartitions: 1 } }],
    ["create_collection", { indexConfigs: collection.indexConfigs, partitionConfig: { fieldName: "tenant", dataType: "keyword", numPartitions: 1025 } }],
    ["create_collection", { indexConfigs: collection.indexConfigs, snapshotRetentionInDays: 32 }],
    ["create_collection", { indexConfigs: collection.indexConfigs, tags: { invalid: "a:b" } }],
    ["create_collection", { indexConfigs: collection.indexConfigs, tags: { invalid: " " } }],
    ["delete_docs", {}], ["delete_docs", { ids: [] }],
    ["delete_docs", { ids: ["one"], filter: { queryString: { query: "id:one" } } }],
    ["upsert_docs", { docs: [], branch: "dev" }],
    ["upsert_docs", { docs: [{ id: "one" }], branch: "x" }],
    ["upsert_docs", { docs: [{ id: "one" }], ref: { kind: "tag", name: "release" } }],
    ["list_docs", { consistentRead: true }],
    ["list_docs", { ref: { kind: "branch", name: "dev", asOf: 1 } }],
    ["fetch_docs", { ids: ["one"], fields: {} }],
    ["query_collection", { ...query, fields: { include: [] } }],
    ["query_collection", { ...query, partitionFilter: { field: "tenant", in: [] } }]
  ];
  for (const [name, input] of cases) {
    assert.equal((await h.call(name, { collectionName: "items", ...input })).isError, true, `${name}: ${JSON.stringify(input)}`);
  }
  assert.equal(h.requests.length, 0);
});

for (const [name, args] of [
  ["query_collection", query], ["fetch_docs", { ids: ["one"] }],
  ["list_docs", {}], ["list_docs", { fields: { include: ["title"] } }]
]) {
  test(`${name} ${JSON.stringify(args)} downloads docsUrl arrays with metadata and no API credentials`, async (t) => {
    for (const payload of [docs, [], { docs }]) {
      const h = await harness(t, { respond: (req) => req.url.pathname === "/download"
        ? { body: payload }
        : { body: { docs: [], total: 1, took: 7, nextPageToken: "next", isDocsInline: false,
          docsUrl: `${req.url.origin}/download?signature=unchanged%2Bvalue` } } });
      const result = data(await h.call(name, { collectionName: "items", ...args }));
      assert.deepEqual(result.docs, Array.isArray(payload) ? payload : docs);
      assert.equal(result.isDocsInline, true);
      assert.equal(result.total, 1);
      if (name === "list_docs") assert.equal(result.nextPageToken, "next");
      else assert.equal(result.took, 7);
      assert.equal(h.requests.length, 2);
      assert.equal(h.requests[0].headers["x-api-key"], "test-secret");
      assert.equal(h.requests[1].url.search, "?signature=unchanged%2Bvalue");
      assert.equal(h.requests[1].headers["x-api-key"], undefined);
      assert.equal(h.requests[1].headers.authorization, undefined);
    }
  });
}

test("download parse failures surface as MCP errors rather than empty success", async (t) => {
  const h = await harness(t, { respond: (req) => req.url.pathname === "/download"
    ? { raw: "{" }
    : { body: { docs: [], total: 1, took: 1, isDocsInline: false, docsUrl: `${req.url.origin}/download` } } });
  const result = await h.call("query_collection", { collectionName: "items", ...query });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /parse documents from URL/);
});
