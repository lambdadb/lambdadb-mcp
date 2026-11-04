import { origin } from "../connect/oauth.js";
import { defaultStateDir } from "../connect/store.js";

export type ProjectEnv = {
  baseUrl: string;
  projectName: string;
  projectApiKey: string;
};

/**
 * Either an explicitly configured project key, or LambdaDB Connect, which
 * obtains and saves a project key through browser approval.
 */
export type EnvConfig = { enableWriteTools: boolean } & (
  | ({ mode: "explicit" } & ProjectEnv)
  | { mode: "connect"; apiUrl: string; instance: string; stateDir: string }
);

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

const set = (value: string | undefined) => value != null && value.trim() !== "";

export function getEnvConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const enableWriteTools = parseBoolean(env.LAMBDADB_MCP_ENABLE_WRITE_TOOLS, false);
  // Any project variable selects explicit configuration, which then needs all three.
  if (set(env.LAMBDADB_BASE_URL) || set(env.LAMBDADB_PROJECT_NAME) || set(env.LAMBDADB_PROJECT_API_KEY)) {
    return {
      mode: "explicit",
      baseUrl: requireEnv("LAMBDADB_BASE_URL", env.LAMBDADB_BASE_URL),
      projectName: requireEnv("LAMBDADB_PROJECT_NAME", env.LAMBDADB_PROJECT_NAME),
      projectApiKey: requireEnv("LAMBDADB_PROJECT_API_KEY", env.LAMBDADB_PROJECT_API_KEY),
      enableWriteTools
    };
  }
  let apiUrl: string;
  try {
    apiUrl = origin(set(env.LAMBDADB_API_URL) ? env.LAMBDADB_API_URL!.trim() : "https://api.lambdadb.ai");
  } catch {
    throw new Error("LAMBDADB_API_URL must be an HTTPS origin without a path (HTTP loopback is allowed for local tests).");
  }
  const instance = set(env.LAMBDADB_MCP_INSTANCE) ? env.LAMBDADB_MCP_INSTANCE!.trim() : "default";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(instance)) {
    throw new Error("LAMBDADB_MCP_INSTANCE must use 1–64 letters, digits, dots, underscores or hyphens.");
  }
  return {
    mode: "connect",
    apiUrl,
    instance,
    stateDir: set(env.LAMBDADB_MCP_STATE_DIR) ? env.LAMBDADB_MCP_STATE_DIR!.trim() : defaultStateDir(env),
    enableWriteTools
  };
}
