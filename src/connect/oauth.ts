// LambdaDB OAuth for the local stdio server: the provisioned public client
// `lambdadb-mcp`, RFC 8628 Device Authorization bound to one project connection,
// and the one-time project key claim. The account API origin is the only
// configuration; the issuer and every endpoint come from discovery.

export const MCP_CLIENT_ID = "lambdadb-mcp";
export const CONNECTION_SCOPE = "connection:read connection:issue";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const TIMEOUT_MS = 30_000;

/** A failure with a stable code that tool results can report. */
export class ConnectError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

export type Provider = {
  apiUrl: string;
  issuer: string;
  deviceEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
};
export type Device = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
};
type Reply = { status: number; value: Record<string, unknown> };

export const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);

/** An HTTPS origin, or HTTP on a loopback host for local tests. */
export function origin(value: unknown): string {
  if (typeof value !== "string") throw new Error("not a URL");
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("not an origin");
  }
  return url.origin;
}

/** Provider endpoints must stay on the issuer's origin. */
function onIssuer(value: unknown, issuer: string): string {
  if (typeof value !== "string") throw new Error("not a URL");
  const url = new URL(value);
  if (url.origin !== new URL(issuer).origin || url.username || url.password || url.hash) throw new Error("off issuer");
  return url.href;
}

/** One bounded JSON request; transport failures throw, HTTP errors return their status. */
async function call(url: string, init: RequestInit, signal?: AbortSignal): Promise<Reply> {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetch(url, { ...init, redirect: "error", signal: requestSignal });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    // Cancel the body explicitly: Node fetch can lose abort propagation after headers.
    const abortBody = () => { void reader.cancel().catch(() => {}); };
    requestSignal.addEventListener("abort", abortBody, { once: true });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        requestSignal.throwIfAborted();
        if (done) break;
        size += value.length;
        if (size > 65_536) throw new Error("response too large");
        chunks.push(value);
      }
    } finally {
      requestSignal.removeEventListener("abort", abortBody);
      await reader.cancel().catch(() => {});
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let value: unknown = {};
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    value = {};
  }
  return { status: response.status, value: value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} };
}

const form = (values: Record<string, string | undefined>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  body: new URLSearchParams(Object.entries(values).filter((e): e is [string, string] => e[1] !== undefined)).toString()
});
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify(body)
});
const bearer = (token: string, method = "GET"): RequestInit => ({
  method,
  headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
});

const unavailable = () => new ConnectError("connect_unavailable", "LambdaDB Connect is unavailable right now. Retry later, or configure LAMBDADB_BASE_URL, LAMBDADB_PROJECT_NAME and LAMBDADB_PROJECT_API_KEY with a key from Console.");

/** Discovers the issuer from RFC 9728 metadata on the account API origin. */
export async function discover(apiUrl: string, signal?: AbortSignal): Promise<Provider> {
  let resource: Reply;
  try {
    resource = await call(`${apiUrl}/.well-known/oauth-protected-resource`, { headers: { Accept: "application/json" } }, signal);
  } catch {
    signal?.throwIfAborted();
    throw unavailable();
  }
  if (resource.status === 404) {
    throw new ConnectError("connect_not_offered", `${apiUrl} does not offer LambdaDB Connect yet. Configure LAMBDADB_BASE_URL, LAMBDADB_PROJECT_NAME and LAMBDADB_PROJECT_API_KEY with a key from Console instead.`);
  }
  try {
    const servers = resource.value.authorization_servers;
    if (resource.status !== 200 || origin(resource.value.resource) !== apiUrl || !Array.isArray(servers) || servers.length !== 1) throw new Error();
    const issuer = servers[0];
    const issuerUrl = new URL(String(issuer));
    origin(issuerUrl.origin);
    if (issuerUrl.pathname !== "/" || issuerUrl.search || issuerUrl.hash || !String(issuer).endsWith("/")) throw new Error();
    const metadata = await call(`${issuer}.well-known/openid-configuration`, { headers: { Accept: "application/json" } }, signal);
    const m = metadata.value;
    if (metadata.status !== 200 || m.issuer !== issuer) throw new Error();
    return {
      apiUrl,
      issuer: String(issuer),
      deviceEndpoint: onIssuer(m.device_authorization_endpoint, String(issuer)),
      tokenEndpoint: onIssuer(m.token_endpoint, String(issuer)),
      revocationEndpoint: onIssuer(m.revocation_endpoint, String(issuer))
    };
  } catch {
    signal?.throwIfAborted();
    throw unavailable();
  }
}

/** Creates the project connection; the project is chosen later in Console. */
export async function createConnection(p: Provider, recoveryId: string | undefined, signal?: AbortSignal): Promise<string> {
  let reply: Reply;
  try {
    reply = await call(`${p.apiUrl}/project-connections`, json({ client_id: MCP_CLIENT_ID, ...(recoveryId ? { recovery_id: recoveryId } : {}) }), signal);
  } catch {
    signal?.throwIfAborted();
    throw unavailable();
  }
  if (reply.status === 429 || reply.status === 503) throw new ConnectError("connect_busy", "LambdaDB Connect is busy. Retry later.");
  if (reply.status === 400 && reply.value.error === "invalid_client") {
    throw new ConnectError("connect_not_offered", "This LambdaDB server does not accept connections from lambdadb-mcp. Configure a project key from Console instead.");
  }
  if (reply.status !== 201 || !uuid(reply.value.connection_id)) throw unavailable();
  return reply.value.connection_id;
}

