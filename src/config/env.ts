export type EnvConfig = {
  baseUrl: string;
  projectName: string;
  projectApiKey: string;
  enableWriteTools: boolean;
};

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
    )
  };
}

