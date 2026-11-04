import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { getEnvConfig } from "../dist/config/env.js";
import { createServer } from "../dist/server/createServer.js";

const CONNECTION = "11111111-2222-4333-8444-555555555555";
const PROJECT = "66666666-7777-4888-9999-000000000000";
const KEY = "synthetic-project-key";
const TOKEN = "synthetic-access-token";
const DEVICE_CODE = "synthetic-device-code";

/** Mock Backend and provider on one loopback origin; `plan` steers each scenario. */
async function provider(t, plan = {}) {
  const requests = [];
  const http = createHttpServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, base);
    const request = { method: req.method, path: url.pathname, headers: req.headers, raw };
    requests.push(request);
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const form = Object.fromEntries(new URLSearchParams(raw));
    switch (`${req.method} ${url.pathname}`) {
      case "GET /.well-known/oauth-protected-resource":
        return send(200, { resource: base, authorization_servers: [`${base}/`] });
      case "GET /.well-known/openid-configuration":
        return send(200, { issuer: `${base}/`, token_endpoint: `${base}/oauth2/token`, device_authorization_endpoint: `${base}/oauth2/device/auth`, revocation_endpoint: `${base}/oauth2/revoke` });
      case "POST /project-connections":
        return send(201, { connection_id: CONNECTION, expires_at: new Date(Date.now() + 900_000).toISOString() });
      case "POST /oauth2/device/auth":
        return send(200, { device_code: DEVICE_CODE, user_code: "ABCD-EFGH", verification_uri: `${base}/oauth2/device/verify`, verification_uri_complete: `${base}/oauth2/device/verify?user_code=ABCD-EFGH`, expires_in: plan.expiresIn ?? 600, interval: 1 });
      case "POST /oauth2/token": {
        const answer = plan.token?.() ?? "approve";
        if (answer === "approve") return send(200, { access_token: TOKEN, token_type: "bearer", expires_in: 900, scope: plan.scope ?? "connection:read connection:issue" });
        return send(400, { error: answer });
      }
      case `GET /project-connections/${CONNECTION}`:
        return send(200, { connection_id: CONNECTION, status: plan.status ?? "ready", project_id: PROJECT, project_name: "items-project" });
      case `POST /project-connections/${CONNECTION}/key`:
        if (plan.claim === "lost") return req.socket.destroy();
        if (plan.claim) return send(...plan.claim);
        return send(201, { connection_id: CONNECTION, endpoint: base, project_id: PROJECT, project_name: "items-project", key_id: "key-1", api_key: KEY });
      case "POST /oauth2/revoke":
        return send(200, {});
      default:
        if (url.pathname.endsWith("/collections")) return send(200, { collections: [] });
        return send(404, { error: "not_found" });
    }
  });
  await new Promise(resolve => http.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${http.address().port}`;
  t.after(() => new Promise(resolve => { http.closeAllConnections(); http.close(resolve); }));
  return { base, requests, plan, count: (method, path) => requests.filter(r => r.method === method && r.path === path).length };
}

/** An in-memory credential store that survives a server restart within the test. */
function memoryVault({ probe = true, save = true } = {}) {
  const items = new Map();
  return {
    items,
    async probe() { if (!probe) throw new Error("locked"); return "keychain"; },
    async save(store, id, key) { if (!save) throw new Error("denied"); items.set(`${store}/${id}`, key); },
    async read(store, id) { const v = items.get(`${store}/${id}`); if (v === undefined) throw new Error("missing"); return v; },
    async remove(store, id) { items.delete(`${store}/${id}`); }
  };
}

async function connectServer(t, p, vault, dir) {
  const config = getEnvConfig({ LAMBDADB_API_URL: p.base, LAMBDADB_MCP_STATE_DIR: dir });
  const server = createServer(config, { vault });
  const client = new Client({ name: "connect-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name: `lambdadb_${name}`, arguments: args });
    const text = result.content[0].text;
    // Nothing a tool returns may carry a key, token or device code.
    for (const secret of [KEY, TOKEN, DEVICE_CODE]) assert.ok(!text.includes(secret), `${name} leaked a secret`);
    return { isError: result.isError === true, text, data: text.includes("\n\n") ? JSON.parse(text.split("\n\n").slice(1).join("\n\n")) : undefined };
  };
  return { client, call };
}

async function settle(call, attemptId) {
  for (let i = 0; i < 100; i++) {
    const { data } = await call("connection_status", { attempt_id: attemptId });
    if (!["pending", "issuing"].includes(data.status)) return data;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("attempt did not settle");
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "lambdadb-mcp-connect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const stateOf = dir => {
  const [file] = readdirSync(dir).filter(name => name.endsWith(".json"));
  return file ? JSON.parse(readFileSync(join(dir, file), "utf8")) : undefined;
};

test("without a project key the server starts disconnected and data tools report not_connected", async (t) => {
  const p = await provider(t);
  const { client, call } = await connectServer(t, p, memoryVault(), tempDir(t));
  const names = (await client.listTools()).tools.map(tool => tool.name);
  assert.equal(names.length, 11);
  assert.ok(["lambdadb_connect", "lambdadb_connection_status", "lambdadb_cancel_connection"].every(name => names.includes(name)));
  assert.match(client.getInstructions(), /lambdadb_connect/);
  const read = await call("list_collections");
  assert.equal(read.isError, true);
  assert.match(read.text, /not_connected/);
  assert.equal((await call("connection_status")).data.connection.status, "not_connected");
  assert.equal(p.requests.length, 0);
});

test("connect returns the approval link promptly, claims one key and survives a restart", async (t) => {
  const p = await provider(t);
  const vault = memoryVault();
  const dir = tempDir(t);
  const first = await connectServer(t, p, vault, dir);
  const started = await first.call("connect");
  assert.equal(started.data.status, "pending");
  assert.equal(started.data.user_code, "ABCD-EFGH");
  assert.match(started.data.verification_uri, /\/oauth2\/device\/verify\?user_code=ABCD-EFGH$/);
  assert.equal(p.count("POST", "/oauth2/token"), 0, "connect must not wait for approval");
  const creation = JSON.parse(p.requests.find(r => r.path === "/project-connections").raw);
  assert.deepEqual(creation, { client_id: "lambdadb-mcp" });
  const device = Object.fromEntries(new URLSearchParams(p.requests.find(r => r.path === "/oauth2/device/auth").raw));
  assert.deepEqual(device, { client_id: "lambdadb-mcp", scope: "connection:read connection:issue", audience: p.base, connection_id: CONNECTION });

  const done = await settle(first.call, started.data.attempt_id);
  assert.equal(done.status, "connected");
  assert.equal(done.connection.project_name, "items-project");
  assert.equal(done.connection.key_id, "key-1");
  const claim = p.requests.find(r => r.path.endsWith("/key"));
  assert.equal(claim.raw, "", "the key claim takes an empty body");
  assert.equal(claim.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(p.count("POST", "/oauth2/revoke"), 1, "the setup token is revoked");
  assert.deepEqual([...vault.items.values()], [KEY]);
  const saved = JSON.stringify(stateOf(dir));
  assert.ok(!saved.includes(KEY) && !saved.includes(TOKEN));
  assert.equal(stateOf(dir).recovery, undefined);

  const listed = await first.call("list_collections");
  assert.equal(listed.isError, false, listed.text);
  assert.equal(p.requests.at(-1).headers["x-api-key"], KEY);

  // A new process restores the key from the store without another approval.
  const before = p.requests.length;
  const second = await connectServer(t, p, vault, dir);
  assert.equal((await second.call("list_collections")).isError, false);
  assert.equal(p.requests.length, before + 1);
  assert.equal(p.requests.at(-1).headers["x-api-key"], KEY);
});

test("a pending attempt is reused, and cancel stops it before any key exists", async (t) => {
  const p = await provider(t, { token: () => "authorization_pending" });
  const { call } = await connectServer(t, p, memoryVault(), tempDir(t));
  const started = await call("connect");
  const again = await call("connect");
  assert.equal(again.data.attempt_id, started.data.attempt_id);
  assert.equal(p.count("POST", "/project-connections"), 1);
  const canceled = await call("cancel_connection", { attempt_id: started.data.attempt_id });
  assert.equal(canceled.data.status, "canceled");
  // A late approval is ignored once the attempt is canceled.
  p.plan.token = () => "approve";
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(p.count("POST", `/project-connections/${CONNECTION}/key`), 0);
  assert.equal((await call("connection_status", { attempt_id: started.data.attempt_id })).data.status, "canceled");
  assert.equal((await call("connection_status")).data.connection.status, "not_connected");
  const other = await call("connection_status", { attempt_id: "00000000-0000-4000-8000-000000000000" });
  assert.equal(other.data.status, "unknown");
});

test("denial and region requests end without a key claim", async (t) => {
  for (const [plan, status, error] of [
    [{ token: () => "access_denied" }, "failed", "access_denied"],
    [{ status: "region_requested", scope: "connection:read" }, "region_requested", undefined]
  ]) {
    const p = await provider(t, plan);
    const { call } = await connectServer(t, p, memoryVault(), tempDir(t));
    const done = await settle(call, (await call("connect")).data.attempt_id);
    assert.equal(done.status, status);
    assert.equal(done.error, error);
    assert.equal(done.connection.status, "not_connected");
    assert.equal(p.count("POST", `/project-connections/${CONNECTION}/key`), 0);
  }
});

test("an unusable credential store stops Connect before authorization", async (t) => {
  const p = await provider(t);
  const { call } = await connectServer(t, p, memoryVault({ probe: false }), tempDir(t));
  const result = await call("connect");
  assert.equal(result.isError, true);
  assert.equal(result.data.error, "credential_store_unavailable");
  assert.equal(p.requests.length, 0);
});

test("uncertain or unsaved deliveries keep recovery identity and the next Connect recovers it", async (t) => {
  for (const [plan, vaultOptions, error] of [
    [{ claim: [409, { error: "issuance_unconfirmed", connection_id: CONNECTION }] }, {}, "issuance_unconfirmed"],
    [{ claim: "lost" }, {}, "issuance_unconfirmed"],
    [{}, { save: false }, "credential_store_failed"]
  ]) {
    const p = await provider(t, plan);
    const dir = tempDir(t);
    const { call } = await connectServer(t, p, memoryVault(vaultOptions), dir);
    const done = await settle(call, (await call("connect")).data.attempt_id);
    assert.equal(done.status, "failed");
    assert.equal(done.error, error);
    assert.equal(done.connection.status, "not_connected");
    assert.equal(done.connection.recovery.connection_id, CONNECTION);
    assert.equal(stateOf(dir).recovery.projectId, PROJECT);
    if (error === "credential_store_failed") assert.equal(done.connection.recovery.key_id, "key-1");
    await call("connect");
    const retry = p.requests.filter(r => r.path === "/project-connections").at(-1);
    assert.deepEqual(JSON.parse(retry.raw), { client_id: "lambdadb-mcp", recovery_id: CONNECTION });
  }
});

test("a definite claim rejection creates no recovery reference", async (t) => {
  const p = await provider(t, { claim: [403, { error: "owner_or_admin_required" }] });
  const dir = tempDir(t);
  const { call } = await connectServer(t, p, memoryVault(), dir);
  const done = await settle(call, (await call("connect")).data.attempt_id);
  assert.equal(done.error, "owner_or_admin_required");
  assert.equal(stateOf(dir)?.recovery, undefined);
});
