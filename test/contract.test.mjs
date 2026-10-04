import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { queryCollectionRequestBodyToJSON } from "@functional-systems/lambdadb/models/operations";
const root = process.env.MCP_TEST_ROOT ? pathToFileURL(`${process.env.MCP_TEST_ROOT}/`) : new URL("../", import.meta.url);
const { getEnvConfig } = await import(new URL("dist/config/env.js", root));
const { createServer } = await import(new URL("dist/server/createServer.js", root));

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
  const protocolErrors = [];
  client.onerror = error => protocolErrors.push(error);
  const [inMemoryClient, serverTransport] = InMemoryTransport.createLinkedPair();
  const clientTransport = process.env.MCP_TEST_BIN ? new StdioClientTransport({
    command: process.platform === "win32" ? process.execPath : process.env.MCP_TEST_BIN,
    args: process.platform === "win32" ? [process.env.MCP_TEST_BIN] : [],
    cwd: process.env.MCP_TEST_CWD,
    stderr: "pipe",
    env: {
      PATH: process.env.PATH,
      LAMBDADB_BASE_URL: baseUrl, LAMBDADB_PROJECT_NAME: "test",
      LAMBDADB_PROJECT_API_KEY: "test-secret",
      ...(write ? { LAMBDADB_MCP_ENABLE_WRITE_TOOLS: "true" } : {})
    }
  }) : inMemoryClient;
  let stderr = "";
  if (process.env.MCP_TEST_BIN) clientTransport.stderr.on("data", chunk => { stderr += chunk; });
  t.after(async () => {
    await client.close();
    await server.close();
    assert.deepEqual(protocolErrors, [], "stdout must contain only valid MCP messages");
    assert.equal(stderr, "", "Successful tool calls must not leak diagnostics or credentials");
    await new Promise((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
  });
  if (!process.env.MCP_TEST_BIN) await server.connect(serverTransport);
  await client.connect(clientTransport);
  if (process.env.MCP_TEST_VERSION) assert.equal(client.getServerVersion().version, process.env.MCP_TEST_VERSION);
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

test("all 49 analyzers reach collection creation without altering analyzer lists", async (t) => {
  const h = await harness(t, { write: true, respond: () => ({ status: 201, body: { collection: created } }) });
  const analyzers = ["standard", "english", "korean", "japanese", "chinese", "cjk", "arabic", "french",
    "german", "hindi", "indonesian", "italian", "portuguese", "russian", "spanish", "turkish",
    "armenian", "basque", "bengali", "brazilian", "bulgarian", "catalan", "czech", "danish", "dutch",
    "estonian", "finnish", "galician", "greek", "hungarian", "irish", "latvian", "lithuanian", "norwegian",
    "persian", "romanian", "serbian", "sorani", "swedish", "thai", "simple", "whitespace", "stop", "keyword",
    "pattern", "fingerprint", "nepali", "tamil", "telugu"];
  const schema = (await h.client.listTools()).tools.find(tool => tool.name === "lambdadb_create_collection").inputSchema;
  const validate = new AjvJsonSchemaValidator().getValidator(schema);
  assert.equal(analyzers.length, 49);
  for (const name of analyzers) assert.ok((await h.client.listTools()).tools.find(tool => tool.name === "lambdadb_create_collection").description.includes(name));
  for (const names of [undefined, ...analyzers.map(name => [name]), analyzers, [], ["chinese", "chinese"]]) {
    const input = { collectionName: "items", indexConfigs: { title: { type: "text", ...(names === undefined ? {} : { analyzers: names }) } } };
    assert.equal(validate(input).valid, true);
    data(await h.call("create_collection", input));
    assert.deepEqual(h.requests.at(-1).body, input);
  }
  const accepted = h.requests.length;
  assert.equal((await h.call("create_collection", {
    collectionName: "items", indexConfigs: { title: { type: "text", analyzers: ["unknown"] } }
  })).isError, true);
  for (const analyzers of [["English"], ["KEYWORD"]]) {
    assert.equal((await h.call("create_collection", { collectionName: "items", indexConfigs: { title: { type: "text", analyzers } } })).isError, true);
  }
  assert.equal(h.requests.length, accepted);
});

test("facet JSON Schema, tool validation and SDK requests agree on optional/null sizes and limits", async (t) => {
  const h = await harness(t, { respond: () => ({ body: { docs: [], total: 0, took: 1, isDocsInline: true, facets: {} } }) });
  const schema = (await h.client.listTools()).tools.find(tool => tool.name === "lambdadb_query_collection").inputSchema;
  const validate = new AjvJsonSchemaValidator().getValidator(schema);
  assert.deepEqual(schema.required, ["collectionName"]);
  assert.equal(schema.properties.facets.maxProperties, 5);
  assert.equal(schema.properties.facets.additionalProperties.additionalProperties, false);
  const valid = [
    {}, { size: 1 }, { size: 100 }, { facets: {} },
    { size: 0, facets: { category: {} } },
    { size: 0, facets: { category: { size: null } } },
    { facets: { category: { size: 1 } } }, { facets: { category: { size: 100 } } },
    { ...query, size: 2, facets: { category: { size: 10 }, "metadata.category": {} } },
    { facets: Object.fromEntries(["a", "b", "c", "d", "e"].map(key => [key, {}])) },
    // The SDK leaves field-name semantics to the service; do not invent a nonempty-name constraint.
    { facets: { "": {} } }
  ];
  for (const input of valid) {
    assert.equal(validate({ collectionName: "items", ...input }).valid, true, JSON.stringify(input));
    data(await h.call("query_collection", { collectionName: "items", ...input }));
    const body = h.requests.at(-1).body;
    assert.deepEqual(body, JSON.parse(queryCollectionRequestBodyToJSON(input)));
    assert.deepEqual(body.facets, input.facets, "Do not inject bucket defaults or drop null");
    assert.equal(Object.hasOwn(body, "query"), Object.hasOwn(input, "query"));
    assert.equal(Object.hasOwn(body, "size"), Object.hasOwn(input, "size"));
    assert.equal(h.requests.at(-1).method, "POST");
    assert.ok(h.requests.at(-1).url.pathname.endsWith("/query"));
  }
  const invalidFacets = [
    { size: 0 }, { size: 0, facets: {} }, { facets: null }, { facets: [] },
    { facets: { category: null } }, { facets: { category: [] } },
    { facets: { category: { size: 0 } } }, { facets: { category: { size: 101 } } },
    { facets: { category: { size: -1 } } }, { facets: { category: { size: 1.5 } } },
    { facets: { category: { size: "10" } } }, { facets: { category: { size: true } } },
    { facets: { category: { unknown: true } } },
    { facets: Object.fromEntries(["a", "b", "c", "d", "e", "f"].map(key => [key, {}])) }
  ];
  for (const input of invalidFacets) assert.throws(() => queryCollectionRequestBodyToJSON(input));
  const accepted = h.requests.length;
  for (const input of [...invalidFacets, { query: null }, { size: -1 }, { size: 101 }, { size: null }, { size: 1.5 }]) {
    assert.equal(validate({ collectionName: "items", ...input }).valid, false, JSON.stringify(input));
    assert.equal((await h.call("query_collection", { collectionName: "items", ...input })).isError, true, JSON.stringify(input));
  }
  assert.equal(h.requests.length, accepted, "Invalid requests must not reach HTTP");
});

test("facet-only and document+facet results preserve counts and all search options", async (t) => {
  const facets = { category: { buckets: [{ value: "한국어", count: 12 }] }, "metadata.category": { buckets: [] } };
  for (const size of [0, 2]) {
    const response = { docs: size === 0 ? [] : docs, total: size === 0 ? 0 : docs.length, took: 7, isDocsInline: true, facets };
    const h = await harness(t, { respond: () => ({ body: response }) });
    for (const ref of [undefined, { kind: "branch", name: "dev" }, { kind: "tag", name: "release" }, { kind: "alias", name: "current" }]) {
      const input = { size, ...(size ? query : {}), facets: { category: { size: null }, "metadata.category": {} },
        ...(ref ? { ref } : {}), consistentRead: !ref || ref.kind === "branch", includeVectors: true,
        sort: [{ category: "ASC" }], fields: { include: ["title"], exclude: ["hidden"] },
        partitionFilter: { field: "tenant", in: ["test"] } };
      assert.deepEqual(data(await h.call("query_collection", { collectionName: "items", ...input })), response);
      assert.deepEqual(h.requests.at(-1).body, input);
    }
    for (const kind of ["tag", "alias"]) {
      assert.equal((await h.call("query_collection", {
        collectionName: "items", size, facets: { category: {} }, ref: { kind, name: "release" }, consistentRead: true
      })).isError, true);
    }
    assert.equal(h.requests.length, 4);
  }
});

test("document+facet metadata survives docsUrl hydration without download credentials", async (t) => {
  const facets = { category: { buckets: [{ value: "test", count: 20 }] } };
  for (const payload of [docs, [], { docs }]) {
    const h = await harness(t, { respond: req => req.url.pathname === "/download"
      ? { body: payload }
      : { body: { docs: [], total: 20, took: 7, isDocsInline: false, facets, docsUrl: `${req.url.origin}/download` } } });
    const result = data(await h.call("query_collection", { collectionName: "items", facets: { category: {} } }));
    assert.deepEqual(result.facets, facets);
    assert.deepEqual(result.docs, Array.isArray(payload) ? payload : docs);
    assert.equal(result.total, 20);
    assert.equal(result.took, 7);
    assert.equal(result.isDocsInline, true);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].headers["x-api-key"], undefined);
    assert.equal(h.requests[1].headers.authorization, undefined);
  }
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

test("SDK authentication failures return MCP tool errors and leave the server usable", async (t) => {
  const h = await harness(t, { respond: () => ({ status: 401, body: { message: "Fixture access denied" } }) });
  const result = await h.call("list_collections");
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /denied|unauthorized|authentication/i);
  assert.ok(!JSON.stringify(result).includes("test-secret"));
  assert.equal((await h.client.listTools()).tools.length, 5);
});

const rerank = { provider: "typesafe", model: "jev-1.13.0", queryText: "  Restore a collection  ", fields: ["title", "metadata.body"] };

test("rerank schema and HTTP preserve omission, nulls, text, criteria order and distinct sizes", async (t) => {
  const h = await harness(t, { respond: () => ({ body: { docs: [], total: 0, took: 1, isDocsInline: true } }) });
  const schema = (await h.client.listTools()).tools.find(tool => tool.name === "lambdadb_query_collection").inputSchema;
  const validate = new AjvJsonSchemaValidator().getValidator(schema);
  for (const input of [
    { rerank }, { ...query, rerank, sort: [] }, { ...query, rerank, size: 0, facets: { category: {} } },
    { ...query, rerank: { ...rerank, fields: ["title", "title"] } },
    { ...query, rerank: { ...rerank, criteria: ["same", "same"] } },
    { ...query, rerank: { ...rerank, weights: [] } }
  ]) assert.equal(validate({ collectionName: "items", ...input }).valid, false, JSON.stringify(input));
  for (const options of [{}, { rerank: null }, { rerank }, { rerank: { ...rerank, candidateSize: null, onFailure: null, criteria: null } },
    { rerank: { ...rerank, candidateSize: 50, onFailure: "returnOriginal", criteria: [" Unrelated. ", "한국어 relevant answer."] } }]) {
    const input = { size: 5, query: { knn: { field: "embedding", vector: [1, 0, 0], k: 20 } }, ...options };
    assert.equal(validate({ collectionName: "items", ...input }).valid, true);
    data(await h.call("query_collection", { collectionName: "items", ...input }));
    assert.deepEqual(h.requests.at(-1).body, JSON.parse(queryCollectionRequestBodyToJSON(input)));
    assert.deepEqual(h.requests.at(-1).body.rerank, options.rerank);
    assert.equal(Object.hasOwn(h.requests.at(-1).body, "rerank"), Object.hasOwn(options, "rerank"));
    assert.equal(h.requests.at(-1).body.query.knn.k, 20);
  }
  data(await h.call("query_collection", { collectionName: "items", size: 0, facets: { category: {} }, rerank: null }));
  assert.equal(h.requests.at(-1).body.rerank, null);
  for (const size of [1, 100]) {
    const input = { ...query, size, rerank: { ...rerank, candidateSize: size }, facets: { category: {} },
      ref: { kind: "branch", name: "dev" }, consistentRead: true, fields: { include: ["title"] } };
    data(await h.call("query_collection", { collectionName: "items", ...input }));
    assert.deepEqual(h.requests.at(-1).body, JSON.parse(queryCollectionRequestBodyToJSON(input)));
  }
});

test("invalid reranking fails before HTTP, including UTF-8 limits and scoring restrictions", async (t) => {
  const h = await harness(t, { write: true });
  const invalidConfigs = [
    { provider: "jev" }, { model: "other" }, { queryText: "\u3000" }, { queryText: "한".repeat(2731) },
    { fields: [] }, { fields: Array(9).fill("title") }, { fields: ["title", "title"] }, { fields: ["metadata..title"] },
    { candidateSize: 0 }, { candidateSize: 101 }, { candidateSize: 1.5 }, { candidateSize: 9 },
    { onFailure: "ignore" }, { criteria: [] }, { criteria: ["same", "same"] }, { criteria: ["\u3000", "answer"] },
    { criteria: ["한".repeat(683), "answer"] }, { criteria: Array.from({ length: 5 }, (_, i) => `${i}${"한".repeat(600)}`) },
    { criteria: Array.from({ length: 11 }, (_, i) => `${i}`) },
    ...["weights", "thresholds", "rubricVersion", "rerankScore", "apiKey"].map(key => ({ [key]: "unsupported" }))
  ];
  for (const patch of invalidConfigs) {
    assert.equal((await h.call("query_collection", { collectionName: "items", ...query, rerank: { ...rerank, ...patch } })).isError, true, JSON.stringify(patch));
  }
  for (const input of [
    { rerank }, { ...query, size: 0, facets: { category: {} }, rerank }, { ...query, sort: [], rerank },
    { query: { bool: [{ occur: "FILTER", queryString: { query: "title:test" } }] }, rerank },
    { ...query, rerank, ref: { kind: "tag", name: "release" }, consistentRead: true }
  ]) assert.equal((await h.call("query_collection", { collectionName: "items", ...input })).isError, true);
  assert.equal((await h.call("create_collection", { collectionName: "items", indexConfigs: collection.indexConfigs, rerank })).isError, true);
  assert.equal(h.requests.length, 0);
});

test("rerank envelopes preserve zero, precision, server order and metadata inline and through docsUrl", async (t) => {
  const rankedDocs = [
    { collection: "items", doc: { id: "second", score: "user data" }, score: 0.80000002, retrievalScore: 0 },
    { collection: "items", doc: { id: "first" }, score: 0.80000002, retrievalScore: 3.251234567 },
    { collection: "items", doc: { id: "zero" }, score: 0, retrievalScore: -0.125 }
  ];
  const baseMetadata = { provider: "typesafe", model: "jev-1.13.0", candidateCount: 3, scoredCount: 3, took: 190 };
  const responses = [
    { docs: rankedDocs, maxScore: 0.80000002, rerank: { ...baseMetadata, status: "applied", resolvedModel: "jev-1.13.0", criteriaVersion: "custom" } },
    { docs: [rankedDocs[2]], maxScore: 0, rerank: { ...baseMetadata, candidateCount: 1, scoredCount: 1, status: "applied", criteriaVersion: "default-relevance-v1" } },
    { docs: [], rerank: { ...baseMetadata, candidateCount: 0, scoredCount: 0, status: "skipped", reason: "noCandidates" } },
    { docs, maxScore: 1, rerank: { ...baseMetadata, scoredCount: 0, status: "fallback", reason: "timeout" } },
    { docs, maxScore: 1 }
  ];
  for (const response of responses) for (const download of [false, true]) {
    const wire = { took: 210, total: response.docs.length, isDocsInline: true, ...response };
    const h = await harness(t, { respond: req => req.url.pathname === "/download" ? { body: response.docs }
      : { body: download ? { ...wire, docs: [], isDocsInline: false, docsUrl: `${req.url.origin}/download` } : wire } });
    const result = data(await h.call("query_collection", { collectionName: "items", ...query, ...(response.rerank ? { rerank } : {}) }));
    assert.deepEqual(result, { ...wire, ...(download ? { docsUrl: `${h.baseUrl}/download` } : {}) });
    if (download) assert.equal(h.requests[1].headers["x-api-key"], undefined);
  }
});

test("returnOriginal does not hide service or hydration errors", async (t) => {
  for (const download of [false, true]) {
    const h = await harness(t, { respond: req => !download || req.url.pathname === "/download"
      ? { status: 400, body: { message: "Invalid candidate text" } }
      : { body: { docs: [], total: 1, took: 1, isDocsInline: false, docsUrl: `${req.url.origin}/download` } } });
    assert.equal((await h.call("query_collection", { collectionName: "items", ...query, rerank: { ...rerank, onFailure: "returnOriginal" } })).isError, true);
    assert.equal(h.requests.length, download ? 2 : 1);
  }
});
