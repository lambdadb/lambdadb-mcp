import { randomUUID } from "node:crypto";

import {
  ConnectError,
  claimKey,
  connectionStatus,
  createConnection,
  discover,
  origin,
  pollDevice,
  revoke,
  startDevice,
  uuid,
  type Provider
} from "./oauth.js";
import { readState, writeState, type Connected, type CredentialStore, type State, type Vault } from "./store.js";

export type ProjectConfig = { baseUrl: string; projectName: string; projectApiKey: string };

type AttemptStatus = "pending" | "issuing" | "connected" | "region_requested" | "canceled" | "expired" | "failed";
type Attempt = {
  id: string;
  status: AttemptStatus;
  verificationUri: string;
  userCode: string;
  expiresAt: number;
  abort: AbortController;
  error?: string;
  message?: string;
  keyId?: string;
};

// Domain conflicts the Backend reports with a stable code.
const DOMAIN_ERRORS = ["issuance_unconfirmed", "recovery_required", "project_not_ready", "expired", "owner_or_admin_required", "target_unavailable"];

/**
 * Owns one configuration's connection: the saved project key, and at most one
 * current Connect attempt whose background polling this process performs.
 */
export class ConnectionManager {
  private attempt?: Attempt;
  private starting?: Promise<Record<string, unknown>>;
  private cached?: { credentialId: string; key: string };

  constructor(private readonly options: { apiUrl: string; file: string; vault: Vault }) {}

  /** The saved project for data tools; throws not_connected when there is none. */
  async project(): Promise<ProjectConfig> {
    const { connected } = await readState(this.options.file).catch(() => ({} as State));
    if (!connected) {
      throw new ConnectError("not_connected", "not_connected: no LambdaDB project is connected. Ask the user to connect with lambdadb_connect, or configure a project key in the server environment.");
    }
    if (this.cached?.credentialId !== connected.credentialId) {
      let key: string;
      try {
        key = await this.options.vault.read(connected.credentialStore, connected.credentialId);
      } catch {
        throw new ConnectError("credential_store_unavailable", `credential_store_unavailable: the saved project key could not be read from the ${connected.credentialStore} store. Unlock it for this OS user and retry; no request was sent.`);
      }
      this.cached = { credentialId: connected.credentialId, key };
    }
    return { baseUrl: connected.endpoint, projectName: connected.projectName, projectApiKey: this.cached.key };
  }