/** Starts Device Authorization for one connection through the provider's device endpoint. */
export async function startDevice(p: Provider, connectionId: string, signal?: AbortSignal): Promise<Device> {
  let reply: Reply;
  try {
    reply = await call(p.deviceEndpoint, form({ client_id: MCP_CLIENT_ID, scope: CONNECTION_SCOPE, audience: p.apiUrl, connection_id: connectionId }), signal);
  } catch {
    signal?.throwIfAborted();
    throw unavailable();
  }
  const s = reply.value;
  try {
    if (reply.status !== 200
      || typeof s.device_code !== "string" || !/^\S{8,512}$/.test(s.device_code)
      || typeof s.user_code !== "string" || !/^[A-Za-z0-9-]{4,32}$/.test(s.user_code)
      || !Number.isInteger(s.expires_in) || Number(s.expires_in) < 1 || Number(s.expires_in) > 1800
      || (s.interval !== undefined && (!Number.isInteger(s.interval) || Number(s.interval) < 1 || Number(s.interval) > 60))) {
      throw new Error();
    }
    onIssuer(s.verification_uri, p.issuer);
    const verificationUri = s.verification_uri_complete === undefined ? String(s.verification_uri) : onIssuer(s.verification_uri_complete, p.issuer);
    return {
      deviceCode: s.device_code,
      userCode: s.user_code,
      verificationUri,
      expiresAt: Date.now() + Number(s.expires_in) * 1000,
      interval: Number(s.interval ?? 5) * 1000
    };
  } catch {
    throw unavailable();
  }
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  if (signal.aborted) return abort();
  signal.addEventListener("abort", abort, { once: true });
});

/** Polls the token endpoint per RFC 8628 until approval, denial or expiry. */
export async function pollDevice(p: Provider, device: Device, signal: AbortSignal): Promise<{ accessToken: string; scope: string[] }> {
  let interval = device.interval;
  while (Date.now() < device.expiresAt) {
    await sleep(Math.min(interval, Math.max(0, device.expiresAt - Date.now())), signal);
    if (Date.now() >= device.expiresAt) break;
    let reply: Reply;
    try {
      reply = await call(p.tokenEndpoint, form({ grant_type: DEVICE_GRANT, device_code: device.deviceCode, client_id: MCP_CLIENT_ID }), signal);
    } catch {
      signal.throwIfAborted();
      // A lost poll response is retried; only the provider's answer ends the attempt.
      continue;
    }
    const v = reply.value;
    if (reply.status === 200) {
      if (typeof v.access_token !== "string" || !v.access_token || String(v.token_type).toLowerCase() !== "bearer") {
        throw new ConnectError("authorization_failed", "Approval could not be completed. Start Connect again.");
      }
      return { accessToken: v.access_token, scope: String(v.scope ?? CONNECTION_SCOPE).split(" ") };
    }
    if (v.error === "authorization_pending") continue;
    if (v.error === "slow_down") {
      interval = Math.min(interval + 5000, 60_000);
      continue;
    }
    if (v.error === "expired_token") break;
    if (v.error === "access_denied") throw new ConnectError("access_denied", "The connection was not approved. Nothing changed.");
    throw new ConnectError("authorization_failed", "Approval could not be completed. Start Connect again.");
  }
  throw new ConnectError("expired", "The approval code expired. Start Connect again.");
}

/** Reads the connection bound into the setup token. */
export async function connectionStatus(p: Provider, connectionId: string, token: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let reply: Reply;
  try {
    reply = await call(`${p.apiUrl}/project-connections/${connectionId}`, bearer(token), signal);
  } catch {
    signal?.throwIfAborted();
    throw new ConnectError("status_unavailable", "The connection status could not be read. Start Connect again.");
  }
  if (reply.status !== 200 || reply.value.connection_id !== connectionId) {
    throw new ConnectError(typeof reply.value.error === "string" ? reply.value.error : "status_unavailable", "The connection status could not be read. Start Connect again.");
  }
  return reply.value;
}

/**
 * Claims the one-time key with an empty body. Returns the reply, or null when no
 * reply arrived, which leaves the outcome uncertain.
 */
export async function claimKey(p: Provider, connectionId: string, token: string): Promise<Reply | null> {
  try {
    return await call(`${p.apiUrl}/project-connections/${connectionId}/key`, bearer(token, "POST"));
  } catch {
    return null;
  }
}

/** RFC 7009 revocation of the setup token; failure leaves it to expire. */
export async function revoke(p: Provider, token: string): Promise<void> {
  await call(p.revocationEndpoint, form({ token, token_type_hint: "access_token", client_id: MCP_CLIENT_ID })).catch(() => {});
}
