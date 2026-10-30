export type EnvConfig = {
  baseUrl: string;
  projectName: string;
  projectApiKey: string;
  enableWriteTools: boolean;
  maxResultBytes: number;
};

export const DEFAULT_MAX_RESULT_BYTES = 65_536;

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

function parseNonNegativeInteger(name: string, value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative integer for ${name}: ${value}`);
  }
  return parsed;
}

export function getEnvConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  return {
    baseUrl: requireEnv("LAMBDADB_BASE_URL", env.LAMBDADB_BASE_URL),
    projectName: requireEnv("LAMBDADB_PROJECT_NAME", env.LAMBDADB_PROJECT_NAME),
    projectApiKey: requireEnv(
      "LAMBDADB_PROJECT_API_KEY",
      env.LAMBDADB_PROJECT_API_KEY
    ),
    enableWriteTools: parseBoolean(
      env.LAMBDADB_MCP_ENABLE_WRITE_TOOLS,
      false
    ),
    // Document results above this JSON size are cut to whole documents; 0 disables the cut.
    maxResultBytes: parseNonNegativeInteger(
      "LAMBDADB_MCP_MAX_RESULT_BYTES",
      env.LAMBDADB_MCP_MAX_RESULT_BYTES,
      DEFAULT_MAX_RESULT_BYTES
    )
  };
}