  /** Starts Connect, or returns the current pending attempt so one approval code stays valid. */
  async connect(): Promise<Record<string, unknown>> {
    const current = this.attempt;
    if (current && ((current.status === "pending" && Date.now() < current.expiresAt) || current.status === "issuing")) {
      return this.view(current);
    }
    this.starting ??= this.start().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async start(): Promise<Record<string, unknown>> {
    let store: CredentialStore;
    try {
      store = await this.options.vault.probe();
    } catch {
      throw new ConnectError("credential_store_unavailable", "credential_store_unavailable: no usable OS credential store, so no approval was requested. Unlock the store, or configure LAMBDADB_BASE_URL, LAMBDADB_PROJECT_NAME and LAMBDADB_PROJECT_API_KEY with a key from Console.");
    }
    const state = await readState(this.options.file).catch(() => {
      throw new ConnectError("state_unreadable", `The saved connection metadata in ${this.options.file} is unreadable. Fix or remove it; removing it does not revoke any server key.`);
    });
    const provider = await discover(this.options.apiUrl);
    // An earlier uncertain delivery is recovered for the same project, not replaced.
    const connectionId = await createConnection(provider, state.recovery?.connectionId);
    const device = await startDevice(provider, connectionId);
    const attempt: Attempt = {
      id: randomUUID(),
      status: "pending",
      verificationUri: device.verificationUri,
      userCode: device.userCode,
      expiresAt: device.expiresAt,
      abort: new AbortController()
    };
    this.attempt?.abort.abort();
    this.attempt = attempt;
    void this.run(attempt, provider, connectionId, store, device).catch(() => {});
    return this.view(attempt);
  }

  /** Reports one attempt and the saved connection; never a key, token or device code. */
  async status(attemptId?: string): Promise<Record<string, unknown>> {
    if (attemptId === undefined) return { connection: await this.saved() };
    const attempt = this.find(attemptId);
    return attempt ? this.view(attempt) : this.unknown(attemptId);
  }

  /** Stops background polling when the server closes; a claim in progress still finishes. */
  close(): void {
    this.attempt?.abort.abort();
  }

  /** Stops polling; a key claim already in progress cannot be undone. */
  async cancel(attemptId: string): Promise<Record<string, unknown>> {
    const attempt = this.find(attemptId);
    if (!attempt) return this.unknown(attemptId);
    if (attempt.status === "pending") {
      this.finish(attempt, "canceled", undefined, "Connect was canceled. No key was created.");
      attempt.abort.abort();
    }
    return this.view(attempt);
  }

  private find(attemptId: string) {
    return this.attempt?.id === attemptId ? this.attempt : undefined;
  }

  private async unknown(attemptId: string) {
    return { attempt_id: attemptId, status: "unknown", message: "This attempt is not the current Connect attempt of this server process. Start Connect again if needed.", connection: await this.saved() };
  }

  private async saved(): Promise<Record<string, unknown>> {
    let state: State;
    try {
      state = await readState(this.options.file);
    } catch {
      return { status: "unreadable" };
    }
    const recovery = state.recovery ? { recovery: { connection_id: state.recovery.connectionId, reason: state.recovery.reason, ...(state.recovery.keyId ? { key_id: state.recovery.keyId } : {}) } } : {};
    const c = state.connected;
    return c
      ? { status: "connected", project_name: c.projectName, project_id: c.projectId, endpoint: c.endpoint, key_id: c.keyId, ...recovery }
      : { status: "not_connected", ...recovery };
  }

  private async view(a: Attempt): Promise<Record<string, unknown>> {
    const pending = a.status === "pending";
    return {
      attempt_id: a.id,
      status: pending && Date.now() >= a.expiresAt ? "expired" : a.status,
      ...(pending ? {
        verification_uri: a.verificationUri,
        user_code: a.userCode,
        expires_at: new Date(a.expiresAt).toISOString(),
        message: "Open verification_uri, confirm user_code, sign in and approve one project. Only approve a request you started. Then check lambdadb_connection_status."
      } : {}),
      ...(a.error ? { error: a.error } : {}),
      ...(a.message && !pending ? { message: a.message } : {}),
      ...(a.keyId ? { key_id: a.keyId } : {}),
      connection: await this.saved()
    };
  }

  private finish(a: Attempt, status: AttemptStatus, error?: string, message?: string) {
    a.status = status;
    a.error = error;
    a.message = message;
  }

  private async run(a: Attempt, p: Provider, connectionId: string, store: CredentialStore, device: Parameters<typeof pollDevice>[1]) {
    let token: string;
    let scope: string[];
    try {
      ({ accessToken: token, scope } = await pollDevice(p, device, a.abort.signal));
    } catch (error) {
      if (this.attempt !== a || a.status !== "pending") return;
      const e = error instanceof ConnectError ? error : new ConnectError("authorization_failed", "Approval could not be completed. Start Connect again.");
      return this.finish(a, e.code === "expired" ? "expired" : "failed", e.code, e.message);
    }
    try {
      // Only the current, uncanceled attempt may apply a result.
      if (this.attempt !== a || a.status !== "pending") return;
      await this.issue(a, p, connectionId, store, token, scope);
    } catch (error) {
      if (a.status === "pending" || a.status === "issuing") {
        const e = error instanceof ConnectError ? error : new ConnectError("connect_failed", "Connect did not complete. Start Connect again.");
        this.finish(a, "failed", e.code, e.message);
      }
    } finally {
      // The setup token has no further use; the project key is independent of it.
      await revoke(p, token);
    }
  }

  private async issue(a: Attempt, p: Provider, connectionId: string, store: CredentialStore, token: string, scope: string[]) {
    const view = await connectionStatus(p, connectionId, token);
    if (a.status !== "pending") return;
    if (view.status === "region_requested" || !scope.includes("connection:issue")) {
      return this.finish(a, "region_requested", undefined, "A project was requested in a region that is not open yet, so nothing is connected. When the project is ready, start Connect again and select it.");
    }
    if (view.status !== "ready" || !uuid(view.project_id)) {
      throw new ConnectError("connect_failed", "The approved project is not ready for a key. Start Connect again.");
    }
    const projectId = view.project_id;
    const before = await readState(this.options.file);
    // Record recovery identity before the claim, so an uncertain delivery is
    // recovered for this project instead of silently replaced.
    a.status = "issuing";
    await writeState(this.options.file, { ...before, recovery: { connectionId, projectId, reason: "issuing" } });
    const reply = await claimKey(p, connectionId, token);
    const v = reply?.value ?? {};
    if (!reply || reply.status !== 201) {
      const code = reply && typeof v.error === "string" && DOMAIN_ERRORS.includes(v.error) ? v.error : "issuance_unconfirmed";
      // A definite rejection created no key: keep the earlier recovery reference.
      const uncertain = code === "issuance_unconfirmed" || code === "recovery_required" || !reply || reply.status >= 500 || reply.status === 408;
      await writeState(this.options.file, uncertain
        ? { ...before, recovery: { connectionId, projectId, reason: "issuance_unconfirmed" } }
        : before).catch(() => {});
      throw new ConnectError(code, uncertain
        ? "Key delivery is uncertain. Start Connect again and select the same project; do not create another project. Review keys named lambdadb-connection-* in Console."
        : "The key was not issued. Start Connect again.");
    }
    let endpoint: string;
    try {
      endpoint = origin(v.endpoint);
      if (v.connection_id !== connectionId || v.project_id !== projectId || typeof v.key_id !== "string" || !v.key_id
        || typeof v.project_name !== "string" || !/^[a-zA-Z0-9_-]{3,52}$/.test(v.project_name)
        || typeof v.api_key !== "string" || !v.api_key.trim() || /[\r\n]/.test(v.api_key)) throw new Error();
    } catch {
      await writeState(this.options.file, { ...before, recovery: { connectionId, projectId, reason: "issuance_unconfirmed" } }).catch(() => {});
      throw new ConnectError("issuance_unconfirmed", "The key response could not be verified. Start Connect again and select the same project.");
    }
    const keyId = v.key_id;
    a.keyId = keyId;
    const credentialId = randomUUID();
    const recovery = { connectionId, projectId, keyId, reason: "credential_store_failed" as const };
    try {
      await this.options.vault.save(store, credentialId, v.api_key);
    } catch {
      await writeState(this.options.file, { ...before, recovery }).catch(() => {});
      throw new ConnectError("credential_store_failed", `The key was issued but could not be saved to the ${store} store, so nothing is connected. Revoke key ${keyId} in Console, then start Connect again for the same project.`);
    }
    const connected: Connected = { endpoint, projectName: v.project_name, projectId, keyId, connectionId, credentialStore: store, credentialId };
    try {
      await writeState(this.options.file, { connected });
    } catch {
      await this.options.vault.remove(store, credentialId).catch(() => {});
      throw new ConnectError("credential_store_failed", `The key was issued but the connection metadata could not be saved, so nothing is connected. Revoke key ${keyId} in Console, then start Connect again for the same project.`);
    }
    this.cached = { credentialId, key: v.api_key };
    const previous = before.connected;
    if (previous) await this.options.vault.remove(previous.credentialStore, previous.credentialId).catch(() => {});
    this.finish(a, "connected", undefined, previous && previous.keyId !== keyId
      ? `Connected to ${v.project_name}. The previous project key ${previous.keyId} still exists on the server; revoke it in Console if unused.`
      : `Connected to ${v.project_name}.`);
  }
}
