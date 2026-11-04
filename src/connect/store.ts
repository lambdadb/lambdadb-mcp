import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const credentialStores = ["keychain", "windows", "secret-service", "keyutils"] as const;
export type CredentialStore = (typeof credentialStores)[number];

/** Non-secret metadata for one saved connection; the key lives in the OS store. */
export type Connected = {
  endpoint: string;
  projectName: string;
  projectId: string;
  keyId: string;
  connectionId: string;
  credentialStore: CredentialStore;
  credentialId: string;
};
/** A connection whose key may exist on the server without being saved here. */
export type Recovery = {
  connectionId: string;
  projectId: string;
  keyId?: string;
  reason: "issuing" | "issuance_unconfirmed" | "credential_store_failed";
};
export type State = { connected?: Connected; recovery?: Recovery };

/** OS credential storage for project keys, one fresh slot per connection. */
export type Vault = {
  /** Proves the store can save, read back and delete before authorization. */
  probe(): Promise<CredentialStore>;
  save(store: CredentialStore, id: string, key: string): Promise<void>;
  read(store: CredentialStore, id: string): Promise<string>;
  remove(store: CredentialStore, id: string): Promise<void>;
};

/** Identifies one server configuration: its account API origin and instance name. */
export const identity = (apiUrl: string, instance: string) =>
  createHash("sha256").update(JSON.stringify([apiUrl, instance])).digest("hex");

export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32" && env.APPDATA) return join(env.APPDATA, "lambdadb-mcp");
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "lambdadb-mcp");
}

export const stateFile = (dir: string, apiUrl: string, instance: string) =>
  join(dir, `connection-${identity(apiUrl, instance).slice(0, 32)}.json`);

function parseState(value: unknown): State {
  const v = value as State;
  if (!v || typeof v !== "object") throw new Error();
  const text = (x: unknown) => typeof x === "string" && x.length > 0;
  if (v.connected) {
    const c = v.connected;
    if (![c.endpoint, c.projectName, c.projectId, c.keyId, c.connectionId, c.credentialId].every(text)
      || !credentialStores.includes(c.credentialStore)) throw new Error();
  }
  if (v.recovery && (!text(v.recovery.connectionId) || !text(v.recovery.projectId))) throw new Error();
  return { ...(v.connected ? { connected: v.connected } : {}), ...(v.recovery ? { recovery: v.recovery } : {}) };
}

export async function readState(file: string): Promise<State> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return parseState(JSON.parse(raw));
}

/** Atomic replacement, readable only by this OS user. */
export async function writeState(file: string, state: State): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

type Entry = {
  setSecret(value: Uint8Array, signal?: AbortSignal): Promise<void>;
  getSecret(signal?: AbortSignal): Promise<number[] | null>;
  deleteCredential(signal?: AbortSignal): Promise<boolean>;
};

function candidates(platform: NodeJS.Platform): CredentialStore[] {
  if (platform === "darwin") return ["keychain"];
  if (platform === "win32") return ["windows"];
  if (platform === "linux") return ["secret-service", "keyutils"];
  return [];
}

/** The native OS store through @napi-rs/keyring, loaded only when Connect is used. */
export function nativeVault(service: string, platform: NodeJS.Platform = process.platform): Vault {
  const entry = async (store: CredentialStore, id: string): Promise<Entry> => {
    if (!candidates(platform).includes(store)) throw new Error("credential store of another OS");
    const { AsyncEntry } = await import("@napi-rs/keyring");
    return new AsyncEntry(service, id, store === "secret-service" || store === "keyutils" ? { linux: { store } } : undefined);
  };
  const timeout = () => AbortSignal.timeout(15_000);
  const vault: Vault = {
    async probe() {
      for (const store of candidates(platform)) {
        const id = `probe-${randomUUID()}`;
        try {
          await vault.save(store, id, randomUUID());
          await vault.remove(store, id);
          return store;
        } catch {
          /* Try the next store on this OS. */
        }
      }
      throw new Error("no usable credential store");
    },
    async save(store, id, key) {
      const e = await entry(store, id);
      // Every connection uses a fresh slot; never overwrite an existing secret.
      if ((await e.getSecret(timeout())) !== null) throw new Error("slot in use");
      try {
        await e.setSecret(Buffer.from(key), timeout());
        const saved = await e.getSecret(timeout());
        if (saved === null || !Buffer.from(saved).equals(Buffer.from(key))) throw new Error("read-back mismatch");
      } catch (error) {
        await e.deleteCredential(timeout()).catch(() => {});
        throw error;
      }
    },
    async read(store, id) {
      const value = await (await entry(store, id)).getSecret(timeout());
      if (value === null) throw new Error("missing credential");
      return Buffer.from(value).toString("utf8");
    },
    async remove(store, id) {
      await (await entry(store, id)).deleteCredential(timeout());
    }
  };
  return vault;
}
